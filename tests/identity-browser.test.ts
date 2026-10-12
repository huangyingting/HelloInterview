import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { openIdentityFixture } from './fixtures/identity';
import { Entitlements } from '../server/entitlements';
import type { Bootstrap } from '../shared/types';
import { courses } from '../shared/public-catalog';

async function fixture(t: TestContext, lifecycle = false) {
  const f = await openIdentityFixture({}, { lifecycle });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => { try { await browser?.close(); } finally { await f.close(); } });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-proxy-server', '--host-resolver-rules=MAP studio.fixture 127.0.0.1,MAP broker.fixture 127.0.0.1'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const mutations: string[] = [];
  const listeners: Promise<void>[] = [];
  context.on('request', requested => {
    const url = new URL(requested.url());
    if (url.origin !== f.origin) return;
    if (!['GET', 'HEAD'].includes(requested.method())) {
      mutations.push(url.pathname);
      listeners.push(requested.allHeaders().then(headers => { assert.ok(headers['x-csrf-token'], `${url.pathname} needs a CSRF token in the actual browser.`); }));
    }

  });
  f.cleanup.push(() => Promise.all(listeners));
  return { ...f, context, page: await context.newPage(), mutations };
}

test('real managed browser separates read-only work, expires Pro with a skewed wall clock and preserves drafts through refresh outages', { timeout: 60000 }, async t => {
  const f = await fixture(t), { page } = f;
  await f.context.addInitScript(() => { const realNow = Date.now.bind(Date); Date.now = () => realNow() + 365 * 86400000; });
  await page.goto(`${f.origin}/auth`);
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  const data: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.ok(data.user);
  const owner = data.user.id, entitlements = new Entitlements(f.db);
  const source = (policy: 'pro-v1' | 'premium-read-v1', seconds: number) => ({
    owner, source: { kind: 'engineering' as const, key: randomUUID() }, policy,
    startsAt: Date.now() - 1000, endsAt: Date.now() + seconds * 1000, evidence: { actor: 'browser-fixture', reason: 'Synthetic browser access and expiry rehearsal.' },
  });
  await entitlements.issue(source('premium-read-v1', 60));
  await page.goto(`${f.origin}/learn/system-design/replication`);
  await expect(page.getByRole('heading', { name: 'Replication and consistency', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as read', exact: true })).toBeDisabled();
  const course = courses.find(course => course.premium);
  assert.ok(course);
  await page.goto(`${f.origin}/learn/courses/${course.id}`);
  await expect(page.getByRole('button', { name: 'Enroll in this course' })).toBeDisabled();
  await entitlements.issue(source('pro-v1', 8));
  await page.goto(`${f.origin}/premium/mock`);
  await page.getByRole('button', { name: 'Start mock interview' }).click();
  await expect(page.getByLabel('Mock answer')).toBeEnabled();
  await page.getByLabel('Mock answer').fill('A saved browser answer describing ownership, idempotent retries and a durable operation boundary.');
  await page.getByRole('button', { name: 'Save interview draft' }).click();
  await expect(page.getByText('Interview draft saved.', { exact: true })).toBeVisible();
  const unsaved = 'An unsaved browser revision that must remain exportable after paid access ends.';
  await page.getByLabel('Mock answer').fill(unsaved);
  await expect(page.getByRole('heading', { name: 'Your unsaved interview draft' })).toBeVisible({ timeout: 12000 });
  await expect(page.getByText(unsaved, { exact: true })).toBeVisible();
  const persisted: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
  assert.equal(persisted.state.mocks[0].draft, 'A saved browser answer describing ownership, idempotent retries and a durable operation boundary.');
  assert.equal((await entitlements.view(owner)).state, 'read-only');
  await expect(page.getByRole('button', { name: 'Export current draft' })).toBeVisible();
  await entitlements.issue(source('pro-v1', 4));
  await page.goto(`${f.origin}/premium/mock`);
  await expect(page.getByRole('button', { name: 'Start mock interview' })).toBeVisible();
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic access refresh outage.' }) }));
  await expect(page.getByRole('heading', { name: 'Current access does not include this feature.' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Synthetic access refresh outage.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start mock interview' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your saved archive' })).toBeVisible();
  await page.unroute('**/api/bootstrap');
  await page.goto(`${f.origin}/pricing`);
  await expect(page.getByRole('heading', { name: 'Production subscriptions are not enabled yet.' })).toBeVisible();
  assert.equal((await f.db.prepare('SELECT count(*)::int AS count FROM mock_sessions').get())?.count, 1);
});

test('managed browser signs in, saves profile with CSRF, links/unlinks a fresh method and never exposes demo purchases', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.origin}/auth`);
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  await expect(page.getByText('Verified contact', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Studio sessions' })).toBeVisible();
  const cookies = await f.context.cookies(f.origin);
  const session = cookies.find(cookie => cookie.name === '__Host-studio_session');
  assert.ok(session?.secure && session.httpOnly && session.sameSite === 'Lax' && session.domain === 'studio.fixture');
  await page.getByLabel('Display name').fill('Browser member');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated.', { exact: true })).toBeVisible();
  f.setSubject('github|synthetic-browser-method');
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  await expect(page.getByRole('heading', { name: /^GitHub/ })).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Browser member');
  const google = page.getByRole('heading', { name: /^Google/ });
  await google.locator('..').getByRole('button', { name: 'Remove method' }).click();
  await expect(google).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Google' })).toBeVisible();
  assert.ok(f.mutations.includes('/api/profile'));
  assert.ok(f.mutations.includes('/api/identity/link'));
  await page.goto(`${f.origin}/premium/gift`);
  await expect(page.getByRole('heading', { name: 'Production gifts are not enabled yet.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate demo code' })).toHaveCount(0);
  await page.goto(`${f.origin}/community/questions`);
  await expect(page.getByText(/Read-only community/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a question' })).toHaveCount(0);
  await page.goto(`${f.origin}/blog/practice-with-intention`);
  await expect(page.getByText('Discussion is read-only until production moderation is enabled.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Add a comment' })).toHaveCount(0);
  await page.goto(`${f.origin}/auth?error=identity_conflict`);
  await expect(page.getByRole('alert')).toContainText('No accounts were merged');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${f.origin}/account`);
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await f.db.prepare("UPDATE managed_accounts SET status='suspended'").run();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Account access is restricted.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toHaveCount(0);
});

test('a private GitHub email has a recoverable pending screen and can activate only through explicit verified linking', async t => {
  const f = await fixture(t), { page } = f;
  f.setSubject('github|synthetic-private-browser');
  f.setClaims({ email: undefined, email_verified: undefined });
  await page.goto(`${f.origin}/auth`);
  await page.getByRole('link', { name: 'Continue with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'A verified contact email is needed' })).toBeVisible();
  await expect(page.getByText(/No substitute address was invented/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export preparation data' })).toBeDisabled();
  const owner = await f.db.prepare('SELECT user_id FROM managed_identities').get();
  f.setSubject('google-oauth2|synthetic-private-recovery');
  f.setClaims({ email: 'verified@example.invalid', email_verified: true });
  await page.getByRole('button', { name: 'Connect Google' }).click();
  await expect(page.getByText('Verified contact', { exact: true })).toBeVisible();
  const rows = await f.db.prepare('SELECT user_id FROM managed_identities').all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.user_id === owner?.user_id));
  await expect(page.getByRole('button', { name: 'Export preparation data' })).toBeEnabled();
});

test('password reset revokes an actual browser session and stale SSO recovers with fresh hosted authentication without losing work', async t => {
  const f = await fixture(t, true), { page } = f, subject = 'auth0|browser-password-reset';
  const settings = f.config.identity?.lifecycle;
  assert.ok(settings);
  f.setSubject(subject);
  const authorizations: URL[] = [];
  f.context.on('request', request => { const url = new URL(request.url()); if (url.origin === new URL(f.issuer).origin && url.pathname === '/authorize') authorizations.push(url); });
  await page.goto(`${f.origin}/auth`);
  await page.getByRole('link', { name: 'Continue with Email' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  await page.getByLabel('Display name').fill('Retained after reset');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated.', { exact: true })).toBeVisible();
  const owner = await f.db.prepare('SELECT user_id FROM managed_identities WHERE subject=?').get(subject);
  const payload = { version: 1, eventId: randomUUID(), issuer: f.issuer, subject, kind: 'password-changed', occurredAt: Date.now() - 1500 };
  const timestamp = String(Date.now()), signature = createHmac('sha256', Buffer.from(settings.hookSecret, 'hex')).update(`${timestamp}.${JSON.stringify(payload)}`).digest('hex');
  assert.equal((await f.browser().request('/webhooks/identity/password-change', payload, 'POST', { 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signature })).status, 200);
  f.setClaims({ auth_time: Math.floor(Date.now() / 1000) - 300 });
  await page.goto(`${f.origin}/auth`);
  await page.getByRole('link', { name: 'Continue with Email' }).click();
  await expect(page.getByRole('alert')).toContainText('account security changed');
  await expect(page.getByRole('link', { name: 'Continue with Email' })).toHaveAttribute('href', '/auth/login?provider=email&fresh=true');
  f.setClaims({});
  await page.getByRole('link', { name: 'Continue with Email' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Retained after reset');
  assert.equal(authorizations.at(-1)?.searchParams.get('prompt'), 'login');
  assert.equal(authorizations.at(-1)?.searchParams.get('max_age'), '0');
  assert.equal((await f.db.prepare('SELECT user_id FROM managed_identities WHERE subject=?').get(subject))?.user_id, owner?.user_id);
});
