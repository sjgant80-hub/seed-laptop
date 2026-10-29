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
  assert.notEqual(receipt('quarantined', { file: 'x', why: 'z' }, AT), null, 'a one-character reason fits a quarantine too');
  assert.equal(receipt('quarantined', { file: 'x', why: '' }, AT), null);
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

test("opened, saved, asked: the office's everyday receipts", () => {
  assert.equal(receipt('opened', { block: 'Accounts' }, AT).says, 'You opened Accounts. It runs in a sandbox with no network; what it keeps stays in your office.');
  assert.equal(receipt('saved', { block: 'Accounts', changes: 3 }, AT).says, 'Accounts saved 3 changes into your office.');
  assert.equal(receipt('saved', { block: 'Accounts', changes: 1 }, AT).says, 'Accounts saved 1 change into your office.');
  assert.equal(receipt('saved', { block: 'Accounts', changes: -1 }, AT), null);
  assert.equal(receipt('asked', { asked: 'list', said: 'Your office has 7 blocks.' }, AT).says, 'You asked: "list". Your office has 7 blocks.');
  assert.notEqual(receipt('asked', { asked: 'x', said: 'y' }, AT), null, 'one character each');
  assert.notEqual(receipt('asked', { asked: 'x'.repeat(400), said: 'y'.repeat(600) }, AT), null, 'at the limits');
  assert.equal(receipt('asked', { asked: 'x'.repeat(401), said: 'y' }, AT), null);
  assert.equal(receipt('asked', { asked: 'x', said: 'y'.repeat(601) }, AT), null);
  assert.equal(receipt('asked', { asked: '', said: 'y' }, AT), null);
  assert.equal(receipt('asked', { asked: 'x', said: '' }, AT), null);
  assert.equal(receipt('opened', { block: '' }, AT), null);
});

test('KINDS lists each kind and its facts', () => {
  assert.deepEqual(KINDS.grew, ['seed', 'genome', 'blocks', 'files', 'owner']);
  assert.deepEqual(KINDS.refused, ['what', 'stage', 'why']);
  assert.equal(Object.isFrozen(KINDS), true);
});

test('imported, quarantined, exported: the edges leave receipts', () => {
  const sha = 'ab'.repeat(32);
  assert.equal(receipt('imported', { file: 'letter.docx', type: 'docx', sha }, AT).says, 'You brought in letter.docx (docx). Its bytes were checked before anything read them, it was read in a sandbox with no network, and the original is kept unchanged (abababab).');
  assert.equal(receipt('imported', { file: 'x', type: 'y', sha: 'z' }, AT), null, 'a sha is hex');
  assert.equal(receipt('quarantined', { file: 'a.pdf', why: 'a PDF ends with %%EOF' }, AT).says, 'I kept a.pdf out of your office: a PDF ends with %%EOF. Nothing in it was read outside the sandbox.');
  assert.equal(receipt('quarantined', { file: 'a.pdf', why: 'w'.repeat(240) }, AT).facts.why.length, 240);
  assert.equal(receipt('quarantined', { file: 'a.pdf', why: 'w'.repeat(241) }, AT), null);
  assert.equal(receipt('quarantined', { file: 'a.pdf', why: '' }, AT), null);
  assert.equal(receipt('exported', { file: 'quote.pdf', format: 'pdf', bytes: 1 }, AT).says, "You saved quote.pdf (pdf, 1 byte) to this device. It carries nothing of your office's keys or internals.");
  assert.equal(receipt('exported', { file: 'quote.pdf', format: 'pdf', bytes: 2048 }, AT).says.includes('2048 bytes'), true);
  assert.deepEqual(Object.keys(KINDS), ['grew', 'refused', 'opened', 'saved', 'asked', 'imported', 'quarantined', 'backed-up', 'regrown', 'upgraded', 'synced', 'paired', 'exported']);
});

test('backed-up, regrown, synced, paired', () => {
  const h = 'ab'.repeat(32);
  assert.equal(receipt('backed-up', { bytes: 2048, ref: h }, AT).says, 'You saved your vault (2048 bytes, abababab). Only your phrase opens it; keep a copy off this machine.');
  assert.equal(receipt('regrown', { keys: 1, owner: h }, AT).says, 'Your office grew back from your vault: 1 thing restored, byte for byte, for abababab. This device has a key of its own, and your behaviour watch starts fresh, refusing nothing while it learns.');
  assert.equal(receipt('synced', { changes: 3 }, AT).says, '3 changes arrived from your other device, each checked before it was read.');
  assert.equal(receipt('paired', { device: h }, AT).says, 'A new device (abababab) is on your list of devices, signed with your phrase.');
  assert.equal(receipt('paired', { device: 'zz' }, AT), null);
});

test('upgraded: an office brought across from an earlier seed, its orphaned blocks named only when there are some', () => {
  const from = 'ab'.repeat(32);
  assert.equal(receipt('upgraded', { keys: 12, from, orphaned: 0 }, AT).says, 'Your office came across from a vault saved under an earlier seed (abababab): 12 things merged in, nothing dropped.');
  assert.match(receipt('upgraded', { keys: 1, from, orphaned: 1 }, AT).says, /1 thing merged in, nothing dropped, 1 block's data kept although this seed no longer grows it\.$/);
  assert.match(receipt('upgraded', { keys: 3, from, orphaned: 2 }, AT).says, /2 blocks' data kept although this seed no longer grows them\.$/);
  assert.equal(receipt('upgraded', { keys: 1, from: 'nothex', orphaned: 0 }, AT), null);
});
