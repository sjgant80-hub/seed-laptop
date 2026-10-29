#!/usr/bin/env node
// tools/vendor-blocks.mjs — the office's blocks: estate gear, copied byte for byte from the commit named, and pinned.
// Layer 4 of the seed laptop: the office is REUSED gear, never rebuilt. Each block runs as its repo shipped it.
//
//   node tools/vendor-blocks.mjs            fetch every file in BLOCKS from GitHub at its commit → blocks/<id>/,
//                                           write blocks/SOURCES.json (id, repo, commit, path, sha256, bytes)
//   node tools/vendor-blocks.mjs --check    re-hash every vendored file against SOURCES.json (no network; CI runs it)
//   node tools/vendor-blocks.mjs --remote   fetch each file again at its commit and compare (CI runs it too)
//
// Never edit a vendored block: re-vendor. Bytes are taken exactly as committed upstream (CR bytes included, if any).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'blocks', 'SOURCES.json');

// The stock office. Each: the block id the genome uses, a name for the owner, the estate repo and the exact commit.
export const BLOCKS = [
  { id: 'office', name: 'Words, Sheets, Slides, Calendar, Notes, Tasks', repo: 'falloffice', commit: '17d753c84c8db4ad4ab478a05d6c88d46444e211', files: ['index.html'], entry: 'index.html' },
  { id: 'crm', name: 'Contacts and deals', repo: 'fallcrm', commit: '5cee90fcc1d47cfc2c4384b6e36e08d986841d97', files: ['index.html'], entry: 'index.html' },
  { id: 'ledger', name: 'Accounts', repo: 'fallledger', commit: '6bc2c912b8e38b3a5df754348030a3f846234d78', files: ['index.html'], entry: 'index.html' },
  { id: 'pdf', name: 'PDF writer', repo: 'fallpdf', commit: 'afd97f57cd2f366738c161a70b379f88f26d5273', files: ['index.html'], entry: 'index.html' },
  { id: 'mind', name: 'Knowledge notebook', repo: 'seedmind', commit: '049ce43b9b3ff3d35f6f73c168320ae0ed57ce6e', files: ['index.html', 'seedmind.mjs'], entry: 'index.html' },
  { id: 'image', name: 'Image editor', repo: 'fallmage', commit: 'HEAD', files: ['index.html'], entry: 'index.html' },
  { id: 'layout', name: 'Page layout', repo: 'fallpage', commit: 'HEAD', files: ['index.html'], entry: 'index.html' },
];

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function fetchAt(repo, commit, path) {
  const url = 'https://raw.githubusercontent.com/sjgant80-hub/' + repo + '/' + commit + '/' + path;
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

async function commitOf(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const r = await fetch('https://api.github.com/repos/sjgant80-hub/' + repo + '/commits/' + ref, { headers: { accept: 'application/vnd.github.sha' } });
  if (!r.ok) throw new Error(repo + '@' + ref + ' → ' + r.status);
  return (await r.text()).trim();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--check') || args.includes('--remote')) {
    const s = JSON.parse(readFileSync(SOURCES, 'utf8'));
    let bad = 0;
    for (const f of s.files) {
      const local = readFileSync(join(ROOT, 'blocks', f.id, f.path));
      if (sha(local) !== f.sha256 || local.length !== f.bytes) { bad++; console.log('✗ blocks/' + f.id + '/' + f.path + ' differs from its pin'); }
      if (args.includes('--remote')) {
        const up = await fetchAt(f.repo, f.commit, f.path);
        if (sha(up) !== f.sha256) { bad++; console.log('✗ ' + f.repo + '@' + f.commit.slice(0, 7) + ':' + f.path + ' is not the pinned bytes'); }
      }
    }
    console.log(bad ? 'BLOCK CHECK FAILED' : 'BLOCK CHECK CLEAN — ' + s.files.length + ' files byte-identical to their pinned commits' + (args.includes('--remote') ? ' (fetched again from GitHub)' : ''));
    process.exit(bad ? 1 : 0);
  }
  const files = [];
  for (const b of BLOCKS) {
    const commit = await commitOf(b.repo, b.commit);
    for (const p of b.files) {
      const bytes = await fetchAt(b.repo, commit, p);
      const out = join(ROOT, 'blocks', b.id, p);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      files.push({ id: b.id, path: p, repo: 'sjgant80-hub/' + b.repo, commit, sha256: sha(bytes), bytes: bytes.length });
    }
    console.log('✓ ' + b.id.padEnd(7) + ' ' + b.repo + '@' + commit.slice(0, 7) + ' · ' + b.files.join(', '));
  }
  const blocks = BLOCKS.map((b) => ({ id: b.id, name: b.name, entry: b.entry, repo: 'sjgant80-hub/' + b.repo, commit: files.find((f) => f.id === b.id).commit }));
  writeFileSync(SOURCES, JSON.stringify({ kind: 'seed-laptop.blocks', v: 1, note: 'Copied verbatim from each estate repo at the commit named. Never edit a block; re-vendor.', blocks, files }, null, 1) + '\n');
  console.log('vendored ' + files.length + ' files of ' + BLOCKS.length + ' blocks');
}
