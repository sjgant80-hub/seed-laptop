#!/usr/bin/env node
// measure/l5.mjs — claim L5, measured once: two devices stay consistent under offline edits; losing one loses nothing
// it had shared.
//
//   node measure/l5.mjs [--check]
//
// Devices A and B are two processes (tools/device.mjs), two home folders, one owner (one phrase), each with its own
// random key, both on a roster the owner's phrase signs, syncing through a relay that reads no body
// (tools/relay-run.mjs, the foundation's relay kernel). A sealed random script (seed 51): rounds 1–6; in each, both
// are offline and each makes 20 edits, at least 10% of them to keys the other device also edits that round (measured,
// per round: the lower of the two devices' shares); then both come online and sync (A then B), and both digests and
// every write so far are checked on both. After round 6's sync, A makes 7 more
// edits and is destroyed (killed, its folder deleted). Device C is regrown: a new folder, the same phrase, a new random
// key, the store from the vault B backed up after round 5, a new roster {B, C} signed by the phrase; C syncs with B.
// Then B and C play 3 more rounds. The WebRTC part runs the same kernels in one Chrome tab (measure/webrtc.mjs).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform, release } from 'node:os';
import { startDevice } from '../tools/drive.mjs';
import { startRelay } from '../tools/relay-run.mjs';
import { lost } from '../src/store.mjs';
import { judge } from './judge.mjs';
import { requirePins } from './pins.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
requirePins(ROOT);
const OUT = join(ROOT, '.out', 'l5');
const PHRASE = 'the measured owner of the stock office, a public test phrase';
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

export { rng, editsFor } from './l5-script.mjs';
import { rng, editsFor } from './l5-script.mjs';

/** The share of each device's edits in a round on keys the other device also edited that round; the lower of the two. */
const shareOf = (x, y) => Math.min(x.filter((k) => y.includes(k)).length / x.length, y.filter((k) => x.includes(k)).length / y.length);

async function sync(x, y) {
  await x.do('sync'); await y.do('settle', { quiet: 400 });
  await y.do('sync'); await x.do('settle', { quiet: 400 });
}

async function measure() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const relay = await startRelay();
  const A = await startDevice(join(OUT, 'A')), B = await startDevice(join(OUT, 'B'));
  const a = await A.do('init', { phrase: PHRASE, name: 'laptop' }), b = await B.do('init', { phrase: PHRASE, name: 'desktop' });
  const r1 = await A.do('sign-roster', { phrase: PHRASE, n: 1, devices: [{ name: 'laptop', key: a.key }, { name: 'desktop', key: b.key }] });
  await A.do('roster', { text: r1.text }); await B.do('roster', { text: r1.text });
  const r = rng(51);
  const ops = { A: [], B: [] };
  const rounds = [];
  let shared = 0, edits = 0, aAfterLastSync = [], vault = null;
  for (let round = 1; round <= 6; round++) {
    const keys = { A: [], B: [] };
    for (const [name, dev] of [['A', A], ['B', B]]) {
      for (const e of editsFor(r, name, round, 20)) { const res = await dev.do('edit', { key: e.key, value: e.value }); ops[name].push(res.op); keys[name].push(e.key); edits++; if (e.same) shared++; }
    }
    await A.do('connect', { port: relay.port }); await B.do('connect', { port: relay.port });
    await sync(A, B);
    const sa = (await A.do('state')).store, sb = (await B.do('state')).store;
    const da = (await A.do('digest')).digest, db = (await B.do('digest')).digest;
    const all = [...ops.A, ...ops.B];
    rounds.push({ round, equal: da === db, lostA: lost(all, sa).length, lostB: lost(all, sb).length, keys: Object.keys(sb.keys).length, share: shareOf(keys.A, keys.B) });
    await A.do('disconnect'); await B.do('disconnect');
    if (round === 5) vault = (await B.do('backup', { phrase: PHRASE })).file;
    if (round === 6) {
      for (const e of editsFor(r, 'A', 99, 7)) { const res = await A.do('edit', { key: e.key, value: e.value }); aAfterLastSync.push(res.op); }
      await A.kill();
      rmSync(join(OUT, 'A'), { recursive: true, force: true });
      break;
    }
  }
  const beforeLoss = [...ops.A, ...ops.B];
  // device C: regrown from the phrase and the vault, a new key, a new roster without A
  const C = await startDevice(join(OUT, 'C'));
  const c = await C.do('init', { phrase: PHRASE, name: 'new laptop' });
  const restored = await C.do('restore', { vault, phrase: PHRASE });
  const r2 = await C.do('sign-roster', { phrase: PHRASE, n: 2, devices: [{ name: 'desktop', key: b.key }, { name: 'new laptop', key: c.key }] });
  await C.do('roster', { text: r2.text }); await B.do('roster', { text: r2.text });
  await B.do('connect', { port: relay.port }); await C.do('connect', { port: relay.port });
  await sync(C, B);
  const sc = (await C.do('state')).store, sb2 = (await B.do('state')).store;
  const regrow = {
    restored: restored.ok === true, equal: (await C.do('digest')).digest === (await B.do('digest')).digest,
    lostBefore: lost(beforeLoss, sc).length, lostWithA: lost(aAfterLastSync, sc).length, aUnsynced: aAfterLastSync.length,
    lostOther: lost(beforeLoss, sb2).length, newKey: c.key !== a.key,
  };
  await B.do('disconnect'); await C.do('disconnect');
  const ops2 = { B: [], C: [] };
  const after = [];
  for (let round = 7; round <= 9; round++) {
    const keys = { B: [], C: [] };
    for (const [name, dev] of [['B', B], ['C', C]]) for (const e of editsFor(r, name, round, 20)) { const res = await dev.do('edit', { key: e.key, value: e.value }); ops2[name].push(res.op); keys[name].push(e.key); edits++; if (e.same) shared++; }
    await B.do('connect', { port: relay.port }); await C.do('connect', { port: relay.port });
    await sync(B, C);
    const all = [...beforeLoss, ...ops2.B, ...ops2.C];
    after.push({ round, equal: (await B.do('digest')).digest === (await C.do('digest')).digest, lostB: lost(all, (await B.do('state')).store).length, lostC: lost(all, (await C.do('state')).store).length, share: shareOf(keys.B, keys.C) });
    await B.do('disconnect'); await C.do('disconnect');
  }
  const refusedPackets = [...B.events, ...C.events].filter((e) => e.event === 'refused').length;
  await B.do('quit'); await C.do('quit'); await relay.close();
  return { rounds, regrow, after, edits, shared, sharedShare: shared / edits, minShare: Math.min(...rounds.map((x) => x.share), ...after.map((x) => x.share)), refusedPackets };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const facts = { L5: { relay: await measure() } };
  let web = null;
  try { web = (await import('./webrtc.mjs')).measureWebRTC ? await (await import('./webrtc.mjs')).measureWebRTC() : null; } catch (e) { web = { error: String(e.message).slice(0, 200) }; }
  facts.L5.webrtc = web;
  const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((c) => c.id === 'L5');
  const verdicts = judge(claims, facts);
  for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
  const path = join(ROOT, 'receipts', 'l5.json');
  if (process.argv.includes('--check')) {
    const was = JSON.parse(readFileSync(path, 'utf8'));
    const same = JSON.stringify(was.verdicts.map((v) => v.verdict)) === JSON.stringify(verdicts.map((v) => v.verdict)) && JSON.stringify(was.facts.L5.relay) === JSON.stringify(facts.L5.relay);
    console.log(same ? 'L5 CHECK CLEAN' : 'L5 CHECK FAILED'); process.exit(same ? 0 : 1);
  }
  mkdirSync(join(ROOT, 'receipts'), { recursive: true });
  writeFileSync(path, JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L5', commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), node: process.version }, facts, verdicts }, null, 1) + '\n');
  console.log('wrote receipts/l5.json');
}
