import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('production image exposes nginx port 80 for Coolify health checks', () => {
  assert.match(dockerfile, /^FROM nginx:alpine$/m);
  assert.match(dockerfile, /^COPY --from=build \/app\/dist \/usr\/share\/nginx\/html$/m);
  assert.match(dockerfile, /^EXPOSE 80$/m);
});