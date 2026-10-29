// ════════════════════════════════════════════════════════════════
// src/vault.mjs — the owner's encrypted vault: everything the office holds, in one file only the owner's phrase opens.
// Organ 5 of the seed laptop (claim L4).
//
//   'SLV1' · version 1 · iterations (u32, big-endian) · salt (16) · iv (12)  — the header, 37 bytes, authenticated
//   then AES-256-GCM, under a key from the owner's phrase (PBKDF2-SHA256, `iterations` rounds, the salt), of a LIGHT
//   vault (vendor/fall-kit-core/vendor/light/vault.mjs: many files as one solid stream, every file's SHA-256 checked).
// The header is the cipher's additional data, so a changed header is refused like a changed body. The keys stay with
// the owner: the vault holds no key, the estate holds nothing, and without the phrase the vault is noise.
//
//   seal(entries, phrase, { salt, iv, iterations }) → Promise<{ ok, bytes, ref } | refusal>   entries = [{ path, bytes }]
//   open(bytes, phrase)                             → Promise<{ ok, entries, ref } | { ok: false, stage, why }>
//        stage 'size' → 'magic' → 'header' → 'phrase' (the phrase is wrong or a byte changed: GCM cannot tell which)
//        → 'contents' (the plaintext is not a LIGHT vault: never reached unless the authentic key wrote it)
//   refOf(bytes)       → the vault's reference: the SHA-256 of its header (what a personal genome's vault.ref names)
//   headerOf(bytes)    → { iterations, salt, iv } | null
//   iterationsOk(n), sizeOk(n)   the key-stretching rounds this office writes and reads, and a vault's size in bytes
// Pure apart from WebCrypto (async).
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { pack, unpack } from '../vendor/fall-kit-core/vendor/light/vault.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';

export const MAGIC = Object.freeze([0x53, 0x4c, 0x56, 0x31]);   // 'SLV1'
export const VERSION = 1, HEADER = 37, ITERATIONS = 600000, MIN_ITERATIONS = 100000, MAX_ITERATIONS = 10000000;
export const MAX_VAULT = 512 << 20, MIN_PHRASE = 16;
const S = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;
const no = (why) => ({ ok: false, why });
const refuse = (stage, why) => ({ ok: false, stage, why });
export const iterationsOk = (n) => Number.isSafeInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS;
export const sizeOk = (n) => Number.isSafeInteger(n) && n >= HEADER + 16 && n <= MAX_VAULT;   // a header and GCM's 16-byte tag at least

export function headerOf(b) {
  if (!isBytes(b) || b.length < HEADER || MAGIC.some((m, i) => b[i] !== m) || b[4] !== VERSION) return null;
  const iterations = ((b[5] << 24) | (b[6] << 16) | (b[7] << 8) | b[8]) >>> 0;
  return { iterations, salt: b.slice(9, 25), iv: b.slice(25, 37) };
}

export function refOf(b) {
  return headerOf(b) ? hex(sha256(b.subarray(0, HEADER))) : null;
}

async function keyOf(phrase, salt, iterations) {
  const base = await S().importKey('raw', enc.encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return S().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const phraseOk = (p) => typeof p === 'string' && p.trim().length >= MIN_PHRASE && p.length <= 512;

export async function seal(entries, phrase, opts) {
  if (!phraseOk(phrase)) return no('a phrase is ' + MIN_PHRASE + ' to 512 characters');
  const o = Object(opts);
  const iterations = Number.isSafeInteger(o.iterations) ? o.iterations : ITERATIONS;
  if (!iterationsOk(iterations)) return no('iterations are ' + MIN_ITERATIONS + ' to ' + MAX_ITERATIONS);
  const salt = isBytes(o.salt) && o.salt.length === 16 ? o.salt : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = isBytes(o.iv) && o.iv.length === 12 ? o.iv : globalThis.crypto.getRandomValues(new Uint8Array(12));
  const p = pack(Array.isArray(entries) ? entries : [], {});
  if (!p.ok) return p;
  const head = new Uint8Array(HEADER);
  head.set(MAGIC, 0); head[4] = VERSION;
  head[5] = iterations >>> 24; head[6] = (iterations >>> 16) & 255; head[7] = (iterations >>> 8) & 255; head[8] = iterations & 255;
  head.set(salt, 9); head.set(iv, 25);
  const key = await keyOf(phrase, salt, iterations);
  const body = new Uint8Array(await S().encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, p.bytes));
  const bytes = new Uint8Array(HEADER + body.length);
  bytes.set(head, 0); bytes.set(body, HEADER);
  return { ok: true, bytes, ref: refOf(bytes) };
}

export async function open(b, phrase) {
  if (!isBytes(b) || !sizeOk(b.length)) return refuse('size', 'a vault is ' + (HEADER + 16) + ' bytes to ' + MAX_VAULT + ' bytes');
  if (MAGIC.some((m, i) => b[i] !== m) || b[4] !== VERSION) return refuse('magic', 'this is not a seed-laptop vault, version ' + VERSION);
  const h = headerOf(b);
  if (!iterationsOk(h.iterations)) return refuse('header', 'the vault names ' + h.iterations + ' iterations: not a number this office writes');
  if (!phraseOk(phrase)) return refuse('phrase', 'a phrase is ' + MIN_PHRASE + ' to 512 characters');
  let plain;
  try {
    const key = await keyOf(phrase, h.salt, h.iterations);
    plain = new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: h.iv, additionalData: b.subarray(0, HEADER) }, key, b.subarray(HEADER)));
  } catch { return refuse('phrase', 'the phrase does not open this vault, or one of its bytes was changed'); }
  const u = unpack(plain, () => null, { max: MAX_VAULT * 4 });
  if (!u.ok) return refuse('contents', u.why);
  return { ok: true, entries: u.entries, ref: refOf(b) };
}
