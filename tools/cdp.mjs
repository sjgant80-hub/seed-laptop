// tools/cdp.mjs — drive a real Chrome, headless, with its own throwaway profile, over the DevTools protocol.
// No dependencies: Node's own WebSocket. Used by the browser measurements (L1b, L5's WebRTC run, L6c) and the demo.
//
//   const c = await launch({ profile })      start Chrome (profile = an empty folder it may use and lose)
//   const p = await c.page()                 a new tab: { send(method, params), on(event, fn), eval(expr), close() }
//   await c.close()
//
// Every frame's exceptions, console lines and network requests can be watched with p.on('Runtime.exceptionThrown'),
// p.on('Network.requestWillBeSent'), … after p.send('Runtime.enable') / ('Network.enable'). Nothing here decides a
// claim: the measure tools read what it records.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let n = 0;
    const pending = new Map(), listeners = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        const id = ++n;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((res, rej) => pending.set(id, { res, rej, method }));
      },
      on(event, fn, sessionId) {
        const k = (sessionId || '') + '|' + event;
        if (!listeners.has(k)) listeners.set(k, []);
        listeners.get(k).push(fn);
      },
      close() { try { ws.close(); } catch { /* gone */ } },
    });
    ws.onerror = (e) => reject(new Error('DevTools socket: ' + (e.message || 'error')));
    ws.onmessage = (m) => {
      const msg = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.rej(new Error(p.method + ': ' + msg.error.message)); else p.res(msg.result);
      } else if (msg.method) {
        for (const fn of listeners.get((msg.sessionId || '') + '|' + msg.method) || []) fn(msg.params);
      }
    };
  });
}

export async function launch(opts = {}) {
  if (!CHROME) throw new Error('no Chrome found (set CHROME_PATH)');
  const profile = opts.profile;
  mkdirSync(profile, { recursive: true });
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
    '--metrics-recording-only', '--no-pings', '--disable-features=MediaRouter,OptimizationHints', '--window-size=1280,900', ...(opts.args || []), 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 200 && !port; i++) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim();
    if (!port) await wait(50);
  }
  if (!port) { proc.kill(); throw new Error('Chrome did not open its DevTools port'); }
  const info = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const b = await connect(info.webSocketDebuggerUrl);
  return {
    version: info.Browser,
    browser: b,
    async page() {
      const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (m, p) => b.send(m, p, sessionId);
      return {
        targetId, sessionId, send,
        on: (e, fn) => b.on(e, fn, sessionId),
        async eval(expression, awaitPromise = true) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
          if (r.exceptionDetails) throw new Error('in page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          return r.result.value;
        },
        close: () => b.send('Target.closeTarget', { targetId }),
      };
    },
    async close() {
      try { await b.send('Browser.close'); } catch { /* already gone */ }
      b.close();
      await new Promise((r) => { if (proc.exitCode !== null) r(); else { proc.once('exit', r); setTimeout(() => { proc.kill(); r(); }, 3000); } });
    },
  };
}
