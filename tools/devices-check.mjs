#!/usr/bin/env node
// tools/devices-check.mjs — a development check of the office's devices panel, NOT a sealed claim: it was written after
// the fault it looks at was found and fixed, so it is kept as a record of what was seen, never as a claim's measurement.
//
// For each commit named, its files exactly as committed (git archive) are served on loopback; three headless Chromes,
// each with its own throwaway profile (so three devices, each with its own key), plant the stock seed:
//   A and B with one owner's phrase, C with another owner's.
//   1. A and B pair, the phrase typed on A.
//   2. A meets C (pairing codes copied, no phrase typed), then A writes (Kar's "recent"): the binary packets A sends C
//      are counted (each is the store's versions, sealed for that device).
//   3. A and B meet again with no phrase; A takes B off its list with the phrase; then A writes and B writes: the binary
//      packets A sends B are counted, and what A's door says of B's.
// Every send on a data channel is counted in the page (RTCDataChannel.prototype.send wrapped before the office loads),
// and every channel that opens (two devices have met when the first device's count of open channels goes up).
// Chrome is started with WebRtcHideLocalIpsWithMdns off, so two browsers on one machine find each other without mDNS.
//
//   node tools/devices-check.mjs <commit> [<commit> …]  → receipts/devices-check.json  (--dry: .out/devices-check.json)
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release } from 'node:os';
import { serve } from './serve.mjs';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.out', 'devices-check');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clear = (p) => { try { rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* Windows may hold a closed Chrome's files a while: a fresh name is used each run */ } };
const COUNT = `(() => { const s = RTCDataChannel.prototype.send; window.__bin = 0; window.__txt = 0; window.__opens = 0;
  RTCDataChannel.prototype.send = function (d) { if (typeof d === 'string') window.__txt++; else window.__bin++; return s.call(this, d); };
  const P = window.RTCPeerConnection, make = P.prototype.createDataChannel, opened = (dc) => dc.addEventListener('open', () => { window.__opens++; });
  P.prototype.createDataChannel = function (...a) { const dc = make.apply(this, a); opened(dc); return dc; };
  window.RTCPeerConnection = function (...a) { const pc = new P(...a); pc.addEventListener('datachannel', (e) => opened(e.channel)); return pc; };
  window.RTCPeerConnection.prototype = P.prototype; })();`;
const OWNER = 'the owner of A and B, a development check phrase', OTHER = 'somebody else entirely, another owner phrase';

function exportCommit(commit, dir) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  if (spawnSync('git', ['archive', '--format=tar', '-o', join(dir, 'export.tar'), commit], { cwd: ROOT }).status !== 0) throw new Error('git archive ' + commit + ' failed');
  if (spawnSync('tar', ['-xf', 'export.tar'], { cwd: dir }).status !== 0) throw new Error('tar could not unpack ' + commit);
  rmSync(join(dir, 'export.tar'), { force: true });
}

async function device(name, at) {
  const profile = join(OUT, 'profile-' + at + '-' + name + '-' + process.pid);
  clear(profile); mkdirSync(profile, { recursive: true });
  const c = await launch({ profile, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const p = await c.page();
  await p.send('Page.enable'); await p.send('Runtime.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT });
  const ev = (js) => p.eval(js);
  const until = async (js, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(js)) return true; } catch { /* loading */ } await wait(200); } return false; };
  return { name, c, ev, until, profile, p };
}

async function check(commit, port) {
  const dir = join(OUT, commit.slice(0, 7));
  exportCommit(commit, dir);
  const srv = await serve(dir, port);
  const say = (d) => d.ev(`document.getElementById('dev-says').textContent`);
  const listed = (d) => d.ev(`[...document.querySelectorAll('#dev-list li')].map((li) => li.textContent)`);
  const sent = (d) => d.ev(`({ bin: window.__bin, txt: window.__txt })`);
  const ask = async (d) => { await d.ev(`document.getElementById('ask-text').value = 'recent'; document.getElementById('ask').requestSubmit(); true`); await wait(3000); };   // a receipt: the office syncs a second after it
  async function plantIt(d, phrase) {
    await d.p.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/office/' });
    if (!await d.until(`document.getElementById('plant') && !document.getElementById('plant').hidden`, 60000)) throw new Error(d.name + ': no planting screen');
    await d.ev(`document.getElementById('phrase').value = ${JSON.stringify(phrase)}; document.getElementById('phrase2').value = ${JSON.stringify(phrase)}; document.getElementById('plant-stock').click(); true`);
    if (!await d.until(`!document.getElementById('office').hidden && document.querySelector('#rail [data-id="devices"]')`, 60000)) throw new Error(d.name + ': the office did not grow');
    await d.ev(`document.querySelector('#rail [data-id="devices"]').click(); true`);
  }
  async function meet(a, b, phrase) {
    if (phrase) await a.ev(`document.getElementById('dev-phrase').value = ${JSON.stringify(phrase)}; true`);
    await a.ev(`document.getElementById('dev-mine').value = ''; document.getElementById('dev-offer').click(); true`);
    if (!await a.until(`document.getElementById('dev-mine').value.length > 20`)) throw new Error('no pairing code from ' + a.name);
    const offer = await a.ev(`document.getElementById('dev-mine').value`);
    await b.ev(`document.getElementById('dev-mine').value = ''; document.getElementById('dev-code').value = ${JSON.stringify(offer)}; document.getElementById('dev-accept').click(); true`);
    if (!await b.until(`document.getElementById('dev-mine').value.length > 20`)) throw new Error('no answering code from ' + b.name);
    const answer = await b.ev(`document.getElementById('dev-mine').value`);
    const opens = await a.ev(`window.__opens`);
    await a.ev(`document.getElementById('dev-code').value = ${JSON.stringify(answer)}; document.getElementById('dev-accept').click(); true`);
    const open = await a.until(`window.__opens > ${opens}`, 30000);
    await wait(3000);
    return open;
  }
  const A = await device('A', commit.slice(0, 7)), B = await device('B', commit.slice(0, 7)), C = await device('C', commit.slice(0, 7));
  const r = { commit };
  try {
    await plantIt(A, OWNER); await plantIt(B, OWNER); await plantIt(C, OTHER);
    r.chrome = A.c.version;
    r.pair = { open: await meet(A, B, OWNER) };
    Object.assign(r.pair, { aSays: await say(A), bSays: await say(B), aList: await listed(A), bList: await listed(B), aSent: await sent(A), bSent: await sent(B) });
    const before = await sent(A);
    r.otherOwner = { open: await meet(A, C, '') };
    await ask(A);
    const after = await sent(A);
    Object.assign(r.otherOwner, { packetsAtoC: after.bin - before.bin, textsAtoC: after.txt - before.txt, aSays: await say(A), cSays: await say(C) });
    r.takenOff = { met: await meet(A, B, ''), control: await A.ev(`Boolean(document.querySelector('#dev-list button'))`) };
    if (r.takenOff.control) {
      await A.ev(`document.getElementById('dev-phrase').value = ${JSON.stringify(OWNER)}; document.querySelector('#dev-list button').click(); true`);
      await A.until(`/Taken off/.test(document.getElementById('dev-says').textContent)`, 15000);
      await wait(1500);
      Object.assign(r.takenOff, { aList: await listed(A), bList: await listed(B), bSays: await say(B) });
      const b0 = await sent(A);
      await ask(A);
      r.takenOff.packetsAtoB = (await sent(A)).bin - b0.bin;
      await ask(B);
      r.takenOff.aSaysOfB = await say(A);
      r.takenOff.aReceipt = await A.ev(`[...document.querySelectorAll('#receipt-list li, #said li')].map((li) => li.textContent).find((t) => / is off your list of devices/.test(t)) || null`);
    }
  } catch (e) { r.error = String((e && e.message) || e); }
  for (const d of [A, B, C]) { await d.c.close(); clear(d.profile); }
  await srv.close();
  clear(dir);
  return r;
}

const dry = process.argv.includes('--dry');
const commits = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((c) => git('rev-parse', c));
if (!commits.length || commits.some((c) => !/^[0-9a-f]{40}$/.test(c))) { console.log('usage: node tools/devices-check.mjs <commit> [<commit> …] [--dry]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const runs = [];
for (const [i, c] of commits.entries()) runs.push(await check(c, 48761 + i));
const record = { kind: 'seed-laptop.devices-check', v: 1, note: 'A development check, not a sealed claim: written after the fault was found and fixed. Each run serves one commit exactly as committed.', at: new Date().toISOString(), machine: { os: platform() + ' ' + release(), node: process.version }, runs };
const file = dry ? join(ROOT, '.out', 'devices-check.json') : join(ROOT, 'receipts', 'devices-check.json');
writeFileSync(file, JSON.stringify(record, null, 1) + '\n');
console.log(JSON.stringify(runs.map((x) => ({ commit: x.commit.slice(0, 7), error: x.error, packetsAtoC: x.otherOwner && x.otherOwner.packetsAtoC, control: x.takenOff && x.takenOff.control, packetsAtoB: x.takenOff && x.takenOff.packetsAtoB, aSaysOfB: x.takenOff && x.takenOff.aSaysOfB }))));
console.log('wrote ' + file);
