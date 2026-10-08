import { test, expect } from '@playwright/test';
import { problems } from '../shared/catalog';
import { contentSources } from '../shared/content/sources';

test('coding discovery connects sourced lessons, dedicated practice and actual reference solutions', async ({ page }) => {
  await page.goto('/learn/code');
  await expect(page.locator('.lesson-row')).toHaveCount(24);
  await expect(page.getByRole('link', { name: 'Explore the course', exact: false })).toHaveAttribute('href', '/learn/courses/coding-complete');
  await expect(page.getByRole('link', { name: 'Browse practice', exact: false })).toHaveAttribute('href', '/practice/code');
  await page.getByRole('link', { name: 'Browse worked solutions', exact: false }).click();
  await expect(page.locator('.learning-index .track-card')).toHaveCount(24);
  const problem = problems.find(problem => problem.id === 'alg-frequent-tags')!;
  await page.goto('/practice/code');
  await expect(page.locator('.practice-item')).toHaveCount(24);
  await page.getByRole('link', { name: `Read worked solution: ${problem.title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/code\/alg-frequent-tags\/writeup$/);
  await expect(page.getByRole('heading', { name: 'Complexity and assumptions' })).toBeVisible();
  await expect(page.locator('.coding-example')).toHaveCount(problem.testCases!.length);
  await expect(page.locator('.content-sources a')).toHaveCount(problem.solution!.sourceIds.length);
  await expect(page.locator('.case-followup pre')).not.toBeVisible();
  await page.getByText('Reveal reference implementation', { exact: false }).click();
  await expect(page.locator('.case-followup pre code')).toHaveText(problem.solution!.code);
  await page.goto(`/search?q=${encodeURIComponent(problem.title)}`);
  await page.getByRole('button', { name: 'Coding solutions', exact: true }).click();
  await expect(page.locator('.search-results a[href="/practice/code/alg-frequent-tags/writeup"]')).toBeVisible();
  await page.goto('/learn/code/prefix-sum');
  await expect(page.getByRole('heading', { name: 'What you will learn' })).toBeVisible();
  await expect(page.locator('.algorithm-lab')).toHaveCount(0);
  await expect(page.locator(`.content-sources a[href="${contentSources['mit-algorithms'].url}"]`)).toBeVisible();
  await page.goto('/learn/code/two-pointers');
  await expect(page.locator('.algorithm-lab')).toHaveCount(1);
  await page.goto('/learn/code/dynamic-programming');
  await expect(page.getByRole('heading', { name: 'A deeper practice opportunity.' })).toBeVisible();
});

test('every authored reference also executes through the browser worker and its serialization contract', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/learn/code/solutions');
  const checks = await page.evaluate(async exercises => {
    const path = '/src/sandbox.ts';
    const sandbox: typeof import('../src/sandbox') = await import(path);
    const results = [];
    for (const exercise of exercises) results.push({ id: exercise.id, results: await sandbox.runCode(exercise.code, exercise.cases) });
    return results;
  }, problems.filter(problem => problem.track === 'code').map(problem => ({ id: problem.id, code: problem.solution!.code, cases: problem.testCases! })));
  expect(checks).toHaveLength(24);
  for (const check of checks) for (const result of check.results) expect(result.passed, `${check.id}: ${result.label}: ${result.error || result.actual}`).toBe(true);
  await expect(page.locator('iframe[title="Isolated code runner"]')).toHaveCount(0);
});

test('coding readers and navigation stay bounded on mobile in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/practice/code/alg-chain-reverse/writeup');
  await page.getByText('Reveal reference implementation', { exact: false }).click();
  for (let theme = 0; theme < 2; theme++) {
    await expect(page.locator('.case-followup pre')).toBeVisible();
    await expect(page.locator('.content-sources')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  }
  await page.goto('/learn/code');
  await expect(page.getByRole('link', { name: 'Browse worked solutions', exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto('/practice');
  await expect(page.locator('.learning-index .track-card')).toHaveCount(6);
  await expect(page.locator('.learning-index a[href="/practice/code"]')).toContainText('24 exercises');
});
