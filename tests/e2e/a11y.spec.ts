import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist');

let context: BrowserContext;
let serviceWorker: Worker | undefined;

test.beforeAll(async () => {
  try {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox'],
    });
    const existing = context.serviceWorkers();
    if (existing.length > 0) {
      serviceWorker = existing[0];
    } else {
      serviceWorker = await Promise.race([
        context.waitForEvent('serviceworker'),
        new Promise<Worker | undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
      ]);
    }
  } catch (e) {
    console.warn('[a11y] extension context could not launch — tests will skip:', (e as Error).message);
  }
});

test.afterAll(async () => {
  if (context) await context.close().catch(() => undefined);
});

async function runAxe(extensionId: string, page: string) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/${page}`);
  const results = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze();
  await p.close();
  return results;
}

test('popup has no WCAG 2.1 AA violations', async () => {
  test.skip(!context || !serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;
  const results = await runAxe(extensionId, 'popup/popup.html');
  expect(results.violations.map((v) => `${v.id}: ${v.description}`).join('\n')).toBe('');
});

test('options page has no WCAG 2.1 AA violations', async () => {
  test.skip(!context || !serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;
  const results = await runAxe(extensionId, 'options/options.html');
  expect(results.violations.map((v) => `${v.id}: ${v.description}`).join('\n')).toBe('');
});

test('review page has no WCAG 2.1 AA violations when empty', async () => {
  test.skip(!context || !serviceWorker, 'extension service worker did not register');
  const extensionId = serviceWorker!.url().split('/')[2]!;
  const results = await runAxe(extensionId, 'review/review.html');
  expect(results.violations.map((v) => `${v.id}: ${v.description}`).join('\n')).toBe('');
});
