#!/usr/bin/env node
// tools/plant.mjs — plant a seed on this machine (the host-OS mode, or inside the minimal base) and grow the office.
//
//   SEED_PHRASE=<the owner's phrase> node --permission --allow-fs-read=<repo> --allow-fs-read=<repo>/* --allow-fs-write=<home>/* \
//       tools/plant.mjs --seed seeds/stock.full --home <empty folder>
//   … --genome seeds/stock.genome.json --mirror <folder>       a light seed: blocks from the owner's own mirror
//
// Run it under Node's permission model with NO network permission: then the planting cannot reach the network at
// all, which is what claim L1a measures. The phrase comes from the environment, never from the command line (so it
// is not in the shell's history or the process list). The home folder must be empty.
//
// Writes into the home folder: office.json (the composed office and its digest), blocks/<id>/<path> (every block
// file, verified), owner.json (the owner's PUBLIC keys only), receipts.jsonl (Kar's receipts, one per line).
// Prints one line of JSON: { ok, digest, checked, owner, ms } or { ok: false, stage, why }.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { germinate } from '../src/germinate.mjs';
import { hex } from '../vendor/fall-kit-core/identity.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';

const t0 = performance.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? undefined : process.argv[i + 1]; };
const say = (x) => { process.stdout.write(JSON.stringify(x) + '\n'); process.exitCode = x.ok ? 0 : 1; };

const home = arg('--home') ? resolve(arg('--home')) : null;
if (!home) say({ ok: false, stage: 'args', why: 'name an empty home folder with --home' });
else if (existsSync(home) && readdirSync(home).length) say({ ok: false, stage: 'args', why: 'the home folder is not empty' });
else {
  const pinned = JSON.parse(readFileSync(arg('--pinned') || join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  let seed;
  if (arg('--seed')) seed = { full: new Uint8Array(readFileSync(resolve(arg('--seed')))) };
  else {
    const mirror = resolve(arg('--mirror') || join(ROOT, 'mirror'));
    seed = {
      genome: readFileSync(resolve(arg('--genome')), 'utf8'),
      fetch: async (s) => (/^[0-9a-f]{64}$/.test(s) && existsSync(join(mirror, s)) ? new Uint8Array(readFileSync(join(mirror, s))) : null),
    };
  }
  const at = new Date().toISOString().slice(0, 19) + 'Z';
  const r = await germinate(seed, { pinned, phrase: process.env.SEED_PHRASE, at });
  if (!r.ok) say({ ok: false, stage: r.stage, why: r.why, checked: r.checked });
  else {
    mkdirSync(home, { recursive: true });
    for (const f of r.files) { const p = join(home, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.bytes); }
    writeFileSync(join(home, 'office.json'), JSON.stringify({ office: r.office, digest: r.digest }, null, 1) + '\n');
    writeFileSync(join(home, 'owner.json'), JSON.stringify({ founder: r.owner.id, device: r.owner.device }, null, 1) + '\n');
    writeFileSync(join(home, 'receipts.jsonl'), r.receipts.map((x) => JSON.stringify(x)).join('\n') + '\n');
    const written = r.files.every((f) => hex(sha256(new Uint8Array(readFileSync(join(home, f.path))))) === hex(sha256(f.bytes)));
    say({ ok: written, digest: r.digest, checked: r.checked, blocks: r.office.blocks.length, owner: r.owner.id, genome: r.genome.id, ms: Math.round(performance.now() - t0), kar: r.receipts[0].says, ...(written ? {} : { stage: 'write', why: 'a block file did not read back as written' }) });
  }
}
