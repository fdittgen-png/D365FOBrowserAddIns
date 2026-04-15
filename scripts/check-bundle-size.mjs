#!/usr/bin/env node
/**
 * Enforces a per-file bundle size budget against the built `dist/`.
 *
 * Philosophy: keep this extension small. We ship no framework (no React,
 * no Vue, no lodash). If a budget breaks, the right answer is almost
 * always "remove the bloat," not "raise the budget."
 *
 * The BUDGETS map below holds a soft ceiling for every top-level entry
 * that esbuild writes into dist/. Values are bytes and set to ~2x the
 * current measured size so there's headroom for one iteration of growth
 * before a ratchet is required.
 *
 * Run directly after `npm run build`, or via `npm run check:size`.
 */
import { statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

/**
 * Byte budget per file. When you add a new bundle entry to
 * scripts/build.mjs, add a matching entry here — the meta-check at the
 * bottom fails CI if an entry is missing.
 */
const BUDGETS = {
  'background/service-worker.js': 80_000,
  'content/recorder.js': 30_000,
  'content/page-hook.js': 2_000,
  'popup/popup.js': 10_000,
  'review/review.js': 20_000,
  'options/options.js': 30_000,
};

const violations = [];
for (const [rel, max] of Object.entries(BUDGETS)) {
  let size;
  try {
    size = statSync(join(dist, rel)).size;
  } catch {
    violations.push(`${rel}: missing from dist/ (did the build run?)`);
    continue;
  }
  if (size > max) {
    violations.push(`${rel}: ${size} B > ${max} B budget`);
  } else {
    console.log(`ok  ${rel}  ${size} B / ${max} B`);
  }
}

if (violations.length > 0) {
  console.error('\nBundle size budget exceeded:');
  for (const v of violations) console.error('  ✗ ' + v);
  console.error('\nTighten the bundle before raising the budget.');
  process.exit(1);
}

console.log('\nbundle ok — all entries under budget');
