import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writesFor, seedOf, rowId, MAX_ROW_ID, MAX_NAME } from '../src/office.mjs';
import { emptyStore, write, read } from '../src/store.mjs';
import { tag, untag } from '../src/value.mjs';
import { bridge } from '../src/prologue.mjs';

const D = 'd'.repeat(64);
const apply = (st, ws) => ws.reduce((s, x) => { const r = write(s, D, x.key, x.value); assert.equal(r.ok, true, r.why); return r.store; }, st);
const pair = async (k, v) => (await tag([k, v])).t[1];

test('localStorage messages: set, del, clear', () => {
  let st = emptyStore();
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'theme', v: 'dark' }), [{ key: 'b/crm/ls/theme', value: ['s', 'dark'] }]);
  st = apply(st, writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'theme', v: 'dark' }));
  st = apply(st, writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'lang', v: 'en' }));
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'del', k: 'theme' }), [{ key: 'b/crm/ls/theme', value: null }]);
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'clear' }), [{ key: 'b/crm/ls/lang', value: null }, { key: 'b/crm/ls/theme', value: null }]);
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'x', v: 5 }), [], 'values are text');
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'x'.repeat(MAX_NAME + 1), v: 'v' }), []);
  assert.equal(writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'x'.repeat(MAX_NAME), v: 'v' }).length, 1);
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'del', k: 'x'.repeat(MAX_NAME + 1) }), []);
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'nope' }), []);
  assert.deepEqual(writesFor(st, 'crm', { t: 'ls', op: 'del', k: 5 }), []);
});

test('IndexedDB messages: schema, put, del, clear, drop — each block under its own id', async () => {
  let st = emptyStore();
  const schema = { t: 'idb', op: 'schema', db: 'app', version: 2, stores: [{ name: 's', keyPath: null }, { name: 'rows', keyPath: 'id' }] };
  const ws = writesFor(st, 'office', schema);
  assert.equal(ws.length, 1);
  assert.equal(ws[0].key, 'b/office/idb/app');
  assert.deepEqual(untag(ws[0].value), { version: 2, stores: [{ name: 's', keyPath: null }, { name: 'rows', keyPath: 'id' }] });
  st = apply(st, ws);
  const p = await pair('state', { docs: ['a'] });
  const put = writesFor(st, 'office', { t: 'idb', op: 'put', db: 'app', store: 's' }, p);
  assert.deepEqual(put, [{ key: 'b/office/idb/app/s/' + rowId(p[0]), value: ['a', p] }]);
  st = apply(st, put);
  st = apply(st, writesFor(st, 'office', { t: 'idb', op: 'put', db: 'app', store: 'rows' }, await pair(1, { id: 1 })));
  st = apply(st, writesFor(st, 'office', { t: 'idb', op: 'put', db: 'app', store: 'rows' }, await pair(2, { id: 2 })));
  assert.deepEqual(writesFor(st, 'office', { t: 'idb', op: 'del', db: 'app', store: 's' }, p), [{ key: 'b/office/idb/app/s/' + rowId(p[0]), value: null }]);
  assert.deepEqual(writesFor(st, 'office', { t: 'idb', op: 'clear', db: 'app', store: 'rows' }, null).map((x) => x.value), [null, null]);
  const drop = writesFor(st, 'office', { t: 'idb', op: 'drop', db: 'app' });
  assert.equal(drop.length, 4, 'every row and the schema');
  assert.ok(drop.every((x) => x.value === null && x.key.startsWith('b/office/idb/app')));
  assert.deepEqual(writesFor(emptyStore(), 'office', { t: 'idb', op: 'drop', db: 'app' }), [], 'dropping what is not there writes nothing');
  assert.deepEqual(writesFor(st, 'crm', { t: 'idb', op: 'drop', db: 'app' }), [], 'one block cannot reach another\'s data');
});

test('messages that are not the bridge\'s, or not well formed, are no writes', async () => {
  const st = emptyStore();
  const p = await pair('k', 'v');
  for (const [block, m, t] of [
    ['Bad', { t: 'ls', op: 'set', k: 'a', v: 'b' }], ['crm', null], ['crm', 5], ['crm', { t: 'other' }],
    ['crm', { t: 'idb', op: 'put', db: 'a/b', store: 's' }, p], ['crm', { t: 'idb', op: 'put', db: '', store: 's' }, p],
    ['crm', { t: 'idb', op: 'put', db: 'd', store: 's/x' }, p], ['crm', { t: 'idb', op: 'put', db: 'd', store: 's' }, 'x'],
    ['crm', { t: 'idb', op: 'put', db: 'd', store: 's' }, [p[0]]], ['crm', { t: 'idb', op: 'nope', db: 'd', store: 's' }, p],
    ['crm', { t: 'idb', op: 'schema', db: 'd', version: 0, stores: [] }], ['crm', { t: 'idb', op: 'schema', db: 'd', version: 1, stores: 'x' }],
    ['crm', { t: 'idb', op: 'schema', db: 'd', version: 1, stores: [{ name: 'a/b', keyPath: null }] }], ['crm', { t: 'idb', op: 'schema', db: 'd', version: 1, stores: [{ name: 's', keyPath: 5 }] }],
    ['crm', { t: 'idb', op: 'schema', db: 'd', version: 1.5, stores: [] }], ['crm', { t: 'idb', op: 'schema', db: 'd', version: 1, stores: [null] }],
    ['crm', { t: 'idb', op: 'put', db: 'x'.repeat(MAX_NAME + 1), store: 's' }, p],
  ]) assert.deepEqual(writesFor(st, block, m, t), [], JSON.stringify(m));
  assert.equal(writesFor(st, 'crm', { t: 'idb', op: 'put', db: 'x'.repeat(MAX_NAME), store: 's' }, p).length, 1);
  assert.equal(writesFor(st, 'crm', { t: 'idb', op: 'schema', db: 'd', version: 1, stores: [] }).length, 1, 'a database with no stores yet');
  const cyc = []; cyc.push(cyc);
  assert.deepEqual(writesFor(st, 'crm', { t: 'idb', op: 'put', db: 'd', store: 's' }, [cyc, ['z']]), [], 'a key that is not JSON');
  assert.deepEqual(writesFor(st, 'crm', { get t() { throw new Error('x'); } }), []);
});

test('rowId: the tagged key, or a hash when long', () => {
  assert.equal(rowId(['s', 'k']), '["s","k"]');
  const long = ['s', 'x'.repeat(MAX_ROW_ID)];
  assert.match(rowId(long), /^h[0-9a-f]{64}$/);
  const edge = ['s', 'x'.repeat(MAX_ROW_ID - 8)];
  assert.equal(JSON.stringify(edge).length, MAX_ROW_ID);
  assert.equal(rowId(edge), JSON.stringify(edge), 'exactly MAX_ROW_ID characters stays as it is');
  assert.equal(rowId(undefined), null);
  assert.equal(rowId(() => 1), null);
});

test('seedOf: a block starts from exactly what it stored, and from nothing of another block\'s', async () => {
  let st = emptyStore();
  st = apply(st, writesFor(st, 'office', { t: 'ls', op: 'set', k: 'theme', v: 'dark' }));
  st = apply(st, writesFor(st, 'office', { t: 'idb', op: 'schema', db: 'app', version: 1, stores: [{ name: 's', keyPath: null }, { name: 'rows', keyPath: 'id' }] }));
  st = apply(st, writesFor(st, 'office', { t: 'idb', op: 'put', db: 'app', store: 's' }, await pair('state', { docs: ['a', 'b'], when: new Date(5) })));
  st = apply(st, writesFor(st, 'office', { t: 'idb', op: 'put', db: 'app', store: 'rows' }, await pair(7, { id: 7, blob: new Blob(['x']) })));
  st = apply(st, writesFor(st, 'crm', { t: 'ls', op: 'set', k: 'secret', v: 'crm only' }));
  const seed = untag(JSON.parse(JSON.stringify(seedOf(st, 'office'))));
  assert.deepEqual(seed.ls, [['theme', 'dark']]);
  assert.equal(seed.idb.length, 1);
  assert.equal(seed.idb[0].name, 'app');
  assert.equal(seed.idb[0].version, 1);
  assert.deepEqual(seed.idb[0].stores.map((s) => [s.name, s.keyPath, s.entries.length]), [['s', null, 1], ['rows', 'id', 1]]);
  const win = {}; bridge(win, () => {}, seed);
  const db = await new Promise((ok) => { const r = win.indexedDB.open('app', 1); r.onsuccess = (e) => ok(e.target.result); });
  const got = await new Promise((ok) => { const r = db.transaction('s').objectStore('s').get('state'); r.onsuccess = () => ok(r.result); });
  assert.deepEqual(got, { docs: ['a', 'b'], when: new Date(5) }, 'the block reads back exactly what it stored');
  const row = await new Promise((ok) => { const r = db.transaction('rows').objectStore('rows').get(7); r.onsuccess = () => ok(r.result); });
  assert.equal(await row.blob.text(), 'x', 'a Blob too');
  assert.equal(win.localStorage.getItem('theme'), 'dark');
  assert.equal(win.localStorage.getItem('secret'), null, 'nothing of the CRM\'s');
  const crm = untag(seedOf(st, 'crm'));
  assert.deepEqual(crm.ls, [['secret', 'crm only']]);
  assert.deepEqual(crm.idb, []);
  assert.deepEqual(untag(seedOf(st, 'Bad')), { ls: [], idb: [] });
  assert.deepEqual(untag(seedOf(null, 'office')), { ls: [], idb: [] });
});

test('seedOf skips what is not well formed', () => {
  let st = emptyStore();
  const put = (k, v) => { st = write(st, D, k, v).store; };
  put('b/x/ls/a', ['n', 5]);
  put('b/x/idb/bad', ['s', 'not a schema']);
  put('b/x/idb/nostores', ['o', [['version', ['n', 1]], ['stores', ['s', 'x']]]]);
  put('b/x/idb/ok', ['o', [['version', ['n', 1]], ['stores', ['a', [['o', [['name', ['n', 5]]]], ['o', [['name', ['s', 'r']], ['keyPath', ['z']]]]]]]]]);
  put('b/x/idb/ok/r/bad', ['s', 'not a row']);
  put('b/x/idb/ok/r/short', ['a', [['s', 'k']]]);
  put('b/x/idb/ok/r/good', ['a', [['s', 'k'], ['n', 1]]]);
  const seed = untag(seedOf(st, 'x'));
  assert.deepEqual(seed.ls, []);
  assert.deepEqual(seed.idb, [{ name: 'ok', version: 1, stores: [{ name: 'r', keyPath: null, entries: [['k', 1]] }] }]);
  assert.equal(read(st, 'b/x/idb/ok/r/good').versions, 1);
});

test('boundaries: a localStorage delete at the name limit; schemas that are not whole', async () => {
  const st = emptyStore();
  assert.equal(writesFor(st, 'crm', { t: 'ls', op: 'del', k: 'x'.repeat(MAX_NAME) }).length, 1);
  let s2 = emptyStore();
  const put = (k, v) => { s2 = write(s2, D, k, v).store; };
  const stores = ['a', [['o', [['name', ['s', 'r']], ['keyPath', ['z']]]]]];
  put('b/y/idb/badver', ['o', [['version', ['s', '1']], ['stores', stores]]]);
  put('b/y/idb/nover', ['o', [['stores', stores]]]);
  put('b/y/idb/arrstore', ['o', [['version', ['n', 1]], ['stores', ['a', [['a', [['name', ['s', 'q']]]]]]]]]);
  put('b/y/idb/okdb', ['o', [['version', ['n', 2]], ['stores', stores]]]);
  const seed = untag(seedOf(s2, 'y'));
  assert.deepEqual(seed.idb.map((d) => [d.name, d.stores.map((x) => x.name)]), [['arrstore', []], ['okdb', ['r']]], 'a version that is not a number, or missing, is skipped; a store that is a list is not a store');
});
