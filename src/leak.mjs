// ════════════════════════════════════════════════════════════════
// src/leak.mjs — does a file leaving the office carry anything of the office's internals? Organ 4 (claim L3).
//
//   markers(ctx)                       → the internal markers for one office: the owner's and the device's public keys,
//                                        the vault reference, the genome's id, every block id and every block file's
//                                        SHA-256, the names of the product and its foundation, the home folder, the OS
//                                        user name; a short or common word only as a whole word
//   scan(bytes, list, inflateRaw?)     → Promise<[{ marker, where }]>   the raw bytes (as Latin-1 and as UTF-16 text),
//                                        and, for a zip-based file, every entry (inflated if it is deflated)
//   zipTexts(bytes, inflateRaw?)       → Promise<[{ where, text }]>   a zip's entries by their local headers, as Latin-1
// Pure apart from the inflate it is handed.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const NAMES = Object.freeze(['seed-laptop', 'seed laptop', 'fall-kit', 'fallkit', 'konomi', 'light vault', 'lvt1', 'sls1', 'genome', 'kar']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latin = new TextDecoder('latin1'), utf16 = new TextDecoder('utf-16le');

export function markers(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const out = [];
  const add = (s, word) => { if (typeof s === 'string' && s.length >= 3) out.push({ marker: s, re: new RegExp((word ? '(?<![a-z0-9])' : '') + esc(s.toLowerCase()) + (word ? '(?![a-z0-9])' : ''), 'i') }); };
  for (const k of ['owner', 'device', 'vault', 'genome']) if (typeof c[k] === 'string' && c[k].length >= 16) { add(c[k], false); add(c[k].slice(0, 16), false); }
  for (const b of Array.isArray(c.blocks) ? c.blocks : []) add(b, true);
  for (const h of Array.isArray(c.hashes) ? c.hashes : []) add(h, false);
  for (const n of NAMES) add(n, true);
  if (typeof c.home === 'string') { add(c.home, false); add(c.home.split('\\').join('/'), false); }
  if (typeof c.user === 'string') add(c.user, true);
  return out;
}

const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

export async function zipTexts(b, inflateRaw) {
  if (!isBytes(b)) return [];
  const out = [];
  let i = 0;
  while (i + 30 <= b.length && u32(b, i) === 0x04034b50) {
    const method = u16(b, i + 8), csize = u32(b, i + 18), nlen = u16(b, i + 26), xlen = u16(b, i + 28);
    const name = latin.decode(b.subarray(i + 30, i + 30 + nlen));
    const data = b.subarray(i + 30 + nlen + xlen, i + 30 + nlen + xlen + csize);
    let bytes = data;
    if (method === 8 && inflateRaw) { try { const r = await inflateRaw(data); bytes = isBytes(r) ? r : data; } catch { bytes = data; } }
    out.push({ where: name, text: latin.decode(bytes) });
    i += 30 + nlen + xlen + csize;
  }
  return out;
}

export async function scan(bytes, list, inflateRaw) {
  if (!isBytes(bytes) || !Array.isArray(list)) return [];
  if (inflateRaw !== undefined && typeof inflateRaw !== 'function') return [];
  const texts = [{ where: 'bytes', text: latin.decode(bytes) }, { where: 'bytes as UTF-16', text: utf16.decode(bytes) }, ...(await zipTexts(bytes, inflateRaw))];
  const hits = [];
  for (const { where, text } of texts) for (const m of list) if (m && m.re instanceof RegExp && m.re.test(text)) hits.push({ marker: m.marker, where });
  return hits;
}
