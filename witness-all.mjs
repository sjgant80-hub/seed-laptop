#!/usr/bin/env node
// witness-all.mjs — claim G1's mutation gate over the seed laptop's pure kernels. Local and CI run the same thing.
// Exit 0 only if every gated kernel is clean (no unreviewed survivor), none was capped, and each had mutants.
// The fuzz half of G1 (2,000 hostile inputs per exported function) is test/fuzz.test.mjs, in every pair below.
//
// Gated here, one row per kernel (added as each organ lands):
//   runtime   — what this runtime can do, and whether the office can grow on it (layer 2)
//   genome    — the signed genome: canonical, every field checked, refused if one bit changed (organ 2)
//   bundle    — the full seed: the genome and every block in one LIGHT vault (organ 2)
//   receipt   — every action leaves a sentence a person can read (the legibility rule)
//   germinate — the seed grows the office: verify, check every pin, compose, first run (organ 2)
//   prologue  — the bridge each block runs first: its storage, in memory, every change to the office (organ 3)
//   value     — what a block stores, as one-spelling JSON the office can keep, back up and sync (organ 3)
//   compose   — the frame policy, the bridge inlined first, a block's own modules as data: URLs (organ 3)
//   store     — the one store: a multi-value CRDT, nothing silently lost, originals read-only (organ 3)
//   office    — where each block's data lives in the store, and how a block starts from it (organ 3)
//   kar       — the conductor: a closed list of doings, a floor with no model, a model may only pick (organ 3)
//   edge-in   — verify-before-parse on raw bytes: type, size, magic, shape (organ 4)
//   edge-out  — the writers: PDF, DOCX, XLSX, EML, ICS, CSV, with no metadata (organ 4)
//   leak      — does a file leaving carry anything of the office's internals (organ 4)
//   immune    — the inbound edge's memory: a file kept out once is refused on sight, never a false immunity (organ 4)
//   imap      — mail in from the owner's own account: the IMAP words, read-only by construction (organ 4)
//   zip … read — the readers, run only in the sandbox: zip, xml, office (DOCX/XLSX), pdf, mail, text (CSV/ICS/VCF),
//               image, and the door they share with its integrity walks (organ 4)
//   vault     — the owner's encrypted vault: LIGHT inside AES-256-GCM, the key from the phrase (organ 5). Its mutants are
//               judged by its own tests only: the 2,000-input fuzz (a 600,000-round key for each long phrase) takes
//               ~90 s, so it runs once per test pass (test/fuzz.test.mjs), not once per mutant
//   regrow    — what the vault keeps, whether a vault may be restored, the regrown device's fresh watch (organ 5)
//   sync      — the owner's devices: the founder-signed roster, LIGHT packets through the door (organ 6)
//   cost      — the cost case from the owner's own list, item by item, in whole pence (organ 7)
// NOT gated, each with its reason: tools/** (local I/O and orchestration, re-derived by each measure's --check);
// office/** glue (browser I/O; its decisions live in the kernels above); vendor/** and blocks/** (gated in their own
// repos, pinned byte-identical by their --check tools); .witness/** (the gate itself, pinned to witness v0.6).
//
//   node witness-all.mjs [kernel …] [--receipt]
import { runMutations } from './.witness/witness.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FUZZ = 'test/fuzz.test.mjs';
export const PAIRS = [
  ['runtime', 'src/runtime.mjs', ['test/runtime.test.mjs', FUZZ]],
  ['genome', 'src/genome.mjs', ['test/genome.test.mjs', FUZZ]],
  ['bundle', 'src/bundle.mjs', ['test/bundle.test.mjs', FUZZ]],
  ['receipt', 'src/receipt.mjs', ['test/receipt.test.mjs', FUZZ]],
  ['germinate', 'src/germinate.mjs', ['test/germinate.test.mjs', FUZZ]],
  ['prologue', 'src/prologue.mjs', ['test/prologue.test.mjs', 'test/compose.test.mjs', 'test/office.test.mjs', FUZZ]],
  ['value', 'src/value.mjs', ['test/value.test.mjs', 'test/office.test.mjs', FUZZ]],
  ['compose', 'src/compose.mjs', ['test/compose.test.mjs', FUZZ]],
  ['store', 'src/store.mjs', ['test/store.test.mjs', 'test/office.test.mjs', FUZZ]],
  ['office', 'src/office.mjs', ['test/office.test.mjs', FUZZ]],
  ['kar', 'src/kar.mjs', ['test/kar.test.mjs', FUZZ]],
  ['edge-in', 'src/edge-in.mjs', ['test/edges.test.mjs', FUZZ]],
  ['edge-out', 'src/edge-out.mjs', ['test/edges.test.mjs', 'test/parse.test.mjs', FUZZ]],
  ['leak', 'src/leak.mjs', ['test/edges.test.mjs', FUZZ]],
  ['immune', 'src/immune.mjs', ['test/immune.test.mjs', FUZZ]],
  ['imap', 'src/imap.mjs', ['test/imap.test.mjs', FUZZ]],
  ['zip', 'src/parse/zip.mjs', ['test/parse.test.mjs', FUZZ]],
  ['xml', 'src/parse/xml.mjs', ['test/parse.test.mjs', FUZZ]],
  ['office-read', 'src/parse/office.mjs', ['test/parse.test.mjs', FUZZ]],
  ['pdf', 'src/parse/pdf.mjs', ['test/parse.test.mjs', FUZZ]],
  ['mail', 'src/parse/mail.mjs', ['test/parse.test.mjs', FUZZ]],
  ['text', 'src/parse/text.mjs', ['test/parse.test.mjs', FUZZ]],
  ['image', 'src/parse/image.mjs', ['test/parse.test.mjs', FUZZ]],
  ['read', 'src/parse/index.mjs', ['test/parse.test.mjs', FUZZ]],
  ['vault', 'src/vault.mjs', ['test/vault.test.mjs']],
  ['regrow', 'src/regrow.mjs', ['test/regrow.test.mjs', FUZZ]],
  ['sync', 'src/sync.mjs', ['test/sync.test.mjs', FUZZ]],
  ['cost', 'src/cost.mjs', ['test/cost.test.mjs', FUZZ]],
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const RECEIPT = args.includes('--receipt');
  const only = args.filter((a) => !a.startsWith('--'));
  const unknown = only.filter((n) => !PAIRS.some(([k]) => k === n));
  if (unknown.length) { console.log('WITNESS NOT RUN — no kernel named ' + unknown.join(', ') + ' (known: ' + PAIRS.map(([k]) => k).join(', ') + ')'); process.exit(1); }
  let allClean = true;
  const rows = [];
  for (const [name, src, tests] of PAIRS) {
    if (only.length && !only.includes(name)) continue;
    process.env.SEED_FUZZ_ONLY = src;   // the fuzz in each pair runs on this kernel only (test/fuzz.test.mjs)
    const base = spawnSync('node', ['--test', ...tests], { cwd: HERE, encoding: 'utf8', timeout: 300000 });
    if (base.status !== 0) { console.log('✗ ' + name.padEnd(10) + ' RED BASELINE — its own tests fail on the unmutated code; the gate refuses to judge'); allClean = false; rows.push({ name, src, killed: 0, total: 0, ignored: 0, survived: 0, capped: false, clean: false, red: true }); continue; }
    const t0 = Date.now();
    const r = runMutations(join(HERE, src), { cwd: HERE, cap: 5000, timeout: 120000, testCmd: ['node', '--test', ...tests] });
    const secs = Math.round((Date.now() - t0) / 1000);
    const clean = r.clean && !r.capped && r.total > 0;
    rows.push({ name, src, killed: r.killed, total: r.total, ignored: r.ignored.length, survived: r.survived.length, capped: Boolean(r.capped), clean });
    console.log(`${clean ? '✓' : '✗'} ${name.padEnd(10)} ${String(r.killed).padStart(4)}/${String(r.total).padEnd(4)} killed${r.ignored.length ? ` · ${r.ignored.length} reviewed-equivalent` : ''}${r.capped ? ` · CAPPED at ${r.capped}` : ''} · ${secs}s`);
    for (const s of r.survived) console.log(`    SURVIVED line ${s.line}: ${s.mutation} :: ${s.snippet}`);
    if (!clean) allClean = false;
  }
  const k = rows.reduce((a, r) => a + r.killed, 0), n = rows.reduce((a, r) => a + r.total, 0);
  console.log(`\n${allClean ? 'WITNESS CLEAN' : 'WITNESS NOT CLEAN'} — ${k}/${n} mutants killed across ${rows.length} kernel(s)`);
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).stdout.trim() || null;   // the code these mutants were made from
  if (RECEIPT && !only.length) writeFileSync(join(HERE, 'receipts/witness.json'), JSON.stringify({ kind: 'seed-laptop.witness', v: 1, commit, node: process.version, clean: allClean, killed: k, total: n, kernels: rows }, null, 1) + '\n');
  process.exit(allClean ? 0 : 1);
}
