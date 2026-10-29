#!/usr/bin/env node
// tools/relay-run.mjs — a relay between the owner's devices, on loopback: the shared foundation's relay kernel
// (vendor/fall-kit-core/relay.mjs) over TCP. It reads one thing, the recipient's key on each frame, and never a body:
// every body is a LIGHT packet a device signed, decided on by the receiving device's own door (src/sync.mjs hear).
//
//   const r = await startRelay(port?)   → { port, close(), stats() }
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createRelay, createReader } from '../vendor/fall-kit-core/relay.mjs';

export function startRelay(port = 0) {
  const relay = createRelay({});
  const conns = new Set();
  const server = createServer((sock) => {
    const conn = { sock };
    conns.add(conn);
    relay.open(conn);
    const reader = createReader();
    sock.on('data', (chunk) => {
      const r = reader.push(new Uint8Array(chunk));
      if (!r.ok) { sock.destroy(); return; }
      for (const f of r.frames) for (const out of relay.take(conn, f, Date.now())) if (!out.conn.sock.destroyed) out.conn.sock.write(Buffer.from(out.bytes));
    });
    const bye = () => { if (conns.delete(conn)) relay.close(conn); };
    sock.on('close', bye);
    sock.on('error', bye);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({
    port: server.address().port,
    stats: () => relay.stats(),
    close: () => new Promise((r) => { for (const c of conns) c.sock.destroy(); server.close(r); }),
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await startRelay(Number(process.argv[2] || 0));
  console.log(JSON.stringify({ port: r.port }));
}
