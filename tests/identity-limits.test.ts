import assert from 'node:assert/strict';
import test from 'node:test';
import { IdentityLimits, networkAddress } from '../server/identity/limits';
import { openIdentityFixture } from './fixtures/identity';

test('shared authentication budgets remain exact under concurrent pools, restart and independent scopes', async t => {
  const f = await openIdentityFixture(); t.after(f.close);
  const replica = await f.replica();
  const secret = f.config.identity?.clientSecret;
  assert.ok(secret);
  const first = new IdentityLimits(f.db, secret);
  const second = new IdentityLimits(replica.db, secret);
  const results = await Promise.all(Array.from({ length: 80 }, (_, index) => (index % 2 ? first : second).consume('network', '198.18.0.99')));
  assert.equal(results.filter(result => result.allowed).length, 30);
  assert.ok(results.every(result => result.retryAfter >= 1 && result.retryAfter <= 900));
  const restarted = new IdentityLimits(replica.db, secret);
  assert.equal((await restarted.consume('network', '198.18.0.99')).allowed, false);
  assert.equal((await restarted.consume('network', '198.18.0.100')).allowed, true);
  assert.equal((await restarted.consume('legacy-account', '198.18.0.99')).allowed, true);
  assert.equal((await restarted.consume('community-network', '198.18.0.99')).allowed, true);
  assert.equal((await restarted.consume('community-account', 'owner-1')).allowed, true);
  assert.equal((await restarted.consume('ai', 'owner-1')).allowed, true);
  const rows = await f.db.prepare('SELECT * FROM identity_abuse_buckets').all();
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(String(row.fingerprint))));
  assert.ok(rows.every(row => Number(row.attempts) <= 31));
  assert.ok(!JSON.stringify(rows).includes('198.18.'));
  assert.ok(!JSON.stringify(rows).includes(secret));
  await f.db.prepare("UPDATE identity_abuse_buckets SET started=0,expires=1 WHERE scope='network'").run();
  assert.equal((await first.consume('network', '198.18.0.99')).allowed, true);
  const remaining = await f.db.prepare('SELECT count(*)::integer AS count FROM identity_abuse_buckets').get();
  assert.equal(remaining?.count, 5);
});

test('canonical address handling cannot create separate mapped IPv4 or alternate IPv6 budgets', () => {
  assert.equal(networkAddress('::ffff:198.18.0.42'), networkAddress('198.18.0.42'));
  assert.equal(networkAddress('::ffff:c612:2a'), networkAddress('198.18.0.42'));
  assert.equal(networkAddress('2001:db8:0:0:0:0:0:42'), networkAddress('2001:db8::42'));
  assert.throws(() => networkAddress('client-controlled-name'), /could not be verified/);
});

test('owned Auth.js security mutations share an account budget without throttling another owner', async t => {
  const f = await openIdentityFixture(); t.after(f.close);
  const owner = f.browser(); await f.complete(owner, await f.begin(owner)); await owner.bootstrap();
  for (let index = 0; index < 31; index++) {
    const browser = f.browser();
    for (const [name, value] of owner.cookies) browser.cookies.set(name, value);
    browser.csrf = owner.csrf;
    const response = await browser.request('/api/identity/sessions/foreign-session', undefined, 'DELETE');
    assert.equal(response.status, index < 30 ? 404 : 429);
    if (index === 30) assert.ok(Number(response.headers.get('retry-after')) >= 1);
  }
  const other = f.browser();
  await f.complete(other, await f.begin(other), { sub: 'google-oauth2|independent-limit-owner' });
  await other.bootstrap();
  assert.equal((await other.request('/api/identity/sessions/foreign-session', undefined, 'DELETE')).status, 404);
});
