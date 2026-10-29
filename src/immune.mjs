// ════════════════════════════════════════════════════════════════
// src/immune.mjs — the inbound edge's immune memory: files come in with the immune system watching. Organ 4.
//
// A file the edge refused, or that its sandboxed reader kept out, becomes an ANTIBODY: the SHA-256 of its bytes, the
// type its name declared, the stage that refused it and why, the version of the edge that decided, and the device that
// saw it. When the same bytes come again under the same type, that device refuses them on sight: nothing reads them
// again, not even the sandbox.
//
// NO FALSE IMMUNITY (the rule of fall-kit's antibody organ). An antibody is minted only for a refusal that is a pure
// function of the bytes, the declared type and the edge's code: the size, magic and shape stages, and the reader's own
// refusal. Never for the type stage (it depends on the name alone), nor for a reader that was stopped (a time or memory
// cap depends on the machine). It matches only under the same edge version, so an improved edge decides afresh. An
// antibody minted on another of the owner's devices is shown ("seen and refused on your other device") but never acted
// on: the file still goes through this device's own edge, so no device can make another refuse a file.
//
//   PERMANENT, FAMILY                          the stages an antibody may come from, and the family each names
//   EDGE_FILES                                 the code the edge version is the hash of
//   mint(sha, declared, refusal, edge, device, at)
//       refusal = { stage, why }               → antibody | null
//   valid(antibody)                            → true | false
//   recognise(antibodies, sha, declared, edge, device)
//                                              → { own: antibody | null, seen: [antibodies other devices minted] }
//   tally(antibodies, device)                  → { family: count } of this device's own antibodies
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const PERMANENT = Object.freeze(['size', 'magic', 'shape', 'reader']);
/** The files whose code decides at the edge: the edge's version is the SHA-256 of them, each as name, newline, text. */
export const EDGE_FILES = Object.freeze(['src/edge-in.mjs', ...['zip', 'xml', 'office', 'pdf', 'mail', 'text', 'image', 'index'].map((n) => 'src/parse/' + n + '.mjs')]);
export const FAMILY = Object.freeze({ size: 'empty or oversized', magic: 'not what its name says', shape: 'cut short, or glued to another file', reader: 'damaged inside' });
const HEX64 = /^[0-9a-f]{64}$/;
const hex64 = (s) => typeof s === 'string' && HEX64.test(s);
const word = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 64;
const stageOf = (s) => (PERMANENT.includes(s) ? s : null);

export function mint(sha, declared, refusal, edge, device, at) {
  let stage, why;
  try { stage = stageOf(refusal.stage); why = String(refusal.why); } catch { return null; }
  if (stage === null || !hex64(sha) || !word(declared) || !hex64(edge) || !word(device) || !Number.isSafeInteger(at)) return null;
  return { sha, declared, stage, family: FAMILY[stage], why: why.slice(0, 240), edge, device, at };
}

export function valid(a) {
  try {
    return hex64(a.sha) && word(a.declared) && stageOf(a.stage) !== null && a.family === FAMILY[a.stage] && typeof a.why === 'string' &&
      hex64(a.edge) && word(a.device) && Number.isSafeInteger(a.at);
  } catch { return false; }
}

export function recognise(antibodies, sha, declared, edge, device) {
  const same = (Array.isArray(antibodies) ? antibodies : []).filter((a) => valid(a) && a.sha === sha && a.declared === declared && a.edge === edge);
  return { own: same.find((a) => a.device === device) || null, seen: same.filter((a) => a.device !== device) };
}

export function tally(antibodies, device) {
  const out = {};
  for (const a of Array.isArray(antibodies) ? antibodies : []) if (valid(a) && a.device === device) out[a.family] = (out[a.family] || 0) + 1;
  return out;
}
