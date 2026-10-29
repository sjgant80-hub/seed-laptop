// ════════════════════════════════════════════════════════════════
// src/parse/office.mjs — DOCX and XLSX, read only ever inside the sandbox (claims L2a, L2b).
//
//   macroOf(names, contentTypes) → why, or null: a macro part (vbaProject.bin) or a macro-enabled content type.
//                                   Office macros are REFUSED as a rule, whatever they hold.
//   docx(bytes, inflateRaw)      → { ok, paragraphs: [text], tables: [[[cell text]]] } | refusal
//   xlsx(bytes, inflateRaw)      → { ok, sheets: [{ name, cells: { A1: text | number | boolean } }] } | refusal
// ════════════════════════════════════════════════════════════════
import { entries, read } from '#zip';
import { tree, walk, textIn, local } from '#xml';

const no = (why) => ({ ok: false, why });
const td = new TextDecoder('utf-8');
const kidsNamed = (n, name) => n.kids.filter((k) => local(k.name) === name);   // a text kid has no name
/** The text of a rich string (a shared string, an inline string): its t, and the t of each run; a phonetic guide is not shown. */
const richText = (n) => n.kids.map((k) => (local(k.name) === 't' ? textIn(k) : local(k.name) === 'r' ? richText(k) : '')).join('');

export function macroOf(names, contentTypes) {
  if (!Array.isArray(names) || typeof contentTypes !== 'string') return 'the file cannot be checked for macros, so it is refused';
  if (names.some((n) => typeof n === 'string' && (/(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)vbaData\.xml$/i.test(n)))) return 'the file carries an Office macro (vbaProject.bin): macros are refused as a rule';
  if (/macroEnabled|vbaProject/i.test(contentTypes)) return 'the file is macro-enabled: macros are refused as a rule';
  return null;
}

async function open(bytes, inflateRaw, want) {
  const z = entries(bytes);
  if (!z.ok) return z;
  const byName = new Map(z.entries.map((e) => [e.name, e]));
  const ct = byName.get('[Content_Types].xml');
  if (!ct) return no('an Office file has [Content_Types].xml');
  const ctr = await read(bytes, ct, inflateRaw);
  if (!ctr.ok) return ctr;
  const why = macroOf([...byName.keys()], td.decode(ctr.bytes));
  if (why) return no(why);
  if (!byName.has(want)) return no('this is not the Office file it says: no ' + want);
  const xml = async (name) => {
    const e = byName.get(name);
    if (!e) return null;
    const r = await read(bytes, e, inflateRaw);
    if (!r.ok) return r;
    const t = tree(td.decode(r.bytes));
    return t.ok ? t.root : t;
  };
  return { ok: true, xml };
}

function paragraphText(p) {
  let s = '';
  walk(p, (n) => {
    const l = local(n.name);
    if (l === 't') s += textIn(n);
    else if (l === 'tab') s += '\t';
    else if (l === 'br' || l === 'cr') s += '\n';
  });
  return s;
}

export async function docx(bytes, inflateRaw) {
  if (typeof inflateRaw !== 'function') return no('no inflate to read it with');
  const o = await open(bytes, inflateRaw, 'word/document.xml');
  if (!o.ok) return o;
  const doc = await o.xml('word/document.xml');
  if (doc.ok === false) return no('word/document.xml does not read: ' + doc.why);   // open() found it, so it is there
  const paragraphs = [], tables = [];
  const visit = (node) => {
    for (const k of node.kids) {
      if (typeof k !== 'object') continue;
      const l = local(k.name);
      if (l === 'p') paragraphs.push(paragraphText(k));
      else if (l === 'tbl') {
        const t = [];
        for (const tr of kidsNamed(k, 'tr')) t.push(kidsNamed(tr, 'tc').map((tc) => kidsNamed(tc, 'p').map(paragraphText).join('\n')));
        tables.push(t);
      } else visit(k);   // a wrapper (sdt, customXml, ins, smartTag…): its paragraphs are the document's too
    }
  };
  visit(doc);   // from the root down: w:document, w:body, and every wrapper in them
  return { ok: true, paragraphs, tables };
}

export function cellIndex(ref) {
  const m = typeof ref === 'string' ? /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref) : null;
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export async function xlsx(bytes, inflateRaw) {
  if (typeof inflateRaw !== 'function') return no('no inflate to read it with');
  const o = await open(bytes, inflateRaw, 'xl/workbook.xml');
  if (!o.ok) return o;
  const wb = await o.xml('xl/workbook.xml');
  if (wb.ok === false) return no('xl/workbook.xml does not read: ' + wb.why);   // open() found it, so it is there
  const rels = await o.xml('xl/_rels/workbook.xml.rels');
  const target = {};
  walk(rels, (n) => { if (local(n.name) === 'Relationship') target[n.attrs.Id] = n.attrs.Target; });   // walk passes over a missing or refused part
  const shared = [];
  walk(await o.xml('xl/sharedStrings.xml'), (n) => { if (local(n.name) === 'si') shared.push(richText(n)); });
  const sheets = [];
  const list = [];
  walk(wb, (n) => { if (local(n.name) === 'sheet') list.push(n); });
  for (const s of list) {
    const rid = Object.entries(s.attrs).find(([k]) => local(k) === 'id');
    let path = rid ? target[rid[1]] : null;
    if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const sh = await o.xml(path);
    if (sh === null || sh.ok === false) return no('sheet ' + String(s.attrs.name).slice(0, 40) + ' does not read');
    const cells = {};
    walk(sh, (c) => {
      if (local(c.name) !== 'c' || !cellIndex(c.attrs.r)) return;
      const t = c.attrs.t || 'n';
      const vt = kidsNamed(c, 'v').map(textIn).join('');
      let value;
      if (t === 's') value = shared[Number(vt)];
      else if (t === 'inlineStr') value = kidsNamed(c, 'is').map(richText).join('');
      else if (t === 'str' || t === 'e') value = vt;
      else if (t === 'b') value = vt === '1';
      else value = vt === '' ? undefined : Number(vt);
      if (value !== undefined && !Number.isNaN(value)) cells[c.attrs.r] = value;
    });
    sheets.push({ name: String(s.attrs.name || ''), cells });
  }
  if (!sheets.length) return no('the workbook names no sheet it holds');
  return { ok: true, sheets };
}
