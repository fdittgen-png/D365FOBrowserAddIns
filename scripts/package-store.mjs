#!/usr/bin/env node
/**
 * Packages the built extension into a .zip ready to upload to Microsoft
 * Edge Add-Ons Partner Center or the Chrome Web Store.
 *
 *   node scripts/package-store.mjs            # rebuilds + packages
 *   node scripts/package-store.mjs --no-build # uses existing dist/
 *
 * Output: dist-store/d365fo-browser-addins-<version>-{edge,chrome}.zip
 *
 * Both zips are identical — the split is only so you can upload a
 * distinct artifact per store for bookkeeping. Edge Add-Ons and the
 * Chrome Web Store both accept the same manifest.json and file layout.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const outDir = resolve(root, 'dist-store');

const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  console.log('[package-store] running production build (BUILD_MODE unset)');
  // Explicitly clear BUILD_MODE so the test-mode manifest patch doesn't apply.
  const env = { ...process.env };
  delete env.BUILD_MODE;
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env,
    shell: true,
  });
  if (result.status !== 0) {
    console.error('[package-store] build failed');
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(distDir)) {
  console.error('[package-store] dist/ does not exist — run `npm run build` first');
  process.exit(1);
}

// Sanity check: the manifest inside dist/ must NOT contain the test-mode
// localhost/file:// patterns. Those are only added under BUILD_MODE=test
// and must never ship to a store.
const manifest = JSON.parse(readFileSync(resolve(distDir, 'manifest.json'), 'utf8'));
const testPatterns = ['file:///*', 'http://localhost:*/*', 'http://127.0.0.1:*/*'];
for (const cs of manifest.content_scripts ?? []) {
  for (const match of cs.matches ?? []) {
    if (testPatterns.includes(match)) {
      console.error(`[package-store] refusing to package a test-mode build (matches includes ${match})`);
      console.error('                run `unset BUILD_MODE && npm run build` and try again');
      process.exit(1);
    }
  }
}

const version = manifest.version;
if (!version) {
  console.error('[package-store] dist/manifest.json has no version');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function writeZip(target) {
  const zip = new AdmZip();
  zip.addLocalFolder(distDir);
  zip.writeZip(target);
  const size = zip.toBuffer().length;
  console.log(`  ${target}  (${size} B)`);
}

const edgeZip = resolve(outDir, `d365fo-browser-addins-${version}-edge.zip`);
const chromeZip = resolve(outDir, `d365fo-browser-addins-${version}-chrome.zip`);
writeZip(edgeZip);
writeZip(chromeZip);

console.log(`\nstore packages ready in ${outDir}`);
console.log(`Upload the edge.zip to partner.microsoft.com (Packages section).`);
console.log(`The chrome.zip is identical — keep it for the Chrome Web Store listing.`);
