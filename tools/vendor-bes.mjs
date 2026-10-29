#!/usr/bin/env node
// tools/vendor-bes.mjs — the behavioural layer (BES), copied byte for byte from bes-inward at the commit named, and
// pinned. The seed laptop uses it as bes-inward built it: a regrown device starts its owner's watch fresh, and a watch
// that is still forming enforces nothing (observe-only) — so a new device can never lock its owner out (claim L4).
//
//   node tools/vendor-bes.mjs          copy from the local clone's git objects (never its working tree) → vendor/bes-inward/
//   node tools/vendor-bes.mjs --check  re-hash every copied file against vendor/bes-inward/SOURCES.json
//
// After Gary W. Floyd's Behavioral Entropy Signatures and Bayesian Entropy Similarity (Lumiea Systems Research
// Division — ThunderStruck Service, LLC), as bes-inward credits them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'eca438d';
const FILES = ['src/watch.mjs', 'src/entropy.mjs', 'src/gep.mjs', 'src/trust.mjs'];
const SOURCES = join(ROOT, 'vendor', 'bes-inward', 'SOURCES.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const s = JSON.parse(readFileSync(SOURCES, 'utf8'));
    const bad = s.files.filter((f) => sha(readFileSync(join(ROOT, 'vendor', 'bes-inward', f.path))) !== f.sha256);
    console.log(bad.length ? 'BES CHECK FAILED: ' + bad.map((f) => f.path).join(', ') : 'BES CHECK CLEAN — ' + s.files.length + ' files byte-identical to bes-inward@' + s.commit.slice(0, 7));
    process.exit(bad.length ? 1 : 0);
  }
  const repo = join(ROOT, '..', 'bes-inward');
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', COMMIT], { encoding: 'utf8' }).trim();
  const files = [];
  for (const f of FILES) {
    const bytes = execFileSync('git', ['-C', repo, 'show', commit + ':' + f], { maxBuffer: 1 << 26 });
    const to = join(ROOT, 'vendor', 'bes-inward', f.replace(/^src\//, ''));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    files.push({ path: f.replace(/^src\//, ''), src: f, sha256: sha(bytes) });
  }
  writeFileSync(SOURCES, JSON.stringify({ kind: 'seed-laptop.vendor.bes', v: 1, repo: 'sjgant80-hub/bes-inward', commit, note: 'Copied verbatim from git objects at the commit named. Never edit; re-vendor. BES after Gary W. Floyd (Lumiea Systems Research Division — ThunderStruck Service, LLC).', files }, null, 1) + '\n');
  console.log('vendored ' + files.length + ' BES files from bes-inward@' + commit.slice(0, 7));
}
