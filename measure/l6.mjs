#!/usr/bin/env node
// measure/l6.mjs — claim L6: nothing leaves the device during a sealed day of normal use, except the sends the user
// starts.
//
//   node measure/l6.mjs local          (b) the day on this laptop, every network call trapped → receipts/l6-local.json
//   node measure/l6.mjs tab            (c) the day in a Chrome tab, every request seen over DevTools → receipts/l6-tab.json
//   node measure/l6.mjs ci <outdir>    (a) read the capture taken from below on GitHub's runner (measure/netns-day.sh)
//                                          → receipts/l6-ci.json
//   node measure/l6.mjs judge          all three → receipts/l6.json
//   node measure/l6.mjs ci-b <outdir>  claim L6b (measure/claims-b.json): the capture of what the guest sends only, read the
//                                      same way → receipts/l6b-ci.json; judge-b → receipts/l6b.json
//
// A send's window runs from the user's send action to 2 s after the message was accepted: the connection's own closing
// packets fall inside it (seal 2). The day's plan is tools/day.mjs planDay: the same actions in all three.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { platform, release } from 'node:os';
import { frameToIp, classify, ipToString } from '../vendor/airgap-prover/egress.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const OUT = join(ROOT, '.out', 'l6');
const TAIL = 2000;
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const write = (name, x) => { mkdirSync(join(ROOT, 'receipts'), { recursive: true }); writeFileSync(join(ROOT, 'receipts', name), JSON.stringify({ kind: 'seed-laptop.l6-part', v: 1, commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), node: process.version }, ...x }, null, 1) + '\n'); };

/** The capture's packets with their times (the pcap record headers; airgap-prover's kernel reads the addresses). */
export function packets(buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = dv.getUint32(0, false);
  const le = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1, ns = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
  const link = dv.getUint32(20, le);
  const out = [];
  for (let off = 24; off + 16 <= u8.length;) {
    const sec = dv.getUint32(off, le), frac = dv.getUint32(off + 4, le), incl = dv.getUint32(off + 8, le);
    if (off + 16 + incl > u8.length) break;
    const ip = frameToIp(link, u8.subarray(off + 16, off + 16 + incl));
    if (ip) out.push({ ms: sec * 1000 + (ns ? frac / 1e6 : frac / 1e3), version: ip.version, dst: ip.dst });
    off += 16 + incl;
  }
  return out;
}

async function local() {
  const { startSink } = await import('../tools/smtp.mjs');
  const sink = await startSink('127.0.0.1', 0);
  rmSync(join(OUT, 'local'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'local', 'home'), { recursive: true });
  const factsFile = join(OUT, 'local', 'day.json');
  // spawn, never spawnSync: the sink lives in this process and must keep answering while the day runs
  const r = await new Promise((ok) => {
    const p = spawn(process.execPath, [join(ROOT, 'tools', 'day.mjs'), '--home', join(OUT, 'local', 'home'), '--sink', '127.0.0.1:' + sink.port, '--out', factsFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('exit', (status) => ok({ status, stderr }));
  });
  await new Promise((ok) => setTimeout(ok, 500));
  const messages = sink.messages.length;
  await sink.close();
  const d = existsSync(factsFile) ? JSON.parse(readFileSync(factsFile, 'utf8')) : { error: (r.stderr || '').slice(-400) };
  const inWindow = (t) => d.sends.some((w) => t.at >= w.start && t.at <= w.end);
  return { actions: d.actions, receipts: d.receipts, plan: d.plan, attempts: d.attempts, allowed: (d.attempts || []).filter((t) => t.allowed).length, stopped: (d.attempts || []).filter((t) => !t.allowed).length, allowedInWindows: (d.attempts || []).filter((t) => t.allowed && inWindow(t)).length, sends: (d.sends || []).length, sentOk: (d.sends || []).filter((w) => w.ok).length, messages };
}

function ci(dir) {
  const d = JSON.parse(readFileSync(join(dir, 'day.json'), 'utf8'));
  const declared = ['10.9.9.1/32'];
  const ps = packets(readFileSync(join(dir, 'day.pcap')));
  const classes = ps.map((p) => ({ ...p, cls: classify(p.version, p.dst, declared), to: ipToString(p.version, p.dst) }));
  const egress = classes.filter((p) => p.cls === 'egress');
  const toSink = classes.filter((p) => p.cls === 'declared-peer');
  const outside = toSink.filter((p) => !d.sends.some((w) => p.ms >= w.start - 1 && p.ms <= w.end + TAIL));
  return { packets: ps.length, egress: egress.length, egressTo: [...new Set(egress.map((p) => p.to))], toSink: toSink.length, outsideWindows: outside.length, sends: d.sends.length, sentOk: d.sends.filter((w) => w.ok).length, actions: d.actions, receipts: d.receipts, attempts: d.attempts.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'local') { const f = await local(); write('l6-local.json', { part: 'b', facts: f }); console.log(JSON.stringify({ actions: f.actions, receipts: f.receipts, allowed: f.allowed, stopped: f.stopped, sends: f.sends, messages: f.messages })); }
  else if (mode === 'tab') { const f = await (await import('./l6-tab.mjs')).dayInTab(); write('l6-tab.json', { part: 'c', facts: f }); console.log(JSON.stringify({ actions: f.actions, left: f.left, refused: f.refused })); }
  else if (mode === 'ci') { const f = ci(process.argv[3]); write('l6-ci.json', { part: 'a', facts: f }); console.log(JSON.stringify(f)); }
  else if (mode === 'tab-c2') {   // claim L6c2 (measure/claims-d.json): the tab day with frames found after they open
    const t = await (await import('./l6-tab2.mjs')).dayInTab2();
    const facts = { L6c2: { tab: t } };
    const verdicts = judge(JSON.parse(readFileSync(join(ROOT, 'measure', 'claims-d.json'), 'utf8')).claims, facts);
    for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
    writeFileSync(join(ROOT, 'receipts', 'l6c2.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L6c2', commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), node: process.version }, facts, verdicts }, null, 1) + String.fromCharCode(10));
  }
  else if (mode === 'ci-b') { const f = ci(process.argv[3]); write('l6b-ci.json', { part: 'a, outbound only', facts: f }); console.log(JSON.stringify(f)); }
  else if (mode === 'judge-b') {
    const r = existsSync(join(ROOT, 'receipts', 'l6b-ci.json')) ? JSON.parse(readFileSync(join(ROOT, 'receipts', 'l6b-ci.json'), 'utf8')).facts : null;
    const facts = { L6b: { ci: r } };
    const verdicts = judge(JSON.parse(readFileSync(join(ROOT, 'measure', 'claims-b.json'), 'utf8')).claims, facts);
    for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
    writeFileSync(join(ROOT, 'receipts', 'l6b.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L6b', commit: git('rev-parse', 'HEAD'), facts, verdicts }, null, 1) + String.fromCharCode(10));
  }
  else if (mode === 'judge') {
    const read = (n) => (existsSync(join(ROOT, 'receipts', n)) ? JSON.parse(readFileSync(join(ROOT, 'receipts', n), 'utf8')).facts : null);
    const facts = { L6: { ci: read('l6-ci.json'), local: read('l6-local.json'), tab: read('l6-tab.json') } };
    const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((c) => c.id === 'L6');
    const verdicts = judge(claims, facts);
    for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
    writeFileSync(join(ROOT, 'receipts', 'l6.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L6', commit: git('rev-parse', 'HEAD'), facts, verdicts }, null, 1) + '\n');
  } else { console.log('usage: node measure/l6.mjs local | tab | ci <dir> | judge | ci-b <dir> | judge-b | tab-c2'); process.exit(2); }
}
