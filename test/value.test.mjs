import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tag, untag, toB64, MAX_DEPTH } from '../src/value.mjs';

const round = async (v) => { const t = await tag(v); assert.equal(t.ok, true, t.why); return untag(JSON.parse(JSON.stringify(t.t))); };

test('every kind of value goes round through JSON unchanged', async () => {
  for (const v of [null, true, false, 0, 1.5, -7, 'text ✓', '', [1, 'a', null], { a: 1, b: { c: [true] } }]) assert.deepEqual(await round(v), v);
  assert.equal(await round(undefined), undefined);
  assert.equal((await tag(undefined)).t[0], 'u');
  assert.ok(Number.isNaN(await round(NaN)));
  assert.equal(await round(Infinity), Infinity);
  assert.equal(await round(-Infinity), -Infinity);
  assert.ok(Object.is(await round(-0), -0));
  assert.deepEqual(await round(new Date(1234)), new Date(1234));
  assert.deepEqual(new Uint8Array(await round(Uint8Array.of(1, 2, 255).buffer)), Uint8Array.of(1, 2, 255));
  assert.deepEqual(await round(Float64Array.of(1.5, -2)), Float64Array.of(1.5, -2));
  assert.deepEqual(await round(new Uint8Array([9, 8]).subarray(1)), Uint8Array.of(8), 'a view carries only its own bytes');
  assert.deepEqual(await round(new Map([['k', 1], [2, [3]]])), new Map([['k', 1], [2, [3]]]));
  assert.deepEqual(await round(new Set([1, 'x'])), new Set([1, 'x']));
  const b = await round(new Blob(['hello'], { type: 'text/plain' }));
  assert.equal(b.type, 'text/plain');
  assert.equal(await b.text(), 'hello');
  const nul = Object.create(null); nul.k = 1;
  assert.deepEqual({ ...(await round(nul)) }, { k: 1 });
});

test('one spelling per value', async () => {
  assert.deepEqual((await tag({ b: 1, a: [NaN, 'x'] })).t, ['o', [['b', ['n', 1]], ['a', ['a', [['n', 'NaN'], ['s', 'x']]]]]]);
  assert.deepEqual((await tag(Uint8Array.of(0, 255))).t, ['ta', 'Uint8Array', 'AP8=']);
  assert.deepEqual((await tag(new Date(0))).t, ['d', 0]);
  assert.deepEqual((await tag(-0)).t, ['n', '-0']);
  assert.deepEqual((await tag(Infinity)).t, ['n', 'Infinity']);
  assert.deepEqual((await tag(-Infinity)).t, ['n', '-Infinity']);
  assert.deepEqual((await tag(false)).t, ['b', false]);
  assert.deepEqual((await tag(null)).t, ['z']);
});

test('refused by name: functions, symbols, BigInts, cycles, too deep, other classes', async () => {
  assert.match((await tag(() => 1)).why, /function cannot be stored/);
  assert.match((await tag(Symbol('s'))).why, /symbol cannot be stored/);
  assert.match((await tag(10n)).why, /bigint cannot be stored/);
  const c = { a: 1 }; c.self = c;
  assert.match((await tag(c)).why, /contains itself/);
  const arr = []; arr.push(arr);
  assert.match((await tag(arr)).why, /contains itself/);
  let deep = 1; for (let i = 0; i < MAX_DEPTH; i++) deep = [deep];
  assert.equal((await tag(deep)).ok, true, 'exactly MAX_DEPTH levels');
  assert.match((await tag([deep])).why, /deeper than/);
  class Thing {}
  assert.match((await tag(new Thing())).why, /Thing cannot be stored/);
  assert.match((await tag(new WeakMap())).why, /cannot be stored/);
  const shared = [1];
  assert.equal((await tag({ a: shared, b: shared })).ok, true, 'the same value twice is not a cycle');
});

test('untag: anything that is not a tagged value reads as undefined', () => {
  for (const t of [null, 5, 'x', [], [1], ['?'], ['b', 1], ['s', 2], ['n', 'NaNx'], ['n', {}], ['d', 'x'], ['ta', 'Nope', ''], ['ta', 'Uint16Array', 'AA=='], ['a', 'x'], ['o', 'x'], ['o', [[1, ['z']]]], ['map', 'x'], ['set', 'x'], ['blob', 5, ''], ['ab', '***']]) {
    assert.equal(untag(t), undefined, JSON.stringify(t));
  }
  let deep = ['z']; for (let i = 0; i < 70; i++) deep = ['a', [deep]];
  assert.equal(untag(deep), undefined, 'too deep');
  let ok = ['z']; for (let i = 0; i < 64; i++) ok = ['a', [ok]];
  assert.notEqual(untag(ok), undefined, '64 levels read');
  const proto = untag(['o', [['__proto__', ['o', [['polluted', ['b', true]]]]]]]);
  assert.equal(({}).polluted, undefined, 'no prototype pollution');
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.deepEqual(Object.keys(proto), ['__proto__']);
  assert.equal(untag(['n', 'hasOwnProperty']), undefined);
});

test('toB64: large inputs in chunks, exactly', () => {
  const big = new Uint8Array(100000).map((_, i) => i & 255);
  assert.equal(toB64(big), Buffer.from(big).toString('base64'));
  assert.equal(toB64(new Uint8Array(0)), '');
  assert.equal(toB64('x'), null);
  assert.equal(toB64([1, 2]), null);
});

test('depth is bounded through every kind of container, both ways', async () => {
  const nest = (d, wrap) => { let x = 1; for (let i = 0; i < d; i++) x = wrap(x); return x; };
  for (const [kind, wrap] of [['object', (x) => ({ k: x })], ['map', (x) => new Map([['k', x]])], ['set', (x) => new Set([x])], ['map key', (x) => new Map([[x, 1]])]]) {
    assert.equal((await tag(nest(MAX_DEPTH, wrap))).ok, true, kind + ' at the limit');
    assert.match((await tag(nest(MAX_DEPTH + 1, wrap))).why, /deeper than/, kind + ' past the limit');
  }
  const tnest = (d, wrap) => { let x = ['n', 1]; for (let i = 0; i < d; i++) x = wrap(x); return x; };
  for (const [kind, wrap] of [['o', (x) => ['o', [['k', x]]]], ['map', (x) => ['map', [[['s', 'k'], x]]]], ['set', (x) => ['set', [x]]], ['map key', (x) => ['map', [[x, ['n', 1]]]]]]) {
    assert.notEqual(untag(tnest(64, wrap)), undefined, kind + ' 64 levels');
    assert.equal(untag(tnest(65, wrap)), undefined, kind + ' 65 levels');
  }
});

test('refusals give the reason exactly', async () => {
  assert.deepEqual(await tag(() => 1), { ok: false, why: 'a function cannot be stored' });
  assert.deepEqual(await tag({ get x() { throw 7; } }), { ok: false, why: 'the value cannot be stored' }, 'a thrown non-Error');
  assert.equal(untag([5, 'x']), undefined, 'a tag that is not text');
});
