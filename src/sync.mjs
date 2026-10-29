// ════════════════════════════════════════════════════════════════
// src/sync.mjs — one owner, many devices: who they are, and what passes between them. Organ 6 of the seed laptop
// (claim L5).
//
// One identity: the owner's founder key, grown from the phrase (vendor/fall-kit-core/seed.mjs). Each device has its own
// key, made at random when it is installed and never derived from the phrase, so a device regrown after a loss is a new
// device and never reuses the old one's counters. The founder signs the list of the owner's devices (the roster); a
// device pins exactly the keys the newest roster names, so a lost device is shut out by the next roster.
// What passes between devices is the store's versions (src/store.mjs opsSince), in LIGHT packets
// (vendor/fall-kit-core/vendor/light/packet.mjs): checked at the door on raw bytes — sender, signature, a counter after
// the last one heard from that device — before one byte of the body is decoded, then every version is checked again
// by the store as it is applied.
//
//   rosterBody(n, devices)            → the roster's body: { kind, v, n, devices: [{ name, key }] } sorted by key
//   sealRoster(body, founder)         → Promise<{ ok, text } | refusal>       (canonical JSON, Ed25519 by the founder)
//   openRoster(text, founderId)       → Promise<{ ok, n, devices } | { ok: false, why }>
//   keysOf(devices)                   → Map(slot → key)  | null when two devices share a slot (the roster refuses it)
//   batches(ops, max)                 → the ops in batches whose JSON is at most max characters (one op per batch at least)
//   seal({ to, ops }, device, counter)→ Promise<{ ok, bytes } | refusal>   a LIGHT packet, kind JSON, signed by the device
//   hear(bytes, door)                 → Promise<{ ok, from, slot, counter, to, ops, clock } | { ok: false, stage, why }>
//        (clock = the sender's store clock, if it sent a well-formed one, else {}: what the sender holds)
//        door = { keys: Map(slot → key hex), last: Map(slot → bigint), me: my key hex }; on success the caller sets
//        last(slot) = counter. A packet for another device is refused by name.
// ════════════════════════════════════════════════════════════════
import { prepare, finish, open as openPacket, frame, KINDS } from '../vendor/fall-kit-core/vendor/light/packet.mjs';
import { slotOf, verifyBytes, unhex, hex } from '../vendor/fall-kit-core/identity.mjs';
import { canonical } from './genome.mjs';

export const ROSTER = 'seed-laptop.devices', MAX_DEVICES = 32, MAX_OPS_JSON = 512 * 1024;
const DOMAIN = 'seed-laptop.devices.v1\n';
const HEX64 = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const enc = new TextEncoder();
const no = (why) => ({ ok: false, why });
const refuse = (stage, why) => ({ ok: false, stage, why });
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function rosterBody(n, devices) {
  const list = Array.isArray(devices) ? devices : [];
  // in key order: each pair sorts as its key's text (a key is 64 hex characters, so the comma after it orders nothing)
  return { kind: ROSTER, v: 1, n, devices: list.map((d) => ({ name: d && d.name, key: d && d.key })).map((d) => [String(d.key), d]).sort().map((p) => p[1]) };
}

function checkBody(b) {
  if (!isObj(b) || b.kind !== ROSTER || b.v !== 1) return no('not a device roster');
  if (!Number.isSafeInteger(b.n) || b.n < 1) return no('a roster is numbered from 1');
  if (!Array.isArray(b.devices) || b.devices.length < 1 || b.devices.length > MAX_DEVICES) return no('a roster names 1 to ' + MAX_DEVICES + ' devices');
  for (const d of b.devices) {
    if (!isObj(d) || Object.keys(d).sort().join(',') !== 'key,name' || typeof d.key !== 'string' || !HEX64.test(d.key)) return no('a device is a name and a key');
    if (typeof d.name !== 'string' || !NAME.test(d.name)) return no('a device name is 1 to 40 letters, digits, spaces, dots, dashes or underscores');
  }
  if (keysOf(b.devices) === null) return no('two devices share a key or a slot: make the new device again');
  return { ok: true };
}

export function keysOf(devices) {
  const m = new Map();
  for (const d of Array.isArray(devices) ? devices : []) {
    if (!isObj(d) || typeof d.key !== 'string' || !HEX64.test(d.key)) return null;
    const s = slotOf(unhex(d.key));
    if (m.has(s)) return null;
    m.set(s, d.key);
  }
  return m;
}

export async function sealRoster(body, founder) {
  const c = checkBody(body);
  if (!c.ok) return c;
  if (!founder || typeof founder.sign !== 'function' || typeof founder.id !== 'string') return no('a roster is sealed by the founder');
  const sig = await founder.sign(enc.encode(DOMAIN + canonical(body)));
  return { ok: true, text: canonical({ body, by: founder.id, sig: hex(sig) }) };
}

export async function openRoster(text, founderId) {
  let r;
  try { r = JSON.parse(text); } catch { return no('a roster is JSON'); }
  if (typeof text !== 'string' || canonical(r) !== text) return no('a roster is in its one canonical form');
  if (!isObj(r) || Object.keys(r).sort().join(',') !== 'body,by,sig') return no('a roster is its body, its signer and the signature');
  if (r.by !== founderId) return no('the roster is not signed by this owner');
  const c = checkBody(r.body);
  if (!c.ok) return c;
  if (typeof r.sig !== 'string' || !/^[0-9a-f]{128}$/.test(r.sig)) return no('the signature is 64 bytes in hex');
  if (!(await verifyBytes(founderId, enc.encode(DOMAIN + canonical(r.body)), unhex(r.sig)))) return no('the owner did not sign this roster');
  return { ok: true, n: r.body.n, devices: r.body.devices };
}

export function batches(ops, max = MAX_OPS_JSON) {
  const out = [];
  let cur = [], size = 2;
  for (const op of Array.isArray(ops) ? ops : []) {
    let n;
    try { n = JSON.stringify(op).length + 1; } catch { continue; }
    if (cur.length && size + n > max) { out.push(cur); cur = []; size = 2; }
    cur.push(op); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function seal(body, device, counter) {
  if (!isObj(device) || typeof device.sign !== 'function' || !Number.isSafeInteger(counter) || counter < 1) return no('a packet is sealed by a device, with a counter from 1');
  const p = prepare({ sender: device.slot, counter: BigInt(counter), dictId: 0, kind: KINDS.JSON, value: body });
  if (!p.ok) return no(p.why);
  let sig;
  try { sig = await device.sign(p.signed); } catch { return no('the device could not sign'); }
  const f = finish(p.unsigned, sig);
  return f.ok ? { ok: true, bytes: f.bytes } : no(f.why);
}

export async function hear(bytes, door) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array)) return refuse('size', 'not bytes');
  const d = isObj(door) ? door : {};
  const keys = d.keys instanceof Map ? d.keys : new Map(), last = d.last instanceof Map ? d.last : new Map();
  const ctx = { keyFor: (s) => (keys.has(s) ? keys.get(s) : null), dictFor: () => null, lastCounter: (s) => (last.has(s) ? last.get(s) : 0n) };
  const f = frame(bytes, ctx);
  if (!f.ok) return refuse(f.stage, f.reason);
  const key = ctx.keyFor(f.sender);
  if (key === null) return refuse('sender', "not a device on the owner's roster");
  const sigOk = await verifyBytes(key, f.signed, f.sig);
  const o = openPacket(bytes, { ...ctx, verify: () => sigOk });
  if (!o.admit) return refuse(o.stage, o.reason);
  const v = o.value;
  if (!isObj(v) || typeof v.to !== 'string' || !Array.isArray(v.ops)) return refuse('body', 'a sync packet is { to, ops }');
  if (v.to !== d.me) return refuse('body', 'the packet is for another device');
  const clock = isObj(v.clock) && Object.entries(v.clock).every(([k, n]) => /^[0-9a-f]{8,64}$/.test(k) && Number.isSafeInteger(n) && n >= 1) ? v.clock : {};
  return { ok: true, from: key, slot: f.sender, counter: o.counter, to: v.to, ops: v.ops, clock };
}
