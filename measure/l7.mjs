#!/usr/bin/env node
// measure/l7.mjs — claim L7, the cost case, from the owner's OWN subscription list. Committed before any list exists.
//
//   node measure/l7.mjs <list.json> --source "<how the owner gave it, and when>"
//       list.json = [{ "name": "Microsoft 365 Business Standard", "amount": "10.30", "per": "month", "seats": 2 }, …]
//       amount is what the owner pays, in pounds as they wrote it ("10.30", "107.88"); it is read to whole pence
//       exactly, from its text, never through a float.
//
// The list is the owner's, word for word: this file never supplies or changes a line. The blocks that count as
// covering are the ones that held in the measured browser run (receipts/l1b2.json, L1b2: L1b's own receipt failed on
// its probe); the vault always counts, being the office's own. The cost kernel (src/cost.mjs, its coverage map sealed in
// seal 2) classes every line; this file then re-derives every sum on its own and writes receipts/l7.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cost, yearlyOf } from '../src/cost.mjs';
import { judge } from './judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

/** "10.30" → 1030, "107.88" → 10788, "12" → 1200; null if it is not pounds and pence as written. */
export function pence(text) {
  const m = /^\s*£?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(String(text));
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')));
}

const file = process.argv[2], si = process.argv.indexOf('--source'), source = si === -1 ? '' : String(process.argv[si + 1] || '');
if (!file || !source) { console.log('usage: node measure/l7.mjs <the owner\'s list.json> --source "<how the owner gave it, and when>"'); process.exit(2); }
const given = JSON.parse(readFileSync(file, 'utf8'));
const list = given.map((x) => ({ name: x.name, amount: pence(x.amount), per: x.per, seats: x.seats === undefined ? 1 : Number(x.seats) }));
const l1b2 = JSON.parse(readFileSync(join(ROOT, 'receipts', 'l1b2.json'), 'utf8'));
const held = (l1b2.facts.L1b2 || l1b2.facts).blocks.filter((b) => b.frame === 'found' && b.loaded && b.exceptions === 0 && b.elements > 0).map((b) => b.id);
const r = cost(list, held);
const again = r.ok ? r.items.map((it, k) => yearlyOf(list[k])) : [];
const facts = {
  source, lines: given.length, given, held, result: r,
  rederived: r.ok ? { yearly: again.reduce((a, b) => a + b, 0), byLevel: ['covered', 'partly', 'not'].map((lv) => r.items.reduce((a, it, k) => a + (it.level === lv ? again[k] : 0), 0)) } : null,
};
const claims = JSON.parse(readFileSync(join(ROOT, 'measure', 'claims.json'), 'utf8')).claims.filter((c) => c.id === 'L7');
const verdicts = judge(claims, { L7: facts });
for (const v of verdicts) console.log(v.verdict.padEnd(10) + v.id + '  ' + v.says);
mkdirSync(join(ROOT, 'receipts'), { recursive: true });
writeFileSync(join(ROOT, 'receipts', 'l7.json'), JSON.stringify({ kind: 'seed-laptop.receipt', v: 1, claims: 'L7', commit: git('rev-parse', 'HEAD'), facts, verdicts }, null, 1) + String.fromCharCode(10));
