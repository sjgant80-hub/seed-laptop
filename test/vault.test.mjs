import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, refOf, headerOf, iterationsOk, sizeOk, HEADER, MAGIC, VERSION, MIN_ITERATIONS, MAX_ITERATIONS, MIN_PHRASE, MAX_VAULT } from '../src/vault.mjs';

const PHRASE = 'a vault test phrase, public on purpose';
const FAST = { iterations: MIN_ITERATIONS, salt: new Uint8Array(16).fill(7), iv: new Uint8Array(12).fill(9) };
const enc = new TextEncoder();
const entries = [{ path: 'store.json', bytes: enc.encode('{"a":1}') }, { path: 'office.json', bytes: enc.encode('{"o":2}') }];

test('seal then open: the same files, byte for byte; the header names its iterations, salt and iv', async () => {
  const s = await seal(entries, PHRASE, FAST);
  assert.equal(s.ok, true);
  assert.deepEqual([...s.bytes.subarray(0, 5)], [...MAGIC, VERSION]);
  const h = headerOf(s.bytes);
  assert.equal(h.iterations, MIN_ITERATIONS);
  assert.deepEqual(h.salt, FAST.salt);
  assert.deepEqual(h.iv, FAST.iv);
  const o = await open(s.bytes, PHRASE);
  assert.equal(o.ok, true);
  assert.deepEqual(o.entries, entries);
  assert.equal(o.ref, s.ref);
  assert.match(s.ref, /^[0-9a-f]{64}$/);
  assert.equal(refOf(s.bytes), s.ref);
});

test('the vault holds nothing readable: neither the files nor the phrase appear in it', async () => {
  const s = await seal(entries, PHRASE, FAST);
  const text = new TextDecoder('latin1').decode(s.bytes);
  assert.equal(text.includes('store.json'), false);
  assert.equal(text.includes('{"a":1}'), false);
  assert.equal(text.includes('vault test phrase'), false);
});

test('a wrong phrase restores nothing', async () => {
  const s = await seal(entries, PHRASE, FAST);
  const o = await open(s.bytes, PHRASE + ' but wrong');
  assert.deepEqual(o, { ok: false, stage: 'phrase', why: 'the phrase does not open this vault, or one of its bytes was changed' });
});

test('every bit of the header, and bits across the body, each changed alone: refused, never another state', async () => {
  const s = await seal(entries, PHRASE, FAST);
  const stages = new Set();
  for (let bit = 0; bit < HEADER * 8; bit++) {
    const x = s.bytes.slice(); x[bit >> 3] ^= 1 << (bit & 7);
    if ((bit >> 3) >= 5 && (bit >> 3) <= 8 && (headerOf(x).iterations > 400000)) continue;   // a huge iteration count is refused below, by the range test
    const o = await open(x, PHRASE);
    assert.equal(o.ok, false, 'header bit ' + bit);
    stages.add(o.stage);
  }
  assert.deepEqual([...stages].sort(), ['header', 'magic', 'phrase']);
  const body = (s.bytes.length - HEADER) * 8;
  for (let k = 0; k < 64; k++) {
    const bit = HEADER * 8 + Math.floor((k * body) / 64);
    const x = s.bytes.slice(); x[bit >> 3] ^= 1 << (bit & 7);
    const o = await open(x, PHRASE);
    assert.equal(o.stage, 'phrase', 'body bit ' + bit);
  }
});

test('the header range: iterations below and above what the office writes are refused before any key is made', async () => {
  const s = await seal(entries, PHRASE, FAST);
  const at = (n) => { const x = s.bytes.slice(); x[5] = n >>> 24; x[6] = (n >>> 16) & 255; x[7] = (n >>> 8) & 255; x[8] = n & 255; return x; };
  assert.equal((await open(at(MIN_ITERATIONS - 1), PHRASE)).stage, 'header');
  assert.equal((await open(at(MAX_ITERATIONS + 1), PHRASE)).stage, 'header');
  assert.equal((await open(at(MIN_ITERATIONS + 1), PHRASE)).stage, 'phrase', 'in range but not the one sealed');
});

test('seal and open refuse what is not theirs', async () => {
  assert.match((await seal(entries, 'short')).why, /phrase is/);
  assert.match((await seal(entries, ' '.repeat(MIN_PHRASE + 4))).why, /phrase is/, 'spaces only');
  assert.match((await seal(entries, 'x'.repeat(513))).why, /phrase is/);
  assert.equal((await seal(entries, 'x'.repeat(512), FAST)).ok, true);
  assert.equal((await seal(entries, 'x'.repeat(MIN_PHRASE), FAST)).ok, true);
  assert.match((await seal(entries, PHRASE, { ...FAST, iterations: MIN_ITERATIONS - 1 })).why, /iterations/);
  assert.match((await seal(entries, PHRASE, { ...FAST, iterations: MAX_ITERATIONS + 1 })).why, /iterations/);
  assert.equal((await seal([{ path: '../x', bytes: new Uint8Array(1) }], PHRASE, FAST)).ok, false, 'the LIGHT vault refuses an unsafe path');
  assert.equal((await seal('x', PHRASE, FAST)).ok, true, 'no entries is an empty vault');
  assert.equal((await open('x', PHRASE)).stage, 'size');
  assert.equal((await open(new Uint8Array(HEADER + 15), PHRASE)).stage, 'size');
  assert.equal((await open(new Uint8Array(MAX_VAULT + 1), PHRASE)).stage, 'size');
  const s = await seal(entries, PHRASE, FAST);
  assert.equal((await open(s.bytes, 'short')).stage, 'phrase');
  assert.equal(refOf(new Uint8Array(4)), null);
  assert.equal(headerOf('x'), null);
  const v2 = s.bytes.slice(); v2[4] = 2;
  assert.equal((await open(v2, PHRASE)).stage, 'magic');
  assert.equal(refOf(v2), null);
  const r1 = await seal(entries, PHRASE, { iterations: MIN_ITERATIONS });
  const r2 = await seal(entries, PHRASE, { iterations: MIN_ITERATIONS });
  assert.notEqual(r1.ref, r2.ref, 'a fresh salt and iv each time');
  assert.equal((await open(r1.bytes, PHRASE)).ok, true);
});

test('the vault at its exact edges: iterations, size, the shortest header, near-misses of the magic, options that are not an object', async () => {
  assert.deepEqual([MIN_ITERATIONS - 1, MIN_ITERATIONS, MAX_ITERATIONS, MAX_ITERATIONS + 1, 1.5, '200000'].map(iterationsOk), [false, true, true, false, false, false]);
  assert.deepEqual([HEADER + 15, HEADER + 16, MAX_VAULT, MAX_VAULT + 1, NaN].map(sizeOk), [false, true, true, false, false]);
  const head = (magic = MAGIC, version = VERSION, iterations = MIN_ITERATIONS) => { const h = new Uint8Array(HEADER); h.set(magic, 0); h[4] = version; h[5] = iterations >>> 24; h[6] = (iterations >>> 16) & 255; h[7] = (iterations >>> 8) & 255; h[8] = iterations & 255; return h; };
  assert.equal(headerOf(head()).iterations, MIN_ITERATIONS, 'exactly a header');
  assert.equal(headerOf(head().slice(0, HEADER - 1)), null);
  assert.equal(headerOf(head([0x53, 0x4c, 0x56, 0x32])), null, 'one byte of the magic off');
  assert.equal(headerOf(head(MAGIC, 2)), null, 'another version');
  assert.equal(headerOf(Int8Array.from(head())), null, 'bytes of another kind');
  const tagOnly = new Uint8Array(HEADER + 16); tagOnly.set(head(), 0);
  assert.equal((await open(tagOnly, PHRASE)).stage, 'phrase', 'a header and a tag are the shortest vault looked into');
  assert.equal((await open(tagOnly.slice(0, HEADER + 15), PHRASE)).stage, 'size');
  assert.match((await open(tagOnly.slice(0, HEADER + 15), PHRASE)).why, new RegExp('a vault is ' + (HEADER + 16) + ' bytes to ' + MAX_VAULT + ' bytes'), 'the refusal names the sizes');
  const big = new Uint8Array(HEADER + 16); big.set(head(MAGIC, VERSION, MAX_ITERATIONS + 1), 0);
  assert.equal((await open(big, PHRASE)).stage, 'header', 'refused before any key is made');
  assert.equal((await seal(entries, PHRASE, { ...FAST, iterations: MAX_ITERATIONS + 1 })).ok, false);
  for (const o of [null, 5, 'x']) assert.equal((await seal(entries, PHRASE, o === null ? null : o)).ok, true, 'options that are not an object are none: ' + o);
});
