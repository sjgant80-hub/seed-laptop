// ════════════════════════════════════════════════════════════════
// gep.mjs — the GEP security decision: field, salience, damping, shift → ALLOW / THROTTLE / STEP_UP / BLOCK / ISOLATE.
// Pure, total, deterministic, gated.
//
// Method, from Gary W. Floyd's two papers (Lumiea Systems Research Division — ThunderStruck Service LLC):
//   "GEP-Based Security: Behavioral Entropy Signatures for Cybersecurity and DevOps," 2025 (CC BY 4.0), §3:
//       E(t) = σ(k(|S_current − S_baseline| − ε))      the entropic field: divergence raises it sigmoidally
//       A(t) = action salience                          similarity to the operator's history (KL or equivalent)
//       β|∇S(t)|                                        gradient damping: suppresses rapid escalation / chaining
//       ΔS                                              expected post-action entropy shift
//       and the verdict table: Normal → ALLOW · Minor deviation → THROTTLE · Rapid escalation (E medium, A high,
//       ΔS > 1.0) → STEP-UP · Entropy violation (E high, A low) → BLOCK · Critical anomaly (E critical, A low,
//       ΔS ≫ 0) → ISOLATE. "Credential validity does not override entropy violation."
//   "Bayesian Entropy Similarity (BES): Alignment Salience for Entropy-Regulated AI Systems," Technical Report,
//   December 2025 (MIT, defensive prior art), §3.4 and §4.2:
//       A_t = exp(−D_KL(O‖B) − k·ΔS)                    (his "simplified for computation" form)
//       the decision matrix: E > threshold×2.5 → BLOCK · E > threshold×2.0 → STEP_UP · E > threshold×1.5 →
//       THROTTLE · within bounds and A_t < min → BLOCK · within bounds and A_t ≥ min → ALLOW.
//       "Alignment does not override entropy. High alignment cannot rescue high-entropy operations."
//
// WHERE THE PAPERS ARE SILENT OR DISAGREE, AND WHAT THIS BUILD CHOSE (ours, not Gary's):
//   • threshold θ = 1/3. Then "within bounds" (E ≤ 1.5θ = ½) is exactly |S − S_b| ≤ ε — the paper's own tolerance —
//     and the top rung (2.5θ ≈ 0.833) is still reachable below 1.
//   • The simplified A_t exceeds 1 when ΔS < 0, contradicting the paper's own Property 3.1 (A_t ∈ [0,1]); it is
//     clamped at 1, which keeps Properties 3.1, 3.2 and 3.3 exactly as stated.
//   • ΔS (per action) = the change this action makes to |S − S_b|: positive moves the system away from the
//     operator's stability, negative toward it. The session's ΔS is its running sum (Gary's own A.2 hardening names
//     this "delta_s_session").
//   • The two tables are combined: the alignment paper's matrix gives the rung; the security paper adds its two rows
//     the matrix lacks — rapid escalation (E above θ and β|∇S| > 1 raises anything milder to STEP_UP) and critical
//     anomaly (top rung AND A below min AND the session's ΔS past its budget → ISOLATE).
//   • The field and the salience are taken on Gary's UNIFIED state AND on each of his three domains, each against
//     its own learned bars, and the worst decides (`parts`). A script that only changes its timing collapses H_net
//     while S, a mean over every feature, barely moves — judged on S alone it would pass. Ours, not the papers'.
//   • Gary's KEY FINDING gets its own row: attackers "fail by being either overly regular (scripted automation) or
//     randomly variant". Randomly variant is the field and the salience above; overly regular is measured as the
//     window's rhythm — the mean absolute deviation of its positive gaps over their mean (the estate's v1 bes.mjs
//     measure) — below the identity's OWN learned floor → BLOCK, the security table's "entropy violation". An identity
//     that is itself clockwork learns a floor of 0, and the row can never fire on it. The row is ours; the finding is his.
//   • Any input that is not a finite number fails TOWARD STEP_UP — never a silent ALLOW, never a silent BLOCK.
// ════════════════════════════════════════════════════════════════

export const VERDICTS = Object.freeze(['ALLOW', 'THROTTLE', 'STEP_UP', 'BLOCK', 'ISOLATE']);
export const THETA = 1 / 3;

/** The verdict's place on the ladder; -1 for anything that is not a verdict. */
export const rank = (v) => VERDICTS.indexOf(v);
/** The more severe of two verdicts (an unknown verdict counts as STEP_UP). */
export function worst(a, b) {
  const ra = rank(a) < 0 ? 2 : rank(a), rb = rank(b) < 0 ? 2 : rank(b);
  return VERDICTS[ra > rb ? ra : rb];
}

/** The logistic σ(x), total: NaN → ½ is never returned to a caller (decide checks its inputs first). */
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Gary's entropic field E(t) = σ(k(d − ε)), d = |S_current − S_baseline|. */
export const field = (d, eps, k) => sigmoid(k * (d - eps));

/** Gary's alignment salience A_t = exp(−D_KL − k·ΔS), clamped to [0, 1] (Property 3.1). */
export function salience(kl, dS, kA) {
  const a = Math.exp(-kl - kA * dS);
  return a < 1 ? a : 1;
}

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const PART = ['d', 'eps', 'k', 'kl', 'Amin'];
const SCALAR = ['dS', 'kA', 'grad', 'beta', 'dSess', 'budget'];

/**
 * One decision. m = { parts: [{ name, d, eps, k, kl, Amin }], dS, kA, grad, beta, dSess, budget, rhythm?, rhythmBar? } — or a single part
 * given flat as { d, eps, k, kl, Amin, … }. E is the strongest field over the parts; A is the salience of the part
 * whose alignment is furthest below its own bar (or the lowest A when none is below).
 * → { verdict, E, A, part, row, why }: `row` names the table row that decided it, `part` where it was measured.
 */
export function decide(m) {
  try {
    const o = m !== null && typeof m === 'object' ? m : {};
    const parts = Array.isArray(o.parts) && o.parts.length ? o.parts : [{ name: 'S', d: o.d, eps: o.eps, k: o.k, kl: o.kl, Amin: o.Amin }];
    for (const f of SCALAR) if (!num(o[f])) return { verdict: 'STEP_UP', E: null, A: null, part: null, row: 'unreadable', why: 'the measure "' + f + '" is not a number — fails toward step-up' };
    let E = -1, eAt = null, A = 2, aAt = null, low = false;
    for (const p of parts) {
      for (const f of PART) if (!(p && num(p[f]))) return { verdict: 'STEP_UP', E: null, A: null, part: null, row: 'unreadable', why: 'the measure "' + f + '" is not a number — fails toward step-up' };
      const e = field(p.d, p.eps, p.k);
      if (e > E) { E = e; eAt = p.name; }
      const a = salience(p.kl, o.dS, o.kA), below = a < p.Amin;
      if ((below && !low) || (below === low && a < A)) { A = a; aAt = p.name; low = below; }
    }
    let verdict, row, part = eAt;
    if (E > 2.5 * THETA) {
      if (low && o.dSess > o.budget) { verdict = 'ISOLATE'; row = 'critical anomaly: E critical, A low, session ΔS past its budget'; }
      else { verdict = 'BLOCK'; row = 'E > 2.5θ'; }
    } else if (E > 2 * THETA) { verdict = 'STEP_UP'; row = 'E > 2θ'; }
    else if (E > 1.5 * THETA) { verdict = 'THROTTLE'; row = 'E > 1.5θ'; }
    else if (low) { verdict = 'BLOCK'; row = 'within bounds, A < min'; part = aAt; }
    else { verdict = 'ALLOW'; row = 'within bounds, A ≥ min'; }
    if (rank(verdict) < 2 && E > THETA && o.beta * o.grad > 1) { verdict = 'STEP_UP'; row = 'rapid escalation: β|∇S| > 1'; part = 'S'; }
    if (rank(verdict) < 3 && num(o.rhythm) && num(o.rhythmBar) && o.rhythm < o.rhythmBar) { verdict = 'BLOCK'; row = 'too regular: clockwork timing, not this identity'; part = 'rhythm'; }
    return { verdict, E, A, part, row, why: row + (part ? ' (' + part + ')' : '') };
  } catch { return { verdict: 'STEP_UP', E: null, A: null, part: null, row: 'error', why: 'the decision failed — fails toward step-up' }; }
}
