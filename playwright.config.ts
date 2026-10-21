import { defineConfig, devices } from '@playwright/test';
import { browserOrigin } from './tests/browser-account';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: browserOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH || (process.env.CI ? undefined : '/usr/bin/google-chrome'), args: ['--disable-dev-shm-usage'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'tsx scripts/start-next-browser-fixture.ts',
    url: `${browserOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
