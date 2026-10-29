// ════════════════════════════════════════════════════════════════
// src/edge-out.mjs — the outbound edge: the office writes the formats the old world reads. Organ 4 (claim L3).
//
// Writing is the safe direction (nothing outside is read), so the writers live in the core. Each writes the plain,
// standard form of its format and nothing about the office: no producer or creator, no application properties,
// no identifiers of the owner, the device, the seed or the vault (src/leak.mjs checks every file written).
//
//   zipStored(files)                       → bytes   a zip of stored entries (fixed 1980 dates, no extra fields)
//   docx({ paragraphs, table })            → bytes   WordprocessingML: paragraphs, then an optional table
//   xlsx({ sheets: [{ name, rows }] })     → bytes   SpreadsheetML: text as inline strings, numbers as numbers
//   pdf({ paragraphs })                    → bytes   PDF 1.4, A4, Helvetica (WinAnsi); wrapped and paged
//   eml({ from, to, subject, date, text, id })   → bytes   RFC 5322 + MIME, text/plain UTF-8 quoted-printable
//   ics({ events: [{ uid, start, end, summary, location, description }], stamp })   → bytes   RFC 5545
//   csv(rows)                              → bytes   RFC 4180, CRLF
//   WINANSI(text)                          → which characters a PDF written here can show (the rest become '?')
// Pure and total (bad input, or more than MAX_ITEMS of anything, writes an empty, still valid, file of the format).
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

const enc = new TextEncoder();
const str = (x) => { if (typeof x === 'string') return x; if (x === undefined || x === null) return ''; try { return String(x); } catch { return ''; } };
// A writer takes at most MAX_ITEMS paragraphs, rows, cells per row, events or entries; past that it writes an empty,
// still valid file of its format (the office never sends it such a thing; a hostile caller gets nothing big back).
export const MAX_ITEMS = 100000;
const arr = (x) => (Array.isArray(x) && x.length <= MAX_ITEMS ? x : []);
const xml = (s) => str(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let CRC = null;
export function crc32(b) {
  if (!(ArrayBuffer.isView(b) && b instanceof Uint8Array)) return 0;
  if (!CRC) CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStoredOf(files) {
  const parts = [], central = [];
  let off = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of arr(files)) {
    const name = enc.encode(str(f && f.name));
    const data = f && f.bytes instanceof Uint8Array ? f.bytes : enc.encode(str(f && f.text));
    const crc = crc32(data);
    const common = [...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = Uint8Array.from([...u32(0x04034b50), ...common, ...name]);
    parts.push(local, data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...name]));
    off += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';

function docxOf(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const para = (t) => '<w:p>' + str(t).split('\n').map((line, i) => (i ? '<w:r><w:br/></w:r>' : '') + '<w:r><w:t xml:space="preserve">' + xml(line) + '</w:t></w:r>').join('') + '</w:p>';
  const table = arr(d.table).length ? '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>' + arr(d.table).map((row) => '<w:tr>' + arr(row).map((c) => '<w:tc>' + para(c) + '</w:tc>').join('') + '</w:tr>').join('') + '</w:tbl><w:p/>' : '';
  const body = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + arr(d.paragraphs).map(para).join('') + table + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  return zipStored([
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', text: RELS + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', text: body },
  ]);
}

export function colName(n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 16384) return '';   // a spreadsheet has at most 16,384 columns (XFD)
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function xlsxOf(book) {
  const sheets = arr(book && book.sheets).length ? arr(book.sheets) : [{ name: 'Sheet1', rows: [] }];
  const files = [
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
    { name: '_rels/.rels', text: RELS + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + xml(str(s && s.name).slice(0, 31) || 'Sheet' + (i + 1)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: RELS + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>' },
  ];
  sheets.forEach((s, i) => {
    const rows = arr(s && s.rows).map((row, r) => '<row r="' + (r + 1) + '">' + arr(row).map((v, c) => {
      const ref = colName(c + 1) + (r + 1);
      return Number.isFinite(v) ? '<c r="' + ref + '"><v>' + v + '</v></c>' : typeof v === 'boolean' ? '<c r="' + ref + '" t="b"><v>' + (v ? 1 : 0) + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>' });
  });
  return zipStoredOf(files);
}

// Helvetica widths (thousandths of an em) for printable ASCII 32..126, from its standard font metrics
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
export function WINANSI(text) {
  return [...str(text)].map((ch) => { const c = ch.codePointAt(0); return (c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff) || Object.prototype.hasOwnProperty.call(CP1252, c) ? ch : '?'; }).join('');
}
const winByte = (ch) => { const c = ch.codePointAt(0); return Object.prototype.hasOwnProperty.call(CP1252, c) ? CP1252[c] : c; };   // after WINANSI a character is Latin-1 or one of CP1252's
const width = (s, size) => [...s].reduce((w, ch) => { const c = ch.codePointAt(0); return w + (c >= 32 && c <= 126 ? HW[c - 32] : 556); }, 0) * size / 1000;

export function wrap(text, maxWidth, size) {
  if (!Number.isFinite(maxWidth) || !Number.isFinite(size) || size <= 0) return [];
  const lines = [];
  for (const para of str(text).split('\n').map(WINANSI)) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (width(next, size) <= maxWidth || !line) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

function pdfOf(doc) {
  const size = 11, lead = 15, left = 56, top = 786, perPage = 48;
  const lines = arr(doc && doc.paragraphs).flatMap((p, i) => [...(i ? [''] : []), ...wrap(p, 595 - 2 * left, size)]);
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) pages.push(lines.slice(i, i + perPage));
  const esc = (s) => [...s].map((ch) => { const b = winByte(ch); return b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + ch : b >= 128 ? '\\' + b.toString(8).padStart(3, '0') : ch; }).join('');
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids = pages.map((_, i) => (4 + 2 * i) + ' 0 R').join(' ');
  objs[2] = '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((pl, i) => {
    const content = 'BT /F1 ' + size + ' Tf ' + lead + ' TL ' + left + ' ' + top + ' Td\n' + pl.map((l, k) => (k ? 'T* ' : '') + '(' + esc(l) + ') Tj').join('\n') + '\nET';
    objs[4 + 2 * i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + 2 * i) + ' 0 R >>';
    objs[5 + 2 * i] = { stream: content };
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    const o = objs[n];
    out += n + ' 0 obj\n' + (typeof o === 'string' ? o : '<< /Length ' + o.stream.length + ' >>\nstream\n' + o.stream + '\nendstream') + '\nendobj\n';
  }
  const xref = out.length;
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n' + offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 255);
}

export function qpEncode(text) {
  const bytes = enc.encode(str(text).replace(/\r?\n/g, '\r\n'));
  let out = '', line = '';
  const push = (s) => { if (line.length + s.length > 75) { out += line + '=\r\n'; line = ''; } line += s; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13 && bytes[i + 1] === 10) { out += line.replace(/[ \t]$/, (m) => '=' + m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) + '\r\n'; line = ''; i++; continue; }
    push((b >= 33 && b <= 126 && b !== 61) || b === 32 ? String.fromCharCode(b) : '=' + b.toString(16).toUpperCase().padStart(2, '0'));
  }
  return out + line.replace(/[ \t]$/, (m) => '=' + m.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

const b64 = (s) => { const b = enc.encode(s); let t = ''; for (const x of b) t += String.fromCharCode(x); return btoa(t); };
const headerText = (s) => (/^[\x20-\x7e]*$/.test(str(s)) ? str(s) : '=?UTF-8?B?' + b64(str(s)) + '?=');
const oneLine = (s) => str(s).replace(/[\r\n]+/g, ' ');

function emlOf(msg) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const from = oneLine(m.from), domain = /@([A-Za-z0-9.-]+)>?\s*$/.exec(from);
  const lines = [
    'From: ' + headerText(oneLine(from)),
    'To: ' + headerText(oneLine(m.to)),
    'Subject: ' + headerText(oneLine(m.subject)),
    'Date: ' + oneLine(m.date),
    'Message-ID: <' + oneLine(m.id).replace(/[<>@\s]/g, '') + '@' + (domain ? domain[1] : 'localhost') + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  return enc.encode(lines.join('\r\n') + '\r\n\r\n' + qpEncode(m.text) + '\r\n');
}

export function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of str(line)) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function icsOf(cal) {
  const c = cal && typeof cal === 'object' ? cal : {};
  const text = (s) => str(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local//Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const e of arr(c.events)) {
    if (!e || typeof e !== 'object') continue;
    lines.push('BEGIN:VEVENT', 'UID:' + text(e.uid), 'DTSTAMP:' + str(c.stamp), 'DTSTART:' + str(e.start), 'DTEND:' + str(e.end), 'SUMMARY:' + text(e.summary));
    if (e.location) lines.push('LOCATION:' + text(e.location));
    if (e.description) lines.push('DESCRIPTION:' + text(e.description));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return enc.encode(lines.map(fold).join('\r\n') + '\r\n');
}

function csvOf(rows) {
  const cell = (v) => { const s = str(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return enc.encode(arr(rows).map((r) => arr(r).map(cell).join(',')).join('\r\n') + '\r\n');
}

// Every writer is total: input that cannot be read (a getter that throws, a value that cannot be text) writes the
// format's empty file, never an exception.
const total = (fn) => (x) => { try { return fn(x); } catch { return fn(null); } };
export const zipStored = total(zipStoredOf);
export const docx = total(docxOf);
export const xlsx = total(xlsxOf);
export const pdf = total(pdfOf);
export const eml = total(emlOf);
export const ics = total(icsOf);
export const csv = total(csvOf);
