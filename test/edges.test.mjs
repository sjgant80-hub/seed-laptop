// test/edges.test.mjs — the core side of the edges: verify-before-parse on raw bytes, the writers, the leak scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { TYPES, declaredOf, sniff, verify, utf8, zipEnd } from '../src/edge-in.mjs';
import { zipStored, docx, xlsx, pdf, eml, ics, csv, crc32, colName, wrap, WINANSI, qpEncode, fold, MAX_ITEMS } from '../src/edge-out.mjs';
import { markers, scan, zipTexts, NAMES } from '../src/leak.mjs';

const fx = (n) => new Uint8Array(readFileSync(new URL('./fixtures/dev/' + n, import.meta.url)));
const enc = new TextEncoder(), dec = new TextDecoder();

test('declaredOf: the type a name declares', () => {
  assert.equal(declaredOf('Letter.PDF'), 'pdf');
  assert.equal(declaredOf('a.jpeg'), 'jpeg');
  assert.equal(declaredOf('a.jpg'), 'jpeg');
  assert.equal(declaredOf('x.tar.zip'), 'zip');
  assert.equal(declaredOf('noext'), null);
  assert.equal(declaredOf('a.exe'), null);
  assert.equal(declaredOf('a.' + 'x'.repeat(9)), null);
  assert.equal(declaredOf(5), null);
});

test('sniff: what the first bytes say', () => {
  assert.equal(sniff(fx('dev-reportlab.pdf')), 'pdf');
  assert.equal(sniff(docx({ paragraphs: ['x'] })), 'zip');
  assert.equal(sniff(fx('dev.png')), 'png');
  assert.equal(sniff(fx('dev.jpg')), 'jpeg');
  assert.equal(sniff(fx('dev.gif')), 'gif');
  assert.equal(sniff(fx('dev-lossy.webp')), 'webp');
  assert.equal(sniff(enc.encode('hello, world')), 'text');
  assert.equal(sniff(Uint8Array.of(0xff, 0xfe, 0, 1)), null, 'not UTF-8 and no magic');
  assert.equal(sniff(Uint8Array.of(0x41, 0, 0x41, 0x41)), null, 'a NUL byte is not text');
  assert.equal(sniff(new Uint8Array(3)), null, 'NUL bytes');
  assert.equal(sniff(enc.encode('a')), 'text', 'one byte of text');
  assert.equal(sniff(new Uint8Array(0)), null);
  assert.equal(sniff('x'), null);
  assert.equal(utf8(enc.encode('é')), true);
});

test('verify: every real kind passes', () => {
  const cases = [['pdf', fx('dev-reportlab.pdf')], ['pdf', fx('dev-chrome.pdf')], ['docx', docx({ paragraphs: ['x'] })], ['xlsx', xlsx({ sheets: [] })], ['zip', zipStored([{ name: 'a', text: 'b' }])],
    ['eml', fx('dev.eml')], ['ics', ics({ events: [] })], ['vcf', enc.encode('BEGIN:VCARD\r\nEND:VCARD\r\n')], ['csv', csv([['a']])], ['png', fx('dev.png')], ['jpeg', fx('dev.jpg')], ['gif', fx('dev.gif')], ['webp', fx('dev-lossy.webp')]];
  for (const [t, b] of cases) assert.deepEqual(verify(b, t), { ok: true, type: t }, t);
  assert.deepEqual(verify(enc.encode('\ufeffBEGIN:VCALENDAR\r\n'), 'ics'), { ok: true, type: 'ics' }, 'a BOM is allowed');
});

test('verify: each stage refuses by name', () => {
  const p = fx('dev-reportlab.pdf');
  assert.equal(verify(p, 'exe').stage, 'type');
  assert.equal(verify(p, 'toString').stage, 'type');
  assert.equal(verify(new Uint8Array(0), 'pdf').stage, 'size');
  assert.equal(verify('x', 'pdf').stage, 'size');
  const big = new Uint8Array(TYPES.ics.max + 1); big.set(enc.encode('BEGIN:VCALENDAR\n'));
  assert.equal(verify(big, 'ics').stage, 'size');
  const atCap = new Uint8Array(TYPES.ics.max).fill(0x20); atCap.set(enc.encode('BEGIN:VCALENDAR\n'));
  assert.equal(verify(atCap, 'ics').ok, true, 'exactly the cap');
  assert.equal(verify(p, 'docx').stage, 'magic', 'a PDF named .docx');
  assert.match(verify(p, 'docx').why, /the name says docx but the bytes are pdf/);
  assert.match(verify(enc.encode('plain'), 'pdf').why, /bytes are text/);
  assert.equal(verify(Uint8Array.of(0xff, 0xfe, 0, 1), 'csv').stage, 'magic');
  assert.equal(verify(p.slice(0, p.length >> 1), 'pdf').stage, 'shape', 'cut short');
  assert.equal(verify(Uint8Array.from([...p, ...zipStored([{ name: 'a', text: 'b' }])]), 'pdf').stage, 'shape', 'a PDF with a zip glued on');
  const tail = Uint8Array.from([...p, ...enc.encode('PK\x05\x06'), ...new Uint8Array(18), ...enc.encode('\n%%EOF\n')]);
  assert.match(verify(tail, 'pdf').why, /zip end record inside a PDF/, 'even when it ends %%EOF again');
  assert.match(verify(Uint8Array.from([...p, 0x41]), 'pdf').why, /bytes after/);
  assert.equal(verify(Uint8Array.from([...p, 0x0a, 0x0d, 0x20, 0x09, 0x00]), 'pdf').ok, true, 'whitespace after %%EOF is fine');
  const z = docx({ paragraphs: ['x'] });
  assert.equal(verify(Uint8Array.from([...z, ...p]), 'docx').stage, 'shape', 'a zip with a PDF glued on');
  assert.equal(verify(z.slice(0, z.length - 1), 'docx').stage, 'shape');
  assert.equal(verify(fx('dev.png').slice(0, 60), 'png').stage, 'shape');
  assert.equal(verify(fx('dev.jpg').slice(0, 300), 'jpeg').stage, 'shape');
  assert.equal(verify(fx('dev.gif').slice(0, 30), 'gif').stage, 'shape');
  assert.equal(verify(Uint8Array.from([...fx('dev-lossy.webp'), 0]), 'webp').stage, 'shape');
  assert.equal(verify(enc.encode('BEGIN:VEVENT'), 'ics').stage, 'shape');
  assert.equal(verify(enc.encode('BEGIN:VCALENDAR'), 'vcf').stage, 'shape');
  assert.equal(verify(enc.encode('not a header line'), 'eml').stage, 'shape');
  assert.equal(verify(enc.encode('Subject: hi\r\n\r\nbody'), 'eml').ok, true);
  assert.equal(verify(fx('dev.png'), 'jpeg').stage, 'magic');
});

test('zipEnd: the end record must end the file, comment counted', () => {
  const z = zipStored([{ name: 'a', text: 'b' }]);
  assert.equal(zipEnd(z), z.length - 22);
  const withComment = z.slice(); withComment[z.length - 2] = 3;
  assert.equal(zipEnd(Uint8Array.from([...withComment, 1, 2, 3])), z.length - 22);
  assert.equal(zipEnd(Uint8Array.from([...z, 0])), -1);
});

test('edge-in at its exact edges', () => {
  assert.equal(zipEnd(Uint8Array.from([0x50, 0x4b, 5, 6, ...new Array(18).fill(0)])), 0, 'the lowest place looked at is the first byte');
  const z = zipStored([{ name: 'a', text: 'b' }]);
  const withComment = (n) => { const b = new Uint8Array(z.length + n); b.set(z); b[z.length - 2] = n & 255; b[z.length - 1] = n >> 8; return b; };
  assert.equal(zipEnd(withComment(65535)), z.length - 22, 'the longest comment a zip can carry');
  assert.equal(zipEnd(withComment(300)), z.length - 22, 'a comment length read from both its bytes');
  const pdfGap = (gap) => Uint8Array.from([...enc.encode('%PDF-1.4\n' + 'x'.repeat(2000) + '%%EOF'), ...new Array(gap).fill(0x20)]);
  assert.equal(verify(pdfGap(1019), 'pdf').ok, true, '%%EOF starting exactly 1 KB from the end is in the last 1 KB');
  assert.equal(verify(pdfGap(1020), 'pdf').stage, 'shape');
  assert.deepEqual(verify(enc.encode('a'), 'csv'), { ok: true, type: 'csv' }, 'one byte is a file');
  assert.equal(sniff(Uint8Array.of(0x89, 0x41, 0x42)), null, '0x89 alone is not a PNG');
  assert.equal(sniff(Uint8Array.from([0x41, ...enc.encode('PNG\r\n\x1a\n')])), 'text', 'nor is PNG without its 0x89');
  assert.equal(verify(Uint8Array.from([0x89, ...enc.encode('PNG\r\n\x1a\n')]), 'png').stage, 'shape', 'the magic alone has no IEND');
  for (const b of [[0xff, 0x00, 0xff], [0x41, 0xd8, 0xff], [0x41, 0x41, 0xff]]) assert.equal(sniff(Uint8Array.from(b)), null, 'a JPEG needs all three: ' + b);
  assert.equal(sniff(enc.encode('RIFFabcdAVI ')), 'text', 'RIFF is not WebP by itself');
  assert.equal(sniff(enc.encode('xxxxabcdWEBP')), 'text');
  const j = fx('dev.jpg');
  assert.equal(verify(Uint8Array.from([...j.subarray(0, j.length - 1), 0x00]), 'jpeg').stage, 'shape', 'ends FF 00');
  assert.equal(verify(Uint8Array.from([...j.subarray(0, j.length - 2), 0x00, 0xd9]), 'jpeg').stage, 'shape', 'ends 00 D9');
});

test('writers: deterministic, standard, no metadata; zip entries carry their CRC', () => {
  assert.deepEqual(docx({ paragraphs: ['x'] }), docx({ paragraphs: ['x'] }));
  assert.deepEqual(pdf({ paragraphs: ['x'] }), pdf({ paragraphs: ['x'] }));
  const p = dec.decode(pdf({ paragraphs: ['Hello'] }));
  assert.ok(p.startsWith('%PDF-1.4'));
  assert.ok(p.endsWith('%%EOF\n'));
  assert.equal(/Producer|Creator|Author|\/Info/.test(p), false, 'no document information at all');
  for (const z of [docx({ paragraphs: ['x'] }), xlsx({ sheets: [] })]) {
    const t = new TextDecoder('latin1').decode(z);
    assert.equal(/docProps|creator|lastModifiedBy|Application/.test(t), false, 'no app or core properties');
  }
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(colName(1), 'A'); assert.equal(colName(26), 'Z'); assert.equal(colName(27), 'AA'); assert.equal(colName(703), 'AAA');
  assert.equal(colName(16384), 'XFD'); assert.equal(colName(16385), ''); assert.equal(colName(0), ''); assert.equal(colName(Infinity), ''); assert.equal(colName(1.5), '');
  assert.deepEqual(docx(null).length > 0, true, 'garbage in writes an empty, valid file');
  assert.ok(dec.decode(pdf(null)).includes('/Count 1'), 'an empty PDF still has a page');
});

test('the PDF writer: wraps by Helvetica widths, pages after 48 lines, shows only WinAnsi', () => {
  const lines = wrap('word '.repeat(60), 483, 11);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length > 0));
  assert.deepEqual(wrap('a\nb', 483, 11), ['a', 'b']);
  assert.deepEqual(wrap('x'.repeat(300), 100, 11), ['x'.repeat(300)], 'a word longer than the line stays whole');
  assert.deepEqual(wrap('a', 'x', 11), []); assert.deepEqual(wrap('a', 483, 0), []); assert.deepEqual(wrap('a', 483, NaN), []);
  assert.equal(WINANSI('é—€✓\t'), 'é—€??');
  const many = dec.decode(pdf({ paragraphs: Array.from({ length: 30 }, (_, i) => 'line ' + i) }));
  assert.ok(many.includes('/Count 2'), '59 lines take two pages');
  const esc = new TextDecoder('latin1').decode(pdf({ paragraphs: ['(a) \\ é'] }));
  assert.ok(esc.includes('(\\(a\\) \\\\ \\351) Tj'));
});

test('eml: headers in one line each, non-ASCII subjects encoded, quoted-printable body', () => {
  const t = dec.decode(eml({ from: 'A <a@example.com>', to: 'b@example.org\r\nBcc: evil@example.net', subject: 'Café', date: 'Thu, 29 Oct 2026 12:00:00 +0000', id: '<x@y>', text: 'é\n' + 'z'.repeat(100) }));
  assert.ok(t.includes('Subject: =?UTF-8?B?Q2Fmw6k=?='));
  assert.ok(t.includes('To: b@example.org Bcc: evil@example.net\r\n'), 'a header cannot smuggle another header in');
  assert.equal((t.match(/^Bcc:/gm) || []).length, 0);
  assert.ok(t.includes('Message-ID: <xy@example.com>'));
  assert.ok(t.includes('Content-Transfer-Encoding: quoted-printable'));
  assert.equal(qpEncode('a=b'), 'a=3Db');
  assert.ok(qpEncode('x'.repeat(100)).includes('=\r\n'));
  assert.equal(qpEncode('end \n'), 'end=20\r\n');
  assert.equal(dec.decode(eml({ from: 'nobody', to: 'x' })).includes('@localhost>'), true);
});

test('ics and csv: escapes, folding at 75 octets, quoting', () => {
  const t = dec.decode(ics({ stamp: 'S', events: [{ uid: 'u', start: 's', end: 'e', summary: 'a;b,c\\d\ne' + 'é'.repeat(50) }, null] }));
  assert.ok(t.includes('SUMMARY:a\\;b\\,c\\\\d\\ne'));
  assert.ok(t.split('\r\n').every((l) => enc.encode(l).length <= 75));
  assert.ok(t.includes('PRODID:-//Local//Calendar//EN'));
  assert.equal(fold('x'.repeat(75)), 'x'.repeat(75));
  assert.equal(fold('x'.repeat(76)), 'x'.repeat(75) + '\r\n x');
  assert.equal(dec.decode(csv([['a', 'b,c', 'd"e', ' f', 'g\nh'], [1, null]])), 'a,"b,c","d""e"," f","g\nh"\r\n1,\r\n');
});

test('leak: markers for one office, found as whole words or exact strings, inside zips too', async () => {
  const ctx = { owner: 'a'.repeat(64), device: 'b'.repeat(64), genome: 'c'.repeat(64), vault: 'vault/' + 'd'.repeat(32), hashes: ['e'.repeat(64)], blocks: ['crm'], home: 'C:\\Users\\someone', user: 'someone' };
  const list = markers(ctx);
  assert.ok(list.some((m) => m.marker === 'a'.repeat(16)), 'a short prefix of a key counts too');
  assert.ok(NAMES.includes('kar') && NAMES.includes('seed-laptop'));
  const clean = await scan(docx({ paragraphs: ['Dear Ms Okafor, the karate class and the seedling market are on Monday.'] }), list, async (b) => new Uint8Array(inflateRawSync(b)));
  assert.deepEqual(clean, [], 'words that only contain a marker are not it');
  const dirty = await scan(pdf({ paragraphs: ['owner ' + 'a'.repeat(64), 'made by Kar, on seed-laptop', 'C:/Users/someone/office'] }), list);
  assert.deepEqual([...new Set(dirty.map((h) => h.marker))].sort(), ['C:/Users/someone', 'a'.repeat(16), 'a'.repeat(64), 'kar', 'seed-laptop', 'someone'].sort());
  const inZip = await scan(zipStored([{ name: 'x.xml', text: 'genome ' + 'c'.repeat(64) }]), list);
  assert.ok(inZip.some((h) => h.where === 'x.xml'));
  const u16 = await scan(new Uint8Array(Buffer.from('KONOMI', 'utf16le')), list);
  assert.ok(u16.some((h) => h.marker === 'konomi' && h.where === 'bytes as UTF-16'));
  assert.deepEqual(await scan('x', list), []);
  assert.deepEqual(markers(null).length, NAMES.length);
});

test('leak at its exact edges: key length, the zip walk, the inflate', async () => {
  assert.ok(markers({ owner: 'f'.repeat(16) }).some((m) => m.marker === 'f'.repeat(16)), 'a 16-character key counts');
  assert.ok(!markers({ owner: 'f'.repeat(15) }).some((m) => m.marker === 'f'.repeat(15)));
  const le32 = (x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255];
  const entry = (name, data, method) => { const n = enc.encode(name); return [0x50, 0x4b, 3, 4, 20, 0, 0, 0, method, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(data.length), ...le32(data.length), n.length & 255, n.length >> 8, 0, 0, ...n, ...data]; };
  const fake = async () => enc.encode('inflated');
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('', [], 0))), [{ where: '', text: '' }], 'a header that ends the file exactly is read');
  assert.deepEqual(await zipTexts(enc.encode('%PDF-1.4 not a zip at all, and longer than thirty bytes')), []);
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('a', [...enc.encode('raw')], 8)), fake), [{ where: 'a', text: 'inflated' }]);
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('a', [...enc.encode('raw')], 0)), fake), [{ where: 'a', text: 'raw' }], 'a stored entry is never inflated');
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('a', [...enc.encode('raw')], 8)), async () => 'not bytes'), [{ where: 'a', text: 'raw' }]);
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('a', [...enc.encode('raw')], 8)), async () => { throw new Error('x'); }), [{ where: 'a', text: 'raw' }]);
  assert.deepEqual(await zipTexts(Uint8Array.from(entry('n'.repeat(300), [...enc.encode('t')], 0))), [{ where: 'n'.repeat(300), text: 't' }], 'a name past 255 bytes');
  const deflated = Uint8Array.from(entry('d.xml', [...deflateRawSync(enc.encode('made with konomi'))], 8));
  const list = markers(null);
  assert.ok((await scan(deflated, list, async (b) => new Uint8Array(inflateRawSync(b)))).some((h) => h.marker === 'konomi' && h.where === 'd.xml'), 'found inside a deflated entry');
  assert.deepEqual(await scan(deflated, list, 5), [], 'an inflate that is not a function is refused');
  assert.deepEqual(await scan(new Int8Array(enc.encode('konomi')), list), []);
  assert.deepEqual(await scan(Object.create(Uint8Array.prototype), list), []);
});

test('writers at their exact edges: WinAnsi, Helvetica widths, a full page, quoted-printable limits, sheet numbering', async () => {
  assert.equal(WINANSI(String.fromCharCode(31, 32, 126, 127, 0x9f, 0xa0, 0xff, 0x100)), '? ~??\xa0\xff?', 'the printable ASCII and Latin-1 ranges, end to end');
  assert.deepEqual(wrap('a a', 556 * 2 + 278, 1000), ['a a'], 'an exact fit stays on the line; a space is 278 wide');
  assert.deepEqual(wrap('a a', 556 * 2 + 277, 1000), ['a', 'a']);
  assert.deepEqual(wrap('~ ~', 584 * 2 + 277, 1000), ['~', '~'], '~ is 584 wide, not the default');
  const pages = (n) => (dec.decode(pdf({ paragraphs: [Array.from({ length: n }, () => 'x').join('\n')] })).match(/\/Count (\d+)/) || [])[1];
  assert.deepEqual([pages(48), pages(49)], ['1', '2'], '48 lines fill one page exactly');
  assert.ok(new TextDecoder('latin1').decode(pdf({ paragraphs: ['€'] })).includes('(' + String.fromCharCode(92) + '200) Tj'), 'the first CP1252 byte is written as an octal escape');
  assert.equal(qpEncode('x'.repeat(75)), 'x'.repeat(75), '75 characters need no soft break');
  assert.equal(qpEncode('x'.repeat(76)), 'x'.repeat(75) + '=\r\n' + 'x');
  assert.equal(qpEncode('a\rb'), 'a=0Db', 'a carriage return alone is not a line end');
  assert.equal(qpEncode('!~ \x7f='), '!~ =7F=3D');
  const { entries: zipEntries, read: zipRead } = await import('../src/parse/zip.mjs');
  const book = xlsx({ sheets: [{ name: 'A', rows: [['x'], [NaN, Infinity, 2]] }, { name: 'B', rows: [] }] });
  const z = zipEntries(book);
  const part = async (name) => dec.decode((await zipRead(book, z.entries.find((e) => e.name === name), async (b) => new Uint8Array(inflateRawSync(b)))).bytes);
  const types = await part('[Content_Types].xml'), wb = await part('xl/workbook.xml'), rels = await part('xl/_rels/workbook.xml.rels'), s1 = await part('xl/worksheets/sheet1.xml');
  assert.ok(types.includes('/xl/worksheets/sheet1.xml') && types.includes('/xl/worksheets/sheet2.xml') && !types.includes('sheet0'), 'every sheet has its content type');
  assert.ok(wb.includes('<sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/>'));
  const unnamed = xlsx({ sheets: [{ rows: [] }, { name: '', rows: [] }] }), uz = zipEntries(unnamed);
  const uwb = dec.decode((await zipRead(unnamed, uz.entries.find((x) => x.name === 'xl/workbook.xml'), async (b) => new Uint8Array(inflateRawSync(b)))).bytes);
  assert.ok(uwb.includes('<sheet name="Sheet1" sheetId="1"') && uwb.includes('<sheet name="Sheet2" sheetId="2"'), 'a sheet with no name is named by its place');
  assert.ok(rels.includes('Id="rId1"') && rels.includes('Target="worksheets/sheet2.xml"'));
  assert.ok(s1.includes('<row r="1"><c r="A1" t="inlineStr">') && s1.includes('<row r="2">'), 'rows count from 1');
  assert.ok(s1.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">NaN</t></is></c>') && s1.includes('<c r="B2" t="inlineStr">') && s1.includes('<c r="C2"><v>2</v></c>'), 'only a finite number is written as a number');
});

test('writers: more than MAX_ITEMS of anything writes an empty, valid file', () => {
  const many = Array.from({ length: MAX_ITEMS + 1 }, () => 'x');
  assert.equal(dec.decode(csv(many.map((x) => [x]))), String.fromCharCode(13, 10));
  assert.deepEqual(docx({ paragraphs: many }), docx({ paragraphs: [] }));
  assert.ok(dec.decode(pdf({ paragraphs: many })).includes('/Count 1'));
  assert.equal(dec.decode(csv([['a']])), 'a' + String.fromCharCode(13, 10));
  const exactly = Array.from({ length: MAX_ITEMS }, () => ['y']);
  assert.equal(csv(exactly).length, MAX_ITEMS * 3, 'exactly MAX_ITEMS rows are written');
});
