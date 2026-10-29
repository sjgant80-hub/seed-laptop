import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS, EXTRAS, GIVES, found, tierOf } from '../src/runtime.mjs';

const all = () => Object.fromEntries([...NEEDS, ...EXTRAS].map((n) => [n, true]));

test('found: own property, exactly true', () => {
  assert.equal(found({ a: true }, 'a'), true);
  assert.equal(found({ a: 1 }, 'a'), false);
  assert.equal(found({ a: 'true' }, 'a'), false);
  assert.equal(found({}, 'a'), false);
  assert.equal(found(Object.create({ a: true }), 'a'), false);
  assert.equal(found(null, 'a'), false);
  assert.equal(found({ get a() { throw new Error('x'); } }, 'a'), false);
});

test('every need and every extra → full, says everything', () => {
  const r = tierOf(all());
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'full');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.absent, []);
  assert.deepEqual(r.gives, EXTRAS.map((n) => GIVES[n]));
  assert.equal(r.says, 'The office grows here, with everything: ' + EXTRAS.map((n) => GIVES[n]).join('; ') + '.');
});

test('every need, one extra absent → core, names what is not available', () => {
  const f = all(); delete f.webgpu;
  const r = tierOf(f);
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'core');
  assert.deepEqual(r.absent, ['webgpu']);
  assert.deepEqual(r.missing, []);
  assert.equal(r.gives.length, EXTRAS.length - 1);
  assert.ok(!r.gives.includes(GIVES.webgpu));
  assert.equal(r.says, 'The office grows here. Not available: a language model can run in this tab.');
});

test('needs only → core with every extra absent', () => {
  const f = Object.fromEntries(NEEDS.map((n) => [n, true]));
  const r = tierOf(f);
  assert.equal(r.tier, 'core');
  assert.deepEqual(r.absent, [...EXTRAS]);
  assert.deepEqual(r.gives, []);
  assert.equal(r.says, 'The office grows here. Not available: ' + EXTRAS.map((n) => GIVES[n]).join('; ') + '.');
});

test('each need, missing alone → none, named', () => {
  for (const n of NEEDS) {
    const f = all(); f[n] = false;
    const r = tierOf(f);
    assert.equal(r.ok, false, n);
    assert.equal(r.tier, 'none');
    assert.deepEqual(r.missing, [n]);
    assert.deepEqual(r.gives, []);
    assert.deepEqual(r.absent, []);
    assert.equal(r.says, 'The office cannot grow here: this runtime has no ' + n + '.');
  }
});

test('two needs missing → both named, in order', () => {
  const r = tierOf({ sha256: true, aesgcm: true, pbkdf2: true });
  assert.deepEqual(r.missing, ['ed25519', 'storage']);
  assert.equal(r.says, 'The office cannot grow here: this runtime has no ed25519, storage.');
  assert.deepEqual(r.absent, [...EXTRAS]);
});

test('garbage reads as nothing found, never throws', () => {
  for (const g of [undefined, null, 0, 'x', [], () => 1, new Proxy({}, { get() { throw new Error('p'); }, has() { throw new Error('p'); }, getOwnPropertyDescriptor() { throw new Error('p'); } })]) {
    const r = tierOf(g);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, [...NEEDS]);
  }
});
