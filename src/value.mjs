// ════════════════════════════════════════════════════════════════
// src/value.mjs — what a block stores, as plain JSON the office can keep, back up and sync. Organ 3 of the seed laptop.
//
// Blocks store whatever IndexedDB takes: objects, lists, text, numbers (NaN, -0 and the infinities too), dates, raw
// bytes, typed arrays, blobs, maps and sets. The office's store (src/store.mjs), the vault (claim L4) and the sync
// (claim L5) keep JSON, so every value crosses as a tagged list:
//   ['z'] null · ['u'] undefined · ['b', true] · ['s', text] · ['n', number] · ['n', 'NaN' | 'Infinity' | '-Infinity' | '-0']
//   ['d', ms] a date · ['ab', base64] an ArrayBuffer · ['ta', 'Uint8Array', base64] a typed array (any kind)
//   ['blob', type, base64] a Blob · ['a', [items]] a list · ['o', [[key, item]]] an object · ['map', [[k, v]]] · ['set', [items]]
// One spelling per value, so equal values tag equally (the vault's byte-identical restore depends on it).
//
//   tag(v)   → Promise<{ ok, t } | { ok: false, why }>   async only because a Blob's bytes are read asynchronously.
//              A cycle, a function, a symbol or anything structuredClone would refuse is refused by name.
//   untag(t) → the value, or undefined for anything that is not a tagged value. Self-contained: src/compose.mjs inlines
//              its source into each block, which untags the state it starts with.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const MAX_DEPTH = 64;
const TYPED = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];

export function toB64(u8) {
  if (!(ArrayBuffer.isView(u8) && u8 instanceof Uint8Array)) return null;
  let s = '';
  const chunks = Math.ceil(u8.length / 0x8000);
  for (let k = 0; k !== chunks; k++) s += String.fromCharCode.apply(null, u8.subarray(k * 0x8000, (k + 1) * 0x8000));
  return btoa(s);
}

async function walk(v, depth, seen) {
  if (v === null) return ['z'];
  if (v === undefined) return ['u'];
  const ty = typeof v;
  if (ty === 'boolean') return ['b', v];
  if (ty === 'string') return ['s', v];
  if (ty === 'number') return Number.isNaN(v) ? ['n', 'NaN'] : v === Infinity ? ['n', 'Infinity'] : v === -Infinity ? ['n', '-Infinity'] : Object.is(v, -0) ? ['n', '-0'] : ['n', v];
  if (ty !== 'object') throw new Error('a ' + ty + ' cannot be stored');
  if (depth >= MAX_DEPTH) throw new Error('nested deeper than ' + MAX_DEPTH);
  if (seen.has(v)) throw new Error('a value that contains itself cannot be stored');
  seen.add(v);
  let out;
  if (v instanceof Date) out = ['d', v.getTime()];
  else if (v instanceof ArrayBuffer) out = ['ab', toB64(new Uint8Array(v))];
  else if (ArrayBuffer.isView(v) && TYPED.includes(v.constructor.name)) out = ['ta', v.constructor.name, toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))];
  else if (typeof Blob === 'function' && v instanceof Blob) out = ['blob', v.type, toB64(new Uint8Array(await v.arrayBuffer()))];
  else if (Array.isArray(v)) { out = ['a', []]; for (const x of v) out[1].push(await walk(x, depth + 1, seen)); }
  else if (v instanceof Map) { out = ['map', []]; for (const [k, x] of v) out[1].push([await walk(k, depth + 1, seen), await walk(x, depth + 1, seen)]); }
  else if (v instanceof Set) { out = ['set', []]; for (const x of v) out[1].push(await walk(x, depth + 1, seen)); }
  else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) { out = ['o', []]; for (const k of Object.keys(v)) out[1].push([k, await walk(v[k], depth + 1, seen)]); }
  else throw new Error('a ' + (v.constructor && v.constructor.name) + ' cannot be stored');
  seen.delete(v);
  return out;
}

export async function tag(v) {
  try { return { ok: true, t: await walk(v, 0, new Set()) }; } catch (e) { return { ok: false, why: e instanceof Error ? e.message : 'the value cannot be stored' }; }
}

export function untag(t) {
  const bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  const NUM = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };
  const TYPES = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
  function go(x, depth) {
    if (!Array.isArray(x) || depth > 64) throw 0;
    const p = x[1];
    switch (x[0]) {
      case 'z': return null;
      case 'u': return undefined;
      case 'b': if (typeof p !== 'boolean') throw 0; return p;
      case 's': if (typeof p !== 'string') throw 0; return p;
      case 'n': if (typeof p === 'number') return p; if (Object.prototype.hasOwnProperty.call(NUM, p)) return NUM[p]; throw 0;
      case 'd': if (typeof p !== 'number') throw 0; return new Date(p);
      case 'ab': return bytes(p).buffer;
      case 'ta': { if (!TYPES.includes(p)) throw 0; const u = bytes(x[2]), size = globalThis[p].BYTES_PER_ELEMENT; if (u.byteLength % size !== 0) throw 0; return new globalThis[p](u.buffer, 0, u.byteLength / size); }
      case 'blob': if (typeof p !== 'string') throw 0; return new Blob([bytes(x[2])], { type: p });
      case 'a': if (!Array.isArray(p)) throw 0; return p.map((y) => go(y, depth + 1));
      case 'o': { if (!Array.isArray(p)) throw 0; const o = {}; for (const [k, y] of p) { if (typeof k !== 'string') throw 0; Object.defineProperty(o, k, { value: go(y, depth + 1), enumerable: true, writable: true, configurable: true }); } return o; }
      case 'map': if (!Array.isArray(p)) throw 0; return new Map(p.map(([k, y]) => [go(k, depth + 1), go(y, depth + 1)]));
      case 'set': if (!Array.isArray(p)) throw 0; return new Set(p.map((y) => go(y, depth + 1)));
      default: throw 0;
    }
  }
  try { return go(t, 0); } catch (e) { return undefined; }
}
