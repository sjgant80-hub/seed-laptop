#!/usr/bin/env node
// measure/l2.mjs — claims L2a, L2b, L2c, measured once (seal 2 fixes this file, the corpus and the hostile rules first).
//
//   node measure/l2.mjs            measure, write receipts/l2.json
//   node measure/l2.mjs --check    measure again; refuse if a verdict or a count differs from the committed receipt
//
// This process IS the office's core for the measurement: it reads each file's bytes, runs verify-before-parse
// (src/edge-in.mjs), and hands what passes to a sandboxed process (tools/sandbox.mjs). A module-loader hook registered
// before anything else counts every module this process loads from src/parse/: that count is "core parses".
// The hostile corpus is made by measure/hostile.mjs in a process of its own, so its zip reading never counts here.
import { registerHooks } from 'node:module';
const loaded = [];
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (/\/src\/parse\//.test(r.url)) loaded.push(r.url); return r; } });

const { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const { spawnSync } = await import('node:child_process');
const { createHash } = await import('node:crypto');
const { platform, release, cpus } = await import('node:os');
const { verify, declaredOf, TYPES } = await import('../src/edge-in.mjs');
const { sandboxParse, sandboxArgs, LIMITS } = await import('../tools/sandbox.mjs');
const { emptyStore, write } = await import('../src/store.mjs');
const { score } = await import('./fidelity.mjs');
const { judge } = await import('./judge.mjs');
const { requirePins } = await import('./pins.mjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = join(ROOT, 'corpus'), OUT = join(ROOT, '.out', 'l2');
requirePins(ROOT);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const DEVICE = 'd'.repeat(64);

async function L2ab() {
  const truth = JSON.parse(readFileSync(join(CORPUS, 'truth.json'), 'utf8'));
  let store = emptyStore();
  const benign = [];
  let parses = 0, readOnly = 0, kept = 0;
  for (const name of Object.keys(truth).sort()) {
    const bytes = new Uint8Array(readFileSync(join(CORPUS, name)));
    const type = declaredOf(name);
    const v = verify(bytes, type);
    const row = { name, type, verified: v.ok, stage: v.ok ? null : v.stage };
    if (v.ok) {
      const r = await sandboxParse(type, bytes);
      parses++;
      row.parsed = r.ok; row.why = r.ok ? null : r.why;
      const s = r.ok ? score(truth[name], r.result) : { fields: score(truth[name], {}).fields, exact: 0 };
      row.fields = s.fields; row.exact = s.exact;
      const key = 'file/' + sha(bytes);
      const w = write(store, DEVICE, key, ['ab', Buffer.from(bytes).toString('base64')]);
      if (w.ok) { store = w.store; kept++; }
      if (!write(store, DEVICE, key, ['ab', Buffer.from(bytes).toString('base64')]).ok && !write(store, DEVICE, key, null).ok) readOnly++;
    } else { row.fields = score(truth[name], {}).fields; row.exact = 0; }
    benign.push(row);
  }
  rmSync(join(OUT, 'hostile'), { recursive: true, force: true });
  const gen = spawnSync(process.execPath, [join(ROOT, 'measure', 'hostile.mjs'), CORPUS, join(OUT, 'hostile')], { encoding: 'utf8' });
  if (gen.status !== 0) throw new Error('the hostile corpus was not made: ' + gen.stderr);
  const list = JSON.parse(readFileSync(join(OUT, 'hostile', 'hostile.json'), 'utf8'));
  const hostile = [];
  for (const h of list) {
    let bytes;
    if (h.recipe) { const base = readFileSync(join(CORPUS, h.base)); bytes = new Uint8Array(h.recipe.padTo); bytes.fill(0x20); bytes.set(base); }
    else bytes = new Uint8Array(readFileSync(join(OUT, 'hostile', h.name)));
    const v = verify(bytes, h.declared);
    const row = { name: h.name, kind: h.kind, declared: h.declared };
    if (!v.ok) { row.outcome = 'refused'; row.stage = v.stage; row.why = v.why; }
    else {
      const r = await sandboxParse(h.declared, bytes);
      parses++;
      if (r.ok) { row.outcome = 'admitted'; } else { row.outcome = 'quarantined'; row.why = r.why; row.killed = Boolean(r.killed); }
    }
    hostile.push(row);
  }
  return { benign, hostile, parses, kept, readOnly, coreParses: loaded.length, coreParsers: [...new Set(loaded)] };
}

const PROBE = `
const r = {};
const t = async (k, f) => { try { await f(); r[k] = 'allowed'; } catch (e) { r[k] = e.code || e.name || 'refused'; } };
await t('network', () => new Promise((ok, bad) => { const s = require('node:net').connect(80, '127.0.0.1'); s.on('connect', ok); s.on('error', bad); }));
await t('write', () => require('node:fs').writeFileSync(require('node:os').tmpdir() + '/sandbox-probe', 'x'));
await t('readOutside', () => require('node:fs').readFileSync(${JSON.stringify(join(ROOT, 'package.json'))}));
await t('childProcess', () => require('node:child_process').execFileSync(process.execPath, ['-e', '1']));
await t('worker', () => new (require('node:worker_threads').Worker)('1', { eval: true }));
console.log(JSON.stringify(r));`;

function L2c() {
  const base = sandboxArgs('pdf').filter((a) => !a.endsWith('run.mjs') && a !== 'pdf');
  const probe = spawnSync(process.execPath, [...base, '--input-type=commonjs', '-e', '(async () => {' + PROBE.replace(/await t/g, 'await t') + '})()'], { encoding: 'utf8', timeout: 20000 });
  let tries = {};
  try { tries = JSON.parse(probe.stdout.trim().split('\n').pop()); } catch { tries = { error: (probe.stderr || '').slice(0, 200) }; }
  const spin = spawnSync(process.execPath, [...base, '-e', 'for(;;){}'], { timeout: LIMITS.ms + 1000 });
  const hog = spawnSync(process.execPath, [...base, '-e', 'const a=[];for(;;)a.push(new Array(1e6).fill(1))'], { encoding: 'utf8', timeout: 30000 });
  return { flags: base.join(' '), tries, spinKilled: spin.signal !== null || spin.error !== undefined, hogDied: hog.status !== 0 && /heap|memory/i.test(hog.stderr || ''), heapMb: LIMITS.heapMb, ms: LIMITS.ms };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(OUT, { recursive: true });
  const ab = await L2ab();
  const c = L2c();
  const facts = { L2a: { benign: ab.benign }, L2b: { hostile: ab.hostile, parses: ab.parses, coreParses: ab.coreParses, coreParsers: ab.coreParsers }, L2c: { ...c, kept: ab.kept, readOnly: ab.readOnly } };
  const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((x) => ['L2a', 'L2b', 'L2c'].includes(x.id));
  const verdicts = judge(claims, facts);
  for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
  const receipt = { kind: 'seed-laptop.receipt', v: 1, claims: 'L2', commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), cpu: (cpus()[0] || {}).model, node: process.version }, facts, verdicts };
  const path = join(ROOT, 'receipts', 'l2.json');
  if (process.argv.includes('--check')) {
    const was = JSON.parse(readFileSync(path, 'utf8'));
    const strip = (f) => JSON.stringify(f, (k, v) => (k === 'ms' ? undefined : v));
    const same = JSON.stringify(was.verdicts) === JSON.stringify(verdicts) && strip(was.facts.L2a) === strip(facts.L2a) && strip(was.facts.L2b) === strip(facts.L2b);
    console.log(same ? 'L2 CHECK CLEAN — every verdict and every file\'s outcome reproduces the committed receipt' : 'L2 CHECK FAILED');
    process.exit(same ? 0 : 1);
  }
  mkdirSync(join(ROOT, 'receipts'), { recursive: true });
  writeFileSync(path, JSON.stringify(receipt, null, 1) + '\n');
  console.log('wrote receipts/l2.json');
}
