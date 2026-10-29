// office/devices.mjs — the owner's devices in a tab: pair over WebRTC with codes copied by hand (no server, no STUN:
// host candidates only, so two devices on one network find each other and nothing on the internet is asked), then
// sync the store over the data channel in LIGHT packets (src/sync.mjs: the door checks each one before it is read;
// src/store.mjs checks each version again as it is applied). Glue: the decisions are in those kernels.
import { rosterBody, sealRoster, openRoster, keysOf, batches, seal, hear } from '../src/sync.mjs';
import { opsSince, apply } from '../src/store.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { POLICY } from '../src/germinate.mjs';

const $ = (id) => document.getElementById(id);
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const b64d = (s) => decodeURIComponent(escape(atob(s.trim())));

export function installDevices(ctx) {
  // ctx: { me (device identity), name, owner, store(), setStore(s), receipt(kind, facts), saved: { roster, last, clocks, counter } , save(state) }
  let pc = null, dc = null, peerKey = null, roster = null, door = null;
  const st = { last: ctx.saved.last || {}, clocks: ctx.saved.clocks || {}, counter: ctx.saved.counter || 0 };
  const persist = () => ctx.save({ roster: roster ? roster.text : null, ...st });
  const say = (t) => { $('dev-says').textContent = t; };
  $('dev-me').textContent = 'This device: ' + ctx.name + ' · key ' + ctx.me.id.slice(0, 12) + '…';

  async function useRoster(text) {
    const r = await openRoster(text, ctx.owner.founder);
    if (!r.ok) return r;
    if (roster && r.n <= roster.n) return { ok: false, why: 'an older list of devices than the one held' };
    roster = { ...r, text };
    door = { keys: keysOf(r.devices), last: new Map(Object.entries(st.last).map(([s, c]) => [Number(s), BigInt(c)])), me: ctx.me.id };
    persist();
    return { ok: true };
  }
  if (ctx.saved.roster) useRoster(ctx.saved.roster);

  async function syncNow() {
    if (!dc || dc.readyState !== 'open' || !peerKey || !roster) return 0;
    const ops = opsSince(ctx.store(), st.clocks[peerKey] || {});
    const parts = batches(ops, 200 * 1024);
    if (!parts.length) parts.push([]);
    for (const part of parts) {
      st.counter++;
      const p = await seal({ to: peerKey, ops: part, clock: ctx.store().clock }, ctx.me, st.counter);
      if (p.ok) dc.send(p.bytes);
    }
    persist();
    return ops.length;
  }

  async function onMessage(data) {
    if (typeof data === 'string') {   // the only text on the channel: the newest signed list of devices
      const r = await useRoster(data);
      say(r.ok ? 'Paired: this device is on your list of devices.' : 'The list of devices was refused: ' + r.why);
      if (r.ok) syncNow();
      return;
    }
    if (!door) return;
    const h = await hear(new Uint8Array(data), door);
    if (!h.ok) { say('A packet was refused at the ' + h.stage + ' check.'); return; }
    door.last.set(h.slot, h.counter); st.last[h.slot] = String(h.counter);
    let s = ctx.store(), n = 0;
    for (const op of h.ops) { const r = apply(s, op); if (r.ok) { s = r.store; if (r.changed) n++; } }
    ctx.setStore(s);
    const was = st.clocks[h.from] || {};
    st.clocks[h.from] = Object.fromEntries([...new Set([...Object.keys(was), ...Object.keys(h.clock)])].map((k) => [k, Math.max(was[k] || 0, h.clock[k] || 0)]));
    persist();
    if (n) ctx.receipt('synced', { changes: n });
  }

  function wire(channel) {
    dc = channel;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => onMessage(e.data);
    dc.onopen = async () => {
      say('Connected to your other device.');
      const phrase = $('dev-phrase').value;
      if (phrase) {   // the device whose owner typed the phrase signs the new list, with both devices on it
        const p = await plant(phrase, ['device'], { policy: { ...POLICY } });
        if (!p.ok || p.ids.founder.id !== ctx.owner.founder) { say('That is not your phrase: the devices were not paired.'); return; }
        const known = roster ? roster.devices : [{ name: ctx.name, key: ctx.me.id }];
        const devices = [...known.filter((d) => d.key !== peerKey), { name: 'device ' + peerKey.slice(0, 6), key: peerKey }];
        if (!devices.some((d) => d.key === ctx.me.id)) devices.push({ name: ctx.name, key: ctx.me.id });
        const s = await sealRoster(rosterBody((roster ? roster.n : 0) + 1, devices), p.ids.founder);
        $('dev-phrase').value = '';
        if (!s.ok) { say('The list of devices could not be signed: ' + s.why); return; }
        await useRoster(s.text);
        dc.send(s.text);
        ctx.receipt('paired', { device: peerKey.slice(0, 16) });
      }
      syncNow();
    };
  }

  async function gathered() {
    if (pc.iceGatheringState !== 'complete') await new Promise((r) => { pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') r(); }); setTimeout(r, 4000); });
    return b64e(JSON.stringify({ sdp: pc.localDescription, key: ctx.me.id }));
  }

  $('dev-offer').addEventListener('click', async () => {
    pc = new RTCPeerConnection({ iceServers: [] });
    wire(pc.createDataChannel('seed-sync', { ordered: true }));
    await pc.setLocalDescription(await pc.createOffer());
    $('dev-mine').value = await gathered();
    say('Copy this code to your other device, choose "Join with a code" there, then paste its code back here.');
  });
  $('dev-join').addEventListener('click', () => { say('Paste the code from your other device, then "Use this code".'); $('dev-code').focus(); });
  $('dev-accept').addEventListener('click', async () => {
    let msg;
    try { msg = JSON.parse(b64d($('dev-code').value)); } catch { say('That is not a pairing code.'); return; }
    if (!msg || !msg.sdp || typeof msg.key !== 'string' || !/^[0-9a-f]{64}$/.test(msg.key)) { say('That is not a pairing code.'); return; }
    peerKey = msg.key;
    if (msg.sdp.type === 'offer') {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.ondatachannel = (e) => wire(e.channel);
      await pc.setRemoteDescription(msg.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      $('dev-mine').value = await gathered();
      say('Copy this code back to the first device.');
    } else if (pc) {
      await pc.setRemoteDescription(msg.sdp);
      say('Connecting…');
    }
  });

  return { syncNow, state: () => ({ roster, ...st }) };
}
