import { test, expect } from './browser-fixtures';
import { browserOrigin } from './browser-account';
import { tracks, quizTopics } from '../shared/catalog';
import { algorithmExperiment, algorithmFixtureLabels } from '../shared/algorithm-experiments';

test('the original library exposes topic-specific diagrams, checks, truthful lab discovery and working quiz return links', async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const track of tracks) {
    await page.goto(`/learn/${track.id}`);
    await expect(page.locator('.lesson-row')).toHaveCount(track.lessons.length);
    await expect(page.locator('.track-activity-summary')).toContainText(`${track.lessons.length} step-through diagrams`);
    await expect(page.locator('.lesson-activity-label')).toHaveCount(track.lessons.length);
    for (const lesson of track.lessons.filter(lesson => !lesson.premium)) {
      await page.goto(`/learn/${track.id}/${lesson.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(lesson.title);
      await expect(page.locator('.learning-flow')).toHaveCount(1);
      const clippedLabels = await page.locator('.learning-flow svg g').evaluateAll(nodes => nodes.flatMap(node => {
        const text = node.querySelector('text:last-child') as SVGTextElement | null;
        const rect = node.querySelector('rect');
        if (!text || !rect) return ['Missing node text or rectangle'];
        const box = text.getBBox(), left = Number(rect.getAttribute('x')), top = Number(rect.getAttribute('y'));
        const right = left + Number(rect.getAttribute('width')), bottom = top + Number(rect.getAttribute('height'));
        return box.x < left + 4 || box.y < top + 4 || box.x + box.width > right - 4 || box.y + box.height > bottom - 4 ? [text.textContent ?? ''] : [];
      }));
      expect(clippedLabels, `${track.id}/${lesson.id} labels must fit their nodes`).toEqual([]);
      await expect(page.locator('.lesson-check')).toHaveCount(1);
      await expect(page.locator('.lesson-activity-nav')).toContainText('Saved quiz');
      await expect(page.locator('.lesson-check-feedback')).toHaveCount(0);
      await expect(page.locator('.lesson-check button[type="submit"]')).toBeDisabled();
      const lab = lesson.sections.find(section => section.lab || section.visualization);
      if (lab) await expect(page.locator(lab.lab ? '.curriculum-lab' : '.ai-visual-lab')).toBeVisible();
    }
  }
  for (const [tab, track] of [['Behavioral', 'behavioral'], ['AI-assisted coding', 'ai-coding'], ['Negotiation', 'salary-negotiation']] as const) {
    await page.goto('/quiz');
    await page.getByRole('button', { name: tab, exact: true }).click();
    const topics = quizTopics.filter(topic => topic.track === track);
    await expect(page.locator('.quiz-topic-row')).toHaveCount(topics.length);
    for (const topic of topics) await expect(page.locator(`.quiz-topic-row a[href="/learn/${topic.track}/${topic.lessonId}"]`)).toBeVisible();
    const first = topics[0];
    await page.locator(`.quiz-topic-row a[href="/learn/${first.track}/${first.lessonId}"]`).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
  }
  await page.goto('/learn/behavioral/leadership');
  await expect(page.locator('.lesson-check')).toHaveCount(0);
  await expect(page.locator('.learning-flow')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('local predictions and diagrams support keyboard, retry and client navigation without saving activity', async ({ page }) => {
  const writes: string[] = [], external: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
    if (new URL(request.url()).origin !== new URL(browserOrigin).origin) external.push(request.url());
  });
  const lesson = tracks.find(track => track.id === 'system-design')!.lessons.find(lesson => lesson.id === 'capacity-estimation')!;
  const check = lesson.sections.find(section => section.check)!.check!;
  await page.goto('/learn/system-design/capacity-estimation');
  const form = page.getByRole('form', { name: 'Lesson understanding check' });
  const wrong = check.options[(check.correct + 1) % check.options.length];
  await form.getByRole('radio', { name: wrong, exact: true }).check();
  await form.getByRole('button', { name: 'Check reasoning', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Not quite.');
  await expect(form.getByRole('status')).toContainText(check.explanation);
  await expect(form.getByRole('radio').first()).toBeDisabled();
  await form.getByRole('button', { name: 'Try again', exact: true }).click();
  const correct = form.getByRole('radio', { name: check.options[check.correct], exact: true });
  await correct.focus();
  await page.keyboard.press('Space');
  await form.getByRole('button', { name: 'Check reasoning', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Correct.');
  const flow = page.locator('.learning-flow');
  await flow.locator('.learning-flow-steps button').last().click();
  await expect(flow.getByRole('button', { name: 'Next step', exact: false })).toBeDisabled();
  await page.locator('.lesson-pagination a[href="/learn/system-design/api-design"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Designing useful APIs');
  await expect(page.locator('.learning-flow [aria-current="step"]')).toContainText('1.');
  await expect(page.locator('.lesson-check-feedback')).toHaveCount(0);
  await expect(page.locator('.lesson-check input:checked')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.lesson-check input:checked')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(external).toEqual([]);
});

test('all ten numerical and protocol labs react to actual controls, expose boundaries and reset cleanly', async ({ page }) => {
  test.setTimeout(120000);
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/learn/system-design/capacity-estimation');
  await expect(page.locator('.visual-metrics')).toContainText('72.000');
  await page.getByRole('slider', { name: 'Stored replicas', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics')).toContainText('120.000');
  await page.goto('/learn/system-design/queues');
  await expect(page.locator('.visual-metrics')).toContainText('400');
  await expect(page.locator('.visual-metrics')).toContainText('Cannot drain');
  await page.getByRole('slider', { name: 'Completions per second', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics dd').first()).toHaveText('0');
  await page.getByRole('slider', { name: 'Elapsed seconds', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['200', '2.0 s']);
  await page.goto('/learn/system-design/caching');
  await expect(page.locator('.visual-metrics')).toContainText('Obsolete copy');
  await page.getByRole('checkbox', { name: 'Invalidate the copy', exact: false }).check();
  await expect(page.locator('.visual-metrics')).toContainText('Current');
  await page.locator('.curriculum-lab').getByRole('button', { name: 'Reset', exact: false }).click();
  await expect(page.getByRole('checkbox', { name: 'Invalidate the copy', exact: false })).not.toBeChecked();
  await page.getByRole('slider', { name: 'Cache TTL seconds', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.locator('.visual-metrics')).toContainText('Origin refresh');
  await page.goto('/learn/system-design/rate-limiting');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['6', '6', '4', '0']);
  await page.getByRole('slider', { name: 'Seconds before second burst', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['10', '10', '0', '0']);
  await page.goto('/learn/system-design/api-design');
  await page.getByRole('button', { name: 'Commit writer A', exact: true }).click();
  await page.getByRole('button', { name: 'Commit writer B', exact: true }).click();
  await expect(page.locator('.visual-metrics dd')).toHaveText(['2', 'Writer A']);
  await expect(page.locator('.lab-event-log li').last()).toContainText('rejected; remains v2');
  await page.getByRole('slider', { name: 'Expected version', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Commit writer B', exact: true }).click();
  await expect(page.locator('.visual-metrics dd')).toHaveText(['3', 'Writer B']);
  await page.locator('.curriculum-lab').getByRole('button', { name: 'Reset', exact: false }).click();
  await expect(page.locator('.visual-metrics dd')).toHaveText(['1', 'Original']);
  await expect(page.locator('.lab-event-log li')).toHaveCount(0);
  await page.goto('/learn/ml-system-design/retrieval-ranking');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['0.500', '0.333', '0.500']);
  await page.getByRole('checkbox', { name: 'Reverse the returned order', exact: true }).check();
  await expect(page.locator('.visual-metrics dd').last()).toHaveText('1.000');
  await page.getByRole('checkbox', { name: 'Fixture has no known relevant evidence', exact: true }).check();
  await expect(page.locator('.visual-metrics dd')).toHaveText(['0.000', 'N/A', '0.000']);
  await page.goto('/learn/ml-system-design/feature-engineering');
  await expect(page.locator('.curriculum-lab [role="status"]')).toHaveText('1 of 3 features available by second 10.');
  await page.getByRole('slider', { name: 'Prediction at second', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.curriculum-lab [role="status"]')).toHaveText('3 of 3 features available by second 40.');
  await page.goto('/learn/ai-coding/verification');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['0.950', 'Eligible']);
  await page.getByRole('slider', { name: 'Critical regressions', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics dd').last()).toHaveText('Blocked');
  await page.getByRole('checkbox', { name: 'No evaluation data ran', exact: true }).check();
  await expect(page.locator('.visual-metrics dd')).toHaveText(['N/A', 'Blocked']);
  await page.goto('/learn/behavioral/introduction');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['120 s', '0 s', '0.500']);
  await page.getByRole('slider', { name: 'Personal action seconds', exact: true }).focus(); await page.keyboard.press('End');
  await expect(page.locator('.visual-metrics dd').first()).toHaveText('180 s');
  await expect(page.locator('.visual-metrics dd').nth(1)).toHaveText('-60 s');
  await page.goto('/learn/salary-negotiation/compensation');
  await expect(page.locator('.visual-metrics dd')).toHaveText(['120000.00', '1200.00', '12000.00']);
  await page.getByRole('slider', { name: 'Completed service months', exact: true }).focus(); await page.keyboard.press('Home');
  for (let month = 0; month < 11; month++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.visual-metrics dd').nth(1)).toHaveText('0.00');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.visual-metrics dd').nth(1)).toHaveText('1200.00');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('all nineteen new algorithm models change fixtures, trace real state, reveal computed results and reset', async ({ page }) => {
  test.setTimeout(180000);
  for (const lesson of tracks.find(track => track.id === 'code')!.lessons) {
    const lab = lesson.sections.find(section => section.lab?.kind === 'algorithm')?.lab;
    if (lab?.kind !== 'algorithm') continue;
    await page.goto(`/learn/code/${lesson.id}`);
    await page.getByRole('combobox', { name: 'Algorithm fixture', exact: true }).click();
    await page.getByRole('option', { name: algorithmFixtureLabels[lab.algorithm][2], exact: true }).click();
    const result = algorithmExperiment(lab.algorithm, 2);
    await expect(page.locator('.lab-state>strong')).toHaveText(result.frames[0].title);
    for (let step = 1; step < result.frames.length; step++) await page.getByRole('button', { name: 'Next state', exact: true }).click();
    await expect(page.locator('.lab-state>strong')).toHaveText(result.frames.at(-1)!.title);
    await expect(page.getByRole('button', { name: 'Next state', exact: true })).toBeDisabled();
    await page.locator('.lab-result summary').click();
    await expect(page.locator('.lab-result pre')).toHaveText(result.output);
    await page.getByRole('button', { name: 'Reset Algorithm state experiment', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Algorithm fixture', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.lab-state>strong')).toHaveText(algorithmExperiment(lab.algorithm, 0).frames[0].title);
  }
});

test('new activities reflow at 320px in both themes and retain text alternatives in forced colors', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const paths = [
    '/learn/system-design/capacity-estimation', '/learn/system-design/queues', '/learn/system-design/caching',
    '/learn/system-design/rate-limiting', '/learn/system-design/api-design', '/learn/ml-system-design/retrieval-ranking',
    '/learn/ml-system-design/feature-engineering', '/learn/ai-coding/verification', '/learn/behavioral/introduction',
    '/learn/salary-negotiation/compensation', '/learn/code/topological-sort', '/learn/code/tries', '/quiz',
  ];
  for (let theme = 0; theme < 2; theme++) {
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path !== '/quiz') {
        await page.locator('.learning-flow-steps button').last().click();
        await expect(page.locator('.learning-flow [aria-current="step"]')).toContainText('3.');
        await expect.poll(() => page.locator('.learning-flow-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        await expect(page.locator('.lesson-check')).toBeVisible();
        await expect(page.locator('.curriculum-lab')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}, theme ${theme}`).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`curriculum-${theme}.png`), fullPage: true });
    if (theme === 0) await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/learn/ml-system-design/feature-engineering');
  await expect(page.getByRole('table')).toContainText('Exclude');
  await expect(page.getByRole('region', { name: 'Feature availability table', exact: true })).toHaveAttribute('tabindex', '0');
  await page.locator('.lesson-check input').first().check();
  await page.locator('.lesson-check button[type="submit"]').click();
  await expect(page.locator('.lesson-check-feedback')).toBeVisible();
});
