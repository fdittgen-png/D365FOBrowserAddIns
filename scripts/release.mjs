#!/usr/bin/env node
/**
 * Version bump helper.
 *
 * Usage:
 *   node scripts/release.mjs 0.2.0
 *
 * Updates package.json, package-lock.json, public/manifest.json, and the
 * Unreleased section of CHANGELOG.md to the new version. Does not commit
 * or tag — that is a deliberate manual step so you can review the diff
 * first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/release.mjs <semver>');
  console.error('Example: node scripts/release.mjs 0.2.0');
  process.exit(1);
}

function bumpJson(path, updater) {
  const full = resolve(root, path);
  const raw = readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  updater(parsed);
  writeFileSync(full, JSON.stringify(parsed, null, 2) + '\n');
  console.log(`  updated ${path}`);
}

bumpJson('package.json', (p) => { p.version = version; });
bumpJson('public/manifest.json', (m) => { m.version = version; });

try {
  bumpJson('package-lock.json', (lock) => {
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  });
} catch (e) {
  console.warn('  skipped package-lock.json:', e.message);
}

// Promote the Unreleased block in CHANGELOG.md to the new version.
const changelogPath = resolve(root, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
if (changelog.includes('## [Unreleased]')) {
  changelog = changelog.replace(
    '## [Unreleased]',
    `## [Unreleased]\n\n## [${version}] - ${today}`,
  );
  writeFileSync(changelogPath, changelog);
  console.log('  updated CHANGELOG.md');
}

console.log(`\nBumped to ${version}. Next steps:`);
console.log(`  git diff`);
console.log(`  git commit -am "chore: release v${version}"`);
console.log(`  git tag v${version}`);
console.log(`  git push && git push --tags`);
