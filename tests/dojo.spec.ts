import { test, expect } from './browser-fixtures';
import { dojoLessons } from '../shared/content/dojo-lessons';
import { contentSources } from '../shared/content/sources';
import { courses } from '../shared/courses';
import { browserOrigin } from './browser-account';

test('Dojo-topic courses are discoverable and retain original native content and references', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/learn/ml-system-design');
  await expect(page.locator('.lesson-row')).toHaveCount(24);
  for (const id of ['model-behavior', 'inference-economics', 'prompt-contracts']) {
    const course = courses.find(course => course.id === id)!;
    await page.goto('/learn/ml-system-design');
    await page.getByRole('link', { name: course.title, exact: false }).click();
    await expect(page.locator('.course-hero')).toContainText(`0 of ${course.units.flatMap(unit => unit.steps).length} steps complete`);
    await expect(page.locator(`.content-sources a[href="${contentSources['dojo-topic-map'].url}"]`)).toBeVisible();
    const first = course.units[0].steps[0];
    await page.locator(`.course-step[href="${first.to}"]`).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
    await expect(page.locator('.learning-flow')).toHaveCount(1);
    await expect(page.locator('.ai-visual-lab')).toHaveCount(1);
  }
  await page.goto('/search?q=causal%20attention');
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  await expect(page.locator('.search-results a[href="/learn/courses/model-behavior"]')).toBeVisible();
  await page.goto('/search?q=probability%20bookkeeping');
  await page.getByRole('button', { name: 'Lessons', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search the Studio' }).fill('decoding');
  await expect(page.locator('.search-results a[href="/learn/ml-system-design/decoding-controls"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every flow supports direct selection, next/back, reset, and keyboard without autoplay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const lesson of dojoLessons) {
    const flow = lesson.sections.find(section => section.flow)!.flow!;
    await page.goto(`/learn/ml-system-design/${lesson.id}`);
    const figure = page.getByRole('figure', { name: flow.title, exact: true });
    await expect(figure.getByRole('img')).toBeVisible();
    await expect(figure.locator('.learning-flow-detail')).toContainText(flow.steps[0].detail);
    await expect(figure.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await figure.getByRole('button', { name: 'Next step', exact: false }).click();
    await expect(figure.locator('[aria-current="step"]')).toHaveText(`2. ${flow.steps[1].title}`);
    await expect(figure.locator('.learning-flow-detail')).toContainText(flow.steps[1].detail);
    await figure.getByRole('button', { name: `4. ${flow.steps[3].title}`, exact: true }).click();
    await expect(figure.getByRole('button', { name: 'Next step', exact: false })).toBeDisabled();
    await figure.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(figure.locator('[aria-current="step"]')).toHaveText(`3. ${flow.steps[2].title}`);
    await figure.getByRole('button', { name: `Reset ${flow.title}`, exact: true }).click();
    const second = figure.getByRole('button', { name: `2. ${flow.steps[1].title}`, exact: true });
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-current', 'step');
    await expect(figure.locator('.learning-flow-detail')).toContainText(flow.steps[1].detail);
  }
});

test('native visual controls update exact calculations without model calls or account mutations', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
    if (new URL(request.url()).origin !== new URL(browserOrigin).origin) external.push(request.url());
  });
  await page.goto('/learn/ml-system-design/attention-mechanics');
  await expect(page.locator('.attention-matrix .masked')).toHaveCount(6);
  await page.getByRole('combobox', { name: 'Query position', exact: true }).click();
  await page.getByRole('option', { name: 'Query 4: retry', exact: true }).click();
  await expect(page.locator('.ai-visual-lab [role="status"]')).toContainText('Query 4 can use 4 of 4 positions');
  const original = await page.locator('.attention-matrix tbody tr').last().innerText();
  await page.getByRole('slider', { name: 'Self-attention score', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.attention-matrix tbody tr').last()).not.toHaveText(original);
  await expect(page.locator('.attention-matrix .masked')).toHaveCount(6);
  await page.goto('/learn/ml-system-design/decoding-controls');
  await page.getByRole('slider', { name: 'Top k', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.ai-visual-lab [role="status"]')).toContainText('1 candidate remains. Total probability: 1.000');
  await page.getByRole('slider', { name: 'Temperature', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('.probability-bars output')).toHaveText(['100.0%', '0.0%', '0.0%', '0.0%', '0.0%']);
  await page.goto('/learn/ml-system-design/kv-capacity');
  await expect(page.locator('.visual-metrics')).toContainText('0.500 GiB');
  await page.getByRole('slider', { name: 'Active sequences', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics')).toContainText('8.000 GiB');
  await page.getByRole('combobox', { name: 'KV heads', exact: true }).click();
  await page.getByRole('option', { name: '1 KV head', exact: true }).click();
  await expect(page.locator('.visual-metrics')).toContainText('1.000 GiB');
  await page.goto('/learn/ml-system-design/streaming-service-levels');
  await expect(page.locator('.visual-metrics')).toContainText('2460 ms');
  await page.getByRole('slider', { name: 'Output tokens', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.visual-metrics strong')).toHaveText(['500 ms', '500 ms', 'Met']);
  await page.getByRole('slider', { name: 'Queue milliseconds', exact: true }).focus();
  await page.keyboard.press('End');
  await page.getByRole('slider', { name: 'Deadline milliseconds', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.visual-metrics strong')).toHaveText(['2400 ms', '2400 ms', 'Missed']);
  await page.goto('/learn/ml-system-design/context-contracts');
  await expect(page.locator('.visual-metrics strong')).toHaveText(['1536 tokens', '1150 tokens']);
  await page.getByRole('slider', { name: 'History tokens', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('alert').filter({ hasText: 'exceed the window' })).toBeVisible();
  await expect(page.locator('.visual-metrics strong')).toHaveText(['-1536 tokens', '0 tokens']);
  await page.getByRole('slider', { name: 'Context window tokens', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics strong')).toHaveText(['2560 tokens', '1950 tokens']);
  await page.getByRole('checkbox', { name: 'Simulate a server-authorized note', exact: false }).check();
  await expect(page.locator('.visual-metrics strong')).toHaveText(['2560 tokens', '2250 tokens']);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  expect(external).toEqual([]);
});

test('diagrams, calculators and course pages reflow at 320px in both themes with reduced motion', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/learn/ml-system-design');
  for (let theme = 0; theme < 2; theme++) {
    for (const path of [
      '/learn/ml-system-design',
      ...['model-behavior', 'inference-economics', 'prompt-contracts'].map(id => `/learn/courses/${id}`),
      ...dojoLessons.map(lesson => `/learn/ml-system-design/${lesson.id}`),
      '/search?q=attention',
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      if (dojoLessons.some(lesson => path.endsWith(`/${lesson.id}`))) {
        await expect(page.locator('.learning-flow')).toBeVisible();
        await expect(page.locator('.learning-flow-scroll')).toHaveAttribute('tabindex', '0');
        await page.locator('.learning-flow').getByRole('button', { name: 'Next step', exact: false }).click();
        await expect(page.locator('.learning-flow [aria-current="step"]')).toContainText('2.');
        await page.locator('.learning-flow-steps button').last().click();
        await expect.poll(() => page.locator('.learning-flow-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath(`${path.split('/').at(-1)}-${theme}.png`), fullPage: true });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}, theme ${theme}`).toBe(true);
    }
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/learn/ml-system-design/attention-mechanics');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('.attention-matrix .masked')).toHaveCount(6);
});
