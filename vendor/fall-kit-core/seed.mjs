// ════════════════════════════════════════════════════════════════
// core/seed.mjs — the seed: a client's own organism, grown from the shared foundation. Organ 15 of the shared foundation
// (Phase 7: claims B1–B3 and P1 in core/phase7/claims.json).
//
// A seed is a phrase only its owner holds and the organs they want. Every key of the organism is worked out from the
// phrase, so the same phrase grows the same organism on any machine (in Node or in a browser tab), and nothing of anyone
// else's is in it: its founder signs its own roster, and its own genesis names its own founder as the one who may switch
// its books and its own organs as the ones who may measure. A client who chooses to couple to a larger mesh plants on a
// genesis that mesh and the client name together; nothing else changes.
//
//   plan(phrase, organs)          → { ok, roles, seeds: { role: 32 bytes } } | refusal: the founder and each organ's key
//                                   seed, sha256('fall-kit.seed.v1', role, phrase); a phrase too short, an organ named
//                                   badly or twice, or an organ called founder, is refused by name
//   plant(phrase, organs, opts)   → { ok, roles, ids: { role: identity }, genesis, coupled } | refusal: the identities,
//                                   and the genesis: opts.genesis when the client couples, else the organism's own,
//                                   signed by its founder with opts.policy
//   rosterOf(plant, cards)        → the founder's signed roster of these cards (core/roster.mjs makeRoster)
//
// plan is pure and total; plant and rosterOf are glue over identity.mjs, the ledger and roster.mjs.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { sha256 } from './vendor/light/sha256.mjs';
import * as L from './vendor/ledger/contrib.mjs';
import { makeIdentity } from './identity.mjs';
import { makeRoster } from './roster.mjs';

export const SEED = 'fall-kit.seed.v1';
export const FOUNDER = 'founder';
export const MIN_PHRASE = 16, MAX_PHRASE = 512, MAX_ORGANS = 16;
const ROLE = /^[a-z][a-z0-9-]{0,23}$/;
const no = (why) => ({ ok: false, why });
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function plan(phrase, organs) {
  if (typeof phrase !== 'string') return no('a seed phrase is text');
  if (phrase.trim().length < MIN_PHRASE) return no('a seed phrase is at least ' + MIN_PHRASE + ' characters, not counting the spaces at its ends');
  if (phrase.length > MAX_PHRASE) return no('a seed phrase is at most ' + MAX_PHRASE + ' characters');
  if (!Array.isArray(organs) || organs.length < 1 || organs.length > MAX_ORGANS) return no('a seed grows one to ' + MAX_ORGANS + ' organs');
  for (const o of organs) {
    if (typeof o !== 'string' || !ROLE.test(o)) return no('an organ is named in lowercase letters, digits and dashes, starting with a letter, up to 24 long');
    if (o === FOUNDER) return no('founder is the seed\'s own key, not an organ');
  }
  if (new Set(organs).size !== organs.length) return no('an organ is named once');
  const roles = [FOUNDER, ...organs], seeds = {};
  for (const r of roles) seeds[r] = sha256(new TextEncoder().encode(SEED + '\n' + r + '\n' + phrase));
  return { ok: true, roles, seeds };
}

export async function plant(phrase, organs, opts) {
  const p = plan(phrase, organs);
  if (!p.ok) return p;
  const o = isObj(opts) ? opts : {};
  const ids = {};
  for (const r of p.roles) ids[r] = await makeIdentity(p.seeds[r]);
  if (o.genesis !== undefined) {
    if (!isObj(o.genesis) || o.genesis.type !== 'genesis') return no('a coupled seed is planted on a genesis entry');
    return { ok: true, roles: p.roles, ids, genesis: o.genesis, coupled: true };
  }
  const g = await L.sign(ids[FOUNDER].ledgerKeys, { type: 'genesis', activators: [ids[FOUNDER].id], measurers: organs.map((r) => ids[r].id), policy: o.policy });
  if (!g.ok) return no('the organism\'s genesis could not be signed: ' + g.why);
  const shape = await L.record(L.empty(), g.entry, {});
  if (!shape.ok) return no('the organism\'s genesis is not one a ledger records: ' + shape.why);
  return { ok: true, roles: p.roles, ids, genesis: g.entry, coupled: false };
}

export async function rosterOf(planted, cards) {
  if (!isObj(planted) || planted.ok !== true || !isObj(planted.ids) || !planted.ids[FOUNDER]) return no('a roster is signed by a planted seed\'s founder');
  return makeRoster(planted.ids[FOUNDER], cards);
}
