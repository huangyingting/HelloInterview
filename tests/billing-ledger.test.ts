import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';
import { openBillingFixture } from './fixtures/billing';
import { LostJobClaim, TerminalJobFailure } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';

function barrier() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve() { assert.ok(resolve); resolve(); } };
}
async function prepared(t: TestContext, settle = true) {
  const f = await openBillingFixture(t), login = await f.login();
  const intent = await f.reserve(login.browser);
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  const facts = settle ? await f.settleCheckout() : null;
  if (settle) {
    assert.equal((await login.browser.request(`/api/billing/checkouts/${intent.id}/refresh`, {})).status, 200);
    await f.complete('billing.checkout.refresh');
  }
  return { ...f, ...login, anotherBrowser: f.browser, intent, facts };
}
async function drain(f: Pick<Awaited<ReturnType<typeof openBillingFixture>>, 'worker'>) {
  let count = 0;
  for (let claim = await f.worker.jobs.claim('billing.customer.snapshot'); claim; claim = await f.worker.jobs.claim('billing.customer.snapshot')) {
    assert.ok(++count <= 4, 'Dirty revisions must converge, not endlessly retry the superseded immutable job.');
    await f.worker.runClaim(claim);
  }
  return count;
}
function historicalInvoice(id: string, customer: string, created: number) {
  const line = { id: `il_${id}`, object: 'line_item', invoice: id, livemode: false, currency: 'usd', amount: 1900,
    quantity: 1, quantity_decimal: '1', subscription: null, period: { start: created, end: created + 86400 },
    parent: { type: 'invoice_item_details', invoice_item_details: { proration: false } }, pricing: null };
  return { id, object: 'invoice', customer, created, livemode: false, status: 'paid', currency: 'usd', total: 1900,
    amount_paid: 1900, amount_remaining: 0, status_transitions: { paid_at: created }, parent: null,
    lines: { object: 'list', has_more: false, data: [line] }, payments: { object: 'list', has_more: false, data: [] } };
}
test('owned canonical subscriptions, inclusive service-line periods and payment references are minimized observations, never paid grants', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  assert.equal(await drain(f), 2);
  const view = await f.view(f.browser);
  assert.equal(view.ledger?.processing, 'completed'); assert.equal(view.ledger?.stale, false);
  assert.equal(view.ledger?.authority, 'sandbox-ledger-observation-only');
  assert.equal(view.ledger?.subscriptions[0].status, 'active'); assert.equal(view.ledger?.invoices[0].status, 'paid');
  assert.deepEqual(view.ledger?.reviewReasons, ['commercial-policy-pending']);
  assert.equal(view.ledger?.invoices[0].funding?.state, 'settled');
  const row = await f.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger').get(); assert.ok(row);
  const invoice = JSON.parse(z.string().parse(row.payload));
  assert.equal(invoice.lines[0].periodEnd, f.facts.line.period.end, 'Do not silently turn an inclusive SDK period into an entitlement interval.');
  assert.equal(invoice.payments[0].reference, f.facts.intent.id);
  const privateRows = JSON.stringify(await f.db.prepare('SELECT payload FROM stripe_customer_ledger_snapshots').all());
  for (const secret of ['private-fixture-contact', 'private-fixture-client-secret', 'https://private.fixture/invoice']) assert.ok(!privateRows.includes(secret));
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'in_Synthetic', 'pi_Synthetic', 'studio_customer_ref']) assert.ok(!JSON.stringify(view).includes(secret));
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 2);
  assert.equal((await f.browser.request('/api/billing/reconcile', { customerId: 'cus_Foreign' })).status, 400);
  assert.equal((await f.browser.request('/api/billing/reconcile', {}, 'POST', { 'X-CSRF-Token': 'wrong' })).status, 403);
  const stranger = await f.login(f.anotherBrowser(), 'auth0|ledger-stranger');
  assert.equal((await f.view(stranger.browser)).ledger, null);
  assert.equal((await stranger.browser.request('/api/billing/reconcile', {})).status, 409);
  await f.db.prepare('UPDATE managed_sessions SET authenticated_at=authenticated_at-660000 WHERE token IN (SELECT token FROM sessions WHERE user_id=?)').run(f.owner);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 403);
});

test('complete bounded SDK pagination follows every invoice line and payment reference; repeated or incomplete pages cannot publish partial success', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  const { invoice, line, payment } = f.facts;
  const lines = Array.from({ length: 250 }, (_, index) => ({ ...line, id: `il_Page${index}` }));
  const payments = Array.from({ length: 250 }, (_, index) => ({ ...payment, id: `inpay_Page${index}` }));
  invoice.lines = { object: 'list', has_more: true, data: lines.slice(0, 100) };
  invoice.payments = { object: 'list', has_more: true, data: payments.slice(0, 100) };
  f.invoiceLines.set(invoice.id, lines); f.invoicePayments.set(invoice.id, payments);
  await drain(f);
  const saved = await f.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger').get(); assert.ok(saved);
  const data = JSON.parse(z.string().parse(saved.payload));
  assert.equal(data.lines.length, 250); assert.equal(data.payments.length, 250);
  assert.equal(f.requests.filter(request => request.path === `/v1/invoices/${invoice.id}/lines`).length, 2);
  assert.equal(f.requests.filter(request => request.path === '/v1/invoice_payments').length, 10);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  f.pagination('/v1/invoice_payments');
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
  assert.equal((await f.view(f.browser)).ledger?.stale, true);
});

test('notifications observed before customer mapping hand off atomically and explicitly retrieve old invoices outside the recent window', async t => {
  const f = await openBillingFixture(t), { browser } = await f.login();
  await f.reserve(browser);
  const claim = await f.worker.jobs.claim('billing.customer'); assert.ok(claim);
  await f.db.executeSql(`CREATE FUNCTION fail_mapping() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.state='mapped' THEN RAISE EXCEPTION 'synthetic mapping failure'; END IF; RETURN NEW; END $body$;
    CREATE TRIGGER fail_mapping BEFORE UPDATE ON stripe_owned_customers FOR EACH ROW EXECUTE FUNCTION fail_mapping();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic mapping failure/);
  const customerId = String([...f.customers.values()][0].id);
  const invoice = historicalInvoice('in_OldBeforeMapping', customerId, Math.floor(Date.now() / 1000) - 120 * 86400);
  f.invoices.set(invoice.id, invoice);
  await f.notify('invoice', invoice, 'invoice.paid'); await f.complete('billing.reconcile');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_ledger_notification_links').get())?.count, 0);
  await f.db.executeSql('DROP TRIGGER fail_mapping ON stripe_owned_customers');
  await f.worker.runClaim(claim); await f.complete('billing.checkout');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_ledger_notification_links').get())?.count, 1);
  await drain(f);
  assert.ok(f.requests.some(request => request.path === `/v1/invoices/${invoice.id}`));
  assert.equal((await f.view(browser)).ledger?.invoices[0].status, 'paid');
  assert.equal(f.requests.filter(request => request.path === '/v1/customers' && request.method === 'POST').length, 2);
  assert.equal(f.customers.size, 1);
});

test('a notification during canonical reads supersedes the old revision without publishing it, then converges to the new cancellation facts', async t => {
  const f = await prepared(t); assert.ok(f.facts); await drain(f);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  const entered = barrier(), release = barrier();
  f.barrier(async path => { if (path === '/v1/invoices') { entered.resolve(); await release.promise; } });
  const work = f.worker.runClaim(claim); t.after(() => release.resolve());
  await entered.promise;
  f.facts.sub.cancel_at_period_end = true;
  await f.notify('subscription', f.facts.sub, 'customer.subscription.updated'); await f.complete('billing.reconcile');
  release.resolve(); await work; f.barrier();
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt?.superseded, true);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, false);
  await drain(f);
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].nonrenewing, true);
  assert.equal((await f.view(f.browser)).ledger?.stale, false);
});

test('actual expired-claim publication SQL rolls back invoice, subscription, history, state and completion together', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  await f.complete('billing.customer.snapshot');
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const operation = await f.db.prepare("SELECT job_id FROM durable_operations WHERE kind='billing.customer.snapshot' AND completed_at IS NULL").get(); assert.ok(operation);
  await boss.update('billing-customer-snapshot', undefined, { id: String(operation.job_id), expireInSeconds: 2 });
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim); assert.equal(claim.expireInSeconds, 2);
  await f.db.executeSql(`CREATE SEQUENCE ledger_publication_witness;
    CREATE FUNCTION expire_ledger_publication() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('ledger_publication_witness'); PERFORM pg_sleep(2.1); RETURN NEW; END $body$;
    CREATE TRIGGER expire_ledger_publication AFTER INSERT ON stripe_customer_ledger_snapshots FOR EACH ROW EXECUTE FUNCTION expire_ledger_publication();`);
  await assert.rejects(f.worker.runClaim(claim), LostJobClaim);
  assert.equal((await f.db.prepare('SELECT is_called FROM ledger_publication_witness').get())?.is_called, true);
  for (const table of ['stripe_owned_invoice_ledger', 'stripe_owned_subscription_ledger', 'stripe_customer_ledger_snapshots']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal((await f.db.prepare('SELECT reconciled_revision FROM stripe_customer_ledger_state').get())?.reconciled_revision, '0');
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('SDK drift, foreign customers or modes, malformed item periods and contradictory payment references preserve the prior projection', async t => {
  const f = await prepared(t); assert.ok(f.facts); await drain(f);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  const { sub, invoice, payment } = f.facts;
  for (const [object, field, value] of [
    [sub, 'customer', 'cus_Foreign'], [sub, 'livemode', true], [invoice, 'customer', 'cus_Foreign'], [invoice, 'livemode', true],
    [payment, 'invoice', 'in_Foreign'], [payment, 'currency', 'eur'], [payment, 'payment', { type: 'unknown_future_type', payout: 'po_Foreign' }],
  ] as const) {
    const record: Record<string, unknown> = object, old = record[field]; record[field] = value;
    await assert.rejects(f.worker.runClaim(claim)); record[field] = old;
    assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  }
  const item = sub.items.data[0], end = item.current_period_end; item.current_period_end = item.current_period_start - 1;
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure); item.current_period_end = end;
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
  assert.equal((await f.view(f.browser)).ledger?.invoices[0].status, 'paid');
  await f.worker.runClaim(claim);
});

test('zero-value, out-of-band, trial, unexpected-price and duplicate subscription observations are held without issuing access', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  const { sub, invoice, payment, line } = f.facts;
  sub.status = 'trialing'; sub.items.data[0].price.id = 'price_Unexpected';
  const duplicate = structuredClone(sub); duplicate.id = 'sub_UnexpectedDuplicate'; duplicate.items.data[0].subscription = duplicate.id;
  f.subscriptions.push({ ...duplicate, latest_invoice: null, metadata: {} });
  invoice.total = 0; invoice.amount_paid = 0; line.amount = 0;
  payment.amount_paid = 0;
  Object.assign(invoice, { payments: { object: 'list', has_more: false, data: [{ ...payment, payment: { type: 'payment_record', payment_record: 'pr_OutOfBand' } }] } });
  await drain(f);
  const view = await f.view(f.browser);
  for (const reason of ['trial-not-supported', 'unexpected-price', 'duplicate-subscriptions', 'invoice-adjustment', 'unsupported-payment-funding']) {
    assert.ok(view.ledger?.reviewReasons.some(value => value === reason));
  }
  assert.equal((await f.browser.bootstrap()).capabilities.access?.state, 'free');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
});

test('absence from a recent window never deletes historical invoices; absent known subscriptions get explicit reads and terminal records cannot reopen', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  f.facts.invoice.created = Math.floor(Date.now() / 1000) - 120 * 86400;
  await drain(f);
  f.facts.sub.status = 'canceled'; Object.assign(f.facts.sub, { latest_invoice: null });
  f.omitFromLists(f.facts.sub.id);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202); await drain(f);
  assert.ok(f.requests.some(request => request.path === `/v1/subscriptions/${f.facts!.sub.id}`));
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].status, 'canceled');
  assert.equal((await f.view(f.browser)).ledger?.invoices[0].status, 'paid');
  assert.ok((await f.view(f.browser)).ledger?.reviewReasons.includes('commercial-policy-pending'));
  f.facts.sub.status = 'active';
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.view(f.browser)).ledger?.subscriptions[0].status, 'canceled');
});

test('deletion from actual publication SQL is fenced before completion and rolls every financial write and owner deletion back', async t => {
  const f = await prepared(t); assert.ok(f.facts); await f.complete('billing.customer.snapshot');
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE ledger_deletion_witness;
    CREATE FUNCTION delete_ledger_owner() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('ledger_deletion_witness'); DELETE FROM users WHERE id='${f.owner}'; RETURN NEW; END $body$;
    CREATE TRIGGER delete_ledger_owner AFTER INSERT ON stripe_customer_ledger_snapshots FOR EACH ROW EXECUTE FUNCTION delete_ledger_owner();`);
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal((await f.db.prepare('SELECT is_called FROM ledger_deletion_witness').get())?.is_called, true);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_owned_customers').get())?.state, 'mapped');
  for (const table of ['stripe_owned_invoice_ledger', 'stripe_owned_subscription_ledger', 'stripe_customer_ledger_snapshots']) {
    assert.equal((await f.db.prepare(`SELECT count(*)::integer AS count FROM ${table}`).get())?.count, 0);
  }
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('read-only financial reconciliation survives account suspension but deletion during reads fences all new publication', async t => {
  const f = await prepared(t); assert.ok(f.facts);
  await f.db.prepare("UPDATE managed_accounts SET status='suspended' WHERE user_id=?").run(f.owner);
  await drain(f);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_owned_invoice_ledger').get())?.count, 1);
  assert.equal((await f.browser.request('/api/billing')).status, 403);
  await f.db.prepare("UPDATE managed_accounts SET status='active' WHERE user_id=?").run(f.owner);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  const entered = barrier(), release = barrier();
  f.barrier(async path => { if (path === '/v1/invoices') { entered.resolve(); await release.promise; } });
  const work = f.worker.runClaim(claim); t.after(() => release.resolve());
  await entered.promise; await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner); release.resolve();
  await assert.rejects(work, TerminalJobFailure);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_customer_ledger_snapshots').get())?.count, 1);
  assert.equal((await f.db.prepare('SELECT user_id FROM stripe_owned_customers').get())?.user_id, null);
});

test('the 48-read budget is enforced exactly and no partial invoice projection is accepted', async t => {
  const f = await prepared(t, false);
  const customer = [...f.customers.values()][0];
  for (let index = 0; index < 60; index++) {
    const invoice: Record<string, unknown> = historicalInvoice(`in_Budget${index}`, String(customer.id), Math.floor(Date.now() / 1000));
    delete invoice.payments; f.invoices.set(String(invoice.id), invoice);
  }
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  const requests = f.requests.length;
  await assert.rejects(f.worker.runClaim(claim), TerminalJobFailure);
  assert.equal(f.requests.length - requests, 48);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_owned_invoice_ledger').get())?.count, 0);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
});

test('actual notification-to-ledger handoff failure rolls observation, dirty revision, event link and parent completion back atomically', async t => {
  const f = await prepared(t); assert.ok(f.facts); await drain(f);
  const state = await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get(); assert.ok(state);
  const event = await f.notify('invoice', f.facts.invoice, 'invoice.paid');
  const claim = await f.worker.jobs.claim('billing.reconcile'); assert.ok(claim);
  await f.db.executeSql(`CREATE SEQUENCE ledger_handoff_witness;
    CREATE FUNCTION fail_ledger_handoff() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN PERFORM nextval('ledger_handoff_witness'); RAISE EXCEPTION 'synthetic ledger handoff failure'; END $body$;
    CREATE TRIGGER fail_ledger_handoff AFTER INSERT ON stripe_ledger_notification_links FOR EACH ROW EXECUTE FUNCTION fail_ledger_handoff();`);
  await assert.rejects(f.worker.runClaim(claim), /synthetic ledger handoff failure/);
  assert.equal((await f.db.prepare('SELECT is_called FROM ledger_handoff_witness').get())?.is_called, true);
  assert.deepEqual(await f.db.prepare('SELECT state,observation FROM stripe_event_notifications WHERE event_id=?').get(event.id), { state: 'accepted', observation: null });
  assert.deepEqual(await f.db.prepare('SELECT requested_revision FROM stripe_customer_ledger_state').get(), state);
  assert.equal((await f.worker.jobs.operation(claim.data.operationId)).receipt, null);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_ledger_notification_links').get())?.count, 0);
  await f.db.executeSql('DROP TRIGGER fail_ledger_handoff ON stripe_ledger_notification_links');
  await f.worker.runClaim(claim); await drain(f);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_ledger_notification_links').get())?.count, 1);
});

test('official attempt-fenced heartbeats update the actual queue row and cannot revive an expired claimed attempt', async t => {
  const f = await prepared(t, false);
  const boss = await createBoss(f.db); await boss.start(); f.cleanup.push(() => boss.stop());
  const claim = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(claim);
  const queue = await boss.getQueue(claim.name); assert.ok(queue);
  const schema = z.string().regex(/^[a-z_][a-z0-9_]+$/).parse((await f.db.prepare('SELECT current_schema() AS schema').get())?.schema);
  const table = z.string().regex(/^[a-z_][a-z0-9_]+$/).parse(queue.table);
  await f.db.executeSql(`CREATE SEQUENCE ledger_heartbeat_witness;
    CREATE FUNCTION witness_ledger_heartbeat() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW.heartbeat_on IS DISTINCT FROM OLD.heartbeat_on THEN PERFORM nextval('ledger_heartbeat_witness'); END IF; RETURN NEW; END $body$;
    CREATE TRIGGER witness_ledger_heartbeat AFTER UPDATE ON ${schema}_jobs.${table} FOR EACH ROW EXECUTE FUNCTION witness_ledger_heartbeat();`);
  await f.worker.runClaim(claim);
  assert.equal((await f.db.prepare('SELECT is_called FROM ledger_heartbeat_witness').get())?.is_called, true);
  const row = await f.db.prepare('SELECT last_value FROM ledger_heartbeat_witness').get(); assert.ok(Number(row?.last_value) >= 4);
  assert.equal((await f.browser.request('/api/billing/reconcile', {})).status, 202);
  const next = await f.worker.jobs.claim('billing.customer.snapshot'); assert.ok(next);
  await f.db.prepare(`UPDATE ${schema}_jobs.${table} SET heartbeat_on=clock_timestamp()-INTERVAL '31 seconds' WHERE id=?`).run(next.id);
  const before = await f.db.prepare('SELECT last_value FROM ledger_heartbeat_witness').get();
  await assert.rejects(f.worker.jobs.heartbeat(next), LostJobClaim);
  assert.deepEqual(await f.db.prepare('SELECT last_value FROM ledger_heartbeat_witness').get(), before);
  assert.equal((await f.worker.jobs.operation(next.data.operationId)).receipt, null);
});
