// ════════════════════════════════════════════════════════════════
// src/office.mjs — where each block's data lives in the one store, and how a block starts from it. Organ 3 of the
// seed laptop (claim L1b; the store it fills is what claims L4 and L5 restore and sync).
//
// Every block's localStorage and IndexedDB (src/prologue.mjs reports each change) becomes keys of the store
// (src/store.mjs), under the block's own id, so no block can reach another's data:
//   b/<block>/ls/<key>                         a localStorage item           → ['s', text]
//   b/<block>/idb/<db>                         a database's schema           → tagged { version, stores: [{ name, keyPath }] }
//   b/<block>/idb/<db>/<store>/<row id>        one row                       → tagged [key, value]
// <row id> is the row's key as tagged JSON, or 'h' + its SHA-256 when that is long.
//
//   writesFor(store, block, message, tagged)  → [{ key, value }]   the store writes one bridge message means
//        (tagged = the message's value, already tagged by src/value.mjs; a clear or a dropped database deletes every
//         key under it; a message that is not one of the bridge's is no writes)
//   seedOf(store, block)                      → the block's starting state, tagged, for src/compose.mjs
//   rowId(taggedKey)                          → the row id
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { read, keysOf } from './store.mjs';

export const ID = /^[a-z][a-z0-9-]{0,23}$/;
export const MAX_NAME = 120, MAX_ROW_ID = 200;
const enc = new TextEncoder();
const name = (s) => typeof s === 'string' && s.length >= 1 && s.length <= MAX_NAME && !s.includes('/');

export function rowId(taggedKey) {
  let j;
  try { j = JSON.stringify(taggedKey); } catch { return null; }
  if (typeof j !== 'string') return null;
  return j.length <= MAX_ROW_ID ? j : 'h' + hex(sha256(enc.encode(j)));
}

const under = (store, prefix) => keysOf(store, prefix).map((key) => ({ key, value: null }));

export function writesFor(store, block, m, tagged) {
  try {
    if (!ID.test(block)) return [];   // anything that is not a message reads no field below, and is no writes
    const b = 'b/' + block + '/';
    if (m.t === 'ls') {
      if (m.op === 'set' && typeof m.k === 'string' && m.k.length <= MAX_NAME && typeof m.v === 'string') return [{ key: b + 'ls/' + m.k, value: ['s', m.v] }];
      if (m.op === 'del' && typeof m.k === 'string' && m.k.length <= MAX_NAME) return [{ key: b + 'ls/' + m.k, value: null }];
      if (m.op === 'clear') return under(store, b + 'ls/');
      return [];
    }
    if (m.t !== 'idb' || !name(m.db)) return [];
    const db = b + 'idb/' + m.db;
    if (m.op === 'schema') {
      if (!Number.isSafeInteger(m.version) || m.version < 1 || !Array.isArray(m.stores) || !m.stores.every((x) => x && name(x.name) && (x.keyPath === null || typeof x.keyPath === 'string'))) return [];
      return [{ key: db, value: ['o', [['version', ['n', m.version]], ['stores', ['a', m.stores.map((x) => ['o', [['name', ['s', x.name]], ['keyPath', x.keyPath === null ? ['z'] : ['s', x.keyPath]]]])]]]] }];
    }
    if (m.op === 'drop') return [...under(store, db + '/'), ...(read(store, db).value === null ? [] : [{ key: db, value: null }])];
    if (!name(m.store)) return [];
    const rows = db + '/' + m.store + '/';
    if (m.op === 'clear') return under(store, rows);
    if (!Array.isArray(tagged) || tagged.length !== 2) return [];
    const id = rowId(tagged[0]);
    if (id === null) return [];
    if (m.op === 'put') return [{ key: rows + id, value: ['a', tagged] }];
    if (m.op === 'del') return [{ key: rows + id, value: null }];
    return [];
  } catch { return []; }
}

const field = (t, k) => (Array.isArray(t) && t[0] === 'o' && Array.isArray(t[1]) ? (t[1].find((p) => Array.isArray(p) && p[0] === k) || [])[1] : undefined);

export function seedOf(store, block) {
  const ls = [], dbs = [];
  if (typeof block === 'string' && ID.test(block)) {
    const b = 'b/' + block + '/';
    for (const key of keysOf(store, b + 'ls/')) {
      const v = read(store, key).value;
      if (Array.isArray(v) && v[0] === 's') ls.push(['a', [['s', key.slice(b.length + 3)], v]]);
    }
    for (const key of keysOf(store, b + 'idb/')) {
      const rest = key.slice(b.length + 4);
      if (rest.includes('/')) continue;
      const schema = read(store, key).value;
      const version = field(schema, 'version'), list = field(schema, 'stores');
      if (!Array.isArray(version) || version[0] !== 'n' || !Array.isArray(list) || list[0] !== 'a') continue;
      const stores = [];
      for (const st of list[1]) {
        const sn = field(st, 'name');
        if (!Array.isArray(sn) || sn[0] !== 's') continue;
        const entries = [];
        for (const rk of keysOf(store, key + '/' + sn[1] + '/')) {
          const row = read(store, rk).value;
          if (Array.isArray(row) && row[0] === 'a' && Array.isArray(row[1]) && row[1].length === 2) entries.push(['a', row[1]]);
        }
        stores.push(['o', [['name', sn], ['keyPath', field(st, 'keyPath') || ['z']], ['entries', ['a', entries]]]]);
      }
      dbs.push(['o', [['name', ['s', rest]], ['version', version], ['stores', ['a', stores]]]]);
    }
  }
  return ['o', [['ls', ['a', ls]], ['idb', ['a', dbs]]]];
}
