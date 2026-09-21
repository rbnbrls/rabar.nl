// Guards the honesty of `.github/workflows/deploy.yml`.
//
// The deploy workflow is the only automatic path from `main` to production for this
// repository, so a green run has to mean "Coolify was asked to build and the build
// finished". Kanban t_5d2882f3 was the opposite: the trigger step posted to Coolify
// app `b8f8kmbenoly2e9ase1b3joj`, which had been deleted (HTTP 404 `No resources
// found.`), and piped `curl -s` into a `python3 -c ... || echo "unknown"` fallback,
// so the 404 body produced `deployment_uuid=unknown` and a green job (run
// 31888050214, main @ 5d47a4a) while nothing was deployed.
//
// These tests execute the real `run:` blocks of the workflow (extracted from the
// YAML, not copied, so they cannot drift) under `bash -e` with a stubbed `curl` on
// PATH: every Coolify answer is played back from a fixture and the step's exit
// status, annotations and `$GITHUB_OUTPUT` are checked.
//
// Run with `npm test` (node's built-in test runner — this repo has no other test
// dependency). `node:assert` is used directly so the assertions stay
// runner-independent.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(here, '..', '.github', 'workflows', 'deploy.yml');
const workflow = readFileSync(workflowPath, 'utf8');

const TRIGGER_STEP = 'Trigger Coolify deployment';
const WAIT_STEP = 'Wait for Coolify deployment to finish';

const FAKE_TOKEN = 'fake-coolify-token-value-1234567890';
const APP_UUID = '0g5foqmnwtajdv31rxnr9fej';
const UNAUTHENTICATED = '{"message":"Unauthenticated."}';
const NO_RESOURCES = '{"message":"No resources found."}';
const QUEUED =
  '{"deployments":[{"message":"Application rabar.nl deployment queued.",' +
  `"resource_uuid":"${APP_UUID}","deployment_uuid":"n6yjc2emtgshw3nnt0riqgdk"}]}`;
const QUEUED_UUID = 'n6yjc2emtgshw3nnt0riqgdk';

// Plays back one `code|body` fixture per call (the last one repeats) and mimics the
// curl flags the workflow uses, including --fail/--fail-with-body's exit status.
const CURL_STUB = `#!/usr/bin/env bash
set -u
DIR="\${MOCK_DIR:?MOCK_DIR must be set}"
COUNT_FILE="\${DIR}/call_count"
N="$(cat "\${COUNT_FILE}" 2>/dev/null || echo 0)"
N=$((N + 1))
printf '%s' "\${N}" > "\${COUNT_FILE}"

SPEC="$(awk -v n="\${N}" '{ lines[NR] = $0 } END { print (n > NR ? lines[NR] : lines[n]) }' "\${DIR}/responses")"
CODE="\${SPEC%%|*}"
BODY="\${SPEC#*|}"

fail_on_error=0
out=""
fmt=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --fail|--fail-with-body) fail_on_error=1; shift ;;
    -o) out="$2"; shift 2 ;;
    -w) fmt="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ "\${CODE}" = "000" ]; then
  echo "curl: (7) Failed to connect to dev.7rb.nl port 443" >&2
  exit 7
fi

if [ -n "\${out}" ]; then
  printf '%s' "\${BODY}" > "\${out}"
else
  printf '%s' "\${BODY}"
fi
if [ -n "\${fmt}" ]; then
  printf '%s' "\${CODE}"
fi
case "\${CODE}" in
  4*|5*) [ "\${fail_on_error}" = "1" ] && exit 22 ;;
esac
exit 0
`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The dedented `run: |` script of the step called `stepName`. */
function stepRun(stepName) {
  const lines = workflow.split('\n');
  const namePattern = new RegExp(`^\\s*- name:\\s*${escapeRegExp(stepName)}\\s*$`);
  const start = lines.findIndex((line) => namePattern.test(line));
  assert.ok(start >= 0, `step "${stepName}" not found in ${workflowPath}`);

  let runIndex = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*- name:/.test(lines[index])) break;
    if (/^\s*run:\s*\|\s*$/.test(lines[index])) {
      runIndex = index;
      break;
    }
  }
  assert.ok(runIndex >= 0, `step "${stepName}" has no \`run: |\` block`);

  const blockIndent = lines[runIndex].match(/^\s*/)[0].length;
  const bodyIndent = blockIndent + 2;
  const body = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      body.push('');
      continue;
    }
    if (line.match(/^\s*/)[0].length < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return `${body.join('\n')}\n`;
}

/** Runs a workflow step's shell with a stubbed curl and returns its observable result. */
function runStep(stepName, { responses, token = FAKE_TOKEN, env = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-workflow-'));
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const curl = path.join(bin, 'curl');
    writeFileSync(curl, CURL_STUB);
    chmodSync(curl, 0o755);
    writeFileSync(path.join(dir, 'responses'), `${responses.join('\n')}\n`);

    const stepFile = path.join(dir, 'step.sh');
    writeFileSync(stepFile, stepRun(stepName));
    const githubOutput = path.join(dir, 'github_output');
    writeFileSync(githubOutput, '');

    // GitHub Actions runs `run:` blocks as `bash -e <file>`.
    const proc = spawnSync('bash', ['-e', stepFile], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        MOCK_DIR: dir,
        GITHUB_OUTPUT: githubOutput,
        COOLIFY_API_TOKEN: token,
        ...env,
      },
    });
    return {
      status: proc.status,
      output: `${proc.stdout ?? ''}${proc.stderr ?? ''}`,
      githubOutput: readFileSync(githubOutput, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Every test below spawns at least one bash process; the default timeout is tight
// for the ones that loop over several fixtures, so give each a generous budget.
const stepTest = (name, fn) => test(name, { timeout: 60_000 }, fn);

stepTest('trigger step goes green only when Coolify queued a deployment', () => {
  const { status, githubOutput } = runStep(TRIGGER_STEP, { responses: [`200|${QUEUED}`] });
  assert.equal(status, 0, 'a 200 with a deployment uuid must succeed');
  assert.match(githubOutput, new RegExp(`^deployment_uuid=${QUEUED_UUID}$`, 'm'));
});

stepTest('trigger step fails on the 404 that started this card (deleted app uuid)', () => {
  const { status, output, githubOutput } = runStep(TRIGGER_STEP, { responses: [`404|${NO_RESOURCES}`] });
  assert.notEqual(status, 0, 'a 404 from a deleted app uuid must fail the step');
  assert.match(output, /::error/);
  assert.match(output, /404/);
  assert.match(output, /No resources found/);
  assert.match(output, new RegExp(APP_UUID), 'the failing app uuid must be named in the annotation');
  assert.doesNotMatch(githubOutput, /deployment_uuid=/, 'no uuid may be published on failure');
});

stepTest('trigger step fails on the 401 {"message":"Unauthenticated."} body', () => {
  const { status, output, githubOutput } = runStep(TRIGGER_STEP, { responses: [`401|${UNAUTHENTICATED}`] });
  assert.notEqual(status, 0, `401 must fail the step, got exit ${status}\n${output}`);
  assert.match(output, /::error/);
  assert.match(output, /Unauthenticated/);
  assert.doesNotMatch(githubOutput, /deployment_uuid=/, 'no uuid may be published on failure');
});

stepTest('trigger step fails when a 2xx body carries no deployments[] entry', () => {
  const bodies = [
    '{"message":"Application rabar.nl deployment queued."}',
    '{}',
    'null',
    '[]',
    '{"deployments":[]}',
    '{"deployments":[{"message":"queued"}]}',
  ];
  for (const body of bodies) {
    const { status, output, githubOutput } = runStep(TRIGGER_STEP, { responses: [`200|${body}`] });
    assert.notEqual(status, 0, `200 with ${body} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
    assert.doesNotMatch(githubOutput, /deployment_uuid=/);
  }
});

stepTest('trigger step fails on a non-JSON body', () => {
  const { status, output } = runStep(TRIGGER_STEP, { responses: ['200|<html>502 Bad Gateway</html>'] });
  assert.notEqual(status, 0, 'a non-JSON 200 body must fail the step');
  assert.match(output, /::error/);
});

stepTest('trigger step fails on transport errors and 5xx responses', () => {
  for (const fixture of ['000|', '500|{"message":"Server Error"}']) {
    const { status, output } = runStep(TRIGGER_STEP, { responses: [fixture] });
    assert.notEqual(status, 0, `${fixture} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
  }
});

stepTest('trigger step fails with an actionable message when the token secret is unset', () => {
  const { status, output } = runStep(TRIGGER_STEP, { responses: [`401|${UNAUTHENTICATED}`], token: '' });
  assert.notEqual(status, 0, 'an empty COOLIFY_API_TOKEN must fail the step');
  assert.match(output, /::error/);
  assert.match(output, /COOLIFY_API_TOKEN/);
});

stepTest('trigger step never prints the API token', () => {
  const { output } = runStep(TRIGGER_STEP, { responses: [`200|${QUEUED}`] });
  assert.doesNotMatch(output, new RegExp(FAKE_TOKEN), 'the token must never reach the log');
});

stepTest('trigger step no longer contains the `|| echo unknown` fallback', () => {
  assert.doesNotMatch(stepRun(TRIGGER_STEP), /\|\| echo "unknown"/);
});

stepTest('trigger step targets the live Coolify app for this repo', () => {
  assert.match(
    stepRun(TRIGGER_STEP),
    new RegExp(`COOLIFY_APP_UUID="${APP_UUID}"`),
    'the app uuid must be the one that exists in Coolify (rabar.nl / production)',
  );
});

const FAST_WAIT_ENV = { DEPLOYMENT_ATTEMPTS: '2', DEPLOYMENT_WAIT_SECONDS: '0' };
const waitStep = (responses, attempts = FAST_WAIT_ENV.DEPLOYMENT_ATTEMPTS) =>
  runStep(WAIT_STEP, {
    responses,
    env: { ...FAST_WAIT_ENV, DEPLOYMENT_ATTEMPTS: attempts, DEPLOYMENT_UUID: QUEUED_UUID },
  });

stepTest('wait step is green once Coolify reports the deployment finished', () => {
  const { status } = waitStep(['200|{"status":"queued"}', '200|{"status":"building"}', '200|{"status":"finished"}'], '3');
  assert.equal(status, 0, 'a finished deployment must be green');
});

stepTest('wait step fails when the Coolify build fails', () => {
  const { status, output } = waitStep(['200|{"status":"building"}', '200|{"status":"failed"}']);
  assert.notEqual(status, 0, 'a failed deployment must turn the job red');
  assert.match(output, /::error/);
});

stepTest('wait step fails when the deployment never reaches a terminal status', () => {
  const { status, output } = waitStep(['200|{"status":"in_progress"}']);
  assert.notEqual(status, 0, 'a deployment that never finishes must not be reported as success');
  assert.match(output, /::error/);
});

stepTest('wait step fails when the status response cannot be parsed', () => {
  const { status, output } = waitStep(['200|<html>502 Bad Gateway</html>']);
  assert.notEqual(status, 0, 'an unparsable status must not be treated as success');
  assert.match(output, /::error/);
});

stepTest('wait step fails when the trigger step produced no uuid', () => {
  const { status, output } = runStep(WAIT_STEP, { responses: ['200|{"status":"finished"}'], env: FAST_WAIT_ENV });
  assert.notEqual(status, 0, 'a missing uuid must not be treated as success');
  assert.match(output, /::error/);
});

stepTest('deploy workflow deploys on push to main and can be re-run by hand', () => {
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[\s*main\s*\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /timeout-minutes:\s*\d+/, 'the job must be bounded by a timeout');
});
