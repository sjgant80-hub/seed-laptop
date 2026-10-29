#!/usr/bin/env node
// measure/l1b2.mjs — claim L1b2 (measure/claims-c.json), the fix for L1b's probe, sealed before its run.
//
//   node measure/l1b2.mjs            measure once, write receipts/l1b2.json
//
// L1b's probe named each block's frame by the URL it had when DevTools attached to it. Chrome isolates a sandboxed
// frame in a process of its own and attaches to it before its first navigation commits, so the URL was not there
// yet: no frame was named, every element count fell back to 0, and an exception inside a block would have been filed
// under no block. This probe runs L1b's steps unchanged (Chrome, the network off, the seed chosen, every block opened
// from the rail), and names frames only at the end, by asking Chrome for every frame target and its URL then;
// exceptions are kept by the target that threw them and named the same way. Each block's element count is read
// inside its own frame, over that frame's own DevTools session.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform, release, cpus } from 'node:os';
import { germinate } from '../src/germinate.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';
import { serve } from '../tools/serve.mjs';
import { launch } from '../tools/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const PHRASE = 'the measured owner of the stock office, a public test phrase';
const AT = '2026-10-29T12:00:00Z';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
const full = await germinate({ full: new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full'))) }, { pinned, phrase: PHRASE, at: AT });
const named = full.office.blocks.length;

const srv = await serve(ROOT);
const profile = join(ROOT, '.out', 'l1b2-profile');
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const c = await launch({ profile });
const p = await c.page();
const urls = new Map(), failed = new Map(), exc = [], targetOf = new Map();   // session id → target id
const watch = (sid) => {
  c.browser.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url), sid);
  c.browser.on('Network.loadingFailed', (e) => failed.set(e.requestId, e.blockedReason || ''), sid);
  c.browser.on('Runtime.exceptionThrown', (e) => exc.push({ target: targetOf.get(sid) || 'page', text: String(e.exceptionDetails.exception?.description || e.exceptionDetails.text).split('\n')[0] }), sid);
};
c.browser.on('Target.attachedToTarget', async (e) => {
  targetOf.set(e.sessionId, e.targetInfo.targetId);
  watch(e.sessionId);
  try { await c.browser.send('Runtime.enable', {}, e.sessionId); await c.browser.send('Network.enable', {}, e.sessionId); await c.browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, e.sessionId); } catch { /* a frame that went away */ }
}, p.sessionId);
watch(p.sessionId);
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
// name the frames now, by the URL each has after loading
const { targetInfos } = await c.browser.send('Target.getTargets', {});
const frameOf = new Map();   // block id → target id
for (const t of targetInfos) { const m = /frame\.html\?b=([a-z0-9-]+)/.exec(t.url); if (m && t.type === 'iframe') frameOf.set(m[1], t.targetId); }
const sessionFor = (targetId) => [...targetOf].find(([, t]) => t === targetId)?.[0];
for (const x of blocks) {
  const tid = frameOf.get(x.id);
  x.frame = tid ? 'found' : 'not found';
  let sid = tid ? sessionFor(tid) : undefined;
  if (tid && !sid) { try { sid = (await c.browser.send('Target.attachToTarget', { targetId: tid, flatten: true })).sessionId; } catch { sid = undefined; } }
  let elements = 0;
  if (sid) { try { elements = (await c.browser.send('Runtime.evaluate', { expression: 'document.body ? document.body.querySelectorAll("*").length : 0', returnByValue: true }, sid)).result.value; } catch { elements = 0; } }
  x.elements = elements;
  x.exceptions = exc.filter((e) => tid && e.target === tid).length + (trace.exceptions[x.id] || []).length;
  x.bridged = trace.bridged[x.id] || 0;
}
const other = [...urls].filter(([, u]) => !u.startsWith(srv.url) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:'));
const refused = other.filter(([id]) => failed.get(id)).length;
const facts = {
  chrome: c.version, offline, digest: planted && planted.digest, l1aDigest: full.digest, named, blocks, left: other.length - refused, refused,
  refusedHosts: [...new Set(other.map(([, u]) => new URL(u).host))].sort(), kar: trace.events.some((e) => e.t === 'kar-open'), ms: Math.round(ms),
  frameTargets: targetInfos.filter((t) => t.type === 'iframe').length, unnamedExceptions: exc.filter((e) => e.target !== 'page' && ![...frameOf.values()].includes(e.target)).length,
};
await c.close(); await srv.close();
rmSync(profile, { recursive: true, force: true });
const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims-c.json'), 'utf8')).claims;
const verdicts = judge(claims, { L1b2: facts });
for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
writeFileSync(join(ROOT, 'receipts', 'l1b2.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L1b2', commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), cpu: (cpus()[0] || {}).model, cores: cpus().length, node: process.version }, facts, verdicts }, null, 1) + String.fromCharCode(10));
console.log('wrote receipts/l1b2.json');
