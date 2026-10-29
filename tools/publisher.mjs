#!/usr/bin/env node
// tools/publisher.mjs — the key that signs the stock seed. Its private half stays on the publisher's machine
// (~/.seed-laptop/publisher.seed, 32 random bytes, never committed); its public half is pinned by every office runtime
// in seeds/publisher.json. A seed signed by any other key is refused (claim L1c).
//
//   node tools/publisher.mjs          make the key if there is none, write seeds/publisher.json, print the public id
//   loadPublisher()                   → the identity (for tools/make-seed.mjs)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeIdentity } from '../vendor/fall-kit-core/identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(homedir(), '.seed-laptop', 'publisher.seed');

export async function loadPublisher() {
  if (!existsSync(SEED)) {
    mkdirSync(dirname(SEED), { recursive: true });
    writeFileSync(SEED, Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString('hex') + '\n', { mode: 0o600 });
  }
  const seed = Uint8Array.from(Buffer.from(readFileSync(SEED, 'utf8').trim(), 'hex'));
  if (seed.length !== 32) throw new Error('the publisher seed is not 32 bytes');
  return makeIdentity(seed);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = await loadPublisher();
  mkdirSync(join(ROOT, 'seeds'), { recursive: true });
  writeFileSync(join(ROOT, 'seeds', 'publisher.json'), JSON.stringify({ kind: 'seed-laptop.publisher', v: 1, says: 'The office runtime grows a stock seed only if this key signed it.', pinned: [id.id] }, null, 1) + '\n');
  console.log('publisher ' + id.id);
}
