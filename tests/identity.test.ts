import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { StateRepository } from '../server/db/state-repository';
import { DurableJobs, migrateJobs, TerminalJobFailure } from '../server/jobs';
import { openIdentityFixture } from './fixtures/identity';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const f = await openIdentityFixture(env);
  t.after(() => f.close());
  return f;
}
async function login(f: Awaited<ReturnType<typeof fixture>>, browser = f.browser(), sub = 'google-oauth2|synthetic-owner', email = 'owner@example.invalid') {
  const response = await f.complete(browser, await f.begin(browser), { sub, email });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/account');
  return { browser, data: await browser.bootstrap(), response };
}

test('managed code flow uses PKCE, verified subject authority, opaque host-only cookies and safe security DTOs', async t => {
  const f = await fixture(t), browser = f.browser(), authorization = await f.begin(browser);
  assert.equal(authorization.searchParams.get('scope'), 'openid profile email');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('connection'), 'google-oauth2');
  assert.equal(authorization.searchParams.get('response_mode'), 'query');
  assert.ok(authorization.searchParams.get('state'));
  assert.ok(authorization.searchParams.get('nonce'));
  const response = await f.complete(browser, authorization);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  for (const value of response.headers.getSetCookie()) {
    assert.match(value, /^__Host-studio_(session|csrf)=/);
    assert.match(value, /HttpOnly/); assert.match(value, /Secure/); assert.match(value, /SameSite=Lax/);
    assert.doesNotMatch(value, /Domain=/);
  }
  const data = await browser.bootstrap();
  assert.equal(data.user?.identity?.status, 'active');
  assert.equal(data.user?.demo, false);
  const rows = await f.db.prepare('SELECT token FROM sessions').all();
  assert.equal(rows[0].token, hash(browser.cookies.get('__Host-studio_session')!));
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM auth_transactions').get())?.count, 0);
  const security = await browser.security();
  assert.equal(security.identities[0].verified, true);
  assert.equal(security.identities[0].current, true);
  assert.equal(typeof security.sessions[0].createdAt, 'number');
  assert.equal(typeof security.sessions[0].lastUsed, 'number');
  assert.doesNotMatch(JSON.stringify({ data, security }), /synthetic-access-token|client_secret|csrf_hash|state_hash|code_verifier|session_epoch/);
  assert.equal((await browser.request('/api/profile', { name: 'Edited display name' }, 'PATCH')).status, 200);
});

test('callbacks are browser-bound, one-use and fenced across independent API replicas', async t => {
  const f = await fixture(t), browser = f.browser(), stranger = f.browser(), two = await f.replica();
  const authorization = await f.begin(browser), callback = f.authorize(authorization.searchParams);
  const denied = await stranger.request(callback.pathname + callback.search);
  assert.equal(denied.headers.get('location'), '/auth?error=restart');
  const replicaBrowser = two.browser();
  replicaBrowser.cookies.set('__Host-studio_auth', browser.cookies.get('__Host-studio_auth')!);
  const responses = await Promise.all([browser.request(callback.pathname + callback.search), replicaBrowser.request(callback.pathname + callback.search)]);
  assert.equal(responses.filter(value => value.headers.get('location') === '/account').length, 1);
  assert.equal(responses.filter(value => value.headers.get('location') === '/auth?error=restart').length, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM managed_identities').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM sessions').get())?.count, 1);
});

test('signed claims reject bad issuer, audience, nonce, lifetime, connection, authentication time, signature and algorithms', async t => {
  const f = await fixture(t);
  const cases = [
    { iss: 'https://wrong.fixture/' }, { aud: 'other-client' }, { nonce: 'wrong-nonce' },
    { exp: Math.floor(Date.now() / 1000) - 60 }, { sub: 'auth0|wrong-connection' },
    { auth_time: Math.floor(Date.now() / 1000) + 60 }, { auth_time: Math.floor(Date.now() / 1000) - 86460 },
    { email_verified: 'true' },
  ];
  for (const overrides of cases) {
    const browser = f.browser(), authorization = await f.begin(browser);
    const response = await f.complete(browser, authorization, overrides);
    assert.equal(response.headers.get('location'), '/auth?error=restart', JSON.stringify(overrides));
  }
  for (const [badSignature, algorithm] of [[true, 'RS256'], [false, 'none'], [false, 'HS256']] as const) {
    const browser = f.browser();
    const response = await f.complete(browser, await f.begin(browser), {}, badSignature, algorithm);
    assert.equal(response.headers.get('location'), '/auth?error=restart');
  }
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM users').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM sessions').get())?.count, 0);
});

test('maintained SDK refreshes signing keys without creating a second account', async t => {
  const f = await fixture(t), one = await login(f);
  f.rotateKey();
  const two = await login(f);
  assert.equal(one.data.user?.id, two.data.user?.id);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM managed_identities').get())?.count, 1);
});

test('concurrent subject creation across replicas creates exactly one owner and one preparation store', async t => {
  const f = await fixture(t), two = await f.replica();
  const browsers = Array.from({ length: 8 }, (_, index) => index % 2 ? two.browser() : f.browser());
  const responses = await Promise.all(browsers.map(async browser => f.complete(browser, await f.begin(browser))));
  assert.ok(responses.every(response => response.headers.get('location') === '/account'));
  const ids = await Promise.all(browsers.map(async browser => (await browser.bootstrap()).user?.id));
  assert.equal(new Set(ids).size, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM users').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM user_settings').get())?.count, 1);
});

test('unverified and private-email identities get minimal access without reserving addresses or acquiring demo authority', async t => {
  const f = await fixture(t, { OPENAI_API_KEY: 'synthetic-ai-key', OPENAI_BASE_URL: 'https://broker.fixture/v1' }), browser = f.browser();
  const response = await f.complete(browser, await f.begin(browser, 'github'), { sub: 'github|private-email-owner', email: undefined, email_verified: undefined });
  assert.equal(response.headers.get('location'), '/account');
  const data = await browser.bootstrap();
  assert.equal(data.user?.email, '');
  assert.equal(data.user?.identity?.status, 'pending-verification');
  assert.deepEqual(data.state.stories, []);
  assert.equal(data.capabilities.ai, false);
  assert.equal(data.capabilities.commerce, 'disabled');
  assert.equal(data.capabilities.community, 'read-only');
  assert.equal((await browser.request('/api/profile', { name: 'Pending member' }, 'PATCH')).status, 200);
  for (const [path, body] of [
    ['/api/plan', { plan: 'lifetime' }], ['/api/gift', { plan: 'year' }], ['/api/auth/demo', {}],
    ['/api/tutor', { question: 'Tell me about retry-safe APIs', context: '' }], ['/api/posts', { title: 'Unverified contribution' }],
  ] as const) assert.ok([403, 404].includes((await browser.request(path, body)).status));
  assert.equal((await browser.request('/api/export')).status, 403);
  const verified = await login(f, f.browser(), 'google-oauth2|verified-owner');
  const unverified = f.browser();
  await f.complete(unverified, await f.begin(unverified), { sub: 'google-oauth2|unverified-owner', email_verified: false });
  assert.notEqual((await unverified.bootstrap()).user?.id, verified.data.user?.id);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM users WHERE email IS NOT NULL').get())?.count, 0);
});

test('managed mutations enforce session-bound CSRF, Origin, cookie uniqueness and legacy-cookie isolation', async t => {
  const f = await fixture(t), { browser, data } = await login(f);
  const before = data.user?.name;
  assert.equal((await browser.request('/api/profile', { name: 'Wrong token' }, 'PATCH', { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await browser.request('/api/profile', { name: 'Multibyte token' }, 'PATCH', { 'X-CSRF-Token': '\u00e9'.repeat(64) })).status, 403);
  assert.equal((await browser.request('/api/profile', { name: 'Wrong origin' }, 'PATCH', { Origin: 'https://attacker.fixture' })).status, 403);
  assert.equal((await browser.request('/api/profile', { name: 'Tossed cookie' }, 'PATCH', { Cookie: '__Host-studio_csrf=' + browser.csrf + '; __Host-studio_csrf=' + browser.csrf })).status, 403);
  assert.equal((await browser.bootstrap()).user?.name, before);
  const legacy = f.browser();
  const raw = randomBytes(32).toString('hex');
  await f.db.prepare('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)').run(hash(raw), data.user!.id, Date.now() + 86400000);
  legacy.cookies.set('studio_session', raw);
  assert.equal((await legacy.bootstrap()).user, null);
  assert.equal((await legacy.request('/api/profile', { name: 'Legacy bypass' }, 'PATCH')).status, 401);
  assert.equal((await browser.request('/api/plan', { plan: 'lifetime' })).status, 404);
  assert.equal((await browser.request('/api/posts', { title: 'Unmoderated post' })).status, 503);
});

test('verified contact linked separately survives later private-email GitHub sign-in', async t => {
  const f = await fixture(t), browser = f.browser();
  await f.complete(browser, await f.begin(browser, 'github'), { sub: 'github|separate-contact-owner', email: undefined, email_verified: undefined });
  const pending = await browser.bootstrap();
  const start = await browser.request('/api/identity/link', { provider: 'google' });
  assert.equal(start.status, 200);
  const activated = await f.complete(browser, new URL((await start.json()).url), { sub: 'google-oauth2|separate-contact-proof', email: 'verified@example.invalid' });
  assert.equal(activated.headers.get('location'), '/account');
  await browser.bootstrap();
  const later = await f.complete(browser, await f.begin(browser, 'github'), { sub: 'github|separate-contact-owner', email: undefined, email_verified: undefined });
  assert.equal(later.headers.get('location'), '/account');
  const data = await browser.bootstrap();
  assert.equal(data.user?.id, pending.user?.id);
  assert.equal(data.user?.email, 'verified@example.invalid');
  assert.equal(data.user?.identity?.status, 'active');
  assert.equal(data.user?.identity?.verified, true);
});

test('idle, absolute, epoch and account-status checks use current database facts on every request', async t => {
  const f = await fixture(t), { browser, data } = await login(f), id = data.user!.id;
  await f.db.prepare('UPDATE managed_sessions SET last_used=?').run(Date.now() - 7 * 86400000 - 1000);
  assert.equal((await browser.bootstrap()).user, null);
  await login(f, browser);
  await f.db.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(Date.now() - 1, id);
  assert.equal((await browser.bootstrap()).user, null);
  await login(f, browser);
  await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(id);
  assert.equal((await browser.bootstrap()).user, null);
  await login(f, browser);
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(id);
  assert.equal((await browser.request('/api/profile', { name: 'Blocked update' }, 'PATCH')).status, 403);
  assert.equal((await browser.request('/api/export')).status, 403);
  const denied = await f.complete(browser, await f.begin(browser));
  assert.equal(denied.headers.get('location'), '/auth?error=security_changed');
  assert.equal((await browser.request('/api/logout', {})).status, 200);
  assert.equal((await browser.bootstrap()).user, null);
});

test('explicit fresh linking preserves owner and work; collisions and removing the last method stop safely', async t => {
  const f = await fixture(t), { browser, data } = await login(f), id = data.user!.id;
  const state = new StateRepository(f.db);
  await state.mutate(id, value => { value.bookmarks.push('system-design/cache'); });
  let security = await browser.security();
  assert.equal((await browser.request(`/api/identity/methods/${security.identities[0].id}`, undefined, 'DELETE')).status, 409);
  const link = await browser.request('/api/identity/link', { provider: 'github' });
  const authorization = new URL((await link.json()).url);
  assert.equal(authorization.searchParams.get('prompt'), 'login');
  assert.equal(authorization.searchParams.get('max_age'), '0');
  const linked = await f.complete(browser, authorization, { sub: 'github|new-method', email: 'alternate@example.invalid' });
  assert.equal(linked.headers.get('location'), '/account');
  assert.equal((await browser.bootstrap()).user?.id, id);
  assert.deepEqual((await state.read(id)).bookmarks, ['system-design/cache']);
  security = await browser.security();
  assert.equal(security.identities.length, 2);
  const old = security.identities.find(value => value.provider === 'google')!;
  assert.equal((await browser.request(`/api/identity/methods/${old.id}`, undefined, 'DELETE')).status, 200);
  assert.equal((await browser.bootstrap()).user?.email, 'alternate@example.invalid');
  assert.equal((await browser.security()).identities.length, 1);
  const other = await login(f, f.browser(), 'google-oauth2|other-user');
  const collision = await browser.request('/api/identity/link', { provider: 'google' });
  const denied = await f.complete(browser, new URL((await collision.json()).url), { sub: 'google-oauth2|other-user' });
  assert.equal(denied.headers.get('location'), '/auth?error=identity_conflict');
  assert.notEqual(other.data.user?.id, id);
  assert.equal((await browser.security()).identities.length, 1);
});

test('security actions require recent authentication and cannot finish after logout or a concurrent epoch revocation', async t => {
  const f = await fixture(t), { browser, data } = await login(f);
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=?').run(Date.now() - 600001);
  assert.equal((await browser.request('/api/identity/link', { provider: 'github' })).status, 403);
  assert.equal((await browser.request('/api/export')).status, 403);
  const start = await browser.request('/api/identity/reauth', { provider: 'google' });
  const authorization = new URL((await start.json()).url);
  const proof = await f.complete(browser, authorization);
  assert.equal(proof.headers.get('location'), '/account');
  await browser.bootstrap();
  assert.equal((await browser.request('/api/export')).status, 200);
  const link = await browser.request('/api/identity/link', { provider: 'github' });
  const stale = new URL((await link.json()).url);
  await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(data.user!.id);
  assert.equal((await f.complete(browser, stale, { sub: 'github|stale-proof' })).headers.get('location'), '/auth?error=restart');
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM managed_identities').get())?.count, 1);
  await login(f, browser);
  const pending = await browser.request('/api/identity/link', { provider: 'github' });
  const afterLogout = new URL((await pending.json()).url);
  await browser.request('/api/logout', {});
  assert.equal((await f.complete(browser, afterLogout, { sub: 'github|after-logout' })).headers.get('location'), '/auth?error=restart');
});

test('session listing and revocation are owner-scoped; logout clears pending browser transactions', async t => {
  const f = await fixture(t), one = await login(f), two = await login(f), stranger = await login(f, f.browser(), 'google-oauth2|stranger');
  const strangerSession = (await stranger.browser.security()).sessions[0].id;
  assert.equal((await one.browser.request(`/api/identity/sessions/${strangerSession}`, undefined, 'DELETE')).status, 404);
  assert.equal((await one.browser.security()).sessions.length, 2);
  assert.equal((await one.browser.request('/api/identity/sessions/revoke-others', {})).status, 200);
  assert.equal((await two.browser.bootstrap()).user, null);
  assert.ok((await stranger.browser.bootstrap()).user);
  await f.begin(one.browser);
  assert.equal((await one.browser.request('/api/logout', {})).status, 200);
  assert.equal(one.browser.cookies.has('__Host-studio_session'), false);
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM auth_transactions').get())?.count, 0);
});

test('signing in rotates only this browser session and outages leave existing locally valid sessions usable', async t => {
  const f = await fixture(t), one = await login(f), other = await login(f);
  const old = one.browser.cookies.get('__Host-studio_session')!;
  await login(f, one.browser);
  assert.notEqual(one.browser.cookies.get('__Host-studio_session'), old);
  assert.equal(await f.db.prepare('SELECT token FROM sessions WHERE token=?').get(hash(old)), undefined);
  assert.equal((await one.browser.security()).sessions.length, 2);
  f.unavailable(true);
  const attempt = await f.begin(one.browser);
  assert.equal((await f.complete(one.browser, attempt)).headers.get('location'), '/auth?error=provider_unavailable');
  assert.ok((await one.browser.bootstrap()).user);
  assert.ok((await other.browser.bootstrap()).user);
});

test('legacy transition requires old credentials plus new verified identity, preserves UUID/work and retires demo authority', async t => {
  const f = await fixture(t, { OIDC_LEGACY_LINK_UNTIL: new Date(Date.now() + 86400000).toISOString() });
  const id = randomUUID(), salt = randomBytes(16).toString('hex'), credential = `${salt}:${scryptSync('synthetic-old-password', salt, 64).toString('hex')}`;
  await f.db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,?,0)').run(id, 'Legacy member', 'legacy@example.invalid', credential);
  const states = new StateRepository(f.db);
  await states.initialize(id);
  await states.mutate(id, value => { value.bookmarks.push('coding/two-pointers'); value.plan = 'lifetime'; });
  const browser = f.browser(); await browser.bootstrap();
  assert.equal((await browser.request('/api/identity/legacy-link', { email: 'legacy@example.invalid', password: 'wrong', provider: 'google' })).status, 401);
  const start = await browser.request('/api/identity/legacy-link', { email: 'legacy@example.invalid', password: 'synthetic-old-password', provider: 'google' });
  assert.equal(start.status, 200);
  const callback = await f.complete(browser, new URL((await start.json()).url));
  assert.equal(callback.headers.get('location'), '/account');
  const data = await browser.bootstrap();
  assert.equal(data.user?.id, id);
  assert.deepEqual(data.state.bookmarks, ['coding/two-pointers']);
  assert.equal(data.state.plan, 'free');
  assert.equal((await f.db.prepare('SELECT password,email FROM users WHERE id=?').get(id))?.password, null);
  assert.equal((await f.db.prepare('SELECT password,email FROM users WHERE id=?').get(id))?.email, null);
});

test('email coincidence never claims a legacy owner and changed legacy credentials cancel an outstanding transition', async t => {
  const f = await fixture(t, { OIDC_LEGACY_LINK_UNTIL: new Date(Date.now() + 86400000).toISOString() });
  const id = randomUUID(), salt = randomBytes(16).toString('hex'), credential = `${salt}:${scryptSync('synthetic-password', salt, 64).toString('hex')}`;
  await f.db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,?,0)').run(id, 'Legacy', 'owner@example.invalid', credential);
  await new StateRepository(f.db).initialize(id);
  const managed = await login(f);
  assert.notEqual(managed.data.user?.id, id);
  assert.equal((await f.db.prepare('SELECT password FROM users WHERE id=?').get(id))?.password, credential);
  const browser = f.browser(); await browser.bootstrap();
  const response = await browser.request('/api/identity/legacy-link', { email: 'owner@example.invalid', password: 'synthetic-password', provider: 'google' });
  assert.equal(response.status, 200);
  await f.db.prepare('UPDATE users SET password=? WHERE id=?').run(`${salt}:${scryptSync('changed-password', salt, 64).toString('hex')}`, id);
  assert.equal((await f.complete(browser, new URL((await response.json()).url), { sub: 'google-oauth2|new-transition-identity' })).headers.get('location'), '/auth?error=security_changed');
  assert.equal((await f.db.prepare('SELECT user_id FROM managed_accounts WHERE user_id=?').get(id)), undefined);
});

test('deleting an owner cascades identities, contact ownership, sessions and browser proofs without leaving login authority', async t => {
  const f = await fixture(t), { browser, data } = await login(f);
  await browser.request('/api/identity/link', { provider: 'github' });
  await f.db.prepare('DELETE FROM users WHERE id=?').run(data.user!.id);
  for (const table of ['managed_accounts', 'managed_identities', 'managed_sessions', 'sessions', 'auth_transactions', 'identity_security_events']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::int AS count FROM ${table}`).get())?.count, 0, table);
  }
  assert.equal((await browser.bootstrap()).user, null);
});

test('expiry, denied consent, unsafe return URLs and initial provider outage are explicit and recoverable', async t => {
  const f = await fixture(t), browser = f.browser();
  assert.equal((await browser.request('/auth/login?provider=google&returnTo=https%3A%2F%2Fevil.fixture')).headers.get('location'), '/auth?error=restart');
  f.unavailable(true);
  assert.equal((await browser.request('/auth/login?provider=google')).headers.get('location'), '/auth?error=provider_unavailable');
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM auth_transactions').get())?.count, 0);
  f.unavailable(false);
  const authorization = await f.begin(browser);
  await f.db.prepare('UPDATE auth_transactions SET expires=?').run(Date.now() - 1);
  assert.equal((await f.complete(browser, authorization)).headers.get('location'), '/auth?error=restart');
  const denied = await f.begin(browser), state = denied.searchParams.get('state');
  assert.equal((await browser.request(`/auth/callback?state=${state}&error=access_denied&error_description=synthetic-private-detail`)).headers.get('location'), '/auth?error=restart');
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM users').get())?.count, 0);
});

test('durable jobs refuse unverified/suspended dispatch and fenced result publication', async t => {
  const f = await fixture(t), { data } = await login(f);
  await migrateJobs(f.db);
  const jobs = await DurableJobs.open(f.db);
  f.cleanup.push(() => jobs.close());
  const request = { principal: { type: 'user' as const, id: data.user!.id }, kind: 'ai.evaluate' as const, key: 'synthetic-operation', resource: 'synthetic-resource', payload: { version: 1 }, retryMode: 'idempotent' as const };
  const operation = await jobs.enqueue(request), claim = await jobs.claim('ai.evaluate');
  assert.ok(claim);
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(data.user!.id);
  await assert.rejects(jobs.enqueue({ ...request, key: 'another-operation' }), error => error instanceof Error && error.message.includes('active'));
  let mutated = false;
  await assert.rejects(jobs.finish(claim, async () => { mutated = true; return { complete: true }; }), error => error instanceof TerminalJobFailure && error.code === 'not-eligible');
  assert.equal(mutated, false);
  assert.equal((await jobs.operation(operation.id)).completedAt, null);
});
