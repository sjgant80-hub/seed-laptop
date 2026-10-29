// ════════════════════════════════════════════════════════════════
// src/compose.mjs — how a block becomes part of the office. Organ 3 of the seed laptop (claim L1b).
//
// A block runs exactly as its repo shipped it (its bytes are pinned and checked by src/germinate.mjs). The office adds
// three things around it, and nothing inside it:
//   the frame policy   FRAME_POLICY: the response headers every block's frame is served with. The sandbox gives it an
//                      opaque origin (no cookies, no storage of its own, no way into the office page); the policy
//                      lets its own inline code and styles run and refuses every network fetch, script, style, font,
//                      image, form or frame from anywhere else
//   the bridge         src/prologue.mjs (its source text inlined first in the page, so it runs before the block): the
//                      block's localStorage and IndexedDB, seeded with what the office stored for it, every change
//                      reported to the office; WebRTC removed (a block never talks peer to peer); the service worker,
//                      cache storage and cookies a sandbox forbids are removed too, so a block finds none
//   its own modules    a block's other script files (a module it imports by a relative path) are mapped to data: URLs
//                      with an import map, because a sandboxed page can fetch nothing, not even its own files
//
//   insertAt(html)                → the index just after the first <head …> tag, else after <html …>, else after the
//                                   doctype, else 0: where the bridge goes, so it runs before any of the block's scripts
//   composeDoc(html, opts)        → { ok, html } | { ok: false, why }
//       opts = { seed (tagged, src/value.mjs), modules: [{ path, text }] }
//   scriptSafe(json)              → JSON text (null for anything else) that cannot close a <script> element (every < written as \u003c)
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { bridge } from './prologue.mjs';
import { untag, toB64 } from './value.mjs';

export const FRAME_POLICY = Object.freeze({
  'content-security-policy': [
    'sandbox allow-scripts allow-forms allow-modals allow-downloads',
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' data:",
    "style-src 'unsafe-inline' data:",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; '),
  'x-dns-prefetch-control': 'off',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
});
export const MAX_MODULES = 16;
const enc = new TextEncoder();

export function insertAt(html) {
  if (typeof html !== 'string') return 0;
  for (const re of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return m.index + m[0].length;
  }
  return 0;
}

export function scriptSafe(json) {
  if (typeof json !== 'string') return null;
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  return json.replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

export function composeDoc(html, opts) {
  if (typeof html !== 'string') return { ok: false, why: 'a block is HTML text' };
  const o = opts && typeof opts === 'object' ? opts : {};
  const mods = Array.isArray(o.modules) ? o.modules : [];
  if (mods.length > MAX_MODULES) return { ok: false, why: 'a block maps at most ' + MAX_MODULES + ' modules' };
  const imports = {};
  for (const m of mods) {
    if (!m || typeof m.path !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.m?js$/.test(m.path) || typeof m.text !== 'string') return { ok: false, why: 'a module is a .js or .mjs file inside its block, as text' };
    imports['./' + m.path] = 'data:text/javascript;base64,' + toB64(enc.encode(m.text));
  }
  let seed;
  try { seed = JSON.stringify(o.seed === undefined ? ['o', []] : o.seed); } catch { seed = undefined; }
  if (typeof seed !== 'string') return { ok: false, why: 'the seed is tagged JSON' };
  const prologue = '<script>(function(){' +
    'var untag=' + untag.toString() + ';' +
    'var bridge=' + bridge.toString() + ';' +
    'var seed=untag(' + scriptSafe(seed) + ');' +
    "var out=function(m){parent.postMessage(m,'*')};" +
    'bridge(window,out,seed&&typeof seed==="object"?seed:{});' +
    "try{delete window.RTCPeerConnection;delete window.webkitRTCPeerConnection;delete window.RTCDataChannel}catch(e){}" +
    // what a sandbox forbids a block anyway (its own service worker, cache and cookies) is removed before it runs, so a
    // block that checks for them finds none, instead of meeting a SecurityError
    "try{delete Navigator.prototype.serviceWorker;delete window.caches}catch(e){}" +
    "try{Object.defineProperty(document,'cookie',{get:function(){return ''},set:function(){},configurable:true})}catch(e){}" +
    "addEventListener('error',function(e){out({t:'exc',m:String(e&&e.message).slice(0,200)})});" +
    "addEventListener('unhandledrejection',function(e){out({t:'exc',m:String(e&&e.reason&&e.reason.message||e&&e.reason).slice(0,200)})});" +
    "addEventListener('load',function(){out({t:'loaded'})});" +
    '})();</script>';
  const map = Object.keys(imports).length ? '<script type="importmap">' + scriptSafe(JSON.stringify({ imports })) + '</script>' : '';
  const at = insertAt(html);
  return { ok: true, html: html.slice(0, at) + prologue + map + html.slice(at) };
}
