#!/usr/bin/env node
// measure/l1e.mjs — claim L1e (measure/claims-f.json, seal 1f): after one visit, the office opens again with its
// origin unreachable, at every address a person or an installed app opens it by. Sealed before its fix and before
// this instrument.
//
//   node measure/l1e.mjs            measure once, at HEAD and at 76c2f67 (before the fix), write receipts/l1e.json
//   node measure/l1e.mjs --dry      the same steps, written to .out/l1e/dry.json only (never a receipt)
//
// For each commit: its files exactly as committed (git archive, nothing uncommitted) in a folder of their own; that
// folder served on a fixed loopback port by tools/serve.mjs; Chrome headless with a throwaway profile opens office/
// once and waits until the service worker controls the page and the planting screen shows; the server is stopped and
// Node's own connection to the port must be refused; then office/, the manifest's start_url (resolved against the
// manifest's own address) and office/index.html are opened in turn in the same profile, each given the claim's bound
// to show the office. A real network off, not an emulated one: nothing answers on the port, so the only way an address
// can open is from what the office stored on its first visit.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { platform, release, cpus } from 'node:os';
import { judge } from './judge.mjs';
import { serve } from '../tools/serve.mjs';
import { launch } from '../tools/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const BEFORE = '76c2f67';   // the last commit before the fix, named in the claim
const claim = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims-f.json'), 'utf8')).claims.find((c) => c.id === 'L1e');
const BOUND_MS = claim.bound.seconds * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const OUT = join(ROOT, '.out', 'l1e');

// one commit's files, exactly as committed
function exportCommit(commit, dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const tar = join(dir, 'export.tar');   // unpacked by its bare name inside dir: no drive letter for tar to misread
  const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, commit], { cwd: ROOT });
  if (a.status !== 0) throw new Error('git archive ' + commit + ' failed');
  const x = spawnSync('tar', ['-xf', 'export.tar'], { cwd: dir });
  if (x.status !== 0) throw new Error('tar could not unpack ' + commit + ': ' + String(x.stderr || x.error || ''));
  rmSync(tar, { force: true });
}

const refuses = (port) => new Promise((ok) => {
  const s = connect({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); ok(false); });
  s.once('error', () => ok(true));
});

const LOOK = `(() => ({ title: document.title, plant: (() => { const e = document.getElementById('plant'); return e ? !e.hidden : false; })(),
  controlled: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller), href: location.href }))()`;

async function measure(commit, port) {
  const dir = join(OUT, commit.slice(0, 7));
  exportCommit(commit, dir);
  const profile = join(OUT, 'profile-' + commit.slice(0, 7));
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  const srv = await serve(dir, port);
  const base = 'http://127.0.0.1:' + port + '/office/';
  const c = await launch({ profile });
  const p = await c.page();
  await p.send('Page.enable'); await p.send('Runtime.enable');
  const look = async () => { try { return await p.eval(LOOK); } catch { return { title: '', plant: false, controlled: false, href: '' }; } };
  const opens = (s) => s.title === 'Seed Office' && s.plant === true && s.controlled === true;
  // the first visit, online
  await p.send('Page.navigate', { url: base });
  let first = await look();
  const t0 = Date.now();
  while (!opens(first) && Date.now() - t0 < 60000) { await wait(250); first = await look(); }
  const installed = opens(first);
  const manifest = JSON.parse(readFileSync(join(dir, 'office', 'manifest.webmanifest'), 'utf8'));
  const startUrl = new URL(manifest.start_url, base + 'manifest.webmanifest').href;
  // the origin made unreachable
  await srv.close();
  const refused = await refuses(port);
  const visits = [];
  for (const [as, url] of [['office/', base], ['start_url', startUrl], ['office/index.html', base + 'index.html']]) {
    await p.send('Page.navigate', { url });
    const t1 = Date.now();
    let s = await look();
    while (!opens(s) && Date.now() - t1 < BOUND_MS) { await wait(250); s = await look(); }
    visits.push({ as, url: url.slice(('http://127.0.0.1:' + port).length), opens: opens(s), ms: opens(s) ? Date.now() - t1 : null, title: s.title, plant: s.plant, controlled: s.controlled });
  }
  const chrome = c.version;
  await c.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  return { commit, chrome, installed, refused, startUrl: startUrl.slice(('http://127.0.0.1:' + port).length), visits };
}

mkdirSync(OUT, { recursive: true });
const head = git('rev-parse', 'HEAD'), before = git('rev-parse', BEFORE);
const at = await measure(head, 48741);
const was = await measure(before, 48742);
const facts = { bound: claim.bound, at, before: was };
const verdicts = judge([claim], { L1e: facts });
for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
const receipt = { kind: 'seed-laptop.receipt', v: 1, claims: 'L1e', commit: head, machine: { os: platform() + ' ' + release(), cpu: (cpus()[0] || {}).model, cores: cpus().length, node: process.version }, facts, verdicts };
const file = DRY ? join(OUT, 'dry.json') : join(ROOT, 'receipts', 'l1e.json');
writeFileSync(file, JSON.stringify(receipt, null, 1) + String.fromCharCode(10));
console.log('wrote ' + file.slice(ROOT.length + 1));
