import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { fixtureFetch, openIdentityFixture, type IdentityBrowser } from './fixtures/identity';
import { LostJobClaim } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import type { ClaimData } from '../server/jobs/schema';

async function fixture(t: TestContext) {
  const f = await openIdentityFixture({}, { lifecycle: true });
  t.after(f.close);
  assert.ok(f.lifecycle);
  assert.ok(f.config.identity?.lifecycle);
  return { ...f, lifecycle: f.lifecycle, secret: f.config.identity.lifecycle.hookSecret };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function event(f: Fixture, subject: string, occurredAt = Date.now() - 1000) {
  return { version: 1, eventId: randomUUID(), issuer: f.issuer, subject, kind: 'password-changed', occurredAt };
}
async function send(f: Fixture, browser: IdentityBrowser, payload: unknown, timestamp = String(Date.now()), signature?: string) {
  return sendRaw(f, browser, JSON.stringify(payload), timestamp, signature);
}
async function sendRaw(f: Fixture, browser: IdentityBrowser, body: string, timestamp = String(Date.now()), signature?: string) {
  const signed = signature ?? createHmac('sha256', Buffer.from(f.secret, 'hex')).update(`${timestamp}.${body}`).digest('hex');
  return fixtureFetch(`${browser.address}/webhooks/identity/password-change`, { method: 'POST', body, ca: browser.ca,
    headers: { Host: browser.host, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': browser.ip, 'Content-Type': 'application/json', 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signed } });
}
async function login(f: Fixture, subject = 'auth0|lifecycle-owner') {
  const browser = f.browser();
  const response = await f.complete(browser, await f.begin(browser, 'email'), { sub: subject });
  assert.equal(response.headers.get('location'), '/account');
  const data = await browser.bootstrap();
  const user = data.user;
  assert.ok(user);
  return { browser, data: { ...data, user }, subject };
}

test('authenticated password events revoke sessions and owned proofs atomically with one replay-safe inbox/outbox across replicas', async t => {
  const f = await fixture(t), first = await login(f), second = await login(f);
  const replica = await f.replica(), message = event(f, first.subject);
  assert.equal((await first.browser.request('/api/identity/reauth', { provider: 'email' })).status, 200);
  const responses = await Promise.all([send(f, first.browser, message), send(f, replica.browser(), message)]);
  assert.ok(responses.every(response => response.status === 200));
  const results: { duplicate: boolean }[] = await Promise.all(responses.map(response => response.json()));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal((await first.browser.bootstrap()).user, null);
  assert.equal((await second.browser.bootstrap()).user, null);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM auth_transactions WHERE user_id=?').get(first.data.user.id))?.count, 0);
  assert.equal((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(first.data.user.id))?.session_epoch, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM verified_event_inbox').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM durable_operations').get())?.count, 1);
  const replay = await send(f, f.browser(), message);
  assert.deepEqual(await replay.json(), { accepted: true, duplicate: true });
  const whitespace = await sendRaw(f, f.browser(), ` \n${JSON.stringify(message)}\n`);
  assert.deepEqual(await whitespace.json(), { accepted: true, duplicate: true });
  assert.equal((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(first.data.user.id))?.session_epoch, 1);
  assert.equal((await send(f, f.browser(), { ...message, occurredAt: message.occurredAt + 1 })).status, 409);
});

test('bad signatures, stale deliveries, foreign issuers and social password claims never create authority or jobs', async t => {
  const f = await fixture(t), owner = await login(f), message = event(f, owner.subject);
  const invalid = await send(f, f.browser(), message, String(Date.now()), '0'.repeat(64));
  assert.equal(invalid.status, 403);
  assert.equal(invalid.headers.get('cache-control'), 'private, no-store');
  const timestamp = String(Date.now()), signature = createHmac('sha256', Buffer.from(f.secret, 'hex')).update(`${timestamp}.${JSON.stringify(message)}`).digest('hex');
  assert.equal((await sendRaw(f, f.browser(), ` ${JSON.stringify(message)}`, timestamp, signature)).status, 403);
  const oversized = await send(f, f.browser(), { ...message, padding: 'x'.repeat(5000) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('cache-control'), 'private, no-store');
  assert.equal((await send(f, f.browser(), message, String(Date.now() - 600000))).status, 403);
  assert.equal((await send(f, f.browser(), { ...message, issuer: 'https://foreign.fixture/' })).status, 400);
  assert.equal((await send(f, f.browser(), { ...message, subject: 'github|external-password' })).status, 400);
  assert.equal((await send(f, f.browser(), { ...message, unknown: 'not-authority' })).status, 400);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM verified_event_inbox').get())?.count, 0);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
});

test('revocation failure rolls back inbox, operation, cutoff and session changes before acknowledging delivery', async t => {
  const f = await fixture(t), owner = await login(f);
  await f.db.executeSql(`CREATE FUNCTION fail_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.action='provider-password-changed' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER fail_identity_audit BEFORE INSERT ON identity_security_events FOR EACH ROW EXECUTE FUNCTION fail_identity_audit();`);
  const response = await send(f, f.browser(), event(f, owner.subject));
  assert.equal(response.status, 500);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM verified_event_inbox').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM durable_operations').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner.data.user.id))?.session_epoch, 0);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
});

test('old SSO and outstanding anonymous callbacks cannot recreate revoked sessions; stored fresh login asks the broker to authenticate again', async t => {
  const f = await fixture(t), owner = await login(f);
  const pendingBrowser = f.browser();
  const pending = await f.begin(pendingBrowser, 'email');
  assert.equal((await send(f, f.browser(), event(f, owner.subject))).status, 200);
  const response = await f.complete(pendingBrowser, pending, { sub: owner.subject, auth_time: Math.floor(Date.now() / 1000) - 300 });
  assert.equal(response.headers.get('location'), '/auth?error=security_changed');
  assert.equal((await pendingBrowser.bootstrap()).user, null);
  const fresh = await pendingBrowser.request('/auth/login?provider=email&fresh=true');
  const authorization = new URL(fresh.headers.get('location') ?? '');
  assert.equal(authorization.searchParams.get('prompt'), 'login');
  assert.equal(authorization.searchParams.get('max_age'), '0');
  assert.equal((await f.complete(pendingBrowser, authorization, { sub: owner.subject })).headers.get('location'), '/account');
  assert.equal((await pendingBrowser.bootstrap()).user?.id, owner.data.user.id);
});

test('password authority arriving before first mapping prevents old proof from claiming a new owner', async t => {
  const f = await fixture(t), subject = 'auth0|not-yet-mapped';
  assert.equal((await send(f, f.browser(), event(f, subject))).status, 200);
  const browser = f.browser();
  const response = await f.complete(browser, await f.begin(browser, 'email'), { sub: subject, auth_time: Math.floor(Date.now() / 1000) - 300 });
  assert.equal(response.headers.get('location'), '/auth?error=security_changed');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 0);
});

test('a newly linked method must authenticate after the target owner cutoff, not just the unmapped subject cutoff', async t => {
  const f = await fixture(t), owner = await login(f);
  assert.equal((await send(f, f.browser(), event(f, owner.subject, Date.now() - 1500))).status, 200);
  assert.equal((await f.complete(owner.browser, await f.begin(owner.browser, 'email'), { sub: owner.subject })).headers.get('location'), '/account');
  await owner.browser.bootstrap();
  const started = await owner.browser.request('/api/identity/link', { provider: 'google' });
  assert.equal(started.status, 200);
  const authorization: { url: string } = await started.json();
  const response = await f.complete(owner.browser, new URL(authorization.url), { sub: 'google-oauth2|older-new-method', auth_time: Math.floor(Date.now() / 1000) - 3 });
  assert.equal(response.headers.get('location'), '/auth?error=security_changed');
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM managed_identities').get())?.count, 1);
});
test('a password event committed after the callback precheck fences final binding and cannot be rolled back by its rejection', async t => {
  const f = await fixture(t), owner = await login(f), browser = f.browser(), authorization = await f.begin(browser, 'email');
  const barrier = new EventEmitter(), reached = once(barrier, 'reached'), released = once(barrier, 'released');
  const assertProof = f.lifecycle.assertProof.bind(f.lifecycle);
  let checks = 0;
  t.mock.method(f.lifecycle, 'assertProof', async (...args: Parameters<typeof assertProof>) => {
    await assertProof(...args);
    if (++checks === 1) { barrier.emit('reached'); await released; }
  });
  const callback = f.complete(browser, authorization, { sub: owner.subject, auth_time: Math.floor(Date.now() / 1000) - 300 });
  try {
    await Promise.race([reached, callback.then(() => { throw new Error('The callback did not reach its security precheck.'); })]);
    assert.equal((await send(f, f.browser(), event(f, owner.subject))).status, 200);
  } finally { barrier.emit('released'); }
  assert.equal((await callback).headers.get('location'), '/auth?error=security_changed');
  assert.equal((await browser.bootstrap()).user, null);
  assert.equal((await owner.browser.bootstrap()).user, null);
  assert.equal((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner.data.user.id))?.session_epoch, 1);
});

test('real durable reconciliation discovers a missed password reset, revokes sessions and completes a fenced canonical receipt', async t => {
  const f = await fixture(t), owner = await login(f);
  f.setProfile(owner.subject, { updated_at: new Date().toISOString(), last_password_reset: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await f.lifecycle.enqueueSweep(), 1);
  const claim = await f.lifecycle.jobs.claim('identity.reconcile');
  assert.ok(claim);
  await f.lifecycle.runClaim(claim);
  const operation = await f.lifecycle.jobs.operation(claim.data.operationId);
  assert.ok(operation.completedAt);
  assert.equal(operation.receipt?.disabled, 0);
  assert.equal((await owner.browser.bootstrap()).user, null);
  assert.ok(f.managementRequests.every(path => path.includes('include_fields=true') && !path.includes('read%3Auser_idp_tokens')));
  assert.ok(!JSON.stringify(operation.receipt).includes('synthetic-management-token'));
});

test('canonical blocking and deletion revoke authority; stale facts never unblock or resurrect a deleted subject', async t => {
  const f = await fixture(t), owner = await login(f);
  const older = await f.lifecycle.management.facts(owner.subject);
  f.setProfile(owner.subject, { updated_at: new Date().toISOString(), blocked: true });
  await f.lifecycle.observe(await f.lifecycle.management.facts(owner.subject));
  assert.equal((await owner.browser.bootstrap()).user, null);
  assert.equal((await f.db.prepare('SELECT available FROM managed_identities WHERE subject=?').get(owner.subject))?.available, 0);
  const stale = await f.lifecycle.observe(older);
  assert.equal(stale.disabled, 1);
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: owner.subject })).headers.get('location'), '/auth?error=security_changed');
  f.deleteProfile(owner.subject);
  await f.lifecycle.observe(await f.lifecycle.management.facts(owner.subject));
  await delay(10);
  f.setProfile(owner.subject, { updated_at: new Date().toISOString(), blocked: false });
  const observed = await f.lifecycle.observe(await f.lifecycle.management.facts(owner.subject));
  assert.equal(observed.disabled, 2);
  assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: owner.subject })).headers.get('location'), '/auth?error=security_changed');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 1);
});

test('an unmapped blocked subject retains its security cutoff after unblocking and requires a later authentication', async t => {
  const f = await fixture(t), subject = 'auth0|unmapped-blocked';
  f.setProfile(subject, { blocked: true });
  await f.lifecycle.observe(await f.lifecycle.management.facts(subject));
  f.setProfile(subject, { blocked: false, updated_at: new Date(Date.now() + 1).toISOString() });
  await f.lifecycle.observe(await f.lifecycle.management.facts(subject));
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: subject, auth_time: Math.floor(Date.now() / 1000) - 300 })).headers.get('location'), '/auth?error=security_changed');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 0);
});

test('an expired reconciliation claim never publishes contact, availability, epoch or a canonical receipt', async t => {
  const f = await fixture(t), owner = await login(f), boss = await createBoss(f.db);
  await boss.start(); f.cleanup.push(() => boss.stop());
  await boss.updateQueue('identity-reconcile', { expireInSeconds: 1 });
  f.setProfile(owner.subject, { blocked: true });
  await f.lifecycle.enqueueSweep();
  const claim = await f.lifecycle.jobs.claim('identity.reconcile');
  assert.ok(claim);
  assert.equal(claim.expireInSeconds, 1);
  await delay(1100);
  await assert.rejects(f.lifecycle.runClaim(claim), LostJobClaim);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
  assert.equal((await f.db.prepare('SELECT available FROM managed_identities WHERE subject=?').get(owner.subject))?.available, 1);
  assert.equal((await f.lifecycle.jobs.operation(claim.data.operationId)).completedAt, null);
  assert.equal(await f.lifecycle.jobs.fail(claim), true);
  const [retry] = await boss.fetch<ClaimData>(claim.name, { includeMetadata: true, ignoreStartAfter: true });
  assert.ok(retry);
  const observe = f.lifecycle.observe.bind(f.lifecycle);
  let applied = false;
  t.mock.method(f.lifecycle, 'observe', async (...args: Parameters<typeof observe>) => {
    const receipt = await observe(...args);
    applied = true;
    await f.db.prepare('SELECT pg_sleep(?)').get(1.1);
    return receipt;
  });
  await assert.rejects(f.lifecycle.runClaim(retry), LostJobClaim);
  assert.equal(applied, true);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
  assert.equal((await f.db.prepare('SELECT available FROM managed_identities WHERE subject=?').get(owner.subject))?.available, 1);
  assert.equal((await f.db.prepare('SELECT disabled FROM identity_subject_security WHERE subject=?').get(owner.subject))?.disabled, 0);
  assert.equal((await f.lifecycle.jobs.operation(retry.data.operationId)).completedAt, null);
});
test('canonical contact changes remain committed when stale signed login claims are rejected', async t => {
  const f = await fixture(t), owner = await login(f);
  f.setProfile(owner.subject, { updated_at: new Date().toISOString(), email: 'updated@example.invalid' });
  const browser = f.browser();
  const response = await f.complete(browser, await f.begin(browser, 'email'), { sub: owner.subject });
  assert.equal(response.headers.get('location'), '/auth?error=security_changed');
  assert.equal((await owner.browser.bootstrap()).user, null);
  assert.equal((await f.db.prepare('SELECT email FROM managed_identities WHERE subject=?').get(owner.subject))?.email, 'updated@example.invalid');
  assert.equal((await f.db.prepare('SELECT status FROM managed_accounts WHERE user_id=?').get(owner.data.user.id))?.status, 'pending-verification');
});

test('machine scope escalation and provider outages fail closed without invalidating unrelated locally valid sessions', async t => {
  const f = await fixture(t);
  f.managementScope('read:users update:users');
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: 'auth0|scope-denied' })).headers.get('location'), '/auth?error=provider_unavailable');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM users').get())?.count, 0);
  f.managementScope('read:users');
  const owner = await login(f);
  f.unavailable(true);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
  await assert.rejects(f.lifecycle.management.facts(owner.subject), /unavailable/);
  assert.equal((await owner.browser.bootstrap()).user?.id, owner.data.user.id);
});
