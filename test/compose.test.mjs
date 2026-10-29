import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { composeDoc, insertAt, scriptSafe, FRAME_POLICY, MAX_MODULES } from '../src/compose.mjs';
import { tag } from '../src/value.mjs';

test('the frame policy: sandboxed, opaque origin, no network of any kind', () => {
  const csp = FRAME_POLICY['content-security-policy'];
  assert.match(csp, /^sandbox allow-scripts allow-forms allow-modals allow-downloads;/);
  assert.doesNotMatch(csp, /allow-same-origin|allow-top-navigation|allow-popups/);
  for (const d of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'", 'img-src data: blob:', 'font-src data:']) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /https?:|\*/, 'no host and no wildcard anywhere');
  assert.equal(FRAME_POLICY['x-dns-prefetch-control'], 'off');
  assert.equal(FRAME_POLICY['referrer-policy'], 'no-referrer');
  assert.equal(Object.isFrozen(FRAME_POLICY), true);
});

test('insertAt: after <head>, else <html>, else the doctype, else 0', () => {
  assert.equal(insertAt('<!doctype html><html lang="en"><head><title>'), '<!doctype html><html lang="en"><head>'.length);
  assert.equal(insertAt('<HTML><HEAD data-x="1">'), '<HTML><HEAD data-x="1">'.length);
  assert.equal(insertAt('<!DOCTYPE html><html><body>'), '<!DOCTYPE html><html>'.length);
  assert.equal(insertAt('<!doctype html><p>'), '<!doctype html>'.length);
  assert.equal(insertAt('<p>no structure</p>'), 0);
  assert.equal(insertAt('<header>not a head</header>'), 0);
  assert.equal(insertAt('<htmlx>'), 0);
  assert.equal(insertAt(5), 0);
});

test('scriptSafe: only text; anything else is null', () => {
  assert.equal(scriptSafe(5), null);
  assert.equal(scriptSafe({ toString() { throw new Error('x'); } }), null);
});

test('scriptSafe: nothing can close the script', () => {
  assert.equal(scriptSafe('["</script>"]'), '["\\u003c/script>"]');
  assert.equal(scriptSafe('a\u2028b\u2029c'), 'a\\u2028b\\u2029c');
  assert.equal(JSON.parse(scriptSafe(JSON.stringify(['</script><b>', '\u2028']))).join(''), '</script><b>\u2028');
});

test('composeDoc: the bridge first, the block unchanged after it', () => {
  const block = '<!doctype html><html><head><title>B</title></head><body><script>run()</script></body></html>';
  const r = composeDoc(block, {});
  assert.equal(r.ok, true);
  const at = insertAt(block);
  assert.ok(r.html.startsWith(block.slice(0, at) + '<script>(function(){'));
  assert.ok(r.html.endsWith(block.slice(at)), 'every byte of the block after the insert point, unchanged');
  assert.ok(r.html.includes('delete window.RTCPeerConnection'));
  assert.ok(r.html.includes('delete Navigator.prototype.serviceWorker'));
  assert.ok(!r.html.includes('importmap'), 'no import map when there is no module');
});

function runPrologue(html) {
  const script = /<script>(\(function\(\)\{[\s\S]*?\}\)\(\);)<\/script>/.exec(html)[1];
  const posted = [], listeners = {};
  const win = { RTCPeerConnection: 1, webkitRTCPeerConnection: 1, RTCDataChannel: 1, caches: 1 };
  const Navigator = function () {}; Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => 1, configurable: true });
  const document = {};
  const ctx = vm.createContext({
    window: win, parent: { postMessage: (m, o) => posted.push([m, o]) }, Navigator, document,
    addEventListener: (t, f) => { listeners[t] = f; }, structuredClone, setTimeout, atob, Blob, Map, Set, Proxy, JSON, Object, Array, String, Number, Date, Error, Symbol, Uint8Array, Promise,
  });
  ctx.globalThis = ctx;
  vm.runInContext(script, ctx);
  return { win, posted, listeners, Navigator, document };
}

test('composeDoc: the inlined bridge runs, starts from the seed, reports to the office', async () => {
  const seed = (await tag({ ls: [['k', 'v']], idb: [] })).t;
  const { win, posted, listeners, Navigator, document } = runPrologue(composeDoc('<head></head>', { seed }).html);
  assert.equal('serviceWorker' in new Navigator(), false, 'no service worker to find');
  assert.equal('caches' in win, false);
  assert.equal(document.cookie, '');
  document.cookie = 'a=b';
  assert.equal(document.cookie, '', 'cookies go nowhere');
  assert.equal(win.localStorage.getItem('k'), 'v');
  win.localStorage.setItem('n', 'm');
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), [{ t: 'ls', op: 'set', k: 'n', v: 'm' }, '*']);
  assert.equal('RTCPeerConnection' in win, false, 'WebRTC removed');
  assert.equal('webkitRTCPeerConnection' in win, false);
  assert.equal('RTCDataChannel' in win, false);
  listeners.error({ message: 'boom' });
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), [{ t: 'exc', m: 'boom' }, '*']);
  listeners.unhandledrejection({ reason: { message: 'rej' } });
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), [{ t: 'exc', m: 'rej' }, '*']);
  listeners.unhandledrejection({ reason: 'plain' });
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), [{ t: 'exc', m: 'plain' }, '*']);
  listeners.load();
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), [{ t: 'loaded' }, '*']);
  listeners.error({ message: 'x'.repeat(300) });
  assert.equal(posted.at(-1)[0].m.length, 200);
});

test('composeDoc: a seed that is not an object starts the block empty', () => {
  const { win } = runPrologue(composeDoc('<head></head>', { seed: ['s', 'text'] }).html);
  assert.equal(win.localStorage.length, 0);
  const none = runPrologue(composeDoc('<head></head>', { seed: ['z'] }).html);
  assert.equal(none.win.localStorage.length, 0);
});

test('composeDoc: a seed holding </script> cannot break out of the bridge', async () => {
  const seed = (await tag({ ls: [['k', '</script><script>alert(1)</script>']] })).t;
  const html = composeDoc('<head></head>', { seed }).html;
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'one closing tag: the bridge\'s own');
  assert.equal(runPrologue(html).win.localStorage.getItem('k'), '</script><script>alert(1)</script>');
});

test('composeDoc: a block\'s own modules become data: URLs in an import map', () => {
  const r = composeDoc('<head></head><script type="module">import x from "./lib.mjs"</script>', { modules: [{ path: 'lib.mjs', text: 'export default 1 // </script>' }] });
  const m = /<script type="importmap">(.*?)<\/script>/.exec(r.html);
  const map = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(map.imports), ['./lib.mjs']);
  assert.equal(Buffer.from(map.imports['./lib.mjs'].split(',')[1], 'base64').toString(), 'export default 1 // </script>');
  assert.ok(r.html.indexOf('importmap') < r.html.indexOf('type="module"'), 'the map comes before the block\'s modules');
  assert.equal(composeDoc('<head>', { modules: [{ path: 'a/b.js', text: '' }] }).ok, true);
});

test('composeDoc refuses: not HTML, bad modules, too many, a seed that is not JSON', () => {
  assert.equal(composeDoc(5).ok, false);
  for (const m of [{ path: '../x.js', text: '' }, { path: 'x.css', text: '' }, { path: 'x.js' }, { path: 'x.js', text: 5 }, null, { path: '/x.js', text: '' }, { path: 'a//x.js', text: '' }]) assert.equal(composeDoc('<head>', { modules: [m] }).ok, false, JSON.stringify(m));
  const many = Array.from({ length: MAX_MODULES + 1 }, (_, i) => ({ path: 'm' + i + '.js', text: '' }));
  assert.match(composeDoc('<head>', { modules: many }).why, /at most/);
  assert.equal(composeDoc('<head>', { modules: many.slice(1) }).ok, true, 'exactly MAX_MODULES');
  const c = []; c.push(c);
  assert.match(composeDoc('<head>', { seed: c }).why, /tagged JSON/);
  assert.match(composeDoc('<head>', { seed: () => 1 }).why, /tagged JSON/);
  assert.equal(composeDoc('<head>', null).ok, true);
});
