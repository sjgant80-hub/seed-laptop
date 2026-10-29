// src/parse/run.mjs — the sandbox's entry: one file in on stdin, one line of JSON out. tools/sandbox.mjs runs it as
//   node --permission --allow-fs-read=<this folder>/* --max-old-space-size=64 run.mjs <type>
// so it can read only its own folder: no network, no writes, no child process, no worker, a heap cap, and it is
// killed when its time is up. Its only output is the plain result; the office checks that result's shape again.
import { parse } from '#index';
import { inflateRawSync, inflateSync } from 'node:zlib';

const MAX_IN = 110 << 20, MAX_OUT = 256 << 20;
const chunks = [];
let size = 0;
for await (const c of process.stdin) {
  size += c.length;
  if (size > MAX_IN) { process.stdout.write(JSON.stringify({ ok: false, why: 'more bytes than any file the office reads' }) + '\n'); process.exit(0); }
  chunks.push(c);
}
const bytes = new Uint8Array(Buffer.concat(chunks));
const platform = {
  inflateRaw: async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: Math.min(Math.max(1, max), MAX_OUT) })),
  inflate: async (b) => new Uint8Array(inflateSync(b, { maxOutputLength: MAX_OUT })),
};
const r = await parse(process.argv[2], bytes, platform);
process.stdout.write(JSON.stringify(r) + '\n');
