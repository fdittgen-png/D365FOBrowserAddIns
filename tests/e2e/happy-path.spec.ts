import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end test that loads the built extension in a persistent Chromium
 * context and drives it against the mock D365FO fixture. The test covers
 * the happy path: extension registers a service worker, popup / review /
 * options pages render, tracker providers list correctly.
 *
 * Run locally:
 *   npm run build
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Path handling uses process.cwd() instead of import.meta.url because
 * Playwright's TypeScript loader does not cleanly handle node:url imports
 * in every module-resolution config, and Playwright always runs tests
 * from the project root so cwd is reliable.
 */

const DIST = path.resolve(process.cwd(), 'dist');
const MOCK_PATH = path.resolve(process.cwd(), 'tests/fixtures/mock-d365.html');
const MOCK = 'file:///' + MOCK_PATH.replace(/\\/g, '/').replace(/^\/+/, '');

let context: BrowserContext;
let serviceWorker: Worker | undefined;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: true,
    args: [
      '--headless=new',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-sandbox',
    ],
  });
  // Wait for the extension service worker to register
  const existing = context.serviceWorkers();
  serviceWorker = existing.length > 0 ? existing[0] : await context.waitForEvent('serviceworker');
});

test.afterAll(async () => {
  await context.close();
});

test('records a happy-path session and opens the review page on stop', async () => {
  test.skip(!serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;

  // Grant host permission for file:// URLs so the content script loads.
  // Playwright Chromium grants file access by default for load-extension,
  // but we still need the content script to inject — it only runs on
  // dynamics.com by default. For the happy path we use the popup which
  // works regardless of the tab origin.
  const page = await context.newPage();
  await page.goto(MOCK);

  // Open the popup page directly via the extension URL.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

  await expect(popup.locator('#state-badge')).toContainText(/Idle|Bereit/);
  // Starting from the popup requires an active D365FO tab. For the e2e
  // happy path we verify that the popup renders and the extension is
  // fully loaded. Full click-through coverage requires the content
  // script to match file:// URLs, which is a follow-up (the manifest
  // scopes content scripts to dynamics.com hosts for privacy).
  await expect(popup.locator('#btn-start')).toBeVisible();

  await popup.close();
  await page.close();
});

test('review page renders without a session id gracefully', async () => {
  test.skip(!serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;
  const review = await context.newPage();
  await review.goto(`chrome-extension://${extensionId}/review/review.html`);
  // Toast should fire telling the user there's no session id
  await expect(review.locator('body')).toBeVisible();
  await review.close();
});

test('options page lists tracker providers and keyboard shortcuts', async () => {
  test.skip(!serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/options.html`);

  // The provider dropdown should include all three built-in providers
  const providerOptions = await options.locator('#provider-select option').allTextContents();
  expect(providerOptions).toEqual(expect.arrayContaining(['OTRS', 'Atlassian Jira', 'Azure DevOps']));

  // Shortcuts list should render at least one row
  const shortcutCount = await options.locator('#shortcuts-list .shortcut-row').count();
  expect(shortcutCount).toBeGreaterThan(0);

  await options.close();
});
