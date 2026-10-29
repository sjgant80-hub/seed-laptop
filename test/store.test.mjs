import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore, write, apply, merge, read, keysOf, opsSince, digest, lost, canon, validStore, isStore, admits, bigger, KIND, MAX_KEY, MAX_VALUE } from '../src/store.mjs';
import { createHash } from 'node:crypto';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const s = (t) => ['s', t];
const w = (st, d, k, v) => { const r = write(st, d, k, v); assert.equal(r.ok, true, r.why); return r; };
const ap = (st, op) => { const r = apply(st, op); assert.equal(r.ok, true, r.why); return r.store; };

test('write then read; a second write by the same device replaces the first', () => {
  let st = emptyStore();
  assert.deepEqual(st, { kind: KIND, v: 1, clock: {}, keys: {} });
  const r1 = w(st, A, 'docs/1', s('one'));
  assert.deepEqual(r1.op, { key: 'docs/1', d: A, n: 1, ctx: {}, v: s('one') });
  st = r1.store;
  assert.deepEqual(read(st, 'docs/1'), { value: s('one'), conflicts: [], versions: 1 });
  const r2 = w(st, A, 'docs/1', s('two'));
  assert.deepEqual(r2.op.ctx, { [A]: 1 }, 'the second write saw the first');
  st = r2.store;
  assert.deepEqual(read(st, 'docs/1'), { value: s('two'), conflicts: [], versions: 1 });
  assert.deepEqual(st.clock, { [A]: 2 });
  assert.deepEqual(read(st, 'none'), { value: null, conflicts: [], versions: 0 });
  assert.deepEqual(read(st, 5), { value: null, conflicts: [], versions: 0 });
});

test('the store a write returns is new; the old one is unchanged', () => {
  const st = emptyStore();
  const r = w(st, A, 'k', s('v'));
  assert.deepEqual(st.keys, {});
  assert.deepEqual(st.clock, {});
  assert.notEqual(r.store, st);
});

test('a delete is a version: it converges, and reads as absent', () => {
  let st = w(emptyStore(), A, 'k', s('v')).store;
  st = w(st, A, 'k', null).store;
  assert.equal(read(st, 'k').value, null);
  assert.equal(read(st, 'k').versions, 1);
  assert.deepEqual(keysOf(st, ''), []);
});

test('two devices write the same key without seeing each other: both kept, one shown — the same one everywhere', () => {
  const base = emptyStore();
  const a = w(base, A, 'k', s('from A'));
  const b = w(base, B, 'k', s('from B'));
  const onA = ap(a.store, b.op);
  const onB = ap(b.store, a.op);
  assert.equal(digest(onA), digest(onB));
  const ra = read(onA, 'k');
  assert.equal(ra.versions, 2);
  assert.deepEqual(ra.value, s('from B'), 'equal counters: the larger device id is shown');
  assert.deepEqual(ra.conflicts, [s('from A')], 'the other kept as a conflict copy');
  const later = w(onA, A, 'k', s('resolved'));
  assert.deepEqual(later.op.ctx, { [A]: 1, [B]: 1 }, 'a write that sees both');
  assert.deepEqual(read(later.store, 'k'), { value: s('resolved'), conflicts: [], versions: 1 });
  const back = ap(onB, later.op);
  assert.deepEqual(read(back, 'k'), { value: s('resolved'), conflicts: [], versions: 1 }, 'and it replaces both on the other device');
  assert.deepEqual(lost([a.op, b.op, later.op], back), []);
});

test('the shown version is the one with the larger counter, then the larger device', () => {
  let a = w(emptyStore(), A, 'x', s('a1')).store;
  a = w(a, A, 'y', s('ay')).store;
  const a2 = w(a, A, 'k', s('a-k'));   // A's counter: 3
  const b = w(emptyStore(), B, 'k', s('b-k'));   // B's counter: 1
  const m = ap(a2.store, b.op);
  assert.deepEqual(read(m, 'k').value, s('a-k'), '3 beats 1, whatever the ids');
  assert.deepEqual(read(m, 'k').conflicts, [s('b-k')]);
  const tomb = w(emptyStore(), C, 'k', null);
  const mt = ap(m, tomb.op);
  assert.equal(read(mt, 'k').versions, 3, 'a concurrent delete is a version');
  assert.deepEqual(read(mt, 'k').conflicts, [s('b-k')], 'but never a conflict copy');
});

test('apply is idempotent; old news changes nothing but the clock', () => {
  const r = w(emptyStore(), A, 'k', s('v'));
  const b = emptyStore();
  const once = apply(b, r.op);
  assert.equal(once.changed, true);
  const twice = apply(once.store, r.op);
  assert.equal(twice.changed, false);
  assert.equal(digest(twice.store), digest(once.store));
  const r2 = w(r.store, A, 'k', s('v2'));
  const newer = ap(once.store, r2.op);
  const old = apply(newer, r.op);
  assert.equal(old.changed, false, 'a version already replaced does not come back');
  assert.deepEqual(read(old.store, 'k').value, s('v2'));
});

test('apply keeps the highest counter heard from each device', () => {
  const r = w(emptyStore(), A, 'k', s('v'));
  const st = ap(emptyStore(), { ...r.op, n: 5 });
  assert.equal(st.clock[A], 5);
  const st2 = ap(st, { ...r.op, key: 'other', n: 3 });
  assert.equal(st2.clock[A], 5, 'never goes back');
});

test('merge: commutative, associative, idempotent (the CRDT laws), over random concurrent edits', () => {
  let x = 7;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const devs = [A, B, C];
  const stores = devs.map(() => emptyStore());
  for (let i = 0; i < 300; i++) {
    const d = Math.floor(rnd() * 3);
    const k = 'k' + Math.floor(rnd() * 6);
    stores[d] = w(stores[d], devs[d], k, rnd() < 0.15 ? null : s('v' + i)).store;
    if (rnd() < 0.2) { const o = Math.floor(rnd() * 3); stores[d] = merge(stores[d], stores[o]).store; }
  }
  const [p, q, r] = stores;
  const pq = merge(p, q).store, qp = merge(q, p).store;
  assert.equal(digest(pq), digest(qp), 'commutative');
  assert.equal(digest(merge(merge(p, q).store, r).store), digest(merge(p, merge(q, r).store).store), 'associative');
  assert.equal(digest(merge(pq, pq).store), digest(pq), 'idempotent');
  assert.equal(digest(merge(pq, emptyStore()).store), digest(pq), 'merging nothing changes nothing');
});

test('opsSince: what a device that has seen a clock has not', () => {
  let st = w(emptyStore(), A, 'k1', s('1')).store;
  st = w(st, A, 'k2', s('2')).store;
  st = w(st, B, 'k3', s('3')).store;
  assert.equal(opsSince(st, {}).length, 3);
  assert.deepEqual(opsSince(st, { [A]: 1 }).map((o) => o.key), ['k2', 'k3']);
  assert.deepEqual(opsSince(st, { [A]: 2, [B]: 1 }), []);
  assert.deepEqual(opsSince(st, null).length, 3);
  assert.deepEqual(opsSince(null, {}), []);
  const other = opsSince(st, {}).reduce((acc, op) => ap(acc, op), emptyStore());
  assert.equal(digest(other), digest(st), 'replaying every op rebuilds the store exactly');
});

test('lost: an op is lost only if neither kept nor seen by a version kept', () => {
  const r1 = w(emptyStore(), A, 'k', s('1'));
  const r2 = w(r1.store, A, 'k', s('2'));
  assert.deepEqual(lost([r1.op, r2.op], r2.store), [], 'replaced by a write that saw it: not lost');
  const elsewhere = w(emptyStore(), B, 'k', s('b'));
  assert.deepEqual(lost([elsewhere.op], r2.store), [elsewhere.op], 'never arrived: lost');
  assert.deepEqual(lost([{ key: 'nope', d: A, n: 1 }], r2.store).length, 1);
  assert.equal(lost('x', r2.store), null);
  assert.equal(lost([], 'x'), null);
  assert.deepEqual(lost([null], r2.store), [null], 'a non-op is not kept');
});

test('originals are read-only: bytes named by their own hash, once', () => {
  const bytes = Buffer.from('an original file');
  const name = 'file/' + createHash('sha256').update(bytes).digest('hex');
  const val = ['ab', bytes.toString('base64')];
  const r = w(emptyStore(), A, name, val);
  assert.match(write(r.store, A, name, val).why, /read-only/, 'a second write of an original is refused');
  assert.match(write(r.store, A, name, null).why, /read-only/, 'and so is deleting it');
  assert.match(write(emptyStore(), A, 'file/' + 'f'.repeat(64), val).why, /SHA-256 of its bytes/);
  assert.match(write(emptyStore(), A, name, ['s', 'text']).why, /SHA-256 of its bytes/);
  assert.match(write(emptyStore(), A, name, ['ab', '***']).why, /SHA-256 of its bytes/);
  assert.match(write(emptyStore(), A, name, ['ab', bytes.toString('base64'), 'extra']).why, /SHA-256 of its bytes/);
  assert.match(apply(emptyStore(), { ...r.op, v: ['ab', Buffer.from('other').toString('base64')] }).why, /SHA-256 of its bytes/, 'a peer cannot slip a changed original in');
  assert.equal(apply(emptyStore(), r.op).ok, true, 'the true original syncs');
  assert.equal(apply(r.store, r.op).changed, false);
});

test('admits: keys and values by rule', () => {
  const st = emptyStore();
  assert.equal(admits(st, '', s('v')).ok, false);
  assert.equal(admits(st, 'x'.repeat(MAX_KEY + 1), s('v')).ok, false);
  assert.equal(admits(st, 'x'.repeat(MAX_KEY), s('v')).ok, true);
  assert.equal(admits(st, 5, s('v')).ok, false);
  assert.match(admits(st, 'k', 'text').why, /tagged JSON/);
  assert.match(admits(st, 'k', [NaN]).why, /plain JSON/);
  assert.equal(admits(st, 'k', null).ok, true);
});

test('write refuses: not a store, a bad device, a bad key or value', () => {
  assert.match(write(null, A, 'k', s('v')).why, /not a store/);
  assert.match(write({ ...emptyStore(), kind: 'x' }, A, 'k', s('v')).why, /not a store/);
  assert.match(write(emptyStore(), 'XYZ', 'k', s('v')).why, /device/);
  assert.match(write(emptyStore(), 'abc', 'k', s('v')).why, /device/);
  assert.match(write(emptyStore(), 5, 'k', s('v')).why, /device/);
  assert.equal(write(emptyStore(), 'abcdef01', 'k', s('v')).ok, true, 'an 8-hex device');
  assert.match(write(emptyStore(), A, '', s('v')).why, /key/);
});

test('apply refuses what is not a version', () => {
  const op = w(emptyStore(), A, 'k', s('v')).op;
  for (const bad of [null, 5, { ...op, key: 5 }, { ...op, d: 'X' }, { ...op, n: 0 }, { ...op, n: 1.5 }, { ...op, ctx: { X: 1 } }, { ...op, ctx: { [B]: 0 } }, { ...op, ctx: [] }, { ...op, v: 'x' }, { ...op, v: [NaN] }, { ...op, key: '' }, { ...op, key: 'x'.repeat(MAX_KEY + 1) }]) {
    assert.equal(apply(emptyStore(), bad).ok, false, JSON.stringify(bad));
  }
  assert.match(apply(null, op).why, /not a store/);
  const { key, ...noKey } = op; void key;
  assert.equal(apply(emptyStore(), noKey).ok, false);
});

test('merge refuses a store from outside that is not one', () => {
  const st = w(emptyStore(), A, 'k', s('v')).store;
  for (const bad of [null, { ...st, v: 2 }, { ...st, clock: { X: 1 } }, { ...st, clock: { [A]: 0 } }, { ...st, keys: { '': [] } }, { ...st, keys: { k: [] } }, { ...st, keys: { k: [{ d: A, n: 1, ctx: {}, v: s('v'), extra: 1 }] } }, { ...st, keys: { k: 'x' } }]) {
    assert.equal(merge(st, bad).ok, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(merge(null, st).ok, false);
});

test('validStore / isStore', () => {
  const st = w(emptyStore(), A, 'k', s('v')).store;
  assert.equal(validStore(st), true);
  assert.equal(isStore(st), true);
  assert.equal(validStore({ ...st, keys: { ['x'.repeat(MAX_KEY + 1)]: st.keys.k } }), false);
  assert.equal(validStore({ ...st, keys: { k: [{ ...st.keys.k[0], v: [NaN] }] } }), false);
  assert.equal(validStore({ get kind() { throw new Error('x'); } }), false);
  assert.equal(isStore({ get kind() { throw new Error('x'); } }), false);
  assert.equal(isStore([]), false);
});

test('keysOf: live keys under a prefix, sorted', () => {
  let st = emptyStore();
  for (const k of ['crm/2', 'docs/b', 'crm/1', 'docs/a']) st = w(st, A, k, s(k)).store;
  st = w(st, A, 'crm/2', null).store;
  assert.deepEqual(keysOf(st, 'crm/'), ['crm/1']);
  assert.deepEqual(keysOf(st, 'docs/'), ['docs/a', 'docs/b']);
  assert.deepEqual(keysOf(st), ['crm/1', 'docs/a', 'docs/b']);
  assert.deepEqual(keysOf(null, ''), []);
});

test('digest: one canonical form; differs when anything differs', () => {
  const a = w(emptyStore(), A, 'k', s('v')).store;
  const b = w(emptyStore(), A, 'k', s('v')).store;
  assert.equal(digest(a), digest(b));
  assert.match(digest(a), /^[0-9a-f]{64}$/);
  assert.notEqual(digest(a), digest(w(emptyStore(), A, 'k', s('w')).store));
  assert.equal(digest(null), null);
});

test('canon: sorted keys, finite numbers, plain objects only, bounded depth', () => {
  assert.equal(canon({ b: [1.5, 'x'], a: null }), '{"a":null,"b":[1.5,"x"]}');
  for (const bad of [NaN, Infinity, -0, undefined, () => 1, new Date(), Object.create(null)]) assert.equal(canon(bad), null);
  let deep = 1; for (let i = 0; i < 80; i++) deep = [deep];
  assert.notEqual(canon(deep), null);
  assert.equal(canon([deep]), null);
  assert.equal(canon({ get k() { throw new Error('toxic'); } }), null);
});

test('bigger: the larger counter, then the larger device, whichever way round', () => {
  const v = (d, n) => ({ d, n });
  assert.equal(bigger(v(A, 2), v(B, 1)), true);
  assert.equal(bigger(v(B, 1), v(A, 2)), false);
  assert.equal(bigger(v(B, 1), v(A, 1)), true);
  assert.equal(bigger(v(A, 1), v(B, 1)), false);
  assert.equal(bigger(v(A, 1), v(A, 1)), false, 'a version is not bigger than itself');
});

test('isStore: every field', () => {
  for (const bad of [{ ...emptyStore(), v: 2 }, { ...emptyStore(), clock: null }, { ...emptyStore(), keys: null }, { ...emptyStore(), keys: [] }, { ...emptyStore(), clock: [] }]) assert.match(write(bad, A, 'k', s('v')).why, /not a store/, JSON.stringify(bad));
});

test('limits: a key of MAX_KEY and a value of MAX_VALUE are kept; one more is not, written or synced', () => {
  const key = 'k'.repeat(MAX_KEY);
  const r = w(emptyStore(), A, key, s('v'));
  assert.equal(validStore(r.store), true);
  assert.equal(apply(emptyStore(), r.op).ok, true);
  assert.equal(merge(emptyStore(), r.store).ok, true, 'a store from outside with a key at the limit');
  const big = ['s', 'x'.repeat(MAX_VALUE - 8)];
  assert.equal(admits(emptyStore(), 'k', big).ok, true, 'exactly MAX_VALUE characters');
  const over = ['s', 'x'.repeat(MAX_VALUE - 7)];
  assert.match(admits(emptyStore(), 'k', over).why, /at most/);
  assert.match(apply(emptyStore(), { key: 'k', d: A, n: 1, ctx: {}, v: over }).why, /at most/, 'a peer cannot sync a value larger than one could be written');
});

test('the same original from two devices syncs; an original with other bytes does not', () => {
  const bytes = Buffer.from('a shared original');
  const name = 'file/' + createHash('sha256').update(bytes).digest('hex');
  const val = ['ab', bytes.toString('base64')];
  const a = w(emptyStore(), A, name, val), b = w(emptyStore(), B, name, val);
  const m = apply(a.store, b.op);
  assert.equal(m.ok, true);
  assert.deepEqual(read(m.store, name).value, val);
  const lie = { ...b.op, d: C, v: ['ab', Buffer.from('other').toString('base64')] };
  assert.match(apply(a.store, lie).why, /SHA-256 of its bytes|cannot change/);
});

test('merge keeps the clock of a device whose writes were all replaced', () => {
  const c = w(emptyStore(), C, 'k', s('c'));
  const b = w(ap(emptyStore(), c.op), B, 'k', s('b saw c'));
  assert.deepEqual(opsSince(b.store, {}).map((o) => o.d), [B], 'only the version from B is live');
  const m = merge(emptyStore(), b.store).store;
  assert.equal(m.clock[C], 1, 'the counter of C still travels');
  assert.equal(m.clock[B], 1);
  const back = merge(m, emptyStore()).store;
  assert.equal(back.clock[C], 1, 'and is never lowered');
});

test('lost: the same counter on another device, or another counter on the same device, is not the op', () => {
  const st = w(emptyStore(), A, 'k', s('v')).store;
  assert.equal(lost([{ key: 'k', d: B, n: 1 }], st).length, 1);
  assert.equal(lost([{ key: 'k', d: A, n: 5 }], st).length, 1);
  assert.equal(lost([{ key: 'k', d: A, n: 1 }], st).length, 0);
});

test('canon: depth is bounded through objects too', () => {
  let deep = 1; for (let i = 0; i < 80; i++) deep = { k: deep };
  assert.notEqual(canon(deep), null);
  assert.equal(canon({ k: deep }), null);
});

test('bigger reads garbage as not bigger; versions keep one order whichever way they arrive', () => {
  assert.equal(bigger(null, { n: 1 }), false);
  assert.equal(bigger({ n: 1 }, undefined), false);
  const x = w(emptyStore(), A, 'k', s('a')), y = w(emptyStore(), C, 'k', s('c')), z = w(emptyStore(), B, 'k', s('b'));
  const one = [x.op, y.op, z.op].reduce((st, op) => ap(st, op), emptyStore());
  const two = [z.op, x.op, y.op].reduce((st, op) => ap(st, op), emptyStore());
  assert.deepEqual(one.keys.k.map((v) => v.d), [A, B, C]);
  assert.equal(digest(one), digest(two));
});

test('validStore reads a store that throws when read as not a store', () => {
  assert.equal(validStore({ ...emptyStore(), clock: { get a() { throw new Error('toxic'); } } }), false);
  assert.equal(validStore({ ...emptyStore(), keys: { get k() { throw new Error('toxic'); } } }), false);
});
