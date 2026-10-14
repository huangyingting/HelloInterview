import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Azure VM ingress uses the exact canonical host, loopback upstream and explicit unavailable fallback', async () => {
  const caddy = await readFile('deploy/azure-vm/interview.caddy', 'utf8');
  assert.equal(caddy.match(/^interview\.genisisiq\.com \{$/gm)?.length, 1);
  assert.match(caddy, /^\s+reverse_proxy 127\.0\.0\.1:10006$/m);
  assert.equal(caddy.match(/^\s+Strict-Transport-Security "max-age=86400"$/gm)?.length, 2);
  assert.equal(caddy.match(/^\s+-Server$/gm)?.length, 2);
  assert.match(caddy, /^\s+respond "Interview Studio private beta is not available\." 503$/m);
  assert.doesNotMatch(caddy, /0\.0\.0\.0|localhost|http:\/\//);
});
