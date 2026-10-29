#!/usr/bin/env node
// measure/l3.mjs — claim L3: files the office writes open in mainstream readers and carry nothing of its internals.
//
//   node measure/l3.mjs local     on this laptop: write the six files, scan them for leaks, open them in the local
//                                 readers (measure/readers.py local), write receipts/l3-local.json
//   node measure/l3.mjs ci        the same on GitHub's runner with the CI readers → receipts/l3-ci.json (an artifact,
//                                 committed as it came)
//   node measure/l3.mjs judge     read both receipts and judge L3 → receipts/l3.json
//
// The office it writes for is planted from the stock seed with a public test phrase, so the leak markers are real:
// that owner's and device's keys, the genome's id, the publisher's key, every block file's SHA-256, each block's
// folder (blocks/<id>/), the vault's reference form, the product's and the foundation's names, the home folder and
// the OS user name.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir, userInfo, platform, release } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { docx, xlsx, pdf, eml, ics, csv, WINANSI } from '../src/edge-out.mjs';
import { markers, scan } from '../src/leak.mjs';
import { germinate } from '../src/germinate.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const OUT = join(ROOT, '.out', 'l3');
const C = JSON.parse(readFileSync(join(ROOT, 'measure', 'out-content.json'), 'utf8'));
const PHRASE = 'the measured owner of the stock office, a public test phrase';
const norm = (s) => String(s === null || s === undefined ? '' : s).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

export function written() {
  return {
    'letter.pdf': pdf({ paragraphs: C.letter.paragraphs }),
    'letter.docx': docx({ paragraphs: C.letter.paragraphs, table: C.letter.table }),
    'quote.xlsx': xlsx(C.book),
    'message.eml': eml(C.mail),
    'diary.ics': ics(C.calendar),
    'people.csv': csv(C.rows),
  };
}

// what each reader must give back, per file kind
export function expected(file) {
  const ext = file.split('.').pop();
  if (ext === 'pdf') return norm(C.letter.paragraphs.map(WINANSI).join(' '));
  if (ext === 'docx') return { paragraphs: C.letter.paragraphs, cells: C.letter.table.flat() };
  if (ext === 'xlsx') return C.book.sheets[0].rows;
  if (ext === 'eml') return C.mail;
  if (ext === 'ics') return C.calendar.events;
  return C.rows;
}

const cellText = (v) => (v === true ? 'TRUE' : v === false ? 'FALSE' : String(v));
export function matches(reader, file, content) {
  const want = expected(file);
  try {
    if (file.endsWith('.pdf')) return norm(content) === want;
    if (reader === 'python-docx') return JSON.stringify(content.paragraphs.filter((p) => p !== '').map(norm)) === JSON.stringify(want.paragraphs.map(norm)) && JSON.stringify(content.cells.map(norm)) === JSON.stringify(want.cells.map(norm));
    if (reader === 'LibreOffice (DOCX)') { const t = norm(content); return want.paragraphs.every((p) => t.includes(norm(p))) && want.cells.every((c) => t.includes(norm(c))); }
    if (reader === 'openpyxl') { const rows = content[C.book.sheets[0].name]; return JSON.stringify(rows) === JSON.stringify(want); }
    if (reader === 'LibreOffice (XLSX)') { const rows = content.trim().split(/\r?\n/).map((l) => l.split(',')); return JSON.stringify(rows) === JSON.stringify(want.map((r) => r.map(cellText))); }
    if (reader === 'Python email') return ['subject', 'from', 'to', 'date'].every((k) => norm(content[k]) === norm(want[k])) && norm(content.text) === norm(want.text);
    if (reader === 'icalendar') return want.every((e) => content.some((g) => ['uid', 'summary', 'location', 'start', 'end'].every((k) => norm(g[k]) === norm(e[k])) && norm(g.description) === norm(e.description || '')));
    if (reader === 'Python csv') return JSON.stringify(content) === JSON.stringify(want);
    if (reader === 'LibreOffice (CSV)') { const rows = []; let cur = []; let cell = ''; let q = false; for (const ch of content.replace(/\r\n/g, '\n')) { if (q) { if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { cur.push(cell); cell = ''; } else if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; } else cell += ch; } if (cell || cur.length) { cur.push(cell); rows.push(cur); } return JSON.stringify(rows) === JSON.stringify(want); }
    return false;
  } catch { return false; }
}

async function officeContext() {
  const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  const g = await germinate({ full: new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full'))) }, { pinned, phrase: PHRASE, at: '2026-10-29T12:00:00Z' });
  return {
    owner: g.owner.id, device: g.owner.device, genome: g.genome.id, vault: 'vault/' + g.owner.id.slice(0, 32),
    hashes: [...g.office.blocks.flatMap((b) => b.files.map((f) => f.sha256)), pinned[0]],
    blocks: g.office.blocks.map((b) => 'blocks/' + b.id + '/'),
    home: homedir(), user: userInfo().username,
  };
}

async function measure(where) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files = written();
  for (const [n, b] of Object.entries(files)) writeFileSync(join(OUT, n), b);
  const ctx = await officeContext();
  const list = markers({ ...ctx, blocks: [] });
  for (const b of ctx.blocks) list.push({ marker: b, re: new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  const leaks = {};
  for (const [n, b] of Object.entries(files)) leaks[n] = await scan(b, list, async (x) => new Uint8Array(inflateRawSync(x)));
  const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [join(ROOT, 'measure', 'readers.py'), OUT, where], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 });
  let readers = {};
  try { readers = JSON.parse(py.stdout); } catch { readers = { error: (py.stderr || py.stdout || '').slice(-400) }; }
  const results = {};
  for (const [reader, perFile] of Object.entries(readers)) {
    if (perFile && perFile.missing) { results[reader] = { missing: perFile.missing }; continue; }
    results[reader] = {};
    for (const [file, r] of Object.entries(perFile || {})) results[reader][file] = { opened: Boolean(r && r.opened), equal: Boolean(r && r.opened && matches(reader, file, r.content)), ...(r && r.opened ? {} : { error: r && r.error }) };
  }
  const markersCounted = list.length;
  return { where, machine: { os: platform() + ' ' + release(), node: process.version }, files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, b.length])), readers: results, leaks, markers: markersCounted };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'local' || mode === 'ci') {
    const f = await measure(mode);
    mkdirSync(join(ROOT, 'receipts'), { recursive: true });
    writeFileSync(join(ROOT, 'receipts', 'l3-' + mode + '.json'), JSON.stringify({ kind: 'seed-laptop.l3-readers', v: 1, commit: git('rev-parse', 'HEAD'), ...f }, null, 1) + '\n');
    for (const [r, x] of Object.entries(f.readers)) console.log(r.padEnd(22) + (x.missing ? 'MISSING ' + x.missing : Object.entries(x).map(([file, y]) => file + (y.equal ? ' ✓' : y.opened ? ' ≠' : ' ✗')).join('  ')));
    console.log('leaks: ' + Object.values(f.leaks).flat().length + ' over ' + f.markers + ' markers');
  } else if (mode === 'judge') {
    const read = (w) => (existsSync(join(ROOT, 'receipts', 'l3-' + w + '.json')) ? JSON.parse(readFileSync(join(ROOT, 'receipts', 'l3-' + w + '.json'), 'utf8')) : null);
    const facts = { L3: { ci: read('ci'), local: read('local') } };
    const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((x) => x.id === 'L3');
    const verdicts = judge(claims, facts);
    for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
    writeFileSync(join(ROOT, 'receipts', 'l3.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L3', commit: git('rev-parse', 'HEAD'), facts, verdicts }, null, 1) + '\n');
  } else { console.log('usage: node measure/l3.mjs local | ci | judge'); process.exit(2); }
}
