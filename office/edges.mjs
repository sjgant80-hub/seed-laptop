// office/edges.mjs — the edges in a tab: files in (verify-before-parse here, reading only in a sandboxed parser frame)
// and files out (written here, leak-checked before you get them). Glue: the decisions are in src/edge-in.mjs,
// src/parse/ (run only inside the parser frame), src/edge-out.mjs, src/leak.mjs and src/store.mjs.
import { verify, declaredOf, TYPES } from '../src/edge-in.mjs';
import { docx, xlsx, pdf, eml, ics, csv } from '../src/edge-out.mjs';
import { markers, scan } from '../src/leak.mjs';
import { tag, untag } from '../src/value.mjs';
import { read, keysOf } from '../src/store.mjs';
import { mint, recognise, tally, EDGE_FILES } from '../src/immune.mjs';

const $ = (id) => document.getElementById(id);
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (b) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', b)));
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const PARSE_FILES = ['zip', 'xml', 'office', 'pdf', 'mail', 'text', 'image', 'index'];
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', eml: 'message/rfc822', ics: 'text/calendar', csv: 'text/csv' };
export const PARSE_MS = 5000;

/** The parser frame's page: the readers as data: modules behind an import map, answering one file at a time. */
export async function parserDoc() {
  const imports = {};
  for (const n of PARSE_FILES) {
    const text = await (await fetch('../src/parse/' + n + '.mjs')).text();
    imports['#' + n] = 'data:text/javascript;base64,' + b64(new TextEncoder().encode(text));
  }
  const boot = `import { parse } from '#index';
const CAP = 256 << 20;
async function inflateWith(fmt, b, max) {
  const ds = new DecompressionStream(fmt); const w = ds.writable.getWriter(); w.write(b).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(); const parts = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; n += value.length; if (n > max) throw new Error('inflates past its size'); parts.push(value); }
  const out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
const platform = { inflateRaw: (b, max) => inflateWith('deflate-raw', b, Math.min(Math.max(1, max || CAP), CAP)), inflate: (b) => inflateWith('deflate', b, CAP) };
addEventListener('message', async (e) => {
  if (e.source !== parent || !e.data || e.data.t !== 'parse') return;
  let r; try { r = await parse(e.data.type, new Uint8Array(e.data.bytes), platform); } catch (x) { r = { ok: false, why: 'the reader stopped', stopped: true }; }
  parent.postMessage({ t: 'parsed', id: e.data.id, r: JSON.parse(JSON.stringify(r)) }, '*');
});
parent.postMessage({ t: 'parser-ready' }, '*');`;
  return '<!doctype html><html><head><meta charset="utf-8"><script type="importmap">' + JSON.stringify({ imports }).replace(/</g, '\\u003c') + '</script><script type="module">' + boot + '</script></head><body></body></html>';
}

export function installEdges(ctx) {
  // ctx: { store(), write(key, tagged), receipt(kind, facts), owner, blocks, frames: Map, note(e) }
  let parser = null, ready = null, seq = 0;
  const waiting = new Map();
  function parserFrame() {
    if (parser) return ready;
    parser = document.createElement('iframe');
    parser.hidden = true; parser.title = 'The sandbox that reads files';
    parser.src = 'frame.html?b=__parser';
    ctx.frames.set('__parser', parser);
    $('frames').append(parser);
    ready = new Promise((ok) => { parser.readyResolve = ok; });
    return ready;
  }
  function killParser() { if (parser) { parser.remove(); ctx.frames.delete('__parser'); parser = null; ready = null; } }
  addEventListener('message', (e) => {
    if (!parser || e.source !== parser.contentWindow || !e.data) return;
    if (e.data.t === 'parser-ready' && parser.readyResolve) parser.readyResolve();
    if (e.data.t === 'parsed' && waiting.has(e.data.id)) { const w = waiting.get(e.data.id); waiting.delete(e.data.id); w(e.data.r); }
  });
  async function sandboxRead(type, bytes) {
    await parserFrame();
    const id = ++seq;
    return new Promise((ok) => {
      const timer = setTimeout(() => { waiting.delete(id); killParser(); ok({ ok: false, why: 'the reader ran past ' + PARSE_MS + ' ms, so it was stopped', stopped: true }); }, PARSE_MS);
      waiting.set(id, (r) => { clearTimeout(timer); ok(r && typeof r === 'object' ? r : { ok: false, why: 'the reader gave nothing back' }); });
      parser.contentWindow.postMessage({ t: 'parse', id, type, bytes }, '*', [bytes.buffer]);
    });
  }

  // the immune memory (src/immune.mjs): this device's own antibodies refuse on sight; another device's are only shown
  let edgeVersion = null;
  async function edgeOf() {
    const NL = String.fromCharCode(10);
    if (!edgeVersion) { const parts = []; for (const f of EDGE_FILES) parts.push(f + NL + await (await fetch('../' + f)).text()); edgeVersion = await sha256(new TextEncoder().encode(parts.join(NL))); }
    return edgeVersion;
  }
  const antibodies = () => { const st = ctx.store(); return keysOf(st, 'immune/').map((k) => untag(read(st, k).value)); };
  async function remember(sha, type, refusal) {
    const a = mint(sha, type, refusal, await edgeOf(), ctx.owner.install, Date.now());
    if (a) ctx.write('immune/' + sha + '.' + type + '.' + ctx.owner.install.slice(0, 16), (await tag(a)).t);
  }
  const elsewhere = (known) => (known.seen.length ? ' (your other device refused it too)' : '');

  async function bringIn(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = declaredOf(file.name);
    const sha = await sha256(bytes);
    const known = recognise(antibodies(), sha, type, await edgeOf(), ctx.owner.install);
    if (known.own) {
      const why = 'these exact bytes were refused here before (' + known.own.family + '), so nothing read them again';
      ctx.receipt('refused', { what: file.name.slice(0, 80), stage: 'immune', why });
      return { name: file.name, ok: false, why };
    }
    const v = verify(bytes, type);
    if (!v.ok) {
      await remember(sha, type, v);
      ctx.receipt('refused', { what: file.name.slice(0, 80), stage: v.stage, why: (v.why + elsewhere(known)).slice(0, 240) });
      return { name: file.name, ok: false, why: v.why };
    }
    const meta = { name: file.name.slice(0, 200), type, size: bytes.length, at: new Date().toISOString() };
    if (!ctx.store().keys['file/' + sha]) ctx.write('file/' + sha, ['ab', b64(bytes)]);
    const r = await sandboxRead(type, bytes.slice());
    if (!r.ok) {
      if (!r.stopped) await remember(sha, type, { stage: 'reader', why: r.why });
      ctx.write('files/' + sha, (await tag({ ...meta, status: 'quarantined', why: String(r.why).slice(0, 240) })).t);
      ctx.receipt('quarantined', { file: meta.name.slice(0, 80), why: (String(r.why) + elsewhere(known)).slice(0, 240) });
      return { name: file.name, ok: false, why: r.why };
    }
    ctx.write('files/' + sha, (await tag({ ...meta, status: 'kept' })).t);
    ctx.write('files/' + sha + '/read', (await tag(r.result)).t);
    ctx.receipt('imported', { file: meta.name.slice(0, 80), type, sha });
    return { name: file.name, ok: true };
  }

  function rows() {
    const st = ctx.store();
    return keysOf(st, 'files/').filter((k) => k.split('/').length === 2).map((k) => ({ sha: k.slice(6), ...untag(read(st, k).value) })).sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  function textOfReading(type, r) {
    if (!r) return '';
    if (type === 'pdf') return r.text;
    if (type === 'docx') return [...r.paragraphs, ...r.tables.flat(2)].join('\n');
    if (type === 'xlsx') return r.sheets.map((s) => s.name + '\n' + Object.entries(s.cells).map(([k, v]) => k + ': ' + v).join('\n')).join('\n\n');
    if (type === 'csv') return r.rows.map((x) => x.join(' | ')).join('\n');
    if (type === 'eml') return 'From: ' + r.from + '\nTo: ' + r.to + '\nSubject: ' + r.subject + '\nDate: ' + r.date + '\n\n' + r.text + (r.attachments.length ? '\n\nAttachments: ' + r.attachments.map((a) => a.name + ' (' + a.size + ' bytes)').join(', ') : '');
    if (type === 'ics') return r.events.map((e) => e.summary + ' — ' + e.start + ' to ' + e.end + (e.location ? ' at ' + e.location : '')).join('\n');
    if (type === 'vcf') return r.contacts.map((c) => c.fn + ' · ' + c.emails.join(', ') + ' · ' + c.tels.join(', ') + (c.org ? ' · ' + c.org : '')).join('\n');
    if (type === 'zip') return r.entries.map((e) => e.name + ' (' + e.size + ' bytes)').join('\n');
    return r.width + ' × ' + r.height + ' pixels';
  }
  function render() {
    const t = tally(antibodies(), ctx.owner.install), n = Object.values(t).reduce((a, b) => a + b, 0);
    $('file-immune').textContent = n ? 'The edge remembers ' + n + (n === 1 ? ' file' : ' files') + ' it kept out, and refuses the same bytes on sight: ' + Object.entries(t).map(([f, k]) => k + ' ' + f).join(', ') + '.' : '';
    const tb = $('file-rows');
    tb.replaceChildren(...rows().map((f) => {
      const tr = document.createElement('tr');
      const cell = (t, cls) => { const td = document.createElement('td'); td.textContent = t; if (cls) td.className = cls; tr.append(td); return td; };
      cell(f.name); cell(f.type); cell(f.size + ' bytes');
      cell(f.status === 'kept' ? 'read in the sandbox; original kept' : 'kept out: ' + f.why, f.status === 'kept' ? '' : 'bad');
      const act = cell('');
      if (f.status === 'kept') { const b = document.createElement('button'); b.textContent = 'Open'; b.addEventListener('click', () => view(f)); act.append(b); }
      return tr;
    }));
  }
  function view(f) {
    const reading = untag(read(ctx.store(), 'files/' + f.sha + '/read').value);
    $('file-view').hidden = false;
    $('file-view-name').textContent = f.name;
    $('file-view-text').textContent = textOfReading(f.type, reading);
    const ex = $('file-exports');
    ex.replaceChildren();
    const stem = f.name.replace(/\.[^.]+$/, '');
    const offer = (label, fmt, make) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => save(stem + '.' + fmt, fmt, make())); ex.append(b); };
    const text = textOfReading(f.type, reading);
    if (['pdf', 'docx', 'eml', 'zip', 'vcf', 'ics'].includes(f.type)) { offer('Save as PDF', 'pdf', () => pdf({ paragraphs: text.split('\n') })); offer('Save as Word (DOCX)', 'docx', () => docx({ paragraphs: text.split('\n') })); }
    if (f.type === 'xlsx') { const s = reading.sheets[0]; const grid = toGrid(s.cells); offer('Save as CSV', 'csv', () => csv(grid)); offer('Save as Excel (XLSX)', 'xlsx', () => xlsx({ sheets: [{ name: s.name, rows: grid }] })); }
    if (f.type === 'csv') { offer('Save as Excel (XLSX)', 'xlsx', () => xlsx({ sheets: [{ name: 'Sheet1', rows: reading.rows }] })); }
    if (f.type === 'ics') offer('Save as calendar (ICS)', 'ics', () => ics({ stamp: stamp(new Date()), events: reading.events }));
    if (f.type === 'vcf') offer('Save as CSV', 'csv', () => csv([['name', 'email', 'phone', 'organisation'], ...reading.contacts.map((c) => [c.fn, c.emails[0] || '', c.tels[0] || '', c.org])]));
  }
  function toGrid(cells) {
    const grid = [];
    for (const [ref, v] of Object.entries(cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) continue;
      let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
      const r = Number(m[2]) - 1; (grid[r] = grid[r] || [])[col - 1] = v;
    }
    return grid.map((row) => Array.from(row || [], (x) => (x === undefined ? '' : x)));
  }
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  async function save(name, fmt, bytes) {
    const st = ctx.store();
    const list = markers({ owner: ctx.owner.founder, device: ctx.owner.device, genome: ctx.genome, hashes: ctx.blocks.flatMap((b) => b.files.map((x) => x.sha256)), blocks: [] });
    for (const b of ctx.blocks) list.push({ marker: 'blocks/' + b.id + '/', re: new RegExp('blocks/' + b.id + '/', 'i') });
    const leaks = await scan(bytes, list, async (x) => { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(x); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); });
    void st;
    if (leaks.length) { $('write-says').textContent = 'Not saved: the file would carry ' + leaks.map((l) => l.marker).join(', ') + '.'; return false; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: MIME[fmt] || 'application/octet-stream' }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    ctx.receipt('exported', { file: name.slice(0, 80), format: fmt, bytes: bytes.length });
    ctx.note({ t: 'exported', file: name, bytes: bytes.length });
    return true;
  }

  $('file-in').addEventListener('change', async () => {
    const list = [...$('file-in').files];
    $('file-says').textContent = 'Checking ' + list.length + (list.length === 1 ? ' file…' : ' files…');
    const done = [];
    for (const f of list) done.push(await bringIn(f));
    $('file-in').value = '';
    const kept = done.filter((d) => d.ok).length;
    $('file-says').textContent = kept + ' of ' + done.length + ' brought in.' + (kept < done.length ? ' Kept out: ' + done.filter((d) => !d.ok).map((d) => d.name + ' (' + d.why + ')').join('; ') : '');
    render();
  });

  for (const b of document.querySelectorAll('[data-out]')) b.addEventListener('click', () => {
    const fmt = b.dataset.out, title = ($('w-title').value.trim() || 'note').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
    if (fmt === 'pdf' || fmt === 'docx') {
      const paragraphs = $('w-body').value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      return save(title + '.' + fmt, fmt, fmt === 'pdf' ? pdf({ paragraphs }) : docx({ paragraphs }));
    }
    if (fmt === 'eml') return save(($('w-subject').value.trim() || 'message').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) + '.eml', 'eml', eml({ from: $('w-from').value, to: $('w-to').value, subject: $('w-subject').value, date: new Date().toUTCString().replace('GMT', '+0000'), id: hex(crypto.getRandomValues(new Uint8Array(12))), text: $('w-mail').value }));
    if (fmt === 'ics') {
      const t = (v) => (v ? stamp(new Date(v)) : stamp(new Date()));
      return save(($('w-event').value.trim() || 'event').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) + '.ics', 'ics', ics({ stamp: stamp(new Date()), events: [{ uid: hex(crypto.getRandomValues(new Uint8Array(12))) + '@local', start: t($('w-start').value), end: t($('w-end').value), summary: $('w-event').value, location: $('w-place').value }] }));
    }
    const grid = $('w-table').value.split('\n').filter((l) => l.trim()).map((l) => l.split(',').map((c) => { const n = Number(c.trim()); return c.trim() !== '' && Number.isFinite(n) ? n : c.trim(); }));
    return save(title + '.' + fmt, fmt, fmt === 'xlsx' ? xlsx({ sheets: [{ name: 'Sheet1', rows: grid }] }) : csv(grid));
  });

  return { render, bringIn, save, sandboxRead, isParser: (id) => id === '__parser', TYPES };
}
