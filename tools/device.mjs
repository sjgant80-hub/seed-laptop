#!/usr/bin/env node
// tools/device.mjs — one of the owner's devices, as a process (claims L4, L5, L6). Driven by JSON lines on stdin, it
// answers JSON lines on stdout ({ id, ok, … }). Its home folder holds everything it keeps:
//   device.json   its own key (made at random when it is installed: never from the phrase), the owner's founder id
//   roster.txt    the founder-signed list of the owner's devices (src/sync.mjs)
//   store.json    the office's one store (src/store.mjs), written after every change
//   heard.json    the last counter heard from each device, and the last clock each device told us it had
//
// commands: init { phrase, name } · key · roster { text } · sign-roster { phrase, n, devices } · edit { key, value }
//           · connect { port } · disconnect · sync · digest · state · restore { vault, phrase } · backup { phrase }
//           · ops (every op this device wrote) · quit
// A device writes into its own store with its own key's id as the writer, and sends the versions a peer has not yet
// told it it holds, in LIGHT packets addressed to that peer through the relay.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { makeIdentity, unhex, hex } from '../vendor/fall-kit-core/identity.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { frameOf, createReader, KIND } from '../vendor/fall-kit-core/relay.mjs';
import { emptyStore, write, apply, opsSince, digest, validStore } from '../src/store.mjs';
import { rosterBody, sealRoster, openRoster, keysOf, batches, seal, hear } from '../src/sync.mjs';
import { seal as sealVault, open as openVault } from '../src/vault.mjs';
import { POLICY } from '../src/germinate.mjs';

const home = resolve(process.argv[2] || '.');
mkdirSync(home, { recursive: true });
const at = (f) => join(home, f);
const save = (f, x) => writeFileSync(at(f), typeof x === 'string' ? x : JSON.stringify(x));
const load = (f, d) => (existsSync(at(f)) ? JSON.parse(readFileSync(at(f), 'utf8')) : d);

let me = null, founderId = null, roster = null, door = null, sock = null, reader = null;
let store = load('store.json', emptyStore());
const heard = load('heard.json', { last: {}, clocks: {} });
const mine = [];
let counter = Number(heard.counter || 0);
const out = (x) => process.stdout.write(JSON.stringify(x) + '\n');
const persist = () => { save('store.json', store); save('heard.json', { ...heard, counter }); };

async function loadKey() {
  const d = load('device.json', null);
  if (!d) return false;
  me = await makeIdentity(unhex(d.seed));
  founderId = d.founder;
  if (existsSync(at('roster.txt'))) await setRoster(readFileSync(at('roster.txt'), 'utf8'));
  return true;
}

async function setRoster(text) {
  const r = await openRoster(text, founderId);
  if (!r.ok) return r;
  if (roster && r.n <= roster.n) return { ok: false, why: 'an older roster (' + r.n + ') than the one held (' + roster.n + ')' };
  roster = r;
  door = { keys: keysOf(r.devices), last: new Map(Object.entries(heard.last).map(([s, c]) => [Number(s), BigInt(c)])), me: me.id };
  save('roster.txt', text);
  return { ok: true, n: r.n, devices: r.devices.length };
}

function send(to, bytes) { if (sock && !sock.destroyed) sock.write(Buffer.from(frameOf(KIND.SEND, unhex(to), bytes))); }

async function syncTo(peer) {
  const since = heard.clocks[peer] || {};
  const ops = opsSince(store, since);
  const parts = batches(ops);
  if (!parts.length) parts.push([]);
  for (let i = 0; i < parts.length; i++) {
    counter++;
    const pk = await seal({ to: peer, ops: parts[i], clock: store.clock, last: i === parts.length - 1 }, me, counter);
    if (pk.ok) send(peer, pk.bytes);
  }
  persist();
  return ops.length;
}

const waiters = [];
async function onPacket(bytes) {
  if (!door) return;
  const h = await hear(bytes, door);
  if (!h.ok) { out({ event: 'refused', stage: h.stage, why: h.why }); return; }
  door.last.set(h.slot, h.counter);
  heard.last[h.slot] = String(h.counter);
  let applied = 0;
  for (const op of h.ops) { const r = apply(store, op); if (r.ok) { store = r.store; if (r.changed) applied++; } else out({ event: 'op-refused', why: r.why }); }
  const was = heard.clocks[h.from] || {};
  heard.clocks[h.from] = Object.fromEntries([...new Set([...Object.keys(was), ...Object.keys(h.clock)])].map((k) => [k, Math.max(was[k] || 0, h.clock[k] || 0)]));
  persist();
  for (const w of waiters.splice(0)) w({ from: h.from, applied });
}

function connect(port) {
  return new Promise((ok) => {
    sock = createConnection({ host: '127.0.0.1', port }, () => { sock.write(Buffer.from(frameOf(KIND.HELLO, unhex(me.id)))); ok(); });
    reader = createReader();
    let chain = Promise.resolve();
    sock.on('data', (chunk) => {
      const r = reader.push(new Uint8Array(chunk));
      if (!r.ok) return;
      for (const f of r.frames) if (f.kind === KIND.DELIVER) chain = chain.then(() => onPacket(f.bytes));
    });
    sock.on('error', () => {});
  });
}

const rl = createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on('line', (line) => { queue = queue.then(() => handle(line)); });

async function handle(line) {
  let m;
  try { m = JSON.parse(line); } catch { return out({ ok: false, why: 'not JSON' }); }
  const id = m.id;
  try {
    if (m.cmd === 'init') {
      const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
      me = await makeIdentity(seed);
      const p = await plant(m.phrase, ['device'], { policy: { ...POLICY } });
      if (!p.ok) return out({ id, ok: false, why: p.why });
      founderId = p.ids.founder.id;
      save('device.json', { name: m.name, seed: hex(seed), id: me.id, founder: founderId });
      return out({ id, ok: true, key: me.id, founder: founderId });
    }
    if (m.cmd === 'key') return out({ id, ok: await loadKey(), key: me && me.id, founder: founderId });
    if (m.cmd === 'sign-roster') {
      const p = await plant(m.phrase, ['device'], { policy: { ...POLICY } });
      const s = await sealRoster(rosterBody(m.n, m.devices), p.ids.founder);
      return out({ id, ...s });
    }
    if (m.cmd === 'roster') return out({ id, ...(await setRoster(m.text)) });
    if (m.cmd === 'edit') {
      const w = write(store, me.id, m.key, m.value);
      if (!w.ok) return out({ id, ok: false, why: w.why });
      store = w.store; mine.push(w.op); persist();
      return out({ id, ok: true, op: { key: w.op.key, d: w.op.d, n: w.op.n } });
    }
    if (m.cmd === 'connect') { await connect(m.port); return out({ id, ok: true }); }
    if (m.cmd === 'disconnect') { if (sock) { sock.destroy(); sock = null; } return out({ id, ok: true }); }
    if (m.cmd === 'sync') {
      const peers = roster.devices.map((d) => d.key).filter((k) => k !== me.id);
      let sent = 0;
      for (const p of peers) sent += await syncTo(p);
      return out({ id, ok: true, sent });
    }
    if (m.cmd === 'settle') {   // wait until nothing has arrived for m.quiet ms
      const quiet = m.quiet || 300;
      for (;;) {
        const got = await Promise.race([new Promise((r) => waiters.push(r)), new Promise((r) => setTimeout(() => r(null), quiet))]);
        if (got === null) break;
      }
      return out({ id, ok: true });
    }
    if (m.cmd === 'digest') return out({ id, ok: true, digest: digest(store), keys: Object.keys(store.keys).length });
    if (m.cmd === 'state') return out({ id, ok: true, store });
    if (m.cmd === 'ops') return out({ id, ok: true, ops: mine.map((o) => ({ key: o.key, d: o.d, n: o.n })) });
    if (m.cmd === 'backup') {
      const s = await sealVault([{ path: 'store.json', bytes: new TextEncoder().encode(JSON.stringify(store)) }], m.phrase);
      if (!s.ok) return out({ id, ok: false, why: s.why });
      writeFileSync(at('vault.slv'), s.bytes);
      return out({ id, ok: true, file: at('vault.slv'), ref: s.ref, bytes: s.bytes.length });
    }
    if (m.cmd === 'restore') {
      const o = await openVault(new Uint8Array(readFileSync(m.vault)), m.phrase);
      if (!o.ok) return out({ id, ok: false, stage: o.stage, why: o.why });
      const s = JSON.parse(new TextDecoder().decode(o.entries.find((e) => e.path === 'store.json').bytes));
      if (!validStore(s)) return out({ id, ok: false, why: 'the vault holds no store' });
      store = s; persist();
      return out({ id, ok: true, digest: digest(store) });
    }
    if (m.cmd === 'quit') { if (sock) sock.destroy(); out({ id, ok: true }); process.exit(0); }
    return out({ id, ok: false, why: 'no such command' });
  } catch (e) {
    return out({ id, ok: false, why: String(e && e.message) });
  }
}

await loadKey();
out({ event: 'ready', home });
