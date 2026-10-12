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
  context.on('request', requested => {
    const url = new URL(requested.url());
    if (url.origin !== f.origin) return;
    if (!['GET', 'HEAD'].includes(requested.method())) {
      mutations.push(url.pathname);
      assert.ok(requested.headers()['x-csrf-token'], `${url.pathname} needs a CSRF token in the actual browser.`);
    }

  });
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

test('managed browser reads bounded private-safe community pages, independent details and body-only global matches without write authority',async t=>{
  const f=await fixture(t),{page}=f;
  await page.goto(`${f.origin}/auth`);await page.getByRole('link',{name:'Continue with Google'}).click();
  await expect(page.getByRole('heading',{name:'Sign-in and security.'})).toBeVisible();
  const bootstrap:Bootstrap=await page.evaluate(async()=>(await fetch('/api/bootstrap')).json());assert.ok(bootstrap.user);
  const owner=bootstrap.user.id,firstId='managed/..?#%\\';
  const seed=async(start:number)=>{
    for(let index=start;index<9;index++)await f.db.prepare('INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(index===0?firstId:`managed-community-${index}`,'questions',`Managed community question ${index}`,
        `${'Original detail. '.repeat(30)} body-only-community-needle`,index===0?'Custom company':'Fixture Company',
        'system-design','Senior','Global','THIS STORED QUESTION NAME MUST NOT BE PUBLIC',owner,`2026-01-${String(index+1).padStart(2,'0')}T00:00:00.000Z`);
  };
  await seed(0);
  await page.goto(`${f.origin}/community/questions`);
  await expect(page.locator('.community-card')).toHaveCount(6);
  await expect(page.getByText('9 results',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Upvote: Managed community question 8'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Add a question',exact:true})).toHaveCount(0);
  await expect(page.getByText('THIS STORED QUESTION NAME MUST NOT BE PUBLIC')).toHaveCount(0);
  await f.db.prepare('DELETE FROM posts WHERE id<>?').run(firstId);
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.locator('.community-card')).toHaveCount(1);
  await expect(page.getByText('1 results',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Previous page',exact:true})).toBeEnabled();
  await expect(page.getByText('Page 2',{exact:true})).toBeVisible();
  await seed(1);
  await page.getByRole('button',{name:'My contributions',exact:true}).click();
  await expect(page.locator('.community-card')).toHaveCount(6);
  await expect(page.getByText('Page 1',{exact:true})).toBeVisible();
  await page.getByLabel('Company filter').selectOption('Custom company');
  await expect(page.getByRole('heading',{name:'Managed community question 0'})).toBeVisible();
  await expect(page.locator('.community-card')).toHaveCount(1);
  await page.getByRole('link',{name:'View details'}).click();
  assert.equal(new URL(page.url()).searchParams.get('id'),firstId);
  await expect(page.locator('.post-body')).toContainText('body-only-community-needle');
  await expect(page.getByRole('button',{name:'0 local reports',exact:true})).toBeDisabled();
  await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  const detail=await page.evaluate(async id=>(await fetch(`/api/community/post?${new URLSearchParams({kind:'questions',id})}`)).json(),firstId);
  assert.equal(detail.isMine,true);assert.equal(detail.author,'Anonymous');assert.ok(!JSON.stringify(detail).includes(owner));assert.ok(!Object.hasOwn(detail,'authorId'));
  await page.goto(`${f.origin}/search?q=body-only-community-needle`);
  await page.locator('main').getByRole('button',{name:'Community',exact:true}).click();
  await expect(page.locator('.search-results h3')).toHaveCount(9);
  await expect(page.getByRole('heading',{name:'Managed community question 0'})).toBeVisible();
  assert.ok(!f.mutations.some(path=>path.startsWith('/api/posts')||path.startsWith('/api/community/posts')));
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

test('managed support preserves a retry key after a lost response, shows private paginated history and clears it on sign-out', { timeout: 90000 }, async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.origin}/auth`); await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('heading', { name: 'Sign-in and security.' })).toBeVisible();
  const data: Bootstrap = await page.evaluate(async () => (await fetch('/api/bootstrap')).json()); assert.ok(data.user);
  for (let index = 0; index < 12; index++) await f.db.prepare('INSERT INTO support(id,user_id,email,body,created_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(), data.user.id, 'old-support@example.invalid', `A private older saved request number ${index}.`, '2026-01-01T00:00:00.000Z');
  await page.goto(`${f.origin}/support`);
  await expect(page.getByRole('heading', { name: 'Your saved requests' })).toBeVisible();
  await expect(page.locator('.support-receipt')).toHaveCount(10);
  await page.getByRole('button', { name: 'Load older requests' }).click();
  await expect(page.locator('.support-receipt')).toHaveCount(12);
  const privateBody = `A private saved browser request ${'without an external delivery claim '.repeat(12)}.`;
  await page.getByLabel('Support question').fill(privateBody);
  const keys: string[] = [];
  f.context.on('request', requested => {
    if (new URL(requested.url()).pathname === '/api/support' && requested.method() === 'POST') {
      const body: unknown = requested.postDataJSON();
      assert.ok(body && typeof body === 'object' && 'key' in body && typeof body.key === 'string'); keys.push(body.key);
    }
  });
  const loseResponse: Parameters<typeof page.route>[1] = async route => {
    const url=new URL(route.request().url());url.hostname='127.0.0.1';
    const response=await route.fetch({ url:url.href,headers:{ ...await route.request().allHeaders(),host:new URL(f.origin).host } });
    assert.equal(response.status(),200);await route.abort('failed');
  };
  await page.route('**/api/support', loseResponse);
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByLabel('Support question')).toHaveValue(privateBody);
  await expect(page.getByRole('button', { name: 'Save request', exact: true })).toBeEnabled();
  await page.unroute('**/api/support');
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request saved.' })).toBeVisible();
  await expect(page.getByText('No external delivery occurred.', { exact: true })).toBeVisible();
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support WHERE request_key=?').get(keys[0]))?.count, 1);
  await expect(page.locator('.support-receipt').getByText(privateBody, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Write another request' }).click();
  const uncertain='A separate request whose successful response was lost after storage.';
  await page.getByLabel('Support question').fill(uncertain);
  await page.route('**/api/support',loseResponse);
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start a separate request' })).toBeVisible();
  await page.unroute('**/api/support');
  await page.getByRole('button', { name: 'Refresh saved requests' }).click();
  await expect(page.locator('.support-receipt').getByText(uncertain, { exact: true })).toBeVisible();
  const edited='An intentional new request with edited content after checking saved history.';
  await page.getByLabel('Support question').fill(edited);
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByText(/key already belongs to different saved content/)).toBeVisible();
  await page.getByRole('button', { name: 'Start a separate request' }).click();
  await expect(page.getByLabel('Support question')).toHaveValue(edited);
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request saved.' })).toBeVisible();
  assert.equal(keys[2],keys[3]);assert.notEqual(keys[3],keys[4]);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM support WHERE user_id=?').get(data.user.id))?.count,15);
  await page.route('**/api/support/requests', route => route.fulfill({ status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: 'Synthetic support history outage.' }) }));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Synthetic support history outage.');
  await page.unroute('**/api/support/requests');
  await page.getByRole('button', { name: 'Reload saved requests' }).click();
  await expect(page.locator('.support-receipt').getByText(privateBody, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${f.origin}/account`); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(`${f.origin}/support`);
  await expect(page.getByRole('heading', { name: 'Your saved requests' })).toHaveCount(0);
  await expect(page.getByText(privateBody, { exact: true })).toHaveCount(0);
});

test('pending managed contact can save a support request without acquiring a verified contact or product permission', async t => {
  const f = await fixture(t), { page } = f;
  f.setSubject('github|pending-support-browser'); f.setClaims({ email: undefined, email_verified: undefined });
  await page.goto(`${f.origin}/auth`); await page.getByRole('link', { name: 'Continue with GitHub' }).click();
  await expect(page.getByRole('heading', { name: 'A verified contact email is needed' })).toBeVisible();
  await page.goto(`${f.origin}/support`);
  await page.getByLabel('Contact email').fill('unverified-support@example.invalid');
  await page.getByLabel('Support question').fill('A pending contact needs information about the supported verification process.');
  await page.getByRole('button', { name: 'Save request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Request saved.' })).toBeVisible();
  await expect(page.locator('.support-receipt')).toHaveCount(1);
  assert.equal((await f.db.prepare('SELECT contact_verified FROM managed_accounts').get())?.contact_verified, 0);
  assert.equal((await f.db.prepare('SELECT count(*)::integer AS count FROM durable_operations').get())?.count, 0);
});
