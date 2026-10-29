// test/hostile.mjs — the hostile-input battery every kernel is fuzzed with (claim G1: 2,000 inputs per exported function).
// witness's own battery first (null, NaN, BigInt, huge, circular, toxic getters …), then seeded garbage of every shape a
// caller could hand in: random bytes, strings, numbers, arrays, objects with random keys, nested mixes. Deterministic.
import { hostileInputs } from '../.witness/witness.mjs';

export const PER_FUNCTION = 2000;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function garbage(r, depth) {
  const k = Math.floor(r() * 11);
  if (k === 0) return Math.floor(r() * 2 ** 32) - 2 ** 31;
  if (k === 1) return [NaN, Infinity, -Infinity, -0, 1e308, 5e-324][Math.floor(r() * 6)];
  if (k === 2) return String.fromCharCode(...Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 0x2fff)));
  if (k === 3) return Uint8Array.from({ length: Math.floor(r() * 600) }, () => Math.floor(r() * 256));
  if (k === 4) return new Uint8Array(Math.floor(r() * 64));
  if (k === 5) return r() < 0.5;
  if (k === 6) return null;
  if (k === 7 || depth > 3) return 'x'.repeat(Math.floor(r() * 100));
  if (k === 8) return Array.from({ length: Math.floor(r() * 6) }, () => garbage(r, depth + 1));
  const o = {};
  for (let i = Math.floor(r() * 6); i > 0; i--) o[['id', 'v', 'kind', 'blocks', 'sha256', 'bytes', 'path', 'name', 'sig', '__proto__', 'constructor', String(i)][Math.floor(r() * 12)]] = garbage(r, depth + 1);
  return o;
}

/** 2,000 inputs: witness's battery, then seeded garbage. */
export function inputs(seed = 1) {
  const out = hostileInputs().map(([, v]) => v);
  const r = rng(seed);
  while (out.length < PER_FUNCTION) out.push(garbage(r, 0));
  return out;
}

/** Call fn with each input in each of its first `arity` positions (the rest garbage too). Returns the inputs that threw. */
export async function throwsOn(fn, arity = Math.max(1, fn.length)) {
  const xs = inputs(arity * 7 + 3);
  const bad = [];
  for (let i = 0; i < xs.length; i++) {
    const args = Array.from({ length: arity }, (_, j) => xs[(i + j * 131) % xs.length]);
    try { await fn(...args); } catch (e) { bad.push({ i, error: String(e && e.message || e).slice(0, 80) }); }
  }
  return bad;
}
