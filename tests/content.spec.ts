import { test, expect } from './browser-fixtures';
import { problems } from '../shared/catalog';

test('practice write-ups expose worked designs, capacity, sources and follow-ups through Next.js', async ({ page }) => {
  const problem = problems.find(problem => problem.id === 'short-links')!;
  const study = problem.workedCase!;
  await page.goto('/practice/system-design');
  await page.getByRole('link', { name: `Read worked design: ${problem.title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/system-design\/short-links\/writeup$/);
  await expect(page.getByRole('figure', { name: 'Reference architecture' })).toBeVisible();
  await expect(page.locator('.capacity-calculations .panel')).toHaveCount(study.calculations.length);
  for (const calculation of study.calculations) {
    await expect(page.locator('.capacity-calculations')).toContainText(
      `${calculation.result.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${calculation.unit}`,
    );
  }
  await expect(page.locator('.content-sources a')).toHaveCount(study.sourceIds.length);
  await page.locator('.case-followup summary').first().click();
  await expect(page.locator('.case-followup').first().locator('p').first()).toBeVisible();
  await page.getByRole('link', { name: 'Worked design library', exact: false }).click();
  await expect(page.locator('.learning-index .track-card')).toHaveCount(16);
  await page.goto('/search?q=short-link');
  await page.getByRole('button', { name: 'Worked designs', exact: true }).click();
  await expect(page.locator('.search-results a[href="/practice/system-design/short-links/writeup"]')).toBeVisible();
});

test('worked diagrams, references and lesson links remain usable on mobile in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/practice/system-design/short-links/writeup');
  await expect(page.getByRole('figure', { name: 'Reference architecture' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related lessons' })).toBeVisible();
  for (let theme = 0; theme < 2; theme++) {
    await expect(page.locator('.content-sources')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  }
});
