#!/usr/bin/env node
// measure/hostile.mjs — the L2b hostile corpus, made only by mechanical changes to the committed benign corpus.
// No exploit payload of any kind: every change is a cut, a flipped bit, zeroed bytes, padding, two benign files
// glued together, an EMPTY inert macro part, or a wrong name. Deterministic: the same corpus gives the same files.
//
//   node measure/hostile.mjs <corpus folder> <out folder>   writes the files and <out>/hostile.json (name, base,
//                                                          kind, declared type, SHA-256, size)
// It runs in its own process (it reads zip archives to add the macro part), so the measured core process never
// loads a reader. The rules, sealed in seal 2, for each benign file B of declared type T:
//   cut-50, cut-90          B's first half, and first 90%
//   flip-0 … flip-7         one bit flipped, at bit floor((k + 0.5) · bits(B) / 8)
//   zeroed                  B's first 16 bytes set to 0
//   oversized               B padded with spaces to one byte past T's cap (written as a recipe, made at measure time)
//   polyglot                B with a benign file of another kind appended (a PDF gets the zip archive; a zip, DOCX
//                           or XLSX gets a PDF; an image gets the zip archive; a text file gets the PDF)
//   macro (DOCX, XLSX)      B re-zipped with an empty vbaProject.bin and the macro-enabled content type
//   mislabelled             B named as another type (PDF↔DOCX, XLSX→CSV, images rotate, text types rotate)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { TYPES, declaredOf } from '../src/edge-in.mjs';
import { entries, read } from '../src/parse/zip.mjs';
import { zipStored } from '../src/edge-out.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const MISLABEL = { pdf: 'docx', docx: 'pdf', xlsx: 'csv', zip: 'docx', png: 'jpeg', jpeg: 'gif', gif: 'webp', webp: 'png', eml: 'ics', ics: 'vcf', vcf: 'csv', csv: 'eml' };

async function macro(bytes, type) {
  const z = entries(bytes);
  if (!z.ok) throw new Error('the benign file is not a zip: ' + z.why);
  const files = [];
  for (const e of z.entries) {
    const r = await read(bytes, e, async (b, n) => new Uint8Array(inflateRawSync(b, { maxOutputLength: Math.max(1, n) })));
    let data = r.bytes;
    if (e.name === '[Content_Types].xml') {
      const kind = type === 'docx' ? 'application/vnd.ms-word.document.macroEnabled.main+xml' : 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
      const part = type === 'docx' ? '/word/document.xml' : '/xl/workbook.xml';
      let t = new TextDecoder().decode(data);
      t = t.replace(new RegExp('(<Override PartName="' + part + '" ContentType=")[^"]*'), '$1' + kind).replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
      data = new TextEncoder().encode(t);
    }
    files.push({ name: e.name, bytes: data });
  }
  files.push({ name: (type === 'docx' ? 'word' : 'xl') + '/vbaProject.bin', bytes: new Uint8Array(0) });
  return zipStored(files);
}

export async function hostile(corpus) {
  const names = readdirSync(corpus).filter((n) => declaredOf(n)).sort();
  const files = Object.fromEntries(names.map((n) => [n, new Uint8Array(readFileSync(join(corpus, n)))]));
  const firstOf = (t) => names.find((n) => declaredOf(n) === t);
  const out = [];
  for (const n of names) {
    const B = files[n], T = declaredOf(n), stem = n.replace(/\.[^.]+$/, ''), ext = n.slice(n.lastIndexOf('.') + 1);
    const add = (kind, bytes, declared = T, name) => out.push({ name: name || stem + '.' + kind + '.' + ext, base: n, kind, declared, bytes });
    add('cut-50', B.slice(0, Math.floor(B.length / 2)));
    add('cut-90', B.slice(0, Math.floor(B.length * 0.9)));
    for (let k = 0; k < 8; k++) { const x = B.slice(); const bit = Math.floor(((k + 0.5) * B.length * 8) / 8); x[bit >> 3] ^= 1 << (bit & 7); add('flip-' + k, x); }
    const z = B.slice(); z.fill(0, 0, Math.min(16, z.length)); add('zeroed', z);
    out.push({ name: stem + '.oversized.' + ext, base: n, kind: 'oversized', declared: T, recipe: { padTo: TYPES[T].max + 1 } });
    const glue = T === 'pdf' || T === 'png' || T === 'jpeg' || T === 'gif' || T === 'webp' ? firstOf('zip') : firstOf('pdf');
    add('polyglot', Uint8Array.from([...B, ...files[glue]]));
    if (T === 'docx' || T === 'xlsx') add('macro', await macro(B, T));   // a macro-enabled file under its plain name
    add('mislabelled', B, MISLABEL[T], stem + '.mislabelled.' + TYPES[MISLABEL[T]].ext[0]);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [corpus, dir] = process.argv.slice(2);
  mkdirSync(dir, { recursive: true });
  const list = await hostile(corpus);
  for (const h of list) if (h.bytes) writeFileSync(join(dir, h.name), h.bytes);
  writeFileSync(join(dir, 'hostile.json'), JSON.stringify(list.map((h) => ({ name: h.name, base: h.base, kind: h.kind, declared: h.declared, ...(h.bytes ? { sha256: sha(h.bytes), size: h.bytes.length } : { recipe: h.recipe }) })), null, 1) + '\n');
  console.log('hostile corpus: ' + list.length + ' files from ' + new Set(list.map((h) => h.base)).size + ' benign ones');
}
