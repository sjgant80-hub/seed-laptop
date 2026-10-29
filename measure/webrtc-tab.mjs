// measure/webrtc-tab.mjs — claim L5's WebRTC part, in a tab: two of the owner's devices, each with its own key, joined by
// a real RTCPeerConnection pair (DTLS data channel, host candidates only, no STUN), syncing the store in LIGHT packets
// through the same door as everywhere else (src/sync.mjs). Same kind of script as the relay measure: offline rounds of
// edits on both, some on the same keys, then sync. Writes the result to window.__webrtc.
import { emptyStore, write, apply, opsSince, digest, lost } from '../src/store.mjs';
import { rosterBody, sealRoster, openRoster, keysOf, batches, seal, hear } from '../src/sync.mjs';
import { makeIdentity } from '../vendor/fall-kit-core/identity.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { POLICY } from '../src/germinate.mjs';
import { rng, editsFor } from './l5-script.mjs';

const PHRASE = 'the measured owner of the stock office, a public test phrase';

async function device(name, seedByte) {
  const me = await makeIdentity(new Uint8Array(32).fill(seedByte));
  return { name, me, store: emptyStore(), clocks: {}, last: new Map(), counter: 0, door: null, ops: [], channel: null, inbox: Promise.resolve(), heard: 0 };
}

async function run() {
  const t0 = performance.now();
  const founder = (await plant(PHRASE, ['device'], { policy: { ...POLICY } })).ids.founder;
  const A = await device('A', 0x41), B = await device('B', 0x42);
  const roster = await sealRoster(rosterBody(1, [{ name: 'A', key: A.me.id }, { name: 'B', key: B.me.id }]), founder);
  for (const d of [A, B]) {
    const r = await openRoster(roster.text, founder.id);
    d.door = { keys: keysOf(r.devices), last: d.last, me: d.me.id };
  }
  const pa = new RTCPeerConnection({ iceServers: [] }), pb = new RTCPeerConnection({ iceServers: [] });
  pa.onicecandidate = (e) => e.candidate && pb.addIceCandidate(e.candidate);
  pb.onicecandidate = (e) => e.candidate && pa.addIceCandidate(e.candidate);
  const ca = pa.createDataChannel('seed-sync', { ordered: true });
  const cbP = new Promise((ok) => { pb.ondatachannel = (e) => ok(e.channel); });
  await pa.setLocalDescription(await pa.createOffer());
  await pb.setRemoteDescription(pa.localDescription);
  await pb.setLocalDescription(await pb.createAnswer());
  await pa.setRemoteDescription(pb.localDescription);
  const cb = await cbP;
  await Promise.all([ca, cb].map((c) => (c.readyState === 'open' ? null : new Promise((ok) => { c.onopen = ok; }))));
  A.channel = ca; B.channel = cb;
  const peerOf = (d) => (d === A ? B : A);
  for (const d of [A, B]) {
    d.channel.binaryType = 'arraybuffer';
    d.channel.onmessage = (e) => { d.inbox = d.inbox.then(async () => {
      const h = await hear(new Uint8Array(e.data), d.door);
      if (!h.ok) return;
      d.last.set(h.slot, h.counter);
      for (const op of h.ops) { const r = apply(d.store, op); if (r.ok) d.store = r.store; }
      const was = d.clocks[h.from] || {};
      d.clocks[h.from] = Object.fromEntries([...new Set([...Object.keys(was), ...Object.keys(h.clock)])].map((k) => [k, Math.max(was[k] || 0, h.clock[k] || 0)]));
      d.heard++;
    }); };
  }
  async function sendAll(d) {
    const p = peerOf(d);
    const parts = batches(opsSince(d.store, d.clocks[p.me.id] || {}), 200 * 1024);
    if (!parts.length) parts.push([]);
    for (const part of parts) { d.counter++; const s = await seal({ to: p.me.id, ops: part, clock: d.store.clock }, d.me, d.counter); d.channel.send(s.bytes); }
    return parts.length;
  }
  const settle = async (d, want) => { for (let i = 0; i < 400 && d.heard < want; i++) await new Promise((r) => setTimeout(r, 10)); await d.inbox; };
  const r = rng(52);
  const rounds = [];
  for (let round = 1; round <= 6; round++) {
    for (const d of [A, B]) for (const e of editsFor(r, d.name, round, 20)) { const w = write(d.store, d.me.id, e.key, e.value); d.store = w.store; d.ops.push(w.op); }
    const wantB = B.heard + await sendAll(A); await settle(B, wantB);
    const wantA = A.heard + await sendAll(B); await settle(A, wantA);
    const all = [...A.ops, ...B.ops];
    rounds.push({ round, equal: digest(A.store) === digest(B.store), lostA: lost(all, A.store).length, lostB: lost(all, B.store).length });
  }
  const dtls = (await pa.getStats()) ? [...(await pa.getStats()).values()].some((s) => s.type === 'transport' && s.dtlsState === 'connected') : false;
  pa.close(); pb.close();
  return { rounds, equal: rounds.every((x) => x.equal && x.lostA === 0 && x.lostB === 0), dtls, ms: Math.round(performance.now() - t0), browser: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || 'unknown' };
}

run().then((r) => { window.__webrtc = r; }, (e) => { window.__webrtc = { error: String(e && e.message) }; });
