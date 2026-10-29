// ════════════════════════════════════════════════════════════════
// src/receipt.mjs — every action the office takes leaves a receipt a person can read. The legibility rule of the spec;
// claim L6 counts them (receipts = actions). Pure, total, gated.
//
//   receipt(kind, facts, at) → { at, kind, says, facts } | null
//      at    = an ISO time (the caller's clock; tests pass a fixed one)
//      says  = one plain sentence built from the facts by the kind's own rule
//      null  = an unknown kind, or facts that do not fit it (a receipt is never made up from missing facts)
//   KINDS    = the kinds there are, each with the facts it needs
//
// Facts are checked by type before a sentence is made: a count is a whole number, an id is short hex, a name is
// short text. The sentence never holds a secret: no phrase, no private key, no vault key ever reaches it.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

const count = (n) => Number.isSafeInteger(n) && n >= 0;
const name = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 80;
const hexid = (s) => typeof s === 'string' && /^[0-9a-f]{8,64}$/.test(s);
const short = (s) => s.slice(0, 8);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

const RULES = {
  grew: {
    facts: { seed: name, genome: hexid, blocks: count, files: count, owner: hexid },
    says: (f) => 'Your office grew from the seed "' + f.seed + '" (' + short(f.genome) + '): ' + plural(f.blocks, 'block', 'blocks') + ', ' + plural(f.files, 'file', 'files') + ', every one checked against its pin. You are ' + short(f.owner) + '. I am Kar, your conductor: ask me about anything in your office.',
  },
  refused: {
    facts: { what: name, stage: name, why: (s) => typeof s === 'string' && s.length >= 1 && s.length <= 240 },
    says: (f) => 'I refused ' + f.what + ' at the ' + f.stage + ' check: ' + f.why,
  },
};

export const KINDS = Object.freeze(Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, Object.freeze(Object.keys(r.facts))])));

export function fits(kind, facts) {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(RULES, kind)) return false;
  try {
    return Object.entries(RULES[kind].facts).every(([k, ok]) => Object.prototype.hasOwnProperty.call(facts, k) && ok(facts[k]));
  } catch { return false; }
}

export function receipt(kind, facts, at) {
  if (!fits(kind, facts) || typeof at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/.test(at)) return null;
  const f = Object.fromEntries(Object.keys(RULES[kind].facts).map((k) => [k, facts[k]]));
  return { at, kind, says: RULES[kind].says(f), facts: f };
}
