import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { openIdentityFixture } from './fixtures/identity';

async function fixture(t: TestContext) {
  const f = await openIdentityFixture();
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
