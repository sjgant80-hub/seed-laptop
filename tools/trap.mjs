// tools/trap.mjs — every network call this process makes, trapped and written down (claim L6, part b).
//
//   installTrap()            patch every door Node has to the network: TCP sockets (net), TLS, UDP (dgram), DNS
//                            lookups and resolves, HTTP and HTTPS requests, and fetch. Each call is recorded
//                            { kind, host, port, at, allowed } and REFUSED unless a window is open for exactly it.
//   openWindow(host, port)   the user pressed send: one destination is allowed until closeWindow()
//   closeWindow()
//   attempts                 every call recorded, allowed or not
// Install it before anything else is imported, so nothing can reach the network around it. Child processes (the
// parser sandbox) are not covered here: they run under Node's permission model with no network at all.
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const attempts = [];
let window = null;
export const openWindow = (host, port) => { window = { host, port: Number(port) }; };
export const closeWindow = () => { window = null; };

function record(kind, host, port) {
  const allowed = window !== null && host === window.host && Number(port) === window.port;
  attempts.push({ kind, host: String(host), port: port === undefined ? null : Number(port), at: Date.now(), allowed });
  if (!allowed) throw Object.assign(new Error('the office stopped a network call to ' + host + (port ? ':' + port : '')), { code: 'ETRAPPED' });
}

const hostPort = (args) => {
  const a = Array.isArray(args[0]) ? args[0] : args;   // net.connect hands Socket.connect its arguments already normalised
  if (a[0] !== null && typeof a[0] === 'object') return [a[0].host || a[0].hostname || 'localhost', a[0].port];
  if (typeof a[0] === 'number' || /^\d+$/.test(String(a[0]))) return [typeof a[1] === 'string' ? a[1] : 'localhost', a[0]];
  return [String(a[0]), undefined];   // a path (a local pipe)
};

let installed = false;
export function installTrap() {
  if (installed) return;
  installed = true;
  const sockConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...a) {
    const [host, port] = hostPort(a);
    const first = Array.isArray(a[0]) ? a[0][0] : a[0];
    if (port === undefined && first && typeof first === 'object' && first.path) return sockConnect.apply(this, a);   // a local pipe is not the network
    if (!this._seedTrapped) record('tcp', host, port);
    return sockConnect.apply(this, a);
  };
  const tlsConnect = tls.connect;
  tls.connect = function (...a) {
    const o = a[0] && typeof a[0] === 'object' ? a[0] : {};
    if (o.socket) { o.socket._seedTrapped = true; return tlsConnect.apply(this, a); }   // TLS on a socket already allowed
    const [host, port] = hostPort(a);
    record('tls', host, port);
    return tlsConnect.apply(this, a);
  };
  const udpSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function (...a) { const port = a.find((x, i) => i > 0 && typeof x === 'number' && x > 0 && x < 65536); const host = a.find((x, i) => i > 0 && typeof x === 'string'); record('udp', host || 'localhost', port); return udpSend.apply(this, a); };
  const udpConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function (port, host, ...rest) { record('udp', host || 'localhost', port); return udpConnect.call(this, port, host, ...rest); };
  for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveMx', 'resolveTxt', 'reverse']) {
    const orig = dns[fn];
    if (typeof orig === 'function') dns[fn] = function (name, ...rest) { record('dns', name); return orig.call(this, name, ...rest); };
    const p = dns.promises && dns.promises[fn];
    if (typeof p === 'function') dns.promises[fn] = function (name, ...rest) { record('dns', name); return p.call(this, name, ...rest); };
  }
  for (const [mod, kind] of [[http, 'http'], [https, 'https']]) {
    for (const fn of ['request', 'get']) {
      const orig = mod[fn];
      mod[fn] = function (...a) {
        const u = typeof a[0] === 'string' || a[0] instanceof URL ? new URL(String(a[0])) : null;
        const o = !u && a[0] && typeof a[0] === 'object' ? a[0] : {};
        record(kind, u ? u.hostname : o.hostname || o.host || 'localhost', u ? (u.port || (kind === 'https' ? 443 : 80)) : o.port || (kind === 'https' ? 443 : 80));
        return orig.apply(this, a);
      };
    }
  }
  const f = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    let u;
    try { u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); } catch { u = null; }
    if (u && (u.protocol === 'data:' || u.protocol === 'blob:')) return f.call(this, input, init);
    try { record('fetch', u ? u.hostname : '?', u ? (u.port || (u.protocol === 'https:' ? 443 : 80)) : undefined); } catch (e) { return Promise.reject(e); }
    return f.call(this, input, init);
  };
  if (typeof globalThis.WebSocket === 'function') {
    const WS = globalThis.WebSocket;
    globalThis.WebSocket = function (url, ...rest) { const u = new URL(String(url)); record('websocket', u.hostname, u.port || 443); return new WS(url, ...rest); };
  }
}
