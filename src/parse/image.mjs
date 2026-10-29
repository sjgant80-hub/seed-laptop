// ════════════════════════════════════════════════════════════════
// src/parse/image.mjs — what an image is and how big, read only ever inside the sandbox (claims L2a, L2b).
// The pixels are never decoded: the office keeps the original and shows it as an image, in a sandbox.
//
//   image(bytes) → { ok, type: 'png' | 'jpeg' | 'gif' | 'webp', width, height } | refusal
// Pure and total.
// ════════════════════════════════════════════════════════════════

const no = (why) => ({ ok: false, why });
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

export function image(b) {
  if (!(ArrayBuffer.isView(b) && b instanceof Uint8Array) || b.length < 16) return no('not an image');
  if (be32(b, 0) === 0x89504e47 && be32(b, 4) === 0x0d0a1a0a) {
    if (ascii(b, 12, 4) !== 'IHDR') return no('a PNG starts with its IHDR chunk');
    return { ok: true, type: 'png', width: be32(b, 16), height: be32(b, 20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 <= b.length) {   // a frame header's first nine bytes hold its size
      if (b[i] !== 0xff) return no('a JPEG marker is broken at ' + i);
      const m = b[i + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = be16(b, i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ok: true, type: 'jpeg', width: be16(b, i + 7), height: be16(b, i + 5) };
      if (len < 2) return no('a JPEG segment has no length');
      i += 2 + len;
    }
    return no('a JPEG with no frame header');
  }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { ok: true, type: 'gif', width: le16(b, 6), height: le16(b, 8) };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8X') return { ok: true, type: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    if (chunk === 'VP8L' && b[20] === 0x2f) { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { ok: true, type: 'webp', width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { ok: true, type: 'webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    return no('a WebP with a frame this reader does not know');
  }
  return no('not a PNG, JPEG, GIF or WebP');
}
