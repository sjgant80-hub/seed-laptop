#!/usr/bin/env node
// tools/build-office.mjs — list every file the office needs offline, with its SHA-256, for the service worker.
//
//   node tools/build-office.mjs           write office/precache.mjs
//   node tools/build-office.mjs --check   refuse if office/precache.mjs is not what the files are now (CI runs it)
//
// The service worker (office/sw.js) caches exactly these files at install and refuses any whose bytes differ.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d) => readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function precache() {
  const files = [
    ...['index.html', 'shell.mjs', 'edges.mjs', 'keep.mjs', 'devices.mjs', 'frame.html', 'office.css', 'manifest.webmanifest', 'icon.svg'].map((f) => join(ROOT, 'office', f)),
    ...walk(join(ROOT, 'src')).filter((p) => p.endsWith('.mjs')),
    ...walk(join(ROOT, 'vendor', 'fall-kit-core')).filter((p) => p.endsWith('.mjs')),
    ...walk(join(ROOT, 'vendor', 'bes-inward')).filter((p) => p.endsWith('.mjs')),
    ...['publisher.json', 'stock.full', 'stock.genome.json'].map((f) => join(ROOT, 'seeds', f)),
  ];
  const list = files.map((p) => ({ path: relative(join(ROOT, 'office'), p).split('\\').join('/'), sha256: sha(readFileSync(p)) }));
  const version = sha(JSON.stringify(list)).slice(0, 12);
  return '// office/precache.mjs — written by tools/build-office.mjs: every file the office needs offline, with its SHA-256.\n' +
    'export const VERSION = ' + JSON.stringify(version) + ';\n' +
    'export const FILES = ' + JSON.stringify(list, null, 1) + ';\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(ROOT, 'office', 'precache.mjs');
  const text = precache();
  if (process.argv.includes('--check')) {
    const same = readFileSync(out, 'utf8') === text;
    console.log(same ? 'PRECACHE CLEAN — office/precache.mjs lists exactly the files the office has now' : 'PRECACHE STALE — run node tools/build-office.mjs');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(out, text);
  console.log('office/precache.mjs: ' + (text.match(/"path"/g) || []).length + ' files');
}
