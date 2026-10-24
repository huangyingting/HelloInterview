import { test, expect, type Page } from './browser-fixtures';
import { browserAccount } from './browser-account';
import { problems, tracks } from '../shared/public-catalog';
import { aiEngineeringQuestions } from '../shared/content/ai-engineering-questions';
import { aiLabProblems } from '../shared/content/ai-lab-problems';
import { aiLabQuestions } from '../shared/content/ai-lab-questions';
import { dojoQuestions } from '../shared/content/dojo-questions';
import { contentSources } from '../shared/content/sources';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(browserAccount.email);
  await page.getByLabel('Password', { exact: true }).fill(browserAccount.password);
  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('region', { name: 'Your next step' })).toBeVisible();
}

async function expectReflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('main *')).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
    }).slice(0, 6).map(element => `${element.tagName}.${element.className}`),
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
}

test('editorial landing uses licensed self-hosted typography and real library totals', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Think clearly.Interview better.');
  await expect(page.getByRole('link', { name: 'Explore the library', exact: true })).toBeVisible();
  await expect(page.locator('.discipline-card')).toHaveCount(tracks.length);
  await expect(page.locator('.library-index')).toContainText(`${tracks.reduce((sum, track) => sum + track.lessons.length, 0)} original lessons`);
  await expect(page.locator('.library-index')).toContainText(`${problems.length} practice exercises`);
  expect(await page.evaluate(async () => (await document.fonts.load('400 16px "Mona Sans"')).length)).toBeGreaterThan(0);
  expect(await page.evaluate(async () => (await document.fonts.load('400 12px "JetBrains Mono"')).length)).toBeGreaterThan(0);
  await expectReflow(page);
  await page.screenshot({ path: testInfo.outputPath('editorial-landing.png'), fullPage: true });
});

test('a genuine invited password account starts empty and persists only its own preparation', async ({ page }, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 500 && response.url().includes('/api/')) failures.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await signIn(page);
  await expect(page.locator('.workspace-welcome')).toContainText('A fresh workspace.');
  await expect(page.locator('.workspace-metrics strong')).toHaveText([/^0\s*\/ \d+$/, '0 sessions', '0 days', '0 questions ']);
  await expect(page.locator('.target-list')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('editorial-workspace.png'), fullPage: true });
  await page.getByRole('button', { name: 'Add target', exact: true }).click();
  await page.getByLabel('Company', { exact: true }).fill('Personal Target');
  await page.getByLabel('Role', { exact: true }).fill('Platform Engineer');
  await page.getByRole('button', { name: 'Save target', exact: false }).click();
  await expect(page.locator('.target-list')).toContainText('Personal Target');
  await page.reload();
  await expect(page.locator('.target-list')).toContainText('Platform Engineer');
  await page.getByRole('button', { name: 'Remove Personal Target target', exact: true }).click();
  await expect(page.locator('.target-empty')).toBeVisible();
  await page.goto('/learn/system-design/introduction');
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/dashboard');
  await expect(page.locator('.workspace-metrics strong').first()).toHaveText(/^1\s*\/ \d+$/);
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Retry security settings' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Confirm with password', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(browserAccount.email);
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Password', { exact: true }).fill(browserAccount.password);
  await page.getByRole('button', { name: 'Confirm password', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await signIn(page);
  await expect(page.locator('.workspace-metrics strong').first()).toHaveText(/^1\s*\/ \d+$/);
  expect(failures).toEqual([]);
});

test('critical screens reflow at 320px in both themes with resilient text spacing', async ({ page }, testInfo) => {
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    for (const path of ['/dashboard', '/account', '/learn', '/practice/code', '/community/questions', '/pricing']) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      await page.addStyleTag({ content: '*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}' });
      await expectReflow(page);
    }
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: 'Your next step' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`workspace-mobile-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expectReflow(page);
});

test.describe('coarse-pointer admission', () => {
test.use({ hasTouch: true });
test('public admission remains honest and usable in forced colors', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome to the Studio.' })).toBeVisible();
  await expect(page.getByText('New here? Use the invitation link', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create an account', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const target = await page.getByRole('button', { name: 'Sign in with password', exact: true }).boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await expectReflow(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Explore the library', exact: true })).toBeVisible();
  await expectReflow(page);
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});
});

test('editorial text and primary actions retain AA contrast in both themes', async ({ page }) => {
  await signIn(page);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    const contrast = await page.evaluate(() => {
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      };
      const ratio = (foreground: string, background: string) => {
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      };
      return [
        ['.focus-panel p', '.focus-panel'],
        ['.sidebar-profile strong', '.sidebar'],
        ['.focus-panel .button', '.focus-panel .button'],
      ].map(([selector, background]) => {
        const text = getComputedStyle(document.querySelector(selector)!);
        const surface = getComputedStyle(document.querySelector(background)!);
        return { selector, ratio: ratio(text.color, surface.backgroundColor) };
      });
    });
    for (const result of contrast) expect(result.ratio, `${theme} ${result.selector}`).toBeGreaterThanOrEqual(4.5);
  }
});

test('compact workspace retains hierarchy and uses custom target selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  const density = await page.evaluate(() => ({
    header: document.querySelector('.topbar')!.getBoundingClientRect().height,
    inset: parseFloat(getComputedStyle(document.querySelector('.main-content')!).paddingTop),
    panel: parseFloat(getComputedStyle(document.querySelector('.learning-path')!).paddingTop),
    gap: parseFloat(getComputedStyle(document.querySelector('.dashboard-grid')!).columnGap),
  }));
  expect(density).toEqual({ header: 64, inset: 24, panel: 18, gap: 18 });
  await page.getByRole('button', { name: 'Add target', exact: true }).click();
  const level = page.getByRole('combobox', { name: 'Level', exact: true });
  await level.click();
  await page.getByRole('option', { name: 'Staff', exact: true }).click();
  await expect(level).toHaveText('Staff');
  await expect(page.locator('select')).toHaveCount(0);
  await expectReflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('compact-workspace.png'), fullPage: true });
});

test('custom selectors update real practice filters and company navigation', async ({ page }) => {
  await page.goto('/practice/code');
  const difficulty = page.getByRole('combobox', { name: 'Filter difficulty', exact: true });
  await difficulty.click();
  await page.getByRole('option', { name: 'Hard', exact: true }).click();
  const badges = page.locator('.practice-row > .badge');
  expect(await badges.count()).toBeGreaterThan(0);
  await expect(badges).toHaveText(Array(await badges.count()).fill('Hard'));
  await page.goto('/guides/meta/senior');
  await page.getByRole('combobox', { name: 'Guide company', exact: true }).click();
  await page.getByRole('option', { name: 'Google', exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/google\/senior$/);
  await page.getByRole('combobox', { name: 'Guide level', exact: true }).click();
  await page.getByRole('option', { name: 'Staff', exact: true }).click();
  await expect(page).toHaveURL(/\/guides\/google\/staff$/);
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('an invited member persists AI course progress, sourced quiz results and an architecture attempt', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500 && response.url().includes('/api/')) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await signIn(page);
  await page.goto('/learn/courses/ai-engineering');
  await page.getByRole('button', { name: 'Enroll in this course', exact: false }).click();
  await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Continue your path', exact: false }).click();
  await expect(page).toHaveURL(/\/learn\/ml-system-design\/llm-foundations$/);
  await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Check your understanding', exact: false }).click();
  await page.getByRole('button', { name: 'Start quiz', exact: false }).click();
  const pool = aiEngineeringQuestions.filter(question => question.topic === 'llm-foundations');
  for (let index = 0; index < pool.length; index++) {
    const question = pool[index];
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(question.prompt);
    await page.getByRole('radio', { name: question.options[question.correct], exact: false }).check();
    await page.getByRole('button', { name: 'Check answer', exact: false }).click();
    await expect(page.locator('.quiz-answer-explanation')).toContainText(question.explanation);
    await expect(page.locator('.content-sources')).toContainText('2026-10-23');
    await page.getByRole('button', { name: index === pool.length - 1 ? 'Finish quiz' : 'Next question', exact: false }).click();
  }
  await expect(page.locator('.result-score')).toHaveText('4/ 4');
  await page.reload();
  await expect(page.locator('.quiz-explanations article')).toHaveCount(4);
  await expect(page.locator('.quiz-explanations .content-sources').first()).toContainText('2026-10-23');
  await page.goto('/practice/ml-system-design/ai-knowledge-assistant');
  await page.getByRole('button', { name: 'Start practice', exact: false }).click();
  await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Code editor', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Diagram component', exact: true }).click();
  await page.getByRole('option', { name: 'Retriever', exact: true }).click();
  await page.getByRole('button', { name: 'Add component', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Move Retriever component', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Explanation', exact: true }).click();
  const answer = 'Version each source and chunk. Compare hybrid retrieval with lexical search. Recheck tenant permission and authorization before evidence enters a model. Require supported citations or abstain. Evaluate recall, supported answers, freshness, latency, and cost against a search-only baseline.';
  await page.getByRole('textbox', { name: 'Practice explanation', exact: true }).fill(answer);
  await page.getByRole('button', { name: 'Save draft', exact: false }).click();
  await expect(page.locator('.workspace-status')).toHaveText('Saved to your account');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Move Retriever component', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Explanation', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Practice explanation', exact: true })).toHaveValue(answer);
  await page.getByRole('button', { name: 'Get feedback', exact: false }).click();
  await expect(page.locator('.feedback-panel')).toContainText('Local rubric · not AI');
  await page.goto('/learn/courses/ai-engineering');
  await expect(page.locator('.course-hero')).toContainText('3 of 18 steps complete');
  await page.screenshot({ path: testInfo.outputPath('ai-engineering-course.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('an invited member runs all four AI labs and retains independent follow-up course progress', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500 && response.url().includes('/api/')) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  await signIn(page);
  for (const [course, lesson] of [['retrieval-engineering', 'retrieval-ingestion'], ['agent-engineering', 'agent-tool-contracts']]) {
    await page.goto(`/learn/courses/${course}`);
    await page.getByRole('button', { name: 'Enroll in this course', exact: false }).click();
    await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toBeVisible();
    await page.goto(`/learn/ml-system-design/${lesson}`);
    await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  for (const problem of aiLabProblems) {
    await page.goto(`/practice/ml-system-design/${problem.id}`);
    await page.getByRole('button', { name: 'Start practice', exact: false }).click();
    await expect(page.getByRole('tab', { name: 'Code editor', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Code editor', exact: true }).fill(problem.solution!.code);
    await page.getByRole('button', { name: 'Run tests', exact: false }).click();
    await expect(page.locator('.test-results .passed')).toHaveCount(problem.testCases!.length);
    await expect(page.locator('.test-results .failed')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save draft', exact: false }).click();
    await expect(page.locator('.workspace-status')).toHaveText('Saved to your account');
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Code editor', exact: true })).toHaveValue(problem.solution!.code);
    await page.getByRole('tab', { name: 'Explanation', exact: true }).click();
    await page.getByRole('textbox', { name: 'Practice explanation', exact: true }).fill('Preserve the specified invariant and input identity. Use explicit budget, schema, tenant, approval, rank, and version checks. Keep unknown operation outcomes for reconciliation. Compare every valid and rejected transition with the stated examples; these bounded tests are not proof of production authority or distributed correctness.');
    await page.getByRole('button', { name: 'Get feedback', exact: false }).click();
    await expect(page.locator('.feedback-panel')).toContainText('Local rubric · not AI');
  }
  await page.goto('/quiz/retrieval-ranking');
  await page.getByRole('button', { name: 'Start quiz', exact: false }).click();
  const pool = aiLabQuestions.filter(question => question.topic === 'retrieval-ranking');
  for (const [index, question] of pool.entries()) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(question.prompt);
    await page.getByRole('radio', { name: question.options[question.correct], exact: false }).check();
    await page.getByRole('button', { name: 'Check answer', exact: false }).click();
    await expect(page.locator('.quiz-answer-explanation')).toContainText(question.explanation);
    await page.getByRole('button', { name: index === pool.length - 1 ? 'Finish quiz' : 'Next question', exact: false }).click();
  }
  await expect(page.locator('.result-score')).toHaveText('4/ 4');
  await page.reload();
  await expect(page.locator('.quiz-explanations article')).toHaveCount(4);
  for (const [course, complete] of [['retrieval-engineering', 4], ['agent-engineering', 3]] as const) {
    await page.goto(`/learn/courses/${course}`);
    await expect(page.locator('.course-hero')).toContainText(`${complete} of 7 steps complete`);
  }
  expect(errors).toEqual([]);
});

test('Dojo course enrollment and sourced quiz progress persist while visual exploration never marks lessons read', async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  for (const [course, lesson, total] of [['model-behavior', 'attention-mechanics', 6], ['inference-economics', 'kv-capacity', 6], ['prompt-contracts', 'context-contracts', 7]] as const) {
    await page.goto(`/learn/courses/${course}`);
    const before = Number((await page.locator('.course-hero h2').innerText()).match(/^(\d+) of/)![1]);
    await page.getByRole('button', { name: 'Enroll in this course', exact: false }).click();
    await expect(page.getByRole('link', { name: 'Continue your path', exact: false })).toBeVisible();
    await page.goto(`/learn/ml-system-design/${lesson}`);
    await page.locator('.learning-flow').getByRole('button', { name: 'Next step', exact: false }).click();
    await page.locator('.ai-visual-lab input[type="range"]').first().focus();
    await page.keyboard.press('End');
    await page.goto(`/learn/courses/${course}`);
    await expect(page.locator('.course-hero')).toContainText(`${before} of ${total} steps complete`);
    await page.goto(`/learn/ml-system-design/${lesson}`);
    await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`/quiz/${lesson}`);
    await page.getByRole('button', { name: 'Start quiz', exact: false }).click();
    const pool = dojoQuestions.filter(question => question.topic === lesson);
    for (const [index, question] of pool.entries()) {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(question.prompt);
      await page.getByRole('radio', { name: question.options[question.correct], exact: false }).check();
      await page.getByRole('button', { name: 'Check answer', exact: false }).click();
      await expect(page.locator('.quiz-answer-explanation')).toContainText(question.explanation);
      await page.getByRole('button', { name: index === pool.length - 1 ? 'Finish quiz' : 'Next question', exact: false }).click();
    }
    await expect(page.locator('.result-score')).toHaveText('4/ 4');
    await page.reload();
    await expect(page.locator('.quiz-explanations article')).toHaveCount(4);
    for (const id of pool[0].sourceIds ?? []) {
      const source = Object.entries(contentSources).find(([key]) => key === id)![1];
      await expect(page.locator('.quiz-explanations article').first().locator(`.content-sources a[href="${source.url}"]`)).toBeVisible();
    }
    await page.goto(`/learn/courses/${course}`);
    await expect(page.locator('.course-hero')).toContainText(`${before + 2} of ${total} steps complete`);
  }
});
