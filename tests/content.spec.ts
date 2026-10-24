import { test, expect } from './browser-fixtures';
import { problems } from '../shared/catalog';
import { aiEngineeringLessons } from '../shared/content/ai-engineering-lessons';
import { aiEngineeringCaseStudies } from '../shared/content/ai-engineering-cases';
import { aiLabLessons } from '../shared/content/ai-lab-lessons';
import { aiLabProblems } from '../shared/content/ai-lab-problems';
import { contentSources } from '../shared/content/sources';

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

test('AI engineering is discoverable through the ML track, course, practice, search and reference library', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/learn/ml-system-design');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ML & AI System Design');
  await expect(page.locator('.lesson-row')).toHaveCount(24);
  await page.getByRole('link', { name: 'Explore the course', exact: false }).click();
  await expect(page).toHaveURL(/\/learn\/courses\/ai-engineering$/);
  await expect(page.locator('.course-hero')).toContainText('0 of 18 steps complete');
  await expect(page.locator('.course-units details')).toHaveCount(4);
  await page.locator('.course-step[href="/learn/ml-system-design/llm-foundations"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(aiEngineeringLessons[0].title);
  await expect(page.locator('.content-sources')).toContainText('2026-10-23');
  await expect(page.locator('.content-sources a[href*="f07f8f47d32004f29ead658b14382a27dc7cb2f4"]')).toBeVisible();
  await page.getByRole('link', { name: 'Check your understanding', exact: false }).click();
  await expect(page).toHaveURL(/\/quiz\/llm-foundations$/);
  await expect(page.getByText('Sign in to save quiz scores', { exact: false })).toBeVisible();
  await page.goto('/learn/ml-system-design');
  await page.getByRole('link', { name: 'Browse practice', exact: false }).click();
  await expect(page).toHaveURL(/\/practice\/ml-system-design$/);
  await expect(page.locator('.practice-row')).toHaveCount(8);
  await page.getByRole('link', { name: 'Read worked design: Design a Permission-Aware Knowledge Assistant', exact: true }).click();
  await expect(page.getByRole('figure', { name: 'Reference architecture' })).toBeVisible();
  await expect(page.locator('.capacity-calculations .panel')).toHaveCount(3);
  await page.locator('.content-next-steps a[href="/learn/ml-system-design/rag-retrieval"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(aiEngineeringLessons.find(lesson => lesson.id === 'rag-retrieval')!.title);
  await page.goto('/learn/ml-system-design/cases');
  await expect(page.locator('.learning-index .track-card')).toHaveCount(4);
  for (const study of aiEngineeringCaseStudies) await expect(page.locator(`a[href="/practice/ml-system-design/${study.problemId}/writeup"]`)).toBeVisible();
  await page.goto('/search?q=approval-gated');
  await page.getByRole('button', { name: 'Worked designs', exact: true }).click();
  await expect(page.locator('.search-results a[href="/practice/ml-system-design/ai-support-agent/writeup"]')).toBeVisible();
  await page.goto('/quiz');
  await page.getByRole('button', { name: 'AI & ML', exact: true }).click();
  await expect(page.locator('.quiz-topic-row')).toHaveCount(20);
  expect(errors).toEqual([]);
});

test('AI lessons and all four worked designs reflow at 320px in both themes', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/learn/courses/ai-engineering');
  for (let theme = 0; theme < 2; theme++) {
    for (const path of [
      '/learn/courses/ai-engineering',
      '/learn/ml-system-design/inference-serving',
      ...aiEngineeringCaseStudies.map(study => `/practice/ml-system-design/${study.problemId}/writeup`),
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      if (path.includes('writeup')) {
        await expect(page.getByRole('figure', { name: 'Reference architecture' })).toBeVisible();
        await page.locator('.case-followup summary').first().click();
        await expect(page.locator('.case-followup').first().locator('p')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}, theme ${theme}`).toBe(true);
    }
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  }
});

test('popular-course follow-ups expose original runnable labs and pinned course references', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/learn/ml-system-design');
  await page.getByRole('link', { name: 'Retrieval engineering', exact: false }).click();
  await expect(page).toHaveURL(/\/learn\/courses\/retrieval-engineering$/);
  await expect(page.locator('.course-hero')).toContainText('0 of 7 steps complete');
  await expect(page.locator(`.content-sources a[href="${contentSources['llm-course-roadmap'].url}"]`)).toBeVisible();
  await expect(page.locator(`.content-sources a[href="${contentSources['llm-zoomcamp'].url}"]`)).toBeVisible();
  await page.locator('.course-step[href="/practice/ml-system-design/lab-context-packer"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pack a Ranked Evidence Budget');
  await page.getByRole('link', { name: 'Read the worked solution', exact: false }).click();
  await expect(page.locator('.coding-example')).toHaveCount(7);
  await page.getByText('Reveal reference implementation', { exact: false }).click();
  await expect(page.locator('.case-followup pre code')).toHaveText(aiLabProblems[0].solution!.code);
  await page.getByRole('link', { name: 'AI engineering lab solutions', exact: false }).click();
  await expect(page.locator('.learning-index .track-card')).toHaveCount(4);
  await page.goto('/learn/courses/agent-engineering');
  await expect(page.locator(`.content-sources a[href="${contentSources['hf-agents-course'].url}"]`)).toBeVisible();
  await expect(page.locator('.course-hero')).toContainText('0 of 7 steps complete');
  await page.goto('/search?q=retrieval%20engineering');
  await page.getByRole('button', { name: 'Courses', exact: true }).click();
  await expect(page.locator('.search-results a[href="/learn/courses/retrieval-engineering"]')).toBeVisible();
  await page.goto('/search?q=version-bound');
  await page.getByRole('button', { name: 'AI labs', exact: true }).click();
  await expect(page.locator('.search-results a[href="/practice/ml-system-design/lab-tool-dispatch/writeup"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('course provenance and all runnable AI references reflow at 320px in both themes', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/learn/ml-system-design');
  for (let theme = 0; theme < 2; theme++) {
    for (const path of [
      '/learn/ml-system-design',
      '/learn/courses/retrieval-engineering',
      '/learn/courses/agent-engineering',
      ...aiLabLessons.map(lesson => `/learn/ml-system-design/${lesson.id}`),
      ...aiLabProblems.map(problem => `/practice/ml-system-design/${problem.id}/writeup`),
    ]) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      if (path.includes('writeup')) {
        await page.getByText('Reveal reference implementation', { exact: false }).click();
        await expect(page.locator('.case-followup pre code')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}, theme ${theme}`).toBe(true);
    }
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  }
});
