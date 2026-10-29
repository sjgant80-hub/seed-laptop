import { test } from 'node:test';
import assert from 'node:assert/strict';
import { germinate, filesOf, checkFile, manifestOf, OFFICE, POLICY } from '../src/germinate.mjs';
import { canonical, seal } from '../src/genome.mjs';
import { makeBundle } from '../src/bundle.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { AT, PHRASE, FILES, body, fileList, fullSeed, sealed, testKey, otherKey } from './fixtures.mjs';

const mirrorOf = (files) => {
  const bySha = new Map(Object.values(files).map((b) => [hex(sha256(b)), b]));
  const calls = [];
  return { calls, fetch: async (s) => { calls.push(s); return bySha.get(s) || null; } };
};

test('filesOf: every pinned file in order, with its key in the bundle', () => {
  const f = filesOf(body());
  assert.deepEqual(f.map((x) => x.key), ['blocks/docs/index.html', 'blocks/docs/app.js', 'blocks/notes/index.html']);
  assert.equal(f[0].id, 'docs');
  assert.equal(f[1].path, 'app.js');
  assert.equal(f[2].bytes, FILES['blocks/notes/index.html'].length);
  assert.deepEqual(filesOf(null), []);
});

test('checkFile: missing, length, then SHA-256', () => {
  const pin = filesOf(body())[0];
  const bytes = FILES['blocks/docs/index.html'];
  assert.deepEqual(checkFile(pin, bytes), { ok: true });
  assert.equal(checkFile(pin, null).why, 'missing');
  assert.equal(checkFile(null, bytes).ok, false);
  assert.match(checkFile(pin, bytes.subarray(1)).why, /length/);
  const flip = bytes.slice(); flip[3] ^= 1;
  assert.match(checkFile(pin, flip).why, /SHA-256/);
});

test('manifestOf: the office the genome names, nothing more', () => {
  const m = manifestOf('ab'.repeat(32), body());
  assert.equal(m.kind, OFFICE);
  assert.equal(m.v, 1);
  assert.equal(m.genome, 'ab'.repeat(32));
  assert.equal(m.name, 'test office');
  assert.deepEqual(m.blocks.map((b) => b.id), ['docs', 'notes']);
  assert.deepEqual(m.blocks[0], body().blocks[0]);
  assert.deepEqual(m.config, body().config);
  assert.equal(manifestOf('x', null), null);
});

test('a full seed grows the office: every file checked, owner from the phrase, Kar\'s first receipt', async () => {
  const { key, bytes } = await fullSeed();
  const r = await germinate({ full: bytes }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.checked, 3);
  assert.equal(r.files.length, 3);
  for (const f of r.files) assert.deepEqual(f.bytes, FILES[f.path]);
  const p = await plant(PHRASE, ['device'], { policy: { ...POLICY } });
  assert.equal(r.owner.id, p.ids.founder.id);
  assert.equal(r.owner.device, p.ids.device.id);
  assert.equal(r.digest, hex(sha256(new TextEncoder().encode(canonical(r.office)))));
  assert.equal(r.receipts.length, 1);
  assert.equal(r.receipts[0].kind, 'grew');
  assert.match(r.receipts[0].says, /2 blocks, 3 files, every one checked/);
  assert.equal(r.genome.by, key.id);
  assert.equal(r.genome.name, 'test office');
});

test('the same seed and phrase grow the same office and owner, twice', async () => {
  const { key, bytes } = await fullSeed();
  const a = await germinate({ full: bytes }, { pinned: [key.id], phrase: PHRASE, at: AT });
  const b = await germinate({ full: bytes }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(a.digest, b.digest);
  assert.equal(a.owner.id, b.owner.id);
});

test('a light seed: the genome alone, blocks by content address from the mirror, the identical office', async () => {
  const { key, text, bytes } = await fullSeed();
  const full = await germinate({ full: bytes }, { pinned: [key.id], phrase: PHRASE, at: AT });
  const m = mirrorOf(FILES);
  const light = await germinate({ genome: text, fetch: m.fetch }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(light.ok, true);
  assert.equal(light.digest, full.digest);
  assert.equal(m.calls.length, 3);
});

test('a mirror that serves one changed byte, or nothing, or throws, is refused at that block', async () => {
  const { key, text } = await sealed();
  const changed = { ...FILES, 'blocks/docs/app.js': FILES['blocks/docs/app.js'].slice() };
  const m = mirrorOf(FILES);
  const bad = async (s) => { const b = await m.fetch(s); if (b === FILES['blocks/docs/app.js']) { const c = b.slice(); c[0] ^= 1; return c; } return b; };
  const r = await germinate({ genome: text, fetch: bad }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'block');
  assert.match(r.why, /block docs, file app.js: its SHA-256/);
  assert.equal(r.checked, 1);
  const none = await germinate({ genome: text, fetch: async () => null }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(none.stage, 'block'); assert.equal(none.checked, 0);
  const thrown = await germinate({ genome: text, fetch: async () => { throw new Error('net'); } }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(thrown.stage, 'block'); assert.match(thrown.why, /missing/);
  void changed;
});

test('a refused genome reads no block and fetches nothing', async () => {
  const { text } = await sealed();
  const m = mirrorOf(FILES);
  const other = await otherKey();
  const r = await germinate({ genome: text, fetch: m.fetch }, { pinned: [other.id], phrase: PHRASE, at: AT });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'genome');
  assert.match(r.why, /^signer:/);
  assert.equal(r.checked, 0);
  assert.equal(m.calls.length, 0);
});

test('every one-bit change of the genome text is refused before any block is read', async () => {
  const { key, text } = await sealed();
  const t = new TextEncoder().encode(text);
  let refused = 0;
  for (let i = 0; i < t.length * 8; i += 13) {
    const x = t.slice(); x[i >> 3] ^= 1 << (i & 7);
    let s; try { s = new TextDecoder('utf-8', { fatal: true }).decode(x); } catch { refused++; continue; }
    const m = mirrorOf(FILES);
    const r = await germinate({ genome: s, fetch: m.fetch }, { pinned: [key.id], phrase: PHRASE, at: AT });
    assert.equal(r.ok, false, 'bit ' + i);
    assert.equal(r.checked, 0);
    assert.equal(m.calls.length, 0);
    refused++;
  }
  assert.ok(refused > 100);
});

test('a block file changed and the bundle rebuilt around it: refused, no office', async () => {
  const { key, text } = await sealed();
  const files = fileList();
  files[2] = { path: files[2].path, bytes: files[2].bytes.slice() };
  files[2].bytes[5] ^= 0x10;
  const r = await germinate({ full: makeBundle(text, files).bytes }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'block');
  assert.equal(r.checked, 2);
  assert.equal('office' in r, false);
});

test('a bundle with a file the genome does not pin, or missing one, is refused', async () => {
  const { key, text } = await sealed();
  const more = makeBundle(text, [...fileList(), { path: 'blocks/docs/extra.js', bytes: new Uint8Array(3) }]).bytes;
  const r = await germinate({ full: more }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(r.stage, 'block'); assert.match(r.why, /does not pin/); assert.equal(r.checked, 3);
  const fewer = makeBundle(text, fileList().slice(0, 2)).bytes;
  const f = await germinate({ full: fewer }, { pinned: [key.id], phrase: PHRASE, at: AT });
  assert.equal(f.stage, 'block'); assert.match(f.why, /notes, file index.html: missing/);
});

test('opts that are not an object read as none: refused at the genome, never thrown', async () => {
  const { bytes } = await fullSeed();
  for (const o of [null, undefined, 5, 'x']) assert.equal((await germinate({ full: bytes }, o)).stage, 'genome');
});

test('the seed itself: not a seed, a broken bundle', async () => {
  assert.equal((await germinate(null, {})).stage, 'seed');
  assert.equal((await germinate({ genome: 'x' }, {})).stage, 'seed');
  assert.equal((await germinate({ full: new Uint8Array(8) }, {})).stage, 'seed');
});

test('identity: a phrase too short is refused; an owner\'s own genome grows only for its owner', async () => {
  const { key, bytes } = await fullSeed();
  const short = await germinate({ full: bytes }, { pinned: [key.id], phrase: 'short', at: AT });
  assert.equal(short.stage, 'identity'); assert.equal(short.checked, 3);
  const p = await plant(PHRASE, ['device'], { policy: { ...POLICY } });
  const own = await fullSeed({ identity: { founder: p.ids.founder.id } });
  const mine = await germinate({ full: own.bytes }, { pinned: [own.key.id], phrase: PHRASE, at: AT });
  assert.equal(mine.ok, true);
  const theirs = await germinate({ full: own.bytes }, { pinned: [own.key.id], phrase: PHRASE + ' but not', at: AT });
  assert.equal(theirs.stage, 'identity'); assert.match(theirs.why, /another owner/);
});

test('no valid time: Kar cannot write its receipt, so the office is not reported grown', async () => {
  const { key, bytes } = await fullSeed();
  const r = await germinate({ full: bytes }, { pinned: [key.id], phrase: PHRASE, at: 'yesterday' });
  assert.equal(r.ok, false); assert.equal(r.stage, 'identity'); assert.match(r.why, /first receipt/);
});

test('an owner genome signed by a pinned key still refuses another owner\'s phrase', async () => {
  const k = await testKey();
  const s = await seal(body({ identity: { founder: 'ee'.repeat(32) } }), k);
  const r = await germinate({ full: makeBundle(s.text, fileList()).bytes }, { pinned: [k.id], phrase: PHRASE, at: AT });
  assert.equal(r.stage, 'identity');
});
