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
  if (RECEIPT && !only.length) writeFileSync(join(HERE, 'receipts/witness.json'), JSON.stringify({ kind: 'seed-laptop.witness', v: 1, clean: allClean, killed: k, total: n, kernels: rows }, null, 1) + '\n');
  process.exit(allClean ? 0 : 1);
}
