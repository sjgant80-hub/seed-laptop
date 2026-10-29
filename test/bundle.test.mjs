import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBundle, readBundle, MAGIC, VERSION, HEADER, MAX_SEED, GENOME } from '../src/bundle.mjs';
import { pack } from '../vendor/fall-kit-core/vendor/light/vault.mjs';
import { fileList, FILES } from './fixtures.mjs';

const enc = new TextEncoder();

test('make then read: the genome text and every file, byte for byte', () => {
  const b = makeBundle('{"g":1}', fileList());
  assert.equal(b.ok, true);
  assert.deepEqual([...b.bytes.subarray(0, 5)], [...MAGIC, VERSION]);
  const r = readBundle(b.bytes);
  assert.equal(r.ok, true);
  assert.equal(r.genome, '{"g":1}');
  assert.equal(r.files.size, 3);
  for (const [k, v] of Object.entries(FILES)) assert.deepEqual(r.files.get(k), v);
  assert.equal(r.files.has(GENOME), false, 'the genome is not a block file');
});

test('makeBundle refuses what is not a bundle', () => {
  assert.equal(makeBundle('', []).ok, false);
  assert.equal(makeBundle(5, []).ok, false);
  assert.equal(makeBundle('g', 'x').ok, false);
  assert.match(makeBundle('g', [{ path: 'other/x', bytes: new Uint8Array(1) }]).why, /under blocks/);
  assert.match(makeBundle('g', [null]).why, /under blocks/);
  assert.equal(makeBundle('g', [{ path: 'blocks/a', bytes: 'x' }]).ok, false, 'the vault refuses what is not bytes');
  assert.equal(makeBundle('g', []).ok, true, 'a genome alone is a bundle');
});

test('readBundle: size, magic, version, vault, genome — each refused by stage', () => {
  const good = makeBundle('{"g":1}', fileList()).bytes;
  assert.equal(readBundle('x').stage, 'size');
  assert.equal(readBundle(new Uint8Array(HEADER)).stage, 'size');
  assert.equal(readBundle(new Uint8Array(MAX_SEED + 1)).stage, 'size');
  assert.equal(readBundle(new Uint8Array(MAX_SEED)).stage, 'magic', 'a seed at the size limit is read');
  const m = good.slice(); m[0] ^= 1; assert.equal(readBundle(m).stage, 'magic');
  const m3 = good.slice(); m3[3] ^= 1; assert.equal(readBundle(m3).stage, 'magic');
  const v = good.slice(); v[4] = 2; assert.equal(readBundle(v).stage, 'magic');
  const cut = good.slice(0, good.length - 3); assert.equal(readBundle(cut).stage, 'vault');
  const noGenome = pack([{ path: 'blocks/x', bytes: new Uint8Array(2) }], {}).bytes;
  const ng = new Uint8Array(HEADER + noGenome.length); ng.set(MAGIC); ng[4] = VERSION; ng.set(noGenome, HEADER);
  assert.equal(readBundle(ng).stage, 'genome');
  const badText = pack([{ path: GENOME, bytes: Uint8Array.of(0xff, 0xfe) }], {}).bytes;
  const bt = new Uint8Array(HEADER + badText.length); bt.set(MAGIC); bt[4] = VERSION; bt.set(badText, HEADER);
  assert.equal(readBundle(bt).stage, 'genome');
  assert.equal(readBundle(makeBundle('{"g":1}', []).bytes).ok, true);
});

test('one bit changed anywhere in the bundle: refused, or reads back the same bytes', () => {
  const good = makeBundle('{"g":1}', fileList()).bytes;
  const want = readBundle(good);
  let refused = 0, same = 0;
  for (let i = 0; i < good.length * 8; i += 7) {
    const x = good.slice(); x[i >> 3] ^= 1 << (i & 7);
    const r = readBundle(x);
    if (!r.ok) { refused++; continue; }
    assert.equal(r.genome, want.genome, 'bit ' + i);
    for (const [k, v] of want.files) assert.deepEqual(r.files.get(k), v, 'bit ' + i + ' ' + k);
    same++;
  }
  assert.ok(refused > 0);
});

test('a genome is read only as UTF-8 text', () => {
  const r = readBundle(makeBundle('héllo ✓', []).bytes);
  assert.equal(r.genome, 'héllo ✓');
  assert.deepEqual(enc.encode(r.genome), enc.encode('héllo ✓'));
});
