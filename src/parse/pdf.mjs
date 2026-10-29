// ════════════════════════════════════════════════════════════════
// src/parse/pdf.mjs — the text of a PDF, read only ever inside the sandbox (claims L2a, L2b).
//
// Reads what mainstream writers make: indirect objects (and those packed in object streams), Flate, ASCIIHex and
// ASCII85 streams, the page tree with inherited resources, form XObjects one level down, fonts mapped by their
// ToUnicode CMap (one- or two-byte codes), else WinAnsi or their /Differences, and the text operators (Tj TJ ' "
// with Td TD T* Tm TL Tf). Nothing in a PDF is ever run: JavaScript, actions, forms and embedded files are not read.
// Best effort by design: the office keeps the original, and the fidelity of this reading is measured (claim L2a).
//
//   pdf(bytes, inflate, caps?) → Promise<{ ok, pages: [text], text, damaged } | refusal>
//       inflate(bytes) → zlib-wrapped inflate; damaged = how many objects do not end at endobj, plus how many of the
//       file's streams fail to decode (every stream is tried, not only the text's); caps { objects, pages, ops } lowers
//       the caps (the tests check each at its exact edge with small ones), the office reads with the defaults
//   lex(text, at)              → { next() → the next value or undefined at the end, at }   the object syntax
//   filters(dict, raw, inflate) → Promise<{ ok: true, bytes } | { ok: true, bytes: null } | { ok: false }>
//       one stream through its filters; bytes null = a filter that is not text (an image codec)
// ════════════════════════════════════════════════════════════════

const no = (why) => ({ ok: false, why });
export const MAX_OBJECTS = 200000, MAX_PAGES = 5000, MAX_OPS = 5000000, MAX_REFS = 32, MAX_TREE = 64, MAX_FORMS = 2;
const capOf = (c, k, d) => { try { const x = c[k]; return Number.isSafeInteger(x) && x > 0 ? x : d; } catch { return d; } };
const latin = new TextDecoder('latin1');
const WS = new Set([0, 9, 10, 12, 13, 32]);
const REGULAR = /[^\x00\t\n\f\r ()<>[\]{}/%]*/y;   // a run of regular characters: not white space, not a delimiter

// cp1252 (WinAnsi) bytes 0x80–0x9f; everything else is Latin-1
const WIN = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };
const winAnsi = (b) => String.fromCodePoint(WIN[b] || b);
const GLYPH = { space: ' ', period: '.', comma: ',', colon: ':', semicolon: ';', hyphen: '-', endash: '–', emdash: '—', quoteright: '’', quoteleft: '‘', quotedbl: '"', quotesingle: "'", parenleft: '(', parenright: ')', slash: '/', ampersand: '&', at: '@', percent: '%', sterling: '£', dollar: '$', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', question: '?', exclam: '!', plus: '+', equal: '=', underscore: '_', numbersign: '#', asterisk: '*' };
const ESCAPE = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };

// ── the object syntax ──
export function lex(s, i) {
  if (typeof s !== 'string' || !Number.isSafeInteger(i) || i < 0) return { next: () => undefined, at: 0 };
  const skipWs = () => { while (WS.has(s.charCodeAt(i))) i++; };   // past the end charCodeAt is NaN: not white space
  const runEnd = (from) => { REGULAR.lastIndex = from; REGULAR.exec(s); return REGULAR.lastIndex; };
  const val = () => {
    for (;;) {
      skipWs();
      if (s[i] !== '%') break;
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;   // a comment runs to the end of its line
    }
    if (i >= s.length) return undefined;
    const ch = s[i];
    if (s.startsWith('<<', i)) {
      i += 2; const d = {};
      for (;;) {
        skipWs();
        if (s.startsWith('>>', i)) { i += 2; return { dict: d }; }
        const k = val();
        if (!k || typeof k.name !== 'string') return { dict: d };   // a key that is not a name ends the dictionary
        Object.defineProperty(d, k.name, { value: val(), enumerable: true, writable: true, configurable: true });   // even a key named __proto__ is only a key
      }
    }
    if (ch === '[') {
      i++; const a = [];
      for (;;) {
        skipWs();
        if (s[i] === ']') { i++; return a; }
        const x = val();
        if (x === undefined) return a;   // the text ended inside the array
        a.push(x);
      }
    }
    if (ch === '/') { const j = runEnd(i + 1); const n = s.slice(i + 1, j).replace(/#([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); i = j; return { name: n }; }
    if (ch === '(') {
      let depth = 1, out = ''; i++;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\') {
          const n = s[i + 1];
          if (Object.prototype.hasOwnProperty.call(ESCAPE, n)) { out += ESCAPE[n]; i += 2; }
          else if (/^[0-7]$/.test(n)) { const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; out += String.fromCharCode(parseInt(m, 8) & 255); i += 1 + m.length; }
          else if (n === '\r') i += s[i + 2] === '\n' ? 3 : 2;   // a line continuation
          else if (n === '\n') i += 2;
          else { out += n === undefined ? '' : n; i += 2; }   // an unknown escape is the character itself
          continue;
        }
        if (c === '(') depth++;
        if (c === ')' && --depth === 0) { i++; break; }
        out += c; i++;
      }
      return { str: out };
    }
    if (ch === '<') {
      const j = s.indexOf('>', i), stop = j === -1 ? s.length : j;
      const h = s.slice(i + 1, stop).replace(/[^0-9A-Fa-f]/g, '');
      i = stop + 1;
      const hh = h.length % 2 ? h + '0' : h;
      let out = '';
      for (let k = 0; k < hh.length; k += 2) out += String.fromCharCode(parseInt(hh.slice(k, k + 2), 16));
      return { str: out };
    }
    const j = runEnd(i);
    if (j === i) { i++; return { op: ch }; }
    const tok = s.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      const m = /^\s+(\d+)\s+R\b/.exec(s.slice(i, i + 24));
      if (m && /^\d+$/.test(tok)) { i += m[0].length; return { ref: tok + ' ' + m[1] }; }
      return Number(tok);
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return { op: tok };
  };
  return { next: () => val(), get at() { return i; }, set at(n) { i = n; } };
}

function a85(t) {
  const out = [];
  for (let k = 0; k < t.length;) {
    if (t[k] === 'z') { out.push(0, 0, 0, 0); k++; continue; }
    const chunk = t.slice(k, k + 5); k += 5;
    let v = 0;
    for (const c of chunk.padEnd(5, 'u')) v = v * 85 + (c.charCodeAt(0) - 33);
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, chunk.length - 1));
  }
  return Uint8Array.from(out);
}

export async function filters(dict, raw, inflate) {
  try {
    let data = raw;
    const f = dict.Filter === undefined ? [] : Array.isArray(dict.Filter) ? dict.Filter : [dict.Filter];
    for (const x of f) {
      const name = x === null || typeof x !== 'object' ? null : x.name;
      if (name === 'FlateDecode' || name === 'Fl') data = await inflate(data);
      else if (name === 'ASCIIHexDecode' || name === 'AHx') { const h = latin.decode(data).replace(/[^0-9A-Fa-f]/g, ''); data = Uint8Array.from({ length: h.length >> 1 }, (_, k) => parseInt(h.slice(2 * k, 2 * k + 2), 16)); }
      else if (name === 'ASCII85Decode' || name === 'A85') data = a85(latin.decode(data).replace(/\s/g, '').replace(/^<~/, '').replace(/~>[\s\S]*$/, ''));
      else return { ok: true, bytes: null };   // an image codec or one this reader does not know: not text
    }
    if (!(data instanceof Uint8Array)) return { ok: false };
    return { ok: true, bytes: data };
  } catch { return { ok: false }; }
}

export async function pdf(bytes, inflate, caps) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array)) return no('a PDF is bytes');
  if (typeof inflate !== 'function') return no('no inflate to read it with');
  const c = Object(caps);
  const maxObjects = capOf(c, 'objects', MAX_OBJECTS), maxPages = capOf(c, 'pages', MAX_PAGES), maxOps = capOf(c, 'ops', MAX_OPS);
  const s = latin.decode(bytes);
  if (!s.startsWith('%PDF-')) return no('a PDF starts with %PDF-');
  const objs = new Map();
  const streams = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m, count = 0, broken = 0;
  const wsEnd = (i) => { while (WS.has(s.charCodeAt(i))) i++; return i; };
  const endsAt = (i) => s.startsWith('endobj', wsEnd(i));
  while ((m = re.exec(s))) {
    if (++count > maxObjects) return no('more than ' + maxObjects + ' objects');
    const key = m[1] + ' ' + m[2];
    const lx = lex(s, re.lastIndex);
    const v = lx.next();
    const at = wsEnd(lx.at);
    if (s.startsWith('stream', at) && v && v.dict) {
      let start = at + 6;
      if (s[start] === '\r') start++;
      if (s[start] === '\n') start++;
      const L = Number.isSafeInteger(v.dict.Length) ? v.dict.Length : -1;   // an indirect or broken /Length is no length
      let len;
      if (s.startsWith('endstream', wsEnd(start + L))) len = Math.max(0, L);
      else {   // a missing or wrong /Length: the stream runs to endstream, less the one end-of-line before it
        const e = s.indexOf('endstream', start);
        len = e === -1 ? 0 : s.slice(start, e).replace(/(\r\n|\r|\n)$/, '').length;
      }
      streams.set(key, { dict: v.dict, raw: bytes.subarray(start, start + len) });
      re.lastIndex = start + len;
      const e = wsEnd(start + len);
      if (!(s.startsWith('endstream', e) && endsAt(e + 9))) broken++;
    } else if (!endsAt(lx.at)) broken++;   // an object that does not end where it should is damaged
    objs.set(key, v);
  }
  const get = (x, depth = 0) => (x && typeof x === 'object' && typeof x.ref === 'string' && depth < MAX_REFS ? get(objs.get(x.ref), depth + 1) : x);
  const bytesOf = async (dict, raw) => { const r = await filters(dict, raw, inflate); return r.ok ? r.bytes : null; };
  // objects packed in object streams
  for (const [, st] of streams) {
    if (!(st.dict.Type && st.dict.Type.name === 'ObjStm')) continue;
    const data = await bytesOf(st.dict, st.raw);
    if (!data) continue;
    const t = latin.decode(data);
    const first = get(st.dict.First);
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    const pairs = Math.min(get(st.dict.N), head.length >> 1);
    for (let k = 0; k < pairs; k++) {
      const key = head[2 * k] + ' 0';
      if (!objs.has(key)) objs.set(key, lex(t, first + head[2 * k + 1]).next());
    }
  }
  const streamOf = async (x) => {
    const st = x && typeof x.ref === 'string' ? streams.get(x.ref) : undefined;
    return st ? bytesOf(st.dict, st.raw) : null;
  };
  // the page tree
  let catalog = null;
  for (const v of objs.values()) if (v && v.dict && v.dict.Type && v.dict.Type.name === 'Catalog') { catalog = v.dict; break; }
  if (!catalog) return no('the PDF has no catalog: it is damaged, or not one this reader can trust');
  const pages = [], seen = new Set();
  const visit = (node, inherited, depth) => {
    if (node && typeof node.ref === 'string') { if (seen.has(node.ref)) return; seen.add(node.ref); }   // a cycle, or one node named twice: read once
    const d = get(node);
    if (!d || !d.dict || depth > MAX_TREE || pages.length >= maxPages) return;
    const res = d.dict.Resources !== undefined ? d.dict.Resources : inherited;
    if (d.dict.Type && d.dict.Type.name === 'Page') pages.push({ dict: d.dict, res });
    else { const kids = get(d.dict.Kids); if (Array.isArray(kids)) for (const k of kids) visit(k, res, depth + 1); }
  };
  visit(catalog.Pages, undefined, 0);
  // fonts
  const fontCache = new Map();
  async function fontOf(ref) {
    const key = ref && typeof ref.ref === 'string' ? ref.ref : null;
    if (key !== null && fontCache.has(key)) return fontCache.get(key);
    const f = get(ref);
    const d = f && f.dict ? f.dict : {};
    const font = { width: 1, map: null, diff: null };
    if (d.Subtype && d.Subtype.name === 'Type0') font.width = 2;
    const cm = d.ToUnicode ? await streamOf(d.ToUnicode) : null;
    if (cm) {
      const t = latin.decode(cm);
      font.map = new Map();
      const hex = (h) => h.replace(/[<>\s]/g, '');
      const uni = (h) => { const x = hex(h); let out = ''; for (let k = 0; k + 4 <= x.length; k += 4) out += String.fromCharCode(parseInt(x.slice(k, k + 4), 16)); return out; };   // whole UTF-16 units only
      const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(t);
      if (cs) { const lo = /<([0-9A-Fa-f]+)>/.exec(cs[1]); if (lo) font.width = lo[1].length >> 1; }
      for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) font.map.set(parseInt(p[1], 16), uni(p[2]));
      for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
          const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
          if (hi - lo > 65535) continue;   // one range maps at most 65,536 codes
          if (p[3][0] === '[') { const list = [...p[3].matchAll(/<([0-9A-Fa-f]*)>/g)]; const last = Math.min(hi, lo + list.length - 1); for (let code = lo; code <= last; code++) font.map.set(code, uni(list[code - lo][1])); }
          else { const base = hex(p[3]); const start = parseInt(base.slice(-4), 16); const prefix = uni(base.slice(0, -4)); for (let code = lo; code <= hi; code++) font.map.set(code, prefix + String.fromCharCode(start + (code - lo))); }
        }
      }
    }
    const enc = get(d.Encoding);
    const differences = enc && enc.dict ? get(enc.dict.Differences) : null;
    if (Array.isArray(differences)) {
      font.diff = new Map(); let code = 0;
      for (const x of differences) {
        if (typeof x === 'number') code = x;
        else if (x !== null && typeof x === 'object' && typeof x.name === 'string') { font.diff.set(code, GLYPH[x.name] || (x.name.length === 1 ? x.name : /^uni[0-9A-F]{4}$/.test(x.name) ? String.fromCharCode(parseInt(x.name.slice(3), 16)) : '')); code++; }
      }
    }
    if (key !== null) fontCache.set(key, font);
    return font;
  }
  const show = (font, str) => {
    let out = '';
    for (let k = 0; k < str.length; k += font.width) {
      const code = font.width === 2 ? (str.charCodeAt(k) << 8) | (str.charCodeAt(k + 1) || 0) : str.charCodeAt(k);
      if (font.map && font.map.has(code)) out += font.map.get(code);
      else if (font.diff && font.diff.has(code)) out += font.diff.get(code);
      else if (font.width === 1) out += winAnsi(code);
    }
    return out;
  };
  let ops = 0;
  async function run(content, res, depth) {
    const t = latin.decode(content);
    const R = get(res), RD = R && R.dict ? R.dict : {};
    const fonts = get(RD.Font), xobj = get(RD.XObject);
    const lx = lex(t, 0);
    const stack = [];
    let font = { width: 1, map: null, diff: null }, out = '', lastY = null, lineX = 0, lastEnd = '';
    let tx = 0, ty = 0, tl = 0;
    const put =(txt) => { if (lastY === null) { lastY = ty; lineX = tx; } out += txt; if (txt) lastEnd = txt[txt.length - 1]; };   // text shown before any move is at the start position
    const moveTo = (x, y) => {
      if (lastY === null) { lastY = y; lineX = x; return; }   // the first position: nothing to separate it from
      if (Math.abs(y - lastY) > 1) { if (lastEnd !== '\n') put('\n'); }   // a new line
      else if (x > lineX + 0.5 && lastEnd !== ' ' && lastEnd !== '\n' && out) put(' ');   // further along the same line
      lastY = y; lineX = x;
    };
    for (;;) {
      if (++ops > maxOps) throw new Error('more than ' + maxOps + ' operations');
      const v = lx.next();
      if (v === undefined) break;
      if (!v || typeof v !== 'object' || !('op' in v)) { stack.push(v); continue; }
      const op = v.op, a = stack.splice(0);
      const num = (k) => Number(a[k]) || 0;
      if (op === 'BT') { tx = 0; ty = 0; }
      else if (op === 'Tf' && a[0] && a[0].name && fonts && fonts.dict) font = await fontOf(fonts.dict[a[0].name]);
      else if (op === 'Td') { tx += num(0); ty += num(1); moveTo(tx, ty); }
      else if (op === 'TD') { tx += num(0); ty += num(1); tl = -num(1); moveTo(tx, ty); }
      else if (op === 'Tm') { tx = num(4); ty = num(5); moveTo(tx, ty); }
      else if (op === 'TL') tl = num(0);
      else if (op === 'T*') { ty -= tl; moveTo(tx, ty); }
      else if (op === 'Tj') { if (a[0] && typeof a[0].str === 'string') put(show(font, a[0].str)); }
      else if (op === "'" || op === '"') { ty -= tl; moveTo(tx, ty); const sa = a[a.length - 1]; if (sa && typeof sa.str === 'string') put(show(font, sa.str)); }
      else if (op === 'TJ') { if (Array.isArray(a[0])) for (const x of a[0]) { if (typeof x === 'number') { if (x < -250 && lastEnd !== ' ') put(' '); } else if (x && typeof x.str === 'string') put(show(font, x.str)); } }
      else if (op === 'Do' && depth < MAX_FORMS && a[0] && a[0].name && xobj && xobj.dict) {
        const ref = xobj.dict[a[0].name];
        const st = ref && typeof ref.ref === 'string' ? streams.get(ref.ref) : undefined;
        if (st && st.dict.Subtype && st.dict.Subtype.name === 'Form') { const data = await streamOf(ref); if (data) put(await run(data, st.dict.Resources || res, depth + 1)); }
      }
    }
    return out;
  }
  const texts = [];
  try {
    for (const p of pages) {
      const parts = get(p.dict.Contents);
      let t = '';
      for (const c of Array.isArray(parts) ? parts : [p.dict.Contents]) { const data = await streamOf(c); if (data) t += (t ? '\n' : '') + await run(data, p.res, 0); }
      texts.push(t.replace(/[ \t]+\n/g, '\n').trim());
    }
  } catch (e) { return no(String(e.message)); }
  if (!pages.length) return no('the PDF has no page this reader can find');
  let damaged = broken;   // every object must end where it should, and every stream is tried, not only the text's
  for (const [, st] of streams) if (!(await filters(st.dict, st.raw, inflate)).ok) damaged++;
  return { ok: true, pages: texts, text: texts.join('\n\n'), damaged };
}
