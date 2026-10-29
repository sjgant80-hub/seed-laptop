// ════════════════════════════════════════════════════════════════
// src/runtime.mjs — layer 2 of the seed laptop: what this runtime can do, and whether the office can grow on it.
// Pure, total, gated.
//
// The office needs a few things to grow at all, and is fuller with a few more. A probe (tools/probe.mjs in Node,
// office/probe.mjs in a tab) tries each one once on the real platform and hands this kernel what it found, as
// { name: true } for each thing that worked. The kernel decides, and says why in words a person can read.
//
//   NEEDS    every one must work, or nothing is planted:
//              ed25519 (the owner's identity and the seed's signature), sha256 (every block's pin),
//              aesgcm + pbkdf2 (the vault and its key from the owner's phrase), storage (somewhere to keep the office)
//   EXTRAS   each adds one thing, and the office says which are missing:
//              sandbox (files from outside are parsed in a sandbox), inflate (zip-based files: DOCX, XLSX, zip),
//              webrtc (devices sync directly), webgpu (a model runs in the tab), serviceworker (the office opens with
//              no network), localModel (Kar can use a model on this machine)
//
//   tierOf(found) → { ok: true, tier: 'full' | 'core', missing: [], absent: [...], gives: [...], says }
//                 | { ok: false, tier: 'none', missing: [...], absent: [...], gives: [], says }
//   'full' = every need and every extra; 'core' = every need, some extras absent; 'none' = a need is missing.
//
// Only an own property that is exactly true counts as found: a probe that threw, or a value that only looks true,
// is not there. A hostile object (a throwing getter, a proxy) reads as nothing found.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

export const NEEDS = Object.freeze(['ed25519', 'sha256', 'aesgcm', 'pbkdf2', 'storage']);
export const EXTRAS = Object.freeze(['sandbox', 'inflate', 'webrtc', 'webgpu', 'serviceworker', 'localModel']);
export const GIVES = Object.freeze({
  sandbox: 'files from outside are parsed in a sandbox',
  inflate: 'zip-based files (DOCX, XLSX, zip) can be read',
  webrtc: 'devices sync directly with each other',
  webgpu: 'a language model can run in this tab',
  serviceworker: 'the office opens with no network',
  localModel: 'Kar can use a model on this machine',
});

/** Did the probe find this one? Own property, exactly true; anything that throws is not found. */
export function found(f, name) {
  try { return Object.prototype.hasOwnProperty.call(f, name) && f[name] === true; } catch { return false; }
}

export function tierOf(f) {
  const missing = NEEDS.filter((n) => !found(f, n));
  const absent = EXTRAS.filter((n) => !found(f, n));
  if (missing.length) {
    return { ok: false, tier: 'none', missing, absent, gives: [], says: 'The office cannot grow here: this runtime has no ' + missing.join(', ') + '.' };
  }
  const gives = EXTRAS.filter((n) => !absent.includes(n)).map((n) => GIVES[n]);
  const says = absent.length
    ? 'The office grows here. Not available: ' + absent.map((n) => GIVES[n]).join('; ') + '.'
    : 'The office grows here, with everything: ' + gives.join('; ') + '.';
  return { ok: true, tier: absent.length ? 'core' : 'full', missing, absent, gives, says };
}
