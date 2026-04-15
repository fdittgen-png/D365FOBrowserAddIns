#!/usr/bin/env node
/**
 * Rasterizes assets/icons/icon.svg into public/icons/icon{16,32,48,128}.png
 * using sharp. This is a dev-only tool: icons are committed to the repo
 * pre-rasterized so CI does not need to install sharp.
 *
 * Usage:
 *   npm install --no-save sharp
 *   node scripts/rasterize-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'assets/icons/icon.svg');
const outDir = resolve(root, 'public/icons');

const SIZES = [16, 32, 48, 128];

async function run() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp is not installed. Run: npm install --no-save sharp');
    process.exit(1);
  }
  const svg = readFileSync(svgPath);
  mkdirSync(outDir, { recursive: true });
  for (const size of SIZES) {
    const out = resolve(outDir, `icon${size}.png`);
    const buf = await sharp(svg, { density: size * 4 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(out, buf);
    console.log(`  ${out} (${size}x${size})`);
  }
  console.log('\nRasterized. Commit public/icons/*.png.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
