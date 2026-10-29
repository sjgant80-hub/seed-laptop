import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterBody, sealRoster, openRoster, keysOf, batches, seal, hear, MAX_DEVICES } from '../src/sync.mjs';
import { makeIdentity, slotOf, unhex } from '../vendor/fall-kit-core/identity.mjs';

const founder = () => makeIdentity(new Uint8Array(32).fill(1));
const dev = (n) => makeIdentity(new Uint8Array(32).fill(n));

test('a roster the founder signs opens; another key, a changed byte or a bad device does not', async () => {
  const f = await founder(), a = await dev(2), b = await dev(3);
  const body = rosterBody(1, [{ name: 'laptop', key: b.id }, { name: 'phone', key: a.id }]);
  assert.deepEqual(body.devices.map((d) => d.key), [a.id, b.id].sort());
  const s = await sealRoster(body, f);
  assert.equal(s.ok, true);
  const o = await openRoster(s.text, f.id);
  assert.equal(o.ok, true);
  assert.equal(o.n, 1);
  assert.equal(o.devices.length, 2);
  assert.match((await openRoster(s.text, a.id)).why, /not signed by this owner/);
  const forged = await sealRoster(body, a);
  assert.match((await openRoster(forged.text.replace('"by":"' + a.id, '"by":"' + f.id), f.id)).why, /did not sign/);
  assert.match((await openRoster(s.text.replace('"n":1', '"n":2'), f.id)).why, /did not sign/);
  assert.match((await openRoster(s.text + ' ', f.id)).why, /canonical/);
  assert.match((await openRoster('{', f.id)).why, /JSON/);
  assert.match((await sealRoster(rosterBody(0, [{ name: 'x', key: a.id }]), f)).why, /numbered from 1/);
  assert.match((await sealRoster(rosterBody(1, []), f)).why, /1 to/);
  assert.match((await sealRoster(rosterBody(1, [{ name: '', key: a.id }]), f)).why, /device name/);
  assert.match((await sealRoster(rosterBody(1, [{ name: 'x', key: 'nothex' }]), f)).why, /name and a key/);
  assert.match((await sealRoster(rosterBody(1, [{ name: 'x', key: a.id }, { name: 'y', key: a.id }]), f)).why, /share a key or a slot/);
  assert.match((await sealRoster(body, {})).why, /founder/);
  const many = Array.from({ length: MAX_DEVICES + 1 }, (_, i) => ({ name: 'd' + i, key: i.toString(16).padStart(64, '0') }));
  assert.match((await sealRoster(rosterBody(1, many), f)).why, /1 to/);
});

test('keysOf: a slot each, or null when two keys share one', async () => {
  const a = await dev(2), b = await dev(3);
  const m = keysOf([{ key: a.id }, { key: b.id }]);
  assert.equal(m.get(slotOf(unhex(a.id))), a.id);
  assert.equal(keysOf([{ key: a.id }, { key: a.id }]), null);
});

test('a sync packet passes the door only from a pinned device, signed, newer, and for me', async () => {
  const a = await dev(2), b = await dev(3), c = await dev(4);
  const pkt = (await seal({ to: b.id, ops: [{ key: 'k', d: 'ab'.repeat(16), n: 1, ctx: {}, v: ['s', 'v'] }] }, a, 1)).bytes;
  const door = { keys: keysOf([{ key: a.id }, { key: b.id }]), last: new Map(), me: b.id };
  const h = await hear(pkt, door);
  assert.equal(h.ok, true);
  assert.equal(h.from, a.id);
  assert.equal(h.counter, 1n);
  assert.equal(h.ops.length, 1);
  door.last.set(h.slot, h.counter);
  assert.equal((await hear(pkt, door)).stage, 'counter', 'a replay');
  assert.equal((await hear((await seal({ to: b.id, ops: [] }, c, 5)).bytes, door)).stage, 'sender', 'not on the roster');
  const flip = (await seal({ to: b.id, ops: [] }, a, 2)).bytes.slice(); flip[30] ^= 1;
  assert.notEqual((await hear(flip, door)).ok, true, 'a changed byte');
  assert.equal((await hear((await seal({ to: c.id, ops: [] }, a, 3)).bytes, door)).stage, 'body', 'for another device');
  assert.equal((await hear((await seal({ nope: 1 }, a, 4)).bytes, door)).stage, 'body');
  assert.match((await seal({ to: 'x', ops: [] }, null, 1)).why, /sealed by a device/);
  assert.match((await seal({ to: 'x', ops: [] }, a, 0)).why, /counter from 1/);
  assert.match((await seal({ to: 'x', ops: [] }, { sign: () => { throw new Error('x'); }, slot: 1 }, 1)).why, /could not sign/);
  assert.equal((await hear(new Uint8Array(10), door)).stage, 'size');
  assert.equal((await hear(pkt, null)).ok, false);
});

test('batches: by size, one op at least each, nothing lost', () => {
  const ops = Array.from({ length: 10 }, (_, i) => ({ i, pad: 'x'.repeat(40) }));
  const b = batches(ops, 120);
  assert.equal(b.flat().length, 10);
  assert.ok(b.every((x) => x.length >= 1));
  assert.ok(b.every((x) => JSON.stringify(x).length <= 120 || x.length === 1));
  assert.deepEqual(batches([], 100), []);
  assert.equal(batches([{ big: 'y'.repeat(500) }], 100).length, 1, 'an op larger than a batch still travels alone');
  const c = []; c.push(c);
  assert.deepEqual(batches([c, { ok: 1 }], 100), [[{ ok: 1 }]], 'an op that is not JSON is dropped, never sent half');
});

test('sync at its exact edges: every guard of the roster, the packet body and its clock; batch sizes', async () => {
  const f = await founder(), a = await dev(2), b = await dev(3);
  const checked = async (body) => (await sealRoster(body, null)).why;   // a body that passes its checks meets the founder check
  const distinct = [];
  for (let i = 0; distinct.length < MAX_DEVICES + 1; i++) { const key = i.toString(16).padStart(64, '0'); if (!distinct.some((d) => slotOf(unhex(d.key)) === slotOf(unhex(key)))) distinct.push({ name: 'd' + i, key }); }
  assert.match(await checked(rosterBody(1, distinct.slice(0, MAX_DEVICES))), /sealed by the founder/, 'exactly MAX_DEVICES devices');
  assert.match(await checked(rosterBody(1, distinct)), /1 to 32/);
  const good = rosterBody(1, [{ name: 'x', key: a.id }]);
  for (const bad of [5, { ...good, kind: 'other' }, { ...good, v: 2 }]) assert.match(await checked(bad), /not a device roster/);
  for (const d of [5, { name: 'x', key: a.id, extra: 1 }, { name: 'x', key: 5 }]) assert.match(await checked({ ...good, devices: [d] }), /name and a key/);
  assert.match((await sealRoster(good, { sign: 5, id: f.id })).why, /founder/);
  assert.match((await sealRoster(good, { sign: f.sign, id: 5 })).why, /founder/);
  assert.equal((await sealRoster(good, f)).ok, true);
  const same = rosterBody(1, [{ name: 'b', key: b.id }, { name: 'a', key: a.id }, { name: 'c', key: b.id }]);
  assert.deepEqual(same.devices.map((d) => d.name), a.id < b.id ? ['a', 'b', 'c'] : ['b', 'c', 'a'], 'in key order, equal keys kept in the order given');
  for (const d of [5, { key: 5 }, { key: 'zz' }]) assert.equal(keysOf([d]), null);
  assert.match((await openRoster('{"a":1}', f.id)).why, /its body, its signer and the signature/);
  assert.match((await openRoster('null', f.id)).why, /its body, its signer and the signature/);
  const s = await sealRoster(good, f);
  assert.match((await openRoster(s.text.replace(/"sig":"[0-9a-f]+"/, '"sig":"zz"'), f.id)).why, /64 bytes/);
  const door = { keys: keysOf([{ key: a.id }, { key: b.id }]), last: new Map(), me: b.id };
  let k = 10;
  const heard = async (body) => hear((await seal(body, a, k++)).bytes, door);
  for (const body of [5, { to: 5, ops: [] }, { to: b.id, ops: 'x' }]) { const h = await heard(body); assert.equal(h.stage, 'body', JSON.stringify(body)); assert.match(h.why, /\{ to, ops \}/, 'refused as not a sync packet, before anything else is asked of it'); }
  const C = 'ab'.repeat(8);
  assert.deepEqual((await heard({ to: b.id, ops: [], clock: { [C]: 1 } })).clock, { [C]: 1 }, 'a counter of 1 is kept');
  for (const clock of [{ [C]: 0 }, { [C]: 1.5 }, { ZZ: 1 }, [1], 'x']) assert.deepEqual((await heard({ to: b.id, ops: [], clock })).clock, {}, 'a clock with anything wrong in it is no clock: ' + JSON.stringify(clock));
  assert.match((await seal({ to: 'x', ops: [] }, {}, 1)).why, /sealed by a device/);
  assert.match((await seal({ to: 'x', ops: [] }, a, 1.5)).why, /counter from 1/);
  assert.deepEqual(batches(['a', 'a', 'a'], 10), [['a', 'a'], ['a']], 'each op counts its JSON and a comma; two fit 10 exactly');
  assert.deepEqual(batches(['a', 'a', 'a'], 9), [['a'], ['a'], ['a']]);
});
