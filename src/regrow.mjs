// ════════════════════════════════════════════════════════════════
// src/regrow.mjs — wipe the machine, plant the seed again, open the vault: the office comes back. Organ 5 of the seed
// laptop (claim L4).
//
//   entriesOf(store, office)      → [{ path, bytes }] what the vault keeps: store.json (the store's one canonical form)
//                                   and office.json ({ digest, founder }: which office, whose); null if not a store
//   restore(entries, planted, opts?) → { ok, store, bytes, from?, orphaned? } | { ok: false, why }
//       entries = what src/vault.mjs open() returned; planted = what src/germinate.mjs grew from the seed and the phrase
//       ({ digest, owner: { id }, blocks?: [block id] }). Restored only if the vault is this office's (the same seed: its
//       digest) and this owner's (the same phrase: its founder), and its store is a store. bytes = the store's canonical
//       bytes, to compare with the ones backed up.
//       opts.upgrade: the owner brings their office across into one grown from a NEWER seed (an update): the seed may
//       differ, the owner may not. from = the earlier office's digest; orphaned = block ids the vault holds data for and
//       the new seed no longer grows (their data is kept, never dropped).
//   watchOf(owner)                → the regrown device's behavioural watch (vendor/bes-inward): a fresh one, which
//                                   enforces nothing while it forms (observe-only), so the owner is never locked out
//   eventOf(action, t)            → one office action as the watch reads it: { t, src, kind, loc, size, tier, priv }
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { canon, validStore } from './store.mjs';
import { emptyWatcher } from '../vendor/bes-inward/watch.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const no = (why) => ({ ok: false, why });
const HEX64 = /^[0-9a-f]{64}$/;

export function entriesOf(store, office) {
  const c = validStore(store) ? canon(store) : null;
  if (c === null || !office || !HEX64.test(office.digest) || !HEX64.test(office.founder)) return null;
  return [{ path: 'store.json', bytes: enc.encode(c) }, { path: 'office.json', bytes: enc.encode(canon({ digest: office.digest, founder: office.founder })) }];
}

export function restore(entries, planted, opts) {
  try {
    const get = (p) => { const e = Array.isArray(entries) ? entries.find((x) => x && x.path === p) : null; return e ? JSON.parse(dec.decode(e.bytes)) : null; };
    const office = get('office.json'), store = get('store.json');
    if (!office || !store) return no('the vault holds no office');
    const upgrade = opts !== null && typeof opts === 'object' && opts.upgrade === true;
    if (!planted || (office.digest !== planted.digest && !upgrade)) return no('the vault belongs to an office grown from another seed');
    if (!planted.owner || office.founder !== planted.owner.id) return no('the vault belongs to another owner (or the phrase is not theirs)');
    if (!validStore(store)) return no('the vault\'s store is not a store');
    const out = { ok: true, store, bytes: enc.encode(canon(store)) };
    if (office.digest === planted.digest) return out;
    const grows = new Set(Array.isArray(planted.blocks) ? planted.blocks : []);
    const held = [...new Set(Object.keys(store.keys).filter((k) => k.startsWith('b/')).map((k) => k.split('/')[1]))].sort();
    return { ...out, from: office.digest, orphaned: held.filter((id) => !grows.has(id)) };
  } catch { return no('the vault holds nothing this office can read'); }
}

export function watchOf(owner) {
  return emptyWatcher(typeof owner === 'string' ? 'owner:' + owner.slice(0, 16) : 'owner');
}

const KIND = { open: 'read', edit: 'write', import: 'import', export: 'export', ask: 'ask', backup: 'backup', send: 'send' };
export function eventOf(action, t) {
  const a = action && typeof action === 'object' ? action : {};
  return {
    t: Number.isSafeInteger(t) ? t : 0,
    src: 'owner',
    kind: Object.prototype.hasOwnProperty.call(KIND, a.do) ? KIND[a.do] : 'other',
    loc: typeof a.block === 'string' ? a.block : typeof a.format === 'string' ? a.format : 'office',
    size: Number.isSafeInteger(a.size) && a.size > 0 ? a.size : 1,
    tier: 'local',
    priv: 'p:owner',
  };
}
