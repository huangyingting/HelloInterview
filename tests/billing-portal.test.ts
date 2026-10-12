import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { openBillingFixture, sandboxPortalConfiguration, sandboxSettings } from './fixtures/billing';
import { BillingNotifications } from '../server/billing';
import { hostedPortalUrl, portalAuthority } from '../server/billing/portal-schema';
import { sandboxServicePolicy } from '../shared/billing-ledger';
import { problems } from '../shared/catalog';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture(t: TestContext, overrides: NodeJS.ProcessEnv = {}) {
  const f = await openBillingFixture(t, { STRIPE_TEST_PORTAL_CONFIGURATION: sandboxPortalConfiguration, ...overrides });
  const { browser, owner } = await f.login(), attempt = await f.reserve(browser);
  await f.complete('billing.customer'); f.requests.splice(0);
  return { ...f, browser, owner, attempt };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const endpoint = '/api/billing/portal';
const portalPath = '/v1/billing_portal/sessions';
function posts(f: Fixture) { return f.requests.filter(request => request.method === 'POST' && request.path === portalPath); }
function replace(target: Record<string, unknown>, value: Record<string, unknown>) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(value));
}
async function audit(f: Fixture) { return f.db.prepare('SELECT * FROM stripe_portal_access ORDER BY created_at,id').all(); }
async function open(f: Fixture) {
  const response = await f.browser.request(endpoint, {});
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body: { url: string } = await response.json();
  assert.deepEqual(Object.keys(body), ['url']); hostedPortalUrl(body.url);
  return body;
}

test('Portal is default-off and accepts neither default configuration nor caller-owned scope', async t => {
  const f = await fixture(t, { STRIPE_TEST_PORTAL_CONFIGURATION: undefined });
  assert.equal((await f.view(f.browser)).portalEnabled, false);
  assert.equal((await f.browser.request(endpoint, {})).status, 503);
  assert.equal(f.requests.length, 0); assert.deepEqual(await audit(f), []);
  assert.equal((await f.browser.request(endpoint, { configuration: sandboxPortalConfiguration })).status, 400);
});

test('fresh verified admission is owned, strict and CSRF protected before any Portal preparation', async t => {
  const f = await fixture(t);
  assert.equal((await f.browser.request(endpoint, {}, 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const input of [{ customer: [...f.customers.keys()][0] }, { configuration: sandboxPortalConfiguration },
    { return_url: 'https://foreign.fixture' }, { on_behalf_of: 'acct_Foreign' }, { flow_data: {} }, { id: randomUUID() }]) {
    assert.equal((await f.browser.request(endpoint, input)).status, 400);
  }
  const stranger = await f.login(undefined, 'auth0|portal-unmapped-stranger');
  assert.equal((await stranger.browser.request(endpoint, {})).status, 409);
  f.setClaims({ email_verified: false });
  const unverified = await f.login(undefined, 'auth0|portal-unverified');
  assert.equal((await unverified.browser.request(endpoint, {})).status, 403); f.setClaims({});
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
  assert.equal((await f.browser.request(endpoint, {})).status, 403);
  assert.equal(f.requests.length, 0); assert.deepEqual(await audit(f), []);
});

test('restricted session creation is eight bounded official SDK calls, independently audited and secret-free in storage and owned views', async t => {
  const f = await fixture(t), before = await f.browser.bootstrap(), result = await open(f);
  const rows = await audit(f); assert.equal(rows.length, 1);
  assert.equal(rows[0].policy_version, portalAuthority); assert.equal(rows[0].state, 'issued');
  assert.equal(rows[0].provider_session_id, [...f.portals.keys()][0]); assert.ok(rows[0].issued_at instanceof Date);
  assert.match(String(rows[0].policy_proof), /^[a-f0-9]{64}$/);
  assert.equal(f.requests.length, 8);
  assert.deepEqual(posts(f).map(request => ({ key: request.key, body: request.body })), [{
    key: rows[0].id, body: { customer: [...f.customers.keys()][0], configuration: sandboxPortalConfiguration,
      return_url: `${f.origin}/billing?portal=returned` },
  }]);
  assert.ok(f.requests.every(request => request.version === '2026-09-30.endive'));
  const serialized = JSON.stringify({ audit: rows, view: await f.view(f.browser), state: (await f.browser.bootstrap()).state });
  for (const secret of [result.url, 'test_SyntheticRestricted', 'private-fixture-contact', 'client_secret']) assert.ok(!serialized.includes(secret));
  const after = await f.browser.bootstrap();
  assert.ok(after.capabilities.access); assert.ok(before.capabilities.access);
  assert.deepEqual({ ...after.capabilities.access, serverTime: before.capabilities.access.serverTime }, before.capabilities.access);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.capabilities.commerce, 'disabled');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
});

test('replica requests create separate bounded fresh Portal sessions without replacing customers or financial intents', async t => {
  const f = await fixture(t), replica = await f.replica(), browser = replica.browser();
  for (const [key, value] of f.browser.cookies) browser.cookies.set(key, value);
  await browser.bootstrap();
  const responses = await Promise.all([f.browser.request(endpoint, {}), browser.request(endpoint, {})]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const rows = await audit(f); assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, 2); assert.equal(new Set(rows.map(row => row.provider_session_id)).size, 2);
  assert.equal(posts(f).length, 2); assert.equal(f.customers.size, 1); assert.equal(f.portals.size, 2);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 1);
  assert.equal((await f.db.prepare("SELECT attempts FROM identity_abuse_buckets WHERE scope='billing'").get())?.attempts, 3,
    'One shared admission per logical opening, not one per SQL recheck.');
});

test('withdrawing new offers does not withdraw restricted management of an existing owned customer', async t => {
  const f = await fixture(t); assert.ok(f.config.billing);
  const shutdown = new AbortController(), changed = await BillingNotifications.open(f.db, { ...f.config.billing, offers: null }, shutdown.signal, false, f.client, f.origin);
  f.cleanup.push(async () => { shutdown.abort(); await changed.close(); }); assert.ok(changed.portal); assert.ok(changed.checkout);
  const portal = changed.portal, scope = await f.db.transaction(() => portal.prepare(f.owner));
  const result = await changed.provider.portalSession(scope, () => f.db.transaction(async () => { await portal.guard(scope, f.owner); }));
  await f.db.transaction(() => portal.complete(scope, f.owner, result));
  const view = await changed.checkout.view(f.owner);
  assert.equal(view.enabled, false); assert.equal(view.portalEnabled, true);
  assert.equal((await audit(f))[0].state, 'issued'); assert.equal(f.customers.size, 1);
});

test('live, Connect, inactive, email-login, customer-change and subscription policies fail before session creation', async t => {
  const f = await fixture(t), original = structuredClone(f.portalConfiguration), features = original.features;
  const invalid = [
    { ...original, id: 'bpc_Foreign' }, { ...original, livemode: true }, { ...original, active: false },
    { ...original, application: 'ca_Connect' }, { ...original, application: undefined },
    { ...original, login_page: { enabled: true, url: 'https://billing.stripe.com/p/login/foreign' } },
    { ...original, login_page: { enabled: false, url: 'https://billing.stripe.com/p/login/foreign' } },
    { ...original, features: { ...features, customer_update: { enabled: true, allowed_updates: ['email'] } } },
    { ...original, features: { ...features, customer_update: { enabled: false, allowed_updates: ['email'] } } },
    { ...original, features: { ...features, subscription_cancel: { enabled: true } } },
    { ...original, features: { ...features, subscription_update: { enabled: true } } },
    { ...original, features: { ...features, invoice_history: { enabled: false } } },
    { ...original, features: { ...features, payment_method_update: { enabled: false, payment_method_configuration: null } } },
    { ...original, features: { ...features, payment_method_update: { enabled: true, payment_method_configuration: null } } },
    { ...original, features: { ...features, unknown_future_feature: { enabled: true } } },
  ];
  for (const value of invalid) {
    replace(f.portalConfiguration, value);
    assert.equal((await f.browser.request(endpoint, {})).status, 500);
  }
  assert.equal(posts(f).length, 0); assert.ok((await audit(f)).every(row => row.state === 'requested'));
});

test('explicit card-only policy rejects live/Connect parents, unavailable cards, wallets, other rails and unknown shapes', async t => {
  const f = await fixture(t), original = structuredClone(f.cardConfiguration);
  const invalid = [
    { ...original, id: 'pmc_Foreign' }, { ...original, livemode: true }, { ...original, active: false },
    { ...original, application: 'ca_Connect' }, { ...original, parent: 'pmc_Parent' }, { ...original, parent: undefined },
    { ...original, card: null }, { ...original, card: { available: false, display_preference: { value: 'on' } } },
    { ...original, card: { available: true, display_preference: { value: 'off' } } },
    { ...original, apple_pay: { available: true, display_preference: { value: 'on' } } },
    { ...original, google_pay: { available: true, display_preference: { value: 'on' } } },
    { ...original, us_bank_account: { available: false, display_preference: { value: 'on' } } },
    { ...original, future_rail: { available: true, display_preference: { value: 'on' } } },
    { ...original, future_rail: { available: false, display_preference: { value: 'future' } } },
    { ...original, unknown_setting: true },
  ];
  for (const value of invalid) {
    replace(f.cardConfiguration, value);
    assert.equal((await f.browser.request(endpoint, {})).status, 500);
  }
  assert.equal(posts(f).length, 0); assert.ok((await audit(f)).every(row => row.state === 'requested'));
});

test('wrong provider account, foreign/live/deleted customer and missing ownership metadata never authorize a hosted link', async t => {
  const f = await fixture(t), customer = [...f.customers.values()][0], original = structuredClone(customer);
  f.account('acct_Foreign'); assert.equal((await f.browser.request(endpoint, {})).status, 500); f.account(sandboxSettings.STRIPE_TEST_ACCOUNT_ID);
  for (const change of [{ id: 'cus_Foreign' }, { livemode: true }, { deleted: true }, { metadata: { studio_customer_ref: randomUUID() } }]) {
    replace(customer, { ...original, ...change }); assert.equal((await f.browser.request(endpoint, {})).status, 500);
  }
  assert.equal(posts(f).length, 0); assert.ok((await audit(f)).every(row => row.state === 'requested'));
});

test('unsupported hosted session scope, flow, mode and destination fail without retaining or returning its bearer URL', async t => {
  const f = await fixture(t);
  const invalid = [
    { customer: 'cus_Foreign' }, { customer_account: 'cusacct_Foreign' }, { configuration: 'bpc_Foreign' },
    { livemode: true }, { on_behalf_of: 'acct_Foreign' }, { flow: { type: 'subscription_update' } },
    { return_url: 'https://foreign.fixture' }, { id: 'cs_test_NotPortal' }, { created: Math.floor(Date.now() / 1000) - 120 },
    { url: 'https://billing.stripe.com/p/session?secret=live_Foreign' },
    { url: 'https://billing.stripe.com/p/session/test_SyntheticRestricted' },
    { url: 'https://foreign.fixture/p/session?secret=test_SyntheticRestricted' },
    { url: 'https://billing.stripe.com/p/session?secret=test_SyntheticRestricted&customer=cus_Foreign' },
    { url: 'https://billing.stripe.com/p/session?secret=test_SyntheticRestricted#secret' },
  ];
  for (const value of invalid) {
    f.portalResponse(value); const response = await f.browser.request(endpoint, {});
    assert.ok([409, 500].includes(response.status)); assert.ok(!(await response.text()).includes('test_SyntheticRestricted'));
  }
  assert.equal(posts(f).length, invalid.length);
  const serialized = JSON.stringify(await audit(f)); assert.ok(!serialized.includes('test_SyntheticRestricted'));
  assert.ok((await audit(f)).every(row => row.state === 'requested'));
});

test('policy or provider customer movement during issuance withholds the URL and leaves truthful unknown preparation history', async t => {
  for (const change of ['plan', 'method-reference', 'method-shape', 'customer'] as const) {
    const f = await fixture(t);
    f.barrier(async (path, method) => {
      if (path !== portalPath || method !== 'POST') return;
      if (change === 'plan') f.portalConfiguration.features.subscription_update.enabled = true;
      if (change === 'method-reference') f.portalConfiguration.features.payment_method_update.payment_method_configuration = 'pmc_Foreign';
      if (change === 'method-shape') f.cardConfiguration.future_disabled_rail = { available: false, display_preference: { value: 'off' } };
      if (change === 'customer') Object.assign([...f.customers.values()][0], { deleted: true });
    });
    const response = await f.browser.request(endpoint, {}); assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('test_SyntheticRestricted'));
    assert.equal(posts(f).length, 1); assert.equal(f.portals.size, 1); assert.equal((await audit(f))[0].state, 'requested');
  }
});

test('SDK I/O does not hold SQL owner locks; epoch movement before POST fences provider creation', async t => {
  const f = await fixture(t);
  f.barrier(async path => {
    if (!path.startsWith('/v1/payment_method_configurations/')) return;
    f.barrier();
    await f.db.transaction(async () => {
      await f.db.executeSql("SET LOCAL statement_timeout='500ms'");
      await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
    });
  });
  const response = await f.browser.request(endpoint, {}); assert.equal(response.status, 401);
  assert.equal(posts(f).length, 0); assert.equal((await audit(f))[0].state, 'requested');
});

test('fresh authentication is rechecked after the final pre-POST SQL guard, not merely before it', async t => {
  const f = await fixture(t); assert.ok(f.billing?.portal);
  const portal = f.billing.portal, original = portal.guard.bind(portal);
  portal.guard = async (...args) => {
    const now = await original(...args);
    await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
    return now;
  };
  assert.equal((await f.browser.request(endpoint, {})).status, 403);
  assert.equal(posts(f).length, 0); assert.equal((await audit(f))[0].state, 'requested');
});

test('local mapping, security, session and deletion changes after provider creation fence final URL publication', async t => {
  for (const change of ['mapping', 'epoch', 'freshness', 'session', 'deletion'] as const) {
    const f = await fixture(t);
    f.barrier(async (path, method) => {
      if (path !== portalPath || method !== 'POST') return;
      f.barrier();
      if (change === 'mapping') await f.db.prepare("UPDATE stripe_owned_customers SET customer_id='cus_Moved' WHERE user_id=?").run(f.owner);
      if (change === 'epoch') await f.db.prepare('UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=?').run(f.owner);
      if (change === 'freshness') await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
      if (change === 'session') await f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.owner);
      if (change === 'deletion') await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
    });
    const response = await f.browser.request(endpoint, {}); assert.ok([401, 403].includes(response.status), await response.clone().text());
    assert.equal(posts(f).length, 1); assert.equal(f.portals.size, 1); assert.equal((await audit(f))[0].state, 'requested');
    assert.ok(!(await response.text()).includes('test_SyntheticRestricted'));
  }
});

test('actual initial SQL security rollback and final SQL failure never publish or persist a success-shaped link', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE portal_prepare_witness;
    CREATE FUNCTION invalidate_portal_prepare() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('portal_prepare_witness');
      UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=NEW.user_id; RETURN NEW; END $body$;
    CREATE TRIGGER invalidate_portal_prepare AFTER INSERT ON stripe_portal_access FOR EACH ROW EXECUTE FUNCTION invalidate_portal_prepare();`);
  assert.equal((await f.browser.request(endpoint, {})).status, 403);
  assert.equal((await f.db.prepare('SELECT last_value,is_called FROM portal_prepare_witness').get())?.is_called, true);
  assert.equal(f.requests.length, 0); assert.deepEqual(await audit(f), []);
  await f.db.executeSql(`DROP TRIGGER invalidate_portal_prepare ON stripe_portal_access;
    CREATE SEQUENCE portal_publish_witness;
    CREATE FUNCTION fail_portal_publish() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('portal_publish_witness'); RAISE EXCEPTION 'synthetic Portal publication loss'; END $body$;
    CREATE TRIGGER fail_portal_publish BEFORE UPDATE ON stripe_portal_access FOR EACH ROW EXECUTE FUNCTION fail_portal_publish();`);
  const failed = await f.browser.request(endpoint, {}); assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes('test_SyntheticRestricted'));
  assert.equal((await f.db.prepare('SELECT is_called FROM portal_publish_witness').get())?.is_called, true);
  assert.equal(f.portals.size, 1); assert.equal((await audit(f))[0].state, 'requested');
  await f.db.executeSql('DROP TRIGGER fail_portal_publish ON stripe_portal_access');
  await open(f);
  const rows = await audit(f); assert.deepEqual(rows.map(row => row.state), ['requested', 'issued']);
  assert.equal(f.portals.size, 2); assert.notEqual(posts(f)[0].key, posts(f)[1].key,
    'A new deliberate opening does not pretend the original secret can be retrieved.');
});

test('security changes in actual final SQL roll back issuance while retaining external unknown outcome', async t => {
  const f = await fixture(t);
  await f.db.executeSql(`CREATE SEQUENCE portal_security_witness;
    CREATE FUNCTION invalidate_portal_publish() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('portal_security_witness');
      UPDATE managed_accounts SET session_epoch=session_epoch+1 WHERE user_id=NEW.user_id; RETURN NEW; END $body$;
    CREATE TRIGGER invalidate_portal_publish AFTER UPDATE ON stripe_portal_access FOR EACH ROW EXECUTE FUNCTION invalidate_portal_publish();`);
  assert.equal((await f.browser.request(endpoint, {})).status, 403);
  assert.equal((await f.db.prepare('SELECT is_called FROM portal_security_witness').get())?.is_called, true);
  assert.equal((await audit(f))[0].state, 'requested'); assert.equal(f.portals.size, 1);
});

test('database preparation age is bounded independently of provider URL expiry and never reset for an issued secret', async t => {
  const f = await fixture(t); assert.ok(f.billing?.portal);
  const portal = f.billing.portal, scope = await f.db.transaction(() => portal.prepare(f.owner));
  const old = new Date(Date.now() - 60001);
  await f.db.prepare('UPDATE stripe_portal_access SET created_at=? WHERE id=?').run(old.toISOString(), scope.id);
  await assert.rejects(f.db.transaction(() => portal.guard({ ...scope, createdAt: old }, f.owner)), /preparation expired/);
  const future = new Date(Date.now() + 60000);
  await f.db.prepare('UPDATE stripe_portal_access SET created_at=? WHERE id=?').run(future.toISOString(), scope.id);
  await assert.rejects(f.db.transaction(() => portal.guard({ ...scope, createdAt: future }, f.owner)), /preparation expired/);
  assert.equal(posts(f).length, 0);
});

test('provider outages and aborts do not return an earlier hosted URL or claim the session was revoked', async t => {
  const f = await fixture(t);
  f.outage('/v1/billing_portal/configurations/' + sandboxPortalConfiguration);
  assert.equal((await f.browser.request(endpoint, {})).status, 500); assert.equal(posts(f).length, 0);
  f.outage(''); await open(f);
  f.outage('/v1/billing_portal/configurations/' + sandboxPortalConfiguration);
  assert.equal((await f.browser.request(endpoint, {})).status, 500); assert.equal(posts(f).length, 1);
  assert.equal(f.portals.size, 1); assert.deepEqual((await audit(f)).map(row => row.state), ['requested', 'issued', 'requested']);
  f.outage(''); assert.ok(f.billing?.portal);
  const portal = f.billing.portal, scope = await f.db.transaction(() => portal.prepare(f.owner));
  const signal = AbortSignal.abort();
  await assert.rejects(f.billing.provider.portalSession(scope, async () => { throw new Error('An aborted adapter cannot reach its write guard.'); }, signal), { name: 'AbortError' });
  assert.equal(posts(f).length, 1);
});

test('Portal issuance cannot alter paid source, audit, renewal, funds or retained premium mock history', async t => {
  const f = await fixture(t, { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy });
  await f.complete('billing.checkout');
  const facts = await f.settleCheckout();
  assert.equal((await f.browser.request(`/api/billing/checkouts/${f.attempt.id}/refresh`, {})).status, 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  const grants = await f.db.prepare('SELECT * FROM entitlement_grants').all(), events = await f.db.prepare('SELECT * FROM entitlement_events').all();
  const money = structuredClone(facts), problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await f.browser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const archive = (await f.browser.bootstrap()).state.mocks;
  await open(f);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants').all(), grants);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_events').all(), events);
  assert.deepEqual(facts, money); assert.equal(facts.sub.cancel_at_period_end, false);
  assert.deepEqual((await f.browser.bootstrap()).state.mocks, archive);
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'pro');
  assert.equal((await f.browser.request(`/api/content/problems/${problem.id}`)).status, 200);
});

test('shared opening limits apply across replicas before SDK preparation and never return cached secret URLs', async t => {
  const f = await fixture(t);
  await f.db.prepare("UPDATE identity_abuse_buckets SET attempts=30 WHERE scope='billing'").run();
  const response = await f.browser.request(endpoint, {}); assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0); assert.equal(f.requests.length, 0); assert.deepEqual(await audit(f), []);
});

test('an abort after actual issuance COMMIT withholds URL delivery without falsely rolling back or revoking the provider session', { timeout: 50000 }, async t => {
  const f = await fixture(t), transaction = f.db.transaction.bind(f.db);
  let delayed = false;
  f.db.transaction = async operation => {
    const result = await transaction(operation);
    if (!delayed && posts(f).length && (await f.db.prepare("SELECT 1 AS issued FROM stripe_portal_access WHERE state='issued'").get())) {
      delayed = true; await delay(31000);
    }
    return result;
  };
  const response = await f.browser.request(endpoint, {});
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('test_SyntheticRestricted'));
  assert.equal(delayed, true); assert.equal((await audit(f))[0].state, 'issued'); assert.equal(f.portals.size, 1);
});

test('provider response secrets and contacts are omitted from actual request/error telemetry on withheld issuance', async t => {
  const originalError = console.error, originalLog = console.log, messages: string[] = [];
  console.error = (...args: unknown[]) => { messages.push(args.join(' ')); };
  console.log = (...args: unknown[]) => { messages.push(args.join(' ')); };
  t.after(() => { console.error = originalError; console.log = originalLog; });
  const f = await fixture(t, { LOG_REQUESTS: 'true' });
  f.portalResponse({ customer: 'cus_Foreign', private_contact: 'private-portal-contact@example.invalid' });
  const response = await f.browser.request(endpoint, {}); assert.equal(response.status, 500);
  assert.ok(messages.some(message => message.includes('request.failed')));
  assert.ok(messages.some(message => message.includes('request.completed')));
  for (const secret of ['test_SyntheticRestricted', 'private-portal-contact', 'cus_Foreign', 'cus_Synthetic', 'bpc_SyntheticRestricted']) {
    assert.ok(!messages.join('\n').includes(secret)); assert.ok(!(await response.clone().text()).includes(secret));
  }
});

test('compiled production entry serves the fresh managed default-off Portal boundary without development loaders or provider I/O', async t => {
  const f = await fixture(t), databaseUrl = f.config.databaseUrl; assert.ok(databaseUrl);
  const child = spawn(process.execPath, ['dist-server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0',
      DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: f.origin, COOKIE_SECURE: 'true', TRUST_PROXY: '127.0.0.1/32',
      LOG_REQUESTS: 'false', OIDC_ISSUER: f.issuer, OIDC_CLIENT_ID: 'synthetic-client',
      OIDC_CLIENT_SECRET: 'synthetic-client-secret', ...sandboxSettings },
  });
  const exited = once(child, 'exit');
  f.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
  });
  let stdout = '', stderr = '';
  child.stderr.on('data', value => { stderr += String(value); });
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Compiled Portal entry did not start: ${stderr}`)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Compiled Portal entry exited (${code}): ${stderr}`)); });
    child.stdout.on('data', value => {
      stdout += String(value); const address = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { clearTimeout(timer); resolve(address); }
    });
  });
  assert.equal((await fetch(`${address}/api/ready`)).status, 200); f.proxyTo(address);
  assert.equal((await f.view(f.browser)).portalEnabled, false);
  assert.equal((await f.browser.request(endpoint, {})).status, 503);
  assert.deepEqual(await audit(f), []); assert.equal(f.requests.length, 0);
});
