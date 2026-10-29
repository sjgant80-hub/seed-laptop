// measure/pins.mjs — a measurement runs only on the files seal 2 pinned (measure/params.json).
//   checkPins(root) → [] when every pinned file is the one sealed; else the list of files that differ
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function checkPins(root) {
  const p = JSON.parse(readFileSync(join(root, 'measure', 'params.json'), 'utf8'));
  const want = [
    ['seeds/stock.genome.json', p.stock.genome], ['seeds/stock.full', p.stock.full], ['seeds/publisher.json', p.stock.publisher],
    ['measure/out-content.json', p.outContent],
    ...Object.entries(p.corpus).map(([f, h]) => ['corpus/' + f, h]),
  ];
  return want.filter(([f, h]) => !existsSync(join(root, f)) || sha(join(root, f)) !== h).map(([f]) => f);
}

export function requirePins(root) {
  const bad = checkPins(root);
  if (bad.length) { console.log('REFUSED: these files are not the ones seal 2 pinned: ' + bad.join(', ')); process.exit(2); }
}
