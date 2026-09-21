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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// Every invocation's argv is appended to ${DIR}/curl_calls, so a test can assert how
// many polls a step made and which URL it asked for.
const CURL_STUB = `#!/usr/bin/env bash
set -u
DIR="\${MOCK_DIR:?MOCK_DIR must be set}"
printf '%s\n' "$*" >> "\${DIR}/curl_calls"
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

// Records every `sleep` the step performs, so a test can prove the poll loop does not
// sleep after its final attempt (which is what parked the old budget on the timeout).
const SLEEP_STUB = `#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "\${MOCK_DIR:?MOCK_DIR must be set}/sleeps"
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
    const sleep = path.join(bin, 'sleep');
    writeFileSync(sleep, SLEEP_STUB);
    chmodSync(sleep, 0o755);
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
    const recorded = (name) => {
      const file = path.join(dir, name);
      return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    };
    return {
      status: proc.status,
      output: `${proc.stdout ?? ''}${proc.stderr ?? ''}`,
      githubOutput: readFileSync(githubOutput, 'utf8'),
      // One entry per `curl` invocation (its argv) and per `sleep` invocation, so a
      // test can assert how many polls a step made, where it polled, and whether it
      // slept after its final attempt.
      curlCalls: recorded('curl_calls'),
      sleeps: recorded('sleeps'),
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
    new RegExp(`COOLIFY_APP_UUID="\\$\\{COOLIFY_APP_UUID:-${APP_UUID}\\}"`),
    'the app uuid must be the one that exists in Coolify (rabar.nl / production)',
  );
});

stepTest('trigger step refuses to publish a uuid outside [A-Za-z0-9._-]', () => {
  // The uuid is written to $GITHUB_OUTPUT, so an unexpected payload must not be able
  // to publish a line of its own (kanban t_2b136b43, item 3).
  const bodies = [
    '{"deployments":[{"deployment_uuid":"bad uuid"}]}',
    '{"deployments":[{"deployment_uuid":"a;b"}]}',
    '{"deployments":[{"deployment_uuid":"evil\\nmy_output=1"}]}',
  ];
  for (const body of bodies) {
    const { status, output, githubOutput } = runStep(TRIGGER_STEP, { responses: [`200|${body}`] });
    assert.notEqual(status, 0, `200 with ${body} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
    assert.doesNotMatch(githubOutput, /deployment_uuid=/, 'no uuid may be published for an unexpected payload');
  }
});

stepTest('the Coolify API base and app uuid can be overridden per repository', () => {
  // Item 5 of kanban t_2b136b43: repo variables win over the fleet defaults, so one
  // workflow body can serve the whole fleet without losing this repo's own values.
  const base = 'https://coolify.example.test/api/v1';
  const trigger = runStep(TRIGGER_STEP, {
    responses: [`200|${QUEUED}`],
    env: { COOLIFY_API_BASE: base, COOLIFY_APP_UUID: 'overridden-app-uuid' },
  });
  assert.equal(trigger.status, 0, trigger.output);
  assert.match(trigger.curlCalls.join(' '), new RegExp(`${escapeRegExp(base)}/deploy`));
  assert.match(trigger.curlCalls.join(' '), /overridden-app-uuid/);

  const wait = runStep(WAIT_STEP, {
    responses: ['200|{"status":"finished"}'],
    env: { ...FAST_WAIT_ENV, DEPLOYMENT_UUID: QUEUED_UUID, COOLIFY_API_BASE: base },
  });
  assert.equal(wait.status, 0, wait.output);
  assert.match(wait.curlCalls.join(' '), new RegExp(`${escapeRegExp(base)}/deployments/${QUEUED_UUID}`));
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

// Kanban t_2b136b43. The poll used to run its whole 60 × 20s budget for every failure
// mode (a token revoked mid-run, a 404 body, a transport error, a 2xx body without a
// status) and then fail with a timeout that hid the real reason. Those tests pin the
// fail-fast behaviour: stop at the first unusable answer, quote the HTTP code and body.
const FULL_BUDGET = '60';

stepTest('wait step fails fast when the token dies mid-run (401 on a later poll)', () => {
  const { status, output, curlCalls } = waitStep(['200|{"status":"building"}', `401|${UNAUTHENTICATED}`], FULL_BUDGET);
  assert.notEqual(status, 0, `a mid-run 401 must fail the step, got exit ${status}\n${output}`);
  assert.match(output, /::error/);
  assert.match(output, /HTTP 401/);
  assert.match(output, /Unauthenticated/);
  assert.match(output, /COOLIFY_API_TOKEN/);
  assert.doesNotMatch(output, /did not reach 'finished'/, 'the timeout message must not mask the 401');
  assert.equal(curlCalls.length, 2, `the loop must stop at the first rejected poll, not keep polling (${curlCalls.length} polls)`);
});

stepTest('wait step fails fast on every other non-2xx poll, quoting the code and the body', () => {
  for (const [code, body] of [
    ['503', '{"message":"Server Error"}'],
    ['404', `${NO_RESOURCES}`],
    ['429', '{"message":"Too Many Requests"}'],
  ]) {
    const { status, output, curlCalls } = waitStep(['200|{"status":"in_progress"}', `${code}|${body}`], FULL_BUDGET);
    assert.notEqual(status, 0, `HTTP ${code} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
    assert.match(output, new RegExp(`HTTP ${code}`), 'the annotation must quote the HTTP code');
    assert.ok(output.includes(body), `the annotation must quote the body: ${body}`);
    assert.doesNotMatch(output, /did not reach 'finished'/);
    assert.equal(curlCalls.length, 2, `HTTP ${code} must stop the loop`);
  }
});

stepTest('wait step fails fast when the poll reports no usable HTTP status', () => {
  // `000` makes the stub behave like a transport error (no code on stdout at all);
  // `abc` mimics a curl that printed something non-numeric. Both used to reach
  // `[ "${HTTP_CODE}" -lt 200 ]` and die with "integer expression expected".
  for (const fixture of ['000|', 'abc|']) {
    const { status, output, curlCalls } = waitStep([fixture, '200|{"status":"finished"}'], FULL_BUDGET);
    assert.notEqual(status, 0, `${fixture} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
    assert.match(output, /HTTP 000/, 'a missing status code must be reported as 000');
    assert.doesNotMatch(output, /integer expression expected/, 'a missing code must not surface as an arithmetic error');
    assert.doesNotMatch(output, /did not reach 'finished'/);
    assert.equal(curlCalls.length, 1, 'an unusable answer must not be retried');
  }
});

stepTest('wait step fails fast when a 2xx body carries no usable status', () => {
  const bodies = [
    '<html>502 Bad Gateway</html>',
    '{"message":"No resources found."}',
    'null',
    '[]',
    '{}',
    '{"status":null}',
    '{"status":1234}',
  ];
  for (const body of bodies) {
    const { status, output, curlCalls } = waitStep([`200|${body}`], FULL_BUDGET);
    assert.notEqual(status, 0, `200 with ${body} must fail the step, got exit ${status}\n${output}`);
    assert.match(output, /::error/);
    assert.match(output, /HTTP 200/);
    assert.ok(output.includes(body), `the annotation must quote the body: ${body}`);
    assert.doesNotMatch(output, /did not reach 'finished'/, 'an unusable body must not be retried for the full budget');
    assert.equal(curlCalls.length, 1);
  }
});

stepTest('wait step fails before polling at all when the token secret is unset', () => {
  const { status, output, curlCalls } = runStep(WAIT_STEP, {
    responses: ['200|{"status":"finished"}'],
    token: '',
    env: { ...FAST_WAIT_ENV, DEPLOYMENT_UUID: QUEUED_UUID },
  });
  assert.notEqual(status, 0, 'an empty COOLIFY_API_TOKEN must fail the step');
  assert.match(output, /::error/);
  assert.match(output, /COOLIFY_API_TOKEN/);
  assert.equal(curlCalls.length, 0, 'no poll may be attempted without a token');
});

stepTest('wait step does not sleep after its final attempt', () => {
  const { status, output, sleeps } = waitStep(['200|{"status":"in_progress"}'], '3');
  assert.notEqual(status, 0, 'a deployment that never finishes must not be reported as success');
  assert.match(output, /::error/);
  assert.match(output, /did not reach 'finished'/);
  assert.equal(sleeps.length, 2, `three attempts must sleep twice, not ${sleeps.length} times`);
});

stepTest('the job timeout leaves headroom above the worst-case poll budget', () => {
  const timeout = Number(workflow.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  const attempts = Number(workflow.match(/DEPLOYMENT_ATTEMPTS:\s*"(\d+)"/)?.[1]);
  const wait = Number(workflow.match(/DEPLOYMENT_WAIT_SECONDS:\s*"(\d+)"/)?.[1]);
  assert.ok(
    Number.isFinite(timeout) && Number.isFinite(attempts) && Number.isFinite(wait),
    'the job timeout and the poll budget must be declared in the workflow',
  );
  // The final attempt no longer sleeps, so the worst case is (attempts - 1) sleeps.
  const budgetSeconds = (attempts - 1) * wait;
  assert.ok(
    timeout * 60 >= budgetSeconds + 600,
    `timeout-minutes: ${timeout} must exceed the ${budgetSeconds}s poll budget by at least 10 min of curl overhead`,
  );
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
