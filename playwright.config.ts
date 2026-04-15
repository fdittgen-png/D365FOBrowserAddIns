import { defineConfig } from '@playwright/test';

/**
 * Playwright config for end-to-end tests that exercise the built,
 * unpacked extension against the mock D365FO fixture. Before running
 * this suite locally, make sure you have built the extension:
 *
 *   npm run build
 *
 * Then:
 *
 *   npx playwright install chromium
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
