import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH || (process.env.CI ? undefined : '/usr/bin/google-chrome'), args: ['--disable-dev-shm-usage'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'tsx scripts/start-next-browser-fixture.ts',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
