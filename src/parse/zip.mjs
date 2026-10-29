// ════════════════════════════════════════════════════════════════
// src/parse/zip.mjs — read a ZIP archive (and so DOCX and XLSX), only ever inside the sandbox (claim L2b).
//
//   entries(bytes)                  → { ok, entries: [{ name, method, flags, csize, usize, crc, offset }] } | refusal
//       from the central directory; refuses: no end record, an archive that does not start with a local file header or
//       has bytes after its end record (a file glued to another), more than MAX_ENTRIES entries, an encrypted entry,
//       a name that could reach outside the archive, a method other than stored or deflate, a declared total past
//       MAX_TOTAL or a ratio past MAX_RATIO (a zip bomb), and two entries with one name
//   read(bytes, entry, inflateRaw)  → Promise<{ ok, bytes } | refusal>   one entry, its size and CRC-32 checked;
//       inflateRaw(bytes, maxOut) is the platform's raw inflate with an output cap
// Pure apart from the inflate it is handed.
// ════════════════════════════════════════════════════════════════

export const MAX_ENTRIES = 10000, MAX_TOTAL = 200 << 20, MAX_RATIO = 200, MAX_NAME = 512;
const no = (why) => ({ ok: false, why });
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

let TABLE = null;
export function crc32(b) {
  if (!(ArrayBuffer.isView(b) && b instanceof Uint8Array)) return 0;
  if (!TABLE) TABLE = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function safeName(n) {
  return typeof n === 'string' && n.length >= 1 && n.length <= MAX_NAME && !n.startsWith('/') && !n.includes('\\') && !/^[A-Za-z]:/.test(n) && !n.split('/').some((s) => s === '..');
}

export function entries(bytes) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array) || bytes.length < 22) return no('not a zip archive');
  if (u32(bytes, 0) !== 0x04034b50) return no('a zip archive starts with a local file header');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50 && i + 22 + u16(bytes, i + 20) === bytes.length) { end = i; break; }
  }
  if (end === -1) return no('the zip end record is not at the end of the file (bytes after it, or none)');
  const count = u16(bytes, end + 10), cdSize = u32(bytes, end + 12), cdAt = u32(bytes, end + 16);
  if (count > MAX_ENTRIES) return no('more than ' + MAX_ENTRIES + ' entries');
  if (cdAt + cdSize !== end) return no('the central directory is not where the end record says');
  const out = [], names = new Set();
  let at = cdAt, usum = 0, csum = 0;
  const td = new TextDecoder('utf-8', { fatal: true }), latin = new TextDecoder('latin1');
  for (let k = 0; k < count; k++) {
    if (at + 46 > end || u32(bytes, at) !== 0x02014b50) return no('central directory entry ' + k + ' is broken');
    const flags = u16(bytes, at + 8), method = u16(bytes, at + 10), crc = u32(bytes, at + 16), csize = u32(bytes, at + 20), usize = u32(bytes, at + 24);
    const nlen = u16(bytes, at + 28), xlen = u16(bytes, at + 30), clen = u16(bytes, at + 32), offset = u32(bytes, at + 42);
    if (at + 46 + nlen + xlen + clen > end) return no('central directory entry ' + k + ' runs past its directory');
    let name;
    try { name = flags & 0x800 ? td.decode(bytes.subarray(at + 46, at + 46 + nlen)) : latin.decode(bytes.subarray(at + 46, at + 46 + nlen)); } catch { return no('an entry name is not text'); }
    if (flags & 1) return no('an encrypted entry: ' + name.slice(0, 60));
    if (!safeName(name)) return no('an entry name that could reach outside the archive: ' + name.slice(0, 60));
    if (names.has(name)) return no('two entries named ' + name.slice(0, 60));
    if (method !== 0 && method !== 8) return no('entry ' + name.slice(0, 60) + ' uses compression method ' + method);
    if (offset + 30 > cdAt) return no('entry ' + name.slice(0, 60) + ' starts past the data');
    names.add(name);
    usum += usize; csum += csize;
    if (usum > MAX_TOTAL) return no('the archive would unpack to more than ' + MAX_TOTAL + ' bytes');
    out.push({ name, method, flags, csize, usize, crc, offset });
    at += 46 + nlen + xlen + clen;
  }
  if (usum > Math.max(csum, 1) * MAX_RATIO && usum > 1 << 20) return no('the archive unpacks ' + Math.round(usum / Math.max(csum, 1)) + ' times its size (a zip bomb)');
  return { ok: true, entries: out };
}

export async function read(bytes, e, inflateRaw) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array) || !e || typeof e.offset !== 'number') return no('not an entry');
  if (typeof inflateRaw !== 'function') return no('no inflate to read it with');
  const at = e.offset;
  if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) return no('entry ' + String(e.name).slice(0, 60) + ': no local header');
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  if (start + e.csize > bytes.length) return no('entry ' + String(e.name).slice(0, 60) + ' runs past the file');
  const raw = bytes.subarray(start, start + e.csize);
  let data;
  if (e.method === 0) data = raw.slice();
  else {
    try { data = await inflateRaw(raw, e.usize); } catch { return no('entry ' + String(e.name).slice(0, 60) + ' does not inflate to its declared size'); }
    if (!(data instanceof Uint8Array)) return no('entry ' + String(e.name).slice(0, 60) + ' did not inflate');
  }
  if (data.length !== e.usize) return no('entry ' + String(e.name).slice(0, 60) + ' is not its declared size');
  if (crc32(data) !== e.crc) return no('entry ' + String(e.name).slice(0, 60) + ' fails its CRC-32');
  return { ok: true, bytes: data };
}
