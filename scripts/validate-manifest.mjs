#!/usr/bin/env node
/**
 * Guards against accidentally re-broadening `optional_host_permissions`
 * or `host_permissions` in the manifest to `<all_urls>` or a scheme-wide
 * wildcard. Both forms will be flagged by Edge Add-Ons / Chrome Web Store
 * review, so we keep them out of the tree.
 *
 * Run this as part of CI after the build step. Exits non-zero on any
 * offending pattern.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'public/manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const BANNED = [
  '<all_urls>',
  'http://*/*',
  'https://*/*',
  '*://*/*',
];

const keys = ['permissions', 'host_permissions', 'optional_host_permissions'];
const violations = [];
for (const key of keys) {
  const values = manifest[key];
  if (!Array.isArray(values)) continue;
  for (const v of values) {
    if (BANNED.includes(v)) {
      violations.push(`${key}: "${v}" is too broad for store review`);
    }
  }
}

if (violations.length > 0) {
  console.error('Manifest validation failed:');
  for (const v of violations) console.error('  ✗ ' + v);
  process.exit(1);
}

console.log('manifest ok — no overly-broad permissions');
