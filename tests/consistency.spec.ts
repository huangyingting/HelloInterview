import { test, expect } from './browser-fixtures';
import { browserAccount } from './browser-account';
import { courses, problems, quizTopics, tracks } from '../shared/public-catalog';

test('course discovery and every outline describe actual saved steps and premium boundaries', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/learn/courses');
  await expect(page.locator('.track-card')).toHaveCount(courses.length);
  for (const course of courses) {
    const steps = course.units.flatMap(unit => unit.steps);
    const protectedSteps = steps.filter(step => {
      if (step.type === 'video') return course.premium;
      if (step.type === 'practice') return problems.some(problem => problem.id === step.resource && problem.premium);
      return step.type === 'lesson' && tracks.some(track => track.lessons.some(lesson => `${track.id}/${lesson.id}` === step.resource && lesson.premium));
    });
    const card = page.locator(`.track-card[href="/learn/courses/${course.id}"]`);
    await expect(card).not.toContainText('premium-demo');
    await expect(card.locator('.track-card-bottom')).toContainText(course.premium ? 'Premium' : protectedSteps.length ? 'Includes premium steps' : 'No premium steps');
    await card.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(course.title);
    const hero = page.locator('.course-hero');
    await expect(hero).toContainText(`0 of ${steps.length} steps complete`);
    await expect(hero).toContainText('Local lesson checks and interactive labs are optional exploration.');
    for (const [type, label] of [['lesson', 'written lesson'], ['video', 'captioned walkthrough'], ['quiz', 'saved quiz'], ['practice', 'practice exercise']] as const) {
      const count = steps.filter(step => step.type === type).length;
      if (count) await expect(hero).toContainText(`${count} ${label}${count === 1 ? '' : 's'}`);
      else await expect(hero).not.toContainText(label);
    }
    await expect(page.locator('.course-step')).toHaveCount(steps.length);
    await expect(page.locator('.course-step .badge')).toHaveCount(protectedSteps.length);
    await expect(page.locator('.course-access-notice')).toHaveCount(!course.premium && protectedSteps.length ? 1 : 0);
    await expect(page.locator('.course-step>div>span').filter({ hasText: /^Saved quiz$/ })).toHaveCount(steps.filter(step => step.type === 'quiz').length);
    for (const step of protectedSteps) await expect(page.locator(`.course-step[href="${step.to}"] .badge`)).toHaveText('Premium');
    if (course.id === 'behavioral') await expect(hero.locator('.eyebrow')).toHaveText('READ. WATCH. PRACTICE.');
    await page.goto('/learn/courses');
  }
  expect(errors).toEqual([]);
});

test('salary lessons and their track recommend actual negotiation quizzes rather than unrelated exercises', async ({ page }) => {
  const track = tracks.find(item => item.id === 'salary-negotiation')!;
  await page.goto('/learn/salary-negotiation');
  await expect(page.getByRole('link', { name: 'Try a negotiation quiz', exact: false })).toHaveAttribute('href', `/quiz/${track.lessons[0].quizTopic}`);
  await expect(page.locator('main a[href="/practice/behavioral"]')).toHaveCount(0);
  for (const lesson of track.lessons) {
    await page.goto(`/learn/${track.id}/${lesson.id}`);
    await expect(page.locator('.exercise-box a[href^="/practice/"]')).toHaveCount(0);
    await expect(page.locator(`.exercise-box a[href="/quiz/${lesson.quizTopic}"]`)).toHaveCount(1);
  }
  await page.goto('/learn/behavioral');
  await expect(page.locator('.course-link-banner')).toContainText('Separate saved quizzes are available from each lesson.');
});

test('activity navigation focuses distinct diagram, experiment and check targets without saving progress', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['/learn/system-design/capacity-estimation', '/learn/ml-system-design/attention-mechanics', '/learn/code/two-pointers']) {
    await page.goto(path);
    await expect(page.locator('.lesson-check')).toBeVisible();
    const targets = new Set<string>();
    for (const [name, selector] of [['Step-through diagram', '.learning-flow'], ['Interactive lab', '.curriculum-lab,.ai-visual-lab,.algorithm-lab'], ['Quick understanding check', '.lesson-check']]) {
      const link = page.getByRole('navigation', { name: 'Lesson activities' }).getByRole('link', { name, exact: true });
      const href = (await link.getAttribute('href'))!;
      expect(href).toMatch(/^#/);
      expect(targets.has(href)).toBe(false);
      targets.add(href);
      const target = page.locator(href);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      expect(await target.evaluate((element, child) => element.matches(child) || !!element.querySelector(child), selector)).toBe(true);
      await expect.poll(() => target.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(70);
      await expect.poll(() => target.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeLessThanOrEqual(110);
      if (href !== '#algorithm-lab') await expect(target).toBeFocused();
    }
  }
  expect(writes).toEqual([]);
});

test('search discovers all lesson experiments and every saved quiz using public metadata only', async ({ page }) => {
  await page.goto('/search?q=interactive%20lab');
  await page.getByRole('button', { name: 'Lessons', exact: true }).click();
  const lessons = tracks.flatMap(track => track.lessons.filter(lesson => lesson.activities?.lab).map(lesson => `/learn/${track.id}/${lesson.id}`));
  await expect(page.locator('.search-results>a')).toHaveCount(lessons.length);
  for (const href of lessons) await expect(page.locator(`.search-results>a[href="${href}"]`)).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search the Studio', exact: true }).fill('');
  await page.getByRole('button', { name: 'Quizzes', exact: true }).click();
  await expect(page.locator('.search-results>a')).toHaveCount(quizTopics.length);
  for (const topic of quizTopics) await expect(page.locator(`.search-results>a[href="/quiz/${topic.id}"]`)).toContainText(`${topic.count} original questions`);
  await page.getByRole('textbox', { name: 'Search the Studio', exact: true }).fill('vesting');
  const vesting = quizTopics.find(topic => topic.track === 'salary-negotiation' && topic.title.includes('vesting'))!;
  await expect(page.locator(`.search-results>a[href="/quiz/${vesting.id}"]`)).toHaveCount(1);
});

test('release, sign-in and access notices agree with the actual private-beta capabilities', async ({ page }) => {
  await page.goto('/learn/changelog');
  const content = page.locator('.info-article');
  await expect(content).toContainText(`${tracks.flatMap(track => track.lessons).length} original lessons`);
  await expect(content).toContainText(`${courses.length} structured courses`);
  await expect(content).toContainText(`${quizTopics.length} topics and ${quizTopics.reduce((sum, topic) => sum + topic.count, 0)} original questions`);
  await expect(content).toContainText('75 lessons with interactive labs');
  await expect(content).not.toContainText('other four disciplines');
  await page.goto('/security');
  await expect(content).toContainText('Admitted accounts can sign in with a password.');
  await expect(content).toContainText('optional Auth.js integrations');
  await page.goto('/privacy');
  await expect(content).toContainText('only when configured and used');
  await page.goto('/practice/behavioral');
  await page.getByRole('button', { name: /^Full/ }).click();
  await expect(page.getByRole('link', { name: 'Review premium access', exact: false })).toHaveAttribute('href', '/pricing');
  await expect(page.getByRole('link', { name: 'View subscription options', exact: false })).toHaveCount(0);
  await page.goto('/pricing');
  await expect(page.locator('.faq-section')).toContainText('Live subscriptions are not currently offered.');
});

test('all seven learning tracks remain visible in the genuine member workspace', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(browserAccount.email);
  await page.getByLabel('Password', { exact: true }).fill(browserAccount.password);
  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const paths = page.locator('.dashboard-main>.learning-path').first();
  await expect(paths.locator('.path-row')).toHaveCount(tracks.length);
  for (const track of tracks) await expect(paths.locator(`a[href="/learn/${track.id}"]`)).toContainText(track.title);
});

test('updated course badges, search filters and activity anchors stay bounded at 320px in both themes', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    for (const path of ['/learn/courses', '/learn/courses/system-design-complete', '/learn/courses/behavioral', '/learn/salary-negotiation', '/learn/salary-negotiation/compensation', '/search?q=vesting', '/learn/changelog']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path.endsWith('system-design-complete')) {
        for (const details of await page.locator('.course-units>details').all()) {
          if (await details.getAttribute('open') === null) await details.locator('summary').click();
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}, ${theme}`).toBe(true);
    }
  }
});
