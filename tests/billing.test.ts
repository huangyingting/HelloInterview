import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { fixtureFetch, openIdentityFixture } from './fixtures/identity';
import { authJsEnvironment } from './fixtures/billing';
import { BillingNotifications, assertBillingConfiguration } from '../server/billing';
import { stripeApiVersion, notification } from '../server/billing/schema';
import { LostJobClaim } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { createApplication } from '../server/application';
import { handleError } from '../server/app';

const settings = {
  STRIPE_TEST_ACCOUNT_ID: 'acct_SyntheticBillingFixture',
  STRIPE_TEST_SECRET_KEY: 'rk_test_SyntheticBillingFixtureOnly',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SyntheticBillingFixtureOnly',
};
function message(id = 'evt_SyntheticInvoice', type = 'invoice.paid', kind = 'invoice', objectId = 'in_SyntheticInvoice') {
  return { id, object: 'event', type, api_version: stripeApiVersion, livemode: false, created: Math.floor(Date.now() / 1000),
    data: { object: { id: objectId, object: kind, customer: 'cus_SyntheticBillingFixture', livemode: false,
      status: 'paid', currency: 'usd', amount_paid: 1900,
      customer_email: 'private-fixture@example.invalid', metadata: { user_id: 'not-owner-authority' } } } };
}
type Message = ReturnType<typeof message>;
async function fixture(t: TestContext) {
  const f = await openIdentityFixture(settings);
  t.after(f.close);
  assert.ok(f.billing); assert.ok(f.config.billing);
  const events = new Map<string, unknown>(), objects = new Map<string, unknown>();
  const requests: { method: string; path: string; version: string | undefined; authorization: string | undefined }[] = [];
  let accountId = settings.STRIPE_TEST_ACCOUNT_ID, failPath = '', barrier: (() => Promise<void>) | undefined;
  const app = express();
  app.all('/{*path}', async (req, res) => {
    requests.push({ method: req.method, path: req.path, version: req.get('Stripe-Version'), authorization: req.get('Authorization') });
    if (req.path === failPath) return res.status(503).json({ error: { type: 'api_error', message: 'Synthetic read-only provider outage.' } });
    if (req.path === '/v1/account') return res.json({ id: accountId, object: 'account' });
    if (req.path.startsWith('/v1/events/')) return res.json(events.get(req.path.slice('/v1/events/'.length)));
    if (barrier) await barrier();
    const value = objects.get(req.path);
    if (!value) return res.status(404).json({ error: { type: 'invalid_request_error', message: 'Synthetic canonical object missing.' } });
    res.json(value);
  });
  const server = createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new Stripe(settings.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: address.port, protocol: 'http',
    apiVersion: stripeApiVersion, maxNetworkRetries: 0, timeout: 1000 });
  const shutdown = new AbortController();
  const worker = await BillingNotifications.open(f.db, f.config.billing, shutdown.signal, true, client);
  f.cleanup.push(async () => {
    shutdown.abort();
    try { await worker.close(); } finally {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed;
    }
  });
  return { ...f, billing: f.billing, worker, client, events, objects, requests, port: address.port,
    account(value: string) { accountId = value; }, outage(path: string) { failPath = path; },
    barrier(value?: () => Promise<void>) { barrier = value; },
    async send(event: unknown, browser = f.browser(), options: { raw?: string; timestamp?: number; signature?: string; headers?: Record<string, string> } = {}) {
      const body = options.raw ?? JSON.stringify(event);
      const signature = options.signature ?? client.webhooks.generateTestHeaderString({
        payload: body, secret: settings.STRIPE_TEST_WEBHOOK_SECRET, timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
      });
      return fixtureFetch(`${browser.address}/api/webhooks/stripe`, { method: 'POST', body, ca: browser.ca,
        headers: { Host: browser.host, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', 'Stripe-Signature': signature, ...options.headers } });
    },
    seed(event: Message, value: unknown = event.data.object) {
      events.set(event.id, event);
      const paths: Record<string, string> = { invoice: 'invoices', subscription: 'subscriptions', 'checkout.session': 'checkout/sessions', charge: 'charges', refund: 'refunds', dispute: 'disputes' };
      objects.set(`/v1/${paths[event.data.object.object]}/${event.data.object.id}`, value);
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function count(f: Fixture, table: string) {
  assert.ok(['stripe_event_notifications', 'verified_event_inbox', 'durable_operations', 'entitlement_grants', 'entitlement_revocations'].includes(table));
  return (await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count;
}
async function complete(f: Fixture) {
  const claim = await f.worker.jobs.claim('billing.reconcile');
  assert.ok(claim);
  await f.worker.runClaim(claim);
  return f.worker.jobs.operation(claim.data.operationId);
}

test('official raw-byte signatures and replica replay create one durable minimized inbox/outbox before acknowledgement, without browser CSRF', async t => {
  const f = await fixture(t), replica = await f.replica(), event = message();
  const responses = await Promise.all([f.send(event), f.send(event, replica.browser())]);
  assert.ok(responses.every(response => response.status === 200));
  const accepted: { duplicate: boolean }[] = await Promise.all(responses.map(response => response.json()));
  assert.equal(accepted.filter(value => !value.duplicate).length, 1);
  assert.deepEqual(await (await f.send(event, f.browser(), { raw: ` \n${JSON.stringify(event)}\n` })).json(), { accepted: true, duplicate: true });
  assert.equal(await count(f, 'stripe_event_notifications'), 1);
  assert.equal(await count(f, 'verified_event_inbox'), 1);
  assert.equal(await count(f, 'durable_operations'), 1);
  assert.equal(await count(f, 'entitlement_grants'), 0);
  assert.equal(f.requests.length, 0);
  const stored = JSON.stringify(await f.db.prepare('SELECT * FROM verified_event_inbox').all());
  assert.ok(!stored.includes('private-fixture@example.invalid'));
  assert.ok(!stored.includes('not-owner-authority'));
  assert.equal((await f.browser().request('/api/profile', { name: 'Not a webhook' }, 'PATCH')).status, 403);
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: 'auth0|billing-fixture-owner' })).headers.get('location'), '/account');
  const bootstrap = await browser.bootstrap();
  assert.equal(bootstrap.capabilities.commerce, 'disabled');
  assert.equal(bootstrap.capabilities.access?.state, 'free');
});

test('mutated, unsigned, stale/future, compressed, oversized, foreign-mode/account/context/API and wrong-family payloads cannot create billing evidence', async t => {
  const f = await fixture(t), event = message(), body = JSON.stringify(event);
  const signature = f.client.webhooks.generateTestHeaderString({ payload: body, secret: settings.STRIPE_TEST_WEBHOOK_SECRET });
  assert.equal((await f.send(event, undefined, { raw: ` ${body}`, signature })).status, 403);
  assert.equal((await f.send(event, undefined, { signature: 't=1,v1=bad' })).status, 403);
  for (const offset of [-600, 600]) assert.equal((await f.send(event, undefined, { timestamp: Math.floor(Date.now() / 1000) + offset })).status, 403);
  assert.equal((await f.send(event, undefined, { signature: `t=${Math.floor(Date.now() / 1000)},${signature}` })).status, 403);
  assert.equal((await f.send(event, undefined, { headers: { 'Content-Encoding': 'gzip' } })).status, 415);
  assert.equal((await f.send(event, undefined, { raw: 'x'.repeat(262145) })).status, 413);
  assert.equal((await f.send(event, undefined, { raw: '{' })).status, 400);
  for (const changed of [
    { ...event, livemode: true }, { ...event, account: settings.STRIPE_TEST_ACCOUNT_ID },
    { ...event, context: 'acct_OrganizationFixture' }, { ...event, api_version: '2020-08-27' },
    { ...event, data: { object: { ...event.data.object, object: 'charge' } } },
  ]) assert.equal((await f.send(changed)).status, 400);
  let nested: unknown = {};
  for (let index = 0; index < 30; index++) nested = { child: nested };
  assert.equal((await f.send({ ...event, data: { object: { ...event.data.object, nested } } })).status, 400);
  assert.equal((await f.send({ ...event, data: { object: JSON.parse(`{"id":"in_SyntheticInvoice","object":"invoice","__proto__":{"polluted":true}}`) } })).status, 400);
  assert.equal(await count(f, 'stripe_event_notifications'), 0);
  assert.equal(await count(f, 'durable_operations'), 0);
  assert.equal(f.requests.length, 0);
});

test('same-event changed evidence conflicts; an actual SQL failure rolls back notification, inbox and queued operation before non-2xx delivery', async t => {
  const f = await fixture(t), event = message();
  assert.equal((await f.send(event)).status, 200);
  assert.equal((await f.send({ ...event, data: { object: { ...event.data.object, amount_paid: 1 } } })).status, 409);
  await f.db.executeSql(`CREATE FUNCTION fail_billing_notification() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN RAISE EXCEPTION 'synthetic billing rollback'; END $body$;
    CREATE TRIGGER fail_billing_notification BEFORE INSERT ON stripe_event_notifications FOR EACH ROW EXECUTE FUNCTION fail_billing_notification();`);
  assert.equal((await f.send(message('evt_SyntheticRollback'))).status, 500);
  assert.equal(await count(f, 'stripe_event_notifications'), 1);
  assert.equal(await count(f, 'verified_event_inbox'), 1);
  assert.equal(await count(f, 'durable_operations'), 1);
  assert.ok(await f.worker.jobs.claim('billing.reconcile'));
  assert.equal(await f.worker.jobs.claim('billing.reconcile'), undefined);
});

test('canonical current invoice facts, not signed event status or email/metadata, publish atomically through the maintained claim without issuing paid access', async t => {
  const f = await fixture(t), event = message();
  f.seed(event, { ...event.data.object, status: 'void', amount_paid: 0,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_SyntheticCanonical' } } });
  assert.equal((await f.send(event)).status, 200);
  const operation = await complete(f);
  assert.deepEqual(operation.receipt, { authority: 'notification-evidence-only', eventId: event.id, state: 'observed' });
  const row = await f.db.prepare('SELECT state,observation,observed_at FROM stripe_event_notifications').get();
  assert.equal(row?.state, 'observed'); assert.ok(row?.observed_at instanceof Date);
  const observed = JSON.parse(String(row?.observation));
  assert.equal(observed.status, 'void'); assert.equal(observed.paid, false); assert.equal(observed.amount, 0);
  assert.equal(observed.subscriptionId, 'sub_SyntheticCanonical');
  assert.ok(!JSON.stringify(observed).includes('private-fixture'));
  assert.equal(await count(f, 'entitlement_grants'), 0);
  assert.equal(await count(f, 'entitlement_revocations'), 0);
  assert.deepEqual(f.requests.map(request => request.path), ['/v1/account', `/v1/events/${event.id}`, '/v1/invoices/in_SyntheticInvoice']);
  assert.ok(f.requests.every(request => request.method === 'GET' && request.version === stripeApiVersion && request.authorization === `Bearer ${settings.STRIPE_TEST_SECRET_KEY}`));
  assert.equal((await f.send(event)).status, 200);
  assert.equal(await count(f, 'durable_operations'), 1);
});

test('checkout, subscription, charge, refund and dispute families retrieve current own-account sandbox objects; missing refund livemode uses canonical payment evidence', async t => {
  const f = await fixture(t);
  const variants = [
    ['checkout.session.completed', 'checkout.session', 'cs_test_SyntheticCheckout'],
    ['customer.subscription.deleted', 'subscription', 'sub_SyntheticEnded'],
    ['charge.refunded', 'charge', 'ch_SyntheticRefunded'],
    ['refund.updated', 'refund', 're_SyntheticRefund'],
    ['charge.dispute.closed', 'dispute', 'dp_SyntheticDispute'],
  ];
  for (const [type, kind, id] of variants) {
    const event = message(`evt_Synthetic${kind.replaceAll('.', '')}`, type, kind, id);
    const value: Record<string, unknown> = { ...event.data.object, status: kind === 'refund' ? 'succeeded' : 'canceled', charge: 'ch_SyntheticPayment' };
    if (kind === 'refund') delete value.livemode;
    f.seed(event, value);
    f.objects.set('/v1/charges/ch_SyntheticPayment', { id: 'ch_SyntheticPayment', object: 'charge', customer: 'cus_SyntheticBillingFixture', livemode: false });
    assert.equal((await f.send(event)).status, 200);
    assert.equal((await complete(f)).receipt?.state, 'observed');
  }
  assert.equal(await count(f, 'entitlement_grants'), 0);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM stripe_event_notifications WHERE state='observed'").get())?.count, 5);
});

test('unknown valid snapshot events are durably classified and completed as ignored with visible diagnostics and no provider reads', async t => {
  const f = await fixture(t), event = message('evt_SyntheticUnsupported', 'payout.paid', 'payout', 'po_SyntheticPayout');
  assert.equal((await f.send(event)).status, 200);
  assert.equal((await complete(f)).receipt?.state, 'ignored');
  const row = await f.db.prepare('SELECT classification,state,observation FROM stripe_event_notifications').get();
  assert.deepEqual(row, { classification: 'unsupported', state: 'ignored', observation: null });
  assert.equal(f.requests.length, 0);
});

test('provider outage, conflicting immutable event and foreign account/object/mode never become clean observations or completed receipts', async t => {
  const f = await fixture(t), event = message();
  f.seed(event);
  assert.equal((await f.send(event)).status, 200);
  const claim = await f.worker.jobs.claim('billing.reconcile');
  assert.ok(claim);
  f.outage('/v1/invoices/in_SyntheticInvoice');
  await assert.rejects(f.worker.runClaim(claim), /Synthetic read-only provider outage/);
  f.outage('');
  f.account('acct_ForeignFixture');
  await assert.rejects(f.worker.runClaim(claim), /canonical provider account/);
  f.account(settings.STRIPE_TEST_ACCOUNT_ID);
  f.events.set(event.id, { ...event, data: { object: { ...event.data.object, amount_paid: 2 } } });
  await assert.rejects(f.worker.runClaim(claim), /conflicts with the accepted notification/);
  f.events.set(event.id, event);
  for (const changed of [{ id: 'in_ForeignFixture' }, { livemode: true }, { object: 'charge' }]) {
    f.objects.set('/v1/invoices/in_SyntheticInvoice', { ...event.data.object, ...changed });
    await assert.rejects(f.worker.runClaim(claim));
  }
  assert.equal((await f.db.prepare('SELECT state,observation FROM stripe_event_notifications').get())?.state, 'accepted');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).completedAt, null);
  assert.equal(await count(f, 'entitlement_grants'), 0);
  f.seed(event);
  await f.worker.runClaim(claim);
  assert.ok((await f.worker.jobs.operation(claim.data.operationId)).completedAt);
});

test('a claim expiring during actual observation SQL rolls back observation and completion, preserving retryable accepted evidence', async t => {
  const f = await fixture(t), event = message(), boss = await createBoss(f.db);
  await boss.start(); f.cleanup.push(() => boss.stop());
  await boss.updateQueue('billing-reconcile', { expireInSeconds: 2, heartbeatSeconds: null });
  f.seed(event);
  assert.equal((await f.send(event)).status, 200);
  const claim = await f.worker.jobs.claim('billing.reconcile');
  assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE billing_publication_witness;
    CREATE FUNCTION expire_billing_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('billing_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_billing_publication AFTER UPDATE ON stripe_event_notifications FOR EACH ROW EXECUTE FUNCTION expire_billing_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM billing_publication_witness').get())?.is_called, true);
  const row = await f.db.prepare('SELECT state,observation,observed_at FROM stripe_event_notifications').get();
  assert.deepEqual(row, { state: 'accepted', observation: null, observed_at: null });
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal(await count(f, 'entitlement_grants'), 0);
});

test('recorded billing evidence cannot silently lose configuration or switch provider accounts at application startup', async t => {
  const f = await fixture(t);
  assert.equal((await f.send(message())).status, 200);
  await assert.rejects(assertBillingConfiguration(f.db, null), /Stored billing notifications require/);
  await assert.rejects(assertBillingConfiguration(f.db, { ...f.config.billing!, accountId: 'acct_ForeignFixture' }), /different provider account/);
  await assert.rejects(createApplication({ ...f.config, environment: 'production', billing: null }), /Stored billing notifications require/);
});

test('concurrently opened producers cannot bind first accepted evidence to two different provider accounts', async t => {
  const f = await fixture(t), shutdown = new AbortController();
  assert.ok(f.config.billing);
  const rival = await BillingNotifications.open(f.db, { ...f.config.billing, accountId: 'acct_RivalFixture' }, shutdown.signal);
  f.cleanup.push(() => rival.close());
  const app = express(); rival.register(app); app.use(handleError);
  const server = createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  f.cleanup.push(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const event = message(), body = JSON.stringify(event);
  const signature = f.client.webhooks.generateTestHeaderString({ payload: body, secret: settings.STRIPE_TEST_WEBHOOK_SECRET });
  const responses = await Promise.all([
    f.send(event),
    fetch(`http://127.0.0.1:${address.port}/api/webhooks/stripe`, { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature } }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(await count(f, 'stripe_event_notifications'), 1);
  assert.equal(await count(f, 'verified_event_inbox'), 1);
  assert.equal(await count(f, 'durable_operations'), 1);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_billing_reference').get())?.count, 1);
});

test('compiled billing maintenance uses the official runtime SDK and fails explicitly for active backlog, then reconciles accepted notifications without development tooling', async t => {
  const f = await fixture(t), event = message();
  f.seed(event); assert.equal((await f.send(event)).status, 200);
  const claim = await f.worker.jobs.claim('billing.reconcile');
  assert.ok(claim);
  const env = {
    PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: f.config.databaseUrl!,
    ...authJsEnvironment(f.origin), ...settings,
  };
  const code = `import Stripe from 'stripe'; import { runBillingCommand } from './dist-server/billing/cli.js';
    const client = new Stripe(process.env.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: ${f.port}, protocol: 'http',
      apiVersion: '${stripeApiVersion}', maxNetworkRetries: 0, timeout: 1000 });
    await runBillingCommand('reconcile', client);`;
  const execute = promisify(execFile);
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 }), error => {
    assert.ok(error && typeof error === 'object' && 'code' in error && 'stderr' in error);
    assert.equal(error.code, 1); assert.match(String(error.stderr), /pass is incomplete/); return true;
  });
  await f.worker.runClaim(claim);
  const second = message('evt_SyntheticCompiled', 'invoice.paid', 'invoice', 'in_SyntheticCompiled');
  f.seed(second); assert.equal((await f.send(second)).status, 200);
  const result = await execute(process.execPath, ['--input-type=module', '-e', code], { env, timeout: 15000 });
  assert.deepEqual(JSON.parse(result.stdout), { event: 'billing.notifications.reconciled', completed: 1, authority: 'notification-evidence-only' });
  assert.equal(await count(f, 'entitlement_grants'), 0);
});

test('notification normalization pins API/version/type and excludes mutable delivery counters while retaining an immutable object fingerprint', () => {
  const event = message(), first = notification({ ...event, pending_webhooks: 2 }, settings.STRIPE_TEST_ACCOUNT_ID);
  assert.deepEqual(notification({ ...event, pending_webhooks: 0 }, settings.STRIPE_TEST_ACCOUNT_ID), first);
  assert.deepEqual(notification({ ...event, data: { object: Object.fromEntries(Object.entries(event.data.object).reverse()) } }, settings.STRIPE_TEST_ACCOUNT_ID), first);
  assert.notEqual(notification({ ...event, data: { object: { ...event.data.object, amount_paid: 1 } } }, settings.STRIPE_TEST_ACCOUNT_ID).snapshotHash, first.snapshotHash);
});
