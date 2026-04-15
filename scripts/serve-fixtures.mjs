#!/usr/bin/env node
/**
 * Tiny static file server for Playwright e2e tests. Serves
 * tests/fixtures/ on 127.0.0.1:4567 with no caching. Zero dependencies
 * so CI doesn't have to hit npm for a separate package.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', 'tests', 'fixtures');
const PORT = Number(process.env.FIXTURE_PORT || 4567);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    let url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`).pathname;
    if (url.endsWith('/')) url += 'index.html';
    const filePath = join(root, url);
    // Path traversal guard
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = (url.match(/\.[^.]+$/) || [''])[0];
    const type = MIME[ext] || 'application/octet-stream';
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-fixtures] listening on http://127.0.0.1:${PORT} (root=${root})`);
});
