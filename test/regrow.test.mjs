import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesOf, restore, watchOf, eventOf } from '../src/regrow.mjs';
import { emptyStore, write, canon } from '../src/store.mjs';
import { step } from '../vendor/bes-inward/watch.mjs';
import { seal, open } from '../src/vault.mjs';

const D = 'd'.repeat(64), F = 'f'.repeat(64), G = 'e'.repeat(64);
const office = { digest: G, founder: F };
const planted = { digest: G, owner: { id: F } };
const store = () => { let s = emptyStore(); for (let i = 0; i < 5; i++) s = write(s, D, 'b/crm/ls/k' + i, ['s', 'v' + i]).store; return s; };
const dec = new TextDecoder();

test('entriesOf: the store in its one canonical form, and which office and whose', () => {
  const e = entriesOf(store(), office);
  assert.deepEqual(e.map((x) => x.path), ['store.json', 'office.json']);
  assert.equal(dec.decode(e[0].bytes), canon(store()));
  assert.deepEqual(JSON.parse(dec.decode(e[1].bytes)), office);
  assert.equal(entriesOf(null, office), null);
  assert.equal(entriesOf(store(), { digest: 'x', founder: F }), null);
  assert.equal(entriesOf(store(), { digest: G, founder: 'x' }), null);
  assert.equal(entriesOf(store(), null), null);
});

test('restore: byte for byte, through a real vault', async () => {
  const before = entriesOf(store(), office);
  const v = await seal(before, 'a regrow test phrase, public on purpose', { iterations: 100000 });
  const o = await open(v.bytes, 'a regrow test phrase, public on purpose');
  const r = restore(o.entries, planted);
  assert.equal(r.ok, true);
  assert.deepEqual(r.bytes, before[0].bytes, 'the restored store is the one backed up, byte for byte');
  assert.deepEqual(r.store, store());
});

test('restore refuses another seed, another owner, a broken vault', () => {
  const e = entriesOf(store(), office);
  assert.match(restore(e, { ...planted, digest: 'a'.repeat(64) }).why, /another seed/);
  assert.match(restore(e, { ...planted, owner: { id: 'b'.repeat(64) } }).why, /another owner/);
  assert.match(restore(e, null).why, /another seed/);
  assert.match(restore(e, { digest: G }).why, /another owner/);
  assert.match(restore([e[1]], planted).why, /no office/);
  assert.match(restore([e[0]], planted).why, /no office/);
  const bad = [{ path: 'store.json', bytes: new TextEncoder().encode('{"kind":"x"}') }, e[1]];
  assert.match(restore(bad, planted).why, /not a store/);
  assert.match(restore([{ path: 'store.json', bytes: new Uint8Array([0xff]) }, e[1]], planted).why, /nothing this office can read/);
  assert.match(restore('x', planted).why, /no office/);
});

test('the regrown device\'s watch is fresh and refuses nothing while it forms', () => {
  let w = watchOf(F);
  assert.equal(w.formed, false);
  assert.equal(w.id, 'owner:' + F.slice(0, 16));
  assert.equal(watchOf(5).id, 'owner');
  let refused = 0;
  const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < 400; i++) {
    const r = step(w, eventOf({ do: ['open', 'edit', 'ask', 'export'][i % 4], block: 'crm', size: 100 + i }, t0 + i * 60000), {});
    w = r.w;
    if (!r.out.observing) refused++;
  }
  assert.equal(refused, 0, 'every action observed, none enforced, while the watch forms');
  assert.equal(w.formed, false, 'four hundred minutes is not a fortnight');
});

test('eventOf: an office action as the watch reads it', () => {
  assert.deepEqual(eventOf({ do: 'edit', block: 'crm', size: 12 }, 5), { t: 5, src: 'owner', kind: 'write', loc: 'crm', size: 12, tier: 'local', priv: 'p:owner' });
  assert.deepEqual(eventOf({ do: 'export', format: 'pdf' }, 6), { t: 6, src: 'owner', kind: 'export', loc: 'pdf', size: 1, tier: 'local', priv: 'p:owner' });
  assert.deepEqual(eventOf(null, 'x'), { t: 0, src: 'owner', kind: 'other', loc: 'office', size: 1, tier: 'local', priv: 'p:owner' });
  assert.equal(eventOf({ do: 'toString' }, 1).kind, 'other');
  assert.equal(eventOf({ do: 'send', size: 0 }, 1).size, 1);
});

test('an update: the owner brings their office across into one grown from a newer seed; nobody else can', () => {
  const D1 = 'a'.repeat(64), D2 = 'b'.repeat(64), OWNER = 'c'.repeat(64), OTHER = 'e'.repeat(64);
  let st = emptyStore();
  for (const [k, v] of [['b/crm/ls/theme', ['s', 'dark']], ['b/fax/ls/x', ['s', 'old block']], ['kar/receipts/1', ['s', '{}']]]) st = write(st, 'd0'.repeat(16), k, v).store;
  const entries = entriesOf(st, { digest: D1, founder: OWNER });
  assert.match(restore(entries, { digest: D2, owner: { id: OWNER }, blocks: ['crm'] }).why, /another seed/, 'not without asking for it');
  for (const opts of [null, 5, { upgrade: 'yes' }, { upgrade: 1 }]) assert.equal(restore(entries, { digest: D2, owner: { id: OWNER }, blocks: ['crm'] }, opts).ok, false, JSON.stringify(opts));
  const up = restore(entries, { digest: D2, owner: { id: OWNER }, blocks: ['crm'] }, { upgrade: true });
  assert.equal(up.ok, true);
  assert.equal(up.from, D1, 'the earlier office is named');
  assert.deepEqual(up.orphaned, ['fax'], 'data the new seed no longer grows is reported, and kept');
  assert.equal(Object.keys(up.store.keys).length, 3, 'nothing dropped');
  assert.deepEqual(restore(entries, { digest: D2, owner: { id: OWNER } }, { upgrade: true }).orphaned, ['crm', 'fax'], 'a seed naming no blocks orphans them all, still keeping them');
  assert.match(restore(entries, { digest: D2, owner: { id: OTHER }, blocks: ['crm'] }, { upgrade: true }).why, /another owner/, 'another phrase cannot');
  const same = restore(entries, { digest: D1, owner: { id: OWNER }, blocks: ['crm'] }, { upgrade: true });
  assert.equal(same.ok, true);
  assert.equal('from' in same, false, 'the same seed is no upgrade');
});
