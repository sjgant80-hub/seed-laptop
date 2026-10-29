// page/page.mjs — the live page reads every result from the committed receipts: nothing measured is typed in by hand.
// A receipt that is not there yet shows as not measured, never as a number. The cost calculator runs the office's own
// cost kernel (src/cost.mjs) on what the visitor types; the worked example runs it on sourced list prices only.
import { cost, COVERAGE } from '../src/cost.mjs';

const $ = (id) => document.getElementById(id);
const get = async (p) => { try { const r = await fetch(p, { cache: 'no-store' }); return r.ok ? r.json() : null; } catch { return null; } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pounds = (pence) => '£' + (pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const secs = (ms) => (ms / 1000).toFixed(2) + ' s';
const table = (head, rows) => '<table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';

const CLAIMS = [
  ['L1a', 'l1', 'The full seed grows the office with no network at all, every block hash-verified, within 10 seconds.'],
  ['L1b', 'l1', 'The same seed grows the same office in a browser tab with the network off; every block starts and runs.'],
  ['L1b2', 'l1b2', 'The fix for L1b\'s probe, sealed before its own run: the same steps, every block read inside its own frame.'],
  ['L1c', 'l1', 'A tampered seed grows nothing.'],
  ['L1d', 'l1', 'A light seed pulls its blocks from the owner\'s own mirror and grows the identical office.'],
  ['L2a', 'l2', 'Real PDF, DOCX, XLSX, email, calendar, contact, CSV, image and zip files come in with sealed fidelity.'],
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
const FILES = ['l1', 'l1b2', 'l2', 'l3', 'l3b', 'l4', 'l5', 'l6', 'l6b', 'l6c2', 'l7', 'witness'];
const commitLink = (c) => (c ? ' <a href="https://github.com/sjgant80-hub/seed-laptop/commit/' + esc(c) + '">' + esc(c.slice(0, 7)) + '</a>' : '');

function receipts(files) {
  const rows = CLAIMS.map(([id, file, says]) => {
    const r = files[file];
    let v = r && Array.isArray(r.verdicts) ? r.verdicts.find((x) => x.id === id) : null;
    if (id === 'G1' && r) v = { verdict: r.clean ? 'HELD' : 'FAILED', says: r.killed + ' of ' + r.total + ' mutants killed across ' + r.kernels.length + ' kernels' + (r.clean ? ', none capped, no unreviewed survivor' : '') + '; the hostile-input battery (2,000 inputs per function) runs in every test pass.' };
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
  if (f && l1b2 && l1b2.facts && l1b2.facts.L1b2) f.L1b = l1b2.facts.L1b2;   // the fixed probe: each block read inside its own frame
  if (!f || !f.L1b || !Array.isArray(f.L1b.blocks)) { $('trace').innerHTML = '<p style="padding:.8rem">Not measured yet: the trace appears with the first measured run.</p>'; return; }
  const b = f.L1b, a = f.L1a;
  const rows = [];
  if (a && Array.isArray(a.runs)) rows.push(['On a laptop, no network permission', 'planted the stock seed ' + a.runs.length + ' times', a.runs.map((r) => secs(r.ms)).join(' · ')]);
  rows.push(['Chrome ' + esc(b.chrome || ''), 'network off, then the seed chosen; every block opened in turn', secs(b.ms || 0) + ' to the last block loaded']);
  for (const x of b.blocks) rows.push(['&nbsp;&nbsp;block <code>' + esc(x.id) + '</code>', (x.loaded ? 'started' : 'did NOT start') + ' in its sandbox · ' + x.elements + ' elements drawn · ' + x.exceptions + ' exceptions', '']);
  rows.push(['Requests to other origins', (b.left === 0 ? 'none left the page' : b.left + ' LEFT the page') + '; ' + b.refused + ' refused by the browser before sending' + (b.refusedHosts && b.refusedHosts.length ? ' (' + b.refusedHosts.map(esc).join(', ') + ')' : ''), '']);
  $('trace').innerHTML = table(['Step', 'What happened', 'Time'], rows) + '<p style="padding:0 .8rem .8rem;color:var(--dim)">Measured at commit' + commitLink(l1.commit) + ' on ' + esc((l1.machine && l1.machine.os) || 'the machine named in the receipt') + '.</p>';
}

function gate(w) {
  if (!w || !Array.isArray(w.kernels)) { $('gate').innerHTML = '<p style="padding:.8rem">The gate receipt appears with the full run.</p>'; return; }
  $('gate').innerHTML = table(['Kernel', 'Mutants killed', 'Clean'], w.kernels.map((k) => ['<code>' + esc(k.src) + '</code>', k.killed + ' / ' + k.total + (k.ignored ? ' (' + k.ignored + ' reviewed-equivalent)' : ''), k.clean ? 'yes' : '<strong>no</strong>']))
    + '<p style="padding:0 .8rem .8rem;color:var(--dim)">' + w.killed + ' of ' + w.total + ' mutants killed across ' + w.kernels.length + ' kernels, at commit' + commitLink(w.commit) + '.</p>';
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

// the calculator: the visitor's own lines, through the office's own cost kernel
const WORKING = ['office', 'crm', 'ledger', 'pdf', 'mind', 'image', 'layout'];
let working = WORKING;
function rowEl(name = '', amount = '', per = 'month', seats = '1') {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = '<input aria-label="Service" placeholder="e.g. Microsoft 365 Business Standard" value="' + esc(name) + '"><input aria-label="Amount in pounds" inputmode="decimal" placeholder="12.30" value="' + esc(amount) + '"><select aria-label="Per"><option value="month">month</option><option value="year">year</option></select><input aria-label="Seats" inputmode="numeric" value="' + esc(seats) + '">';
  d.querySelector('select').value = per;
  return d;
}
function report(r) {
  if (!r.ok) return '<p style="padding:.8rem">' + esc(r.why) + '.</p>';
  const lv = { covered: 'covered', partly: 'partly covered', not: 'not covered' };
  return table(['Service', 'A year', 'The grown office', 'Why'], r.items.map((x) => [esc(x.name), pounds(x.yearly), lv[x.level] + (x.by && x.by.length ? ' (' + x.by.map(esc).join(', ') + ')' : ''), esc(x.why)]))
    + '<p style="padding:0 .8rem .8rem"><strong>' + pounds(r.yearly) + '</strong> a year in all: <strong>' + pounds(r.coveredYearly) + '</strong> covered, ' + pounds(r.partlyYearly) + ' partly covered (kept on the bill until you decide), ' + pounds(r.notYearly) + ' not covered.</p>';
}
function calc() {
  const rows = $('calc-rows');
  for (const ex of [['', '', 'month', '1'], ['', '', 'month', '1'], ['', '', 'year', '1']]) rows.append(rowEl(...ex));
  $('calc-add').addEventListener('click', () => rows.append(rowEl()));
  $('calc').addEventListener('submit', (e) => {
    e.preventDefault();
    const list = [...rows.children].map((d) => { const [n, a, p, s] = d.querySelectorAll('input, select'); return { name: n.value.trim(), amount: Math.round(Number(String(a.value).replace(/[£,\s]/g, '')) * 100), per: p.value, seats: Number(s.value) }; }).filter((x) => x.name);
    const out = $('calc-out');
    out.hidden = false;
    out.innerHTML = report(cost(list, working));
  });
}

async function example() {
  const lock = await get('page/prices.lock.json');
  const crm = lock && Array.isArray(lock.entries) ? lock.entries.find((e) => e.id === 'salesforce-pro-suite') : null;
  if (!crm) { $('example').innerHTML = '<p>The sourced prices did not load.</p>'; return; }
  const seats = 10;
  const r = cost([{ name: crm.product, amount: Math.round(crm.price * 100), per: 'month', seats }], working);
  $('example').innerHTML = '<p>' + seats + ' people on <strong>' + esc(crm.product) + '</strong> at the list price of ' + esc(crm.currency) + ' ' + esc(crm.price) + ' ' + esc(crm.per) + ' (VAT ' + esc(crm.vat) + '; <a href="' + esc(crm.source) + '">source</a>, checked ' + esc(crm.checked) + '):</p><div class="tablewrap">' + report(r) + '</div>'
    + '<p>The registry holds a sourced list price for this one function today; any line you pay for, you can price above from your own invoice.</p>';
}

(async () => {
  const files = {};
  for (const f of FILES) files[f] = await get('receipts/' + f + '.json');
  const rows = receipts(files);
  const l1b = rows.find((r) => r.id === 'L1b');
  // a block counts as working only if the measured run held L1b; before a measurement, the sealed map's own blocks
  if (l1b && l1b.verdict === 'FAILED' && files.l1 && files.l1.facts && files.l1.facts.L1b) working = files.l1.facts.L1b.blocks.filter((b) => b.loaded && b.exceptions === 0 && b.elements > 0).map((b) => b.id);
  trace(files.l1, files.l1b2); failures(files); gate(files.witness); compat(files.l2); demo(await get('receipts/demo.json'));
  calc(); example();
  window.__page = { rows, coverage: COVERAGE.length };
})();
