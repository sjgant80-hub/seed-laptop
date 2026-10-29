#!/usr/bin/env node
// measure/l4.mjs — claim L4, measured once: wipe, reinstall, seed, vault → the state back, byte for byte.
//
//   node measure/l4.mjs [--check]
//
// The session: the stock office planted with a public test phrase, then a sealed scripted session (planSession: 300
// writes across every block, two originals from the corpus, a receipt for each) — the owner's actions, in order.
// Backed up to the vault (src/vault.mjs, PBKDF2-SHA256 600,000 rounds), the home folder deleted, and 5 times: a fresh
// empty folder and a fresh process run tools/regrow.mjs under Node's permission model with no network permission.
// Then: the wrong phrase; every bit of the vault's header and 4,096 bits spread over its body, each flipped alone;
// and the regrown watch fed the session's owner actions in order.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { platform, release, cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { germinate } from '../src/germinate.mjs';
import { emptyStore, write, canon } from '../src/store.mjs';
import { writesFor } from '../src/office.mjs';
import { tag } from '../src/value.mjs';
import { seal, open, HEADER } from '../src/vault.mjs';
import { entriesOf, watchOf, eventOf } from '../src/regrow.mjs';
import { receipt } from '../src/receipt.mjs';
import { step } from '../vendor/bes-inward/watch.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const OUT = join(ROOT, '.out', 'l4');
const PHRASE = 'the measured owner of the stock office, a public test phrase';
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);

/** The sealed session: the same actions every run. */
export function planSession(blocks) {
  const plan = [];
  for (let i = 0; i < 300; i++) plan.push({ do: i % 10 === 0 ? 'open' : 'edit', block: blocks[(i * 7) % blocks.length], n: i });
  plan.push({ do: 'import', file: 'letter-pythondocx.docx' }, { do: 'import', file: 'notes-chrome.pdf' });
  return plan;
}

async function session() {
  const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  const g = await germinate({ full: new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full'))) }, { pinned, phrase: PHRASE, at: '2026-11-02T09:00:00Z' });
  const blocks = g.office.blocks.map((b) => b.id);
  const me = 'a1'.repeat(16);
  let store = emptyStore(), n = 0;
  const put = (k, v) => { const w = write(store, me, k, v); if (!w.ok) throw new Error(w.why); store = w.store; };
  const plan = planSession(blocks);
  for (const a of plan) {
    if (a.do === 'edit') {
      const m = a.n % 2 ? { t: 'ls', op: 'set', k: 'k' + (a.n % 13), v: 'value ' + a.n } : { t: 'idb', op: 'put', db: 'db', store: 'rows', key: a.n % 31, value: { id: a.n % 31, text: 'row ' + a.n, when: new Date(T0 + a.n * 60000), amount: a.n / 4 } };
      const t = m.t === 'idb' ? (await tag([m.key, m.value])).t[1] : null;
      for (const x of writesFor(store, a.block, m, t)) put(x.key, x.value);
    }
    if (a.do === 'import') {
      const bytes = readFileSync(join(ROOT, 'corpus', a.file));
      put('file/' + createHash('sha256').update(bytes).digest('hex'), ['ab', bytes.toString('base64')]);
    }
    const r = receipt(a.do === 'open' ? 'opened' : a.do === 'import' ? 'imported' : 'saved', a.do === 'open' ? { block: a.block } : a.do === 'import' ? { file: a.file, type: a.file.split('.').pop(), sha: createHash('sha256').update(readFileSync(join(ROOT, 'corpus', a.file))).digest('hex') } : { block: a.block, changes: 1 }, '2026-11-02T09:00:00Z');
    put('kar/receipts/' + String(++n).padStart(6, '0'), ['s', JSON.stringify(r)]);
  }
  return { g, store, plan };
}

function regrowOnce(home, vault, phrase) {
  return new Promise((resolve) => {
    const args = ['--permission', '--allow-fs-read=' + ROOT, '--allow-fs-read=' + join(ROOT, '*'), '--allow-fs-read=' + vault, '--allow-fs-write=' + join(home, '*'), join(ROOT, 'tools', 'regrow.mjs'), '--seed', join(ROOT, 'seeds', 'stock.full'), '--vault', vault, '--home', home];
    const t0 = performance.now();
    const p = spawn(process.execPath, args, { env: { ...process.env, SEED_PHRASE: phrase }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => { let line = {}; try { line = JSON.parse(out.trim().split('\n').pop()); } catch { line = {}; } resolve({ code, ms: Math.round(performance.now() - t0), line }); });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { g, store, plan } = await session();
  const before = entriesOf(store, { digest: g.digest, founder: g.owner.id });
  const s = await seal(before, PHRASE);
  const vault = join(OUT, 'vault.slv');
  writeFileSync(vault, s.bytes);
  const runs = [];
  for (let k = 0; k < 5; k++) {
    const home = join(OUT, 'home-' + k);   // the wiped machine: nothing of the session is in it
    const r = await regrowOnce(home, vault, PHRASE);
    const got = existsSync(join(home, 'store.json')) ? readFileSync(join(home, 'store.json')) : Buffer.alloc(0);
    runs.push({ ok: r.code === 0 && r.line.ok === true, ms: r.ms, identical: Buffer.compare(got, Buffer.from(before[0].bytes)) === 0, owner: r.line.owner === g.owner.id, newDevice: typeof r.line.device === 'string' && r.line.device !== 'a1'.repeat(16), observing: r.line.observing === true });
  }
  const wrongHome = join(OUT, 'home-wrong');
  const wrong = await regrowOnce(wrongHome, vault, PHRASE.replace('public', 'private'));
  const wrongRestored = existsSync(wrongHome) && readdirSync(wrongHome).length > 0;
  // every header bit, and 4,096 body bits, each flipped alone
  let headerFlips = 0, headerRefused = 0, bodyFlips = 0, bodyRefused = 0, otherState = 0;
  for (let bit = 0; bit < HEADER * 8; bit++) {
    const x = s.bytes.slice(); x[bit >> 3] ^= 1 << (bit & 7);
    const o = await open(x, PHRASE); headerFlips++;
    if (!o.ok) headerRefused++; else if (canon(JSON.parse(new TextDecoder().decode(o.entries[0].bytes))) !== new TextDecoder().decode(before[0].bytes)) otherState++;
  }
  const body = (s.bytes.length - HEADER) * 8;
  for (let k = 0; k < 4096; k++) {
    const bit = HEADER * 8 + Math.floor((k * body) / 4096);
    const x = s.bytes.slice(); x[bit >> 3] ^= 1 << (bit & 7);
    const o = await open(x, PHRASE); bodyFlips++;
    if (!o.ok) bodyRefused++; else otherState++;
  }
  // the regrown watch, fed the session's owner actions in order
  let w = watchOf(g.owner.id), enforced = 0, observed = 0;
  plan.forEach((a, i) => { const r = step(w, eventOf(a, T0 + i * 45000), {}); w = r.w; if (r.out.observing) observed++; else enforced++; });
  const facts = {
    L4: {
      runs, keys: Object.keys(store.keys).length, vaultBytes: s.bytes.length, wrongRefused: wrong.line.ok === false && wrong.line.stage === 'vault', wrongRestored,
      headerFlips, headerRefused, bodyFlips, bodyRefused, otherState, actions: plan.length, observed, enforced,
      flags: '--permission (no --allow-net); reads: the repo, the vault; writes: the new home only',
    },
  };
  const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((c) => c.id === 'L4');
  const verdicts = judge(claims, facts);
  for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
  const path = join(ROOT, 'receipts', 'l4.json');
  if (process.argv.includes('--check')) {
    const was = JSON.parse(readFileSync(path, 'utf8'));
    const strip = (f) => JSON.stringify({ ...f, runs: f.runs.map((r) => ({ ...r, ms: undefined })), vaultBytes: undefined });
    const same = JSON.stringify(was.verdicts.map((v) => v.verdict)) === JSON.stringify(verdicts.map((v) => v.verdict)) && strip(was.facts.L4) === strip(facts.L4);
    console.log(same ? 'L4 CHECK CLEAN' : 'L4 CHECK FAILED'); process.exit(same ? 0 : 1);
  }
  mkdirSync(join(ROOT, 'receipts'), { recursive: true });
  writeFileSync(path, JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L4', commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), cpu: (cpus()[0] || {}).model, node: process.version }, facts, verdicts }, null, 1) + '\n');
  console.log('wrote receipts/l4.json');
}
