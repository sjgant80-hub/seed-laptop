#!/usr/bin/env node
// tools/serve.mjs — a static folder on loopback only: the owner's own origin in the host-OS mode, and the stand-in for
// "the owner's own mirror or static hosting" in the measurements. Serves files, nothing else: no listing, no writes,
// nothing outside the folder, loopback (127.0.0.1) only.
//
//   node tools/serve.mjs <folder> [port]          prints { port } and serves until stopped
//   const s = await serve(folder, port?)          → { port, url, hits: [{ path, status }], close() }
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

export function serve(folder, port = 0) {
  const root = resolve(folder);
  const hits = [];
  const server = createServer(async (req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
    const inside = file === root || file.startsWith(root + sep);
    let status = 404;
    if (req.method === 'GET' && inside) {
      try {
        const s = await stat(file);
        if (s.isFile()) {
          const body = await readFile(file);
          status = 200;
          res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
          res.end(body);
        }
      } catch { /* not there */ }
    }
    hits.push({ path, status });
    if (status !== 200) res.writeHead(status).end();
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    ok({ port: p, url: 'http://127.0.0.1:' + p + '/', hits, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await serve(process.argv[2] || '.', Number(process.argv[3] || 0));
  console.log(JSON.stringify({ port: s.port, url: s.url }));
}
