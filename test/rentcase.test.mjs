// test/rentcase.test.mjs — the cost case over the years: every external figure from the sourced basis, the coverage
// from the sealed map, the choices the reader's own, whole pence, never a throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SEAT_KEYS, BASIS_KEYS, DEFAULT_USERS, DEFAULT_MOVES, DEFAULT_YEARS, cpiOf, carry, heldBlocks, seatLines, sourcesOf, rentCase } from '../src/rentcase.mjs';

const at = (p) => new URL('../' + p, import.meta.url);
const BASIS_BYTES = readFileSync(at('vendor/sovereign-enterprise/data/basis.json'));
const BASIS = JSON.parse(BASIS_BYTES.toString('utf8'));
const L1B2 = JSON.parse(readFileSync(at('receipts/l1b2.json'), 'utf8'));
const WORKING = ['office', 'crm', 'ledger', 'pdf', 'mind', 'image', 'layout'];
const withSeat = (key, patch) => ({ ...BASIS, [key]: { ...BASIS[key], ...patch } });
const withCpi = (value) => ({ ...BASIS, cpi: { ...BASIS.cpi, value } });

test('the basis is the upstream bytes, pinned in vendor/sovereign-enterprise/SOURCES.json', () => {
  const s = JSON.parse(readFileSync(at('vendor/sovereign-enterprise/SOURCES.json'), 'utf8'));
  assert.equal(s.repo, 'sjgant80-hub/sovereign-enterprise');
  assert.match(s.commit, /^[0-9a-f]{40}$/);
  assert.equal(s.files.length, 1);
  assert.equal(BASIS_BYTES.length, s.files[0].bytes);
  assert.equal(createHash('sha256').update(BASIS_BYTES).digest('hex'), s.files[0].sha256);
});

test('cpiOf: the sourced rate, from 0 up to but not including 1', () => {
  assert.equal(cpiOf(BASIS), 0.031);
  assert.equal(cpiOf(withCpi(0)), 0);
  assert.equal(cpiOf(withCpi(0.999)), 0.999);
  for (const bad of [1, 5, -0.1, '0.5', NaN, Infinity, null]) assert.equal(cpiOf(withCpi(bad)), null, String(bad));
  assert.equal(cpiOf(null), null);
  assert.equal(cpiOf({}), null);
});

test('carry: each year after the first rises by CPI, each year rounded to whole pence', () => {
  assert.equal(carry(960000, 0.031, 1), 960000);
  assert.equal(carry(960000, 0.031, 2), 960000 + 989760);
  assert.equal(carry(960000, 0.031, 3), 960000 + 989760 + 1020443);
  assert.equal(carry(100, 0.1, 3), 100 + 110 + 121);
  assert.equal(carry(100, 0, 10), 1000);
  assert.equal(carry(0, 0.1, 3), 0);
  assert.equal(carry(5, 0.1, 2), 5 + 6, 'a half penny rounds up');
  for (const bad of [[1.5, 0.1, 1], [-1, 0.1, 1], [100, 1, 1], [100, -0.1, 1], [100, 0.1, 0], [100, 0.1, 11], [100, 0.1, 2.5], ['100', 0.1, 1]]) assert.equal(carry(...bad), null, JSON.stringify(bad));
  assert.equal(typeof carry(100, 0.1, 10), 'number');
  assert.equal(carry(2 ** 52, 0.031, 3), null, 'too large to stay whole');
});

test('heldBlocks: the blocks that held in the measured browser run, by L7\'s own rule', () => {
  assert.deepEqual(heldBlocks(L1B2), WORKING, 'L1b2 held all seven');
  const good = { id: 'crm', frame: 'found', loaded: true, exceptions: 0, elements: 3 };
  const blocks = [good, { ...good, id: 'a', frame: 'url' }, { ...good, id: 'b', loaded: false }, { ...good, id: 'c', exceptions: 1 }, { ...good, id: 'd', elements: 0 }, { ...good, id: 7 }];
  assert.deepEqual(heldBlocks({ facts: { blocks } }), ['crm'], 'flat facts, as L1b2\'s receipt has them');
  assert.deepEqual(heldBlocks({ facts: { L1b2: { blocks } } }), ['crm'], 'facts under the claim id');
  assert.deepEqual(heldBlocks({ facts: { blocks: 'x' } }), []);
  for (const g of [null, undefined, {}, { facts: null }, { facts: { blocks: [null] } }]) assert.deepEqual(heldBlocks(g), []);
});

test('seatLines: the worked example, every price from the basis, the users and the choices the reader\'s', () => {
  assert.deepEqual(SEAT_KEYS, ['seat.crm', 'seat.finance', 'seat.hr']);
  const lines = seatLines(BASIS);
  assert.deepEqual(lines, [
    { key: 'seat.crm', name: 'Salesforce Pro Suite', amount: 8000, per: 'month', seats: DEFAULT_USERS['seat.crm'], move: true },
    { key: 'seat.finance', name: 'Microsoft Dynamics 365 Finance', amount: 16150, per: 'month', seats: DEFAULT_USERS['seat.finance'], move: false },
    { key: 'seat.hr', name: 'Microsoft Dynamics 365 Human Resources', amount: 10380, per: 'month', seats: DEFAULT_USERS['seat.hr'], move: false },
  ]);
  assert.deepEqual(seatLines(BASIS, { 'seat.crm': 0, 'seat.finance': 100000 }, { 'seat.finance': true }).map((x) => [x.key, x.seats, x.move]), [['seat.finance', 100000, true], ['seat.hr', 2, false]], 'no users, no line');
  assert.deepEqual(seatLines(BASIS, null, null), lines, 'nothing given: the defaults');
  assert.deepEqual(seatLines(BASIS, {}, { 'seat.crm': 'yes' })[0].move, false, 'a choice is true or it is not made');
  assert.equal(seatLines(withSeat('seat.crm', { value: 0 }))[0].amount, 0);
  assert.equal(seatLines(withSeat('seat.crm', { value: 1e6 }))[0].amount, 1e8);
  for (const bad of [-1, 1.5, 100001, '3']) assert.equal(seatLines(BASIS, { 'seat.crm': bad }), null, String(bad));
  for (const patch of [{ value: 'x' }, { value: '80' }, { value: -1 }, { value: 2e6 }, { value: NaN }, { product: 5 }, { product: '' }]) assert.equal(seatLines(withSeat('seat.hr', patch)), null, JSON.stringify(patch));
  const missing = { ...BASIS }; delete missing['seat.finance'];
  assert.equal(seatLines(missing), null);
  assert.equal(seatLines(null), null);
});

test('sourcesOf: every figure the case reads, what it is, its value and where it came from', () => {
  assert.deepEqual(BASIS_KEYS, ['cpi', ...SEAT_KEYS]);
  const s = sourcesOf(BASIS);
  assert.deepEqual(s.map((x) => x.key), [...BASIS_KEYS]);
  assert.deepEqual(s[0], { key: 'cpi', what: BASIS.cpi.what, value: 0.031, unit: null, source: BASIS.cpi.source, via: BASIS.cpi.via });
  assert.deepEqual(s[1], { key: 'seat.crm', what: 'Salesforce Pro Suite', value: 80, unit: 'GBP per user per month', source: 'https://www.salesforce.com/uk/sales/pricing/', via: BASIS['seat.crm'].via });
  assert.ok(s.every((x) => /^https:\/\//.test(x.source)));
  const noVia = withSeat('seat.hr', { via: undefined });
  assert.equal(sourcesOf(noVia)[3].via, null);
  assert.deepEqual(sourcesOf(null), []);
});

test('rentCase: the worked example, over the default years, every line classed by the sealed map', () => {
  const r = rentCase(BASIS, { lines: seatLines(BASIS), working: WORKING });
  assert.equal(r.ok, true);
  assert.equal(r.years, DEFAULT_YEARS);
  assert.equal(r.cpi, 0.031);
  assert.deepEqual(r.items.map((x) => [x.level, x.moved, x.yearly, x.over]), [['partly', true, 960000, 2970203], ['partly', false, 387600, 1199220], ['not', false, 249120, 770768]]);
  assert.deepEqual(r.yearly, { today: 1596720, office: 636720, saving: 960000 });
  assert.deepEqual(r.over, { today: 4940191, office: 1969988, saving: 2970203, atStake: 1199220, notCovered: 770768 });
  assert.equal(r.over.today, r.over.office + r.over.saving);
  assert.equal(DEFAULT_MOVES['seat.crm'], true);
});

test('rentCase: what moves is the map\'s call and then the reader\'s, never more', () => {
  const lines = [
    { name: 'HubSpot Starter', amount: 1500, per: 'month' },                                  // covered: moves on its own
    { name: 'Xero', amount: 3300, per: 'month', move: true },                                // partly, and the reader says so
    { name: 'Canva Pro', amount: 9900, per: 'year' },                                         // partly, the reader has not said
    { name: 'Spotify', amount: 1199, per: 'month', move: true },                             // not covered: stays, whatever is said
  ];
  const r = rentCase(BASIS, { lines, working: WORKING, years: 1 });
  assert.deepEqual(r.items.map((x) => [x.level, x.moved]), [['covered', true], ['partly', true], ['partly', false], ['not', false]]);
  assert.deepEqual(r.yearly, { today: 18000 + 39600 + 9900 + 14388, office: 9900 + 14388, saving: 18000 + 39600 });
  assert.deepEqual(r.over, { today: r.yearly.today, office: r.yearly.office, saving: r.yearly.saving, atStake: 9900, notCovered: 14388 });
  const two = rentCase(BASIS, { lines, working: WORKING, years: 2 });
  assert.equal(two.years, 2);
  assert.equal(two.over.saving, carry(18000, 0.031, 2) + carry(39600, 0.031, 2));
  const ten = rentCase(BASIS, { lines, working: WORKING, years: 10 });
  assert.equal(ten.years, 10);
  const blocksDown = rentCase(BASIS, { lines, working: ['office'], years: 1 });
  assert.deepEqual(blocksDown.items.map((x) => x.moved), [false, false, false, false], 'a block that did not hold covers nothing');
});

test('rentCase: each bad input refused with its reason', () => {
  const lines = seatLines(BASIS);
  assert.deepEqual(rentCase(null, { lines }), { ok: false, why: 'a sourced basis with the CPI the case reads' });
  assert.deepEqual(rentCase(withCpi(1), { lines }), { ok: false, why: 'a sourced basis with the CPI the case reads' });
  for (const years of [0, 11, 2.5, '3', null]) assert.equal(rentCase(BASIS, { lines, years }).why, 'years: 1 to 10', String(years));
  assert.match(rentCase(BASIS, {}).why, /own list/);
  assert.match(rentCase(BASIS, null).why, /own list/);
  assert.match(rentCase(BASIS, { lines: [] }).why, /own list/);
  assert.match(rentCase(BASIS, { lines: [null] }).why, /every item/);
  assert.match(rentCase(BASIS, { lines: [{ name: 'Xero', amount: 1.5, per: 'month' }] }).why, /every item/);
  assert.deepEqual(rentCase(BASIS, { lines: [{ name: 'Xero', amount: 2 ** 52, per: 'year' }] }), { ok: false, why: 'the amounts are too large to carry forward' });
  assert.deepEqual(rentCase(BASIS, { lines: [{ name: 'Xero', amount: 2 ** 52, per: 'year' }, { name: 'Sage', amount: 2 ** 52, per: 'year' }], years: 1 }), { ok: false, why: 'the amounts are too large to carry forward' });
  assert.equal(rentCase(BASIS, { lines: [{ name: 'Xero', amount: 2 ** 52, per: 'year' }], years: 1 }).ok, true);
});

test('rentCase: totality, garbage never throws', () => {
  const G = [undefined, null, 0, 'x', [], {}, { lines: {} }, { lines: [{}] }, { years: Infinity }, true, () => 1];
  for (const a of [...G, BASIS]) for (const b of G) assert.doesNotThrow(() => rentCase(a, b));
  for (const g of G) { assert.doesNotThrow(() => seatLines(g, g, g)); assert.doesNotThrow(() => sourcesOf(g)); assert.doesNotThrow(() => heldBlocks(g)); assert.doesNotThrow(() => carry(g, g, g)); }
  const toxic = { get lines() { throw new Error('no'); } };
  assert.deepEqual(rentCase(BASIS, toxic), { ok: false, why: 'the inputs could not be read' });
});
