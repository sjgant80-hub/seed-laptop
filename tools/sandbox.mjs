// tools/sandbox.mjs — run one parse in its own Node process, under the permission model (claims L2b, L2c).
//
//   sandboxParse(type, bytes, { ms, heapMb }) → Promise<{ ok, result, ms } | { ok: false, why, killed, ms }>
//
// The child may read only src/parse/ (its own code): no network, no writes, no child processes, no workers, no
// addons; its heap is capped (--max-old-space-size) and it is killed when its time is up. It gets the file's bytes on
// stdin and answers one line of JSON. The office's core never imports src/parse/: this file is its only way in.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PARSE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'parse');
export const LIMITS = Object.freeze({ ms: 5000, heapMb: 64, outBytes: 64 << 20 });

export function sandboxArgs(type, heapMb = LIMITS.heapMb) {
  return ['--permission', '--allow-fs-read=' + join(PARSE, '*'), '--max-old-space-size=' + heapMb, '--max-semi-space-size=4', join(PARSE, 'run.mjs'), type];
}

export function sandboxParse(type, bytes, opts = {}) {
  const ms = opts.ms || LIMITS.ms, heapMb = opts.heapMb || LIMITS.heapMb;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(process.execPath, sandboxArgs(type, heapMb), { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    let out = '', err = '', killed = false, done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve({ ...r, ms: Math.round(performance.now() - t0) }); } };
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, ms);
    p.stdout.on('data', (d) => { out += d; if (out.length > LIMITS.outBytes) { killed = true; p.kill('SIGKILL'); } });
    p.stderr.on('data', (d) => { err += d; });
    p.stdin.on('error', () => { /* the child closed early: its answer, or its death, says why */ });
    p.on('exit', (code) => {
      if (killed) return finish({ ok: false, why: out.length > LIMITS.outBytes ? 'the reader wrote more than the office reads back' : 'the reader ran past its ' + ms + ' ms', killed: true });
      let line;
      try { line = JSON.parse(out.trim().split('\n').pop()); } catch { line = null; }
      if (!line || typeof line !== 'object') return finish({ ok: false, why: 'the reader died (exit ' + code + ')' + (/heap/i.test(err) ? ': out of its memory cap' : ''), killed: false });
      finish(line.ok === true ? { ok: true, type: line.type, result: line.result } : { ok: false, why: String(line.why || 'refused'), killed: false });
    });
    p.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
}
