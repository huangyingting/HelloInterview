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
    const list = (data: unknown[]) => ({ object: 'list', data, has_more: pagination === req.path, url: req.path });
    if (req.method === 'GET') {
      if (req.path === '/v1/customers/search') return res.json({ object: 'search_result',
        data: [...customers.values()], has_more: pagination === req.path });
      if (req.path === '/v1/checkout/sessions') return res.json(list([...sessions.values()].filter(session => session.customer === req.query.customer)));
      if (req.path === '/v1/subscriptions') return res.json(list(subscriptions));
      const value = req.path.startsWith('/v1/customers/') ? customers.get(req.path.slice('/v1/customers/'.length)) :
        req.path.startsWith('/v1/prices/') ? prices.get(req.path.slice('/v1/prices/'.length)) :
        req.path === '/v1/products/prod_SyntheticCheckout' ? product :
        req.path.startsWith('/v1/checkout/sessions/') ? sessions.get(req.path.slice('/v1/checkout/sessions/'.length)) : undefined;
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
  return { ...f, worker, client, customers, sessions, subscriptions, prices, product, requests, port: address.port,
    barrier(value?: typeof barrier) { barrier = value; }, account(value: string) { account = value; },
    pagination(value: string) { pagination = value; }, outage(value: string) { failPath = value; },
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
    async complete(kind: 'billing.customer' | 'billing.checkout' | 'billing.checkout.refresh') {
      const claim = await worker.jobs.claim(kind); assert.ok(claim, `Expected a ${kind} claim.`);
      await worker.runClaim(claim);
      return worker.jobs.operation(claim.data.operationId);
    },
  };
}
