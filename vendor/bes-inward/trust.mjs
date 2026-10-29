// ════════════════════════════════════════════════════════════════
// trust.mjs — the three-part identity, and how a verdict is enforced. Pure, total, deterministic, gated.
// (The estate's extension of BES, built on Gary W. Floyd's rule — Lumiea Systems Research Division — ThunderStruck
// Service LLC, "GEP-Based Security: Behavioral Entropy Signatures," 2025, §3: "Credential validity does not
// override entropy violation.")
//
//   Simon's action = credential ∧ Simon's baseline
//   Kar's action   = credential ∧ Kar's baseline ∧ inside a signed envelope
//   mixed signals  = step-up or block: Kar inside its envelope but NOT behaving like Kar is stepped up to Simon —
//                    delegated power needs clean behaviour; Kar outside its envelope is BLOCKED, whatever its baseline
//
// ENFORCEMENT (Simon's safety rules, not Gary's): a baseline still forming enforces NOTHING (observe-only); the
// verdict tiers are switched on one at a time, THROTTLE first; a verdict above every tier switched on so far is
// enforced as the highest one that is on ("fail toward step-up, not silent block") and is always raised as an alert,
// so a strong verdict is never silent. An envelope or credential refusal is authorisation, not entropy: it is
// enforced as BLOCK at once, in every mode. Anything unreadable reads STEP_UP.
// ════════════════════════════════════════════════════════════════
import { VERDICTS, rank, worst } from './gep.mjs';

export const TIERS = Object.freeze(['THROTTLE', 'STEP_UP', 'BLOCK', 'ISOLATE']);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The tiers that are really on: the longest prefix of TIERS the config switches on (one at a time, in order). */
export function tiersOn(on) {
  const set = Array.isArray(on) ? on : [];
  const out = [];
  for (const t of TIERS) { if (!set.includes(t)) break; out.push(t); }
  return out;
}

/** A raw verdict, enforced under the tiers switched on: the highest tier on that is not above it, else ALLOW. */
export function enforce(raw, on) {
  const r = rank(raw) < 0 ? rank('STEP_UP') : rank(raw);
  let out = 'ALLOW';
  for (const t of tiersOn(on)) if (rank(t) <= r) out = t;
  return out;
}

/**
 * The trust verdict for one action.
 * input = { actor: 'simon'|'kar', credential: true|false, bes: { raw, observing }, envelope: { ok, stage, why }|null,
 *           tiers: [...switched-on tiers] }
 * → { raw, enforced, alert, layer, why }   layer = which part decided: credential | envelope | behaviour
 */
export function trust(input) {
  try {
    const o = isObj(input) ? input : {};
    if (o.credential !== true) return { raw: 'BLOCK', enforced: 'BLOCK', alert: true, layer: 'credential', why: 'the credential was refused at the door' };
    if (o.actor !== 'simon' && o.actor !== 'kar') return { raw: 'BLOCK', enforced: 'BLOCK', alert: true, layer: 'credential', why: 'no known identity holds this key' };
    if (o.actor === 'kar') {
      if (!isObj(o.envelope)) return { raw: 'BLOCK', enforced: 'BLOCK', alert: true, layer: 'envelope', why: 'the agent acts only inside an envelope the owner signed' };
      if (o.envelope.ok !== true) return { raw: 'BLOCK', enforced: 'BLOCK', alert: true, layer: 'envelope', why: 'outside the envelope (' + String(o.envelope.stage) + '): ' + String(o.envelope.why) };
    }
    const b = isObj(o.bes) ? o.bes : {};
    let raw = VERDICTS.includes(b.raw) ? b.raw : 'STEP_UP';
    let why = VERDICTS.includes(b.raw) ? 'behaviour: ' + raw : 'the behaviour verdict is unreadable — step-up';
    if (o.actor === 'kar' && rank(raw) >= 1) { const up = worst(raw, 'STEP_UP'); if (up !== raw) why = 'mixed: inside its envelope but not behaving like itself — the owner re-confirms'; raw = up; }
    const enforced = b.observing === true ? 'ALLOW' : enforce(raw, o.tiers);
    return { raw, enforced, alert: rank(raw) >= 2 && rank(enforced) < rank(raw), layer: 'behaviour', why };
  } catch { return { raw: 'STEP_UP', enforced: 'STEP_UP', alert: true, layer: 'behaviour', why: 'trust failed — fails toward step-up' }; }
}
