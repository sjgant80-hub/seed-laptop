// ════════════════════════════════════════════════════════════════
// measure/fidelity.mjs — how much of what a writer was given comes back out of the office's reading (claim L2a).
// Pure, total, gated.
//
//   score(truth, result) → { fields, exact }   fields = how many things the truth names; exact = how many came back
//   For each type, the fields (sealed in seal 2):
//     docx   every non-empty paragraph (whitespace normalised, in any position) and every table cell
//     xlsx   every cell of the named sheet, by its reference: numbers equal as numbers, text after normalising
//     pdf    every word of the text (a multiset: a word counts as often as it occurs), case ignored
//     eml    subject, from, to, date, the text (normalised), and each attachment's name and SHA-256 as one field
//     ics    each event's summary, start, end and location
//     vcf    each contact's name, e-mail and phone, and its organisation and title where it has them
//     csv    every cell, by row and column
//     image  width and height        zip   each entry's name and size as one field
// ════════════════════════════════════════════════════════════════

export const norm = (s) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
export const wordsOf = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {});

export function recall(truthText, gotText) {
  const bag = new Map();
  for (const w of wordsOf(gotText)) bag.set(w, (bag.get(w) || 0) + 1);
  let exact = 0;
  const want = wordsOf(truthText);
  for (const w of want) if (bag.get(w) > 0) { exact++; bag.set(w, bag.get(w) - 1); }
  return { fields: want.length, exact };
}

const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) && String(a).trim() !== '' && String(b).trim() !== '' : typeof a === 'boolean' || typeof b === 'boolean' ? a === b : norm(a) === norm(b));
const tel = (s) => String(s).replace(/[^0-9+]/g, '');

export function score(truth, result) {
  try {
    const t = obj(truth), r = obj(result);
    let fields = 0, exact = 0;
    const field = (ok) => { fields++; if (ok) exact++; };
    if (t.type === 'pdf') return recall(t.text, r.text);
    if (t.type === 'docx') {
      const paras = arr(r.paragraphs).map(norm);
      const cells = arr(r.tables).flat(2).map(norm);
      for (const p of arr(t.paragraphs).map(norm).filter(Boolean)) field(paras.includes(p));
      for (const c of arr(t.cells).map(norm)) field(cells.includes(c));
    } else if (t.type === 'xlsx') {
      const sheet = arr(r.sheets).find((s) => s && s.name === t.sheet);
      const got = obj(sheet && sheet.cells);
      for (const [ref, v] of Object.entries(obj(t.cells))) field(Object.prototype.hasOwnProperty.call(got, ref) && same(v, got[ref]));
    } else if (t.type === 'eml') {
      for (const k of ['subject', 'from', 'to', 'date']) field(norm(t[k]) === norm(r[k]));
      field(norm(t.text) === norm(r.text));
      const atts = arr(r.attachments);
      for (const a of arr(t.attachments)) field(atts.some((x) => x && x.name === a.name && x.sha256 === a.sha256));
    } else if (t.type === 'ics') {
      const evs = arr(r.events);
      for (const e of arr(t.events)) {
        const g = obj(evs.find((x) => x && norm(x.uid) === norm(e.uid)));
        for (const k of ['summary', 'start', 'end', 'location']) field(norm(g[k]) === norm(e[k]));
      }
    } else if (t.type === 'vcf') {
      const cs = arr(r.contacts);
      for (const c of arr(t.contacts)) {
        const g = obj(cs.find((x) => x && norm(x.fn) === norm(c.fn)));
        field(norm(g.fn) === norm(c.fn));
        field(arr(g.emails).includes(c.email));
        field(arr(g.tels).map(tel).includes(tel(c.tel)));
        if (c.org) field(norm(g.org) === norm(c.org));
        if (c.title) field(norm(g.title) === norm(c.title));
      }
    } else if (t.type === 'csv') {
      const rows = arr(r.rows);
      arr(t.rows).forEach((row, i) => arr(row).forEach((v, j) => field(same(v, arr(rows[i])[j]))));
    } else if (['png', 'jpeg', 'gif', 'webp'].includes(t.type)) {
      field(r.width === t.width); field(r.height === t.height);
    } else if (t.type === 'zip') {
      const es = arr(r.entries);
      for (const e of arr(t.entries)) field(es.some((x) => x && x.name === e.name && x.size === e.size));
    }
    return { fields, exact };
  } catch { return { fields: 0, exact: 0 }; }
}
