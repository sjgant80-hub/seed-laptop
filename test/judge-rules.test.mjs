// test/judge-rules.test.mjs — the judge (measure/judge.mjs) on every rule and sentence the first tests did not reach.
// Two halves:
//   1. every committed receipt, re-judged now from its own facts under its own sealed claim, gives the verdict and the
//      sentence it was written with (the receipts are the fixtures: a judge that drifts from them is caught);
//   2. each rule from a set of facts that holds, broken one condition at a time (each must FAIL), and held exactly at
//      each bound (each must still HOLD); each sentence on the branches the receipts never take.
// It changes nothing in the judge: the judge is the instrument sealed in seal 2 and after; these are its tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES, SAYS, judge, median } from '../measure/judge.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const CLAIMS = ['claims', 'claims-b', 'claims-c', 'claims-d', 'claims-e', 'claims-f'].flatMap((f) => read('measure/' + f + '.json').claims);
const claim = (id) => CLAIMS.find((c) => c.id === id);
const bound = (id) => claim(id).bound || {};
const RECEIPTS = ['l1', 'l1b2', 'l1e', 'l2', 'l3', 'l3b', 'l4', 'l5', 'l6', 'l6b', 'l6c2'];
const factsOf = (r, id) => (r.facts && Object.prototype.hasOwnProperty.call(r.facts, id) ? r.facts[id] : r.facts);   // l1b2 and l1e keep theirs flat
const real = (file, id) => structuredClone(factsOf(read('receipts/' + file + '.json'), id));

// a copy of o with one value replaced; a path is 'a.b.0' or, where a key holds a dot (a file name), an array of keys
const put = (o, path, v) => {
  const c = structuredClone(o), ks = Array.isArray(path) ? path : path.split('.');
  let x = c;
  for (const k of ks.slice(0, -1)) x = x[k];
  x[ks[ks.length - 1]] = v;
  return c;
};
const puts = (o, pairs) => pairs.reduce((a, [p, v]) => put(a, p, v), o);
// one change: x(path, value); several, or a different bound: xs(label, [[path, value] …], bound)
const x = (path, v) => ({ label: String(path) + ' = ' + JSON.stringify(v), set: [[path, v]] });
const xs = (label, set, b) => ({ label, set, b });
function rule(id, base, b, fails, holds = []) {
  assert.equal(RULES[id](base, b), true, id + ': the base facts hold');
  for (const f of fails) assert.equal(RULES[id](puts(base, f.set), f.b || b), false, id + ' must FAIL: ' + f.label);
  for (const h of holds) assert.equal(RULES[id](puts(base, h.set), h.b || b), true, id + ' must HOLD: ' + h.label);
}

test('every committed receipt re-judges to the verdict and the sentence it was written with', () => {
  let n = 0;
  for (const file of RECEIPTS) {
    const r = read('receipts/' + file + '.json');
    assert.ok(Array.isArray(r.verdicts) && r.verdicts.length > 0, file + ' has verdicts');
    for (const v of r.verdicts) {
      const [got] = judge([claim(v.id)], { [v.id]: factsOf(r, v.id) });
      assert.deepEqual(got, { id: v.id, verdict: v.verdict, says: v.says }, file + ' ' + v.id);
      n++;
    }
  }
  assert.equal(n, 16, 'sixteen measured verdicts across the receipts');
});

test('L1b2', () => {
  const f = real('l1b2', 'L1b2'), b = bound('L1b2');
  rule('L1b2', f, b, [
    x('digest', 'another'), xs('both digests the same non-string', [['digest', 5], ['l1aDigest', 5]]), x('named', f.named + 1),
    x('blocks.0.frame', 'not found'), x('blocks.0.loaded', false), x('blocks.0.exceptions', 1), x('blocks.0.elements', 0),
    x('unnamedExceptions', 1), x('left', 1), x('kar', false), x('offline', false), x('ms', b.seconds * 1000 + 1),
  ], [x('ms', b.seconds * 1000)]);
});

test('L2a', () => {
  const f = real('l2', 'L2a'), b = bound('L2a');
  const pdf = f.benign.filter((r) => r.type === 'pdf');
  const share = pdf.reduce((a, r) => a + r.exact, 0) / pdf.reduce((a, r) => a + r.fields, 0);
  const worst = Math.min(...pdf.map((r) => r.exact / r.fields));
  rule('L2a', f, b, [
    x('benign.0.verified', false),
    x('benign', f.benign.filter((r) => r.type !== 'docx')),
    x('benign', f.benign.filter((r) => r.type !== 'pdf')),
    xs('structured just above what was measured', [], { ...b, structured_min: 1.001 }),
    xs('PDF overall just above what was measured', [], { ...b, pdf_overall_min: share + 1e-9 }),
    xs('the worst PDF just above what was measured', [], { ...b, pdf_each_min: worst + 1e-9 }),
  ], [
    xs('structured exactly at what was measured', [], { ...b, structured_min: 1 }),
    xs('PDF overall exactly at what was measured', [], { ...b, pdf_overall_min: share }),
    xs('the worst PDF exactly at what was measured', [], { ...b, pdf_each_min: worst }),
  ]);
});

test('L2b', () => {
  const base = { hostile: [{ outcome: 'refused', stage: 'magic' }, { outcome: 'quarantined', why: 'cut short' }], coreParses: 0, parses: 5 };
  rule('L2b', base, {}, [
    x('hostile.0.outcome', 'admitted'), x('hostile.0.stage', null), x('hostile.1.why', null), x('hostile.1.outcome', 'refused'),
    x('hostile.0', { outcome: 'admitted', stage: 'magic' }), x('hostile.1', { outcome: 'admitted', why: 'cut short' }),
    x('hostile', []), x('coreParses', 1), x('parses', 0),
  ]);
  assert.equal(RULES.L2b(real('l2', 'L2b')), false, 'as measured: 116 admitted');
});

test('L2c', () => {
  const f = real('l2', 'L2c');
  const fails = [x('tries', null), x('tries', 'refused'), x('spinKilled', false), x('hogDied', false), x('readOnly', f.kept - 1),
    xs('nothing kept', [['kept', 0], ['readOnly', 0]])];
  for (const k of ['network', 'write', 'readOutside', 'childProcess', 'worker']) fails.push(x('tries.' + k, 'allowed'), x('tries.' + k, 0));
  rule('L2c', f, {}, fails);
});

test('L3 and L3b: every reader present, every file opened and equal, no marker', () => {
  const f = real('l3b', 'L3b'), b = bound('L3b');
  const fails = [x('ci', null), x('local', undefined), x('ci', 'a string'), x('ci.readers', null), x('ci.files', null), x('local.files', {})];
  for (const [where, names] of [['ci', ['LibreOffice (DOCX)', 'poppler pdftotext', 'Python csv', 'icalendar']], ['local', ['PyMuPDF', 'Python email']]]) {
    for (const name of names) {
      const file = Object.keys(f[where].readers[name])[0];
      fails.push(x([where, 'readers', name], undefined), x([where, 'readers', name, 'missing'], true),
        x([where, 'readers', name, file, 'opened'], false), x([where, 'readers', name, file, 'equal'], false), x([where, 'readers', name, file], undefined));
    }
  }
  fails.push(x(['ci', 'leaks', 'letter.pdf'], ['a key']), x(['local', 'leaks', 'people.csv'], ['a key']), x('local.leaks', null), x(['ci', 'leaks', 'letter.pdf'], 'a key'));
  rule('L3b', f, b, fails);
  assert.equal(RULES.L3({ ci: f.ci, local: f.local }, b), true, 'L3b is L3 on its own facts');
  assert.equal(RULES.L3(real('l3', 'L3'), b), false, 'L3 as measured');
});

test('L4', () => {
  const f = real('l4', 'L4'), b = bound('L4');
  const ms = f.runs.map((r) => r.ms).sort((p, q) => p - q)[2];
  const fails = [x('runs', 'x'), x('runs', f.runs.slice(0, 4)), x('wrongRefused', false), x('wrongRestored', true),
    xs('one header bit too few', [['headerFlips', 295], ['headerRefused', 295]]), x('headerRefused', 295),
    xs('one body bit too few', [['bodyFlips', b.body_flips - 1], ['bodyRefused', b.body_flips - 1]]), x('bodyRefused', b.body_flips - 1),
    x('otherState', 1), xs('no actions', [['actions', 0], ['observed', 0]]), x('observed', f.actions - 1), x('enforced', 1),
    xs('the median just past the bound', [], { ...b, median_seconds: ms / 1000 - 0.001 })];
  for (const k of ['ok', 'identical', 'owner', 'newDevice', 'observing']) fails.push(x('runs.0.' + k, false));
  rule('L4', f, b, fails, [xs('the median exactly at the bound', [], { ...b, median_seconds: ms / 1000 })]);
});

test('L5', () => {
  const f = real('l5', 'L5'), b = bound('L5');
  rule('L5', f, b, [
    x('relay', null), x('relay.regrow', null), x('relay.rounds', []), x('relay.after', []),
    x('relay.rounds.0.equal', false), x('relay.rounds.0.lostA', 1), x('relay.rounds.0.lostB', 1),
    x('relay.regrow.restored', false), x('relay.regrow.equal', false), x('relay.regrow.lostBefore', 1), x('relay.regrow.lostOther', 1), x('relay.regrow.newKey', false),
    xs('A had nothing unsynced', [['relay.regrow.aUnsynced', 0], ['relay.regrow.lostWithA', 0]]), x('relay.regrow.lostWithA', f.relay.regrow.aUnsynced - 1),
    x('relay.after.0.equal', false), x('relay.after.0.lostB', 1), x('relay.after.0.lostC', 1),
    x('relay.minShare', b.same_key_share_min - 0.001),
    x('webrtc', null), x('webrtc.equal', false), x('webrtc.dtls', false),
  ], [x('relay.minShare', b.same_key_share_min)]);
});

test('L6, from passing facts made of the measured ones', () => {
  const b = bound('L6');
  const f = puts(real('l6', 'L6'), [['ci.egress', 0], ['tab.receipts', 303]]);
  const few = (w) => xs(w + ' too few actions', [[w + '.actions', b.actions_min - 1], [w + '.receipts', b.actions_min - 1]]);
  const least = (w) => xs(w + ' at exactly the fewest actions', [[w + '.actions', b.actions_min], [w + '.receipts', b.actions_min]]);
  rule('L6', f, b, [
    x('ci', null), x('local', null), x('tab', null),
    x('ci.egress', 1), x('ci.outsideWindows', 1), x('ci.toSink', 0), x('ci.sends', 3), x('ci.sentOk', 1), x('ci.receipts', 302), few('ci'),
    x('local.stopped', 1), x('local.allowed', 3), x('local.allowedInWindows', 1), xs('local allowed three, all in windows', [['local.allowed', 3], ['local.allowedInWindows', 3]]),
    x('local.sends', 3), x('local.sentOk', 1), x('local.messages', 1), x('local.receipts', 302), few('local'),
    x('tab.left', 1), x('tab.receipts', 302), few('tab'),
  ], [least('ci'), least('local'), least('tab')]);
  assert.equal(RULES.L6(real('l6', 'L6'), b), false, 'as measured');
});

test('L6b', () => {
  const f = real('l6b', 'L6b'), b = bound('L6b');
  rule('L6b', f, b, [x('ci', null), x('ci.egress', 1), x('ci.outsideWindows', 1), x('ci.toSink', 0), x('ci.sends', 3), x('ci.sentOk', 1), x('ci.receipts', 302),
    xs('too few actions', [['ci.actions', b.actions_min - 1], ['ci.receipts', b.actions_min - 1]])],
  [xs('exactly the fewest actions', [['ci.actions', b.actions_min], ['ci.receipts', b.actions_min]])]);
});

test('L6c2, from passing facts made of the measured ones', () => {
  const b = bound('L6c2');
  const f = put(real('l6c2', 'L6c2'), 'tab.receipts', 303);
  rule('L6c2', f, b, [x('tab', null), x('tab.unmade', 1), x('tab.actions', 302), x('tab.receipts', 304), x('tab.left', 1),
    xs('too few actions', [['tab.actions', b.actions_min - 1], ['tab.plan', b.actions_min - 1], ['tab.receipts', b.actions_min - 1]])],
  [xs('exactly the fewest actions', [['tab.actions', b.actions_min], ['tab.plan', b.actions_min], ['tab.receipts', b.actions_min]])]);
  assert.equal(RULES.L6c2(real('l6c2', 'L6c2'), b), false, 'as measured: 320 receipts for 303 actions');
});

// L7 has no receipt yet (it waits on an owner's own list), so its facts are made here, in the shape measure/l7.mjs writes
const l7 = () => ({
  source: 'given by the owner on a stated day', lines: 3, given: [{}, {}, {}], held: ['office', 'crm', 'ledger'],
  result: { ok: true, yearly: 600, coveredYearly: 100, partlyYearly: 200, notYearly: 300, covered: 1, partly: 1, not: 1,
    items: [{ level: 'covered', why: 'w', by: ['office'] }, { level: 'partly', why: 'w', by: ['crm', 'vault'] }, { level: 'not', why: 'w', by: [] }] },
  rederived: { yearly: 600, byLevel: [100, 200, 300] },
});

test('L7', () => {
  rule('L7', l7(), {}, [
    x('result', null), x('result.ok', false), x('rederived', null), x('source', 5), x('source', 'a week'), x('given', 'x'),
    xs('nothing given', [['given', []], ['result.items', []]]), x('given', [{}, {}]),
    x('result.items.0.level', 'other'), x('result.items.0.why', 5), x('result.items.0.why', ''), x('result.items.0.by', []), x('result.items.0.by', ['fallmage']),
    x('rederived.yearly', 601), x('rederived.byLevel.0', 101), x('rederived.byLevel.1', 201), x('rederived.byLevel.2', 301),
    xs('the levels do not sum to the year', [['result.coveredYearly', 101], ['rederived.byLevel.0', 101]]),
  ], [x('source', '12345678')]);
});

test('the sentences, on the branches the receipts never take', () => {
  const blk = (o = {}) => ({ id: 'x', frame: 'found', loaded: true, exceptions: 0, elements: 40, ...o });
  const five = [blk(), blk({ elements: 0 }), blk({ loaded: false }), blk({ exceptions: 1 }), blk({ frame: 'not found' })];
  assert.match(SAYS.L1b({ digest: 'D', l1aDigest: 'D', named: 5, blocks: five, left: 0, refused: 0, kar: true, ms: 1000 }), /^In Chrome with the network off: 2 of 5 blocks/);
  assert.match(SAYS.L1b2({ digest: 'D', l1aDigest: 'E', named: 5, blocks: five, left: 0, refused: 0, kar: false, ms: 1000 }), /every frame named after loading: 1 of 5 blocks .* the office digest differs from the planted one, .* Kar NOT open/);
  assert.equal(SAYS.L2b({ hostile: [{ outcome: 'refused' }, { outcome: 'refused' }, { outcome: 'quarantined' }, { outcome: 'admitted' }], coreParses: 0, parses: 3 }),
    '4 hostile files: 2 refused at verify-before-parse, 1 quarantined by the sandbox, 1 admitted; the core process loaded 0 reader modules; 3 parses, every one in a sandbox.');
  const c = real('l2', 'L2c');
  assert.match(SAYS.L2c(put(c, 'tries.network', 'allowed')), /^In the sandbox: network ALLOWED, write refused/);
  assert.match(SAYS.L2c({ ...c, tries: null }), /^In the sandbox: network ALLOWED, write ALLOWED, readOutside ALLOWED, childProcess ALLOWED, worker ALLOWED; an endless loop was killed/);
  assert.match(SAYS.L2c({ ...c, spinKilled: false, hogDied: false }), /an endless loop was NOT killed at the time cap; a memory hog did NOT die/);
  const r5 = real('l5', 'L5');
  const odd = puts(r5, [['relay.rounds.0.equal', false], ['relay.rounds.1.lostA', 1], ['relay.rounds.2.lostB', 1], ['relay.after.0.equal', false], ['relay.after.1.lostB', 1], ['relay.after.2.lostC', 1]]);
  assert.match(SAYS.L5(odd), /^Over the relay: 3 of 6 syncs equal with no write lost .* then 0 of 3 more syncs equal\./);
  assert.match(SAYS.L5({ ...r5, webrtc: null }), /Over WebRTC in a tab: NOT equal \(see facts\)\.$/);
  assert.match(SAYS.L5({ ...r5, webrtc: { equal: false, error: 'no channel', browser: 'B', dtls: false } }), /Over WebRTC in B: NOT equal \(no channel\)\.$/);
  assert.match(SAYS.L5({ ...r5, webrtc: { equal: true, dtls: true } }), /Over WebRTC in a tab: every round equal, nothing lost, DTLS connected\.$/);
  assert.equal(SAYS.L6({}), "From below, on GitHub's runner: not measured; on this laptop: not measured; in a tab: not measured; receipts for every action: -, -, -.");
  assert.match(SAYS.L6({ tab: { left: 0, refused: 1, actions: 0, receipts: 0 } }), /in a tab: 0 requests left \(1 refused inside the browser\); receipts for every action: -, -, -\.$/);
  const r4 = real('l4', 'L4');
  assert.match(SAYS.L4(puts(r4, [['runs.0.identical', false], ['runs.1.ok', false]])), /^3 of 5 regrowths/);
  assert.match(SAYS.L4({ ...r4, wrongRestored: true }), /the wrong phrase was NOT refused cleanly/);
  assert.match(SAYS.L4({ ...r4, wrongRefused: false }), /the wrong phrase was NOT refused cleanly/);
  const r3 = real('l3b', 'L3b');
  assert.match(SAYS.L3({ ci: put(r3.ci, 'readers.PyMuPDF.missing', true), local: null }), /^On GitHub's runner: 10 of 11 readers present, NOT every file opened and read back equal; on this laptop: not measured; internal markers found: NaN\.$/);
  assert.match(SAYS.L3({ ci: put(r3.ci, 'readers.PyMuPDF', undefined), local: r3.local }), /^On GitHub's runner: 10 of 11 readers present, NOT every file .* on this laptop: 4 of 4 readers present, every file opened and read back equal; internal markers found: 0\.$/);
  assert.match(SAYS.L3({ ci: { ...r3.ci, readers: null }, local: r3.local }), /^On GitHub's runner: 0 of 11 readers present/);
  assert.equal(SAYS.L7(l7()), 'From the owner\'s own list (given by the owner on a stated day): 3 lines, £6.00 a year; £1.00 covered (1 lines), £2.00 partly covered (1), £3.00 not covered (1); every sum re-derived.');
  assert.equal(SAYS.L7({ result: { ok: false, why: 'no lines' } }), 'The list was refused: no lines.');
  assert.equal(SAYS.L7({ result: { ok: false } }), 'The list was refused: unreadable.');
  assert.equal(SAYS.L7({}), 'The list was refused: unreadable.');
  assert.equal(SAYS.L6c2({}), 'Not measured yet.');
  assert.equal(SAYS.L6b({}), 'Not measured yet.');
});

test('median: a list with anything but finite numbers has no median, whatever its length', () => {
  assert.ok(Number.isNaN(median([1, Infinity])), 'an infinite time is not a time');
  assert.ok(Number.isNaN(median([1, -Infinity, 3])));
  assert.ok(Number.isNaN(median([1, 2, 'x'])), 'an odd-length list does not hand back one of its members');
  assert.ok(Number.isNaN(median(['a', 'b', 'c'])));
  assert.equal(median([3, 1, 2, 5, 4]), 3);
});

test('judge: facts that are not an object count as none, a claim not in the seal is UNMEASURED', () => {
  assert.deepEqual(judge([{ id: 'L1d' }], null), [{ id: 'L1d', verdict: 'UNMEASURED', says: 'not measured' }]);
  assert.deepEqual(judge([{ id: 'L1d' }], 'L1d'), [{ id: 'L1d', verdict: 'UNMEASURED', says: 'not measured' }]);
  assert.deepEqual(judge([{ id: 'L1d' }], { L1d: 'held' }), [{ id: 'L1d', verdict: 'UNMEASURED', says: 'not measured' }]);
  assert.deepEqual(judge([{ id: 'L9' }], { L9: {} }), [{ id: 'L9', verdict: 'UNMEASURED', says: 'not measured' }]);
  assert.deepEqual(judge([{ id: 5 }], { 5: {} }), [{ id: '?', verdict: 'UNMEASURED', says: 'not measured' }]);
});
