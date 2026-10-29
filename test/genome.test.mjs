import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, checkBody, checkBlock, material, seal, open, sigBytes, MAX_GENOME, MAX_BLOCKS, MAX_FILES, MAX_FILE_BYTES, MAX_CONFIG, MAX_DEPTH, DOMAIN } from '../src/genome.mjs';
import { b64u } from '../vendor/fall-kit-core/identity.mjs';
import { body, sealed, testKey, otherKey } from './fixtures.mjs';

test('canonical: sorted keys, no spaces, integers only, refuses what JSON cannot say', () => {
  assert.equal(canonical({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonical('é"'), '"é\\""');
  assert.equal(canonical(0), '0');
  assert.equal(canonical(-5), '-5');
  const refused = [undefined, () => 1, NaN, Infinity, 1.5, -0, 2 ** 53, 10n, Symbol('s'), new Date(0), new Map(), { a: undefined }, [1, undefined], Object.create(null)];
  refused.forEach((bad, i) => assert.equal(canonical(bad), null, 'case ' + i));
  const c = {}; c.self = c;
  assert.equal(canonical(c), null);
  const ca = []; ca.push(ca);
  assert.equal(canonical(ca), null);
  const shared = { x: 1 };
  assert.equal(canonical({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}', 'a value seen twice (not a cycle) is fine');
  assert.equal(canonical({ get a() { throw new Error('toxic'); } }), null);
});

test('canonical: nesting up to MAX_DEPTH, not one more', () => {
  const nest = (d, leaf) => { let x = leaf; for (let i = 0; i < d; i++) x = [x]; return x; };
  assert.equal(canonical(nest(MAX_DEPTH, 1)), '['.repeat(MAX_DEPTH) + '1' + ']'.repeat(MAX_DEPTH));
  assert.equal(canonical(nest(MAX_DEPTH + 1, 1)), null);
  const obj = (d) => { let x = 1; for (let i = 0; i < d; i++) x = { k: x }; return x; };
  assert.notEqual(canonical(obj(MAX_DEPTH)), null);
  assert.equal(canonical(obj(MAX_DEPTH + 1)), null);
  assert.equal(canonical(nest(MAX_DEPTH, [])), null, 'an empty list one level too deep');
  assert.equal(canonical(nest(MAX_DEPTH - 1, [])), '['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH));
});

test('checkBody: the fixture is a genome', () => {
  assert.deepEqual(checkBody(body()), { ok: true });
  assert.deepEqual(checkBody(body({ identity: { founder: 'a'.repeat(64) }, vault: { ref: 'b'.repeat(64) } })), { ok: true });
});

test('checkBody: every field refused by name', () => {
  const cases = [
    [{ extra: 1 }, 'exactly'],
    [{ kind: 'x' }, 'not a seed-laptop genome'],
    [{ v: 2 }, 'not a seed-laptop genome'],
    [{ name: '' }, 'name is 1 to 80'],
    [{ name: 'x'.repeat(81) }, 'name is 1 to 80'],
    [{ blocks: [] }, '1 to ' + MAX_BLOCKS],
    [{ blocks: 'x' }, '1 to ' + MAX_BLOCKS],
    [{ config: [] }, 'plain object'],
    [{ config: { x: 'y'.repeat(MAX_CONFIG) } }, 'plain object'],
    [{ config: { x: 1.5 } }, 'plain object'],
    [{ identity: { founder: 'abc' } }, 'identity.founder'],
    [{ identity: {} }, 'identity.founder'],
    [{ identity: { founder: null, x: 1 } }, 'identity.founder'],
    [{ vault: { ref: 'A'.repeat(64) } }, 'vault.ref'],
    [{ vault: null }, 'vault.ref'],
  ];
  for (const [over, why] of cases) {
    const r = checkBody(body(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.why, new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), JSON.stringify(over));
  }
  const many = body(); many.blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ ...body().blocks[1], id: 'b' + i }));
  assert.equal(checkBody(many).ok, false);
  const max = body(); max.blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => ({ ...body().blocks[1], id: 'b' + i }));
  assert.equal(checkBody(max).ok, true);
  const twice = body(); twice.blocks[1].id = 'docs';
  assert.match(checkBody(twice).why, /named twice/);
  assert.equal(checkBody(body({ config: { x: 'y'.repeat(MAX_CONFIG - 8) } })).ok, true, 'a config at its limit');
  assert.equal(checkBody(body({ name: 'x' })).ok, true, 'a one-character name');
  const one = body(); one.blocks = [one.blocks[0]];
  assert.equal(checkBody(one).ok, true, 'exactly one block');
  assert.equal(checkBody(body({ config: { x: 'y'.repeat(MAX_CONFIG - 7) } })).ok, false, 'one past');
});

test('checkBlock: ids, names, files, paths, pins, entry', () => {
  const b = () => structuredClone(body().blocks[0]);
  assert.deepEqual(checkBlock(b()), { ok: true });
  const bad = [
    [(x) => { x.id = 'Docs'; }, 'block id'],
    [(x) => { x.id = 'a'.repeat(25); }, 'block id'],
    [(x) => { x.name = ''; }, 'a name'],
    [(x) => { x.from = 'x'.repeat(121); }, 'from names'],
    [(x) => { x.files = []; }, '1 to ' + MAX_FILES + ' files'],
    [(x) => { x.files = 'abc'; }, '1 to ' + MAX_FILES + ' files'],
    [(x) => { x.files = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ path: 'f' + i, sha256: 'a'.repeat(64), bytes: 1 })); x.entry = 'f0'; }, 'files'],
    [(x) => { x.files[0].path = '../index.html'; }, 'stays inside'],
    [(x) => { x.files[0].path = 'a/../b'; }, 'stays inside'],
    [(x) => { x.files[0].path = '/etc'; }, 'stays inside'],
    [(x) => { x.files[0].path = 'a/./b'; }, 'stays inside'],
    [(x) => { x.files[1].path = x.files[0].path; }, 'named once'],
    [(x) => { x.files[0].sha256 = 'A'.repeat(64); }, 'SHA-256'],
    [(x) => { x.files[0].bytes = -1; }, 'bytes'],
    [(x) => { x.files[0].bytes = MAX_FILE_BYTES + 1; }, 'bytes'],
    [(x) => { x.files[0].bytes = 1.5; }, 'bytes'],
    [(x) => { x.entry = 'nope.html'; }, 'entry'],
    [(x) => { x.files[0].extra = 1; }, 'exactly'],
    [(x) => { delete x.entry; }, 'exactly'],
  ];
  for (const [mut, why] of bad) { const x = b(); mut(x); const r = checkBlock(x); assert.equal(r.ok, false, why); assert.match(r.why, new RegExp(why)); }
  const ok = b(); ok.files[0].bytes = MAX_FILE_BYTES; ok.files[0].bytes = 0; assert.equal(checkBlock(ok).ok, true);
  const big = b(); big.files[0].bytes = MAX_FILE_BYTES; assert.equal(checkBlock(big).ok, true);
  const deep = b(); deep.files[0].path = 'a/b/c/d'; deep.entry = 'a/b/c/d'; assert.equal(checkBlock(deep).ok, true);
  const tooDeep = b(); tooDeep.files[0].path = 'a/b/c/d/e'; assert.equal(checkBlock(tooDeep).ok, false);
  const exact = b(); exact.files = Array.from({ length: MAX_FILES }, (_, i) => ({ path: 'f' + i, sha256: 'a'.repeat(64), bytes: 1 })); exact.entry = 'f0'; assert.equal(checkBlock(exact).ok, true);
  assert.equal(checkBlock(null).ok, false);
  const id24 = b(); id24.id = 'a'.repeat(24); assert.equal(checkBlock(id24).ok, true);
  const n80 = b(); n80.name = 'x'.repeat(80); n80.from = 'y'.repeat(120); assert.equal(checkBlock(n80).ok, true);
  const n81 = b(); n81.name = 'x'.repeat(81); assert.equal(checkBlock(n81).ok, false);
  const nonStr = b(); nonStr.files[0].path = 5; assert.match(checkBlock(nonStr).why, /stays inside/);
  const one = b(); one.name = 'x'; one.from = 'y'; assert.equal(checkBlock(one).ok, true, 'one-character name and from');
  const notStr = b(); notStr.files[0].sha256 = 5; assert.equal(checkBlock(notStr).ok, false);
});

test('material: the domain then the canonical body', () => {
  const m = new TextDecoder().decode(material(body()));
  assert.equal(m, DOMAIN + canonical(body()));
  assert.equal(material({ a: undefined }), null);
});

test('seal then open: the genome opens, with its signer and id', async () => {
  const { key, text } = await sealed();
  const r = await open(text, [key.id]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, body());
  assert.equal(r.by, key.id);
  assert.match(r.id, /^[0-9a-f]{64}$/);
  assert.equal(text, canonical(JSON.parse(text)));
});

test('seal refuses a bad body or a signer that cannot sign', async () => {
  assert.equal((await seal(body({ v: 9 }), await testKey())).ok, false);
  assert.match((await seal(body(), {})).why, /identity that can sign/);
  assert.match((await seal(body(), { id: 'x' })).why, /identity that can sign/);
  assert.match((await seal(body(), { sign: async () => new Uint8Array(64) })).why, /identity that can sign/);
});

test('open: each stage refuses by name, in order', async () => {
  const { key, text } = await sealed();
  const pin = [key.id];
  assert.equal((await open(5, pin)).stage, 'size');
  assert.equal((await open('x'.repeat(MAX_GENOME + 1), pin)).stage, 'size');
  assert.equal((await open('x'.repeat(MAX_GENOME), pin)).stage, 'json', 'a text at the limit is read (and is not JSON)');
  assert.equal((await open('{', pin)).stage, 'json');
  assert.equal((await open(text.replace('{', '{ '), pin)).stage, 'canonical');
  assert.equal((await open(JSON.stringify(JSON.parse(text), null, 1), pin)).stage, 'canonical');
  const g = JSON.parse(text);
  assert.equal((await open(canonical({ ...g, extra: 1 }), pin)).stage, 'shape');
  assert.equal((await open(canonical({ ...g, body: { ...g.body, v: 2 } }), pin)).stage, 'shape');
  assert.equal((await open(text, [(await otherKey()).id])).stage, 'signer');
  assert.equal((await open(text, 'nope')).stage, 'signer');
  assert.equal((await open(canonical({ ...g, sig: 'short' }), pin)).stage, 'signature');
  assert.equal((await open(canonical({ ...g, sig: 5 }), pin)).stage, 'signature');
  const other = await otherKey();
  const forged = await seal(body(), other);
  const f = JSON.parse(forged.text);
  assert.equal((await open(canonical({ ...f, by: key.id }), pin)).stage, 'signature', 'a valid signature by another key, claimed as ours');
  assert.equal((await open(canonical({ ...g, body: { ...g.body, name: 'changed' } }), pin)).stage, 'signature');
  const rOk = await open(text, [other.id, key.id]);
  assert.equal(rOk.ok, true, 'any pinned key may sign');
  assert.equal((await open(text.slice(0, MAX_GENOME), pin)).ok, true, 'a genome at or under the size limit is read');
});

test('sigBytes: only the one base64url spelling of 64 bytes', () => {
  const sig = new Uint8Array(64).map((_, i) => i * 3);
  const s = b64u(sig);
  assert.equal(s.length, 86);
  assert.deepEqual(sigBytes(s), sig);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const spare = s.slice(0, 85) + alpha[alpha.indexOf(s[85]) ^ 1];
  assert.equal(sigBytes(spare), null, 'same bytes, another spelling');
  const next = s.slice(0, 85) + alpha[alpha.indexOf(s[85]) ^ 16];
  assert.equal(sigBytes(next).length, 64, 'a different last 4 bits is a different signature, still one spelling');
  assert.equal(sigBytes(s.slice(0, 85)), null);
  assert.equal(sigBytes(s + 'A'), null);
  assert.equal(sigBytes(s.slice(0, 85) + '='), null);
  assert.equal(sigBytes(s.replace(/./, '+')), null);
  assert.equal(sigBytes(null), null);
});

test('a spare bit in the signature\'s last character is refused (one spelling only)', async () => {
  const { key, text } = await sealed();
  const g = JSON.parse(text);
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alpha.indexOf(g.sig[85]);
  let refusedSpare = 0;
  // 64 bytes in base64url: the last character carries 2 bits of the signature and 4 spare bits
  for (let low = 0; low < 16; low++) {
    const c = alpha[(last & ~15) | low];
    if (c === g.sig[85]) continue;
    const r = await open(canonical({ ...g, sig: g.sig.slice(0, 85) + c }), [key.id]);
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'signature');
    refusedSpare++;
  }
  assert.equal(refusedSpare, 15);
});
