import { test, expect, type Page } from '@playwright/test';
import { quizQuestions } from '../shared/catalog';

async function premium(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
  await page.goto('/premium/checkout?duration=year');
  await page.getByLabel('I understand this is a local demo').check();
  await page.getByRole('button', { name: 'Activate 1-year access demo', exact: true }).click();
  await expect(page.getByText('Your local premium demo is active.', { exact: true })).toBeVisible();
}
async function holdRequest(page: Page, pattern: string) {
  const gate = new AbortController();
  await page.route(pattern, async route => {
    if (!gate.signal.aborted) await new Promise<void>(resolve => gate.signal.addEventListener('abort', () => resolve(), { once: true }));
    await route.continue();
  });
  return () => gate.abort();
}
test('free account gates new premium actions while the hub is discoverable', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await page.getByRole('link', { name: 'Premium Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make the practice more deliberate.' })).toBeVisible();
  for (const route of ['/premium/mock', '/quiz/custom', '/premium/plans', '/premium/projects']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'A deeper practice opportunity.' })).toBeVisible();
  }
  for (const [route, data] of [['/api/mocks', {}], ['/api/custom-quizzes', {}], ['/api/study-plans', {}], ['/api/projects', {}], ['/api/progress', { key: 'system-design/replication', field: 'read', enabled: true }]] as const) {
    expect((await page.request.post(route, { data })).status()).toBe(403);
  }
});
test('adaptive mock saves a draft, branches on coverage, finishes, and keeps an exportable archive', async ({ page }) => {
  await premium(page);
  await page.goto('/premium/mock?problem=job-scheduler&company=Meta&level=Staff');
  await page.getByRole('button', { name: 'Start mock interview', exact: true }).click();
  const answer = 'I put work into a queue partition, retry with backoff, and collect metrics to detect growing lag.';
  await page.getByLabel('Mock answer').fill(answer);
  await page.getByRole('button', { name: 'Save interview draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Interview draft saved');
  await page.reload();
  await expect(page.getByLabel('Mock answer')).toHaveValue(answer);
  const releaseGrading = await holdRequest(page, '**/api/mocks/*/respond');
  await page.getByRole('button', { name: 'Submit and continue', exact: true }).click();
  try { await expect(page.getByLabel('Mock answer')).toBeDisabled(); }
  finally { releaseGrading(); }
  await expect(page.locator('.mock-response h2')).toContainText('lease');
  await page.getByLabel('Mock answer').fill('A lease assigns one worker, and fencing tokens reject old owners. I would monitor expiration and test overlapping requests.');
  await page.getByRole('button', { name: 'Submit and continue', exact: true }).click();
  await expect(page.locator('.mock-response h2')).toContainText('idempotent');
  await page.getByLabel('Mock answer').fill('An idempotent operation uses a durable deduplication key, a transaction, and a saved result so a retry cannot repeat the side effect.');
  await page.getByRole('button', { name: 'Finish interview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your interview report.' })).toBeVisible();
  await expect(page.locator('.mock-transcript details')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('mock-interview-report.json');
  await page.request.delete('/api/plan');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your interview report.' })).toBeVisible();
});
test('custom quiz topics, answered progress, canonical score and review survive reload', async ({ page }) => {
  await premium(page);
  await page.goto('/quiz/custom');
  await page.getByLabel('Custom quiz title').fill('APIs and cache decisions');
  await page.getByLabel('Custom quiz question count').fill('3');
  await page.getByRole('button', { name: 'Create custom quiz', exact: true }).click();
  await expect(page).toHaveURL(/\/quiz\/custom\/[a-f0-9-]+$/);
  const id = page.url().split('/').at(-1)!;
  let bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const quiz = bootstrap.state.customQuizzes.find((q: { id: string }) => q.id === id);
  const invalid = await page.request.post(`/api/custom-quizzes/${id}/answer`, { data: { revision: 0, questionId: 'pointer-1', answer: 1 } });
  expect(invalid.status()).toBe(400);
  for (let i = 0; i < quiz.questionIds.length; i++) {
    const question = quizQuestions.find(q => q.id === quiz.questionIds[i])!;
    await page.getByRole('radio').nth(i === 0 ? (question.correct + 1) % question.options.length : question.correct).check();
    await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    await page.getByRole('button', { name: i === 2 ? 'Finish quiz' : 'Next question', exact: true }).click();
    if (i === 0) {
      await expect(page.locator('h1')).toContainText(quizQuestions.find(q => q.id === quiz.questionIds[1])!.prompt);
      await page.reload();
      await expect(page.locator('h1')).toContainText(quizQuestions.find(q => q.id === quiz.questionIds[1])!.prompt);
    }
  }
  await expect(page.getByRole('heading', { name: 'Your custom quiz results.' })).toBeVisible();
  bootstrap = await (await page.request.get('/api/bootstrap')).json();
  expect(bootstrap.state.customQuizzes[0].score).toBe(2);
  expect(bootstrap.state.review).toContain(quiz.questionIds[0]);
  expect((await page.request.post(`/api/custom-quizzes/${id}/answer`, { data: { revision: 0, questionId: quiz.questionIds[0], answer: 1 } })).status()).toBe(409);
  await page.request.delete('/api/plan');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your custom quiz results.' })).toBeVisible();
});
test('company-focused study plan reflects real progress, personal notes and reload persistence', async ({ page }) => {
  await premium(page);
  await page.goto('/premium/plans?company=Meta&level=Staff');
  await page.getByLabel('Plan sessions').selectOption('5');
  await page.getByRole('button', { name: 'Create study plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meta · Staff prep plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '0 of 10 steps complete' })).toBeVisible();
  const id = page.url().split('/').at(-1)!;
  const bootstrap = await (await page.request.get('/api/bootstrap')).json(), plan = bootstrap.state.studyPlans[0];
  await page.request.post('/api/progress', { data: { key: plan.tasks[0].resource, field: 'read', enabled: true } });
  await page.reload();
  await expect(page.getByRole('heading', { name: '1 of 10 steps complete' })).toBeVisible();
  await page.getByLabel(`Reflection ${plan.tasks[3].id}`).fill('I would validate the retry boundary before optimizing another cache or queue.');
  const releaseReflection = await holdRequest(page, '**/api/study-plans/*/reflection');
  await page.getByRole('button', { name: 'Save reflection', exact: true }).first().click();
  try { await expect(page.getByLabel(`Reflection ${plan.tasks[3].id}`)).toBeDisabled(); }
  finally { releaseReflection(); }
  await expect(page.getByRole('heading', { name: '2 of 10 steps complete' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`Reflection ${plan.tasks[3].id}`)).toHaveValue('I would validate the retry boundary before optimizing another cache or queue.');
  expect((await page.request.post(`/api/study-plans/${id}/reflection`, { data: { taskId: plan.tasks[0].id, note: 'This should not complete a lesson.' } })).status()).toBe(404);
});
test('project snapshot edits, sandbox checks, diff export, review and stale-feedback invalidation', async ({ page }) => {
  await premium(page);
  await page.goto('/premium/projects');
  await page.getByRole('button', { name: 'Create project workspace', exact: true }).click();
  const code = 'function solve(input) {\n  const seen = new Set();\n  return input.filter(event => {\n    if (seen.has(event.id)) return false;\n    seen.add(event.id);\n    return true;\n  });\n}\n';
  await page.getByLabel('Project source contents').fill(code);
  await page.getByRole('button', { name: 'Run example checks', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('3/3 example checks passed');
  const releaseSave = await holdRequest(page, '**/api/projects/*/save');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  try {
    await expect(page.getByLabel('Project source contents')).toBeDisabled();
    await expect(page.getByLabel('New project file path')).toBeDisabled();
  } finally { releaseSave(); }
  await expect(page.getByText('Project files and notes saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Project source contents')).toHaveValue(code);
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.project-diff')).toContainText('+  const seen = new Set();');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export patch', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('project-changes.patch');
  await page.getByRole('tab', { name: 'Review and verification', exact: true }).click();
  await page.getByLabel('Project explanation').fill('A Set retains the first id and filter preserves input order without changing the input array. I would keep the operation immutable and test duplicate IDs.');
  await page.getByLabel('Project verification notes').fill('Ran all three browser example cases. Integration with a real event source remains unchecked.');
  const releaseReview = await holdRequest(page, '**/api/projects/*/review');
  await page.getByRole('button', { name: 'Review saved changes', exact: true }).click();
  try {
    await expect(page.getByLabel('Project explanation')).toBeDisabled();
    await expect(page.getByLabel('Project verification notes')).toBeDisabled();
  } finally { releaseReview(); }
  await expect(page.locator('.project-feedback')).toContainText('Local rubric · not AI');
  await page.getByRole('tab', { name: 'Source editor', exact: true }).click();
  await page.getByLabel('Project source contents').fill(code + '// A changed draft still needs review.\n');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.getByRole('tab', { name: 'Review and verification', exact: true }).click();
  await expect(page.locator('.project-feedback')).toHaveCount(0);
});
test('premium ownership, stale revisions, source-path rules and mobile layouts are enforced', async ({ page, browser }) => {
  await premium(page);
  const created = await page.request.post('/api/mocks', { data: { problemId: 'short-links', company: 'Meta', level: 'Senior', length: 3 } }), mock = (await created.json()).session;
  expect((await page.request.post(`/api/mocks/${mock.id}/draft`, { data: { revision: 0, answer: 'A saved explanation long enough to grade.' } })).status()).toBe(200);
  expect((await page.request.post(`/api/mocks/${mock.id}/draft`, { data: { revision: 0, answer: 'A stale draft should not overwrite it.' } })).status()).toBe(409);
  expect((await page.request.post('/api/projects', { data: { title: 'Unsafe imported project', problemId: 'event-dedup', files: [{ path: '../.cred', content: '{}' }] } })).status()).toBe(400);
  expect((await page.request.post('/api/projects', { data: { title: 'Unsafe generated project', problemId: 'event-dedup', files: [{ path: 'node_modules/a.js', content: '' }] } })).status()).toBe(400);
  const other = await browser.newContext(), otherPage = await other.newPage();
  await premium(otherPage);
  expect((await otherPage.request.post(`/api/mocks/${mock.id}/draft`, { data: { revision: 1, answer: 'This belongs to another account.' } })).status()).toBe(404);
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/premium/studio', '/premium/mock', '/quiz/custom', '/premium/plans', '/premium/projects', `/premium/mock/${mock.id}`]) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});
test('imported source bytes remain intact and credential files are rejected before import', async ({ page }) => {
  await premium(page);
  await page.goto('/premium/projects');
  await page.getByLabel('Import source files').setInputFiles({ name: '.env', mimeType: 'text/plain', buffer: Buffer.from('EXAMPLE=fixture-only') });
  await expect(page.getByRole('alert')).toContainText('Credential and generated paths cannot be imported');
  await page.getByLabel('Import source files').setInputFiles({ name: 'binary.js', mimeType: 'text/javascript', buffer: Buffer.from([0xff, 0xfe]) });
  await expect(page.getByRole('alert')).toContainText('choose a valid UTF-8 text file');
  const source = '\n  function solve(input) { return input; }\n\n';
  await page.getByLabel('Import source files').setInputFiles([
    { name: 'events.js', mimeType: 'text/javascript', buffer: Buffer.from(source) },
    { name: 'README.md', mimeType: 'text/plain', buffer: Buffer.from('\ufeffA fictional imported snapshot for local testing.\n') },
  ]);
  await expect(page.locator('.project-import-list')).toContainText('README.md');
  await page.getByRole('button', { name: 'Create project workspace', exact: true }).click();
  await expect(page.getByLabel('Project source contents')).toHaveValue(source);
  const state = (await (await page.request.get('/api/bootstrap')).json()).state;
  expect(state.projects[0].files[0].original).toBe(source);
  expect(state.projects[0].files[1].original).toBe('\ufeffA fictional imported snapshot for local testing.\n');
  await page.getByLabel('New project file path').fill('tests.js');
  await page.getByRole('button', { name: 'Add file', exact: true }).click();
  await page.getByLabel('Project source contents').fill('// Original browser-check notes.\n');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'tests.js', exact: true }).click();
  await expect(page.getByLabel('Project source contents')).toHaveValue('// Original browser-check notes.\n');
  await page.getByRole('button', { name: 'Delete file', exact: true }).click();
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'tests.js · deleted', exact: true }).click();
  await expect(page.getByLabel('Project source contents')).toBeDisabled();
});
