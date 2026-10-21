import { test, expect, type Page } from './browser-fixtures';
import { browserAccount } from './browser-account';
import { problems, tracks } from '../shared/public-catalog';

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
