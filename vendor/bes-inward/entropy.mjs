// ════════════════════════════════════════════════════════════════
// entropy.mjs — the three entropy domains of a Behavioral Entropy Signature, measured on a rolling window of actions.
// Pure, total, deterministic, gated.
//
// Method: Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "GEP-Based Security:
// Behavioral Entropy Signatures for Cybersecurity and DevOps," 2025 (CC BY 4.0), §2.2. Every action is evaluated
// across three domains, and the unified state is S = w_n·H_net + w_b·H_beh + w_a·H_auth, in nats.
//
//   H_net  (his: source/geo distributions and transitions, connection timing and inter-arrival distributions,
//          port/protocol variance, bandwidth burst)       → here: gap (inter-arrival), burst (actions in the last
//                                                            minute), src (the client surface / component it came from)
//   H_beh  (his: command structure and token ordering, process-tree evolution, file-system locality, session
//          durations, diurnal/weekly/seasonal rhythm)     → here: kind, step (previous kind → kind), loc (the project or
//                                                            organ touched), size, hour (3-hour band), day (weekday or
//                                                            weekend), sess (time into the session)
//   H_auth (his: privilege-elevation timing, token issue/refresh cadence, permission-boundary transitions, MFA device
//          use)                                           → here: tier (permission mode / model tier), shift (previous
//                                                            tier → tier), priv (privilege class), elev (time since the
//                                                            last elevated action)
//
// WHERE THE PAPER IS SILENT AND THIS BUILD CHOSE (not Gary's): the concrete symbols above (geo/IP, ports and MFA
// devices are not observable on a single local machine, so the nearest local signals stand in, named honestly);
// a domain's entropy is the MEAN of its features' plug-in Shannon entropies; the weights are equal (1/3 each); the
// distance to the baseline is the Kullback–Leibler divergence D_KL(O‖B) with additive smoothing of B (Gary's
// alignment paper names D_KL; the smoothing is ours). Every categorical string an action carries is prefixed with its
// feature letter, so no symbol can ever be an Object.prototype key.
// ════════════════════════════════════════════════════════════════

export const DOMAINS = Object.freeze({
  net: Object.freeze(['gap', 'burst', 'src']),
  beh: Object.freeze(['kind', 'step', 'loc', 'size', 'hour', 'day', 'sess']),
  auth: Object.freeze(['tier', 'shift', 'priv', 'elev']),
});
export const DOMAIN_NAMES = Object.freeze(['net', 'beh', 'auth']);
export const FEATURES = Object.freeze([...DOMAINS.net, ...DOMAINS.beh, ...DOMAINS.auth]);
export const WEIGHTS = Object.freeze({ net: 1 / 3, beh: 1 / 3, auth: 1 / 3 });
export const SESSION_GAP = 30 * 60 * 1000;      // a gap longer than 30 minutes starts a new session
export const BURST_SPAN = 60 * 1000;            // burst = how many actions came in the minute before this one
export const ELEVATED = Object.freeze(['outward', 'elevated']);
const MAX_TAG = 48, MAX_RECENT = 64;
// time buckets stop growing: a quiet spell longer than about a day (gap, elevation) or a session past ~17 hours reads as
// one "long" symbol, so a longer pause than ever seen never mints a brand-new symbol of its own
export const CAP = Object.freeze({ gap: 17, sess: 10, elev: 11 });
const capped = (b, c) => (b < c ? String(b) : c + '+');

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const tag = (p, s) => p + ':' + (typeof s === 'string' && s.length ? s.slice(0, MAX_TAG) : '?');

/** floor(log2(x)) + 1 for a whole x ≥ 1, 0 for x ≤ 0, capped at 40 — the size of a number, in bits. */
export function bucket(x) {
  if (!(x >= 1)) return 0;
  let b = 0, v = Math.floor(x);
  while (v >= 1 && b < 40) { v = Math.floor(v / 2); b++; }
  return b;
}

/** A normalised action, or null when it has no usable time. Strings are cut to 48 characters; size is a whole number. */
export function actionOf(e) {
  try {
    if (!isObj(e) || !Number.isSafeInteger(e.t)) return null;
    const size = Number.isSafeInteger(e.size) && e.size > 0 ? e.size : 0;
    return { t: e.t, src: tag('s', e.src), kind: tag('k', e.kind), loc: tag('l', e.loc), size, tier: tag('t', e.tier), priv: tag('p', e.priv) };
  } catch { return null; }
}

/** A fresh symbol context: what the previous actions leave behind for the next one. */
export const emptyCtx = () => ({ prevT: null, prevKind: null, prevTier: null, lastElev: null, sessStart: null, recent: [] });

/**
 * The symbols one action contributes to each feature, and the context it leaves.
 * Total: a malformed ctx is a fresh one; a malformed action gives null.
 */
export function symbolsOf(event, ctx) {
  try {
  const a = actionOf(event);
  if (a === null) return null;
  const c = isObj(ctx) && Array.isArray(ctx.recent) ? ctx : emptyCtx();
  const t = a.t, prevT = Number.isSafeInteger(c.prevT) ? c.prevT : null;
  const gapMs = prevT === null ? 0 : t - prevT;
  const newSession = prevT === null || gapMs > SESSION_GAP || !Number.isSafeInteger(c.sessStart);
  const sessStart = newSession ? t : c.sessStart;
  const recent = c.recent.filter((x) => Number.isSafeInteger(x) && x <= t && t - x < BURST_SPAN);
  const lastElev = Number.isSafeInteger(c.lastElev) ? c.lastElev : null;
  const elevated = ELEVATED.some((p) => a.priv === 'p:' + p);
  const d = new Date(t);
  const wd = d.getUTCDay();
  const sym = {
    gap: prevT === null ? 'g:first' : 'g:' + capped(bucket(Math.floor(gapMs / 1000)), CAP.gap),
    burst: 'b:' + bucket(recent.length),
    src: a.src,
    kind: a.kind,
    step: (typeof c.prevKind === 'string' ? c.prevKind : 'k:^') + '>' + a.kind,
    loc: a.loc,
    size: 'z:' + bucket(a.size),
    hour: 'h:' + Math.floor(d.getUTCHours() / 3),
    day: wd === 0 || wd === 6 ? 'd:we' : 'd:wd',
    sess: 'm:' + capped(bucket(Math.floor((t - sessStart) / 60000)), CAP.sess),
    tier: a.tier,
    shift: (typeof c.prevTier === 'string' ? c.prevTier : 't:^') + '>' + a.tier,
    priv: a.priv,
    elev: (elevated ? 'E:' : 'n:') + (lastElev === null ? 'never' : capped(bucket(Math.floor((t - lastElev) / 60000)), CAP.elev)),
  };
  const next = { prevT: t, prevKind: a.kind, prevTier: a.tier, lastElev: elevated ? t : lastElev, sessStart, recent: recent.concat([t]).slice(-MAX_RECENT) };
  return { sym, ctx: next };
  } catch { return null; }
}

/** Per-feature symbol counts over a window (a list of symbol maps). */
export function countsOf(window) {
  try {
  const out = {};
  for (const f of FEATURES) out[f] = {};
  const list = Array.isArray(window) ? window : [];
  let n = 0;
  for (const s of list) {
    if (!isObj(s)) continue;
    n++;
    for (const f of FEATURES) {
      const k = typeof s[f] === 'string' ? s[f] : '?:?';
      out[f][k] = (out[f][k] || 0) + 1;
    }
  }
  return { n, counts: out };
  } catch { return { n: 0, counts: Object.fromEntries(FEATURES.map((f) => [f, {}])) }; }
}

/** Plug-in Shannon entropy, in nats, of a count table. 0 for an empty table. */
export function entropy(table) {
  try {
  if (!isObj(table)) return 0;
  const vals = Object.values(table).filter((c) => Number.isFinite(c) && c > 0);
  const n = vals.reduce((s, c) => s + c, 0);
  let h = 0;
  for (const c of vals) { const p = c / n; h -= p * Math.log(p); }
  return h;
  } catch { return 0; }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Domain means and Gary's unified S from per-feature entropies. */
export function combine(Hf) {
  const h = isObj(Hf) ? Hf : {};
  const H = {};
  for (const d of DOMAIN_NAMES) H[d] = mean(DOMAINS[d].map((f) => (Number.isFinite(h[f]) ? h[f] : 0)));
  return { H, S: WEIGHTS.net * H.net + WEIGHTS.beh * H.beh + WEIGHTS.auth * H.auth };
}

/** The window's entropy state: H per feature, per domain (mean of its features), and Gary's unified S (nats). */
export function stateOf(counted) {
  let c;
  try { c = isObj(counted) && isObj(counted.counts) ? counted.counts : countsOf([]).counts; } catch { c = countsOf([]).counts; }
  const Hf = {};
  for (const f of FEATURES) Hf[f] = entropy(c[f]);
  return { Hf, ...combine(Hf) };
}

/** A count table as probabilities. */
export function normalise(table) {
  const out = {};
  try {
  if (!isObj(table)) return out;
  const n = Object.values(table).reduce((s, c) => s + (Number.isFinite(c) && c > 0 ? c : 0), 0);
  if (n <= 0) return out;
  for (const [k, c] of Object.entries(table)) if (Number.isFinite(c) && c > 0) out[k] = c / n;
  return out;
  } catch { return {}; }
}

/**
 * D_KL(O ‖ B) in nats for one feature: O = the window's counts, B = the baseline's probabilities, smoothed as
 * B'(x) = (B(x) + λ/V) / (1 + λ), V = |support(O) ∪ support(B)| + 1 (the +1 holds room for the never-seen).
 */
export function klFeature(table, base, lambda, baseSize) {
  try {
  const O = normalise(table);
  const keys = Object.keys(O);
  if (keys.length === 0) return 0;
  const B = isObj(base) ? base : {};
  const lam = Number.isFinite(lambda) && lambda > 0 ? lambda : 0.5;
  const nB = Number.isSafeInteger(baseSize) && baseSize >= 0 ? baseSize : Object.keys(B).filter((k) => Number.isFinite(B[k]) && B[k] > 0).length;
  const V = nB + keys.filter((k) => !(Number.isFinite(B[k]) && B[k] > 0)).length + 1;
  let kl = 0;
  for (const k of keys) {
    const b = Number.isFinite(B[k]) && B[k] > 0 ? B[k] : 0;
    kl += O[k] * Math.log(O[k] / ((b + lam / V) / (1 + lam)));
  }
  return kl;
  } catch { return NaN; }   // an unreadable baseline is never read as aligned: NaN makes the decision step up
}

/** D_KL per domain (mean of its features) and the weighted total, of a window against a baseline distribution. */
export function klOf(counted, baseDist, lambda, sizes) {
  try {
  const c = isObj(counted) && isObj(counted.counts) ? counted.counts : countsOf([]).counts;
  const b = isObj(baseDist) ? baseDist : {};
  const z = isObj(sizes) ? sizes : {};
  const F = {};
  for (const f of FEATURES) F[f] = klFeature(c[f], b[f], lambda, z[f]);
  const D = {};
  for (const d of DOMAIN_NAMES) D[d] = mean(DOMAINS[d].map((f) => F[f]));
  return { F, D, total: WEIGHTS.net * D.net + WEIGHTS.beh * D.beh + WEIGHTS.auth * D.auth };
  } catch { return { F: {}, D: { net: NaN, beh: NaN, auth: NaN }, total: NaN }; }
}
