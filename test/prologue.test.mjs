import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridge } from '../src/prologue.mjs';

const tick = () => new Promise((r) => setTimeout(r, 5));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const setup = (seed) => { const win = {}; const msgs = []; const st = bridge(win, (m) => msgs.push(m), seed); return { win, msgs, st }; };
const req = (r) => new Promise((ok, bad) => { r.onsuccess = (e) => ok(e.target.result); r.onerror = () => bad(r.error); });

test('localStorage: seeded, read, written, removed, cleared — each change reported', () => {
  const { win, msgs } = setup({ ls: [['a', '1'], ['b', 2]] });
  const ls = win.localStorage;
  assert.equal(ls.getItem('a'), '1');
  assert.equal(ls.getItem('b'), '2', 'values are strings');
  assert.equal(ls.getItem('none'), null);
  assert.equal(ls.length, 2);
  ls.setItem('c', 3);
  assert.equal(ls.getItem('c'), '3');
  assert.deepEqual(msgs.at(-1), { t: 'ls', op: 'set', k: 'c', v: '3' });
  assert.equal(ls.key(0), 'a');
  assert.equal(ls.key(2), 'c');
  assert.equal(ls.key(3), null);
  assert.equal(ls.key(-1), null);
  assert.equal(ls.key(1.5), null);
  ls.removeItem('a');
  assert.deepEqual(msgs.at(-1), { t: 'ls', op: 'del', k: 'a' });
  const n = msgs.length;
  ls.removeItem('a');
  assert.equal(msgs.length, n, 'removing what is not there reports nothing');
  ls.clear();
  assert.deepEqual(msgs.at(-1), { t: 'ls', op: 'clear' });
  assert.equal(ls.length, 0);
});

test('localStorage as properties, as in a browser', () => {
  const { win, msgs } = setup({ ls: [['x', 'y']] });
  const ls = win.localStorage;
  assert.equal(ls.x, 'y');
  ls.z = 'w';
  assert.equal(ls.getItem('z'), 'w');
  assert.deepEqual(msgs.at(-1), { t: 'ls', op: 'set', k: 'z', v: 'w' });
  assert.equal('z' in ls, true);
  assert.equal('getItem' in ls, true);
  assert.equal('nope' in ls, false);
  assert.deepEqual(Object.keys(ls).sort(), ['x', 'z']);
  delete ls.x;
  assert.equal(ls.getItem('x'), null);
  assert.equal(typeof ls.getItem, 'function', 'methods are not storage');
  ls.getItem = 'hijack';
  assert.equal(typeof ls.getItem, 'function', 'a method stays a method');
  assert.equal(ls.getItem('getItem'), 'hijack', 'and the item of that name is stored, as in a browser');
  delete ls.getItem;
  assert.equal(ls.getItem('getItem'), null);
  assert.equal(typeof ls.getItem, 'function');
  assert.equal(Object.getOwnPropertyDescriptor(ls, 'nope'), undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptor(ls, 'z'), { value: 'w', enumerable: true, configurable: true, writable: true });
  ls[Symbol.iterator] = 1;
  assert.equal(ls.length, 1, 'a symbol is not an item');
});

test('sessionStorage lives in memory and reports nothing', () => {
  const { win, msgs } = setup({});
  win.sessionStorage.setItem('s', '1');
  assert.equal(win.sessionStorage.getItem('s'), '1');
  win.sessionStorage.removeItem('s');
  win.sessionStorage.clear();
  assert.equal(msgs.length, 0);
});

test('IndexedDB: open with upgrade, create stores, put/get/getAll/count/delete/clear, complete fires last', async () => {
  const { win, msgs } = setup({});
  const r = win.indexedDB.open('app', 1);
  let upgraded = false;
  r.onupgradeneeded = (e) => {
    upgraded = true;
    const d = e.target.result;
    assert.equal(d.objectStoreNames.contains('s'), false);
    d.createObjectStore('s');
    d.createObjectStore('rows', { keyPath: 'id' });
    assert.throws(() => d.createObjectStore('s'), /ConstraintError/);
  };
  const db = await req(r);
  assert.equal(upgraded, true);
  assert.equal(db.version, 1);
  assert.equal(db.objectStoreNames.contains('rows'), true);
  assert.equal(db.objectStoreNames.length, 2);
  assert.deepEqual([...db.objectStoreNames], ['rows', 's']);
  assert.equal(db.objectStoreNames.item(0), 'rows');
  assert.equal(db.objectStoreNames.item(9), null);
  assert.deepEqual(msgs.find((m) => m.op === 'schema'), { t: 'idb', op: 'schema', db: 'app', version: 1, stores: [{ name: 's', keyPath: null }, { name: 'rows', keyPath: 'id' }] });
  const tx = db.transaction('s', 'readwrite');
  const order = [];
  const state = { docs: [1, 2], when: new Date(5) };
  const p = tx.objectStore('s').put(state, 'state');
  p.onsuccess = () => order.push('put');
  tx.oncomplete = () => order.push('complete');
  state.docs.push(3);
  await settle();
  assert.deepEqual(order, ['put', 'complete']);
  const got = await req(db.transaction('s', 'readonly').objectStore('s').get('state'));
  assert.deepEqual(got.docs, [1, 2], 'a value is copied in');
  got.docs.push(9);
  assert.deepEqual((await req(db.transaction('s').objectStore('s').get('state'))).docs, [1, 2], 'and copied out');
  assert.equal(await req(db.transaction('s').objectStore('s').get('none')), undefined);
  const put = msgs.find((m) => m.op === 'put');
  assert.deepEqual({ ...put, value: undefined }, { t: 'idb', op: 'put', db: 'app', store: 's', key: 'state', value: undefined });
  const rows = db.transaction(['rows'], 'readwrite').objectStore('rows');
  await req(rows.put({ id: 'b', n: 2 }));
  await req(rows.put({ id: 'a', n: 1 }));
  await req(rows.put({ id: 3, n: 0 }));
  assert.deepEqual((await req(db.transaction('rows').objectStore('rows').getAll())).map((x) => x.id), [3, 'a', 'b'], 'numbers sort before strings');
  assert.deepEqual(await req(db.transaction('rows').objectStore('rows').getAllKeys()), [3, 'a', 'b']);
  assert.equal(await req(db.transaction('rows').objectStore('rows').count()), 3);
  await req(db.transaction('rows', 'readwrite').objectStore('rows').delete('a'));
  assert.deepEqual(msgs.at(-1), { t: 'idb', op: 'del', db: 'app', store: 'rows', key: 'a' });
  const before = msgs.length;
  await req(db.transaction('rows', 'readwrite').objectStore('rows').delete('none'));
  assert.equal(msgs.length, before, 'deleting what is not there reports nothing');
  await req(db.transaction('rows', 'readwrite').objectStore('rows').clear());
  assert.deepEqual(msgs.at(-1), { t: 'idb', op: 'clear', db: 'app', store: 'rows' });
  assert.equal(await req(db.transaction('rows').objectStore('rows').count()), 0);
});

test('IndexedDB: errors as IndexedDB gives them', async () => {
  const { win } = setup({});
  const db = await new Promise((ok) => { const r = win.indexedDB.open('x', 2); r.onupgradeneeded = (e) => e.target.result.createObjectStore('k', { keyPath: 'id' }); r.onsuccess = (e) => ok(e.target.result); });
  assert.throws(() => db.transaction('k').objectStore('k').put({ id: 1 }), /ReadOnlyError/);
  assert.throws(() => db.transaction('k').objectStore('k').add({ id: 1 }), /ReadOnlyError/);
  assert.throws(() => db.transaction('k').objectStore('k').delete(1), /ReadOnlyError/);
  assert.throws(() => db.transaction('k').objectStore('k').clear(), /ReadOnlyError/);
  assert.throws(() => db.transaction('k', 'readwrite').objectStore('k').put({ nokey: 1 }), /DataError/);
  assert.throws(() => db.transaction('k', 'readwrite').objectStore('k').put(null), /DataError/);
  assert.throws(() => db.transaction('k', 'readwrite').objectStore('k').put({ id: NaN }), /DataError/);
  assert.throws(() => db.transaction('k', 'readwrite').objectStore('k').put({ id: {} }), /DataError/);
  assert.throws(() => db.transaction('k', 'readwrite').objectStore('k').put({ id: 1, f: () => 1 }), /could not be cloned/);
  assert.equal(await req(db.transaction('k', 'readwrite').objectStore('k').put({ id: [1, 'a', new Date(3)] })), undefined === 0 ? 0 : (await req(db.transaction('k').objectStore('k').getAllKeys()))[0]);
  await req(db.transaction('k', 'readwrite').objectStore('k').add({ id: 7 }));
  await assert.rejects(req(db.transaction('k', 'readwrite').objectStore('k').add({ id: 7 })), /ConstraintError/);
  assert.throws(() => db.transaction('k').objectStore('other'), /NotFoundError/);
  assert.throws(() => db.transaction('other').objectStore('other'), /NotFoundError/);
  const lower = win.indexedDB.open('x', 1);
  await assert.rejects(req(lower), /VersionError/);
  await assert.rejects(req(win.indexedDB.open('y', 0)), /TypeError/);
  await assert.rejects(req(win.indexedDB.open('y', 1.5)), /TypeError/);
  let txErr = 0;
  const t = db.transaction('k', 'readwrite'); t.onerror = () => txErr++;
  t.objectStore('k').add({ id: 7 });
  await settle();
  assert.equal(txErr, 1, 'a failed request fails its transaction too');
});

test('IndexedDB: seeded databases open without an upgrade, at their version, with their rows', async () => {
  const { win, msgs } = setup({ idb: [{ name: 'app', version: 3, stores: [{ name: 's', keyPath: null, entries: [['state', { a: 1 }]] }, { name: 'r', keyPath: 'id', entries: [[2, { id: 2 }], [1, { id: 1 }]] }] }] });
  let upgrades = 0;
  const r = win.indexedDB.open('app', 3); r.onupgradeneeded = () => upgrades++;
  const db = await req(r);
  assert.equal(upgrades, 0);
  assert.equal(db.version, 3);
  assert.deepEqual(await req(db.transaction('s').objectStore('s').get('state')), { a: 1 });
  assert.deepEqual((await req(db.transaction('r').objectStore('r').getAll())).map((x) => x.id), [1, 2]);
  const same = await req(win.indexedDB.open('app'));
  assert.equal(same.version, 3, 'no version given opens what is there');
  assert.equal(msgs.length, 0, 'opening reports nothing');
  const up = win.indexedDB.open('app', 4);
  up.onupgradeneeded = (e) => { upgrades++; e.target.result.deleteObjectStore('r'); };
  const db4 = await req(up);
  assert.equal(upgrades, 1);
  assert.equal(db4.objectStoreNames.contains('r'), false);
  assert.deepEqual(msgs.at(-1), { t: 'idb', op: 'schema', db: 'app', version: 4, stores: [{ name: 's', keyPath: null }] });
});

test('IndexedDB: listeners, deleteDatabase, databases, cmp, addEventListener', async () => {
  const { win, msgs } = setup({ idb: [{ name: 'gone', version: 1, stores: [] }] });
  const r = win.indexedDB.open('ev', 1);
  const seen = [];
  r.addEventListener('upgradeneeded', () => seen.push('up'));
  r.addEventListener('success', () => seen.push('ok'));
  const extra = () => seen.push('removed');
  r.addEventListener('success', extra);
  r.removeEventListener('success', extra);
  await settle();
  assert.deepEqual(seen, ['up', 'ok']);
  const db = r.result;
  db.createObjectStore('z');
  const t = db.transaction('z', 'readwrite');
  let done = 0; t.addEventListener('complete', () => done++);
  t.objectStore('z').put(1, 1);
  await settle();
  assert.equal(done, 1);
  assert.deepEqual((await win.indexedDB.databases()).map((d) => d.name).sort(), ['ev', 'gone']);
  await req(win.indexedDB.deleteDatabase('gone'));
  assert.deepEqual(msgs.at(-1), { t: 'idb', op: 'drop', db: 'gone' });
  assert.deepEqual((await win.indexedDB.databases()).map((d) => d.name), ['ev']);
  const cmp = win.indexedDB.cmp;
  assert.equal(cmp(1, 2), -1); assert.equal(cmp(2, 1), 1); assert.equal(cmp('a', 'a'), 0);
  assert.equal(cmp(5, 'a'), -1); assert.equal(cmp('a', [1]), -1); assert.equal(cmp(new Date(1), 'a'), -1); assert.equal(cmp(9, new Date(1)), -1);
  assert.equal(cmp(new Date(1), new Date(2)), -1);
  assert.equal(cmp([1, 2], [1, 3]), -1); assert.equal(cmp([1, 2], [1]), 1); assert.equal(cmp([1], [1]), 0); assert.equal(cmp([2], [1, 9]), 1);
  const aborted = db.transaction('z', 'readwrite'); let ab = 0; aborted.onabort = () => ab++; aborted.abort(); await settle();
  assert.equal(ab, 1);
});

test('the office going away never breaks the block', () => {
  const win = {};
  bridge(win, () => { throw new Error('gone'); }, {});
  win.localStorage.setItem('a', 'b');
  assert.equal(win.localStorage.getItem('a'), 'b');
});

test('a seed that is not one reads as empty', () => {
  for (const s of [null, 5, 'x', { ls: 'x', idb: 5 }, { idb: [{ name: 'a', stores: 'x' }] }]) {
    const win = {}; bridge(win, () => {}, s);
    assert.equal(win.localStorage.length, 0);
  }
  const win = {}; const st = bridge(win, () => {}, { idb: [{ name: 'a', version: 'x', stores: [{ name: 's', entries: 'x' }] }] });
  assert.equal(st.idb.get('a').version, 1, 'a version that is not a number reads as 1');
  assert.equal(st.idb.get('a').stores.get('s').keyPath, null);
});

test('a window that refuses a property: reported, the rest installed', () => {
  const win = {}; Object.defineProperty(win, 'localStorage', { value: 1, configurable: false });
  const msgs = []; bridge(win, (m) => msgs.push(m), {});
  assert.deepEqual(msgs, [{ t: 'err', where: 'localStorage' }]);
  assert.equal(typeof win.indexedDB.open, 'function');
});
