// ════════════════════════════════════════════════════════════════
// src/bundle.mjs — the full seed: the genome and every block's bytes in one file, so a seed grows with no network at
// all. Organ 2 of the seed laptop (claims L1a, L1c).
//
//   'SLS1' · version 1 · a LIGHT vault (vendor/fall-kit-core/vendor/light/vault.mjs) holding
//      genome.json                    the signed genome, as text
//      blocks/<block id>/<file path>  each block file's bytes
//
// The bundle is transport, not trust: its LIGHT vault checks its own hashes, but the office trusts only the signed
// genome and the pins in it (src/germinate.mjs). Anyone can build a bundle; only the genome's signer can make one
// that grows.
//
//   makeBundle(genomeText, files)  → { ok, bytes } | refusal          files = [{ path: 'blocks/<id>/<path>', bytes }]
//   readBundle(bytes)              → { ok, genome, files: Map(path → bytes) } | { ok: false, stage, why }
//                                    stage 'size' → 'magic' → 'vault' → 'genome'
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { pack, unpack } from '../vendor/fall-kit-core/vendor/light/vault.mjs';

export const MAGIC = Object.freeze([0x53, 0x4c, 0x53, 0x31]);   // 'SLS1'
export const VERSION = 1, HEADER = 5, MAX_SEED = 64 << 20, GENOME = 'genome.json';
const enc = new TextEncoder();
const no = (why) => ({ ok: false, why });
/** Real bytes: a typed-array view (an object that only inherits from Uint8Array is not one). */
export const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;
const refuse = (stage, why) => ({ ok: false, stage, why });

export function makeBundle(genomeText, files) {
  if (typeof genomeText !== 'string' || genomeText.length < 1) return no('a bundle holds a genome');
  if (!Array.isArray(files)) return no('files is a list');
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || !f.path.startsWith('blocks/')) return no('every file in a bundle is under blocks/');
    if (!isBytes(f.bytes)) return no('every file in a bundle is bytes');
  }
  const p = pack([{ path: GENOME, bytes: enc.encode(genomeText) }, ...files], {});
  if (!p.ok) return p;
  const out = new Uint8Array(HEADER + p.bytes.length);
  out.set(MAGIC, 0); out[4] = VERSION; out.set(p.bytes, HEADER);
  return { ok: true, bytes: out };
}

export function readBundle(bytes) {
  if (!isBytes(bytes) || bytes.length <= HEADER || bytes.length > MAX_SEED) return refuse('size', 'a full seed is 6 bytes to ' + MAX_SEED + ' bytes');
  if (MAGIC.some((m, i) => bytes[i] !== m) || bytes[4] !== VERSION) return refuse('magic', 'this is not a seed-laptop full seed, version ' + VERSION);
  const u = unpack(bytes.subarray(HEADER), () => null, { max: MAX_SEED * 4 });
  if (!u.ok) return refuse('vault', u.why);
  const files = new Map();
  let genome = null;
  for (const e of u.entries) {
    if (e.path === GENOME) genome = e.bytes;
    else files.set(e.path, e.bytes);
  }
  if (genome === null) return refuse('genome', 'the seed holds no genome');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(genome); } catch { return refuse('genome', 'the genome is not UTF-8 text'); }
  return { ok: true, genome: text, files };
}
