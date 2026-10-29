// ════════════════════════════════════════════════════════════════
// src/parse/index.mjs — the parsers, as one door, for the sandbox only (claims L2a, L2b, L2c).
//
// Nothing outside the sandbox ever imports this folder: the office's core hands a file's bytes to a sandboxed
// process (tools/sandbox.mjs runs src/parse/run.mjs) or a worker, and reads back only the plain result.
//
//   parse(type, bytes, platform) → Promise<{ ok, type, result } | { ok: false, why }>
//       platform = { inflateRaw(bytes, size), inflate(bytes) }   the platform's own inflate, capped
// Each reader also checks what its format can check about itself (zip CRC-32s for every entry, PNG chunk CRCs,
// the JPEG, GIF and WebP structures end to end, every PDF stream decoding, a multipart message's closing boundary),
// so damage the format can see makes the file fail here: quarantined, never half read.
// ════════════════════════════════════════════════════════════════
import { entries, read, crc32 } from '#zip';
import { docx, xlsx } from '#office';
import { pdf } from '#pdf';
import { eml } from '#mail';
import { csv, ics, vcf } from '#text';
import { image } from '#image';

const no = (why) => ({ ok: false, why });
const td = new TextDecoder('utf-8', { fatal: true });
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;

export function pngIntact(b) {
  if (!isBytes(b)) return 'not bytes';
  let i = 8;
  while (i + 12 <= b.length) {
    const len = be32(b, i), type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (i + 12 + len > b.length) return 'a PNG chunk runs past the file';
    if (crc32(b.subarray(i + 4, i + 8 + len)) !== be32(b, i + 8 + len)) return 'PNG chunk ' + type + ' fails its CRC';
    i += 12 + len;
    if (type === 'IEND') return i === b.length ? null : 'bytes after a PNG\'s IEND';
  }
  return 'a PNG with no IEND chunk';
}

export function jpegIntact(b) {
  if (!isBytes(b)) return 'not bytes';
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return 'a JPEG marker is broken';
    const m = b[i + 1];
    if (m === 0xd9) return i + 2 === b.length ? null : 'bytes after a JPEG\'s end';
    if (m === 0xff) { i++; continue; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    if (i + 4 > b.length) return 'a JPEG segment runs past the file';
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return 'a JPEG segment runs past the file';
    i += 2 + len;
    if (m === 0xda) {   // entropy-coded data runs to the next marker that is not a stuffed byte or a restart
      for (;;) {
        const f = b.indexOf(0xff, i), n = b[f + 1];
        if (f === -1) { i = b.length; break; }
        i = f;
        if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7)) break;   // a marker: not a stuffed byte, not a restart
        i = f + 2;
      }
    }
  }
  return 'a JPEG with no end marker';
}

export function gifIntact(b) {
  if (!isBytes(b)) return 'not bytes';
  let i = 13;
  if (b.length < 14) return 'a GIF too short for its header';
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  const blocks = () => { for (;;) { const n = b[i++]; if (n === 0) return true; if (n === undefined) return false; i += n; } };   // sub-blocks to their zero, or to the end of the file
  while (i < b.length) {
    const t = b[i++];
    if (t === 0x3b) return i === b.length ? null : 'bytes after a GIF\'s trailer';
    if (t === 0x21) { i++; if (!blocks()) return 'a GIF extension never ends'; }
    else if (t === 0x2c) { if (i + 9 > b.length) return 'a GIF image header runs past the file'; const f = b[i + 8]; i += 9; if (f & 0x80) i += 3 * (1 << ((f & 7) + 1)); i++; if (!blocks()) return 'GIF image data never ends'; }
    else return 'a GIF block of an unknown kind';
  }
  return 'a GIF with no trailer';
}

export function webpIntact(b) {
  if (!isBytes(b)) return 'not bytes';
  let i = 12;
  while (i + 8 <= b.length) { const n = le32(b, i + 4); i += 8 + n + (n & 1); }
  return i === b.length ? null : 'WebP chunks do not add up to the file';
}

export async function parse(type, bytes, platform) {
  if (!isBytes(bytes)) return no('nothing to read');
  const p = platform || {};
  try {
    if (type === 'pdf') {
      const r = await pdf(bytes, p.inflate);
      if (r.ok && r.damaged) return no(r.damaged + ' of the PDF\'s streams do not decode: it is damaged');
      return r.ok ? { ok: true, type, result: { pages: r.pages, text: r.text } } : r;
    }
    if (type === 'docx') { const r = await docx(bytes, p.inflateRaw); return r.ok ? { ok: true, type, result: { paragraphs: r.paragraphs, tables: r.tables } } : r; }
    if (type === 'xlsx') { const r = await xlsx(bytes, p.inflateRaw); return r.ok ? { ok: true, type, result: { sheets: r.sheets } } : r; }
    if (type === 'zip') {
      const z = entries(bytes);
      if (!z.ok) return z;
      for (const e of z.entries) { const r = await read(bytes, e, p.inflateRaw); if (!r.ok) return r; }
      return { ok: true, type, result: { entries: z.entries.map((e) => ({ name: e.name, size: e.usize })) } };
    }
    if (type === 'eml') {
      const r = await eml(bytes);
      if (!r.ok) return r;
      const { ok, ...result } = r; void ok;
      return { ok: true, type, result };
    }
    if (type === 'ics' || type === 'vcf' || type === 'csv') {
      let text;
      try { text = td.decode(bytes); } catch { return no('not UTF-8 text'); }
      const r = type === 'ics' ? ics(text) : type === 'vcf' ? vcf(text) : csv(text);
      if (!r.ok) return r;
      const { ok, ...result } = r; void ok;
      return { ok: true, type, result };
    }
    if (type === 'png' || type === 'jpeg' || type === 'gif' || type === 'webp') {
      const r = image(bytes);
      if (!r.ok) return r;
      if (r.type !== type) return no('the image is a ' + r.type + ', not a ' + type);
      const why = type === 'png' ? pngIntact(bytes) : type === 'jpeg' ? jpegIntact(bytes) : type === 'gif' ? gifIntact(bytes) : webpIntact(bytes);
      if (why) return no(why);
      return { ok: true, type, result: { width: r.width, height: r.height } };
    }
    return no('no reader for ' + String(type).slice(0, 20));
  } catch (e) {
    return no('the reader stopped: ' + String(e && e.message).slice(0, 120));
  }
}
