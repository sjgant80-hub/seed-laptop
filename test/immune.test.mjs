import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mint, valid, recognise, tally, PERMANENT, FAMILY } from '../src/immune.mjs';

const SHA = 'a'.repeat(64), EDGE = 'e'.repeat(64), OTHER = 'f'.repeat(64);

test('mint: an antibody only for a refusal that the bytes alone decide', () => {
  const a = mint(SHA, 'pdf', { stage: 'shape', why: 'cut short' }, EDGE, 'dev1', 5);
  assert.deepEqual(a, { sha: SHA, declared: 'pdf', stage: 'shape', family: 'cut short, or glued to another file', why: 'cut short', edge: EDGE, device: 'dev1', at: 5 });
  assert.equal(valid(a), true);
  for (const s of PERMANENT) assert.equal(mint(SHA, 'pdf', { stage: s, why: 'x' }, EDGE, 'd', 0).family, FAMILY[s]);
  assert.equal(mint(SHA, 'exe', { stage: 'type', why: 'not read' }, EDGE, 'd', 0), null, 'the type stage depends on the name alone');
  assert.equal(mint(SHA, 'pdf', { stage: 'stopped', why: 'ran past 5000 ms' }, EDGE, 'd', 0), null, 'a stopped reader depends on the machine');
  assert.equal(mint(SHA, 'pdf', { stage: 'toString', why: 'x' }, EDGE, 'd', 0), null);
  assert.equal(mint(SHA, 'pdf', null, EDGE, 'd', 0), null);
  assert.equal(mint('A'.repeat(64), 'pdf', { stage: 'size', why: 'x' }, EDGE, 'd', 0), null, 'a hash is lower-case hex');
  assert.equal(mint(SHA, '', { stage: 'size', why: 'x' }, EDGE, 'd', 0), null);
  assert.equal(mint(SHA, 'p'.repeat(65), { stage: 'size', why: 'x' }, EDGE, 'd', 0), null);
  assert.equal(mint(SHA, 'p'.repeat(64), { stage: 'size', why: 'x' }, EDGE, 'd', 0).declared.length, 64);
  assert.equal(mint(SHA, 'pdf', { stage: 'size', why: 'x' }, 'e', 'd', 0), null);
  assert.equal(mint(SHA, 'pdf', { stage: 'size', why: 'x' }, EDGE, '', 0), null);
  assert.equal(mint(SHA, 'pdf', { stage: 'size', why: 'x' }, EDGE, 'd', 1.5), null);
  assert.equal(mint(SHA, 'pdf', { stage: 'size', why: 'w'.repeat(300) }, EDGE, 'd', 0).why.length, 240);
  assert.equal(mint(SHA, 'pdf', { stage: 'size', why: { toString() { throw new Error('x'); } } }, EDGE, 'd', 0), null);
});

test('valid: every field, or nothing', () => {
  const a = mint(SHA, 'pdf', { stage: 'magic', why: 'x' }, EDGE, 'd', 0);
  for (const [k, v] of [['sha', 'x'], ['declared', ''], ['stage', 'type'], ['family', 'other'], ['why', 5], ['edge', 'x'], ['device', ''], ['at', '0']]) assert.equal(valid({ ...a, [k]: v }), false, k);
  assert.equal(valid(null), false);
  assert.equal(valid(new Proxy({}, { get() { throw new Error('x'); } })), false);
});

test('recognise: own antibodies act, another device\'s are only shown, an edge version change forgets', () => {
  const mine = mint(SHA, 'pdf', { stage: 'shape', why: 'cut short' }, EDGE, 'me', 1);
  const theirs = mint(SHA, 'pdf', { stage: 'shape', why: 'cut short' }, EDGE, 'them', 2);
  const list = [theirs, mine, mint(SHA, 'docx', { stage: 'magic', why: 'x' }, EDGE, 'me', 3), mint(SHA, 'pdf', { stage: 'shape', why: 'x' }, OTHER, 'me', 4), { junk: true }, null];
  assert.deepEqual(recognise(list, SHA, 'pdf', EDGE, 'me'), { own: mine, seen: [theirs] });
  assert.deepEqual(recognise(list, SHA, 'pdf', EDGE, 'new'), { own: null, seen: [theirs, mine] }, 'a new device acts on none');
  assert.deepEqual(recognise(list, 'b'.repeat(64), 'pdf', EDGE, 'me'), { own: null, seen: [] });
  assert.deepEqual(recognise(list, SHA, 'pdf', 'c'.repeat(64), 'me'), { own: null, seen: [] }, 'a new edge decides afresh');
  assert.deepEqual(recognise('x', SHA, 'pdf', EDGE, 'me'), { own: null, seen: [] });
});

test('tally: this device\'s own antibodies by family', () => {
  const list = [mint(SHA, 'pdf', { stage: 'shape', why: 'x' }, EDGE, 'me', 1), mint('b'.repeat(64), 'pdf', { stage: 'shape', why: 'x' }, EDGE, 'me', 1), mint(SHA, 'zip', { stage: 'reader', why: 'x' }, EDGE, 'me', 1), mint(SHA, 'pdf', { stage: 'size', why: 'x' }, EDGE, 'them', 1), 'junk'];
  assert.deepEqual(tally(list, 'me'), { 'cut short, or glued to another file': 2, 'damaged inside': 1 });
  assert.deepEqual(tally(null, 'me'), {});
});
