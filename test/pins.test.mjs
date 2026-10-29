// test/pins.test.mjs — everything the office stands on is byte-identical to what it was pinned to:
// the shared foundation (vendor/fall-kit-core, FALL-KIT-CORE.json), the office's blocks (blocks/SOURCES.json),
// and the stock seed (its genome opens under the pinned publisher key and names exactly those blocks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { open, canonical } from '../src/genome.mjs';
import { readBundle } from '../src/bundle.mjs';
import { stockBody } from '../tools/make-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('the shared foundation is fall-kit/core, byte for byte, every file pinned', () => {
  const dir = join(ROOT, 'vendor', 'fall-kit-core');
  const pin = JSON.parse(readFileSync(join(dir, 'FALL-KIT-CORE.json'), 'utf8'));
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  const files = walk(dir).map((p) => relative(dir, p).split('\\').join('/')).filter((p) => !['FALL-KIT-CORE.json', 'NOTICE'].includes(p));
  assert.deepEqual(files.sort(), Object.keys(pin.files).sort(), 'no file more, no file less');
  for (const [p, h] of Object.entries(pin.files)) assert.equal(sha(readFileSync(join(dir, p))), h, p);
});

test('every block file is the pinned upstream bytes', () => {
  const s = JSON.parse(readFileSync(join(ROOT, 'blocks', 'SOURCES.json'), 'utf8'));
  assert.ok(s.files.length >= 5);
  for (const f of s.files) {
    const b = readFileSync(join(ROOT, 'blocks', f.id, f.path));
    assert.equal(b.length, f.bytes, f.id + '/' + f.path);
    assert.equal(sha(b), f.sha256, f.id + '/' + f.path);
    assert.match(f.commit, /^[0-9a-f]{40}$/);
  }
});

test('the stock seed opens under the pinned publisher key and names exactly the vendored blocks', async () => {
  const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  const text = readFileSync(join(ROOT, 'seeds', 'stock.genome.json'), 'utf8');
  const g = await open(text, pinned);
  assert.equal(g.ok, true, g.why);
  assert.equal(canonical(g.body), canonical(stockBody()));
  const full = readBundle(new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full'))));
  assert.equal(full.ok, true);
  assert.equal(full.genome, text);
  for (const b of g.body.blocks) for (const f of b.files) {
    const bytes = full.files.get('blocks/' + b.id + '/' + f.path);
    assert.equal(sha(bytes), f.sha256);
    assert.equal(sha(readFileSync(join(ROOT, 'mirror', f.sha256))), f.sha256, 'the mirror holds it at its content address');
  }
});
