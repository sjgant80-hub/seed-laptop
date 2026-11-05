// page/page.mjs — the live page reads every result from the committed receipts: nothing measured is typed in by hand.
// A receipt that is not there yet shows as not measured, never as a number. The cost case runs the office's own
// kernels: src/cost.mjs classes every line with the sealed coverage map, src/rentcase.mjs carries it over the years
// with UK CPI; the visitor's calculator runs on what they type, the worked example on sourced list prices only, both
// read from the vendored basis (vendor/sovereign-enterprise/data/basis.json).
import { COVERAGE } from '../src/cost.mjs';
import { rentCase, seatLines, sourcesOf, heldBlocks, cpiOf, DEFAULT_USERS, DEFAULT_MOVES, DEFAULT_YEARS } from '../src/rentcase.mjs';

const $ = (id) => document.getElementById(id);
const get = async (p) => { try { const r = await fetch(p, { cache: 'no-store' }); return r.ok ? r.json() : null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pounds = (pence) => '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const secs = (ms) => (ms / 1000).toFixed(2) + ' s';
const table = (head, rows) => '<table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (i && head[i] ? ' data-label="' + esc(head[i]) + '"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';   // on a phone each cell carries its column's name

const CLAIMS = [
  ['L1a', 'l1', 'The full seed grows the office with no network at all, every block hash-verified, within 10 seconds.'],
  ['L1b', 'l1', 'The same seed grows the same office in a browser tab with the network off; every block starts and runs.'],
  ['L1b2', 'l1b2', 'The fix for L1b\'s probe, sealed before its own run: the same steps, every block read inside its own frame.'],
  ['L1c', 'l1', 'A tampered seed grows nothing.'],
  ['L1d', 'l1', 'A light seed pulls its blocks from the owner\'s own mirror and grows the identical office.'],
  ['L1e', 'l1e', 'After one visit, the office opens again with its origin unreachable, at every address a person or an installed app opens it by (sealed before its fix).'],
  ['L2a', 'l2','Real PDF, DOCX, XLSX, email, calendar, contact, CSV, image and zip files come in with sealed fidelity.'],
  ['L2b', 'l2', 'A hostile corpus is refused or quarantined, and the core never parses one byte of any file.'],
  ['L2c', 'l2', 'The parser sandbox has no network, cannot write or start processes, and is capped in memory and time.'],
  ['L3', 'l3', 'Files the office writes open in mainstream readers and carry nothing of its internals.'],
  ['L3b', 'l3b', 'The fix for L3\'s reading, sealed before its own runs: the same files and readers, read with two corrections.'],
  ['L4', 'l4', 'Wipe, reinstall, plant the seed, open the vault: everything comes back byte-identical within 15 seconds.'],
  ['L5', 'l5', 'Two devices stay consistent under offline edits, and losing one loses nothing it had shared.'],
  ['L6', 'l6', 'Nothing leaves the device during a sealed day of normal use, except the sends the user starts.'],
  ['L6b', 'l6b', 'The fix for L6\'s reading from below, sealed before its own run: only what the device sends, captured and read.'],
  ['L6c2', 'l6c2', 'The fix for L6\'s tab day, sealed before its own run: every block\'s frame found after it opens.'],
  ['L7', 'l7', 'The cost case, from a real user\'s own subscription list.'],
  ['G1', 'witness', 'Every kernel is mutation-gated clean and never throws on garbage.'],
];
const FILES = ['l1', 'l1b2', 'l1e', 'l2', 'l3', 'l3b', 'l4', 'l5', 'l6', 'l6b', 'l6c2', 'l7', 'witness', 'witness-ci'];
const commitLink = (c) => (c ? ' <a href="https://github.com/sjgant80-hub/seed-laptop/commit/' + esc(c) + '">' + esc(c.slice(0, 7)) + '</a>' : '');

function receipts(files) {
  const rows = CLAIMS.map(([id, file, says]) => {
    const r = files[file];
    let v = r && Array.isArray(r.verdicts) ? r.verdicts.find((x) => x.id === id) : null;
    if (id === 'G1' && r && Array.isArray(r.kernels)) {
      // G1's sealed scope is the kernels in src/: each half is counted on those rows only, and the verdict needs both halves
      // clean. The judge (measure/judge.mjs) is gated in the same run but sits outside that scope, so it is told apart.
      const ci = files['witness-ci'] && Array.isArray(files['witness-ci'].kernels) ? files['witness-ci'] : null;
      const inG1 = (k) => /^src\//.test(String(k.src)), sum = (ks, f) => ks.reduce((a, k) => a + k[f], 0);
      const half = (w) => { const ks = w.kernels.filter(inG1); return { ks, killed: sum(ks, 'killed'), total: sum(ks, 'total'), clean: ks.length > 0 && ks.every((k) => k.clean) }; };
      const lap = half(r), run = ci ? half(ci) : null, judge = ci ? ci.kernels.filter((k) => !inG1(k)) : [];
      v = { verdict: lap.clean && (!run || run.clean) ? 'HELD' : 'FAILED', says: 'On a laptop: ' + lap.killed + ' of ' + lap.total + ' mutants killed across ' + lap.ks.length + ' kernels in src/' + (lap.clean ? ', none capped, no unreviewed survivor' : ', NOT clean') + '.'
        + (run ? ' On GitHub\'s runner at ' + String(ci.commit || '').slice(0, 7) + ': ' + run.killed + ' of ' + run.total + ' across ' + run.ks.length + ' kernels in src/, ' + (run.clean ? 'clean' : 'NOT clean') + '.' : '')
        + judge.map((k) => ' In the same run, outside G1\'s scope, ' + k.src + ' (the judge): ' + k.killed + ' of ' + k.total + ', ' + (k.clean ? 'clean' : 'NOT clean') + '.').join('')
        + ' The hostile-input battery (2,000 inputs per function) runs in every test pass.' };
    }
    return { id, says, verdict: v ? v.verdict : 'UNMEASURED', measured: v ? v.says : 'Not measured yet.', commit: r && r.commit ? r.commit : null };
  });
  $('receipt-rows').innerHTML = rows.map((r) => '<tr><td><strong>' + r.id + '</strong></td><td>' + esc(r.says) + '</td><td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td><td>' + esc(r.measured) + commitLink(r.commit) + '</td></tr>').join('');
  const held = rows.filter((r) => r.verdict === 'HELD').length, failed = rows.filter((r) => r.verdict === 'FAILED').length;
  $('tally').textContent = held + ' held, ' + failed + ' failed (kept, never re-run until they pass), ' + (rows.length - held - failed) + ' not measured, of ' + rows.length + ' claims, each sealed before the code or the run that measures it.';
  return rows;
}

// what failed, and why: every number read from the receipts
function failures(files) {
  const el = $('failures');
  if (!el) return;
  const items = [];
  const l1b = files.l1 && files.l1.facts && files.l1.facts.L1b;
  if (l1b) items.push('<strong>L1b</strong> read ' + l1b.blocks.filter((x) => x.elements > 0).length + ' of ' + l1b.blocks.length + ' block frames: its probe named each frame by the URL it had when DevTools attached, before an isolated sandboxed frame has one. Every block had loaded, with ' + l1b.left + ' requests leaving the page. <strong>L1b2</strong>, sealed before its own run, read each block inside its own frame.');
  const l2 = files.l2 && files.l2.facts && files.l2.facts.L2b;
  if (l2) {
    const by = {};
    for (const h of l2.hostile) { const k = h.kind.replace(/-[0-9]+$/, ''); (by[k] = by[k] || { refused: 0, quarantined: 0, admitted: 0 })[h.outcome]++; }
    const name = { cut: 'cut short', flip: 'one bit flipped', zeroed: 'header zeroed', oversized: 'padded past the cap', polyglot: 'two files in one', macro: 'with an Office macro', mislabelled: 'named as another type' };
    items.push('<strong>L2b</strong> admitted ' + l2.hostile.filter((h) => h.outcome === 'admitted').length + ' of ' + l2.hostile.length + ' hostile files, by how each was made: ' + Object.entries(by).map(([k, v]) => esc(name[k] || k) + ' ' + v.refused + ' refused, ' + v.quarantined + ' quarantined, ' + v.admitted + ' admitted').join('; ') + '. A flipped bit inside a text file, an image\'s pixels or a PDF\'s uncompressed body leaves a well-formed file the format cannot tell from the original, so it is read; the core read none of them itself (' + l2.coreParses + ' parses in the core). After this run, Word and Excel files are checked part by part, including parts no reader opens.');
  }
  if (files.l3 && files.l3b) items.push('<strong>L3</strong> judged the PDF and LibreOffice\'s CSV unequal because of the instrument: its expected PDF text turned a line break into "?", and its CSV parser dropped an escaped quote. <strong>L3b</strong>, sealed before its own runs, reads them correctly.');
  const l6 = files.l6 && files.l6.facts && files.l6.facts.L6;
  if (l6 && l6.ci) items.push('<strong>L6</strong> counted ' + l6.ci.egress + ' packets to an undeclared destination from below, every one addressed to the device itself: the mail stand-in\'s replies coming in, read as if going out. Its tab day made none of its in-block edits (the same frame-naming fault as L1b). <strong>L6b</strong> captured only what the device sends; <strong>L6c2</strong> found every frame after it opened.');
  const c2 = files.l6c2 && files.l6c2.facts && files.l6c2.facts.L6c2 && files.l6c2.facts.L6c2.tab;
  if (c2) items.push('<strong>L6c2</strong> made all ' + c2.actions + ' actions with ' + c2.left + ' requests leaving the tab, but counted ' + c2.receipts + ' receipts for ' + c2.actions + ' actions; the claim asks for exactly one each. The recorded demo below shows where the extra ones come from: a block\'s own saves (it writes its first state when it opens) leave receipts too, so the office writes more receipts than the user takes actions, never fewer.');
  el.innerHTML = items.length ? '<ul>' + items.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : '<p>Nothing measured has failed.</p>';
}

function trace(l1, l1b2) {
  const f = l1 && l1.facts;
  // the browser run is L1b2's, the fixed probe (each block read inside its own frame): its receipt keeps its facts flat
  const fixed = l1b2 && l1b2.facts ? (l1b2.facts.L1b2 || l1b2.facts) : null;
  const b = fixed && Array.isArray(fixed.blocks) ? fixed : f && f.L1b;
  if (!f || !b || !Array.isArray(b.blocks)) { $('trace').innerHTML = '<p style="padding:.8rem">Not measured yet: the trace appears with the first measured run.</p>'; return; }
  const a = f.L1a;
  const rows = [];
  if (a && Array.isArray(a.runs)) rows.push(['On a laptop, no network permission', 'planted the stock seed ' + a.runs.length + ' times', a.runs.map((r) => secs(r.ms)).join(' · ')]);
  rows.push([esc(String(b.chrome || 'Chrome').replace('/', ' ')), 'network off, then the seed chosen; every block opened in turn', secs(b.ms || 0) + ' to the last block loaded']);
  for (const x of b.blocks) rows.push(['&nbsp;&nbsp;block <code>' + esc(x.id) + '</code>', (x.loaded ? 'started' : 'did NOT start') + ' in its sandbox · ' + x.elements + ' elements drawn · ' + x.exceptions + ' exceptions', '']);
  rows.push(['Requests to other origins', (b.left === 0 ? 'none left the page' : b.left + ' LEFT the page') + '; ' + b.refused + ' refused by the browser before sending' + (b.refusedHosts && b.refusedHosts.length ? ' (' + b.refusedHosts.map(esc).join(', ') + ')' : ''), '']);
  const where = (r) => esc((r && r.machine && r.machine.os) || 'the machine named in the receipt');
  $('trace').innerHTML = table(['Step', 'What happened', 'Time'], rows) + '<p style="padding:0 .8rem .8rem;color:var(--dim)">The plantings measured at commit' + commitLink(l1.commit) + ' on ' + where(l1) + ' (claim L1a, <a href="receipts/l1.json">receipts/l1.json</a>)'
    + (b === fixed ? '; the browser run at commit' + commitLink(l1b2.commit) + ' on ' + where(l1b2) + ' (claim L1b2, <a href="receipts/l1b2.json">receipts/l1b2.json</a>)' : '') + '.</p>';
}

// what each gated kernel does, in the words of witness-all.mjs (the gate's own list); the numbers come from the receipts
const KERNEL_WHAT = {
  runtime: 'What this runtime can do, and whether the office can grow on it (layer 2).',
  genome: 'The signed genome: canonical, every field checked, refused if one bit changed (organ 2).',
  bundle: 'The full seed: the genome and every block in one LIGHT vault (organ 2).',
  receipt: 'Every action leaves a sentence a person can read.',
  germinate: 'The seed grows the office: verify, check every pin, compose, first run (organ 2).',
  prologue: 'The bridge each block runs first: its storage, in memory, every change to the office (organ 3).',
  value: 'What a block stores, as one-spelling JSON the office can keep, back up and sync (organ 3).',
  compose: 'The frame policy, the bridge inlined first, a block\'s own modules as data: URLs (organ 3).',
  store: 'The one store: a multi-value CRDT, nothing silently lost, originals read-only (organ 3).',
  office: 'Where each block\'s data lives in the store, and how a block starts from it (organ 3).',
  kar: 'The conductor: a closed list of doings, a floor with no model; a model may only pick (organ 3).',
  'edge-in': 'Verify-before-parse on raw bytes: type, size, magic, shape (organ 4).',
  'edge-out': 'The writers: PDF, DOCX, XLSX, EML, ICS, CSV, with no metadata (organ 4).',
  leak: 'Does a file leaving carry anything of the office\'s internals (organ 4).',
  immune: 'The inbound edge\'s memory: a file kept out once is refused on sight, never a false immunity (organ 4).',
  imap: 'Mail in from the owner\'s own account: the IMAP words, read-only by construction (organ 4).',
  zip: 'The zip reader, run only in the sandbox: every entry\'s CRC (organ 4).',
  xml: 'The XML reader, run only in the sandbox: no doctype, no entity (organ 4).',
  'office-read': 'The DOCX and XLSX reader, run only in the sandbox; a macro is refused as a rule (organ 4).',
  pdf: 'The PDF reader, run only in the sandbox: every stream checked (organ 4).',
  mail: 'The MIME mail reader, run only in the sandbox: a multipart message\'s closing boundary (organ 4).',
  text: 'The CSV, calendar and contact readers, run only in the sandbox (organ 4).',
  image: 'The image header reader, run only in the sandbox: PNG chunk CRCs, JPEG, GIF and WebP structure (organ 4).',
  read: 'The door the readers share, with its integrity walks (organ 4).',
  vault: 'The owner\'s encrypted vault: LIGHT inside AES-256-GCM, the key from the phrase (organ 5).',
  regrow: 'What the vault keeps, whether a vault may be restored, the regrown device\'s fresh watch (organ 5).',
  sync: 'The owner\'s devices: the founder-signed roster, LIGHT packets through the door (organ 6).',
  cost: 'The cost case from the owner\'s own list, item by item, in whole pence, with the sealed coverage map (organ 7).',
  rentcase: 'The cost case over the years: the sourced basis (UK CPI, list prices), the sealed map\'s coverage, the reader\'s own lines and choices.',
  judge: 'The sealed claims judged on measured facts: each rule as its seal wrote it, and one plain sentence of what was measured. Every verdict on this page comes from it; its tests re-judge every committed receipt.',
};

function gate(w, ci) {
  const use = ci && Array.isArray(ci.kernels) ? ci : w;
  if (!use || !Array.isArray(use.kernels)) { $('gate').innerHTML = '<p style="padding:.8rem">The gate receipt appears with the full run.</p>'; return; }
  const where = use === ci ? 'GitHub\'s runner' : 'a laptop';
  $('gate').innerHTML = table(['Kernel', 'What it does', 'Mutants killed', 'Clean'], use.kernels.map((k) => ['<code>' + esc(k.src) + '</code>', esc(KERNEL_WHAT[k.name] || ''), k.killed + ' / ' + k.total + (k.ignored ? ' (' + k.ignored + ' reviewed-equivalent, each with its written reason)' : ''), k.clean ? 'yes' : '<strong>no</strong>']))
    + '<p style="padding:0 .8rem .8rem;color:var(--dim)">On ' + where + ': ' + use.killed + ' of ' + use.total + ' mutants killed across ' + use.kernels.length + ' kernels, at commit' + commitLink(use.commit) + (use.node ? ', Node ' + esc(use.node) : '') + (use.ci && use.ci.url ? ', <a href="' + esc(use.ci.url) + '">run ' + esc(use.ci.run) + '</a>' : '') + ' (<a href="receipts/' + (use === ci ? 'witness-ci' : 'witness') + '.json">its receipt</a>).'
    + (use === ci && w && Array.isArray(w.kernels) ? ' On a laptop: ' + w.killed + ' of ' + w.total + ' across ' + w.kernels.length + ' kernels, at commit' + commitLink(w.commit) + ' (<a href="receipts/witness.json">its receipt</a>).' : '') + '</p>';
}

function demo(d) {
  if (!d || !Array.isArray(d.steps)) { $('demo-steps').innerHTML = '<p>The demo appears once it is recorded.</p>'; return; }
  $('demo-steps').innerHTML = '<ol class="demo">' + d.steps.map((s) => '<li><figure><img src="' + esc(s.screenshot) + '" alt="' + esc(s.did) + '" loading="lazy" width="1280" height="800"><figcaption><strong>' + esc(s.did) + '</strong>'
    + (s.receipts.length ? '<ul>' + s.receipts.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') + '</figcaption></figure></li>').join('') + '</ol>'
    + '<p style="color:var(--dim)">' + d.steps.length + ' steps, ' + d.steps.reduce((a, s) => a + s.receipts.length, 0) + ' receipts; ' + d.kept.machineOne + ' things kept on the first machine, ' + d.kept.machineTwo + ' back on the second. Recorded at commit' + commitLink(d.commit) + ' in Chrome ' + esc(d.machine.chrome || '') + '.</p>';
}

const FORMAT_NAME = { pdf: 'PDF', docx: 'Word (DOCX)', xlsx: 'Excel (XLSX)', eml: 'Email (EML)', ics: 'Calendar (ICS)', vcf: 'Contacts (VCF)', csv: 'CSV', zip: 'Zip', image: 'Images (PNG, JPEG, GIF, WebP)' };
function compat(l2) {
  const benign = l2 && l2.facts && l2.facts.L2a ? l2.facts.L2a.benign : null;
  if (!Array.isArray(benign)) { $('compat').innerHTML = '<p style="padding:.8rem">Not measured yet.</p>'; return; }
  const by = {};
  for (const r of benign) {
    const k = ['png', 'jpeg', 'gif', 'webp'].includes(r.type) ? 'image' : r.type;
    const o = by[k] || (by[k] = { files: 0, fields: 0, exact: 0, worst: 1 });
    o.files++; o.fields += r.fields || 0; o.exact += r.exact || 0;
    if (r.fields) o.worst = Math.min(o.worst, r.exact / r.fields);
  }
  $('compat').innerHTML = table(['Format', 'Files', 'Recovered exactly', 'In this run'], Object.keys(by).sort().map((k) => {
    const o = by[k], share = o.fields ? o.exact / o.fields : 0;
    return [FORMAT_NAME[k] || esc(k), String(o.files), (100 * share).toFixed(1) + '%' + (k === 'pdf' ? ' of words (worst file ' + (100 * o.worst).toFixed(1) + '%)' : ' of fields'), share === 1 ? 'lossless' : 'best effort'];
  }));
}

// the cost case: the office's own kernels on the visitor's own lines, and on sourced list prices
// A block counts as covering only if it held in the measured browser run (L1b2's receipt, by L7's own rule); before
// that receipt exists, the sealed map's own blocks.
const WORKING = ['office', 'crm', 'ledger', 'pdf', 'mind', 'image', 'layout'];
let working = WORKING;
let basis = null;
const LEVEL = { covered: 'covered', partly: 'partly covered', not: 'not covered' };
const yearsOf = (el) => { const n = Number(String(el.value).trim()); return Number.isInteger(n) ? n : NaN; };

function rowEl(name = '', amount = '', per = 'month', seats = '1') {
  const d = document.createElement('div');
  d.className = 'row five';
  d.innerHTML = '<input aria-label="Service" placeholder="e.g. Microsoft 365 Business Standard" value="' + esc(name) + '"><input aria-label="Amount in pounds" inputmode="decimal" placeholder="12.30" value="' + esc(amount) + '"><select aria-label="Per"><option value="month">month</option><option value="year">year</option></select><input aria-label="Seats" inputmode="numeric" value="' + esc(seats) + '">'
    + '<label class="tick"><input type="checkbox" aria-label="Move it if partly covered"> move</label>';
  d.querySelector('select').value = per;
  return d;
}

function report(r) {
  if (!r.ok) return '<p style="padding:.8rem">' + esc(r.why) + '.</p>';
  const n = r.years, yrs = n === 1 ? '1 year' : n + ' years';
  const head = ['Service', 'A year now', 'Over ' + yrs, 'The grown office', 'Why'];
  const rows = r.items.map((x) => [esc(x.name), pounds(x.yearly), pounds(x.over),
    LEVEL[x.level] + (x.by && x.by.length ? ' (' + x.by.map(esc).join(', ') + ')' : '') + ' · <strong>' + (x.moved ? 'moves' : 'stays') + '</strong>', esc(x.why)]);
  return table(head, rows)
    + '<p style="padding:0 .8rem .8rem">Over ' + yrs + ', each year after the first rising by UK CPI (' + (100 * r.cpi).toFixed(1) + '%): <strong>today ' + pounds(r.over.today) + '</strong>; <strong>with the grown office ' + pounds(r.over.office) + '</strong>, the lines that stay; <strong>saved ' + pounds(r.over.saving) + '</strong> ('
    + pounds(r.yearly.saving) + ' this year). Partly covered lines you kept: ' + pounds(r.over.atStake) + ', still on the bill until the team that uses them decides. Not covered by the office: ' + pounds(r.over.notCovered) + ', the same on both sides.</p>';
}

function calc() {
  const rows = $('calc-rows');
  for (const ex of [['', '', 'month', '1'], ['', '', 'month', '1'], ['', '', 'year', '1']]) rows.append(rowEl(...ex));
  $('calc-years').value = String(DEFAULT_YEARS);
  $('calc-add').addEventListener('click', () => rows.append(rowEl()));
  $('calc').addEventListener('submit', (e) => {
    e.preventDefault();
    const lines = [...rows.children].map((d) => {
      const [n, a, p, s, m] = d.querySelectorAll('input, select');
      return { name: n.value.trim(), amount: Math.round(Number(String(a.value).replace(/[£,\s]/g, '')) * 100), per: p.value, seats: Number(s.value), move: m.checked };
    }).filter((x) => x.name);
    const out = $('calc-out');
    out.hidden = false;
    out.innerHTML = basis ? report(rentCase(basis, { lines, working, years: yearsOf($('calc-years')) })) : '<p style="padding:.8rem">The sourced basis did not load, so the case cannot be carried over the years.</p>';
  });
}

function example() {
  const form = $('example-form'), out = $('example');
  const lines = basis ? seatLines(basis) : null;
  if (!lines) { out.innerHTML = '<p>The sourced prices did not load.</p>'; return; }
  const rows = $('example-rows');
  rows.innerHTML = '';
  for (const key of Object.keys(DEFAULT_USERS)) {
    const e = basis[key];
    const d = document.createElement('div');
    d.className = 'row ex';
    d.dataset.key = key;
    d.innerHTML = '<span><strong>' + esc(e.product) + '</strong><br><span class="dim">' + pounds(Math.round(e.value * 100)) + ' a user a month, list price (<a href="' + esc(e.source) + '">source</a>)</span></span>'
      + '<input aria-label="People on ' + esc(e.product) + '" inputmode="numeric" value="' + esc(DEFAULT_USERS[key]) + '">'
      + '<label class="tick"><input type="checkbox" aria-label="Move ' + esc(e.product) + ' if partly covered"' + (DEFAULT_MOVES[key] ? ' checked' : '') + '> move</label>';
    rows.append(d);
  }
  $('example-years').value = String(DEFAULT_YEARS);
  const run = () => {
    const users = {}, moves = {};
    for (const d of rows.children) { const [n, m] = d.querySelectorAll('input'); users[d.dataset.key] = Number(String(n.value).trim()); moves[d.dataset.key] = m.checked; }
    const ls = seatLines(basis, users, moves);
    out.innerHTML = '<div class="tablewrap">' + (ls ? report(rentCase(basis, { lines: ls, working, years: yearsOf($('example-years')) })) : '<p style="padding:.8rem">People on each line: a whole number from 0.</p>') + '</div>';
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  form.addEventListener('change', run);
  run();
}

// what each figure does in this case (the basis describes each in its own words, for the estate's wider use; both shown)
const USED = {
  cpi: 'every rented line, each year after the first',
  'seat.crm': 'the worked example\'s CRM line, per person',
  'seat.finance': 'the worked example\'s finance line, per person',
  'seat.hr': 'the worked example\'s HR line, per person',
};
function sources() {
  const el = $('sources');
  if (!basis) { el.innerHTML = '<p style="padding:.8rem">The sourced basis did not load.</p>'; return; }
  const fmt = (s) => (s.key === 'cpi' ? (100 * s.value).toFixed(1) + '% a year' : pounds(Math.round(s.value * 100)) + ' a user a month');
  // "estate basis 2026-09-30": the day the figure was sourced into the estate's price registry (the basis's own note)
  const when = (v) => { const m = /^estate basis (\d{4}-\d{2}-\d{2})$/.exec(String(v || '')); return m ? 'sourced ' + m[1] : String(v || ''); };
  el.innerHTML = table(['Figure, in the basis\'s own words', 'Value', 'Used here for', 'Source'], sourcesOf(basis).map((s) => [esc(s.what), fmt(s), esc(USED[s.key] || ''), '<a href="' + esc(s.source) + '">' + esc(new URL(s.source).hostname) + '</a>' + (s.via ? ' · ' + esc(when(s.via)) : '')]))
    + '<p style="padding:0 .8rem .8rem;color:var(--dim)">All amounts in ' + esc(String(basis.currency || 'GBP').split(' (')[0]) + ', as the basis states. Read from <a href="vendor/sovereign-enterprise/data/basis.json">vendor/sovereign-enterprise/data/basis.json</a>, copied byte for byte from the estate\'s sourced basis (<a href="vendor/sovereign-enterprise/SOURCES.json">its commit and SHA-256</a>).</p>';
}

(async () => {
  // every file at once: a cold load waits for the slowest one, not for all of them in turn
  const [got, b, d] = await Promise.all([Promise.all(FILES.map((f) => get('receipts/' + f + '.json'))), get('vendor/sovereign-enterprise/data/basis.json'), get('receipts/demo.json')]);
  const files = Object.fromEntries(FILES.map((f, k) => [f, got[k]]));
  basis = b;
  if (basis && cpiOf(basis) === null) basis = null;
  const rows = receipts(files);
  const fixed = rows.find((r) => r.id === 'L1b2');
  if (fixed && fixed.verdict === 'HELD') working = heldBlocks(files.l1b2);
  trace(files.l1, files.l1b2); failures(files); gate(files.witness, files['witness-ci']); compat(files.l2); demo(d);
  calc(); example(); sources();
  window.__page = { rows, coverage: COVERAGE.length, working };
})();
