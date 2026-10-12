import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
import { z } from 'zod';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import { navigationTracks } from '../shared/public-navigation';
import { tracks } from '../shared/public-tracks';

const manifestSchema = z.record(z.string(), z.object({
  file: z.string(),
  imports: z.array(z.string()).optional(),
  css: z.array(z.string()).optional(),
  assets: z.array(z.string()).optional(),
}));
const manifest = manifestSchema.parse(JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')));
function graph(...roots: string[]) {
  const seen = new Set<string>(), files = new Set<string>();
  function visit(key: string) {
    if (seen.has(key)) return;
    seen.add(key);
    const item = manifest[key];
    assert.ok(item, `Missing manifest module: ${key}`);
    assert.match(item.file, /^assets\/[\w.-]+\.js$/);
    files.add(item.file);
    for (const dependency of item.imports ?? []) visit(dependency);
  }
  roots.forEach(visit);
  return [...files].sort();
}
async function fixture(t: TestContext) {
  const parent = path.resolve('data/screen-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'screens-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await startServer(loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', LOG_REQUESTS: 'false', DATA_DIR: directory }));
  t.after(() => runtime.close());
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(), documents: string[] = [], mutations: string[] = [];
  page.on('request', requested => {
    if (new URL(requested.url()).origin !== runtime.url) return;
    if (requested.isNavigationRequest() && requested.frame() === page.mainFrame()) documents.push(requested.url());
    if (!['GET', 'HEAD'].includes(requested.method())) mutations.push(new URL(requested.url()).pathname);
  });
  return { ...runtime, browser, context, page, documents, mutations };
}

test('complete eager, landing and sign-in JavaScript graphs meet fixed raw/gzip budgets without deferred discovery modules', async t => {
  assert.deepEqual(navigationTracks, tracks.map(({ id, title, short, description, color }) => ({ id, title, short, description, color })));
  for (const [label, roots] of [
    ['entry', ['index.html']],
    ['landing', ['index.html', 'src/pages/Landing.tsx']],
    ['auth', ['index.html', 'src/pages/Auth.tsx']],
  ] as const) {
    let raw = 0, gzip = 0;
    const files = graph(...roots);
    for (const file of files) {
      assert.doesNotMatch(file, /\/(?:Home|Explore|Learn|Practice|Projects|Premium|Quiz|components|public-(?:tracks|problems|courses|quiz))-/);
      const bytes = await readFile(path.join('dist', file));
      raw += bytes.length;
      gzip += gzipSync(bytes).length;
    }
    t.diagnostic(`${label}: ${raw} raw bytes, ${gzip} gzip-estimate bytes across ${files.length} JavaScript assets.`);
    assert.ok(raw <= 350 * 1024, `${label} raw graph exceeds 350 KiB: ${raw}`);
    assert.ok(gzip <= 100 * 1024, `${label} gzip estimate exceeds 100 KiB: ${gzip}`);
  }
});

test('every manifest asset is present and served as its actual bytes, not a successful HTML fallback', async t => {
  const f = await fixture(t);
  const files = new Set(Object.values(manifest).flatMap(item => [item.file, ...item.css ?? [], ...item.assets ?? []]));
  for (const file of files) {
    assert.match(file, /^assets\/[\w.-]+$/);
    const expected = await readFile(path.join('dist', file)), response = await fetch(`${f.url}/${file}`);
    assert.equal(response.status, 200, file);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, file);
    if (file.endsWith('.js')) assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
});

test('cold real-browser landing and sign-in request exactly their static dependency closures', async t => {
  const f = await fixture(t);
  for (const [route, module, heading] of [
    ['/', 'src/pages/Landing.tsx', 'Great interviews start with a little practice.'],
    ['/auth', 'src/pages/Auth.tsx', 'Welcome back.'],
  ] as const) {
    const context = await f.browser.newContext(), page = await context.newPage(), requested = new Set<string>();
    try {
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === f.url && url.pathname.endsWith('.js')) requested.add(url.pathname.slice(1));
      });
      await page.goto(`${f.url}${route}`);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      assert.deepEqual([...requested].sort(), graph('index.html', module));
      if (route === '/auth') await expect(page.getByText('Revisit the questions you missed', { exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});

test('a delayed built route shows accessible loading while the same shell and its state stay usable', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`**/${manifest['src/pages/Quiz.tsx'].file}`, async route => { await gate; await route.continue(); });
  await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading screen' })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  release();
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading screen' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('query-only search updates preserve focus and the selected category', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/search`);
  const main = page.locator('main'), input = main.getByRole('textbox', { name: 'Search the Studio', exact: true });
  await main.getByRole('button', { name: 'Lessons', exact: true }).click();
  let query = '';
  for (const character of 'caching') {
    query += character;
    await input.press(character);
    await expect(page).toHaveURL(`${f.url}/search?q=${query}`);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(query);
    await expect(main.getByRole('button', { name: 'Lessons', exact: true })).toHaveClass('active');
  }
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('healthy account aliases preserve unsaved state, while an actual owner change clears it', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/auth`);
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await page.locator('.sidebar-profile').click();
  await page.getByLabel('Display name').fill('Unsaved synthetic account draft');
  await page.evaluate(() => {
    history.pushState({}, '', '/settings');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByLabel('Display name')).toHaveValue('Unsaved synthetic account draft');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Great interviews start with a little practice.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Your Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await page.locator('.sidebar-profile').click();
  await expect(page.getByLabel('Display name')).not.toHaveValue('Unsaved synthetic account draft');
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, ['/api/auth/demo', '/api/logout', '/api/auth/demo']);
});

for (const failure of ['missing-chunk', 'render-error'] as const) {
  test(`a ${failure} is explicit, permits navigation and recovers only after deliberate reload without replay`, async t => {
    const f = await fixture(t), { page } = f, asset = `**/${manifest['src/pages/Quiz.tsx'].file}`;
    await page.goto(`${f.url}/auth`);
    await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
    const savedBefore = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
    const mutationsBefore = [...f.mutations];
    let attempts = 0;
    await page.route(asset, route => {
      attempts++;
      return failure === 'missing-chunk'
        ? route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Synthetic asset outage.' })
        : route.fulfill({ contentType: 'text/javascript', body: "export function QuizIndex(){throw new Error('Synthetic private error detail');} export function QuizRunner(){return null;}" });
    });
    await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('No action was retried');
    await expect(page.getByText('Synthetic private error detail', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reloading may discard unsaved changes on this page.', { exact: true })).toBeVisible();
    assert.ok(attempts > 0);
    const failedAttempts = attempts;
    await page.getByRole('link', { name: 'Your dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toBeVisible();
    assert.equal(attempts, failedAttempts);
    assert.equal(f.documents.length, 1);
    assert.deepEqual(f.mutations, mutationsBefore);
    await page.unroute(asset);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
    assert.equal(f.documents.length, 2);
    assert.deepEqual(f.mutations, mutationsBefore);
    const savedAfter = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
    assert.deepEqual(savedAfter.user, savedBefore.user);
    assert.deepEqual(savedAfter.state, savedBefore.state);
  });
}
