// ════════════════════════════════════════════════════════════════
// measure/judge.mjs — the sealed claims (measure/claims.json), judged on measured facts. Pure, total, gated.
//
//   RULES[id](facts, bound) → true | false      the claim's held_if, as code, on the facts its measure recorded
//   SAYS[id](facts)         → one plain sentence of what was measured, whatever the verdict
//   judge(claims, facts)    → [{ id, verdict: 'HELD' | 'FAILED' | 'UNMEASURED', says }]
//       a claim with no facts is UNMEASURED (never filled in); a claim whose rule throws on its facts is FAILED
//
// Each rule reads only the facts its own measure wrote; the sentence never decides the verdict.
// ════════════════════════════════════════════════════════════════

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const median = (xs) => {
  if (!Array.isArray(xs) || xs.length === 0 || !xs.every((x) => typeof x === 'number' && Number.isFinite(x))) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const all = (xs, fn) => Array.isArray(xs) && xs.length > 0 && xs.every(fn);
const secs = (ms) => (ms / 1000).toFixed(2) + ' s';
const IMAGE = ['png', 'jpeg', 'gif', 'webp'];
/** Fidelity per format: exact fields over all fields, across that format's files (the image types count as one). */
export function byFormat(benign) {
  const out = {};
  for (const r of Array.isArray(benign) ? benign : []) {
    const k = IMAGE.includes(r.type) ? 'image' : r.type;
    const o = out[k] || (out[k] = { fields: 0, exact: 0, files: 0, worst: 1 });
    o.fields += r.fields; o.exact += r.exact; o.files++;
    o.worst = Math.min(o.worst, r.fields ? r.exact / r.fields : 0);
  }
  for (const o of Object.values(out)) o.share = o.fields ? o.exact / o.fields : 0;
  return out;
}
export const STRUCTURED = Object.freeze(['docx', 'xlsx', 'eml', 'ics', 'vcf', 'csv', 'zip', 'image']);
// claim L3's tested readers, by where they run, and the file kind each one opens
export const READERS = Object.freeze({
  ci: { 'LibreOffice (DOCX)': 'docx', 'LibreOffice (XLSX)': 'xlsx', 'LibreOffice (CSV)': 'csv', 'poppler pdftotext': 'pdf', PyMuPDF: 'pdf', pypdf: 'pdf', 'python-docx': 'docx', openpyxl: 'xlsx', 'Python email': 'eml', icalendar: 'ics', 'Python csv': 'csv' },
  local: { PyMuPDF: 'pdf', pypdf: 'pdf', 'Python email': 'eml', 'Python csv': 'csv' },
});
/** Every reader of one place: present, and every file of its kind opened and read back equal. */
export function readersHold(r, where) {
  if (!r || typeof r !== 'object' || !r.readers || !r.files) return false;
  return Object.entries(READERS[where]).every(([name, ext]) => {
    const got = r.readers[name];
    const mine = Object.keys(r.files).filter((f) => f.endsWith('.' + ext));
    return got && !got.missing && mine.length > 0 && mine.every((f) => got[f] && got[f].opened === true && got[f].equal === true);
  });
}
const leaksIn = (r) => (r && r.leaks && typeof r.leaks === 'object' ? Object.values(r.leaks).reduce((n, x) => n + (Array.isArray(x) ? x.length : 1), 0) : NaN);
const pct = (x) => (100 * x).toFixed(1) + '%';

export const RULES = {
  L1a: (f, b) => Array.isArray(f.runs) && f.runs.length === b.runs && f.named >= b.min_blocks &&
    all(f.runs, (r) => r.ok === true && r.signed === true && r.checked === f.files && r.blocks === f.named && r.office === f.digest && r.receipt === true && r.owner === f.owner && r.empty === true) &&
    median(f.runs.map((r) => r.ms)) <= b.median_seconds * 1000 && f.netDenied === true,
  L1b: (f, b) => f.digest === f.l1aDigest && typeof f.digest === 'string' && all(f.blocks, (x) => x.loaded === true && x.exceptions === 0 && x.elements > 0) &&
    f.blocks.length === f.named && f.left === 0 && f.kar === true && f.offline === true && f.ms <= b.seconds * 1000,
  L1c: (f, b) => f.genomeFlips === f.genomeBits && f.genomeRefused === f.genomeFlips && f.genomeFetches === 0 &&
    f.blockCases === f.named * b.flips_per_block && f.blockRefused === f.blockCases && f.composed === 0 &&
    f.mirrorCases === f.files && f.mirrorRefused === f.mirrorCases,
  L1d: (f) => typeof f.lightDigest === 'string' && f.lightDigest === f.fullDigest && f.checked === f.files && f.fetched === f.files,
  L2a: (f, b) => {
    const by = byFormat(f.benign);
    return all(f.benign, (r) => r.verified === true) && STRUCTURED.every((k) => by[k] && by[k].share >= b.structured_min) &&
      Boolean(by.pdf) && by.pdf.share >= b.pdf_overall_min && by.pdf.worst >= b.pdf_each_min;
  },
  L2b: (f) => all(f.hostile, (h) => (h.outcome === 'refused' && typeof h.stage === 'string') || (h.outcome === 'quarantined' && typeof h.why === 'string')) && f.coreParses === 0 && f.parses > 0,
  L2c: (f) => f.tries !== null && typeof f.tries === 'object' && ['network', 'write', 'readOutside', 'childProcess', 'worker'].every((k) => typeof f.tries[k] === 'string' && f.tries[k] !== 'allowed') &&
    f.spinKilled === true && f.hogDied === true && f.kept > 0 && f.readOnly === f.kept,
  L3: (f) => readersHold(f.ci, 'ci') && readersHold(f.local, 'local') && leaksIn(f.ci) === 0 && leaksIn(f.local) === 0,
  L5: (f, b) => {
    const x = f.relay, g = x && x.regrow;
    return Boolean(x && g) && all(x.rounds, (r) => r.equal === true && r.lostA === 0 && r.lostB === 0) &&
      g.restored === true && g.equal === true && g.lostBefore === 0 && g.lostOther === 0 && g.newKey === true && g.aUnsynced > 0 && g.lostWithA === g.aUnsynced &&
      all(x.after, (r) => r.equal === true && r.lostB === 0 && r.lostC === 0) && x.minShare >= b.same_key_share_min &&
      Boolean(f.webrtc) && f.webrtc.equal === true && f.webrtc.dtls === true;
  },
  L6: (f, b) => {
    const a = f.ci, l = f.local, t = f.tab;
    return Boolean(a && l && t) &&
      a.egress === b.egress_undeclared && a.outsideWindows === 0 && a.toSink > 0 && a.sends === b.user_sends && a.sentOk === b.user_sends && a.actions >= b.actions_min && a.receipts === a.actions &&
      l.stopped === 0 && l.allowed === b.user_sends && l.allowedInWindows === l.allowed && l.sends === b.user_sends && l.sentOk === b.user_sends && l.messages === b.user_sends && l.actions >= b.actions_min && l.receipts === l.actions &&
      t.left === 0 && t.actions >= b.actions_min && t.receipts === t.actions;
  },
  L6b: (f, b) => { const a = f.ci; return Boolean(a) && a.egress === b.egress_undeclared && a.outsideWindows === 0 && a.toSink > 0 && a.sends === b.user_sends && a.sentOk === b.user_sends && a.actions >= b.actions_min && a.receipts === a.actions; },
  L4: (f, b) => Array.isArray(f.runs) && f.runs.length === b.runs && all(f.runs, (r) => r.ok === true && r.identical === true && r.owner === true && r.newDevice === true && r.observing === true) &&
    median(f.runs.map((r) => r.ms)) <= b.median_seconds * 1000 && f.wrongRefused === true && f.wrongRestored === false &&
    f.headerFlips === 37 * 8 && f.headerRefused === f.headerFlips && f.bodyFlips === b.body_flips && f.bodyRefused === f.bodyFlips && f.otherState === 0 &&
    f.actions > 0 && f.observed === f.actions && f.enforced === 0,
};

export const SAYS = {
  L1a: (f) => f.runs.filter((r) => r.ok).length + ' of ' + f.runs.length + ' plantings with no network permission grew the office (' + f.named + ' blocks, ' + f.files + ' files, every one checked against its pin); median ' + secs(median(f.runs.map((r) => r.ms))) + ' from process start to Kar\'s first receipt; a connection tried under the same permissions was ' + (f.netDenied ? 'refused' : 'NOT refused') + '.',
  L1b: (f) => 'In Chrome with the network off: ' + f.blocks.filter((x) => x.loaded && x.exceptions === 0 && x.elements > 0).length + ' of ' + f.named + ' blocks started clean in their sandboxes, the office digest ' + (f.digest === f.l1aDigest ? 'equals' : 'differs from') + ' the planted one, ' + f.left + ' requests left the page (' + f.refused + ' the blocks\' own code tried were refused inside the browser), Kar ' + (f.kar ? 'open' : 'not open') + ', ' + secs(f.ms) + ' from choosing the seed.',
  L1c: (f) => f.genomeRefused + ' of ' + f.genomeFlips + ' one-bit changes of the genome refused with ' + f.genomeFetches + ' blocks fetched; ' + f.blockRefused + ' of ' + f.blockCases + ' changed blocks refused, ' + f.composed + ' offices composed; ' + f.mirrorRefused + ' of ' + f.mirrorCases + ' altered mirror files refused.',
  L1d: (f) => 'The light seed fetched ' + f.fetched + ' files from the mirror, checked ' + f.checked + ', and grew an office whose digest ' + (f.lightDigest === f.fullDigest ? 'equals' : 'differs from') + ' the full seed\'s.',
  L2a: (f) => { const by = byFormat(f.benign); return f.benign.filter((r) => r.verified).length + ' of ' + f.benign.length + ' real files passed verify-before-parse; fidelity ' + Object.keys(by).sort().map((k) => k + ' ' + pct(by[k].share)).join(', ') + (by.pdf ? ' (the worst PDF ' + pct(by.pdf.worst) + ')' : '') + '.'; },
  L2b: (f) => { const n = (o) => f.hostile.filter((h) => h.outcome === o).length; return f.hostile.length + ' hostile files: ' + n('refused') + ' refused at verify-before-parse, ' + n('quarantined') + ' quarantined by the sandbox, ' + n('admitted') + ' admitted; the core process loaded ' + f.coreParses + ' reader modules; ' + f.parses + ' parses, every one in a sandbox.'; },
  L2c: (f) => 'In the sandbox: ' + ['network', 'write', 'readOutside', 'childProcess', 'worker'].map((k) => k + ' ' + (f.tries && f.tries[k] !== 'allowed' ? 'refused' : 'ALLOWED')).join(', ') + '; an endless loop ' + (f.spinKilled ? 'was killed' : 'was NOT killed') + ' at the time cap; a memory hog ' + (f.hogDied ? 'died at the ' + f.heapMb + ' MB cap' : 'did NOT die') + '; ' + f.readOnly + ' of ' + f.kept + ' originals kept read-only.',
  L5: (f) => { const x = f.relay, g = x.regrow; return 'Over the relay: ' + x.rounds.filter((r) => r.equal && !r.lostA && !r.lostB).length + ' of ' + x.rounds.length + ' syncs equal with no write lost (' + x.edits + ' edits, every round at least ' + Math.floor(100 * x.minShare) + '% on keys the other device edited too); device A destroyed, C regrown from the vault: ' + (g.equal ? 'equal to B' : 'NOT equal to B') + ', ' + g.lostBefore + ' shared writes lost, ' + g.lostWithA + ' of A\'s ' + g.aUnsynced + ' never-synced writes gone with it; then ' + x.after.filter((r) => r.equal && !r.lostB && !r.lostC).length + ' of ' + x.after.length + ' more syncs equal. Over WebRTC in ' + (f.webrtc && f.webrtc.browser || 'a tab') + ': ' + (f.webrtc && f.webrtc.equal ? 'every round equal, nothing lost' : 'NOT equal (' + (f.webrtc && f.webrtc.error || 'see facts') + ')') + (f.webrtc && f.webrtc.dtls ? ', DTLS connected.' : '.'); },
  L6: (f) => { const a = f.ci || {}, l = f.local || {}, t = f.tab || {}; return "From below, on GitHub's runner: " + (f.ci ? a.egress + ' packets to any undeclared destination, ' + a.toSink + ' to the mail stand-in (' + a.outsideWindows + ' outside the ' + a.sends + ' send windows)' : 'not measured') + '; on this laptop: ' + (f.local ? l.allowed + ' network calls, every one a send the user started, ' + l.stopped + ' stopped' : 'not measured') + '; in a tab: ' + (f.tab ? t.left + ' requests left (' + t.refused + ' refused inside the browser)' : 'not measured') + '; receipts for every action: ' + [a, l, t].map((x) => (x && x.actions ? x.receipts + '/' + x.actions : '-')).join(', ') + '.'; },
  L6b: (f) => { const a = f.ci || {}; return f.ci ? "From below, only what the guest sent, on GitHub's runner: " + a.packets + ' packets, ' + a.egress + ' to any undeclared destination, ' + a.toSink + ' to the mail stand-in (' + a.outsideWindows + ' outside the ' + a.sends + ' send windows, ' + a.sentOk + ' sends accepted); ' + a.actions + ' actions, ' + a.receipts + ' receipts.' : 'Not measured yet.'; },
  L4: (f) => f.runs.filter((r) => r.ok && r.identical).length + ' of ' + f.runs.length + ' regrowths on a wiped folder restored all ' + f.keys + ' entries byte for byte (median ' + secs(median(f.runs.map((r) => r.ms))) + ', each with a new device key, the watch observe-only); the wrong phrase ' + (f.wrongRefused && !f.wrongRestored ? 'restored nothing' : 'was NOT refused cleanly') + '; ' + (f.headerRefused + f.bodyRefused) + ' of ' + (f.headerFlips + f.bodyFlips) + ' one-bit changes refused, ' + f.otherState + ' gave another state; the fresh watch refused ' + f.enforced + ' of ' + f.actions + ' owner actions.',
  L3: (f) => { const n = (r, w) => (r ? Object.keys(READERS[w]).filter((k) => r.readers && r.readers[k] && !r.readers[k].missing).length + ' of ' + Object.keys(READERS[w]).length + ' readers present, ' + (readersHold(r, w) ? 'every file opened and read back equal' : 'NOT every file opened and read back equal') : 'not measured'); return "On GitHub's runner: " + n(f.ci, 'ci') + '; on this laptop: ' + n(f.local, 'local') + '; internal markers found: ' + (leaksIn(f.ci) + leaksIn(f.local)) + '.'; },
};

export function judge(claims, facts) {
  const list = Array.isArray(claims) ? claims : [];
  const fs = facts !== null && typeof facts === 'object' ? facts : {};
  return list.map((c) => {
    const id = c && typeof c.id === 'string' ? c.id : '?';
    if (!own(RULES, id) || !own(fs, id) || fs[id] === null || typeof fs[id] !== 'object') return { id, verdict: 'UNMEASURED', says: 'not measured' };
    let held = false, says = '';
    try { held = RULES[id](fs[id], c.bound || {}) === true; } catch { held = false; }
    try { says = SAYS[id](fs[id]); } catch { says = 'the facts could not be read'; }
    return { id, verdict: held ? 'HELD' : 'FAILED', says };
  });
}
