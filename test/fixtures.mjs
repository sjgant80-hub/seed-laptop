// test/fixtures.mjs — a small seed for the tests: two blocks, three files, signed by a PUBLIC TEST KEY (seed 0x5a…).
// Never the publisher's key: anyone can sign with this one, so no runtime pins it outside the tests.
import { makeIdentity, hex } from '../vendor/fall-kit-core/identity.mjs';
import { sha256 } from '../vendor/fall-kit-core/vendor/light/sha256.mjs';
import { seal } from '../src/genome.mjs';
import { makeBundle } from '../src/bundle.mjs';

const enc = new TextEncoder();
export const AT = '2026-10-29T12:00:00Z';
export const PHRASE = 'a test owner phrase, public on purpose';
export const testKey = () => makeIdentity(new Uint8Array(32).fill(0x5a));
export const otherKey = () => makeIdentity(new Uint8Array(32).fill(0x33));

export const FILES = {
  'blocks/docs/index.html': enc.encode('<!doctype html><html><head><title>Docs</title></head><body>docs</body></html>'),
  'blocks/docs/app.js': enc.encode('console.log("docs");'),
  'blocks/notes/index.html': enc.encode('<!doctype html><html><head><title>Notes</title></head><body>notes</body></html>'),
};
const pin = (k) => ({ path: k.split('/').slice(2).join('/'), sha256: hex(sha256(FILES[k])), bytes: FILES[k].length });

export function body(over = {}) {
  return {
    kind: 'seed-laptop.genome', v: 1, name: 'test office',
    blocks: [
      { id: 'docs', name: 'Docs', from: 'test/docs@0000000', entry: 'index.html', files: [pin('blocks/docs/index.html'), pin('blocks/docs/app.js')] },
      { id: 'notes', name: 'Notes', from: 'test/notes@0000000', entry: 'index.html', files: [pin('blocks/notes/index.html')] },
    ],
    config: { kar: { greeting: 'hello' } },
    identity: { founder: null },
    vault: { ref: null },
    ...over,
  };
}

export const fileList = () => Object.entries(FILES).map(([path, bytes]) => ({ path, bytes }));

export async function sealed(over) {
  const k = await testKey();
  const s = await seal(body(over), k);
  return { key: k, text: s.text };
}

export async function fullSeed(over) {
  const { key, text } = await sealed(over);
  return { key, text, bytes: makeBundle(text, fileList()).bytes };
}
