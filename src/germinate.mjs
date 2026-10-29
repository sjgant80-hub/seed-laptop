// ════════════════════════════════════════════════════════════════
// src/germinate.mjs — a seed grows the office. Organ 2 of the seed laptop (claims L1a, L1c, L1d).
//
// The flow of the spec, in order, each step refusing before the next can start:
//   1. read the seed     a full seed (src/bundle.mjs: the genome and every block in one file, no network), or a light
//                        seed (the genome alone, each block fetched by its SHA-256 from the owner's own mirror)
//   2. verify the genome src/genome.mjs: canonical, signed by a key this runtime pins; nothing in it is used before
//   3. every block file  its length and its SHA-256 must equal the genome's pin. One wrong byte anywhere refuses the
//                        whole seed: there is no partial office
//   4. compose           the office manifest: the blocks, their files and pins, the config, the genome's id; and its
//                        digest, the same on every machine that grows the same seed
//   5. first run         the owner's identity is grown from the owner's phrase (the shared foundation's seed kernel,
//                        vendor/fall-kit-core/seed.mjs, so the same phrase grows the same owner on any machine), and Kar
//                        writes its first receipt
//
//   filesOf(body)                → [{ id, path, key, sha256, bytes }]   every block file the genome pins, in order
//   checkFile(pin, bytes)        → { ok } | { ok: false, why }         length, then SHA-256
//   manifestOf(genomeId, body)   → the office manifest (plain JSON)
//   germinate(seed, opts)        → { ok, genome, office, digest, files, owner, receipts, checked }
//                                | { ok: false, stage, why, checked }   stage 'seed' | 'genome' | 'block' | 'identity'
//       seed = { full: bytes } | { genome: text, fetch: async (sha256) → bytes | null }
//       opts = { pinned: [publisher key hex], phrase, at: ISO time of the run }
//   checked counts the block files verified before the outcome; a refused genome has checked 0 and fetched nothing.
// filesOf, checkFile and manifestOf are pure and total; germinate is glue over them, the genome, the bundle and the seed.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { open, canonical } from './genome.mjs';
import { readBundle, isBytes } from './bundle.mjs';
import { receipt } from './receipt.mjs';

export const OFFICE = 'seed-laptop.office', DEVICE = 'device';
// The foundation's seed signs a genesis for the owner's books; the office keeps no contribution economy, so every
// share in it is zero (the books are switched off, as everywhere in the estate).
export const POLICY = Object.freeze({ makerPpm: 0, lineagePpm: 0, earlyUntil: 0, earlyNum: 1, earlyDen: 1 });
const enc = new TextEncoder();
const refuse = (stage, why, checked) => ({ ok: false, stage, why, checked });

export function filesOf(body) {
  try {
    const out = [];
    for (const b of body.blocks) for (const f of b.files) out.push({ id: b.id, path: f.path, key: 'blocks/' + b.id + '/' + f.path, sha256: f.sha256, bytes: f.bytes });
    return out;
  } catch { return []; }
}

export function checkFile(pin, bytes) {
  if (!isBytes(bytes)) return { ok: false, why: 'missing' };
  try {
    if (bytes.length !== pin.bytes) return { ok: false, why: 'its length is not the length pinned' };
    if (hex(sha256(bytes)) !== pin.sha256) return { ok: false, why: 'its SHA-256 is not the one pinned' };
  } catch { return { ok: false, why: 'it has no pin' }; }
  return { ok: true };
}

export function manifestOf(genomeId, body) {
  try {
    return {
      kind: OFFICE, v: 1, genome: genomeId, name: body.name,
      blocks: body.blocks.map((b) => ({ id: b.id, name: b.name, from: b.from, entry: b.entry, files: b.files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })) })),
      config: body.config,
    };
  } catch { return null; }
}

export async function germinate(seed, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const s = seed && typeof seed === 'object' ? seed : {};
  let text, have = null;
  if (isBytes(s.full)) {
    const r = readBundle(s.full);
    if (!r.ok) return refuse('seed', r.why, 0);
    text = r.genome; have = r.files;
  } else if (typeof s.genome === 'string' && typeof s.fetch === 'function') {
    text = s.genome;
  } else return refuse('seed', 'a seed is a full seed, or a genome and a mirror to fetch its blocks from', 0);

  const g = await open(text, o.pinned);
  if (!g.ok) return refuse('genome', g.stage + ': ' + g.why, 0);

  const files = [];
  let checked = 0;
  for (const pin of filesOf(g.body)) {
    let bytes;
    if (have) bytes = have.get(pin.key);
    else { try { bytes = await s.fetch(pin.sha256); } catch { bytes = null; } }
    const c = checkFile(pin, bytes);
    if (!c.ok) return refuse('block', 'block ' + pin.id + ', file ' + pin.path + ': ' + c.why, checked);
    checked++;
    files.push({ path: pin.key, bytes });
  }
  if (have && have.size !== files.length) return refuse('block', 'the seed holds files its genome does not pin', checked);

  const planted = await plant(o.phrase, [DEVICE], { policy: { ...POLICY } });
  if (!planted.ok) return refuse('identity', planted.why, checked);
  const owner = planted.ids.founder.id;
  if (g.body.identity.founder !== null && g.body.identity.founder !== owner) return refuse('identity', 'this genome belongs to another owner, or the phrase is not theirs', checked);

  const office = manifestOf(g.id, g.body);
  const digest = hex(sha256(enc.encode(canonical(office))));
  const first = receipt('grew', { seed: g.body.name, genome: g.id, blocks: g.body.blocks.length, files: files.length, owner }, o.at);
  if (first === null) return refuse('identity', 'Kar could not write its first receipt (the run has no valid time)', checked);
  return { ok: true, genome: { id: g.id, by: g.by, name: g.body.name }, office, digest, files, owner: { id: owner, device: planted.ids[DEVICE].id }, receipts: [first], checked };
}
