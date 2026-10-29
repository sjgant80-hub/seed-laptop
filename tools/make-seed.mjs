#!/usr/bin/env node
// tools/make-seed.mjs — build and sign the stock seed from the vendored blocks.
//
//   node tools/make-seed.mjs     → seeds/stock.genome.json   the signed genome (the light seed: this text alone)
//                                  seeds/stock.full          the full seed (src/bundle.mjs: genome + every block)
//                                  mirror/<sha256>           every block file by its content address: the static
//                                                            mirror a light seed pulls from (published on Pages)
//   node tools/make-seed.mjs --check   rebuild the body from blocks/SOURCES.json; refuse if the committed genome's
//                                      body differs, its signature fails, or the full seed / mirror do not match it
//
// The signature needs the publisher's private key (tools/publisher.mjs), so only --check runs in CI.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seal, open, canonical } from '../src/genome.mjs';
import { makeBundle, readBundle } from '../src/bundle.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => join(ROOT, ...p);

export function stockBody() {
  const s = JSON.parse(readFileSync(at('blocks', 'SOURCES.json'), 'utf8'));
  return {
    kind: 'seed-laptop.genome', v: 1, name: 'stock office',
    blocks: s.blocks.map((b) => ({
      id: b.id, name: b.name, from: b.repo + '@' + b.commit.slice(0, 12), entry: b.entry,
      files: s.files.filter((f) => f.id === b.id).map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })),
    })),
    config: { home: s.blocks[0].id, rail: s.blocks.map((b) => b.id) },
    identity: { founder: null },
    vault: { ref: null },
  };
}

export function blockFiles(body) {
  return body.blocks.flatMap((b) => b.files.map((f) => ({ path: 'blocks/' + b.id + '/' + f.path, bytes: new Uint8Array(readFileSync(at('blocks', b.id, f.path))) })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pinned = JSON.parse(readFileSync(at('seeds', 'publisher.json'), 'utf8')).pinned;
  const body = stockBody();
  if (process.argv.includes('--check')) {
    const text = readFileSync(at('seeds', 'stock.genome.json'), 'utf8');
    const g = await open(text, pinned);
    const problems = [];
    if (!g.ok) problems.push('the committed genome does not open: ' + g.stage + ': ' + g.why);
    else if (canonical(g.body) !== canonical(body)) problems.push('the committed genome does not name the vendored blocks');
    const full = readBundle(new Uint8Array(readFileSync(at('seeds', 'stock.full'))));
    if (!full.ok || full.genome !== text) problems.push('the full seed does not carry the committed genome');
    else for (const f of blockFiles(body)) if (hex(sha256(full.files.get(f.path) || new Uint8Array())) !== hex(sha256(f.bytes))) problems.push('the full seed differs at ' + f.path);
    for (const n of existsSync(at('mirror')) ? readdirSync(at('mirror')) : []) if (hex(sha256(new Uint8Array(readFileSync(at('mirror', n))))) !== n) problems.push('mirror/' + n + ' is not its own content address');
    for (const f of blockFiles(body)) if (!existsSync(at('mirror', hex(sha256(f.bytes))))) problems.push('the mirror lacks ' + f.path);
    console.log(problems.length ? 'SEED CHECK FAILED\n  ' + problems.join('\n  ') : 'SEED CHECK CLEAN — genome ' + g.id.slice(0, 12) + ' opens under the pinned key and names exactly the vendored blocks; the full seed and the mirror carry the same bytes');
    process.exit(problems.length ? 1 : 0);
  }
  const { loadPublisher } = await import('./publisher.mjs');
  const key = await loadPublisher();
  if (!pinned.includes(key.id)) throw new Error('the publisher key on this machine is not the pinned one');
  const s = await seal(body, key);
  if (!s.ok) throw new Error(s.why);
  mkdirSync(at('seeds'), { recursive: true });
  mkdirSync(at('mirror'), { recursive: true });
  writeFileSync(at('seeds', 'stock.genome.json'), s.text);
  const files = blockFiles(body);
  const b = makeBundle(s.text, files);
  if (!b.ok) throw new Error(b.why);
  writeFileSync(at('seeds', 'stock.full'), b.bytes);
  for (const f of files) writeFileSync(at('mirror', hex(sha256(f.bytes))), f.bytes);
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  console.log('stock seed: ' + body.blocks.length + ' blocks, ' + files.length + ' files, ' + total + ' bytes → full seed ' + b.bytes.length + ' bytes; genome ' + s.text.length + ' characters');
}
