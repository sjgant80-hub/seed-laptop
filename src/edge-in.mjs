// ════════════════════════════════════════════════════════════════
// src/edge-in.mjs — the inbound edge's first stage: verify-before-parse, on raw bytes. Organ 4 (claims L2a, L2b).
//
// Accept anything AT the edge, trust nothing PAST it. A file from outside is checked here on its raw bytes only:
// nothing in it is decoded, unpacked or interpreted, so nothing in it can act on the office. Only a file that passes
// goes on, still as bytes, to a parser in a sandbox (src/parse/, run by tools/sandbox.mjs or the tab's worker).
//
//   TYPES                    each type the office reads: its file extensions and its size cap
//   declaredOf(name)         → the type a file's name declares, or null
//   sniff(bytes)             → the type the first bytes say ('pdf', 'zip', 'png', 'jpeg', 'gif', 'webp', 'text'), or null
//   verify(bytes, declared)  → { ok: true, type } | { ok: false, stage, why }, stages in order:
//       'type'   the declared type is one the office reads
//       'size'   1 byte to the type's cap
//       'magic'  the first bytes are what the type starts with (DOCX, XLSX and zip are zip containers; the text types
//                are UTF-8 with no NUL byte)
//       'shape'  the last bytes are what the type ends with, so a file with another glued after it (a polyglot) or
//                one cut short is refused: a PDF's %%EOF in its last 1 KB and no zip end record near its end; a zip's
//                end record exactly at its end; PNG's IEND, JPEG's EOI, GIF's trailer, WebP's RIFF length; a
//                calendar begins BEGIN:VCALENDAR, a contact card BEGIN:VCARD, a message with a header field
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

const MB = 1 << 20;
export const TYPES = Object.freeze({
  pdf: { ext: ['pdf'], max: 50 * MB },
  docx: { ext: ['docx'], max: 25 * MB },
  xlsx: { ext: ['xlsx'], max: 25 * MB },
  zip: { ext: ['zip'], max: 100 * MB },
  eml: { ext: ['eml'], max: 25 * MB },
  ics: { ext: ['ics'], max: 5 * MB },
  vcf: { ext: ['vcf'], max: 5 * MB },
  csv: { ext: ['csv'], max: 20 * MB },
  png: { ext: ['png'], max: 25 * MB },
  jpeg: { ext: ['jpg', 'jpeg'], max: 25 * MB },
  gif: { ext: ['gif'], max: 25 * MB },
  webp: { ext: ['webp'], max: 25 * MB },
});
const CONTAINER = { pdf: 'pdf', docx: 'zip', xlsx: 'zip', zip: 'zip', eml: 'text', ics: 'text', vcf: 'text', csv: 'text', png: 'png', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
const refuse = (stage, why) => ({ ok: false, stage, why });
const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const at = (b, i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);

export function declaredOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(typeof name === 'string' ? name : '');
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return Object.keys(TYPES).find((t) => TYPES[t].ext.includes(ext)) || null;
}

export function utf8(b) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return !b.includes(0); } catch { return false; }
}

export function sniff(b) {
  if (!isBytes(b) || b.length < 1) return null;   // every magic is checked within the bytes there are
  if (at(b, 0, '%PDF-')) return 'pdf';
  if (at(b, 0, 'PK\x03\x04')) return 'zip';
  if (b[0] === 0x89 && at(b, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (at(b, 0, 'GIF87a') || at(b, 0, 'GIF89a')) return 'gif';
  if (at(b, 0, 'RIFF') && at(b, 8, 'WEBP')) return 'webp';
  return utf8(b) ? 'text' : null;
}

/** Where the zip end record is, if it ends the file exactly (its comment counted); else -1. */
export function zipEnd(b) {
  if (!isBytes(b)) return -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (at(b, i, 'PK\x05\x06') && i + 22 + u16le(b, i + 20) === b.length) return i;
  }
  return -1;
}

function lastIndex(b, s, from) {
  for (let i = b.length - s.length; i >= Math.max(0, from); i--) if (at(b, i, s)) return i;
  return -1;
}

function shape(b, type) {
  if (type === 'pdf') {
    const eof = lastIndex(b, '%%EOF', b.length - 1024);
    if (eof === -1) return 'a PDF ends with %%EOF in its last 1 KB (this one does not: cut short, or something glued after it)';
    for (let i = eof + 5; i < b.length; i++) if (![0x0a, 0x0d, 0x20, 0x09, 0x00].includes(b[i])) return 'bytes after the PDF\'s %%EOF';
    if (lastIndex(b, 'PK\x05\x06', b.length - 65557) !== -1) return 'a zip end record inside a PDF (a PDF and a zip in one file)';
    return null;
  }
  if (CONTAINER[type] === 'zip') return zipEnd(b) === -1 ? 'a zip archive ends with its end record (this one does not: cut short, or something glued after it)' : null;
  if (type === 'png') return at(b, b.length - 8, 'IEND') ? null : 'a PNG ends with its IEND chunk';
  if (type === 'jpeg') return b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 ? null : 'a JPEG ends with its end-of-image marker';
  if (type === 'gif') return b[b.length - 1] === 0x3b ? null : 'a GIF ends with its trailer byte';
  if (type === 'webp') return u32le(b, 4) + 8 === b.length ? null : 'a WebP is exactly as long as its RIFF header says';
  const first = new TextDecoder().decode(b.subarray(0, 256)).replace(/^﻿/, '').split(/\r?\n/, 1)[0].trim().toUpperCase();
  if (type === 'ics') return first === 'BEGIN:VCALENDAR' ? null : 'a calendar begins with BEGIN:VCALENDAR';
  if (type === 'vcf') return first === 'BEGIN:VCARD' ? null : 'a contact card begins with BEGIN:VCARD';
  if (type === 'eml') return /^[!-9;-~]+:/.test(first) ? null : 'a message begins with a header field';
  return null;
}

export function verify(b, declared) {
  if (typeof declared !== 'string' || !own(TYPES, declared)) return refuse('type', 'the office does not read this kind of file');
  if (!isBytes(b) || b.length < 1 || b.length > TYPES[declared].max) return refuse('size', 'a ' + declared + ' file is 1 byte to ' + TYPES[declared].max / MB + ' MB');
  const s = sniff(b);
  if (s === null) return refuse('magic', 'the bytes are not any kind of file the office reads');
  if (s !== CONTAINER[declared]) return refuse('magic', 'the name says ' + declared + ' but the bytes are ' + (s === 'text' ? 'text' : s));
  const why = shape(b, declared);
  if (why) return refuse('shape', why);
  return { ok: true, type: declared };
}
