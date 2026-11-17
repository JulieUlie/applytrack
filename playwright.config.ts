import { defineConfig, devices } from '@playwright/test';

// Run against a deployed app with BASE_URL=https://…; otherwise Playwright starts `wrangler dev` itself.
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const startLocalServer = !process.env.BASE_URL;
// over the internet: allow for network delays, and retry once (a retried pass is reported as flaky, not hidden)
const remote = BASE_URL.startsWith('https://');

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI || remote ? 1 : 0,
  expect: { timeout: remote ? 10_000 : 5_000 },
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'site/reports/playwright', open: 'never' }],
    ['json', { outputFile: 'results/playwright.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'on',
  },
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'chromium', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
    // cross-browser: the same flows in Firefox and WebKit (Safari's engine); axe scans only need one engine
    { name: 'firefox', testDir: './tests/ui', testIgnore: /accessibility/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testDir: './tests/ui', testIgnore: /accessibility/, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', testDir: './tests/ui', grep: /@mobile/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: startLocalServer
    ? {
        command: 'npx wrangler dev --port 8787 --ip 127.0.0.1',
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
