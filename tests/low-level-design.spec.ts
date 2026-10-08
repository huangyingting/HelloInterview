import { test, expect } from '@playwright/test';
import { problems } from '../shared/catalog';
import { contentSources } from '../shared/content/sources';

test('object design discovery distinguishes runnable exercises from original reference-only briefs', async ({ page }) => {
  await page.goto('/learn/low-level-design');
  await expect(page.locator('.lesson-row')).toHaveCount(12);
  await expect(page.getByRole('link', { name: 'Explore the course', exact: false })).toHaveAttribute('href','/learn/courses/low-level-design-complete');
  await page.getByRole('link', { name: 'Browse worked object designs', exact: false }).click();
  await expect(page.locator('.learning-index .track-card')).toHaveCount(8);
  await expect(page.getByText('6 reference-protocol examples', { exact: true })).toHaveCount(4);
  await expect(page.getByText('6 executable examples', { exact: true })).toHaveCount(4);
  await page.goto('/practice/low-level-design');
  await expect(page.locator('.practice-item')).toHaveCount(8);
  const parcel=problems.find(problem => problem.id==='parcel-lockers')!;
  await page.getByRole('link', { name:`Read worked solution: ${parcel.title}`,exact:true }).click();
  await expect(page.getByRole('heading', { name:'Reference-protocol examples',exact:true })).toBeVisible();
  await expect(page.getByText('no executable acceptance harness', {exact:false})).toBeVisible();
  await expect(page.locator('.coding-example')).toHaveCount(6);
  await page.getByText('Reveal reference implementation',{exact:false}).click();
  await expect(page.locator('.case-followup pre code')).toHaveText(parcel.solution!.code);
  await page.goto('/practice/low-level-design/lld-inventory-ledger/writeup');
  await expect(page.getByRole('heading', {name:'Executable examples',exact:true})).toBeVisible();
  await expect(page.locator('.content-sources a[href="'+contentSources['pg-constraints'].url+'"]')).toBeVisible();
  await page.goto('/search?q=inventory');
  await page.getByRole('button',{name:'Object designs',exact:true}).click();
  await expect(page.locator('.search-results a[href="/practice/low-level-design/lld-inventory-ledger/writeup"]')).toBeVisible();
  await page.getByRole('button',{name:'Coding solutions',exact:true}).click();
  await expect(page.locator('.search-results a[href="/practice/low-level-design/lld-inventory-ledger/writeup"]')).toHaveCount(0);
  await page.goto('/learn/low-level-design/testing-designs');
  await expect(page.getByRole('heading',{name:'What you will learn'})).toBeVisible();
  await expect(page.locator('.content-sources a[href="'+contentSources['fowler-unit'].url+'"]')).toBeVisible();
  await page.goto('/practice/low-level-design/rate-limiter/writeup');
  await expect(page.getByRole('heading',{name:'A deeper practice opportunity.'})).toBeVisible();
  await page.goto('/learn/low-level-design/concurrency');
  await expect(page.getByRole('heading',{name:'A deeper practice opportunity.'})).toBeVisible();
});

test('all eight trusted stateful references pass the real isolated browser worker protocol', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/learn/low-level-design/solutions');
  const checks=await page.evaluate(async exercises => {
    const path='/src/sandbox.ts', sandbox:typeof import('../src/sandbox')=await import(path);
    const results=[];
    for (const exercise of exercises) results.push({id:exercise.id,results:await sandbox.runCode(exercise.code,exercise.cases)});
    return results;
  },problems.filter(problem => problem.track==='low-level-design').map(problem => ({id:problem.id,code:problem.solution!.code,cases:problem.solution!.examples!})));
  expect(checks).toHaveLength(8);
  for (const check of checks) for (const result of check.results) expect(result.passed,`${check.id}: ${result.label}: ${result.error || result.actual}`).toBe(true);
  await expect(page.locator('iframe[title="Isolated code runner"]')).toHaveCount(0);
});

test('stateful reference diagrams, examples and libraries remain bounded on mobile in both themes', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  for (const id of ['parcel-lockers','lld-workflow-engine','lld-file-catalog']) {
    await page.goto(`/practice/low-level-design/${id}/writeup`);
    await page.getByText('Reveal reference implementation',{exact:false}).click();
    for (let theme=0;theme<2;theme++) {
      await expect(page.locator('.case-followup pre')).toBeVisible();
      await expect(page.locator('.content-sources')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.getByRole('button',{name:theme===0 ? 'Switch to dark theme' : 'Switch to light theme'}).click();
    }
  }
  await page.goto('/learn/low-level-design/solutions');
  expect(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
