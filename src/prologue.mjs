// ════════════════════════════════════════════════════════════════
// src/prologue.mjs — the bridge every block runs first. Organ 3 of the seed laptop (claim L1b; the store behind it is
// what claims L4 and L5 restore and sync).
//
// A block is estate gear that runs as its repo shipped it, but inside the office it lives in a sandbox with an opaque
// origin (src/compose.mjs gives the frame its policy): no network, no cookies, no storage of its own, no way into the
// office page. Blocks keep their data in localStorage and IndexedDB, so this prologue gives the block both, in memory,
// seeded with what the office stored for it, and tells the office every change, which keeps it in the one store
// (src/store.mjs) the vault backs up and the devices sync.
//
//   bridge(win, out, seed) — install on win: localStorage, sessionStorage (memory only, as a tab's would be) and the
//   part of IndexedDB the estate's blocks use: open (with upgradeneeded), objectStoreNames.contains,
//   createObjectStore (with or without keyPath), deleteObjectStore, transaction → objectStore → get / getAll / put /
//   add / delete / clear / count, each request firing success or error, the transaction firing complete after its
//   last request. Values are copied in and out (structuredClone), keys compare as IndexedDB orders them (numbers,
//   then strings, then arrays). out(message) is called once per change:
//      { t: 'ls', op: 'set', k, v } · { t: 'ls', op: 'del', k } · { t: 'ls', op: 'clear' }
//      { t: 'idb', op: 'put', db, store, key, value } · { t: 'idb', op: 'del', db, store, key } · { t: 'idb', op: 'clear', db, store }
//      { t: 'idb', op: 'schema', db, version, stores: [{ name, keyPath }] } (after an upgrade) · { t: 'idb', op: 'drop', db }
//   seed = { ls: [[k, v]], idb: [{ name, version, stores: [{ name, keyPath, entries: [[key, value]] }] }] }
//   Returns { ls, idb } (the in-memory state, for tests).
//
// The function is self-contained (it touches nothing outside its arguments and the platform's structuredClone and
// setTimeout) because src/compose.mjs inlines its source text into the block's page.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export function bridge(win, out, seed) {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (v) => structuredClone(v);
  const later = (fn) => setTimeout(fn, 0);
  const send = (m) => { try { out(m); } catch (e) { /* the office is gone; the block carries on in memory */ } };
  const s = seed && typeof seed === 'object' ? seed : {};

  // ── localStorage / sessionStorage ──
  function makeStorage(name, initial, report) {
    const m = new Map();
    for (const [k, v] of Array.isArray(initial) ? initial : []) m.set(String(k), String(v));
    const api = {
      getItem: (k) => { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: (k, v) => { k = String(k); v = String(v); m.set(k, v); if (report) send({ t: 'ls', op: 'set', k, v }); },
      removeItem: (k) => { k = String(k); if (m.delete(k) && report) send({ t: 'ls', op: 'del', k }); },
      clear: () => { m.clear(); if (report) send({ t: 'ls', op: 'clear' }); },
      key: (i) => { const ks = [...m.keys()]; return Number.isInteger(i) && i >= 0 && i < ks.length ? ks[i] : null; },
    };
    Object.defineProperty(api, 'length', { get: () => m.size, configurable: true });
    // property access reaches the same map, as it does in a browser: reading a method's name gives the method, but
    // assigning or deleting any name (even a method's) stores or removes an item of that name
    const p = new Proxy(api, {
      get: (t, k) => (typeof k === 'string' && !own(t, k) ? api.getItem(k) : t[k]),
      set: (t, k, v) => { if (typeof k === 'string') api.setItem(k, v); return true; },
      deleteProperty: (t, k) => { if (typeof k === 'string') api.removeItem(k); return true; },
      has: (t, k) => own(t, k) || (typeof k === 'string' && m.has(k)),
      ownKeys: () => [...m.keys()],
      getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && m.has(k) ? { value: m.get(k), enumerable: true, configurable: true, writable: true } : undefined),
    });
    void name;
    return { p, m };
  }

  // ── IndexedDB (the part the blocks use) ──
  const rank = (k) => (typeof k === 'number' ? 1 : k instanceof Date ? 2 : typeof k === 'string' ? 3 : Array.isArray(k) ? 5 : 9);
  function cmp(a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return Math.sign(ra - rb);
    if (ra === 5) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmp(a[i], b[i]); if (c) return c; }
      return Math.sign(a.length - b.length);
    }
    const x = ra === 2 ? a.getTime() : a, y = ra === 2 ? b.getTime() : b;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const validKey = (k) => rank(k) < 9 && !(typeof k === 'number' && Number.isNaN(k)) && (!Array.isArray(k) || k.every(validKey));
  const keyId = (k) => JSON.stringify([rank(k), k instanceof Date ? k.getTime() : k]);

  const dbs = new Map();   // name → { version, stores: Map(name → { keyPath, rows: Map(keyId → [key, value]) }) }
  for (const d of Array.isArray(s.idb) ? s.idb : []) {
    const stores = new Map();
    for (const st of Array.isArray(d.stores) ? d.stores : []) {
      const rows = new Map();
      for (const [k, v] of Array.isArray(st.entries) ? st.entries : []) rows.set(keyId(k), [k, v]);
      stores.set(String(st.name), { keyPath: st.keyPath == null ? null : String(st.keyPath), rows });
    }
    dbs.set(String(d.name), { version: Number(d.version) || 1, stores });
  }

  function makeRequest(source) {
    const r = { result: undefined, error: null, readyState: 'pending', source, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, _l: {} };
    r.addEventListener = (type, fn) => { (r._l[type] = r._l[type] || []).push(fn); };
    r.removeEventListener = (type, fn) => { r._l[type] = (r._l[type] || []).filter((f) => f !== fn); };
    r._fire = (type) => {
      const ev = { type, target: r, currentTarget: r, preventDefault() {}, stopPropagation() {} };
      if (typeof r['on' + type] === 'function') r['on' + type](ev);
      for (const fn of r._l[type] || []) fn(ev);
    };
    return r;
  }

  function storeNamesOf(map) {
    const names = () => [...map.keys()].sort();
    return { contains: (n) => map.has(String(n)), item: (i) => names()[i] ?? null, get length() { return map.size; }, [Symbol.iterator]: () => names()[Symbol.iterator]() };
  }

  function makeTx(dbName, db, names, mode) {
    const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null, _l: {}, _pending: 0, _done: false };
    tx.db = undefined;
    tx.addEventListener = (type, fn) => { (tx._l[type] = tx._l[type] || []).push(fn); };
    tx._fire = (type) => {
      const ev = { type, target: tx, currentTarget: tx };
      if (typeof tx['on' + type] === 'function') tx['on' + type](ev);
      for (const fn of tx._l[type] || []) fn(ev);
    };
    const settle = () => later(() => { if (tx._pending === 0 && !tx._done) { tx._done = true; tx._fire('complete'); } });
    function run(op) {
      const req = makeRequest(null);
      tx._pending++;
      later(() => {
        try { req.result = op(); req.readyState = 'done'; req._fire('success'); }
        catch (e) { req.error = e; req.readyState = 'done'; req._fire('error'); tx.error = e; tx._fire('error'); }
        tx._pending--;
        settle();
      });
      return req;
    }
    const writable = () => { if (mode !== 'readwrite' && mode !== 'versionchange') throw new Error('ReadOnlyError: this transaction is read-only'); };
    tx.objectStore = (name) => {
      name = String(name);
      if (!names.includes(name) || !db.stores.has(name)) throw new Error('NotFoundError: no object store named ' + name + ' in this transaction');
      const st = db.stores.get(name);
      const keyOf = (value, key) => {
        const k = st.keyPath === null ? key : value == null ? undefined : value[st.keyPath];
        if (!validKey(k)) throw new Error('DataError: not a valid key');
        return k;
      };
      return {
        name, keyPath: st.keyPath,
        get: (k) => run(() => { const row = st.rows.get(keyId(k)); return row ? clone(row[1]) : undefined; }),
        getAll: () => run(() => [...st.rows.values()].sort((a, b) => cmp(a[0], b[0])).map((r) => clone(r[1]))),
        getAllKeys: () => run(() => [...st.rows.values()].map((r) => r[0]).sort(cmp)),
        count: () => run(() => st.rows.size),
        // as in IndexedDB: a read-only transaction, a bad key or a value that cannot be copied throws at the call,
        // and the value is copied at the call (a later change to the object does not reach the store)
        put: (value, key) => { writable(); const k = keyOf(value, key), v = clone(value); return run(() => { st.rows.set(keyId(k), [k, v]); send({ t: 'idb', op: 'put', db: dbName, store: name, key: k, value: v }); return k; }); },
        add: (value, key) => { writable(); const k = keyOf(value, key), v = clone(value); return run(() => { if (st.rows.has(keyId(k))) throw new Error('ConstraintError: the key already exists'); st.rows.set(keyId(k), [k, v]); send({ t: 'idb', op: 'put', db: dbName, store: name, key: k, value: v }); return k; }); },
        delete: (k) => { writable(); return run(() => { if (st.rows.delete(keyId(k))) send({ t: 'idb', op: 'del', db: dbName, store: name, key: k }); return undefined; }); },
        clear: () => { writable(); return run(() => { st.rows.clear(); send({ t: 'idb', op: 'clear', db: dbName, store: name }); return undefined; }); },
      };
    };
    tx.abort = () => { tx._done = true; tx._fire('abort'); };
    settle();
    return tx;
  }

  function makeDb(name, db) {
    return {
      name,
      get version() { return db.version; },
      objectStoreNames: storeNamesOf(db.stores),
      createObjectStore: (n, opts) => {
        n = String(n);
        if (db.stores.has(n)) throw new Error('ConstraintError: an object store named ' + n + ' exists');
        const keyPath = opts && opts.keyPath != null ? String(opts.keyPath) : null;
        db.stores.set(n, { keyPath, rows: new Map() });
        return { name: n, keyPath, createIndex: () => ({}) };
      },
      deleteObjectStore: (n) => { db.stores.delete(String(n)); },
      transaction: (names, mode) => makeTx(name, db, (Array.isArray(names) ? names : [names]).map(String), mode === 'readwrite' ? 'readwrite' : 'readonly'),
      close: () => {},
      addEventListener: () => {},
      onversionchange: null,
    };
  }

  const indexedDB = {
    open(name, version) {
      name = String(name);
      const req = makeRequest(null);
      later(() => {
        let db = dbs.get(name);
        const want = version === undefined ? (db ? db.version : 1) : Number(version);
        if (!Number.isInteger(want) || want < 1) { req.error = new Error('TypeError: a version is a whole number from 1'); req._fire('error'); return; }
        if (db && want < db.version) { req.error = new Error('VersionError: the database is at a higher version'); req._fire('error'); return; }
        const upgrade = !db || want > db.version;
        if (!db) { db = { version: want, stores: new Map() }; dbs.set(name, db); }
        db.version = want;
        const handle = makeDb(name, db);
        req.result = handle;
        if (upgrade) {
          req.transaction = makeTx(name, db, [...db.stores.keys()], 'versionchange');
          req._fire('upgradeneeded');
          send({ t: 'idb', op: 'schema', db: name, version: db.version, stores: [...db.stores.entries()].map(([n, st]) => ({ name: n, keyPath: st.keyPath })) });
        }
        req.readyState = 'done';
        req._fire('success');
      });
      return req;
    },
    deleteDatabase(name) {
      const req = makeRequest(null);
      later(() => { dbs.delete(String(name)); send({ t: 'idb', op: 'drop', db: String(name) }); req._fire('success'); });
      return req;
    },
    databases: () => Promise.resolve([...dbs.entries()].map(([name, d]) => ({ name, version: d.version }))),
    cmp,
  };

  const ls = makeStorage('localStorage', s.ls, true);
  const ss = makeStorage('sessionStorage', [], false);
  for (const [k, v] of [['localStorage', ls.p], ['sessionStorage', ss.p], ['indexedDB', indexedDB]]) {
    try { Object.defineProperty(win, k, { value: v, configurable: true, writable: true }); } catch (e) { send({ t: 'err', where: k }); }
  }
  return { ls: ls.m, idb: dbs };
}
