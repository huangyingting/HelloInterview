import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { TestContext } from 'node:test';
import { z } from 'zod';
import { openIdentityFixture, type IdentityBrowser } from './identity';
import { BillingNotifications } from '../../server/billing';
import { stripeApiVersion } from '../../server/billing/schema';
import type { SandboxBillingView, SandboxOffer } from '../../shared/billing';
import { randomUUID } from 'node:crypto';

export const sandboxSettings = {
  STRIPE_TEST_ACCOUNT_ID: 'acct_SyntheticCheckoutFixture',
  STRIPE_TEST_SECRET_KEY: 'rk_test_SyntheticCheckoutFixtureOnly',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_SyntheticCheckoutFixtureOnly',
  STRIPE_TEST_OFFERS: JSON.stringify({ pro_monthly: 'price_SyntheticMonthly', pro_annual: 'price_SyntheticAnnual' }),
};
const customerPost = z.strictObject({ metadata: z.strictObject({ studio_customer_ref: z.uuid() }) });
const sessionPost = z.strictObject({
  mode: z.literal('subscription'), ui_mode: z.literal('hosted_page'), customer: z.string(),
  client_reference_id: z.uuid(), line_items: z.array(z.strictObject({ price: z.string(), quantity: z.literal('1') })).length(1),
  allowed_payment_method_types: z.array(z.literal('card')).length(1), allow_promotion_codes: z.literal('false'),
  automatic_tax: z.strictObject({ enabled: z.literal('false') }), adaptive_pricing: z.strictObject({ enabled: z.literal('false') }),
  metadata: z.strictObject({ studio_customer_ref: z.uuid() }),
  subscription_data: z.strictObject({ metadata: z.strictObject({ studio_customer_ref: z.uuid(), studio_checkout_ref: z.uuid() }) }),
  expires_at: z.string().regex(/^\d+$/), success_url: z.string(), cancel_url: z.string(),
});
export async function openBillingFixture(t: TestContext) {
  const f = await openIdentityFixture(sandboxSettings);
  t.after(f.close);
  assert.ok(f.billing?.checkout); assert.ok(f.config.billing);
  const customers = new Map<string, Record<string, unknown>>(), sessions = new Map<string, Record<string, unknown>>();
  const subscriptions: Record<string, unknown>[] = [];
  const invoices = new Map<string, Record<string, unknown>>(), events = new Map<string, Record<string, unknown>>();
  const invoiceLines = new Map<string, Record<string, unknown>[]>(), invoicePayments = new Map<string, Record<string, unknown>[]>();
  const paymentIntents = new Map<string, Record<string, unknown>>(), charges = new Map<string, Record<string, unknown>>();
  const refunds = new Map<string, Record<string, unknown>>(), disputes = new Map<string, Record<string, unknown>>(), credits = new Map<string, Record<string, unknown>>();
  const pageSizes = new Map<string, number>();
  const omitted = new Set<string>();
  const prices = new Map<string, Record<string, unknown>>();
  for (const [id, interval, amount] of [['price_SyntheticMonthly', 'month', 1900], ['price_SyntheticAnnual', 'year', 19000]] as const) {
    prices.set(id, { id, object: 'price', active: true, livemode: false, type: 'recurring', billing_scheme: 'per_unit',
      currency: 'usd', unit_amount: amount, product: 'prod_SyntheticCheckout',
      recurring: { interval, interval_count: 1, usage_type: 'licensed' } });
  }
  const product: Record<string, unknown> = { id: 'prod_SyntheticCheckout', object: 'product', active: true, livemode: false };
  const responses = new Map<string, Record<string, unknown>>();
  const requests: { method: string; path: string; key?: string; body: unknown; version?: string }[] = [];
  let account = sandboxSettings.STRIPE_TEST_ACCOUNT_ID, pagination = '', failPath = '';
  let barrier: ((path: string, method: string) => Promise<void>) | undefined;
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.all('/{*path}', async (req, res) => {
    requests.push({ method: req.method, path: req.path, key: req.get('Idempotency-Key'), body: req.body, version: req.get('Stripe-Version') });
    if (barrier) await barrier(req.path, req.method);
    if (req.path === failPath) return res.status(503).json({ error: { type: 'api_error', message: 'Synthetic sandbox provider outage.' } });
    if (req.path === '/v1/account') return res.json({ id: account, object: 'account' });
    const list = (values: Record<string, unknown>[]) => {
      values = values.filter(value => !omitted.has(String(value.id)));
      const after = typeof req.query.starting_after === 'string' ? req.query.starting_after : null;
      const start = after ? values.findIndex(value => value.id === after) + 1 : 0, size = pageSizes.get(req.path) ?? 100;
      return { object: 'list', data: values.slice(start, start + size), has_more: pagination === req.path || start + size < values.length, url: req.path };
    };
    if (req.method === 'GET') {
      if (req.path === '/v1/customers/search') return res.json({ object: 'search_result',
        data: [...customers.values()], has_more: pagination === req.path });
      if (req.path === '/v1/checkout/sessions') return res.json(list([...sessions.values()].filter(session => session.customer === req.query.customer)));
      if (req.path === '/v1/subscriptions') return res.json(list(subscriptions));
      if (req.path === '/v1/invoices') return res.json(list([...invoices.values()].filter(invoice =>
        invoice.customer === req.query.customer && Number(invoice.created) >= Number(req.query['created[gte]'] ?? 0))));
      if (req.path === '/v1/invoice_payments') return res.json(list(req.query.invoice ? invoicePayments.get(String(req.query.invoice)) ?? [] :
        [...invoicePayments.values()].flat().filter(value => z.object({ payment: z.object({ payment_intent: z.string().optional() }) }).parse(value).payment.payment_intent === req.query['payment[payment_intent]'])));
      if (req.path === '/v1/charges') return res.json(list([...charges.values()].filter(value => value.payment_intent === req.query.payment_intent)));
      if (req.path === '/v1/refunds') return res.json(list([...refunds.values()].filter(value => value.charge === req.query.charge)));
      if (req.path === '/v1/disputes') return res.json(list([...disputes.values()].filter(value => value.charge === req.query.charge)));
      if (req.path === '/v1/credit_notes') return res.json(list([...credits.values()].filter(value => value.invoice === req.query.invoice)));
      if (/^\/v1\/invoices\/[^/]+\/lines$/.test(req.path)) return res.json(list(invoiceLines.get(req.path.split('/')[3]) ?? []));
      if (req.path === '/v1/subscription_items') {
        const sub = subscriptions.find(sub => sub.id === req.query.subscription);
        const items = z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(sub?.items);
        return res.json(list(items.data));
      }
      const value = req.path.startsWith('/v1/customers/') ? customers.get(req.path.slice('/v1/customers/'.length)) :
        req.path.startsWith('/v1/prices/') ? prices.get(req.path.slice('/v1/prices/'.length)) :
        req.path === '/v1/products/prod_SyntheticCheckout' ? product :
        req.path.startsWith('/v1/checkout/sessions/') ? sessions.get(req.path.slice('/v1/checkout/sessions/'.length)) :
        req.path.startsWith('/v1/subscriptions/') ? subscriptions.find(sub => sub.id === req.path.slice('/v1/subscriptions/'.length)) :
        req.path.startsWith('/v1/invoices/') ? invoices.get(req.path.slice('/v1/invoices/'.length)) :
        req.path.startsWith('/v1/events/') ? events.get(req.path.slice('/v1/events/'.length)) :
        req.path.startsWith('/v1/payment_intents/') ? paymentIntents.get(req.path.slice('/v1/payment_intents/'.length)) :
        req.path.startsWith('/v1/charges/') ? charges.get(req.path.slice('/v1/charges/'.length)) :
        req.path.startsWith('/v1/refunds/') ? refunds.get(req.path.slice('/v1/refunds/'.length)) :
        req.path.startsWith('/v1/disputes/') ? disputes.get(req.path.slice('/v1/disputes/'.length)) :
        req.path.startsWith('/v1/credit_notes/') ? credits.get(req.path.slice('/v1/credit_notes/'.length)) : undefined;
      if (value) return res.json(value);
    }
    if (req.method === 'POST') {
      const key = req.get('Idempotency-Key');
      assert.ok(key, 'Every provider mutation must have a stable operation key.');
      const cached = responses.get(`${req.path}:${key}`);
      if (cached) return res.json(cached);
      if (req.path === '/v1/customers') {
        const body = customerPost.parse(req.body), id = `cus_Synthetic${customers.size + 1}`;
        const customer = { id, object: 'customer', livemode: false, metadata: body.metadata };
        customers.set(id, customer); responses.set(`${req.path}:${key}`, structuredClone(customer)); return res.json(customer);
      }
      if (req.path === '/v1/checkout/sessions') {
        const body = sessionPost.parse(req.body), id = `cs_test_Synthetic${sessions.size + 1}`, price = body.line_items[0].price;
        assert.ok(customers.has(body.customer)); assert.ok(prices.has(price));
        assert.equal(body.subscription_data.metadata.studio_checkout_ref, body.client_reference_id);
        assert.equal(body.subscription_data.metadata.studio_customer_ref, body.metadata.studio_customer_ref);
        const session = { id, object: 'checkout.session', livemode: false, mode: body.mode, ui_mode: body.ui_mode,
          customer: body.customer, client_reference_id: body.client_reference_id, metadata: body.metadata,
          status: 'open', payment_status: 'unpaid', subscription: null, expires_at: Number(body.expires_at),
          success_url: body.success_url, cancel_url: body.cancel_url, url: `https://checkout.stripe.com/c/pay/${id}#opaque-fixture-fragment`,
          line_items: list([{ quantity: 1, currency: 'usd', price: { id: price } }]) };
        sessions.set(id, session); responses.set(`${req.path}:${key}`, structuredClone(session)); return res.json(session);
      }
    }
    res.status(404).json({ error: { type: 'invalid_request_error', message: 'Synthetic provider object is missing.' } });
  });
  const server = createServer(app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const client = new Stripe(sandboxSettings.STRIPE_TEST_SECRET_KEY, { host: '127.0.0.1', port: address.port, protocol: 'http',
    apiVersion: stripeApiVersion, maxNetworkRetries: 0, timeout: 1000 });
  const shutdown = new AbortController();
  const worker = await BillingNotifications.open(f.db, f.config.billing, shutdown.signal, true, client, f.origin);
  f.cleanup.push(async () => {
    shutdown.abort();
    try { await worker.close(); } finally {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await closed;
    }
  });
  return { ...f, worker, client, customers, sessions, subscriptions, prices, product, requests, invoices, invoiceLines, invoicePayments, events,
    paymentIntents, charges, refunds, disputes, credits, port: address.port,
    barrier(value?: typeof barrier) { barrier = value; }, account(value: string) { account = value; },
    pagination(value: string) { pagination = value; }, outage(value: string) { failPath = value; },
    pageSize(path: string, value: number) { pageSizes.set(path, value); },
    omitFromLists(id: string) { omitted.add(id); },
    async notify(kind: string, value: Record<string, unknown>, type: string) {
      const event = { id: `evt_Synthetic${events.size + 1}`, object: 'event', api_version: stripeApiVersion, livemode: false,
        type, created: Math.floor(Date.now() / 1000), data: { object: value }, pending_webhooks: 1, request: null };
      assert.equal(value.object, kind); events.set(event.id, event);
      const response = await f.browser().request('/api/webhooks/stripe', event, 'POST', {
        'Stripe-Signature': client.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: sandboxSettings.STRIPE_TEST_WEBHOOK_SECRET }),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return event;
    },
    async settleCheckout() {
      const attempt = await f.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE session_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get();
      assert.ok(attempt);
      const session = sessions.get(String(attempt.session_id)); assert.ok(session);
      const now = Math.floor(Date.now() / 1000), subId = `sub_Synthetic${subscriptions.length + 1}`, invoiceId = `in_Synthetic${invoices.size + 1}`;
      Object.assign(session, { status: 'complete', payment_status: 'paid', subscription: subId, url: null });
      const sub = { id: subId, object: 'subscription', customer: session.customer, livemode: false, status: 'active', cancel_at_period_end: false,
        metadata: { studio_customer_ref: String(attempt.customer_ref), studio_checkout_ref: String(attempt.id) }, latest_invoice: invoiceId,
        items: { object: 'list', has_more: false, data: [{ id: 'si_Synthetic1', object: 'subscription_item', subscription: subId,
          price: { id: String(attempt.price_id), object: 'price', livemode: false }, quantity: 1, current_period_start: now, current_period_end: now + 30 * 86400 }] } };
      const line = { id: `il_Synthetic${invoices.size + 1}`, object: 'line_item', invoice: invoiceId, livemode: false,
        currency: 'usd', amount: 1900, quantity: 1, quantity_decimal: '1', subscription: subId, period: { start: now, end: now + 30 * 86400 },
        parent: { type: 'subscription_item_details', subscription_item_details: { subscription: subId, subscription_item: 'si_Synthetic1', proration: false } },
        pricing: { type: 'price_details', price_details: { price: String(attempt.price_id), product: 'prod_SyntheticCheckout' } } };
      const payment = { id: `inpay_Synthetic${invoices.size + 1}`, object: 'invoice_payment', invoice: invoiceId, livemode: false,
        currency: 'usd', status: 'paid', amount_paid: 1900, payment: { type: 'payment_intent', payment_intent: `pi_Synthetic${invoices.size + 1}` } };
      const invoice = { id: invoiceId, object: 'invoice', customer: session.customer, livemode: false, created: now, status: 'paid',
        currency: 'usd', total: 1900, amount_paid: 1900, amount_remaining: 0, status_transitions: { paid_at: now },
        parent: { type: 'subscription_details', subscription_details: { subscription: subId } },
        lines: { object: 'list', has_more: false, data: [line] }, payments: { object: 'list', has_more: false, data: [payment] },
        customer_email: 'private-fixture-contact@example.invalid', hosted_invoice_url: 'https://private.fixture/invoice',
        confirmation_secret: { client_secret: 'private-fixture-client-secret' } };
      const charge = { id: `ch_Synthetic${charges.size + 1}`, object: 'charge', customer: session.customer, livemode: false, currency: 'usd',
        payment_intent: payment.payment.payment_intent, amount: 1900, amount_captured: 1900, amount_refunded: 0,
        status: 'succeeded', paid: true, captured: true, refunded: false, disputed: false, payment_method_details: { type: 'card' },
        billing_details: { email: 'private-card-contact@example.invalid' }, receipt_url: 'https://private.fixture/receipt' };
      const intent = { id: payment.payment.payment_intent, object: 'payment_intent', customer: session.customer, livemode: false,
        currency: 'usd', status: 'succeeded', amount: 1900, amount_received: 1900, amount_capturable: 0, latest_charge: charge.id,
        client_secret: 'private-payment-intent-secret' };
      charges.set(charge.id, charge); paymentIntents.set(intent.id, intent);
      subscriptions.push(sub); invoices.set(invoiceId, invoice); invoiceLines.set(invoiceId, [line]); invoicePayments.set(invoiceId, [payment]);
      return { sub, invoice, line, payment, charge, intent };
    },
    async login(browser = f.browser(), subject = 'auth0|checkout-fixture-owner') {
      assert.equal((await f.complete(browser, await f.begin(browser, 'email'), { sub: subject })).status, 303);
      const data = await browser.bootstrap(); assert.ok(data.user);
      return { browser, owner: data.user.id };
    },
    async reserve(browser: IdentityBrowser, offer: SandboxOffer = 'pro_monthly', key = randomUUID()) {
      const response = await browser.request('/api/billing/checkouts', { offer, key });
      assert.equal(response.status, 202, await response.clone().text());
      const body: { id: string } = await response.json();
      return { ...body, key, offer };
    },
    async view(browser: IdentityBrowser): Promise<SandboxBillingView> {
      const response = await browser.request('/api/billing'); assert.equal(response.status, 200);
      return response.json();
    },
    async complete(kind: 'billing.customer' | 'billing.checkout' | 'billing.checkout.refresh' | 'billing.customer.snapshot' | 'billing.reconcile') {
      const claim = await worker.jobs.claim(kind); assert.ok(claim, `Expected a ${kind} claim.`);
      await worker.runClaim(claim);
      return worker.jobs.operation(claim.data.operationId);
    },
  };
}
