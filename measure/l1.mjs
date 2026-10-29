#!/usr/bin/env node
// measure/l1.mjs — claims L1a–L1d, measured once (seal 2 fixes this file before its first run).
//
//   node measure/l1.mjs            measure, write receipts/l1.json (facts + verdicts + the machine and commit)
//   node measure/l1.mjs --check    measure again and refuse if any verdict, or any fact that is not a timing, differs
//                                  from the committed receipt (CI runs this)
//   node measure/l1.mjs --only L1a,L1c   a dry run of some claims, written nowhere
//
// L1a  tools/plant.mjs under Node's permission model with no network permission, 5 times, each into a new empty
//      folder; the wall clock from spawning the process to its exit (it exits once Kar's first receipt is written)
// L1b  the office page in headless Chrome (its own throwaway profile), from the repo served on loopback; the network
//      emulated offline before the seed file is chosen; every block opened from the rail as soon as the one before
//      reported loaded; every frame watched over the DevTools protocol (exceptions, requests, its rendered elements)
// L1c  every bit of the genome flipped in turn and planted as a light seed (blocks fetched only if the genome
//      passes: a fetch counter); for every block, 64 bit positions spread evenly over its files (in order, as one
//      byte sequence) flipped in turn and planted as a FULL seed rebuilt around the changed bytes (as anyone could
//      build one); for every block file, a light seed whose mirror serves that file with one byte changed
// L1d  the genome alone, its blocks fetched over HTTP from the mirror folder served on loopback
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { platform, release, cpus } from 'node:os';
import { open, canonical } from '../src/genome.mjs';
import { germinate, filesOf, POLICY } from '../src/germinate.mjs';
import { makeBundle } from '../src/bundle.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';
import { serve } from '../tools/serve.mjs';
import { launch, CHROME } from '../tools/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const OUT = join(ROOT, '.out', 'l1');
const PHRASE = 'the measured owner of the stock office, a public test phrase';
const AT = '2026-10-29T12:00:00Z';
const enc = new TextEncoder(), dec = new TextDecoder();
const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
const genomeText = readFileSync(join(ROOT, 'seeds', 'stock.genome.json'), 'utf8');
const fullSeed = new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full')));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

async function base() {
  const g = await open(genomeText, pinned);
  const files = filesOf(g.body);
  const full = await germinate({ full: fullSeed }, { pinned, phrase: PHRASE, at: AT });
  const owner = (await plant(PHRASE, ['device'], { policy: { ...POLICY } })).ids.founder.id;
  return { g, files, digest: full.digest, owner, named: g.body.blocks.length };
}

function runPlant(home) {
  return new Promise((resolve) => {
    const args = ['--permission', '--allow-fs-read=' + ROOT, '--allow-fs-read=' + join(ROOT, '*'), '--allow-fs-write=' + join(home, '*'), join(ROOT, 'tools', 'plant.mjs'), '--seed', join(ROOT, 'seeds', 'stock.full'), '--home', home];
    const t0 = performance.now();
    const p = spawn(process.execPath, args, { env: { ...process.env, SEED_PHRASE: PHRASE }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, ms: performance.now() - t0, out }));
  });
}

async function L1a(b) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const home = join(OUT, 'a' + i);
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    const empty = readdirSync(home).length === 0;
    const r = await runPlant(home);
    let line = {};
    try { line = JSON.parse(r.out.trim().split('\n').pop()); } catch { line = {}; }
    const office = existsSync(join(home, 'office.json')) ? JSON.parse(readFileSync(join(home, 'office.json'), 'utf8')) : {};
    const rec = existsSync(join(home, 'receipts.jsonl')) ? readFileSync(join(home, 'receipts.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x)) : [];
    const owner = existsSync(join(home, 'owner.json')) ? JSON.parse(readFileSync(join(home, 'owner.json'), 'utf8')).founder : null;
    const onDisk = b.files.every((f) => existsSync(join(home, f.key)) && hex(sha256(new Uint8Array(readFileSync(join(home, f.key))))) === f.sha256);
    runs.push({
      ok: r.code === 0 && line.ok === true && onDisk, signed: line.genome === b.g.id, checked: line.checked, blocks: line.blocks,
      office: office.digest, receipt: rec.length === 1 && rec[0].kind === 'grew', owner, empty, ms: Math.round(r.ms),
    });
  }
  // the negative control: under the same permissions, a connection is refused by Node itself
  const probe = spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + ROOT, '--allow-fs-read=' + join(ROOT, '*'), '-e', 'require("node:net").connect(80,"127.0.0.1").on("error",(e)=>{console.log(e.code)})'], { encoding: 'utf8' });
  const netDenied = /ERR_ACCESS_DENIED/.test(probe.stdout + probe.stderr);
  return { runs, named: b.named, files: b.files.length, digest: b.digest, owner: b.owner, netDenied, flags: '--permission --allow-fs-read=<repo> --allow-fs-read=<repo>/* --allow-fs-write=<home>/* (no --allow-net, --allow-child-process, --allow-worker)' };
}

async function L1b(b) {
  if (!CHROME) return null;
  const srv = await serve(ROOT);
  const profile = join(ROOT, '.out', 'cb' + (Date.now() % 100000));
  const c = await launch({ profile });
  const p = await c.page();
  const urls = new Map(), failed = new Map(), exc = [], frames = new Map();
  const watch = (sid, frameOf) => {
    c.browser.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url), sid);
    c.browser.on('Network.loadingFailed', (e) => failed.set(e.requestId, e.blockedReason || ''), sid);
    c.browser.on('Runtime.exceptionThrown', (e) => exc.push({ frame: frameOf(), text: String(e.exceptionDetails.exception?.description || e.exceptionDetails.text).split('\n')[0] }), sid);
  };
  c.browser.on('Target.attachedToTarget', async (e) => {
    const sid = e.sessionId, url = e.targetInfo.url;
    const m = /frame\.html\?b=([a-z0-9-]+)/.exec(url);
    if (m) frames.set(m[1], sid);
    watch(sid, () => (m ? m[1] : url));
    try { await c.browser.send('Runtime.enable', {}, sid); await c.browser.send('Network.enable', {}, sid); await c.browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid); } catch { /* gone */ }
  }, p.sessionId);
  watch(p.sessionId, () => 'page');
  await p.send('Runtime.enable'); await p.send('Network.enable'); await p.send('DOM.enable');
  await p.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await p.send('Page.navigate', { url: srv.url + 'office/' });
  for (let i = 0; i < 120 && !(await p.eval('!!(window.__office && window.__office.ready)')); i++) await wait(100);
  await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const offline = !(await p.eval('fetch("../seeds/publisher.json?probe", { cache: "no-store" }).then(() => false, () => false)')) && (await p.eval('navigator.onLine === false'));
  await p.eval(`document.getElementById('phrase').value = ${JSON.stringify(PHRASE)}; document.getElementById('phrase2').value = ${JSON.stringify(PHRASE)}; true`);
  const { root } = await p.send('DOM.getDocument', {});
  const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#seed-file' });
  const t0 = performance.now();
  await p.send('DOM.setFileInputFiles', { nodeId, files: [join(ROOT, 'seeds', 'stock.full')] });
  for (let i = 0; i < 600 && !(await p.eval('!!window.__office.planted')); i++) await wait(50);
  const planted = await p.eval('window.__office.planted');
  const blocks = [];
  for (const id of planted ? planted.blocks : []) {
    await p.eval(`document.querySelector('#rail button[data-id="${id}"]').click(); true`);
    for (let i = 0; i < 400 && !(await p.eval(`!!window.__office.loaded[${JSON.stringify(id)}]`)); i++) await wait(25);
    blocks.push({ id, loaded: await p.eval(`!!window.__office.loaded[${JSON.stringify(id)}]`) });
  }
  const ms = performance.now() - t0;
  await wait(1500);   // late startup errors still count
  const trace = await p.eval('JSON.parse(JSON.stringify(window.__office))');
  for (const x of blocks) {
    const sid = frames.get(x.id);
    let elements = 0;
    try { elements = (await c.browser.send('Runtime.evaluate', { expression: 'document.body ? document.body.querySelectorAll("*").length : 0', returnByValue: true }, sid)).result.value; } catch { elements = 0; }
    x.elements = elements;
    x.exceptions = exc.filter((e) => e.frame === x.id).length + (trace.exceptions[x.id] || []).length;
    x.bridged = trace.bridged[x.id] || 0;
  }
  const other = [...urls].filter(([, u]) => !u.startsWith(srv.url) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:'));
  const refused = other.filter(([id]) => failed.get(id)).length;
  const kar = trace.events.some((e) => e.t === 'kar-open');
  const facts = { chrome: c.version, offline, digest: planted && planted.digest, l1aDigest: b.digest, named: b.named, blocks, left: other.length - refused, refused, refusedHosts: [...new Set(other.map(([, u]) => new URL(u).host))].sort(), kar, ms: Math.round(ms), pageExceptions: exc.filter((e) => e.frame === 'page').length };
  await c.close(); await srv.close();
  rmSync(profile, { recursive: true, force: true });
  return facts;
}

async function L1c(b) {
  const bytes = enc.encode(genomeText);
  const mirror = new Map(b.files.map((f) => [f.sha256, new Uint8Array(readFileSync(join(ROOT, 'mirror', f.sha256)))]));
  let genomeRefused = 0, genomeFetches = 0, composed = 0;
  const genomeBits = bytes.length * 8;
  for (let i = 0; i < genomeBits; i++) {
    const x = bytes.slice(); x[i >> 3] ^= 1 << (i & 7);
    const text = dec.decode(x);   // as a tool reads a file as text: an invalid byte becomes U+FFFD, never an error
    const r = await germinate({ genome: text, fetch: async (s) => { genomeFetches++; return mirror.get(s) || null; } }, { pinned, phrase: PHRASE, at: AT });
    if (r.ok) composed++; else genomeRefused++;
  }
  let blockCases = 0, blockRefused = 0;
  const original = b.files.map((f) => ({ path: f.key, bytes: mirror.get(f.sha256) }));
  for (const blk of b.g.body.blocks) {
    const mine = original.filter((f) => f.path.startsWith('blocks/' + blk.id + '/'));
    const total = mine.reduce((n, f) => n + f.bytes.length, 0) * 8;
    for (let k = 0; k < 64; k++) {
      let bit = Math.floor((k * total) / 64), at = 0;
      while (bit >= mine[at].bytes.length * 8) { bit -= mine[at].bytes.length * 8; at++; }
      const files = original.map((f) => (f.path === mine[at].path ? { path: f.path, bytes: (() => { const y = f.bytes.slice(); y[bit >> 3] ^= 1 << (bit & 7); return y; })() } : f));
      const r = await germinate({ full: makeBundle(genomeText, files).bytes }, { pinned, phrase: PHRASE, at: AT });
      blockCases++;
      if (r.ok) composed++; else if (r.stage === 'block' && !('office' in r)) blockRefused++;
    }
  }
  let mirrorCases = 0, mirrorRefused = 0;
  for (const f of b.files) {
    const r = await germinate({ genome: genomeText, fetch: async (s) => { const y = mirror.get(s).slice(); if (s === f.sha256) y[y.length >> 1] ^= 0x20; return y; } }, { pinned, phrase: PHRASE, at: AT });
    mirrorCases++;
    if (r.ok) composed++; else if (r.stage === 'block') mirrorRefused++;
  }
  return { genomeBits, genomeFlips: genomeBits, genomeRefused, genomeFetches, named: b.named, files: b.files.length, blockCases, blockRefused, mirrorCases, mirrorRefused, composed };
}

async function L1d(b) {
  const srv = await serve(join(ROOT, 'mirror'));
  let fetched = 0;
  const r = await germinate({ genome: genomeText, fetch: async (s) => { const res = await fetch(srv.url + s); fetched += res.ok ? 1 : 0; return res.ok ? new Uint8Array(await res.arrayBuffer()) : null; } }, { pinned, phrase: PHRASE, at: AT });
  await srv.close();
  return { lightDigest: r.ok ? r.digest : null, fullDigest: b.digest, checked: r.checked, fetched, files: b.files.length };
}

const TIMING = new Set(['ms', 'chrome']);
const steady = (x) => JSON.parse(JSON.stringify(x, (k, v) => (TIMING.has(k) ? undefined : v)));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--only');
  const only = oi === -1 ? ['L1a', 'L1b', 'L1c', 'L1d'] : args[oi + 1].split(',');
  mkdirSync(OUT, { recursive: true });
  const b = await base();
  const facts = {};
  for (const [id, fn] of [['L1a', L1a], ['L1b', L1b], ['L1c', L1c], ['L1d', L1d]]) {
    if (!only.includes(id)) continue;
    const t = performance.now();
    facts[id] = await fn(b);
    console.log(id + ' measured in ' + Math.round((performance.now() - t) / 1000) + ' s');
  }
  const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((c) => only.includes(c.id));
  const verdicts = judge(claims, facts);
  for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
  const receipt = {
    kind: 'seed-laptop.receipt', v: 1, claims: 'L1', commit: git('rev-parse', 'HEAD'),
    machine: { os: platform() + ' ' + release(), cpu: (cpus()[0] || {}).model, cores: cpus().length, node: process.version },
    facts, verdicts,
  };
  const path = join(ROOT, 'receipts', 'l1.json');
  if (args.includes('--check')) {
    const was = JSON.parse(readFileSync(path, 'utf8'));
    const same = JSON.stringify(was.verdicts.map((v) => [v.id, v.verdict])) === JSON.stringify(verdicts.map((v) => [v.id, v.verdict])) &&
      ['L1c', 'L1d'].every((id) => JSON.stringify(steady(was.facts[id])) === JSON.stringify(steady(facts[id])));
    console.log(same ? 'L1 CHECK CLEAN — every verdict, and every count of L1c and L1d, reproduces the committed receipt' : 'L1 CHECK FAILED — the measurement does not reproduce the committed receipt');
    process.exit(same ? 0 : 1);
  }
  if (oi === -1) { mkdirSync(join(ROOT, 'receipts'), { recursive: true }); writeFileSync(path, JSON.stringify(receipt, null, 1) + '\n'); console.log('wrote receipts/l1.json'); }
}
