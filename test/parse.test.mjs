// test/parse.test.mjs — the readers that run only in the sandbox: each on files written by real writers (the dev
// fixtures in test/fixtures/dev, made on this laptop with ReportLab, PyMuPDF, Chrome, Pillow and Python's email) and
// by the office's own writers, and each refusing what is broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync, inflateSync, deflateSync } from 'node:zlib';
import { entries, read, crc32, safeName, MAX_ENTRIES, MAX_NAME, MAX_TOTAL, MAX_RATIO } from '../src/parse/zip.mjs';
import { tree, walk, textIn, local, decode, MAX_DEPTH } from '../src/parse/xml.mjs';
import { docx, xlsx, macroOf, cellIndex } from '../src/parse/office.mjs';
import { csv, ics, vcf, lines } from '../src/parse/text.mjs';
import { eml, qp, b64, words, headers, params, charsetDecode } from '../src/parse/mail.mjs';
import { image } from '../src/parse/image.mjs';
import { pdf, lex, filters } from '../src/parse/pdf.mjs';
import { parse, pngIntact, jpegIntact, gifIntact, webpIntact } from '../src/parse/index.mjs';
import { zipStored, docx as writeDocx, xlsx as writeXlsx, pdf as writePdf, eml as writeEml, ics as writeIcs, csv as writeCsv } from '../src/edge-out.mjs';

const fx = (n) => new Uint8Array(readFileSync(new URL('./fixtures/dev/' + n, import.meta.url)));
const enc = new TextEncoder();
const platform = { inflateRaw: async (b, n) => new Uint8Array(inflateRawSync(b, { maxOutputLength: Math.max(1, n) })), inflate: async (b) => new Uint8Array(inflateSync(b)) };
const words_ = (s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const DEV = readFileSync(new URL('./fixtures/dev/dev.txt', import.meta.url), 'utf8');

/** A zip with one deflated entry, written by hand (the office's own writer only stores). */
function deflatedZip(name, data) {
  const raw = deflateRawSync(data), n = enc.encode(name), crc = crc32(data);
  const u16 = (x) => [x & 255, (x >>> 8) & 255], u32 = (x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255];
  const common = [...u16(20), ...u16(0x800), ...u16(8), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(raw.length), ...u32(data.length), ...u16(n.length), ...u16(0)];
  const local = [...u32(0x04034b50), ...common, ...n, ...raw];
  const central = [...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0), ...n];
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return Uint8Array.from([...local, ...central, ...end]);
}

test('zip: entries and reads, stored and deflated, CRC checked', async () => {
  const z = zipStored([{ name: 'a.txt', text: 'hello' }, { name: 'dir/b.txt', text: 'world!' }]);
  const e = entries(z);
  assert.equal(e.ok, true);
  assert.deepEqual(e.entries.map((x) => [x.name, x.usize, x.method]), [['a.txt', 5, 0], ['dir/b.txt', 6, 0]]);
  assert.equal(new TextDecoder().decode((await read(z, e.entries[1], platform.inflateRaw)).bytes), 'world!');
  const d = deflatedZip('big.txt', enc.encode('x'.repeat(5000)));
  const de = entries(d);
  assert.equal(de.entries[0].method, 8);
  assert.equal((await read(d, de.entries[0], platform.inflateRaw)).bytes.length, 5000);
  const bad = z.slice(); bad[30 + 5] ^= 1;   // a byte of the first entry's data
  assert.match((await read(bad, entries(bad).entries[0], platform.inflateRaw)).why, /CRC-32/);
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('zip: refusals by name', async () => {
  const z = zipStored([{ name: 'a.txt', text: 'hello' }]);
  assert.match(entries(new Uint8Array(10)).why, /not a zip/);
  assert.match(entries(Uint8Array.from([0, ...z])).why, /local file header/, 'something glued in front');
  assert.match(entries(Uint8Array.from([...z, 0])).why, /end record/, 'something glued after');
  assert.match(entries(z.slice(0, z.length - 3)).why, /end record/);
  const enc1 = z.slice(); const cd = z.length - 22 - (46 + 5); enc1[cd + 8] |= 1;
  assert.match(entries(enc1).why, /encrypted/);
  const meth = z.slice(); meth[cd + 10] = 99;
  assert.match(entries(meth).why, /method 99/);
  assert.match(entries(zipStored([{ name: '../x', text: '' }])).why, /reach outside/);
  assert.match(entries(zipStored([{ name: 'a', text: '' }, { name: 'a', text: '' }])).why, /two entries/);
  const bomb = deflatedZip('b', new Uint8Array(3 << 20));
  assert.match(entries(bomb).why, /zip bomb/);
  const lie = deflatedZip('c', enc.encode('y'.repeat(100)));
  const lc = lie.length - 22 - (46 + 1); lie[lc + 24] = 200;   // the directory says 200 bytes
  assert.match((await read(lie, entries(lie).entries[0], platform.inflateRaw)).why, /declared size/);
  assert.equal((await read('x', {}, platform.inflateRaw)).ok, false);
  assert.match((await read(z, { ...entries(z).entries[0], offset: 3 }, platform.inflateRaw)).why, /no local header/);
  assert.equal(safeName('a/b.txt'), true);
  for (const n of ['', '/abs', 'a\\b', 'C:x', 'a/../b', 'x'.repeat(MAX_NAME + 1), 5]) assert.equal(safeName(n), false, String(n));
  assert.equal(safeName('x'.repeat(MAX_NAME)), true);
  assert.ok(MAX_ENTRIES > 1000);
});

const le16 = (x) => [x & 255, (x >>> 8) & 255], le32 = (x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255];
/** A central directory entry field by field: the edges of entries() need ones no writer makes. */
const cdOf = ({ name = 'a', offset = 0, csize = 0, usize = 0, crc = 0, sig = 0x02014b50 } = {}) => { const n = enc.encode(name); return [...le32(sig), ...le16(20), ...le16(20), ...le16(0x800), ...le16(0), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(csize), ...le32(usize), ...le16(n.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...n]; };
const LOCAL30 = [...le32(0x04034b50), ...new Array(26).fill(0)];   // a local header with no name and no data
const handZip = (body, cds, comment = 0) => { const cd = cds.flat(); return Uint8Array.from([...body, ...cd, ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(cds.length), ...le16(cds.length), ...le32(cd.length), ...le32(body.length), ...le16(comment), ...new Array(comment).fill(0)]); };

test('zip at its exact edges', async () => {
  assert.equal(entries(handZip(LOCAL30, [cdOf()])).ok, true, 'an entry may start exactly 30 bytes before the directory');
  assert.match(entries(handZip(LOCAL30, [cdOf({ offset: 1 })])).why, /starts past the data/);
  assert.equal(entries(handZip(LOCAL30, [cdOf()], 65535)).ok, true, 'the longest comment there is');
  assert.match(entries(handZip(LOCAL30, [cdOf({ sig: 0x02014b51 })])).why, /entry 0 is broken/);
  assert.match(entries(handZip(LOCAL30, [cdOf({ name: '' })])).why, /reach outside/, 'a nameless entry that ends the directory exactly');
  assert.match(entries(Uint8Array.from([...le32(0x04034b50), ...new Array(18).fill(0)])).why, /end record/, '22 bytes are enough to be looked at');
  const many = (n) => handZip(LOCAL30, Array.from({ length: n }, (_, k) => cdOf({ name: 'e' + k })));
  assert.equal(entries(many(MAX_ENTRIES)).entries.length, MAX_ENTRIES);
  assert.match(entries(many(MAX_ENTRIES + 1)).why, /more than/);
  assert.equal(entries(handZip(LOCAL30, [cdOf({ usize: MAX_TOTAL, csize: MAX_TOTAL })])).ok, true, 'exactly MAX_TOTAL');
  assert.match(entries(handZip(LOCAL30, [cdOf({ usize: MAX_TOTAL + 1, csize: MAX_TOTAL })])).why, /more than/);
  assert.equal(entries(handZip(LOCAL30, [cdOf({ usize: 6000 * MAX_RATIO, csize: 6000 })])).ok, true, 'exactly MAX_RATIO times its size');
  assert.match(entries(handZip(LOCAL30, [cdOf({ usize: 6000 * MAX_RATIO + 1, csize: 6000 })])).why, /zip bomb/);
  assert.equal(entries(handZip(LOCAL30, [cdOf({ usize: 1 << 20, csize: 1 })])).ok, true, 'up to 1 MB may pack as tight as it likes');
  assert.match(entries(handZip(LOCAL30, [cdOf({ usize: (1 << 20) + 1, csize: 1 })])).why, /zip bomb/);
  const only = Uint8Array.from(LOCAL30);
  const e0 = { name: 'a', offset: 0, csize: 0, usize: 0, crc: 0, method: 0 };
  assert.deepEqual(await read(only, e0, platform.inflateRaw), { ok: true, bytes: new Uint8Array(0) }, 'a local header that ends the file exactly');
  assert.match((await read(only, { ...e0, csize: 1 }, platform.inflateRaw)).why, /runs past the file/);
  assert.match((await read(only, { ...e0, offset: 1 }, platform.inflateRaw)).why, /no local header/);
  assert.match((await read(new Int8Array(only), e0, platform.inflateRaw)).why, /not an entry/);
  assert.match((await read(Object.create(Uint8Array.prototype), e0, platform.inflateRaw)).why, /not an entry/);
});

test('xml at its exact edges: caps, code points, top-level text, walk and textIn on anything', () => {
  assert.equal(decode('&#x10FFFF;'), String.fromCodePoint(0x10ffff), 'the last code point');
  assert.equal(decode('&#xDFFF;'), '�', 'the last surrogate');
  assert.equal(decode('&#xD7FF;'), String.fromCodePoint(0xd7ff));
  assert.equal(decode('&#xE000;'), String.fromCodePoint(0xe000));
  assert.equal(tree(' '.repeat(10), { text: 10 }).ok, true);
  assert.match(tree(' '.repeat(11), { text: 10 }).why, /at most 10 /);
  assert.equal(tree('<a/>'.repeat(3), { nodes: 3 }).ok, true);
  assert.match(tree('<a/>'.repeat(4), { nodes: 3 }).why, /more than 3 elements/);
  assert.equal(tree('<a><a></a></a>', { depth: 2 }).ok, true);
  assert.match(tree('<a><a><a></a></a></a>', { depth: 2 }).why, /deeper than 2/);
  for (const bad of [0, -1, 1.5, '3', NaN]) assert.equal(tree('<a/><a/>', { nodes: bad }).ok, true, 'a cap that is not a positive whole number is the default: ' + bad);
  assert.equal(tree('<a/>', new Proxy({}, { get() { throw new Error('x'); } })).ok, true);
  assert.deepEqual(tree('<?x?>\n<a/>\n').root.kids.map((k) => k.name), ['a'], 'text between top-level parts is not kept');
  assert.deepEqual(tree('<a><b/></a>').root.kids[0].kids.map((k) => k.name), ['b']);
  const seen = [], f = (n) => seen.push(n.name);
  walk(null, f); walk({ name: 'x' }, f); walk({ name: 'y', kids: 'no' }, f); walk('str', f);
  assert.deepEqual(seen, [], 'walk passes over anything that is not a node');
  walk({ name: 'r', kids: [null, 'text', 5, { name: 'k', kids: [] }, { name: 'bad' }] }, f);
  assert.deepEqual(seen, ['r', 'k']);
  assert.equal(textIn(null), ''); assert.equal(textIn({}), ''); assert.equal(textIn({ kids: 'xyz' }), '');
  assert.equal(textIn({ kids: ['a', { kids: ['b'] }, 'c'] }), 'abc');
  assert.equal(textIn({ kids: ['a', { kids: 'b' }] }), '', 'a broken node anywhere: no text at all');
});

test('xml: elements, attributes, entities, CDATA; a doctype is refused', () => {
  const t = tree('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y=\'q\'><b>t &lt;x&gt; &#65;&#x42;</b><c/><![CDATA[<raw>]]></a>');
  assert.equal(t.ok, true);
  const a = t.root.kids[0];
  assert.equal(a.name, 'a');
  assert.deepEqual(a.attrs, { x: '1 & 2', y: 'q' });
  assert.equal(textIn(a.kids[0]), 't <x> AB');
  assert.equal(a.kids[1].name, 'c');
  assert.equal(a.kids[2], '<raw>');
  const names = []; walk(t.root, (n) => names.push(n.name));
  assert.deepEqual(names, ['#document', 'a', 'b', 'c']);
  assert.match(tree('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>').why, /document type declaration is refused/);
  assert.equal(decode('&unknown;'), '&unknown;');
  assert.equal(decode('&#xD800;'), '�');
  assert.equal(decode('&#1114112;'), '�');
  assert.equal(local('w:t'), 't');
  for (const bad of ['<a>', '<a></b>', '<a', '<!-- x', '<![CDATA[x', '<?x', '</a>', '< >']) assert.equal(tree(bad).ok, false, bad);
  assert.equal(tree(5).ok, false);
  assert.match(tree('<a>'.repeat(MAX_DEPTH + 1)).why, /deeper/);
  assert.equal(tree('<a>'.repeat(MAX_DEPTH) + '</a>'.repeat(MAX_DEPTH)).ok, true);
});

test('docx: paragraphs, line breaks, tabs and a table — from the office\'s writer', async () => {
  const r = await docx(writeDocx({ paragraphs: ['First', 'Two\nlines', 'Tab\there'], table: [['A', 'B'], ['1', '2']] }), platform.inflateRaw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.paragraphs.filter(Boolean), ['First', 'Two\nlines', 'Tab\there']);
  assert.deepEqual(r.tables, [[['A', 'B'], ['1', '2']]]);
});

test('xlsx: text, numbers and booleans by cell reference', async () => {
  const r = await xlsx(writeXlsx({ sheets: [{ name: 'S', rows: [['a', 1.5, true], ['b', 2, false]] }, { name: 'T', rows: [['z']] }] }), platform.inflateRaw);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sheets[0], { name: 'S', cells: { A1: 'a', B1: 1.5, C1: true, A2: 'b', B2: 2, C2: false } });
  assert.deepEqual(r.sheets[1].cells, { A1: 'z' });
  assert.deepEqual(cellIndex('AB12'), { col: 28, row: 12 });
  assert.equal(cellIndex('a1'), null);
});

test('docx and xlsx at their edges: wrappers, properties, shared and rich strings, every cell type, missing parts', async () => {
  const CT = { name: '[Content_Types].xml', text: '<Types/>' };
  const p = (t) => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>';
  const doc = (body) => zipStored([CT, { name: 'word/document.xml', text: '<w:document xmlns:w="urn:w"><w:body>' + body + '</w:body></w:document>' }]);
  const d = await docx(doc(p('one') + '<w:sdt><w:sdtPr/><w:sdtContent>' + p('two') + '</w:sdtContent></w:sdt><w:customXml>' + p('three') + '</w:customXml>\n  <w:tbl>\n  <w:tblPr/>\n  <w:tr><w:trPr/>\n  <w:tc><w:tcPr/>' + p('cell') + '</w:tc></w:tr></w:tbl>'), platform.inflateRaw);
  assert.deepEqual(d.paragraphs, ['one', 'two', 'three'], 'paragraphs inside wrappers are the document\'s');
  assert.deepEqual(d.tables, [[['cell']]], 'row and cell properties are not cells or paragraphs');
  assert.match((await docx(zipStored([CT, { name: 'word/document.xml', text: '<w:document><w:body>' }]), platform.inflateRaw)).why, /does not read: an element never closes/);
  const book = (parts) => zipStored([CT, { name: 'xl/workbook.xml', text: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' }, ...parts]);
  const RELS = { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' };
  const SS = { name: 'xl/sharedStrings.xml', text: '<sst><si><t>plain</t></si><si><r><rPr/><t>ri</t></r><r><t>ch</t></r></si><si><t>kan</t><rPh><t>phonetic</t></rPh></si></sst>' };
  const sheet = '<worksheet><sheetData><row r="1">'
    + '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>'
    + '<c r="D1" t="str"><f>A1&amp;B1</f><v>plainrich</v></c><c r="E1" t="e"><v>#DIV/0!</v></c>'
    + '<c r="F1"><f>1+1</f><v>2</v></c><c r="G1"/><c r="H1"><v></v></c><c r="i1"><v>9</v></c>'
    + '<c r="J1" t="inlineStr"><is><r><t>in</t></r><r><t>line</t></r></is></c><c r="K1"><v>abc</v></c>'
    + '</row></sheetData></worksheet>';
  const x = await xlsx(book([RELS, SS, { name: 'xl/worksheets/sheet1.xml', text: sheet }]), platform.inflateRaw);
  assert.deepEqual(x.sheets, [{ name: 'S', cells: { A1: 'plain', B1: 'rich', C1: 'kan', D1: 'plainrich', E1: '#DIV/0!', F1: 2, J1: 'inline' } }], 'no empty cell, no bad reference, no phonetic guide, no NaN');
  assert.match((await xlsx(book([{ name: 'xl/worksheets/sheet1.xml', text: sheet }]), platform.inflateRaw)).why, /names no sheet/, 'no relationships: no sheet can be found');
  assert.match((await xlsx(book([RELS]), platform.inflateRaw)).why, /sheet S does not read/, 'a sheet named but not there');
  assert.match((await xlsx(book([RELS, { name: 'xl/worksheets/sheet1.xml', text: '<worksheet>' }]), platform.inflateRaw)).why, /sheet S does not read/);
  assert.match((await xlsx(zipStored([CT, { name: 'xl/workbook.xml', text: '<workbook>' }]), platform.inflateRaw)).why, /workbook.xml does not read: an element never closes/);
  const noShared = await xlsx(book([RELS, { name: 'xl/worksheets/sheet1.xml', text: '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1</v></c></row></sheetData></worksheet>' }]), platform.inflateRaw);
  assert.deepEqual(noShared.sheets[0].cells, { B1: 1 }, 'a shared string that is not there is no value');
});

test('office macros are refused, whatever they hold; an Office file that is not one is refused', async () => {
  assert.match(macroOf(['word/vbaProject.bin'], ''), /macro/);
  assert.match(macroOf(['x'], 'application/vnd.ms-word.document.macroEnabled.main+xml'), /macro-enabled/);
  assert.equal(macroOf(['word/document.xml'], 'plain'), null);
  const withMacro = zipStored([{ name: '[Content_Types].xml', text: '<Types/>' }, { name: 'word/document.xml', text: '<w:document/>' }, { name: 'word/vbaProject.bin', bytes: new Uint8Array(0) }]);
  assert.match((await docx(withMacro, platform.inflateRaw)).why, /macros are refused/);
  assert.match((await docx(zipStored([{ name: 'word/document.xml', text: '<x/>' }]), platform.inflateRaw)).why, /Content_Types/);
  assert.match((await xlsx(writeDocx({ paragraphs: ['x'] }), platform.inflateRaw)).why, /not the Office file/);
  assert.match((await docx(zipStored([{ name: '[Content_Types].xml', text: '<T/>' }, { name: 'word/document.xml', text: '<!DOCTYPE x><x/>' }]), platform.inflateRaw)).why, /does not read/);
});

test('csv: quotes, doubled quotes, newlines in cells, CRLF, a BOM, the delimiter', () => {
  assert.deepEqual(csv('﻿a,"b ""c""","d\ne"\r\n1,2,3\n').rows, [['a', 'b "c"', 'd\ne'], ['1', '2', '3']]);
  assert.equal(csv('a;b;c\n1;2;3').delimiter, ';');
  assert.equal(csv('a\tb\n').delimiter, '\t');
  assert.deepEqual(csv('a,b').rows, [['a', 'b']]);
  assert.match(csv('"open').why, /never ends/);
  assert.equal(csv(5).ok, false);
  assert.deepEqual(csv(new TextDecoder().decode(writeCsv([['x', 'say "hi"'], ['', ' pad ']]))).rows, [['x', 'say "hi"'], ['', ' pad ']]);
});

test('ics and vcf: unfolded lines, escapes, the fields the office reads', () => {
  const cal = ics(new TextDecoder().decode(writeIcs({ stamp: '20261029T120000Z', events: [{ uid: 'u1', start: '20261102T090000Z', end: '20261102T100000Z', summary: 'Meet; then lunch, ' + 'x'.repeat(90), location: 'Hall' }] })));
  assert.equal(cal.ok, true);
  assert.deepEqual(cal.events[0], { uid: 'u1', summary: 'Meet; then lunch, ' + 'x'.repeat(90), start: '20261102T090000Z', end: '20261102T100000Z', location: 'Hall', description: '' });
  assert.equal(ics('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=Europe/London:20261102T090000\nEND:VEVENT\nEND:VCALENDAR').events[0].start, 'Europe/London:20261102T090000');
  assert.match(ics('nope').why, /BEGIN:VCALENDAR/);
  const cards = vcf('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann\\, Baker\r\nN:Baker;Ann\r\nEMAIL;TYPE=INTERNET:ann@example.com\r\nTEL;TYPE=CELL:+44 7700 900111\r\nitem1.TEL:tel:+44 7700 900222\r\nORG:Bakery;Front\r\nTITLE:Owner\r\nEND:VCARD\r\n');
  assert.deepEqual(cards.contacts[0], { fn: 'Ann, Baker', n: 'Baker;Ann', emails: ['ann@example.com'], tels: ['+44 7700 900111', '+44 7700 900222'], org: 'Bakery', title: 'Owner' });
  assert.match(vcf('BEGIN:VCALENDAR').why, /BEGIN:VCARD/);
  assert.equal(ics(5).ok, false); assert.equal(vcf(null).ok, false);
  assert.deepEqual(lines('A;X="a:b";Y=c:v\n folded\nnocolon\n'), [{ name: 'A', params: { X: 'a:b', Y: 'c' }, value: 'vfolded' }]);
});

test('email: headers, encoded words, multipart, transfer encodings, attachments by hash', async () => {
  const r = await eml(fx('dev.eml'));
  assert.equal(r.ok, true);
  assert.equal(r.subject, 'Rye loaf — Friday');
  assert.equal(r.from, 'Baker Ann <ann@example.com>');
  assert.equal(r.text.trim(), 'The rye sold out.\nMore on Friday.');
  assert.match(r.html, /<p>The rye sold out.<\/p>/);
  assert.equal(r.attachments.length, 1);
  assert.equal(r.attachments[0].name, 'stock.csv');
  assert.equal(r.attachments[0].size, 15);
  const own = await eml(writeEml({ from: 'A <a@example.com>', to: 'b@example.org', subject: 'Café ✓', date: 'Thu, 29 Oct 2026 12:00:00 +0000', id: 'z', text: 'line one\n' + 'é'.repeat(60) }));
  assert.equal(own.subject, 'Café ✓');
  assert.equal(own.text, 'line one\n' + 'é'.repeat(60) + '\n');
  assert.equal(own.messageId, '<z@example.com>');
  assert.match((await eml(enc.encode('no headers here'))).why, /headers/);
  assert.equal((await eml('x')).ok, false);
  assert.equal(new TextDecoder().decode(qp('a=3Db=\r\nc')), 'a=bc');
  assert.equal(new TextDecoder().decode(qp('a_b', true)), 'a b');
  assert.equal(new TextDecoder().decode(b64('aGk=')), 'hi');
  assert.equal(b64('*').length, 0);
  assert.equal(words('=?UTF-8?B?Y2Fmw6k=?= =?UTF-8?Q?_ok?='), 'café ok');
  assert.equal(words('=?ISO-8859-1?Q?caf=E9?='), 'café');
  assert.deepEqual(headers('A: 1\r\nB: two\r\n  folded\r\nA: again'), { a: '1', b: 'two folded' });
  assert.deepEqual(params('text/plain; charset="utf-8"; name*=UTF-8\'\'caf%C3%A9.txt'), { value: 'text/plain', charset: 'utf-8', name: 'café.txt' });
  assert.equal(charsetDecode(Uint8Array.of(0xe9), 'nonsense-charset'), '�');
  const nested = 'From: a@example.com\r\nContent-Type: multipart/mixed; boundary="X"\r\n\r\n--X\r\nContent-Type: multipart/alternative; boundary="Y"\r\n\r\n--Y\r\nContent-Type: text/plain\r\n\r\ninner\r\n--Y--\r\n--X\r\nContent-Type: image/png; name="p.png"\r\nContent-Transfer-Encoding: base64\r\n\r\naGk=\r\n--X--\r\n';
  const n = await eml(enc.encode(nested));
  assert.equal(n.text.trim(), 'inner');
  assert.deepEqual(n.attachments.map((a) => [a.name, a.type, a.size]), [['p.png', 'image/png', 2]]);
});

test('images: type and size from the header, never the pixels', () => {
  assert.deepEqual(image(fx('dev.png')), { ok: true, type: 'png', width: 33, height: 21 });
  assert.deepEqual(image(fx('dev.jpg')), { ok: true, type: 'jpeg', width: 40, height: 30 });
  assert.deepEqual(image(fx('dev.gif')), { ok: true, type: 'gif', width: 17, height: 9 });
  assert.deepEqual(image(fx('dev-lossy.webp')), { ok: true, type: 'webp', width: 24, height: 18 });
  assert.deepEqual(image(fx('dev-lossless.webp')), { ok: true, type: 'webp', width: 25, height: 15 });
  assert.match(image(new Uint8Array(20)).why, /not a PNG/);
  assert.equal(image('x').ok, false);
  const badPng = fx('dev.png').slice(); badPng[12] = 0x41;
  assert.match(image(badPng).why, /IHDR/);
});

test('the integrity walks: intact files pass, damaged ones are named', () => {
  assert.equal(pngIntact(fx('dev.png')), null);
  const p = fx('dev.png').slice(); p[40] ^= 1;
  assert.match(pngIntact(p), /CRC/);
  assert.match(pngIntact(fx('dev.png').slice(0, 60)), /past the file|no IEND/);
  assert.match(pngIntact(Uint8Array.from([...fx('dev.png'), 0])), /after/);
  assert.equal(jpegIntact(fx('dev.jpg')), null);
  assert.match(jpegIntact(fx('dev.jpg').slice(0, 300)), /no end marker|past the file/);
  assert.match(jpegIntact(Uint8Array.from([...fx('dev.jpg'), 1])), /after/);
  assert.equal(gifIntact(fx('dev.gif')), null);
  assert.match(gifIntact(fx('dev.gif').slice(0, 40)), /never ends|no trailer|past the file/);
  assert.match(gifIntact(Uint8Array.from([...fx('dev.gif'), 0])), /after/);
  assert.equal(webpIntact(fx('dev-lossy.webp')), null);
  assert.match(webpIntact(Uint8Array.from([...fx('dev-lossy.webp'), 0, 0])), /add up/);
});

test('pdf: real writers\' text comes back word for word', async () => {
  for (const f of ['dev-reportlab.pdf', 'dev-chrome.pdf', 'dev-pymupdf-objstm.pdf']) {
    const r = await pdf(fx(f), platform.inflate);
    assert.equal(r.ok, true, f);
    const got = new Set(words_(r.text));
    for (const w of words_(DEV)) assert.ok(got.has(w), f + ' lost "' + w + '"');
  }
  const two = await pdf(fx('dev-pymupdf-objstm.pdf'), platform.inflate);
  assert.equal(two.pages.length, 2);
  assert.match(two.pages[1], /Friday market/);
  const own = await pdf(writePdf({ paragraphs: ['Héllo (world) — £5', 'second\\line'] }), platform.inflate);
  assert.equal(own.text, 'Héllo (world) — £5\nsecond\\line', 'the blank line between paragraphs reads as one line break');
  assert.equal(own.damaged, 0);
});

test('pdf: streams in hex and ASCII85, a ToUnicode CMap, Differences; refusals', async () => {
  const content = 'BT /F1 12 Tf 10 700 Td <0001> Tj ET BT /F2 12 Tf 10 680 Td (\\001) Tj ET';
  const hexBody = Buffer.from(content).toString('hex') + '>';
  const cmap = '/CIDInit begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfchar <0001> <0057> endbfchar 1 beginbfrange <0002> <0003> [<0041> <0042>] endbfrange endcmap';
  const a85 = (s) => { const b = Buffer.from(s); let out = ''; for (let i = 0; i < b.length; i += 4) { const chunk = b.subarray(i, i + 4); let v = 0; for (let k = 0; k < 4; k++) v = v * 256 + (chunk[k] || 0); let g = ''; for (let k = 0; k < 5; k++) { g = String.fromCharCode(33 + (v % 85)) + g; v = Math.floor(v / 85); } out += g.slice(0, chunk.length + 1); } return out + '~>'; };
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + hexBody.length + ' /Filter /ASCIIHexDecode >>\nstream\n' + hexBody + '\nendstream',
    '<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>',
    '<< /Length 999 /Filter /ASCII85Decode >>\nstream\n' + a85(cmap) + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /Encoding << /Differences [1 /sterling] >> >>',
  ];
  let s = '%PDF-1.4\n';
  objs.forEach((o, i) => { s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  s += 'trailer << /Root 1 0 R >>\n%%EOF\n';
  const r = await pdf(Uint8Array.from(s, (c) => c.charCodeAt(0)), platform.inflate);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'W\n£');
  assert.match((await pdf(enc.encode('not a pdf'), platform.inflate)).why, /%PDF-/);
  assert.match((await pdf(enc.encode('%PDF-1.4\n%%EOF'), platform.inflate)).why, /no catalog/);
  assert.match((await pdf(enc.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] >>\nendobj\n%%EOF'), platform.inflate)).why, /no page/);
  const unended = await pdf(enc.encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page >> junk\nendobj\n%%EOF'), platform.inflate);
  assert.equal(unended.damaged, 1, 'an object that does not end at endobj is damage');
  assert.equal((await pdf('x', platform.inflate)).ok, false);
  const lx = lex('<< /A (a\\(b\\)\\101) /B <4142> /C [1 2.5 -3] /D true /E null /F 3 0 R >>', 0);
  assert.deepEqual(lx.next(), { dict: { A: { str: 'a(b)A' }, B: { str: 'AB' }, C: [1, 2.5, -3], D: true, E: null, F: { ref: '3 0' } } });
});

// ── the PDF reader, part by part: hand-made files, each built to sit at one edge of one rule ──
const latin1 = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
/** A PDF from object bodies, object k + 1 at index k (undefined = no such object); no cross-reference table, the reader needs none. */
const pdfOf = (objs) => latin1('%PDF-1.7\n' + objs.map((o, k) => (o === undefined ? '' : (k + 1) + ' 0 obj\n' + o + '\nendobj\n')).join('') + 'trailer << /Root 1 0 R >>\n%%EOF\n');
const st = (dict, body) => '<< ' + dict + ' /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream';
const CAT = '<< /Type /Catalog /Pages 2 0 R >>', PAGES = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
const HELV = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
const PAGE = (res) => '<< /Type /Page /Parent 2 0 R ' + (res === null ? '' : '/Resources ' + res) + ' /Contents 4 0 R >>';
/** One page: its content is object 4, font /F1 is object 5, more objects from 6. */
const page = (content, { res = '<< /Font << /F1 5 0 R >> >>', more = [], stream = st('', content) } = {}) => pdfOf([CAT, PAGES, PAGE(res), stream, HELV, ...more]);
const readPdf = (b, caps) => pdf(b, platform.inflate, caps);
const textOf = async (content, opts) => { const r = await readPdf(page(content, opts)); assert.equal(r.ok, true, r.why); return r.text; };
const all = (s) => { const lx = lex(s, 0), out = []; for (let v; (v = lx.next()) !== undefined;) out.push(v); return out; };

test('pdf lex: comments, the end, literal and hex strings, escapes, names, dictionaries, arrays', () => {
  assert.deepEqual(all('1 % a comment\r2 %c\n3 %c\r\n4'), [1, 2, 3, 4]);
  const tail = lex('1 %c', 0); tail.next();
  assert.equal(tail.next(), undefined); assert.equal(tail.at, 4, 'a comment at the end stops at the end');
  const end = lex('7', 0);
  assert.equal(end.next(), 7); assert.equal(end.next(), undefined); assert.equal(end.at, 1, 'nothing is read past the end');
  assert.deepEqual(all('true false null'), [true, false, null]);
  assert.deepEqual(all('(a\\\r\nb) (a\\\rb) (a\\\nb) (\\q) (x\\'), [{ str: 'ab' }, { str: 'ab' }, { str: 'ab' }, { str: 'q' }, { str: 'x' }], 'line continuations, an unknown escape, a backslash at the end');
  assert.deepEqual(all('(abc'), [{ str: 'abc' }], 'a string the text ends inside');
  assert.deepEqual(all('(a(b)c) (\\0101)'), [{ str: 'a(b)c' }, { str: '\b1' }]);
  assert.deepEqual(all('1<41> <414> <41'), [1, { str: 'A' }, { str: 'A@' }, { str: 'A' }], 'hex right after a number; odd digits; one the text ends inside');
  const after = lex('<41> 5', 0); after.next();
  assert.equal(after.next(), 5);
  assert.deepEqual(all('/A#42c/D /'), [{ name: 'ABc' }, { name: 'D' }, { name: '' }]);
  assert.deepEqual(all('<< /A 1 /B [2 3] >> [4 [5]] [6'), [{ dict: { A: 1, B: [2, 3] } }, [4, [5]], [6]]);
  assert.deepEqual(all('<< 5 6 >>'), [{ dict: {} }, 6, { op: '>' }, { op: '>' }], 'a key that is not a name ends the dictionary');
  assert.deepEqual(all('<< null >>'), [{ dict: {} }, { op: '>' }, { op: '>' }]);
  const proto = all('<< /__proto__ /x >>')[0].dict;
  assert.equal(Object.getPrototypeOf(proto), Object.prototype, 'a key named __proto__ is only a key');
  assert.deepEqual(Object.getOwnPropertyDescriptor(proto, '__proto__').value, { name: 'x' });
  assert.deepEqual(all('3 0 R 1.5 0 R'), [{ ref: '3 0' }, 1.5, 0, { op: 'R' }]);
  assert.deepEqual(all('BT ET'), [{ op: 'BT' }, { op: 'ET' }]);
  assert.equal(lex(5, 0).next(), undefined);
  assert.equal(lex('1', -1).next(), undefined);
});

test('pdf filters: Flate, ASCIIHex and ASCII85 by full and short names, chained; image codecs are not text; damage is named', async () => {
  const f = (Filter, raw) => filters(Filter === undefined ? {} : { Filter }, latin1(raw), platform.inflate);
  const txt = (r) => Buffer.from(r.bytes).toString('latin1');
  assert.equal(txt(await f(undefined, 'plain')), 'plain');
  for (const n of ['ASCII85Decode', 'A85']) assert.equal(txt(await f({ name: n }, '<~87cURD_*#4DfTZ)+T~>')), 'Hello, World!', n);
  assert.equal(txt(await f({ name: 'A85' }, '9jqo^~>')), 'Man ', 'a whole last group');
  assert.deepEqual([...(await f({ name: 'A85' }, 'z5sb~>')).bytes], [0, 0, 0, 0, 65, 66], 'z is four zero bytes; a short last group');
  assert.deepEqual([...(await f({ name: 'A85' }, 'z~>')).bytes], [0, 0, 0, 0]);
  for (const n of ['ASCIIHexDecode', 'AHx']) assert.equal(txt(await f({ name: n }, '48 69>')), 'Hi', n);
  const z = Buffer.from(deflateSync(Buffer.from('flated'))).toString('latin1');
  for (const n of ['FlateDecode', 'Fl']) assert.equal(txt(await f({ name: n }, z)), 'flated', n);
  assert.equal(txt(await f([{ name: 'ASCIIHexDecode' }, { name: 'FlateDecode' }], Buffer.from(deflateSync(Buffer.from('two'))).toString('hex') + '>')), 'two', 'filters run in order');
  assert.deepEqual(await f({ name: 'DCTDecode' }, 'jpeg'), { ok: true, bytes: null });
  assert.deepEqual(await f([null], 'x'), { ok: true, bytes: null }, 'a filter that is not a name is not one this reader knows');
  assert.deepEqual(await f({ name: 'FlateDecode' }, 'not deflate'), { ok: false });
  assert.deepEqual(await filters({}, 'not bytes', platform.inflate), { ok: false });
  assert.deepEqual(await filters(null, latin1('x'), platform.inflate), { ok: false });
});

test('pdf streams: the declared length, a wrong or indirect one, end-of-line forms, and what counts as damage', async () => {
  const shows = 'BT /F1 12 Tf 72 700 Td (endstream) Tj ET';
  assert.equal(await textOf(shows), 'endstream', 'the declared length is trusted when endstream follows it');
  const C = 'BT /F1 12 Tf 72 700 Td (A) Tj ET';
  for (const [label, stream] of [['no /Length', '<< >>\nstream\n' + C + '\nendstream'], ['a wrong one', '<< /Length 999 >>\nstream\n' + C + '\nendstream'],
    ['an indirect one', '<< /Length 9 0 R >>\nstream\n' + C + '\r\nendstream'], ['CR LF after stream', '<< /Length ' + C.length + ' >>\nstream\r\n' + C + '\nendstream'],
    ['CR alone after stream', '<< >>\nstream\r' + C + '\rendstream']]) assert.equal(await textOf('', { stream }), 'A', label);
  const zc = Buffer.from(deflateSync(Buffer.from(C))).toString('latin1');
  for (const [label, stream] of [['Flate, CR LF after stream', '<< /Filter /FlateDecode /Length ' + zc.length + ' >>\nstream\r\n' + zc + '\nendstream'],
    ['Flate, no length', '<< /Filter /FlateDecode >>\nstream\n' + zc + '\nendstream']]) {
    const r = await readPdf(page('', { stream }));
    assert.deepEqual([r.text, r.damaged], ['A', 0], label);
  }
  const r0 = await readPdf(page('', { stream: '<< /Length 0 >>\nstream\n\nendstream' }));
  assert.deepEqual([r0.ok, r0.text, r0.damaged], [true, '', 0], 'an empty stream');
  assert.deepEqual([(await readPdf(page('BT (5 0 obj) Tj ET'))).text, (await readPdf(page('BT (5 0 obj) Tj ET'))).damaged], ['5 0 obj', 0], 'a stream\'s bytes are never read as objects');
  const raw = (objs) => latin1('%PDF-1.7\n' + objs + '\n%%EOF\n');
  const head = '1 0 obj\n' + CAT + '\nendobj\n2 0 obj\n' + PAGES + '\nendobj\n3 0 obj\n' + PAGE('<< /Font << /F1 5 0 R >> >>') + '\nendobj\n5 0 obj\n' + HELV + '\nendobj\n';
  assert.equal((await readPdf(raw(head + '4 0 obj\n' + st('', C) + '\n'))).damaged, 1, 'endstream with no endobj after it');
  assert.equal((await readPdf(raw(head + '4 0 obj\n<< /Length 4 >>\nstream\n' + C))).damaged, 1, 'a stream the file ends inside');
  assert.equal((await readPdf(raw(head + '4 0 obj\n' + st('', C) + '\nendobj'))).damaged, 0);
  const bad = await readPdf(page(C, { more: [st('/Filter /FlateDecode', 'not deflate')] }));
  assert.deepEqual([bad.text, bad.damaged], ['A', 1], 'every stream is tried, not only the text\'s');
});

test('pdf page tree: references, depth, cycles, caps and broken nodes', async () => {
  const C = 'BT /F1 12 Tf 72 700 Td (A) Tj ET';
  /** The catalog's /Pages reaches the page tree through n references, objects 7 … 6 + n. */
  const viaRefs = (n) => { const objs = ['<< /Type /Catalog /Pages 7 0 R >>', PAGES, PAGE('<< /Font << /F1 5 0 R >> >>'), st('', C), HELV, 'null']; for (let k = 1; k < n; k++) objs.push((8 + k - 1) + ' 0 R'); objs.push('2 0 R'); return pdfOf(objs); };
  assert.equal((await readPdf(viaRefs(31))).text, 'A', 'a chain of 32 references is followed');
  assert.match((await readPdf(viaRefs(32))).why, /no page/, 'a 33rd is not');
  /** A page n levels down a chain of /Pages nodes, objects 6 … */
  const deep = (n) => { const objs = [CAT, '<< /Type /Pages /Kids [6 0 R] >>', PAGE('<< /Font << /F1 5 0 R >> >>'), st('', C), HELV]; for (let k = 1; k < n; k++) objs.push('<< /Type /Pages /Kids [' + (k === n - 1 ? 3 : 7 + k - 1) + ' 0 R] >>'); return pdfOf(objs); };
  assert.equal((await readPdf(deep(64))).text, 'A', 'a page 64 levels down');
  assert.match((await readPdf(deep(65))).why, /no page/, 'one level more is not read');
  const cyc = pdfOf([CAT, '<< /Type /Pages /Kids [2 0 R 3 0 R 3 0 R 9 0 R 5 0 R 5] >>', PAGE('<< /Font << /F1 5 0 R >> >>'), st('', C), HELV]);
  assert.deepEqual((await readPdf(cyc)).pages, ['A'], 'a cycle, a page named twice, a missing object, a font and a number in Kids: one page');
  const three = pdfOf([CAT, '<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R] >>', PAGE('<< /Font << /F1 5 0 R >> >>'), st('', C), HELV, PAGE('<< /Font << /F1 5 0 R >> >>'), PAGE('<< /Font << /F1 5 0 R >> >>')]);
  assert.equal((await readPdf(three)).pages.length, 3);
  assert.equal((await readPdf(three, { pages: 2 })).pages.length, 2, 'the page cap');
  assert.equal((await readPdf(three, { pages: 0 })).pages.length, 3, 'a cap that is not a positive whole number is the default');
  assert.equal((await readPdf(three, { pages: -1 })).pages.length, 3);
  assert.match((await readPdf(pdfOf(['<< /Type /Catalog >>']))).why, /no page/, 'a catalog with no /Pages');
  assert.match((await readPdf(pdfOf([CAT, '<< /Type /Pages /Kids 5 >>']))).why, /no page/, '/Kids that is not an array');
  const objs = pdfOf([CAT, PAGES, PAGE('<< /Font << /F1 5 0 R >> >>'), st('', C), HELV]);
  assert.equal((await readPdf(objs, { objects: 5 })).ok, true, 'exactly the object cap');
  assert.match((await readPdf(objs, { objects: 4 })).why, /more than 4 objects/);
  assert.equal((await readPdf(page('BT ET'), { ops: 3 })).ok, true, 'BT, ET and the end: three steps');
  assert.match((await readPdf(page('BT ET'), { ops: 2 })).why, /more than 2 operations/);
});

test('pdf object streams: the objects they hold, as many as N says and the header has', async () => {
  const b2 = PAGES, b3 = PAGE('<< /Font << /F1 5 0 R >> >>');
  const headOf = '2 0 3 ' + (b2.length + 1) + ' ';
  const objstm = (n) => st('/Type /ObjStm /N ' + n + ' /First ' + headOf.length, headOf + b2 + ' ' + b3);
  const file = (n) => pdfOf([CAT, undefined, undefined, st('', 'BT /F1 12 Tf 72 700 Td (A) Tj ET'), HELV, objstm(n)]);
  assert.equal((await readPdf(file(2))).text, 'A');
  assert.match((await readPdf(file(1))).why, /no page/, 'N = 1: only the first object');
  assert.equal((await readPdf(file(3))).text, 'A', 'N past the header: only the pairs there are');
});

test('pdf fonts: unknown names, no resources, direct font dictionaries, Differences, ToUnicode edges', async () => {
  assert.equal(await textOf('BT /F9 12 Tf 72 700 Td (A) Tj ET'), 'A', 'a font name the page does not hold');
  assert.equal(await textOf('BT /F1 12 Tf 72 700 Td (A) Tj ET', { res: '<< >>' }), 'A', 'no fonts at all');
  assert.equal(await textOf('BT /F1 12 Tf 72 700 Td (A) Tj ET', { res: null }), 'A', 'no resources at all');
  const direct = '<< /Font << /F1 << /Encoding << /Differences [65 /B] >> >> /F2 << /Encoding << /Differences [65 /C] >> >> >> >>';
  assert.equal(await textOf('BT /F1 12 Tf 72 700 Td (A) Tj /F2 12 Tf (A) Tj ET', { res: direct }), 'BC', 'two fonts written in place, each its own');
  const diff = '<< /Font << /F1 << /Encoding << /Differences [65 /A (junk) /B null /C 70 /uni0041 /x /bogus] >> >> >> >>';
  assert.equal(await textOf('BT /F1 12 Tf 72 700 Td (ABCFGH) Tj ET', { res: diff }), 'ABCAx', 'numbers set the code, names count on, anything else is passed over');
  const tu = (cmap, two = true) => ['<< /Type /Font /Subtype /' + (two ? 'Type0' : 'Type1') + ' /ToUnicode 6 0 R >>', st('', cmap)];
  const withCmap = async (cmap, shows, two) => { const [font, stream] = tu(cmap, two); const r = await readPdf(pdfOf([CAT, PAGES, PAGE('<< /Font << /F1 5 0 R >> >>'), st('', 'BT /F1 12 Tf 72 700 Td ' + shows + ' Tj ET'), font, stream])); return r.text; };
  const CS = '1 begincodespacerange <0000> <FFFF> endcodespacerange ';
  assert.equal(await withCmap(CS + '2 beginbfchar <0001> <0057> <0002> <041> endbfchar', '<00010002>'), 'W', 'a destination that is not whole UTF-16 units gives nothing');
  assert.equal(await withCmap(CS + '1 beginbfrange <0000> <FFFF> <0041> endbfrange', '<0001FFFF>'), 'B@', 'a range of exactly 65,536 codes (the last wraps to U+0040, as fromCharCode does)');
  assert.equal(await withCmap(CS + '1 beginbfrange <0000> <10000> <0041> endbfrange', '<0001>'), '', 'a range of more is not read');
  assert.equal(await withCmap(CS + '1 beginbfrange <0001> <0003> [<0041> <0042> <0043>] endbfrange', '<000100020003>'), 'ABC', 'a list for each code');
  assert.equal(await withCmap(CS + '1 beginbfrange <0001> <0003> [<0041>] endbfrange', '<000100020003>'), 'A', 'a list shorter than its range');
  assert.equal(await withCmap(CS + '1 beginbfrange <0001> <0002> [<0041> <0042> <0043>] endbfrange', '<000100020003>'), 'AB', 'a list longer than its range');
  assert.equal(await withCmap('1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <005A> endbfchar', '(A)', false), 'Z', 'one-byte codes');
});

test('pdf text: lines, spaces, leading, the quote operators, TJ gaps, malformed operands', async () => {
  const T = (body) => textOf('BT /F1 12 Tf ' + body + ' ET');
  assert.equal(await T('72 700 Td (A) Tj 10 0 Td (B) Tj'), 'A B', 'further along the line: a space');
  assert.equal(await T('72 700 Td (A) Tj 10 -1 Td (B) Tj'), 'A B', 'a move of exactly 1 is the same line');
  assert.equal(await T('72 700 Td (A) Tj 0.5 0 Td (B) Tj'), 'AB', 'half a unit along is no gap');
  assert.equal(await T('72 700 Td (A ) Tj 10 0 Td (B) Tj'), 'A B', 'never two spaces');
  assert.equal(await T('72 700 Td (A) Tj 0 -20 Td 0 -20 Td (B) Tj'), 'A\nB', 'two moves down, one line break');
  assert.equal(await T('72 700 Td (A) Tj 0 -20 Td 10 0 Td (B) Tj'), 'A\nB', 'no space after a line break');
  assert.equal(await T('(A) Tj 0 -20 Td (B) Tj'), 'A\nB', 'text before any move is at the start');
  assert.equal(await T('1 0 0 1 72 700 Tm (A) Tj 1 0 0 1 72 680 Tm (B) Tj 1 0 0 1 100 680 Tm (C) Tj'), 'A\nB C', 'Tm sets the position');
  assert.equal(await T('72 700 Td (A) Tj 0 -14 TD (B) Tj T* (C) Tj'), 'A\nB\nC', 'TD sets the leading T* uses');
  assert.equal(await T('16 TL 72 700 Td (A) Tj T* (B) Tj'), 'A\nB', 'TL');
  assert.equal(await T('14 TL 72 700 Td (A) Tj (B) \''), 'A\nB', "' moves down a line, then shows");
  assert.equal(await T('14 TL 72 700 Td (A) Tj 1 2 (B) "'), 'A\nB', '" takes its string last');
  assert.equal(await T("72 700 Td (A) Tj ' 5 '"), 'A', 'a quote operator with no string, or a number, shows nothing');
  assert.equal(await T('72 700 Td [(A) -300 (B) -200 (C) -250 (D)] TJ'), 'A BCD', 'a gap wider than 250 is a space');
  assert.equal(await T('72 700 Td [(A ) -300 (B) null 5] TJ'), 'A B');
  assert.equal(await T('72 700 Td Tj [(A)] Tj (B) TJ'), '', 'operands of the wrong kind show nothing');
  const two = pdfOf([CAT, PAGES, '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents [4 0 R 6 0 R] >>', st('', 'BT 72 700 Td (A) Tj ET'), HELV, st('', 'BT 10 0 Td (B) Tj ET')]);
  assert.equal((await readPdf(two)).text, 'A\nB', 'a page in two content streams');
});

test('pdf form XObjects: their own resources or the page\'s, two levels at most; images and unknown names show nothing', async () => {
  const F = (dict, body) => st('/Type /XObject /Subtype /Form ' + dict, body);
  const font = (to) => '<< /Encoding << /Differences [65 /' + to + '] >> >>';
  const res = (xobjs) => '<< /Font << /F1 ' + font('Y') + ' >> /XObject << ' + xobjs + ' >> >>';
  const show = (name) => 'BT /F1 12 Tf (A) Tj ET ' + name;
  assert.equal(await textOf('/X1 Do', { res: res('/X1 6 0 R'), more: [F('/Resources << /Font << /F1 ' + font('Z') + ' >> >>', show(''))] }), 'Z', 'a form\'s own resources');
  assert.equal(await textOf('/X1 Do', { res: res('/X1 6 0 R'), more: [F('', show(''))] }), 'Y', 'else the page\'s');
  const nest = await textOf('/X1 Do', { res: res('/X1 6 0 R /X2 7 0 R /X3 8 0 R'), more: [F('', 'BT (one) Tj ET /X2 Do'), F('', 'BT (two) Tj ET /X3 Do'), F('', 'BT (three) Tj ET')] });
  assert.deepEqual([nest.includes('one'), nest.includes('two'), nest.includes('three')], [true, true, false], 'two levels of forms, no more');
  assert.equal(await textOf('BT (A) Tj ET /Im1 Do /X9 Do', { res: '<< /XObject << /Im1 6 0 R >> >>', more: [st('/Type /XObject /Subtype /Image /Width 1 /Height 1', 'x')] }), 'A');
  assert.equal(await textOf('BT (A) Tj ET /X1 Do', { res: '<< >>', more: [F('', 'BT (B) Tj ET')] }), 'A', 'no XObject resources');
});

test('pdf refuses what is not one', async () => {
  assert.match((await pdf(new Int8Array(4), platform.inflate)).why, /bytes/);
  assert.match((await pdf(Object.create(Uint8Array.prototype), platform.inflate)).why, /bytes/);
  assert.match((await pdf(page('BT ET'), 5)).why, /no inflate/);
});

test('csv, ics and vcf at their edges: ties, last rows, nameless lines, nested components, caps', () => {
  assert.equal(csv('a,b;c').delimiter, ',', 'on a tie the first delimiter wins');
  assert.deepEqual(csv('a').rows, [['a']], 'one cell, no newline');
  assert.deepEqual(csv('a,').rows, [['a', '']], 'an empty last cell');
  assert.deepEqual(csv('a\nb\nc').rows.length, 3);
  assert.equal(csv('a\nb\nc', { rows: 3 }).ok, true, 'exactly the row cap');
  assert.match(csv('a\nb\nc', { rows: 2 }).why, /more than 2 rows/, 'the last row, with no newline after it, counts too');
  assert.match(csv('a\nb\nc\n', { rows: 2 }).why, /more than 2 rows/);
  assert.equal(csv('a\nb\nc\n', { rows: 3 }).ok, true, 'three rows each ending in a newline: exactly the cap');
  for (const bad of [0, -1, 1.5]) assert.equal(csv('a\nb\nc', { rows: bad }).ok, true, 'a cap that is not a positive whole number is the default: ' + bad);
  assert.deepEqual(lines(':x\nN:y\nA;=bad;B=c:v'), [{ name: 'N', params: {}, value: 'y' }, { name: 'A', params: { B: 'c' }, value: 'v' }], 'a line with no name, a parameter with no name');
  const cal = (body) => 'BEGIN:VCALENDAR\n' + body + '\nEND:VCALENDAR';
  const ev = ics(cal('BEGIN:VTIMEZONE\nDTSTART:19700101T000000\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:1\nSUMMARY:a\\Nb\nDESCRIPTION:the event\nBEGIN:VALARM\nDESCRIPTION:Reminder\nEND:VALARM\nLOCATION:Hall\nEND:VEVENT'));
  assert.deepEqual(ev.events, [{ uid: '1', summary: 'a\nb', start: '', end: '', location: 'Hall', description: 'the event' }], 'only the event\'s own properties');
  for (const bad of ['', 'X:VCALENDAR', 'BEGIN:VCARD']) assert.equal(ics(bad).ok, false, JSON.stringify(bad));
  const evs = cal('BEGIN:VEVENT\nUID:1\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nEND:VEVENT');
  assert.equal(ics(evs, { items: 2 }).events.length, 2, 'exactly the event cap');
  assert.match(ics(evs, { items: 1 }).why, /more than 1 events/);
  const card = 'BEGIN:VCARD\nNOTE:VCARD\nFN:Ann\nBEGIN:X\nEND:X\nTEL:1\nEND:VCARD';
  assert.deepEqual(vcf(card).contacts, [{ fn: 'Ann', n: '', emails: [], tels: ['1'], org: '', title: '' }], 'a value that says VCARD, an inner END, do not end the card');
  assert.deepEqual(vcf('BEGIN:VCARD\nFN:a\nEND:VCARD\nEND:VCARD').contacts.length, 1, 'an END with no card open adds none');
  const two = 'BEGIN:VCARD\nFN:a\nEND:VCARD\nBEGIN:VCARD\nFN:b\nEND:VCARD';
  assert.equal(vcf(two, { items: 2 }).contacts.length, 2);
  assert.match(vcf(two, { items: 1 }).why, /more than 1 contacts/);
  for (const bad of ['', 'X:VCARD', 'BEGIN:VCALENDAR']) assert.equal(vcf(bad).ok, false, JSON.stringify(bad));
  assert.match(ics('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1').why, /cut short: VEVENT never ends/);
  assert.match(ics('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nEND:VEVENT').why, /cut short: VCALENDAR never ends/);
  assert.match(vcf('BEGIN:VCARD\nFN:a').why, /cut short/);
  assert.equal(vcf('BEGIN:VCARD\nFN:a\nEND:VCARD').ok, true);
});

test('email at its edges: every header, a nameless header line, parts by kind, the first text wins, caps', async () => {
  assert.deepEqual(headers(':x\nA: 1'), { a: '1' });
  const msg = (head, body) => enc.encode(head.join('\r\n') + '\r\n\r\n' + body);
  const all = await eml(msg(['From: a@example.com', 'To: b@example.org', 'Cc: c@example.net', 'Subject: s', 'Date: Thu, 29 Oct 2026 12:00:00 +0000', 'Message-ID: <m@x>'], 'body'));
  assert.deepEqual([all.from, all.to, all.cc, all.subject, all.date, all.messageId, all.text], ['a@example.com', 'b@example.org', 'c@example.net', 's', 'Thu, 29 Oct 2026 12:00:00 +0000', '<m@x>', 'body']);
  assert.equal((await eml(msg(['Subject: s', 'Content-Type: text/plain; boundary=zz'], 'hello'))).text, 'hello', 'a boundary on a part that is not multipart is not a split');
  const mp = (parts) => msg(['Subject: s', 'Content-Type: multipart/mixed; boundary=B'], parts.map((p) => '--B\r\n' + p).join('\r\n') + '\r\n--B--\r\n');
  const r = await eml(mp([
    'Content-Type: text/html\r\n\r\n<p>first html</p>', 'Content-Type: text/plain\r\n\r\nfirst text', 'Content-Type: text/plain\r\n\r\nsecond text', 'Content-Type: text/html\r\n\r\n<p>second html</p>',
    'Content-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\nattached text', 'Content-Type: image/png; name=i.png\r\n\r\npng', 'Content-Type: text/plain\r\nContent-Disposition: inline; filename=n.txt\r\n\r\ninline named text',
  ]));
  assert.equal(r.text, 'first text', 'the first plain part is the text');
  assert.equal(r.html, '<p>first html</p>');
  assert.deepEqual(r.attachments.map((a) => a.name), ['a.txt', 'i.png', 'n.txt'], 'by disposition; a named part that is not text; a named text part once the text is taken');
  const inline = await eml(mp(['Content-Type: text/plain\r\nContent-Disposition: inline; filename=n.txt\r\n\r\ninline named text']));
  assert.deepEqual([inline.text, inline.attachments.length], ['inline named text', 0], 'a named inline text part is the text when it comes first');
  const first = await eml(mp(['Content-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\nattached', 'Content-Type: text/plain\r\n\r\nthe body']));
  assert.deepEqual([first.text, first.attachments.map((x) => x.name)], ['the body', ['a.txt']], 'a text part marked as an attachment is never the text, even when it comes first');
  const nest = (n) => { let body = 'Content-Type: text/plain\r\n\r\ndeep'; for (let k = 0; k < n; k++) body = 'Content-Type: multipart/mixed; boundary=B' + k + '\r\n\r\n--B' + k + '\r\n' + body + '\r\n--B' + k + '--'; return enc.encode('Subject: s\r\n' + body); };
  assert.equal((await eml(nest(3), { depth: 3 })).text, 'deep', 'exactly the depth cap');
  assert.match((await eml(nest(4), { depth: 3 })).why, /deeper than 3/);
  const parts = mp(['Content-Type: text/plain\r\n\r\na', 'Content-Type: text/plain\r\n\r\nb']);
  assert.equal((await eml(parts, { parts: 3 })).ok, true, 'the message and its two parts: three');
  assert.match((await eml(parts, { parts: 2 })).why, /more than 2 parts/);
  for (const bad of [0, -1]) assert.equal((await eml(nest(4), { depth: bad, parts: bad })).text, 'deep', 'a cap that is not a positive whole number is the default: ' + bad);
});

test('image headers at their edges, hand-made: the shortest GIF, near-misses of every magic, JPEG markers, every WebP frame', () => {
  const B = (...xs) => Uint8Array.from(xs.flat(Infinity));
  const s = (t) => [...t].map((c) => c.charCodeAt(0));
  const le = (x, n) => Array.from({ length: n }, (_, k) => (x >>> (8 * k)) & 255);
  assert.deepEqual(image(B(s('GIF89a'), le(33, 2), le(21, 2), new Array(6).fill(0))), { ok: true, type: 'gif', width: 33, height: 21 }, 'sixteen bytes are enough');
  assert.match(image(B(s('GIF89a'), new Array(9).fill(0))).why, /not an image/);
  const none = /not a PNG, JPEG, GIF or WebP/;
  assert.match(image(B(0x89, s('PNG'), s('xxxx'), new Array(16).fill(0))).why, none, 'half a PNG signature');
  assert.match(image(B(s('xxxx'), 0x0d, 0x0a, 0x1a, 0x0a, new Array(16).fill(0))).why, none);
  assert.match(image(B(0xff, 0x00, new Array(20).fill(0))).why, none, 'FF alone is not a JPEG');
  assert.match(image(B(0x00, 0xd8, new Array(20).fill(0))).why, none);
  const sof = (m) => [0xff, m, 0x00, 0x0b, 0x08, 0x00, 0x15, 0x00, 0x21];
  const jpeg = B(0xff, 0xd8, 0xff, 0xd0, 0xff, 0xd7, 0xff, 0x01, 0xff, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc4, 0x00, 0x04, 0xaa, 0xbb, sof(0xcf));
  assert.deepEqual(image(jpeg), { ok: true, type: 'jpeg', width: 33, height: 21 }, 'restart markers at both ends, TEM, a fill byte, an empty segment, a table, then SOF15 ending the file');
  for (const m of [0xc4, 0xc8, 0xcc]) assert.deepEqual(image(B(0xff, 0xd8, [0xff, m, 0x00, 0x02], sof(0xc0), [0, 0, 0])).width, 33, 'marker ' + m.toString(16) + ' is not a frame');
  assert.match(image(B(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, new Array(16).fill(0))).why, /no length/);
  assert.match(image(B(0xff, 0xd8, 0xff, 0xd9, new Array(16).fill(0))).why, /no length|broken|no frame/);
  const riff = (chunk, rest) => B(s('RIFF'), le(22, 4), s('WEBP'), s(chunk), rest);
  assert.deepEqual(image(riff('VP8X', [le(10, 4), le(0, 4), le(999, 3), le(69999, 3)])), { ok: true, type: 'webp', width: 1000, height: 70000 }, 'VP8X, thirty bytes exactly');
  const lossless = (sig) => riff('VP8L', [le(10, 4), sig, le(((21 - 1) << 14) | (33 - 1), 4), 0, 0, 0, 0, 0]);
  assert.deepEqual(image(lossless(0x2f)), { ok: true, type: 'webp', width: 33, height: 21 });
  assert.match(image(lossless(0x2e)).why, /does not know/, 'VP8L without its signature byte');
  const lossy = (a, b, c) => riff('VP8 ', [le(10, 4), 0, 0, 0, a, b, c, le(33, 2), le(21, 2)]);
  assert.deepEqual(image(lossy(0x9d, 0x01, 0x2a)), { ok: true, type: 'webp', width: 33, height: 21 });
  for (const code of [[0x9c, 0x01, 0x2a], [0x9d, 0x00, 0x2a], [0x9d, 0x01, 0x2b]]) assert.match(image(lossy(...code)).why, /does not know/, 'a VP8 start code off by one byte');
  assert.match(image(B(s('RIFF'), le(22, 4), s('AVI '), new Array(18).fill(0))).why, none, 'RIFF that is not WebP');
  assert.match(image(B(s('RIFX'), le(22, 4), s('WEBP'), new Array(18).fill(0))).why, none);
  assert.match(image(B(s('RIFF'), le(22, 4), s('WEBP'), s('VP8X'), new Array(13).fill(0))).why, none, 'a WebP shorter than thirty bytes');
});

test('the integrity walks at their edges, hand-made: PNG chunks, JPEG markers and scan data, GIF blocks, WebP chunks; the door maps each type to its walk', async () => {
  const B = (...xs) => Uint8Array.from(xs.flat(Infinity));
  const s = (t) => [...t].map((c) => c.charCodeAt(0));
  const be = (x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255];
  const le = (x, n) => Array.from({ length: n }, (_, k) => (x >>> (8 * k)) & 255);
  const chunk = (type, data = []) => { const td = [...s(type), ...data]; return [be(data.length), td, be(crc32(Uint8Array.from(td)))]; };
  const png = (...cs) => B([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], cs);
  const IHDR = chunk('IHDR', new Array(13).fill(0));
  assert.equal(pngIntact(png(IHDR, chunk('IEND'))), null);
  assert.match(pngIntact(png(IHDR, [0, 0, 0])), /no IEND/, 'a few bytes after the last chunk are not a chunk header');
  assert.match(pngIntact(png(IHDR, be(5), s('IDAT'), [1, 2, 3, 4])), /runs past/, 'a whole chunk header, but data longer than what is left');
  assert.match(pngIntact(png(chunk('IEND'), [0])), /after a PNG's IEND/);
  const bent = png(IHDR, chunk('IEND')); bent[20] ^= 1;
  assert.match(pngIntact(bent), /IHDR fails its CRC/);
  const J = (...xs) => B(0xff, 0xd8, xs);
  assert.equal(jpegIntact(J([0xff, 0xe0, 0, 2], [0xff, 0xff, 0xd0], [0xff, 0xd7], [0xff, 0x01], [0xff, 0xda, 0, 2], [1, 0xff, 0x00, 2, 0xff, 0xd0, 3, 0xff, 0xd7, 4], [0xff, 0xd9])), null, 'an empty segment, a fill byte, restarts at both ends, TEM, scan data with a stuffed byte and restarts');
  assert.match(jpegIntact(J([0xff, 0xe0, 0, 2], [0xff])), /no end marker/, 'one byte left is not a marker');
  assert.match(jpegIntact(J([0xff, 0xe0, 0, 2])), /no end marker/, 'a segment that ends the file exactly');
  assert.match(jpegIntact(J([0xff, 0xe0, 0, 1], [0, 0, 0xff, 0xd9])), /runs past/, 'a segment length below 2');
  assert.match(jpegIntact(J([0xff, 0xe0, 0, 9])), /runs past/);
  assert.match(jpegIntact(J([0xff, 0xda, 0, 2], [1, 2, 3])), /no end marker/, 'scan data to the end of the file');
  assert.match(jpegIntact(J([0xff, 0xd9], [0])), /bytes after/);
  assert.match(jpegIntact(J([0x00, 0xd9])), /broken/);
  const G = (...xs) => B(s('GIF89a'), 1, 0, 1, 0, xs);
  assert.equal(gifIntact(G(0, 0, 0, 0x3b)), null, 'fourteen bytes: a header, no colour table, the trailer');
  assert.match(gifIntact(G(0, 0, 0)), /too short/);
  assert.equal(gifIntact(G(0x80, 0, 0, new Array(6).fill(0), 0x3b)), null, 'a global colour table of two entries');
  assert.match(gifIntact(G(0, 0, 0, 0x21, 0xf9, 4, 0, 0, 0, 0, 0)), /no trailer/, 'an extension, then the end of the file');
  assert.match(gifIntact(G(0, 0, 0, 0x21, 0xf9, 4, 0, 0)), /extension never ends/, 'sub-blocks that run off the end');
  assert.match(gifIntact(G(0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0)), /image data never ends/, 'an image header that ends the file exactly');
  assert.match(gifIntact(G(0, 0, 0, 0x2c, 0, 0, 0, 0)), /image header runs past/);
  const img = (f, table) => [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, f, table, 2, 1, 0, 0, 0x3b];
  assert.equal(gifIntact(G(0, 0, 0, img(0x81, new Array(12).fill(0)))), null, 'an image with its own colour table of four entries');
  assert.match(gifIntact(G(0, 0, 0, 0x99)), /unknown kind/);
  assert.match(gifIntact(G(0, 0, 0, 0x3b, 0)), /after a GIF's trailer/);
  const W = (...cs) => { const body = [s('WEBP'), cs]; const n = body.flat(Infinity).length; return B(s('RIFF'), le(n, 4), body); };
  assert.equal(webpIntact(W(s('VP8X'), le(0, 4))), null, 'a chunk header that ends the file exactly');
  assert.equal(webpIntact(W(s('ABCD'), le(1, 4), 7, 0)), null, 'an odd chunk and its pad byte');
  assert.match(webpIntact(W(s('ABCD'), le(1, 4), 7)), /do not add up/, 'the pad byte missing');
  for (const [t, f] of [['png', 'dev.png'], ['jpeg', 'dev.jpg'], ['gif', 'dev.gif'], ['webp', 'dev-lossy.webp'], ['webp', 'dev-lossless.webp']]) assert.equal((await parse(t, fx(f), platform)).ok, true, f);
  assert.match((await parse('gif', fx('dev.gif').slice(0, -1), platform)).why, /no trailer/, 'each type goes to its own walk');
  assert.match((await parse('jpeg', fx('dev.jpg').slice(0, -2), platform)).why, /end marker/);
  assert.match((await parse('webp', Uint8Array.from([...fx('dev-lossy.webp'), 0, 0]), platform)).why, /add up/);
  assert.match((await parse('docx', writeDocx({ paragraphs: ['x'] }), { get inflateRaw() { throw new Error('boom'); } })).why, /^the reader stopped: boom$/, 'a reader that stops says why, in its own words');
  const cut = enc.encode('Subject: s\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\ncut sho');
  assert.match((await eml(cut)).why, /no closing boundary/, 'a multipart message cut short');
});

test('parse: one door for every type; integrity failures quarantine; unknown types refused', async () => {
  assert.deepEqual((await parse('png', fx('dev.png'), platform)).result, { width: 33, height: 21 });
  const p = fx('dev.png').slice(); p[40] ^= 1;
  assert.match((await parse('png', p, platform)).why, /CRC/);
  assert.match((await parse('jpeg', fx('dev.png'), platform)).why, /is a png/);
  assert.equal((await parse('csv', enc.encode('a,b\n1,2'), platform)).result.rows.length, 2);
  assert.match((await parse('csv', Uint8Array.of(0xff), platform)).why, /UTF-8/);
  assert.equal((await parse('ics', enc.encode('nope'), platform)).ok, false);
  assert.equal((await parse('vcf', enc.encode('BEGIN:VCARD\nFN:x\nEND:VCARD'), platform)).result.contacts.length, 1);
  assert.equal((await parse('eml', fx('dev.eml'), platform)).result.subject, 'Rye loaf — Friday');
  assert.equal((await parse('docx', writeDocx({ paragraphs: ['x'] }), platform)).result.paragraphs[0], 'x');
  assert.equal((await parse('xlsx', writeXlsx({ sheets: [{ name: 'S', rows: [[1]] }] }), platform)).result.sheets[0].cells.A1, 1);
  assert.deepEqual((await parse('zip', zipStored([{ name: 'a', text: 'bc' }]), platform)).result, { entries: [{ name: 'a', size: 2 }] });
  const z = zipStored([{ name: 'a', text: 'bc' }]); z[31] ^= 1;
  assert.match((await parse('zip', z, platform)).why, /CRC/);
  assert.equal((await parse('pdf', fx('dev-reportlab.pdf'), platform)).ok, true);
  const broken = fx('dev-chrome.pdf').slice(); for (let i = 2000; i < 2200; i++) broken[i] ^= 0x55;
  const br = await parse('pdf', broken, platform);
  assert.equal(br.ok, false, 'a damaged stream fails the file');
  assert.match((await parse('exe', new Uint8Array(1), platform)).why, /no reader/);
  assert.match((await parse('pdf', 'x', platform)).why, /nothing to read/);
  assert.match((await parse('docx', new Uint8Array(30), { inflateRaw: () => { throw new Error('x'); } })).why, /local file header|stopped/);
});
