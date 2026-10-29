// ════════════════════════════════════════════════════════════════
// src/genome.mjs — the seed's genome: which blocks to grow, each pinned by hash, the office's config, whose identity,
// which vault. Signed; refused if one bit of it changed. Organ 2 of the seed laptop (claims L1a, L1c, L1d).
//
// A genome is a short text, the canonical JSON (keys sorted, no spaces, integers only) of:
//   { body: { kind, v, name, blocks, config, identity, vault }, by: <signer's public key, hex>, sig: <base64url> }
// where sig is the signer's Ed25519 signature over 'seed-laptop.genome.v1\n' + canonical(body). A block is
//   { id, name, from, entry, files: [{ path, sha256, bytes }] }
// (from = the estate repo and commit its bytes were taken from; entry = the file the office opens). identity.founder
// is the owner's public key when the genome is the owner's own (null on a stock seed, which grows a new owner);
// vault.ref names the owner's vault by the SHA-256 of its header (null when there is none yet). The genome holds no
// key of anyone's and no secret: what it pins can be published.
//
//   canonical(x)            → the text, or null if x is not plain JSON (undefined, a function, NaN, a BigInt, a cycle …)
//   checkBody(body)         → { ok } | { ok: false, why }   every field, by name
//   material(body)          → the exact bytes that are signed
//   seal(body, signer)      → { ok, text } | refusal      signer = an identity (vendor/fall-kit-core/identity.mjs)
//   open(text, pinned)      → { ok, body, by, id } | { ok: false, stage, why }
//                             stage 'size' → 'json' → 'canonical' → 'shape' → 'signer' → 'signature', in that order;
//                             nothing in the body is used before the signature verifies. id = the genome's SHA-256.
//
// One exact judge: the text must equal the canonical form of what it parses to, and the signature must verify over
// the canonical body. So a changed space, a changed escape, a changed key order or a spare bit in the signature's
// last character is refused like any other change. Pure and total, apart from open/seal awaiting WebCrypto.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { hex, verifyBytes, b64u, unb64u } from '../vendor/fall-kit-core/identity.mjs';

export const KIND = 'seed-laptop.genome', V = 1, DOMAIN = 'seed-laptop.genome.v1\n';
export const MAX_GENOME = 65536, MAX_BLOCKS = 32, MAX_FILES = 64, MAX_FILE_BYTES = 8 << 20, MAX_CONFIG = 8192;
export const ID = /^[a-z][a-z0-9-]{0,23}$/;
export const PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9_][A-Za-z0-9._-]{0,63}){0,3}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
const BODY_KEYS = ['blocks', 'config', 'identity', 'kind', 'name', 'v', 'vault'];
const BLOCK_KEYS = ['entry', 'files', 'from', 'id', 'name'];
const FILE_KEYS = ['bytes', 'path', 'sha256'];
const enc = new TextEncoder();
const no = (why) => ({ ok: false, why });
const refuse = (stage, why) => ({ ok: false, stage, why });

function plain(x) { return x !== null && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype; }

// Nesting is bounded (a genome is 4 deep; MAX_DEPTH leaves room), which also refuses a cycle: it never ends.
export const MAX_DEPTH = 16;

function canon(x, depth) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return JSON.stringify(x);
  if (typeof x === 'number') return Number.isSafeInteger(x) && !Object.is(x, -0) ? String(x) : null;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(x)) {
    const parts = x.map((v) => canon(v, depth + 1));
    return parts.includes(null) ? null : '[' + parts.join(',') + ']';
  }
  if (!plain(x)) return null;
  const parts = Object.keys(x).sort().map((k) => [k, canon(x[k], depth + 1)]);
  return parts.some(([, v]) => v === null) ? null : '{' + parts.map(([k, v]) => JSON.stringify(k) + ':' + v).join(',') + '}';
}

export function canonical(x) {
  try { return canon(x, 0); } catch { return null; }
}

const keysAre = (o, keys) => plain(o) && Object.keys(o).sort().join(',') === keys.join(',');
const text = (s, max) => typeof s === 'string' && s.length >= 1 && s.length <= max;

export function checkBlock(b) {
  if (!keysAre(b, BLOCK_KEYS)) return no('a block has exactly: ' + BLOCK_KEYS.join(', '));
  if (!ID.test(b.id)) return no('a block id is lowercase letters, digits and dashes, starting with a letter, up to 24 long');
  if (!text(b.name, 80)) return no('block ' + b.id + ': a name is 1 to 80 characters');
  if (!text(b.from, 120)) return no('block ' + b.id + ': from names where its bytes came from, 1 to 120 characters');
  if (!Array.isArray(b.files) || b.files.length < 1 || b.files.length > MAX_FILES) return no('block ' + b.id + ': 1 to ' + MAX_FILES + ' files');
  const paths = new Set();
  for (const f of b.files) {
    if (!keysAre(f, FILE_KEYS)) return no('block ' + b.id + ': a file has exactly: ' + FILE_KEYS.join(', '));
    // PATH alone keeps a path inside its block: every segment starts with a letter, a digit or _, so none is . or ..
    if (typeof f.path !== 'string' || !PATH.test(f.path)) return no('block ' + b.id + ': a file path stays inside its block');
    if (paths.has(f.path)) return no('block ' + b.id + ': a file is named once');
    paths.add(f.path);
    if (typeof f.sha256 !== 'string' || !HEX64.test(f.sha256)) return no('block ' + b.id + ': a file is pinned by a SHA-256 in lowercase hex');
    if (!Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_FILE_BYTES) return no('block ' + b.id + ': a file is 0 to ' + MAX_FILE_BYTES + ' bytes');
  }
  if (!paths.has(b.entry)) return no('block ' + b.id + ': its entry is one of its files');
  return { ok: true };
}

export function checkBody(body) {
  if (!keysAre(body, BODY_KEYS)) return no('a genome body has exactly: ' + BODY_KEYS.join(', '));
  if (body.kind !== KIND || body.v !== V) return no('this is not a seed-laptop genome, version ' + V);
  if (!text(body.name, 80)) return no('a genome name is 1 to 80 characters');
  if (!Array.isArray(body.blocks) || body.blocks.length < 1 || body.blocks.length > MAX_BLOCKS) return no('a genome grows 1 to ' + MAX_BLOCKS + ' blocks');
  const ids = new Set();
  for (const b of body.blocks) {
    const c = checkBlock(b);
    if (!c.ok) return c;
    if (ids.has(b.id)) return no('block ' + b.id + ' is named twice');
    ids.add(b.id);
  }
  const cfg = plain(body.config) ? canonical(body.config) : null;
  if (cfg === null || cfg.length > MAX_CONFIG) return no('the config is a plain object of at most ' + MAX_CONFIG + ' characters');
  if (!keysAre(body.identity, ['founder']) || !(body.identity.founder === null || HEX64.test(body.identity.founder))) return no('identity.founder is the owner\'s public key in hex, or null on a stock seed');
  if (!keysAre(body.vault, ['ref']) || !(body.vault.ref === null || HEX64.test(body.vault.ref))) return no('vault.ref is a SHA-256 in hex, or null');
  return { ok: true };
}

export function material(body) {
  const c = canonical(body);
  return c === null ? null : enc.encode(DOMAIN + c);
}

export async function seal(body, signer) {
  const c = checkBody(body);
  if (!c.ok) return c;
  if (!signer || typeof signer.sign !== 'function' || typeof signer.id !== 'string') return no('a genome is sealed by an identity that can sign');
  const sig = await signer.sign(material(body));
  return { ok: true, text: canonical({ body, by: signer.id, sig: b64u(sig) }) };
}

/** The 64 signature bytes, only if s is their one base64url spelling; else null. */
export function sigBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(s)) return null;
  const u = unb64u(s);
  return b64u(u) === s ? u : null;
}

export async function open(t, pinned) {
  if (typeof t !== 'string' || t.length > MAX_GENOME) return refuse('size', 'a genome is text of at most ' + MAX_GENOME + ' characters');
  let g;
  try { g = JSON.parse(t); } catch { return refuse('json', 'a genome is JSON'); }
  if (canonical(g) !== t) return refuse('canonical', 'a genome is written in its one canonical form');
  if (!keysAre(g, ['body', 'by', 'sig'])) return refuse('shape', 'a genome is exactly a body, its signer and the signature');
  const c = checkBody(g.body);
  if (!c.ok) return refuse('shape', c.why);
  if (!Array.isArray(pinned) || !pinned.includes(g.by)) return refuse('signer', 'the genome is not signed by a key this runtime pins');
  const sig = sigBytes(g.sig);
  if (sig === null) return refuse('signature', 'the signature is 64 bytes in base64url');
  if (!(await verifyBytes(g.by, material(g.body), sig))) return refuse('signature', 'the signature does not verify: the genome was changed or signed by another key');
  return { ok: true, body: g.body, by: g.by, id: hex(sha256(enc.encode(t))) };
}
