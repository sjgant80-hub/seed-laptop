import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cost, classify, yearlyOf, COVERAGE, hasKind } from '../src/cost.mjs';

const WORKING = ['office', 'crm', 'ledger', 'pdf', 'mind', 'image', 'layout'];

test('classify: a service by the words that name it, whole words only', () => {
  assert.equal(classify('Microsoft 365 Business Standard'), 'office suite');
  assert.equal(classify('HubSpot Starter'), 'CRM');
  assert.equal(classify('Xero'), 'accounts');
  assert.equal(classify('Adobe Acrobat Pro'), 'PDF');
  assert.equal(classify('Notion Plus'), 'team workspace');
  assert.equal(classify('Obsidian Sync'), 'notes');
  assert.equal(classify('Salesforce Pro Suite'), 'CRM suite', 'a suite before the plain CRM');
  assert.equal(classify('HubSpot Professional'), 'CRM suite');
  assert.equal(classify('Microsoft Dynamics 365 Finance'), 'accounts');
  assert.equal(classify('Canva Pro'), 'design');
  assert.equal(classify('Dropbox Plus'), 'storage and backup');
  assert.equal(classify('Netflix'), null);
  assert.equal(classify('Sagebrush cafe'), null, 'a word that only starts with one is not it');
  assert.equal(classify(5), null);
  assert.equal(hasKind('CRM'), true);
  assert.equal(hasKind('toString'), false);
});

test('yearlyOf: whole pence, months times twelve, seats', () => {
  assert.equal(yearlyOf({ amount: 1030, per: 'month' }), 12360);
  assert.equal(yearlyOf({ amount: 1030, per: 'month', seats: 3 }), 37080);
  assert.equal(yearlyOf({ amount: 9900, per: 'year' }), 9900);
  assert.equal(yearlyOf({ amount: 0, per: 'year' }), 0);
  for (const bad of [{ amount: 10.5, per: 'month' }, { amount: -1, per: 'month' }, { amount: 1, per: 'week' }, { amount: 1, per: 'month', seats: 0 }, { amount: 1, per: 'month', seats: 1.5 }, null, { amount: Number.MAX_SAFE_INTEGER, per: 'month' }]) assert.equal(yearlyOf(bad), null, JSON.stringify(bad));
});

test('cost: item by item, covered / partly / not, with the reason; the sums add up', () => {
  const list = [
    { name: 'Microsoft 365 Business Standard', amount: 1030, per: 'month', seats: 2 },
    { name: 'HubSpot Starter', amount: 1500, per: 'month' },
    { name: 'Spotify', amount: 1199, per: 'month' },
    { name: 'Dropbox Plus', amount: 9600, per: 'year' },
  ];
  const r = cost(list, WORKING);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => [x.kind, x.level]), [['office suite', 'partly'], ['CRM', 'covered'], [null, 'not'], ['storage and backup', 'partly']]);
  assert.equal(r.yearly, 24720 + 18000 + 14388 + 9600);
  assert.equal(r.coveredYearly, 18000);
  assert.equal(r.partlyYearly, 24720 + 9600);
  assert.equal(r.notYearly, 14388);
  assert.equal(r.coveredYearly + r.partlyYearly + r.notYearly, r.yearly);
  assert.deepEqual([r.covered, r.partly, r.not], [1, 2, 1]);
  const three = cost([{ name: 'Xero', amount: 1, per: 'month' }, { name: 'Canva Pro', amount: 1, per: 'month' }, { name: 'Notion Plus', amount: 1, per: 'month' }, { name: 'Pipedrive', amount: 1, per: 'month' }, { name: 'Spotify', amount: 1, per: 'month' }], WORKING);
  assert.deepEqual([three.covered, three.partly, three.not], [1, 3, 1], 'each count is its own level');
  assert.match(r.items[2].why, /nothing in the office/);
  assert.deepEqual(r.items[1].by, ['crm']);
});

test('cost: a service whose blocks did not hold is not covered, and says so', () => {
  const r = cost([{ name: 'HubSpot', amount: 100, per: 'month' }], ['office']);
  assert.equal(r.items[0].level, 'not');
  assert.match(r.items[0].why, /did not hold/);
  assert.equal(cost([{ name: 'Dropbox', amount: 1, per: 'year' }], []).items[0].level, 'partly', 'the vault is the office\'s own, not a block');
});

test('cost refuses an invented or broken list', () => {
  assert.match(cost([], WORKING).why, /own list/);
  assert.match(cost(null, WORKING).why, /own list/);
  assert.match(cost([{ name: '', amount: 1, per: 'month' }], WORKING).why, /every item/);
  assert.match(cost([{ name: 'x', amount: 1.5, per: 'month' }], WORKING).why, /every item/);
  assert.equal(cost([{ name: 'x'.repeat(100), amount: 1, per: 'year' }], null).items[0].name.length, 80);
});

test('COVERAGE: every kind names blocks of the stock office or the vault, and a reason', () => {
  const blocks = new Set([...WORKING, 'vault']);
  for (const c of COVERAGE) {
    assert.ok(c.blocks.every((b) => blocks.has(b)), c.kind);
    assert.ok(['covered', 'partly'].includes(c.level));
    assert.ok(c.why.length > 10);
  }
});
