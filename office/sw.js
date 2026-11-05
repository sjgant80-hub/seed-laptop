// office/sw.js — the office's service worker. Two jobs:
//   1. keep the office on this device: every file the office needs (office/precache.mjs lists them, with their
//      SHA-256) is cached at install, so the office opens with no network at all;
//   2. serve every block's frame (office/frame.html?b=<block>) with the frame policy (src/compose.mjs FRAME_POLICY):
//      a sandbox with an opaque origin and no network. The policy travels as a response header, which is the only
//      way a sandbox can reach a frame the office still serves itself when offline.
import { FRAME_POLICY } from '../src/compose.mjs';
import { VERSION, FILES } from './precache.mjs';

const CACHE = 'seed-laptop-' + VERSION;
const FRAME = new URL('frame.html', self.location).pathname;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  // every file fetched at once (a first visit waits for the slowest, not for each in turn), every one checked before
  // any is kept: one missing or changed file refuses the whole install
  const got = await Promise.all(FILES.map(async (f) => {
    const url = new URL(f.path, self.location);
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(f.path + ' → ' + r.status);
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sha !== f.sha256) throw new Error(f.path + ' is not the file this office was built with');
    return [url.href, r];
  }));
  for (const [href, r] of got) await c.put(href, r);
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('seed-laptop-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // nothing the office asks for lives anywhere else
  if (url.pathname === FRAME) {
    e.respondWith((async () => {
      const r = await caches.match(new URL('frame.html', self.location).href);
      if (!r) return new Response('the office is not installed', { status: 503 });
      return new Response(await r.text(), { headers: { 'content-type': 'text/html; charset=utf-8', ...FRAME_POLICY } });
    })());
    return;
  }
  // a folder's address is its index.html: office/ (the live page's link, the manifest's start_url) is stored only as
  // office/index.html, so looked up by its exact path it missed the store and needed the network (claim L1e)
  const path = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
  e.respondWith((async () => (await caches.match(url.origin + path)) || fetch(e.request))());
});
