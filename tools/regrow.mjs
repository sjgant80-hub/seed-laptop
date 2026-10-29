#!/usr/bin/env node
// tools/regrow.mjs — a wiped machine grows its office back: the seed, the vault and the phrase, nothing else.
//
//   SEED_PHRASE=<phrase> node --permission --allow-fs-read=<repo> --allow-fs-read=<repo>/* --allow-fs-read=<vault> \
//       --allow-fs-write=<home>/* tools/regrow.mjs --seed seeds/stock.full --vault <file.slv> --home <empty folder>
//
// Run under Node's permission model with no network permission: no estate service and no other key is reachable or
// needed. Plants the seed (the owner grown from the phrase), opens the vault with the same phrase, restores its state if
// it is this office's and this owner's (src/regrow.mjs), gives this device a NEW key of its own, and starts its
// behaviour watch fresh (observe-only). Writes: store.json (byte for byte the store backed up), office.json,
// device.json, watch.json. Prints one line of JSON: { ok, ms, keys, owner } or { ok: false, stage, why }.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { germinate } from '../src/germinate.mjs';
import { open } from '../src/vault.mjs';
import { restore, watchOf } from '../src/regrow.mjs';
import { makeIdentity } from '../vendor/fall-kit-core/identity.mjs';

const t0 = performance.now();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? undefined : process.argv[i + 1]; };
const say = (x) => { process.stdout.write(JSON.stringify(x) + '\n'); process.exitCode = x.ok ? 0 : 1; };
const home = resolve(arg('--home') || '');

if (!arg('--home') || (existsSync(home) && readdirSync(home).length)) say({ ok: false, stage: 'args', why: 'name an empty home folder with --home' });
else {
  const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  const phrase = process.env.SEED_PHRASE;
  const g = await germinate({ full: new Uint8Array(readFileSync(resolve(arg('--seed')))) }, { pinned, phrase, at: new Date().toISOString().slice(0, 19) + 'Z' });
  if (!g.ok) say({ ok: false, stage: 'seed', why: g.why });
  else {
    const v = await open(new Uint8Array(readFileSync(resolve(arg('--vault')))), phrase);
    if (!v.ok) say({ ok: false, stage: 'vault', why: v.why });
    else {
      const r = restore(v.entries, { digest: g.digest, owner: { id: g.owner.id } });
      if (!r.ok) say({ ok: false, stage: 'restore', why: r.why });
      else {
        const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const me = await makeIdentity(seed);
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, 'store.json'), r.bytes);
        writeFileSync(join(home, 'office.json'), JSON.stringify({ digest: g.digest, founder: g.owner.id }));
        writeFileSync(join(home, 'device.json'), JSON.stringify({ id: me.id, seed: Buffer.from(seed).toString('hex') }));
        const w = watchOf(g.owner.id);
        writeFileSync(join(home, 'watch.json'), JSON.stringify(w));
        say({ ok: true, ms: Math.round(performance.now() - t0), keys: Object.keys(r.store.keys).length, owner: g.owner.id, device: me.id, observing: w.formed === false });
      }
    }
  }
}
