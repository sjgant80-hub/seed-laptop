// ════════════════════════════════════════════════════════════════
// src/store.mjs — the office's one store: everything every block keeps, every file that came in at the edges, every
// receipt. What the vault backs up (claim L4) and the devices sync (claim L5). Organ 3 of the seed laptop.
//
// A multi-value register per key, the classic CRDT for "nothing is lost": each write is stamped with a dot (the device
// that made it and that device's counter) and the context it was made in (the dots of the versions its writer had
// seen for that key). A version is replaced only by a write that saw it. Two writes neither of which saw the other
// are BOTH kept: one is shown (the larger dot, the same choice on every device), the other is kept as a conflict copy
// until a later write that sees both replaces them. A delete is a version too (a tombstone), so deletes converge.
//
//   emptyStore()                    → { kind, v, clock: {}, keys: {} }   plain JSON; every function returns a new store
//   write(store, device, key, value)→ { ok, store, op } | { ok: false, why }   value = tagged JSON (src/value.mjs) or null
//   apply(store, op)                → { ok, store, changed } | refusal   a version from another device; idempotent
//   merge(a, b)                     → { ok, store }    every version of b applied to a: commutative, associative, idempotent
//   read(store, key)                → { value, conflicts, versions }   value null when absent or deleted
//   keysOf(store, prefix)           → the live keys under a prefix, sorted
//   opsSince(store, clock)          → every version a device that has seen `clock` has not
//   digest(store)                   → SHA-256 of its one canonical form: equal stores have equal digests
//   lost(ops, store)                → the ops neither kept nor seen by a version kept (claim L5: must be none)
//
// Originals are read-only: a key 'file/<sha256>' takes only bytes (['ab', base64]) whose SHA-256 is that name, and only
// once. Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';

export const KIND = 'seed-laptop.store', MAX_KEY = 512, MAX_VALUE = 32 << 20;
export const DEVICE = /^[0-9a-f]{8,64}$/;
const enc = new TextEncoder();
const no = (why) => ({ ok: false, why });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function emptyStore() { return { kind: KIND, v: 1, clock: {}, keys: {} }; }

function canonAt(x, depth) {
  if (depth > 80) return null;
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return JSON.stringify(x);
  if (typeof x === 'number') return Number.isFinite(x) && !Object.is(x, -0) ? JSON.stringify(x) : null;
  if (Array.isArray(x)) { const p = x.map((y) => canonAt(y, depth + 1)); return p.includes(null) ? null : '[' + p.join(',') + ']'; }
  if (!isObj(x) || Object.getPrototypeOf(x) !== Object.prototype) return null;
  const p = Object.keys(x).sort().map((k) => [k, canonAt(x[k], depth + 1)]);
  return p.some(([, v]) => v === null) ? null : '{' + p.map(([k, v]) => JSON.stringify(k) + ':' + v).join(',') + '}';
}

/** Canonical JSON for store contents: sorted keys, finite numbers only. null if x cannot be said. */
export function canon(x) {
  try { return canonAt(x, 0); } catch { return null; }
}

/** The light check every call makes on a store this office made (the full one, validStore, is for stores from outside). */
export function isStore(s) {
  try { return isObj(s) && s.kind === KIND && s.v === 1 && isObj(s.clock) && isObj(s.keys); } catch { return false; }
}

export function validStore(s) {
  try {
    if (!isStore(s)) return false;
    for (const [d, n] of Object.entries(s.clock)) if (!DEVICE.test(d) || !Number.isSafeInteger(n) || n < 1) return false;
    for (const [k, vs] of Object.entries(s.keys)) {
      if (k.length < 1 || k.length > MAX_KEY || !Array.isArray(vs) || vs.length < 1) return false;
      for (const x of vs) if (!validVersion(x)) return false;
    }
    return canon(s) !== null;
  } catch { return false; }
}

function validCtx(c) {
  return isObj(c) && Object.entries(c).every(([d, n]) => DEVICE.test(d) && Number.isSafeInteger(n) && n >= 1);
}
function validVersion(x) {
  return isObj(x) && Object.keys(x).sort().join(',') === 'ctx,d,n,v' && DEVICE.test(x.d) && Number.isSafeInteger(x.n) && x.n >= 1 && validCtx(x.ctx) && (x.v === null || Array.isArray(x.v));
}

const seen = (ctx, d, n) => own(ctx, d) && ctx[d] >= n;
/** The version shown among concurrent ones: the larger counter, then the larger device. The same on every device. */
export function bigger(a, b) {
  try { return a.n > b.n || (a.n === b.n && a.d > b.d); } catch { return false; }
}
/** Versions in their one order: by device, then counter (as fixed-width text, sorted the one way JavaScript sorts text). */
const ordered = (vs) => { const by = new Map(vs.map((x) => [x.d + ':' + String(x.n).padStart(16, '0'), x])); return [...by.keys()].sort().map((k) => by.get(k)); };
const at = (c, d) => (own(c, d) ? c[d] : 0);

/** The rules every value meets, written here or arriving from another device. Originals: bytes named by their hash. */
export function valueOk(key, value) {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY) return no('a key is 1 to ' + MAX_KEY + ' characters');
  if (value !== null && !Array.isArray(value)) return no('a value is tagged JSON, or null to delete');
  const c = value === null ? 'null' : canon(value);
  if (c === null) return no('a value is plain JSON');
  if (c.length > MAX_VALUE) return no('a value is at most ' + MAX_VALUE + ' characters');
  if (key.startsWith('file/')) {
    let bytes = null;
    try { if (value[0] === 'ab' && typeof value[1] === 'string' && value.length === 2) bytes = Uint8Array.from(atob(value[1]), (ch) => ch.charCodeAt(0)); } catch { bytes = null; }
    if (bytes === null || 'file/' + hex(sha256(bytes)) !== key) return no('an original is kept under the SHA-256 of its bytes');
  }
  return { ok: true, c };
}

/** A local write: the value rules, and an original is written once (read-only after). */
export function admits(store, key, value) {
  if (typeof key === 'string' && key.startsWith('file/') && own(store.keys, key)) return no('an original is read-only: ' + key + ' is already kept');
  const v = valueOk(key, value);
  return v.ok ? { ok: true } : v;
}

export function write(store, device, key, value) {
  if (!isStore(store)) return no('not a store');
  if (typeof device !== 'string' || !DEVICE.test(device)) return no('a device is named by its key, in hex');
  const a = admits(store, key, value);
  if (!a.ok) return a;
  const n = (own(store.clock, device) ? store.clock[device] : 0) + 1;
  const ctx = {};
  for (const x of own(store.keys, key) ? store.keys[key] : []) {
    for (const [d, m] of [[x.d, x.n], ...Object.entries(x.ctx)]) ctx[d] = Math.max(at(ctx, d), m);
  }
  // structural sharing: versions are never changed once made, so a new store shares every key it did not write
  const next = { ...store, clock: { ...store.clock, [device]: n }, keys: { ...store.keys, [key]: [{ d: device, n, ctx, v: value }] } };
  return { ok: true, store: next, op: { key, d: device, n, ctx: { ...ctx }, v: value } };
}

export function apply(store, op) {
  if (!isStore(store)) return no('not a store');
  if (!isObj(op) || typeof op.key !== 'string') return no('an op names its key');
  if (!validVersion({ d: op.d, n: op.n, ctx: op.ctx, v: op.v })) return no('an op is a version: device, counter, context, value');
  const v = valueOk(op.key, op.v);   // a version from another device meets the same rules as one written here
  if (!v.ok) return v;
  const have = own(store.keys, op.key) ? store.keys[op.key] : [];
  if (op.key.startsWith('file/') && have.some((x) => canon(x.v) !== v.c)) return no('an original cannot change: ' + op.key + ' arrived with other bytes');
  const changed = !have.some((x) => (x.d === op.d && x.n === op.n) || seen(x.ctx, op.d, op.n));
  const clock = { ...store.clock, [op.d]: Math.max(at(store.clock, op.d), op.n) };
  const keys = changed ? { ...store.keys, [op.key]: ordered([...have.filter((x) => !seen(op.ctx, x.d, x.n)), { d: op.d, n: op.n, ctx: { ...op.ctx }, v: op.v }]) } : store.keys;
  return { ok: true, store: { ...store, clock, keys }, changed };
}

export function opsSince(store, clock) {
  if (!isStore(store)) return [];
  const c = isObj(clock) ? clock : {};
  const out = [];
  for (const k of Object.keys(store.keys).sort()) for (const x of store.keys[k]) if (!seen(c, x.d, x.n)) out.push({ key: k, d: x.d, n: x.n, ctx: { ...x.ctx }, v: x.v });
  return out;
}

export function merge(a, b) {
  if (!isStore(a) || !validStore(b)) return no('not a store');
  let s = a;
  for (const op of opsSince(b, {})) {
    const r = apply(s, op);
    if (!r.ok) return r;
    s = r.store;
  }
  const clock = { ...s.clock };
  for (const [d, n] of Object.entries(b.clock)) clock[d] = Math.max(at(clock, d), n);
  return { ok: true, store: { ...s, clock } };
}

export function read(store, key) {
  const vs = isStore(store) && typeof key === 'string' && own(store.keys, key) ? store.keys[key] : [];
  if (!vs.length) return { value: null, conflicts: [], versions: 0 };
  const win = vs.reduce((w, x) => (bigger(x, w) ? x : w));
  return { value: win.v, conflicts: vs.filter((x) => x !== win && x.v !== null).map((x) => x.v), versions: vs.length };
}

export function keysOf(store, prefix) {
  if (!isStore(store)) return [];
  const p = typeof prefix === 'string' ? prefix : '';
  return Object.keys(store.keys).filter((k) => k.startsWith(p) && read(store, k).value !== null).sort();
}

export function digest(store) {
  const c = validStore(store) ? canon(store) : null;
  return c === null ? null : hex(sha256(enc.encode(c)));
}

export function lost(ops, store) {
  if (!Array.isArray(ops) || !isStore(store)) return null;
  return ops.filter((op) => {
    const vs = isObj(op) && typeof op.key === 'string' && own(store.keys, op.key) ? store.keys[op.key] : [];
    return !vs.some((x) => (x.d === op.d && x.n === op.n) || seen(x.ctx, op.d, op.n));
  });
}
