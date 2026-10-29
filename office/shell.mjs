// office/shell.mjs — the office in a tab: the glue between the page and the gated kernels. It decides nothing itself:
// the runtime (src/runtime.mjs), the seed (src/germinate.mjs), each block's frame (src/compose.mjs), where a block's
// data lives (src/office.mjs, src/store.mjs), Kar (src/kar.mjs) and every receipt (src/receipt.mjs) are kernels.
import { tierOf } from '../src/runtime.mjs';
import { germinate } from '../src/germinate.mjs';
import { composeDoc } from '../src/compose.mjs';
import { tag } from '../src/value.mjs';
import { emptyStore, write, digest } from '../src/store.mjs';
import { writesFor, seedOf } from '../src/office.mjs';
import { parse, answer } from '../src/kar.mjs';
import { receipt } from '../src/receipt.mjs';
import { installEdges, parserDoc } from './edges.mjs';
import { installKeep, regrowFrom, besWatch } from './keep.mjs';
import { installDevices } from './devices.mjs';
import { makeIdentity, unhex } from '../vendor/fall-kit-core/identity.mjs';

const $ = (id) => document.getElementById(id);
const now = () => new Date().toISOString().slice(0, 19) + 'Z';
const dec = new TextDecoder();

// What the measurements read (claims L1b, L6c): a plain record of what happened, nothing to act on.
const trace = { events: [], loaded: {}, exceptions: {}, bridged: {}, planted: null };
window.__office = trace;
const note = (e) => { trace.events.push({ at: performance.now(), ...e }); };

// ── the office's own store on this device (IndexedDB, this origin only) ──
function db() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open('seed-office', 1);
    r.onupgradeneeded = () => { for (const s of ['files', 'state']) r.result.createObjectStore(s); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((ok, bad) => {
    const tx = d.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => ok(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => bad(tx.error);
  });
}
const getState = (k) => idb('state', 'readonly', (s) => s.get(k));
const putState = (k, v) => idb('state', 'readwrite', (s) => s.put(v, k));

let office = null;   // { manifest, owner, files: Map(path → bytes) }
let edges = null, keep = null, devices = null, bes = null, me = null;
const hexOf = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
let store = emptyStore();
let persistTimer = null;
const persist = () => { clearTimeout(persistTimer); persistTimer = setTimeout(() => putState('store', store), 300); };

const ACTION = { opened: 'open', saved: 'edit', asked: 'ask', imported: 'import', exported: 'export', 'backed-up': 'backup' };
let syncTimer = null;
function addReceipt(kind, facts) {
  const r = receipt(kind, facts, now());
  if (!r) return null;
  if (bes && Object.prototype.hasOwnProperty.call(ACTION, kind)) { bes.see({ do: ACTION[kind], block: facts.block }); putState('bes', bes.state()); }
  if (devices && kind !== 'synced') { clearTimeout(syncTimer); syncTimer = setTimeout(() => devices.syncNow(), 1000); }
  const w = write(store, office.owner.install, 'kar/receipts/' + String(Date.now()).padStart(15, '0') + '-' + Math.random().toString(16).slice(2, 8), ['s', JSON.stringify(r)]);
  if (w.ok) { store = w.store; persist(); }
  showReceipt(r);
  return r;
}
function receiptsOf() {
  return Object.keys(store.keys).filter((k) => k.startsWith('kar/receipts/')).sort().map((k) => { try { return JSON.parse(store.keys[k][0].v[1]); } catch { return null; } }).filter(Boolean);
}

// ── runtime ──
async function probeTab() {
  const S = crypto.subtle, enc = new TextEncoder();
  const attempt = async (fn) => { try { return (await fn()) === true; } catch { return false; } };
  const found = {
    ed25519: await attempt(async () => { const k = await S.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); return S.verify('Ed25519', k.publicKey, await S.sign('Ed25519', k.privateKey, enc.encode('p')), enc.encode('p')); }),
    sha256: await attempt(async () => new Uint8Array(await S.digest('SHA-256', enc.encode('abc')))[0] === 0xba),
    aesgcm: await attempt(async () => { const k = await S.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); const iv = new Uint8Array(12); return dec.decode(await S.decrypt({ name: 'AES-GCM', iv }, k, await S.encrypt({ name: 'AES-GCM', iv }, k, enc.encode('p')))) === 'p'; }),
    pbkdf2: await attempt(async () => (await S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 1000 }, await S.importKey('raw', enc.encode('probe phrase'), 'PBKDF2', false, ['deriveBits']), 256)).byteLength === 32),
    storage: await attempt(async () => { await putState('probe', 1); return (await getState('probe')) === 1; }),
    sandbox: typeof Worker === 'function',
    inflate: typeof DecompressionStream === 'function',
    webrtc: typeof RTCPeerConnection === 'function',
    webgpu: Boolean(navigator.gpu),
    serviceworker: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    localModel: false,
  };
  return tierOf(found);
}

// ── the service worker: the office stays on this device, and every block frame is served sandboxed ──
async function serviceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  await navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise((ok) => { navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }); setTimeout(ok, 3000); });
  return Boolean(navigator.serviceWorker.controller);
}

// ── planting ──
async function plantWith(seed, vaultBytes) {
  const says = $('plant-says');
  const p = $('phrase').value, p2 = $('phrase2').value;
  if (p !== p2) { says.textContent = 'The two phrases are not the same.'; return; }
  says.textContent = 'Checking the seed…';
  const t0 = performance.now();
  const pinned = (await (await fetch('../seeds/publisher.json')).json()).pinned;
  const r = await germinate(seed, { pinned, phrase: p, at: now() });
  if (!r.ok) { says.textContent = 'Refused at the ' + r.stage + ' check: ' + r.why; note({ t: 'refused', stage: r.stage }); return; }
  await idb('files', 'readwrite', (s) => { for (const f of r.files) s.put(f.bytes, f.path); });
  // this device's own key, made at random, never from the phrase: a device regrown from the same phrase must never
  // reuse the counters of the one it replaces (src/store.mjs: two writes with one dot would be one). Its id writes.
  const deviceSeed = crypto.getRandomValues(new Uint8Array(32));
  me = await makeIdentity(deviceSeed);
  await putState('device', hexOf(deviceSeed));
  const owner = { founder: r.owner.id, device: r.owner.device, install: me.id };
  let restored = null;
  if (vaultBytes) {
    const g = await regrowFrom(r, vaultBytes, p);
    if (!g.ok) { says.textContent = 'The vault was not opened: ' + g.why + '.'; note({ t: 'regrow-refused' }); return; }
    restored = g.store;
  }
  await putState('office', { manifest: r.office, digest: r.digest, owner, genome: r.genome });
  office = { manifest: r.office, digest: r.digest, owner, files: new Map(r.files.map((f) => [f.path, f.bytes])) };
  store = restored || emptyStore();
  const w = write(store, owner.install, 'kar/receipts/' + String(Date.now()).padStart(15, '0') + '-grew', ['s', JSON.stringify(r.receipts[0])]);
  store = w.store;
  await putState('store', store);
  if (restored) { office = { manifest: r.office, digest: r.digest, owner, files: new Map(r.files.map((f) => [f.path, f.bytes])) }; addReceipt('regrown', { keys: Object.keys(restored.keys).length, owner: owner.founder }); }
  trace.planted = { ms: Math.round(performance.now() - t0), digest: r.digest, checked: r.checked, blocks: r.office.blocks.map((b) => b.id), owner: owner.founder };
  note({ t: 'planted', ...trace.planted });
  $('phrase').value = ''; $('phrase2').value = '';
  openOffice();
}

// ── the office ──
const frames = new Map();   // block id → iframe
const pending = new Map();  // block id → changes since the last 'saved' receipt
const timers = new Map();

function blocksOf() { return office.manifest.blocks.map((b) => ({ id: b.id, name: b.name })); }

function openOffice() {
  $('plant').hidden = true;
  $('office').hidden = false;
  $('who').textContent = 'You are ' + office.owner.founder.slice(0, 8);
  const rail = $('rail');
  rail.replaceChildren();
  const item = (id, label) => { const b = document.createElement('button'); b.textContent = label; b.dataset.id = id; b.addEventListener('click', () => show(id)); rail.append(b); };
  item('kar', 'Kar');
  for (const b of office.manifest.blocks) item(b.id, b.name);
  item('files', 'Files in');
  item('write', 'Write out');
  item('backup', 'Your vault');
  item('devices', 'Your devices');
  item('receipts', 'Receipts');
  if (!edges) edges = installEdges({
    store: () => store,
    write: (key, value) => { const w = write(store, office.owner.install, key, value); if (w.ok) { store = w.store; persist(); } return w; },
    receipt: (kind, facts) => addReceipt(kind, facts),
    owner: office.owner, blocks: office.manifest.blocks, genome: office.manifest.genome, frames, note,
  });
  edges.render();
  if (!keep) keep = installKeep({ store: () => store, setStore: (x) => { store = x; persist(); }, digest: office.digest, owner: office.owner, blocks: office.manifest.blocks, receipt: (k, f) => addReceipt(k, f) });
  if (!bes) getState('bes').then((saved) => { bes = besWatch(office.owner.founder, saved); $('bes-says').textContent = bes.says(); });
  if (!devices) Promise.all([getState('device'), getState('sync')]).then(async ([seedHex, saved]) => {
    if (!me && seedHex) me = await makeIdentity(unhex(seedHex));
    if (!me) return;
    devices = installDevices({ me, name: 'this device', owner: office.owner, store: () => store, setStore: (x) => { store = x; persist(); }, receipt: (k, f) => addReceipt(k, f), saved: saved || {}, save: (x) => putState('sync', x) });
  });
  $('said').replaceChildren();
  for (const r of receiptsOf()) showReceipt(r);
  show('kar');
  note({ t: 'kar-open', receipts: receiptsOf().length });
}

function show(id) {
  for (const b of $('rail').children) b.setAttribute('aria-current', b.dataset.id === id ? 'page' : 'false');
  const PANELS = ['kar', 'files', 'write', 'backup', 'devices', 'receipts'];
  for (const panel of PANELS) $(panel).hidden = id !== panel;
  for (const [bid, f] of frames) f.hidden = bid !== id;
  if (id === 'receipts') renderReceipts();
  if (id === 'files') edges.render();
  if (id === 'backup' && bes) $('bes-says').textContent = bes.says();
  if (!PANELS.includes(id)) openBlock(id);
}

function openBlock(id) {
  const b = office.manifest.blocks.find((x) => x.id === id);
  if (!b) return;
  if (!frames.has(id)) {
    const f = document.createElement('iframe');
    f.title = b.name;
    f.src = 'frame.html?b=' + encodeURIComponent(id);
    $('frames').append(f);
    frames.set(id, f);
    note({ t: 'open', block: id });
  }
  addReceipt('opened', { block: b.name });   // every time the owner opens a block, not only the first
  for (const [bid, f] of frames) f.hidden = bid !== id;
}

function docFor(id) {
  const b = office.manifest.blocks.find((x) => x.id === id);
  const text = (path) => dec.decode(office.files.get('blocks/' + id + '/' + path));
  const modules = b.files.filter((f) => f.path !== b.entry && /\.m?js$/.test(f.path)).map((f) => ({ path: f.path, text: text(f.path) }));
  return composeDoc(text(b.entry), { seed: seedOf(store, id), modules });
}

const blockOf = (source) => { for (const [id, f] of frames) if (f.contentWindow === source) return id; return null; };

addEventListener('message', async (e) => {
  const id = blockOf(e.source);
  if (!id || !e.data || typeof e.data !== 'object') return;
  const m = e.data;
  if (m.t === 'host') {
    if (e.origin !== 'null') { note({ t: 'unsandboxed', block: id }); return; }   // a block runs only in a sandbox
    if (id === '__parser') { e.source.postMessage({ t: 'doc', html: await parserDoc() }, '*'); return; }
    const d = docFor(id);
    if (d.ok) e.source.postMessage({ t: 'doc', html: d.html }, '*');
    return;
  }
  if (m.t === 'loaded') { trace.loaded[id] = performance.now(); note({ t: 'loaded', block: id }); return; }
  if (m.t === 'exc') { (trace.exceptions[id] = trace.exceptions[id] || []).push(String(m.m)); return; }
  if (m.t === 'ls' || m.t === 'idb') {
    const pair = m.t === 'idb' && (m.op === 'put' || m.op === 'del') ? await tag([m.key, m.op === 'put' ? m.value : null]) : { ok: true, t: ['a', [null, null]] };
    if (!pair.ok) { note({ t: 'unstorable', block: id, why: pair.why }); return; }
    for (const x of writesFor(store, id, m, pair.t[1])) {
      const w = write(store, office.owner.install, x.key, x.value);
      if (w.ok) store = w.store;
    }
    trace.bridged[id] = (trace.bridged[id] || 0) + 1;
    pending.set(id, (pending.get(id) || 0) + 1);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => { const n = pending.get(id) || 0; pending.set(id, 0); if (n) addReceipt('saved', { block: office.manifest.blocks.find((x) => x.id === id).name, changes: n }); }, 1000));
    persist();
  }
});

// ── Kar ──
function showReceipt(r) {
  const li = document.createElement('li');
  li.textContent = r.says;
  li.className = 'r-' + r.kind;
  $('said').append(li);
  li.scrollIntoView({ block: 'nearest' });
}
function renderReceipts() {
  const ol = $('receipt-list');
  ol.replaceChildren(...receiptsOf().reverse().map((r) => { const li = document.createElement('li'); const t = document.createElement('time'); t.textContent = r.at.replace('T', ' ').replace('Z', ''); li.append(t, ' ', r.says); return li; }));
}
$('ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('ask-text').value.trim();
  if (!text) return;
  $('ask-text').value = '';
  const p = parse(text, blocksOf());
  const a = p.intent ? answer(p.intent, p.arg, { blocks: blocksOf(), store, receipts: receiptsOf() }) : { says: 'I did not understand: ' + p.why + '.' };
  addReceipt('asked', { asked: text.slice(0, 400), said: a.says.slice(0, 600) });
  if (a.open) show(a.open);
});

// ── boot ──
(async function boot() {
  const sw = await serviceWorker();
  const rt = await probeTab();
  $('runtime').textContent = rt.says;
  $('net').textContent = sw ? 'offline-ready · no network for blocks' : 'online only';
  const saved = await getState('office');
  if (saved) {
    const files = new Map();
    await idb('files', 'readonly', (s) => { const r = s.getAllKeys(); r.onsuccess = () => { const keys = r.result; const v = s.getAll(); v.onsuccess = () => keys.forEach((k, i) => files.set(k, v.result[i])); }; return null; });
    office = { manifest: saved.manifest, digest: saved.digest, owner: saved.owner, files };
    store = (await getState('store')) || emptyStore();
    const seedHex = await getState('device');
    if (seedHex) me = await makeIdentity(unhex(seedHex));
    openOffice();
  } else {
    $('plant').hidden = false;
  }
  const seedFile = $('seed-file');
  seedFile.addEventListener('change', async () => { const f = seedFile.files[0]; if (f) await plantWith({ full: new Uint8Array(await f.arrayBuffer()) }); });
  $('plant-stock').addEventListener('click', async () => plantWith({ full: new Uint8Array(await (await fetch('../seeds/stock.full')).arrayBuffer()) }));
  $('vault-file').addEventListener('change', async () => { const f = $('vault-file').files[0]; if (f) await plantWith({ full: new Uint8Array(await (await fetch('../seeds/stock.full')).arrayBuffer()) }, new Uint8Array(await f.arrayBuffer())); });
  $('plant-light').addEventListener('click', async () => plantWith({ genome: await (await fetch('../seeds/stock.genome.json')).text(), fetch: async (sha) => { const r = await fetch('../mirror/' + sha); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } }));
  trace.ready = { sw, tier: rt.tier, at: performance.now() };
  note({ t: 'ready', sw, tier: rt.tier });
  window.__digest = () => digest(store);
  window.__office_store = () => store;   // read-only, for the measurements (claim L6c counts receipts)
})();
