import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receipt, fits, KINDS } from '../src/receipt.mjs';

const AT = '2026-10-29T12:00:00Z';
const grew = { seed: 'stock office', genome: 'ab'.repeat(32), blocks: 6, files: 9, owner: 'cd'.repeat(32) };

test('grew: Kar\'s first receipt, in plain words, short ids only', () => {
  const r = receipt('grew', grew, AT);
  assert.deepEqual(r, { at: AT, kind: 'grew', facts: grew, says: 'Your office grew from the seed "stock office" (abababab): 6 blocks, 9 files, every one checked against its pin. You are cdcdcdcd. I am Kar, your conductor: ask me about anything in your office.' });
  assert.equal(receipt('grew', { ...grew, blocks: 1, files: 1 }, AT).says.includes('1 block, 1 file,'), true);
  assert.equal(receipt('grew', { ...grew, blocks: 0, files: 0 }, AT).says.includes('0 blocks, 0 files,'), true);
});

test('refused: what, at which check, why', () => {
  assert.equal(receipt('refused', { what: 'the seed', stage: 'genome', why: 'the signature does not verify' }, AT).says, 'I refused the seed at the genome check: the signature does not verify');
  assert.equal(receipt('refused', { what: 'the seed', stage: 'genome', why: 'x'.repeat(241) }, AT), null);
  assert.notEqual(receipt('refused', { what: 'the seed', stage: 'genome', why: 'x'.repeat(240) }, AT), null);
  assert.equal(receipt('refused', { what: 'the seed', stage: 'genome', why: '' }, AT), null);
  assert.equal(receipt('refused', { what: 'x', stage: 'y', why: 'z' }, AT).says, 'I refused x at the y check: z', 'one-character facts fit');
});

test('facts are checked by type before a sentence is made', () => {
  for (const bad of [{ ...grew, blocks: -1 }, { ...grew, blocks: 1.5 }, { ...grew, files: '9' }, { ...grew, genome: 'xyz' }, { ...grew, genome: 'ab' }, { ...grew, owner: 'a'.repeat(65) }, { ...grew, seed: '' }, { ...grew, seed: 'x'.repeat(81) }, { seed: 'x' }]) {
    assert.equal(receipt('grew', bad, AT), null, JSON.stringify(bad).slice(0, 60));
  }
  assert.notEqual(receipt('grew', { ...grew, genome: 'abcdef01', seed: 'x'.repeat(80) }, AT), null, 'an 8-hex id and an 80-character name fit');
  assert.equal(receipt('grew', { ...grew, genome: 'abcdef0' }, AT), null, 'a 7-hex id does not');
  const extra = receipt('grew', { ...grew, phrase: 'secret' }, AT);
  assert.equal('phrase' in extra.facts, false, 'only the kind\'s own facts are kept');
});

test('unknown kinds and inherited names are refused', () => {
  assert.equal(receipt('nope', {}, AT), null);
  assert.equal(receipt('toString', {}, AT), null);
  assert.equal(receipt('constructor', {}, AT), null);
  assert.equal(fits('__proto__', {}), false);
  assert.equal(fits(5, {}), false);
  assert.equal(fits('grew', Object.create(grew)), false, 'facts are own properties');
  assert.equal(fits('grew', { get seed() { throw new Error('x'); } }), false);
});

test('the time is an ISO instant in UTC', () => {
  assert.notEqual(receipt('grew', grew, '2026-10-29T12:00:00.123Z'), null);
  for (const t of ['2026-10-29', '2026-10-29T12:00:00', '2026-10-29T12:00:00+01:00', 5, null, 'x2026-10-29T12:00:00Z', '2026-10-29T12:00:00Zx']) assert.equal(receipt('grew', grew, t), null, String(t));
});

test('KINDS lists each kind and its facts', () => {
  assert.deepEqual(KINDS.grew, ['seed', 'genome', 'blocks', 'files', 'owner']);
  assert.deepEqual(KINDS.refused, ['what', 'stage', 'why']);
  assert.equal(Object.isFrozen(KINDS), true);
});
