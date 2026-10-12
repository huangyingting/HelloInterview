import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { openBillingFixture, sandboxPortalConfiguration } from './fixtures/billing';
import type { Bootstrap } from '../shared/types';
import { sandboxServicePolicy } from '../shared/billing-ledger';
import type { SandboxBillingView } from '../shared/billing';
import { problems } from '../shared/catalog';

async function fixture(t: TestContext, service = false, portal = false) {
  const f = await openBillingFixture(t, { ...(service ? { STRIPE_TEST_ACCESS_POLICY: sandboxServicePolicy } : {}),
    ...(portal ? { STRIPE_TEST_PORTAL_CONFIGURATION: sandboxPortalConfiguration } : {}) }), browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP studio.fixture 127.0.0.1,MAP broker.fixture 127.0.0.1'] });
  f.cleanup.push(() => browser.close());
  const context = await browser.newContext({ ignoreHTTPSErrors: true }), page = await context.newPage();
  const requests: { path: string; body: unknown }[] = [], assertions: Promise<void>[] = [];
  context.on('request', requested => {
    const url = new URL(requested.url());
    if (url.origin !== f.origin || ['GET', 'HEAD'].includes(requested.method())) return;
    requests.push({ path: url.pathname, body: requested.postDataJSON() });
    assertions.push(requested.allHeaders().then(headers => { assert.ok(headers['x-csrf-token'], 'Actual browser billing mutations require CSRF.'); }));
  });
  f.cleanup.push(() => Promise.all(assertions));
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return origin === f.origin || origin === new URL(f.issuer).origin ? route.continue() : route.abort();
  });
  f.setSubject('auth0|sandbox-browser-owner');
  await page.goto(`${f.origin}/auth`);
  await page.getByRole('link', { name: 'Continue with Email' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  await page.getByRole('link', { name: 'Open private sandbox billing' }).click();
  await expect(page.getByRole('heading', { name: 'Rehearse hosted checkout.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare sandbox checkout' })).toBeDisabled();
  return { ...f, context, page, requests };
}

test('actual managed browser prepares, resumes hosted sandbox and refreshes owned canonical results; return claims never grant Pro', { timeout: 60000 }, async t => {
  const f = await fixture(t), { page } = f;
  await expect(page.getByRole('button', { name: 'Open restricted sandbox Portal' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  const row = await f.db.prepare('SELECT id FROM stripe_checkout_attempts').get(); assert.ok(row);
  await page.goto(`${f.origin}/billing?attempt=${row.id}&paid=true&plan=pro`);
  await expect.poll(async () => (await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.checkout.refresh'").get())?.count).toBe(1);
  await f.complete('billing.checkout.refresh');
  await expect(page.getByText('Processing: completed.', { exact: false })).toBeVisible();
  const unchanged: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(unchanged.capabilities.access?.state, 'free'); assert.equal(unchanged.capabilities.commerce, 'disabled');
  await f.context.route('https://checkout.stripe.com/c/pay/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<html><body><h1>Synthetic hosted sandbox</h1><a href="${f.origin}/billing?attempt=${row.id}&cancelled=true">Return without payment</a></body></html>` }));
  await page.getByRole('button', { name: 'Open hosted sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic hosted sandbox' })).toBeVisible();
  await page.getByRole('link', { name: 'Return without payment' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  Object.assign([...f.sessions.values()][0], { status: 'complete', payment_status: 'paid', subscription: 'sub_SyntheticBrowser', url: null });
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click();
  const accepted = await refreshing; assert.equal(accepted.status(), 200, await accepted.text());
  await f.complete('billing.checkout.refresh');
  await expect(page.getByText(/Sandbox session completed; payment display: paid/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'free');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.ok(f.requests.some(request => request.path.endsWith('/open')));
  assert.ok(f.requests.some(request => request.path.endsWith('/refresh')));
});

test('actual managed browser opens only its restricted Portal and a forged hosted return never grants Pro or proves a card update', { timeout: 60000 }, async t => {
  const f = await fixture(t, false, true), { page } = f;
  await expect(page.getByRole('button', { name: 'Open restricted sandbox Portal' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open restricted sandbox Portal' })).toBeEnabled();
  await page.route('https://billing.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<html><body><h1>Synthetic restricted Portal</h1><a href="${f.origin}/billing?portal=returned&paid=true&plan=pro">Return with untrusted claims</a></body></html>` }));
  await page.getByRole('button', { name: 'Open restricted sandbox Portal' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic restricted Portal' })).toBeVisible();
  assert.match(page.url(), /^https:\/\/billing\.stripe\.com\/p\/session\?secret=test_/);
  await page.getByRole('link', { name: 'Return with untrusted claims' }).click();
  await expect(page.getByText(/return message cannot prove a card update or payment/)).toBeVisible();
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'free'); assert.equal(final.capabilities.commerce, 'disabled');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  assert.equal((await f.db.prepare('SELECT state FROM stripe_portal_access').get())?.state, 'issued');
  assert.deepEqual(f.requests.filter(request => request.path === '/api/billing/portal').map(request => request.body), [{}]);
  const local = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const text = await page.locator('body').innerText();
  for (const secret of ['test_SyntheticRestricted', 'bps_Synthetic', 'cus_Synthetic', 'bpc_SyntheticRestricted', 'pmc_SyntheticCardOnly']) {
    assert.ok(!local.includes(secret)); assert.ok(!text.includes(secret));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});

test('a lost actual Portal response can be deliberately retried as a new audited ephemeral session, never a replacement financial intent', { timeout: 60000 }, async t => {
  const f = await fixture(t, false, true), { page } = f;
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open restricted sandbox Portal' })).toBeEnabled();
  await page.route('**/api/billing/portal', async route => {
    const source = new URL(route.request().url()), target = new URL(source); target.hostname = '127.0.0.1';
    const response = await route.fetch({ url: target.href, headers: { ...route.request().headers(), host: source.host } });
    assert.equal(response.status(), 200); await route.abort();
  });
  await page.getByRole('button', { name: 'Open restricted sandbox Portal' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/fetch|network/i);
  assert.equal(f.portals.size, 1);
  await page.unroute('**/api/billing/portal');
  await page.route('https://billing.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: `<html><body><h1>Fresh synthetic Portal</h1><a href="${f.origin}/billing?portal=returned">Return without payment</a></body></html>` }));
  await page.getByRole('button', { name: 'Open restricted sandbox Portal' }).click();
  await expect(page.getByRole('heading', { name: 'Fresh synthetic Portal' })).toBeVisible();
  assert.equal(f.portals.size, 2);
  const rows = await f.db.prepare('SELECT id,state FROM stripe_portal_access').all();
  assert.equal(new Set(rows.map(row => row.id)).size, 2); assert.ok(rows.every(row => row.state === 'issued'));
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 1);
  assert.equal(f.customers.size, 1); assert.equal(f.subscriptions.length, 0);
  await page.getByRole('link', { name: 'Return without payment' }).click();
  await expect(page.getByText(/return message cannot prove a card update or payment/)).toBeVisible();
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'free');
});

test('an unknown request after an expired session retains its new UUID and offer through reload, never silently replacing the intent', { timeout: 60000 }, async t => {
  const f = await fixture(t), { page } = f;
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  Object.assign([...f.sessions.values()][0], { status: 'expired', url: null });
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click();
  const accepted = await refreshing;
  assert.equal(accepted.status(), 200, await accepted.text());
  await f.complete('billing.checkout.refresh');
  await expect(page.getByRole('button', { name: 'Prepare sandbox checkout' })).toBeVisible();
  await page.route('**/api/billing/checkouts', route => route.abort());
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/fetch|network/i);
  const failed = f.requests.filter(request => request.path === '/api/billing/checkouts').at(-1)?.body;
  assert.ok(failed && typeof failed === 'object' && 'key' in failed);
  await page.unroute('**/api/billing/checkouts');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry saved sandbox request' })).toBeDisabled();
  await expect(page.getByLabel('Reference offer')).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Retry saved sandbox request' }).click();
  await expect(page.getByRole('button', { name: 'Retry saved sandbox request' })).toHaveCount(0);
  const posts = f.requests.filter(request => request.path === '/api/billing/checkouts');
  assert.deepEqual(posts.at(-1)?.body, failed);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_checkout_attempts').get())?.count, 2);
  assert.equal(f.customers.size, 1);
});

test('corrupt saved retry information blocks browser reservation instead of silently replacing its request key', async t => {
  const f = await fixture(t), { page } = f;
  await page.evaluate(async () => {
    const data: Bootstrap = await (await fetch('/api/bootstrap')).json();
    if (!data.user) throw new Error('A synthetic authenticated owner is required.');
    sessionStorage.setItem(`studio-sandbox-checkout:${data.user.id}`, '{"key":"unknown-outcome","offer":"pro_monthly"}');
  });

  await page.reload();
  await expect(page.getByRole('alert').first()).toContainText('saved sandbox request is invalid');
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await expect(page.getByRole('button', { name: 'Prepare sandbox checkout' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload owned status' }).click();
  await expect(page.getByRole('button', { name: 'Prepare sandbox checkout' })).toBeDisabled();
  assert.equal(f.requests.filter(request => request.path === '/api/billing/checkouts').length, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM stripe_owned_customers').get())?.count, 0);
});

test('actual owned browser displays canonical invoice and cancellation observations without confusing them with paid access', { timeout: 60000 }, async t => {
  const f = await fixture(t), { page } = f;
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  const facts = await f.settleCheckout();
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click();
  assert.equal((await refreshing).status(), 200);
  await f.complete('billing.checkout.refresh');
  await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Observed invoice: paid/)).toBeVisible();
  await expect(page.getByText(/Operator review required: commercial policy pending/)).toBeVisible();
  await expect(page.getByText(/Referenced card funding: settled/)).toBeVisible();
  await expect(page.getByText(/These amounts do not prove an eligible paid service period/)).toBeVisible();
  facts.sub.cancel_at_period_end = true;
  const requested = page.waitForResponse(response => response.url().endsWith('/api/billing/reconcile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical ledger' }).click();
  assert.equal((await requested).status(), 202);
  await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Renewal is disabled/)).toBeVisible();
  const refund = { id: 're_SyntheticBrowser', object: 'refund', charge: facts.charge.id, payment_intent: facts.intent.id,
    customer: facts.charge.customer, currency: 'usd', amount: 500, status: 'succeeded' };
  f.refunds.set(refund.id, refund); facts.charge.amount_refunded = 500;
  await f.notify('refund', refund, 'refund.updated'); await f.complete('billing.reconcile'); await f.complete('billing.customer.snapshot');
  await page.reload();
  await expect(page.getByText(/Referenced card funding: partially refunded; captured: 1900; succeeded refunds: 500/)).toBeVisible();
  await expect(page.getByText(/Operator review required: commercial policy pending, payment refunded/)).toBeVisible();
  const data: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(data.capabilities.access?.state, 'free'); assert.equal(data.capabilities.commerce, 'disabled');
  const text = await page.locator('body').innerText();
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'pi_Synthetic', 'ch_Synthetic', 're_Synthetic',
    'private-fixture-client-secret', 'private-fixture-contact', 'private-card-contact']) assert.ok(!text.includes(secret));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});

test('explicit sandbox service proof refreshes actual browser permissions, then a scoped refund retires Pro without reload or a live purchase', { timeout: 60000 }, async t => {
  const f = await fixture(t, true), { page } = f;
  await expect(page.getByText(/expiring sandbox service access/)).toBeVisible();
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  const facts = await f.settleCheckout();
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click();
  assert.equal((await refreshing).status(), 200);
  let release!: () => void, captured!: () => void, intercepted = false;
  const blocked = new Promise<void>(resolve => { release = resolve; }), stale = new Promise<void>(resolve => { captured = resolve; });
  f.cleanup.push(async () => { release(); });
  await f.context.route(`${f.origin}/api/bootstrap`, async route => {
    if (intercepted) return route.continue();
    intercepted = true;
    const source = new URL(route.request().url()), target = new URL(source); target.hostname = '127.0.0.1';
    const response = await route.fetch({ url: target.href, headers: { ...route.request().headers(), host: source.host } });
    captured(); await blocked; await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await stale;
  const delivered = page.waitForResponse(async response => {
    if (!response.url().endsWith('/api/billing') || response.status() !== 200) return false;
    const data: SandboxBillingView = await response.json();
    return data.ledger?.invoices.some(invoice => invoice.service?.state === 'granted') ?? false;
  });
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  await delivered; release();
  await expect(page.getByText(/Sandbox service access: granted/)).toBeVisible();
  await page.getByRole('link', { name: 'Premium Studio', exact: true }).first().click();
  await expect(page.getByText('Pro access active', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/Sandbox service access: granted/)).toBeVisible();
  const refund = { id: 're_ServiceBrowser', object: 'refund', charge: facts.charge.id, payment_intent: facts.intent.id,
    customer: facts.charge.customer, currency: 'usd', amount: 500, status: 'succeeded' };
  f.refunds.set(refund.id, refund); facts.charge.amount_refunded = 500;
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/billing/reconcile') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical ledger' }).click(); assert.equal((await refreshed).status(), 202);
  await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Sandbox service access: revoked/)).toBeVisible();
  await page.getByRole('link', { name: 'Premium Studio', exact: true }).first().click();
  await expect(page.getByText('Check access on Account', { exact: true })).toBeVisible();
  const data: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(data.capabilities.access?.state, 'free'); assert.equal(data.capabilities.commerce, 'disabled');
});

test('actual owned browser recovers an unknown cancellation response without replacing the intent, confirms renewal stopped and retains paid access', { timeout: 60000 }, async t => {
  const f = await fixture(t, true), { page } = f;
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  const facts = await f.settleCheckout();
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click(); assert.equal((await refreshing).status(), 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Sandbox service access: granted/)).toBeVisible();
  const grant = await f.db.prepare('SELECT id,ends_at,request_hash FROM entitlement_grants').get();
  const pattern = '**/api/billing/subscriptions/*/cancel';
  await page.route(pattern, async route => {
    const source = new URL(route.request().url()), target = new URL(source); target.hostname = '127.0.0.1';
    const accepted = await route.fetch({ url: target.href, headers: { ...route.request().headers(), host: source.host } });
    assert.equal(accepted.status(), 202); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Stop sandbox renewal' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/fetch|network/i);
  const intent = await f.db.prepare('SELECT id FROM stripe_subscription_cancellations').get(); assert.ok(intent);
  assert.equal(facts.sub.cancel_at_period_end, false);
  await page.unroute(pattern);
  const accepted = page.waitForResponse(response => response.url().endsWith('/cancel') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Stop sandbox renewal' }).click(); assert.equal((await accepted).status(), 202);
  await expect(page.getByText(/Sandbox cancellation: queued/)).toBeVisible();
  assert.deepEqual(await f.db.prepare('SELECT id FROM stripe_subscription_cancellations').get(), intent);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.cancel'").get())?.count, 1);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Sandbox cancellation: confirmed/)).toBeVisible();
  await expect(page.getByText(/Renewal is disabled/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sandbox renewal' })).toHaveCount(0);
  assert.deepEqual(await f.db.prepare('SELECT id,ends_at,request_hash FROM entitlement_grants').get(), grant);
  await page.getByRole('link', { name: 'Premium Studio', exact: true }).first().click();
  await expect(page.getByText('Pro access active', { exact: true })).toBeVisible();
  await page.goBack(); await expect(page.getByText(/Sandbox cancellation: confirmed/)).toBeVisible();
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'pro'); assert.equal(final.capabilities.commerce, 'disabled');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const text = await page.locator('body').innerText();
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'price_Synthetic', 'studio_customer_ref', 'authEpoch']) assert.ok(!text.includes(secret));
});

async function scheduledCancellation(f: Awaited<ReturnType<typeof fixture>>) {
  const { page } = f;
  await page.getByRole('checkbox', { name: /I understand this is sandbox-only/ }).check();
  await page.getByRole('button', { name: 'Prepare sandbox checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Your sandbox checkout' })).toBeVisible();
  await f.complete('billing.customer'); await f.complete('billing.checkout');
  await expect(page.getByRole('button', { name: 'Open hosted sandbox checkout' })).toBeVisible();
  const facts = await f.settleCheckout();
  const refreshing = page.waitForResponse(response => response.url().endsWith('/refresh') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh canonical session' }).click(); assert.equal((await refreshing).status(), 200);
  await f.complete('billing.checkout.refresh'); await f.complete('billing.customer.snapshot'); await f.complete('billing.customer.snapshot');
  await expect(page.getByRole('button', { name: 'Stop sandbox renewal' })).toBeEnabled();
  const stopping = page.waitForResponse(response => response.url().endsWith('/cancel') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Stop sandbox renewal' }).click(); assert.equal((await stopping).status(), 202);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  await expect(page.getByRole('button', { name: 'Resume sandbox renewal' })).toBeVisible();
  return facts;
}

test('actual browser requires inline same-price renewal consent and can stop again with the exact owned predecessor and fresh next-cycle consent', { timeout: 90000 }, async t => {
  const f = await fixture(t), { page } = f, facts = await scheduledCancellation(f);
  const resume = page.getByRole('button', { name: 'Resume sandbox renewal' }),
    consent = page.getByRole('checkbox', { name: /I acknowledge future automatic sandbox renewal/ });
  await expect(resume).toBeDisabled(); await expect(consent).not.toBeChecked();
  await expect(page.getByText(/at the same monthly reference offer: \$19.00/)).toBeVisible();
  await consent.check(); await expect(resume).toBeEnabled();
  const accepting = page.waitForResponse(response => response.url().endsWith('/resume') && response.request().method() === 'POST');
  await resume.click(); assert.equal((await accepting).status(), 202);
  await expect(page.getByText(/Sandbox resumption: queued/)).toBeVisible(); assert.equal(facts.sub.cancel_at_period_end, true);
  await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Sandbox resumption: confirmed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sandbox renewal' })).toBeEnabled();
  const first = await f.db.prepare('SELECT id,cancellation_id FROM stripe_subscription_resumptions').get(); assert.ok(first);
  const stopping = page.waitForResponse(response => response.url().endsWith('/cancel') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Stop sandbox renewal' }).click(); assert.equal((await stopping).status(), 202);
  await f.complete('billing.subscription.cancel'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Owned cancellation cycle: 1/)).toBeVisible();
  await expect(resume).toBeDisabled(); await expect(consent).not.toBeChecked(); await consent.check();
  const acceptingAgain = page.waitForResponse(response => response.url().endsWith('/resume') && response.request().method() === 'POST');
  await resume.click(); assert.equal((await acceptingAgain).status(), 202);
  await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  await expect(page.getByRole('button', { name: 'Stop sandbox renewal' })).toBeEnabled();
  const mutations = f.requests.filter(request => /\/subscriptions\/.+\/(cancel|resume)$/.test(request.path));
  const cancellations = await f.db.prepare('SELECT id FROM stripe_subscription_cancellations ORDER BY cycle').all();
  assert.deepEqual(mutations.map(request => request.body), [{}, { cancellationId: first.cancellation_id, acknowledged: true },
    { previousResumptionId: first.id }, { cancellationId: cancellations[1].id, acknowledged: true }]);
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'free'); assert.equal(final.capabilities.commerce, 'disabled');
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM entitlement_grants').get())?.count, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});

test('a lost actual acknowledged resumption response reuses its durable consent, confirms canonical flags and preserves paid source and archive', { timeout: 90000 }, async t => {
  const f = await fixture(t, true), { page } = f, facts = await scheduledCancellation(f);
  const owner = await f.login(undefined, 'auth0|sandbox-browser-owner'), problem = problems.find(problem => problem.premium); assert.ok(problem);
  assert.equal((await owner.browser.request('/api/mocks', { problemId: problem.id, company: 'Meta', level: 'Senior', length: 3 })).status, 200);
  const grant = await f.db.prepare('SELECT * FROM entitlement_grants').get(), events = await f.db.prepare('SELECT * FROM entitlement_events').all(),
    archive: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(archive.state.mocks.length, 1);
  const consent = page.getByRole('checkbox', { name: /I acknowledge future automatic sandbox renewal/ });
  await consent.check();
  const pattern = '**/api/billing/subscriptions/*/resume';
  await page.route(pattern, async route => {
    const source = new URL(route.request().url()), target = new URL(source); target.hostname = '127.0.0.1';
    const accepted = await route.fetch({ url: target.href, headers: { ...route.request().headers(), host: source.host } });
    assert.equal(accepted.status(), 202); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Resume sandbox renewal' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/fetch|network/i);
  const intent = await f.db.prepare('SELECT id FROM stripe_subscription_resumptions').get(); assert.ok(intent);
  assert.equal(facts.sub.cancel_at_period_end, true); await page.unroute(pattern);
  const accepted = page.waitForResponse(response => response.url().endsWith('/resume') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Resume sandbox renewal' }).click(); assert.equal((await accepted).status(), 202);
  await expect(page.getByText(/Sandbox resumption: queued/)).toBeVisible();
  assert.deepEqual(await f.db.prepare('SELECT id FROM stripe_subscription_resumptions').get(), intent);
  assert.equal((await f.db.prepare("SELECT count(*)::integer AS count FROM durable_operations WHERE kind='billing.subscription.resume'").get())?.count, 1);
  await f.complete('billing.subscription.resume'); await f.complete('billing.customer.snapshot');
  await expect(page.getByText(/Sandbox resumption: confirmed/)).toBeVisible();
  await expect(page.getByText(/No cancellation-at-period-end flag observed/)).toBeVisible();
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_grants').get(), grant);
  assert.deepEqual(await f.db.prepare('SELECT * FROM entitlement_events').all(), events);
  const final: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(final.capabilities.access?.state, 'pro'); assert.equal(final.capabilities.commerce, 'disabled');
  assert.deepEqual(final.state.mocks, archive.state.mocks);
  const text = await page.locator('body').innerText(), storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of ['cus_Synthetic', 'sub_Synthetic', 'price_Synthetic', 'eligibilityProof', 'authEpoch']) {
    assert.ok(!text.includes(secret)); assert.ok(!storage.includes(secret));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
});
