import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
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
}

async function run() {
  copyStatic();
  const ctx = await esbuild.context({
    entryPoints: Object.fromEntries(
      Object.entries(entries).map(([out, inp]) => [out, resolve(root, inp)])
    ),
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
