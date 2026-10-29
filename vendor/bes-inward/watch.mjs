// ════════════════════════════════════════════════════════════════
// watch.mjs — one identity's online behavioural watch: a rolling window, a baseline that forms then adapts, the bars
// it learns from its own behaviour, and Gary's decision on every action. Pure, total, deterministic, gated.
//
// One watcher per identity, and never shared: Simon's human baseline, Kar's agent baseline (Kar's is never a copy of
// Simon's). Gary W. Floyd's alignment paper says it outright — "Agent alignment ≠ operator alignment. Track both
// separately." (Lumiea Systems Research Division — ThunderStruck Service LLC, "Bayesian Entropy Similarity (BES),"
// Technical Report, December 2025, §5.2.)
//
// From the papers (Gary's):
//   • baselines built ONLINE from rolling measurements, no training corpus, no signatures (GEP-Based Security §1–2)
//   • ~2-week baseline formation (§7.2) — this watcher is OBSERVE-ONLY until it has formed
//   • B_new = (1 − α)·B_old + α·O with α = 0.2, "typically via EMA" (alignment paper Property 3.4)
//   • "GEP-BES learns the structure of this variability rather than rejecting it" (§4.2) — so ε, k, the alignment
//     bar and β are learned from the identity's OWN formation behaviour, not fixed for everyone
//   • baseline stability bound |B(t) − B(t−Δt)| < ε: "if baseline shifts too fast, freeze updates and alert"
//     (alignment paper A.2, his proposed hardening)
//
// Chosen here (ours, where the papers are silent): the window and the EMA's cadence (once per completed block of
// accepted actions — the paper does not say how often). PARTS judged on every action: Gary's unified S and each of
// his three domains — and, with `fine`, each single feature too — each with its own bars learned from formation:
// ε = a high percentile of its own |H − H_b|, k = 1 / (that percentile − the median), the alignment bar from a high
// percentile of its own D_KL + k·ΔS (the exact quantity the alignment row compares); β from its own |∇S|; the session budget = ε of S; formed = 14 days AND 3 blocks; the
// samples are taken only once the baseline holds `burn` blocks (a one-block baseline is not yet a baseline).
// Once formed, only ALLOWed or THROTTLEd actions are learned at once. A flagged action (STEP_UP or above) waits in
// QUARANTINE: if Simon answers the step-up — it was him, or Kar doing what he asked — confirm() teaches the baseline
// that action; an action nobody vouches for is never learned, so a thief can never drift a baseline toward itself,
// and an honest change never locks the owner out. A block that moves the baseline more than mShift × the largest
// move seen in formation is held for Simon to confirm, never folded silently. After formation the bars adapt with
// damping (barAlpha per block). A BLOCK refuses its action; only an ISOLATE (Gary's critical anomaly) HOLDS the key —
// every later action from it is refused until the offline recovery key lifts it. tools/tune.mjs picks the numbers on dev data and the synthetic mirror only.
// ════════════════════════════════════════════════════════════════
import { symbolsOf, emptyCtx, countsOf, stateOf, combine, klOf, normalise, FEATURES, DOMAIN_NAMES } from './entropy.mjs';
import { decide, rank } from './gep.mjs';

export const DAY = 86400000;
export const COARSE = Object.freeze(['S', ...DOMAIN_NAMES]);
export const FINE = Object.freeze([...COARSE, ...FEATURES]);
export const PARAMS = Object.freeze({
  W: 20, minN: 5, block: 20, alpha: 0.2, lambda: 0.5, fine: 0,
  formDays: 14, formBlocks: 3, minCal: 30, burn: 2,
  qEps: 0.99, mEps: 1, qMid: 0.5, qKl: 0.99, mKl: 1, qGrad: 0.99, mGrad: 1, kA: 1, mBudget: 1,
  mShift: 1.5, barAlpha: 0.05, maxCal: 2000, maxQuar: 200, prune: 1e-4, epsFloor: 0.05, klFloor: 0.2,
  rhythmGaps: 6, qRhythm: 0.01, mRhythm: 0.5,
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pos = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Params merged over the defaults; any value that is not a positive finite number keeps its default (fine: 0 or 1). */
export function paramsOf(p) {
  const out = { ...PARAMS };
  try {
    if (isObj(p)) for (const k of Object.keys(PARAMS)) if (pos(p[k])) out[k] = p[k];
    out.fine = isObj(p) && p.fine === 1 ? 1 : 0;
  } catch { return paramsOf(null); }
  for (const k of ['W', 'minN', 'block', 'formBlocks', 'minCal', 'maxCal', 'maxQuar', 'burn', 'rhythmGaps']) out[k] = Math.max(1, Math.floor(out[k]));
  for (const k of ['qEps', 'qMid', 'qKl', 'qGrad', 'alpha', 'barAlpha']) out[k] = Math.min(1, out[k]);
  return out;
}
export const partsOf = (P) => (P.fine === 1 ? FINE : COARSE);

/**
 * The rhythm of the last n POSITIVE gaps: their mean absolute deviation over their mean (0 = clockwork). Gaps of 0 —
 * actions stamped in the same millisecond, such as several tool calls in one message — are left out. null with fewer
 * than n positive gaps. (The measure of the estate's v1 bes.mjs, as a ratio, on a short horizon so a fixed-pace
 * script shows within a few actions; a person or a working agent essentially never makes n identical gaps in a row.)
 */
export function rhythmOf(times, n) {
  const t = Array.isArray(times) ? times.filter((x) => Number.isSafeInteger(x)) : [];
  const gaps = [];
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) gaps.push(t[i] - t[i - 1]);
  const k = Number.isInteger(n) && n > 1 ? n : 6;
  if (gaps.length < k) return null;
  gaps.splice(0, gaps.length - k);
  const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  return gaps.reduce((a, g) => a + Math.abs(g - mean), 0) / gaps.length / mean;
}

/** Nearest-rank quantile of a list of numbers (0 for an empty list). */
export function quantile(xs, q) {
  const v = (Array.isArray(xs) ? xs : []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const i = Math.floor(q * v.length);
  return v[i < v.length ? i : v.length - 1];
}

/** One part's bars from its samples: { eps, k, klBar, Amin }. */
export function partBars(d, kl, P) {
  const hi = quantile(d, P.qEps);
  const eps = Math.max(hi * P.mEps, P.epsFloor);
  const spread = Math.max(hi - quantile(d, P.qMid), P.epsFloor);
  const klBar = Math.max(quantile(kl, P.qKl) * P.mKl, P.klFloor);
  return { eps, k: 1 / spread, klBar, Amin: Math.exp(-klBar) };
}

const isSample = (m) => isObj(m) && isObj(m.d) && isObj(m.kl) && Number.isFinite(m.grad);
function samplesOf(cal) { try { return isObj(cal) && Array.isArray(cal.chunks) ? cal.chunks.flat().filter(isSample) : []; } catch { return []; } }

/** The bars an identity learns from its own calibration samples, or null while there are too few. */
export function barsOf(cal, p) {
  const P = paramsOf(p);
  const xs = samplesOf(cal);
  if (xs.length < P.minCal) return null;
  const parts = {};
  const shiftTerm = (m) => (Number.isFinite(m.dS) ? P.kA * m.dS : 0);
  for (const n of partsOf(P)) parts[n] = partBars(xs.map((m) => m.d[n]), xs.map((m) => m.kl[n] + shiftTerm(m)), P);
  const gradBar = Math.max(quantile(xs.map((m) => m.grad), P.qGrad) * P.mGrad, 1e-3);
  const rh = xs.map((m) => m.rhythm).filter((r) => typeof r === 'number' && Number.isFinite(r));
  const rhythmBar = rh.length >= P.minCal ? quantile(rh, P.qRhythm) * P.mRhythm : null;
  return { parts, beta: 1 / gradBar, budget: parts.S.eps * P.mBudget, rhythmBar };
}

/** Damped bars: (1 − a)·old + a·new, number by number (each Amin re-derived from its blended klBar). */
export function blendBars(old, fresh, a) {
  if (!isObj(old) || !isObj(old.parts)) return fresh;
  if (!isObj(fresh) || !isObj(fresh.parts)) return old;
  const m = (x, y) => (1 - a) * x + a * y;
  const parts = {};
  for (const n of Object.keys(old.parts)) {
    const o = old.parts[n], f = isObj(fresh.parts[n]) ? fresh.parts[n] : o;
    const klBar = m(o.klBar, f.klBar);
    parts[n] = { eps: m(o.eps, f.eps), k: m(o.k, f.k), klBar, Amin: Math.exp(-klBar) };
  }
  const rb = typeof old.rhythmBar === 'number' && typeof fresh.rhythmBar === 'number' ? m(old.rhythmBar, fresh.rhythmBar) : typeof old.rhythmBar === 'number' ? old.rhythmBar : typeof fresh.rhythmBar === 'number' ? fresh.rhythmBar : null;
  return { parts, beta: m(old.beta, fresh.beta), budget: m(old.budget, fresh.budget), rhythmBar: rb };
}

const emptyPend = () => ({ counts: {}, n: 0, Hf: {}, samples: [] });

/** A block's per-feature probabilities. */
export function distOf(counts) {
  const out = {};
  for (const f of FEATURES) out[f] = normalise(isObj(counts) ? counts[f] : null);
  return out;
}

/** How far a block moved from the baseline: mean over features of the total-variation distance (0 … 1). */
export function shiftOf(a, b) {
  const A = isObj(a) ? a : {}, B = isObj(b) ? b : {};
  let sum = 0;
  for (const f of FEATURES) {
    const x = isObj(A[f]) ? A[f] : {}, y = isObj(B[f]) ? B[f] : {};
    let tv = 0;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) tv += Math.abs((x[k] || 0) - (y[k] || 0));
    sum += tv / 2;
  }
  return sum / FEATURES.length;
}

/** EMA of two per-feature distributions, B ← (1 − α)·B + α·O, dropping probabilities below `prune`. */
export function emaDist(base, obs, alpha, prune) {
  const out = {};
  for (const f of FEATURES) {
    const x = isObj(base) && isObj(base[f]) ? base[f] : {}, y = isObj(obs) && isObj(obs[f]) ? obs[f] : {};
    const row = {};
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const v = (1 - alpha) * (x[k] || 0) + alpha * (y[k] || 0);
      if (v >= prune) row[k] = v;
    }
    out[f] = row;
  }
  return out;
}
const emaH = (a, b, alpha) => Object.fromEntries(FEATURES.map((f) => [f, (1 - alpha) * (a[f] || 0) + alpha * (b[f] || 0)]));
const sizesOf = (dist) => Object.fromEntries(FEATURES.map((f) => [f, Object.keys(isObj(dist) && isObj(dist[f]) ? dist[f] : {}).length]));

/** A fresh watcher for one identity. */
export const emptyWatcher = (id) => ({
  v: 3, id: typeof id === 'string' ? id.slice(0, 64) : 'identity', n: 0, first: null, formed: false, formedAt: null,
  ctx: emptyCtx(), window: [], base: { dist: null, sizes: null, Hf: null, blocks: 0, shifts: [] }, pend: emptyPend(),
  cal: { chunks: [] }, prov: null, bars: null, prevS: null, prevD: null, sessD0: 0, quar: [], times: [],
  held: null, observeUntil: null, pendingShift: null,
});

function okWatcher(w) { try { return isObj(w) && isObj(w.base) && isObj(w.pend) && Array.isArray(w.pend.samples) && isObj(w.cal) && Array.isArray(w.cal.chunks) && Array.isArray(w.window) && Array.isArray(w.quar) && Array.isArray(w.times) && isObj(w.ctx); } catch { return false; } }

/** Add a block's samples to the calibration chunks; re-derive the provisional bars (forming) or damp the bars (formed). */
function calibrate(w, samples, P) {
  const cap = Math.max(1, Math.ceil(P.maxCal / P.block));
  const cal = { chunks: w.cal.chunks.concat(samples.length ? [samples] : []).slice(-cap) };
  if (!w.formed) return { ...w, cal, prov: barsOf(cal, P) };
  return { ...w, cal, bars: blendBars(w.bars, barsOf(cal, P), P.barAlpha) };
}

/** Fold one finished block into the baseline (or hold it for Simon when it moves too far). */
function foldBlock(w, P, t) {
  const blockDist = distOf(w.pend.counts);
  const n = w.pend.n;
  const meanHf = Object.fromEntries(FEATURES.map((f) => [f, (w.pend.Hf[f] || 0) / n]));
  const samples = w.pend.samples, base = w.base;
  if (base.dist === null) return calibrate({ ...w, pend: emptyPend(), base: { dist: blockDist, sizes: sizesOf(blockDist), Hf: meanHf, blocks: 1, shifts: [] } }, samples, P);
  const shift = shiftOf(blockDist, base.dist);
  const bound = Math.max(...base.shifts, 0) * P.mShift;
  if (w.formed && base.shifts.length > 0 && shift > bound) return { ...w, pend: emptyPend(), pendingShift: { dist: blockDist, Hf: meanHf, samples, shift, bound, at: t } };
  const dist = emaDist(base.dist, blockDist, P.alpha, P.prune);
  const next = { dist, sizes: sizesOf(dist), Hf: emaH(base.Hf, meanHf, P.alpha), blocks: base.blocks + 1, shifts: w.formed ? base.shifts : base.shifts.concat([shift]).slice(-50) };
  return calibrate({ ...w, pend: emptyPend(), base: next }, samples, P);
}

/** Add one action's symbols to the block being built; fold the block when it is full. */
function learnOne(w, item, P, t) {
  const pc = { ...w.pend.counts };
  for (const f of FEATURES) { const row = { ...(pc[f] || {}) }; row[item.sym[f]] = (row[item.sym[f]] || 0) + 1; pc[f] = row; }
  const Hf = Object.fromEntries(FEATURES.map((f) => [f, (w.pend.Hf[f] || 0) + (item.Hf[f] || 0)]));
  const samples = isSample(item.m) && w.base.blocks >= P.burn ? w.pend.samples.concat([item.m]) : w.pend.samples;
  const next = { ...w, pend: { counts: pc, n: w.pend.n + 1, Hf, samples } };
  return next.pend.n >= P.block ? foldBlock(next, P, t) : next;
}

/** Simon confirms a held shift: fold it into the baseline as an ordinary block. */
export function confirmShift(w, p) {
  if (!okWatcher(w) || !isObj(w.pendingShift) || w.base.dist === null) return w;
  const P = paramsOf(p), s = w.pendingShift;
  const dist = emaDist(w.base.dist, s.dist, P.alpha, P.prune);
  const base = { ...w.base, dist, sizes: sizesOf(dist), Hf: emaH(w.base.Hf, s.Hf, P.alpha), blocks: w.base.blocks + 1 };
  return calibrate({ ...w, pendingShift: null, base }, Array.isArray(s.samples) ? s.samples : [], P);
}

/** Simon answered the step-up: every action waiting in quarantine was his (or done at his word) — learn them. */
export function confirm(w, p) {
  if (!okWatcher(w)) return emptyWatcher('identity');
  if (w.quar.length === 0) return w;
  const P = paramsOf(p);
  let next = { ...w, quar: [] };
  for (const item of w.quar) next = learnOne(next, item, P, item.t);
  return next;
}

/**
 * Watch one action. → { w, out }. out = { ok, raw, row, part, E, A, S, H, d, kl, grad, dS, dSess, observing, formed,
 * held, learned }. `raw` is Gary's verdict; `observing` is true while the watcher must not enforce (forming, or inside
 * a recovery's observe window). Total: an unreadable action changes nothing and reads STEP_UP.
 */
export function step(watcher, event, p) {
  const P = paramsOf(p);
  const w = okWatcher(watcher) ? watcher : emptyWatcher('identity');
  try {
    const s = symbolsOf(event, w.ctx);
    const t = s ? event.t : null;
    const observingNow = !w.formed || (Number.isSafeInteger(w.observeUntil) && t !== null && t < w.observeUntil);
    if (!s) return { w, out: { ok: false, raw: 'STEP_UP', row: 'unreadable action', part: null, observing: observingNow, formed: w.formed, held: w.held, learned: false } };
    const window = w.window.concat([s.sym]).slice(-P.W);
    const times = w.times.concat([t]).slice(-64);
    const rhythm = rhythmOf(times, P.rhythmGaps);
    const counted = countsOf(window);
    const { Hf, H, S } = stateOf(counted);
    const haveBase = w.base.dist !== null;
    let m = null, dS = 0;
    if (haveBase) {
      const k = klOf(counted, w.base.dist, P.lambda, w.base.sizes);
      const b = combine(w.base.Hf);
      const d = { S: Math.abs(S - b.S) }, kl = { S: k.total };
      for (const n of DOMAIN_NAMES) { d[n] = Math.abs(H[n] - b.H[n]); kl[n] = k.D[n]; }
      if (P.fine === 1) for (const f of FEATURES) { d[f] = Math.abs(Hf[f] - w.base.Hf[f]); kl[f] = k.F[f]; }
      dS = w.prevD === null ? 0 : d.S - w.prevD;
      m = { d, kl, dS, grad: w.prevS === null ? 0 : Math.abs(S - w.prevS), rhythm };
    }
    const dNow = m ? m.d.S : 0;
    const sessD0 = s.ctx.sessStart === t ? dNow : w.sessD0;
    const dSess = dNow - sessD0;
    const bars = w.formed ? w.bars : w.prov;
    let dec = { verdict: 'ALLOW', row: haveBase ? 'still learning its bars' : 'no baseline yet', part: null, E: null, A: null };
    if (m && isObj(bars) && isObj(bars.parts) && window.length >= P.minN) {
      const parts = partsOf(P).filter((n) => isObj(bars.parts[n])).map((n) => ({ name: n, d: m.d[n], kl: m.kl[n], eps: bars.parts[n].eps, k: bars.parts[n].k, Amin: bars.parts[n].Amin }));
      dec = decide({ parts, dS, kA: P.kA, grad: m.grad, beta: bars.beta, dSess, budget: bars.budget, rhythm, rhythmBar: bars.rhythmBar });
    }
    const flagged = w.formed && rank(dec.verdict) >= 2;
    const held = !observingNow && rank(dec.verdict) >= 4 && w.held === null ? { verdict: dec.verdict, at: t } : w.held;
    let next = { ...w, n: w.n + 1, first: w.first === null ? t : w.first, ctx: s.ctx, window, times, prevS: haveBase ? S : null, prevD: haveBase ? dNow : null, sessD0, held };
    const item = { t, sym: s.sym, Hf, m };
    next = flagged ? { ...next, quar: next.quar.concat([item]).slice(-P.maxQuar) } : learnOne(next, item, P, t);
    if (!next.formed && t - next.first >= P.formDays * DAY && next.base.blocks >= P.formBlocks) {
      const frozen = barsOf(next.cal, P);
      if (frozen) next = { ...next, formed: true, formedAt: t, bars: frozen };
    }
    return { w: next, out: { ok: true, raw: dec.verdict, row: dec.row, part: dec.part, E: dec.E, A: dec.A, S, H, d: m ? m.d : null, kl: m ? m.kl : null, grad: m ? m.grad : 0, dS, dSess, rhythm, observing: observingNow, formed: w.formed, held: next.held, learned: !flagged } };
  } catch {
    return { w, out: { ok: false, raw: 'STEP_UP', row: 'the watch failed — fails toward step-up', part: null, observing: !w.formed, formed: w.formed, held: w.held, learned: false } };
  }
}
