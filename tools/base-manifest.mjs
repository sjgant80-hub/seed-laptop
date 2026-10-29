#!/usr/bin/env node
// tools/base-manifest.mjs — what is in the minimal base, exactly. Run INSIDE the built image (CI does):
//
//   docker run --rm --network none seed-base node tools/base-manifest.mjs > base/MANIFEST.json
//
// Lists the Alpine release, every installed package with its version (from apk's own database), the Node version,
// and every file under /usr/local (where Node lives) with its size. The planting runtime under /plant is not listed:
// it is this repo's own files, checked against the repo at each commit instead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function packagesOf(apkDb) {
  const out = [];
  for (const block of String(apkDb).split('\n\n')) {
    const p = /^P:(.+)$/m.exec(block), v = /^V:(.+)$/m.exec(block);
    if (p && v) out.push(p[1] + '-' + v[1]);
  }
  return out.sort();
}

function walk(dir, out) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const s = statSync(p, { throwIfNoEntry: false });
    if (!s) continue;
    if (s.isDirectory()) walk(p, out); else out.push(p + ' ' + s.size);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = {
    kind: 'seed-laptop.base',
    v: 1,
    image: 'node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4, package managers removed',
    alpine: readFileSync('/etc/alpine-release', 'utf8').trim(),
    node: process.version,
    arch: process.arch,
    packages: packagesOf(readFileSync('/lib/apk/db/installed', 'utf8')),
    usrLocal: walk('/usr/local', []),
  };
  m.counts = { packages: m.packages.length, usrLocalFiles: m.usrLocal.length };
  process.stdout.write(JSON.stringify(m, null, 1) + '\n');
}
