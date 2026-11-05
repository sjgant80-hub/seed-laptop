import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SAYS, judge, median } from '../measure/judge.mjs';

const B = { L1a: { median_seconds: 10, runs: 5, min_blocks: 5 }, L1b: { seconds: 20 }, L1c: { flips_per_block: 64 } };
const run = (o = {}) => ({ ok: true, signed: true, checked: 8, blocks: 7, office: 'D', receipt: true, owner: 'O', empty: true, ms: 800, ...o });
const l1a = (o = {}) => ({ runs: [run(), run(), run(), run(), run()], named: 7, files: 8, digest: 'D', owner: 'O', netDenied: true, ...o });
const blk = (o = {}) => ({ id: 'x', loaded: true, exceptions: 0, elements: 40, ...o });
const l1b = (o = {}) => ({ digest: 'D', l1aDigest: 'D', named: 2, blocks: [blk(), blk({ id: 'y' })], left: 0, refused: 9, kar: true, offline: true, ms: 5000, ...o });
const l1c = (o = {}) => ({ genomeBits: 100, genomeFlips: 100, genomeRefused: 100, genomeFetches: 0, named: 7, files: 8, blockCases: 448, blockRefused: 448, mirrorCases: 8, mirrorRefused: 8, composed: 0, ...o });
const l1d = (o = {}) => ({ lightDigest: 'D', fullDigest: 'D', checked: 8, fetched: 8, files: 8, ...o });

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.ok(Number.isNaN(median([1, 'x'])));
  assert.ok(Number.isNaN(median([1, NaN])));
  assert.ok(Number.isNaN(median('x')));
});

test('L1a: every condition, and the bound exactly', () => {
  assert.equal(RULES.L1a(l1a(), B.L1a), true);
  assert.equal(RULES.L1a(l1a({ runs: [run({ ms: 10000 }), run({ ms: 10000 }), run({ ms: 10000 }), run(), run()] }), B.L1a), true, 'a median of exactly 10 s holds');
  assert.equal(RULES.L1a(l1a({ runs: [run({ ms: 10001 }), run({ ms: 10001 }), run({ ms: 10001 }), run(), run()] }), B.L1a), false);
  for (const k of ['ok', 'signed', 'receipt', 'empty']) assert.equal(RULES.L1a(l1a({ runs: [run({ [k]: false }), run(), run(), run(), run()] }), B.L1a), false, k);
  assert.equal(RULES.L1a(l1a({ runs: [run({ checked: 7 }), run(), run(), run(), run()] }), B.L1a), false);
  assert.equal(RULES.L1a(l1a({ runs: [run({ blocks: 6 }), run(), run(), run(), run()] }), B.L1a), false);
  assert.equal(RULES.L1a(l1a({ runs: [run({ office: 'E' }), run(), run(), run(), run()] }), B.L1a), false);
  assert.equal(RULES.L1a(l1a({ runs: [run({ owner: 'P' }), run(), run(), run(), run()] }), B.L1a), false);
  assert.equal(RULES.L1a(l1a({ runs: [run(), run(), run(), run()] }), B.L1a), false, 'four runs are not five');
  assert.equal(RULES.L1a(l1a({ named: 4, runs: Array.from({ length: 5 }, () => run({ blocks: 4 })) }), B.L1a), false, 'fewer than 5 blocks');
  assert.equal(RULES.L1a(l1a({ named: 5, runs: Array.from({ length: 5 }, () => run({ blocks: 5 })) }), B.L1a), true, 'exactly 5 blocks');
  assert.equal(RULES.L1a(l1a({ netDenied: false }), B.L1a), false, 'the negative control must refuse');
  assert.equal(RULES.L1a(l1a({ runs: 'x' }), B.L1a), false);
});

test('L1b', () => {
  assert.equal(RULES.L1b(l1b(), B.L1b), true);
  assert.equal(RULES.L1b(l1b({ ms: 20000 }), B.L1b), true);
  assert.equal(RULES.L1b(l1b({ ms: 20001 }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ digest: 'E' }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ digest: null, l1aDigest: null }), B.L1b), false, 'no digest is not a match');
  assert.equal(RULES.L1b(l1b({ blocks: [blk(), blk({ exceptions: 1 })] }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ blocks: [blk(), blk({ loaded: false })] }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ blocks: [blk(), blk({ elements: 0 })] }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ blocks: [blk()] }), B.L1b), false, 'every block named');
  assert.equal(RULES.L1b(l1b({ left: 1 }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ kar: false }), B.L1b), false);
  assert.equal(RULES.L1b(l1b({ offline: false }), B.L1b), false);
});

test('L1c', () => {
  assert.equal(RULES.L1c(l1c(), B.L1c), true);
  for (const [k, v] of [['genomeFlips', 99], ['genomeRefused', 99], ['genomeFetches', 1], ['blockCases', 447], ['blockRefused', 447], ['mirrorCases', 7], ['mirrorRefused', 7], ['composed', 1]]) assert.equal(RULES.L1c(l1c({ [k]: v }), B.L1c), false, k);
});

test('L1d', () => {
  assert.equal(RULES.L1d(l1d()), true);
  assert.equal(RULES.L1d(l1d({ lightDigest: 'E' })), false);
  assert.equal(RULES.L1d(l1d({ lightDigest: null, fullDigest: null })), false);
  assert.equal(RULES.L1d(l1d({ checked: 7 })), false);
  assert.equal(RULES.L1d(l1d({ fetched: 7 })), false);
});

test('SAYS: a plain sentence from the facts', () => {
  assert.equal(SAYS.L1a(l1a()), '5 of 5 plantings with no network permission grew the office (7 blocks, 8 files, every one checked against its pin); median 0.80 s from process start to Kar\'s first receipt; a connection tried under the same permissions was refused.');
  assert.match(SAYS.L1a(l1a({ netDenied: false, runs: [run({ ok: false }), run(), run(), run(), run()] })), /^4 of 5 .* was NOT refused\.$/);
  assert.equal(SAYS.L1b(l1b()), 'In Chrome with the network off: 2 of 2 blocks started clean in their sandboxes, the office digest equals the planted one, 0 requests left the page (9 the blocks\' own code tried were refused inside the browser), Kar open, 5.00 s from choosing the seed.');
  assert.match(SAYS.L1b(l1b({ digest: 'E', kar: false, blocks: [blk(), blk({ exceptions: 2 })] })), /1 of 2 blocks .* differs from .* Kar not open/);
  assert.equal(SAYS.L1c(l1c()), '100 of 100 one-bit changes of the genome refused with 0 blocks fetched; 448 of 448 changed blocks refused, 0 offices composed; 8 of 8 altered mirror files refused.');
  assert.equal(SAYS.L1d(l1d()), 'The light seed fetched 8 files from the mirror, checked 8, and grew an office whose digest equals the full seed\'s.');
  assert.match(SAYS.L1d(l1d({ lightDigest: 'E' })), /differs from/);
});

test('judge: HELD, FAILED, UNMEASURED; a toxic fact fails, never throws', () => {
  const claims = [{ id: 'L1a', bound: B.L1a }, { id: 'L1d' }, { id: 'L7' }, { id: 'toString' }, null];
  const v = judge(claims, { L1a: l1a(), L1d: l1d({ checked: 1 }), toString: {} });
  assert.deepEqual(v.map((x) => [x.id, x.verdict]), [['L1a', 'HELD'], ['L1d', 'FAILED'], ['L7', 'UNMEASURED'], ['toString', 'UNMEASURED'], ['?', 'UNMEASURED']]);
  assert.equal(v[2].says, 'not measured');
  const toxic = judge([{ id: 'L1a', bound: B.L1a }], { L1a: { get runs() { throw new Error('x'); } } });
  assert.deepEqual(toxic, [{ id: 'L1a', verdict: 'FAILED', says: 'the facts could not be read' }]);
  assert.deepEqual(judge('x', null), []);
  assert.deepEqual(judge([{ id: 'L1a' }], { L1a: null }), [{ id: 'L1a', verdict: 'UNMEASURED', says: 'not measured' }]);
  assert.equal(judge([{ id: 'L1d' }], { L1d: l1d() })[0].verdict, 'HELD', 'a claim with no bound');
});

// seal 1f (measure/claims-f.json): L1e, the office opening again with its origin unreachable
const visit = (as, o = {}) => ({ as, url: '/office/', opens: true, ms: 1200, title: 'Seed Office', plant: true, controlled: true, ...o });
const l1eRun = (commit, o = {}) => ({ commit, chrome: 'HeadlessChrome/1', installed: true, refused: true, startUrl: '/office/', visits: [visit('office/'), visit('start_url'), visit('office/index.html')], ...o });
const l1e = (o = {}) => ({
  at: l1eRun('a'.repeat(40)),
  before: l1eRun('76c2f67' + 'b'.repeat(33), { visits: [visit('office/', { opens: false, ms: null, title: 'x', plant: false, controlled: false }), visit('start_url', { opens: false, ms: null }), visit('office/index.html')] }),
  ...o,
});
const B1e = { seconds: 10 };

test('L1e: every condition, the order of the addresses, the bound exactly, and the instrument must see the fault', () => {
  assert.equal(RULES.L1e(l1e(), B1e), true);
  const at = (o) => l1e({ at: l1eRun('a'.repeat(40), o) });
  const atVisit = (i, o) => { const v = [visit('office/'), visit('start_url'), visit('office/index.html')]; v[i] = { ...v[i], ...o }; return at({ visits: v }); };
  for (const i of [0, 1, 2]) {
    assert.equal(RULES.L1e(atVisit(i, { opens: false }), B1e), false, 'address ' + i + ' must open');
    assert.equal(RULES.L1e(atVisit(i, { ms: 10000 }), B1e), true, 'exactly the bound holds');
    assert.equal(RULES.L1e(atVisit(i, { ms: 10001 }), B1e), false, 'past the bound fails');
    assert.equal(RULES.L1e(atVisit(i, { ms: null }), B1e), false, 'no time is not within the bound');
  }
  assert.equal(RULES.L1e(at({ installed: false }), B1e), false, 'the first visit must install the worker');
  assert.equal(RULES.L1e(at({ refused: false }), B1e), false, 'the port must refuse once the server is stopped');
  assert.equal(RULES.L1e(at({ visits: [visit('office/'), visit('office/index.html'), visit('start_url')] }), B1e), false, 'the claim\'s order');
  assert.equal(RULES.L1e(at({ visits: [visit('office/'), visit('start_url')] }), B1e), false, 'all three addresses');
  assert.equal(RULES.L1e(at({ commit: 5 }), B1e), false);
  // the run before the fix: it must install and be refused too, and office/ must NOT open there
  const was = (o) => l1e({ before: { ...l1e().before, ...o } });
  assert.equal(RULES.L1e(was({ visits: [visit('office/'), visit('start_url'), visit('office/index.html')] }), B1e), false, 'an instrument that sees no fault proves nothing');
  assert.equal(RULES.L1e(was({ installed: false }), B1e), false);
  assert.equal(RULES.L1e(was({ refused: false }), B1e), false);
  assert.equal(RULES.L1e(was({ commit: 'c'.repeat(40) }), B1e), false, 'the run before is 76c2f67');
  assert.equal(RULES.L1e(l1e({ at: l1eRun('76c2f67' + 'b'.repeat(33)) }), B1e), false, 'two different commits');
  assert.equal(RULES.L1e(l1e({ before: null }), B1e), false);
  assert.equal(RULES.L1e(l1e({ at: undefined }), B1e), false);
  assert.equal(SAYS.L1e(l1e()), 'In Chrome, after one visit and with the server stopped (its port refused): at aaaaaaa office/ opened (1.20 s), start_url opened (1.20 s), office/index.html opened (1.20 s); at 76c2f67, before the fix, office/ did NOT open, start_url did NOT open, office/index.html opened (1.20 s).');
  assert.deepEqual(judge([{ id: 'L1e', bound: B1e }], { L1e: l1e() }).map((v) => v.verdict), ['HELD']);
  assert.deepEqual(judge([{ id: 'L1e', bound: B1e }], { L1e: { at: 'x' } }).map((v) => v.verdict), ['FAILED']);
});
