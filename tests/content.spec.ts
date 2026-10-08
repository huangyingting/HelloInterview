import { test, expect, type Page } from '@playwright/test';
import { problems, quizQuestions } from '../shared/catalog';
import { contentSources } from '../shared/content/sources';
import type { Bootstrap, UserState } from '../shared/types';

async function demo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
}

test('substantial sourced lessons and the complete text-based course are discoverable', async ({ page }) => {
  test.setTimeout(90000);
  await demo(page);
  await page.goto('/learn/system-design/http-caching');
  await expect(page.getByRole('heading', { name: 'What you will learn' })).toBeVisible();
  expect(await page.locator('.lesson-article > section p').count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.content-sources a[href="' + contentSources['http-cache'].url + '"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check your understanding' })).toHaveAttribute('href', '/quiz/caching');
  await page.goto('/learn/system-design');
  await page.getByRole('link', { name: 'Explore the course', exact: false }).click();
  await expect(page.getByRole('heading', { name: '0 of 52 steps complete' })).toBeVisible();
  await expect(page.getByText('Written lessons, quizzes, and practice', { exact: false })).toBeVisible();
  await expect(page.getByText('0 original animated walkthrough', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enroll in this course', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toHaveAttribute('href', '/learn/system-design/introduction');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toBeVisible();
  await page.goto('/learn/courses/coding-complete');
  await expect(page.getByRole('heading', { name: '0 of 60 steps complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Enroll in this course', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toHaveAttribute('href', '/learn/code/introduction');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toBeVisible();
  const problem = problems.find(problem => problem.id === 'alg-pair-load')!;
  await page.goto(`/practice/code/${problem.id}`);
  await expect(page.getByRole('link', { name: 'Read the worked solution', exact: false })).toHaveAttribute('href', `/practice/code/${problem.id}/writeup`);
  await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.getByRole('textbox', { name: 'Code editor', exact: true }).fill(problem.solution!.code);
  await page.getByRole('button', { name: 'Run tests', exact: true }).click();
  await expect(page.locator('.test-results .passed')).toHaveCount(problem.testCases!.length);
  await expect(page.locator('.test-results .failed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Code editor', exact: true })).toHaveValue(problem.solution!.code);
  await expect(page.getByRole('link', { name: 'Read the worked solution', exact: false })).toHaveCount(0);
  const response = await page.request.get('/api/bootstrap'), payload: Bootstrap = await response.json();
  const attempt = payload.state.attempts.find(attempt => attempt.problemId === problem.id)!;
  expect(attempt.code).toBe(problem.solution!.code);
  expect(attempt.completed).toBe(false);
});

test('practice write-ups lead to real worked designs with capacity, sources and follow-ups', async ({ page }) => {
  const problem = problems.find(problem => problem.id === 'short-links')!, study = problem.workedCase!;
  await page.goto('/practice/system-design');
  await page.getByRole('link', { name: `Read worked design: ${problem.title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/system-design\/short-links\/writeup$/);
  await expect(page.getByRole('figure', { name: 'Reference architecture' })).toBeVisible();
  await expect(page.locator('.capacity-calculations .panel')).toHaveCount(study.calculations.length);
  for (const calculation of study.calculations) await expect(page.locator('.capacity-calculations')).toContainText(`${calculation.result.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${calculation.unit}`);
  await expect(page.locator('.content-sources a')).toHaveCount(study.sourceIds.length);
  await page.locator('.case-followup summary').first().click();
  await expect(page.locator('.case-followup').first().locator('p').first()).toBeVisible();
  await page.getByRole('link', { name: 'Worked design library', exact: false }).click();
  await expect(page.locator('.learning-index .track-card')).toHaveCount(16);
  await page.goto('/search?q=short-link');
  await page.getByRole('button', { name: 'Worked designs', exact: true }).click();
  await expect(page.locator('.search-results a[href="/practice/system-design/short-links/writeup"]')).toBeVisible();
  await page.goto('/practice/system-design/object-storage');
  await expect(page.getByRole('link', { name: 'Read the worked design', exact: false })).toHaveAttribute('href', '/practice/system-design/object-storage/writeup');
});

test('historical topic and custom quiz reports preserve their selected questions and cited explanations', async ({ page }) => {
  await demo(page);
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch(), payload: Bootstrap = await response.json();
    payload.state.quizzes.unshift({ id: 'legacy-api-report', topic: 'api-design', answers: { 'api-1': 1, 'api-2': 0, 'api-3': -1 }, score: 1, total: 3, completedAt: '2026-10-01T12:00:00Z' });
    payload.state.quizzes.unshift({ id: 'legacy-pointer-report', topic: 'two-pointers', answers: { 'pointer-1': 1, 'pointer-2': 1, 'pointer-3': 0 }, score: 3, total: 3, completedAt: '2026-10-01T12:00:00Z' });
    payload.state.customQuizzes.unshift({ id: 'legacy-custom-report', title: 'A saved two-question session', topics: ['api-design', 'caching'], mode: 'all', questionIds: ['api-1', 'cache-1'], answers: { 'api-1': 1, 'cache-1': 2 }, revision: 2, createdAt: '2026-10-01T12:00:00Z', completedAt: '2026-10-01T12:02:00Z', score: 2 });
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/quiz/api-design?result=legacy-api-report');
  await expect(page.locator('.result-score')).toHaveText('1/ 3');
  await expect(page.locator('.quiz-explanations > article')).toHaveCount(3);
  await expect(page.locator('.quiz-explanations').getByText('Skipped', { exact: false })).toHaveCount(1);
  await expect(page.locator('.quiz-explanations .content-sources')).toHaveCount(3);
  await page.getByRole('link', { name: 'Try again', exact: false }).click();
  await expect(page.getByText('15 questions.', { exact: false })).toBeVisible();
  await page.goto('/quiz/custom/legacy-custom-report');
  await expect(page.locator('.result-score')).toHaveText('2/ 2');
  await expect(page.locator('.quiz-explanations > article')).toHaveCount(2);
  await expect(page.locator('.quiz-explanations .content-sources')).toHaveCount(2);
  const sparse = await page.request.post('/api/quiz', { data: { topic: 'api-design', answers: { 'api-1': 1 } } });
  expect(sparse.status()).toBe(200);
  const current: UserState = await sparse.json(), report = current.quizzes[0];
  expect(report.score).toBe(1);
  expect(report.total).toBe(15);
  expect(Object.keys(report.answers)).toEqual(quizQuestions.filter(question => question.topic === 'api-design').map(question => question.id));
  expect(report.answers['api-2']).toBe(-1);
  await page.goto(`/quiz/api-design?result=${report.id}`);
  await expect(page.locator('.quiz-explanations > article')).toHaveCount(15);
  const review = await page.request.post('/api/quiz', { data: { topic: 'review', answers: { 'api-2': 1 } } });
  expect(review.status()).toBe(200);
  const reviewed: UserState = await review.json();
  expect(reviewed.quizzes[0].total).toBe(1);
  expect(reviewed.quizzes[0].answers).toEqual({ 'api-2': 1 });
  await page.goto('/quiz/two-pointers?result=legacy-pointer-report');
  await expect(page.locator('.result-score')).toHaveText('3/ 3');
  await expect(page.locator('.quiz-explanations > article')).toHaveCount(3);
  await page.getByRole('link', { name: 'Try again', exact: false }).click();
  await expect(page.getByText('15 questions.', { exact: false })).toBeVisible();
  const coding = await page.request.post('/api/quiz', { data: { topic: 'two-pointers', answers: { 'pointer-1': 1 } } });
  expect(coding.status()).toBe(200);
  const codingState: UserState = await coding.json();
  expect(codingState.quizzes[0].total).toBe(15);
  expect(codingState.quizzes[0].score).toBe(1);
  expect(Object.keys(codingState.quizzes[0].answers)).toEqual(quizQuestions.filter(question => question.topic === 'two-pointers').map(question => question.id));
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
