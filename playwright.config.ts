import { defineConfig } from '@playwright/test';

/**
 * Playwright config for end-to-end tests that exercise the built,
 * unpacked extension against the mock D365FO fixture.
 *
 * Before running locally:
 *   BUILD_MODE=test npm run build
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * BUILD_MODE=test patches the content script matches in dist/manifest.json
 * to also cover http://localhost:*, so the fixture served by webServer
 * gets the recorder injected.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4567',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx --yes http-server -p 4567 -s tests/fixtures',
    port: 4567,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
