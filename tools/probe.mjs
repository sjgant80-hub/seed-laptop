#!/usr/bin/env node
// tools/probe.mjs — try each thing the office needs on THIS Node runtime, once, and let src/runtime.mjs decide.
//
//   node tools/probe.mjs [--home <folder>] [--json]
//
// Each probe does the real operation (sign and verify, hash, encrypt and decrypt, derive, write a file, start a
// sandboxed child, inflate). A probe that throws is not found. Exits 0 if the office can grow here.
import { tierOf } from '../src/runtime.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const S = globalThis.crypto.subtle;
const enc = new TextEncoder();

async function attempt(fn) { try { return (await fn()) === true; } catch { return false; } }

export async function probeNode(home) {
  const found = {
    ed25519: await attempt(async () => {
      const k = await S.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
      const sig = await S.sign('Ed25519', k.privateKey, enc.encode('probe'));
      return S.verify('Ed25519', k.publicKey, sig, enc.encode('probe'));
    }),
    sha256: await attempt(async () => new Uint8Array(await S.digest('SHA-256', enc.encode('abc')))[0] === 0xba),
    aesgcm: await attempt(async () => {
      const k = await S.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = new Uint8Array(12);
      const c = await S.encrypt({ name: 'AES-GCM', iv }, k, enc.encode('probe'));
      return new TextDecoder().decode(await S.decrypt({ name: 'AES-GCM', iv }, k, c)) === 'probe';
    }),
    pbkdf2: await attempt(async () => {
      const b = await S.importKey('raw', enc.encode('probe phrase'), 'PBKDF2', false, ['deriveBits']);
      return (await S.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 1000 }, b, 256)).byteLength === 32;
    }),
    storage: await attempt(async () => {
      const dir = home || mkdtempSync(join(tmpdir(), 'seed-probe-'));
      const p = join(dir, '.probe');
      writeFileSync(p, 'probe');
      const ok = readFileSync(p, 'utf8') === 'probe';
      rmSync(p);
      if (!home) rmSync(dir, { recursive: true });
      return ok;
    }),
    sandbox: await attempt(async () => {
      const r = spawnSync(process.execPath, ['--permission', '-e', 'require("node:fs").writeFileSync("x","x")'], { encoding: 'utf8', timeout: 10000 });
      return r.status !== 0 && /ERR_ACCESS_DENIED/.test(r.stderr);
    }),
    inflate: await attempt(async () => {
      const raw = new Blob([enc.encode('probe '.repeat(50))]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const back = await new Response(new Blob([await new Response(raw).arrayBuffer()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      return back === 'probe '.repeat(50);
    }),
    webrtc: typeof globalThis.RTCPeerConnection === 'function',
    webgpu: false,
    serviceworker: false,
    localModel: await attempt(async () => (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })).ok),
  };
  return { runtime: 'node ' + process.version + ' · ' + process.platform + ' ' + process.arch, found, ...tierOf(found) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const hi = a.indexOf('--home');
  const r = await probeNode(hi === -1 ? undefined : a[hi + 1]);
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else console.log(r.runtime + '\n' + r.says + '\n' + Object.entries(r.found).map(([k, v]) => (v ? '  ✓ ' : '  · ') + k).join('\n'));
  process.exit(r.ok ? 0 : 1);
}
