import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

const entries = {
  'background/service-worker': 'src/background/service-worker.ts',
  'content/recorder': 'src/content/recorder.ts',
  'content/page-hook': 'src/content/page-hook.ts',
  'popup/popup': 'src/popup/popup.ts',
  'review/review': 'src/review/review.ts',
  'options/options': 'src/options/options.ts',
};

const watch = process.argv.includes('--watch');

function copyStatic() {
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(resolve(root, 'public'), dist, { recursive: true });
  patchManifestForBuildMode();
}

/**
 * BUILD_MODE=test turns the production-scoped manifest into a dev-only
 * variant that also matches file:// and http://localhost URLs so the
 * Playwright e2e suite can inject the content script into the mock
 * D365FO fixture served on a local http-server. Never run BUILD_MODE=test
 * for a build you intend to ship.
 */
function patchManifestForBuildMode() {
  if (process.env.BUILD_MODE !== 'test') return;
  const manifestPath = resolve(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const testMatches = ['file:///*', 'http://localhost:*/*', 'http://127.0.0.1:*/*'];
  for (const cs of manifest.content_scripts ?? []) {
    cs.matches = [...(cs.matches ?? []), ...testMatches];
    cs.all_frames = false;
  }
  for (const war of manifest.web_accessible_resources ?? []) {
    war.matches = [...(war.matches ?? []), ...testMatches];
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('[build] patched manifest.json for BUILD_MODE=test');
}

async function run() {
  copyStatic();
  const ctx = await esbuild.context({
    entryPoints: Object.fromEntries(Object.entries(entries).map(([out, inp]) => [out, resolve(root, inp)])),
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    outdir: dist,
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    logLevel: 'info',
    loader: { '.css': 'text', '.html': 'text' },
  });
  if (watch) {
    await ctx.watch();
    console.log('esbuild watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
