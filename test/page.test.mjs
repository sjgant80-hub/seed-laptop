// test/page.test.mjs — every figure the live page states in its own HTML is the figure of its source.
// page/page.mjs draws the measured tables from the receipts as the page loads; a few figures sit in index.html's plain
// text (the white paper, the security cards, the FAQ). Each is checked here against the receipt, the kernel constant
// or the committed file it came from, so a receipt, a constant or a sentence cannot drift apart without this failing.
// It reads; it changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { HEADER, ITERATIONS, MIN_PHRASE } from '../src/vault.mjs';
import { MIN_PHRASE as SEED_MIN_PHRASE } from '../vendor/fall-kit-core/seed.mjs';
import { TYPES } from '../src/edge-in.mjs';
import { LIMITS } from '../tools/sandbox.mjs';
import { PARAMS } from '../vendor/bes-inward/watch.mjs';
import { PER_FUNCTION } from './hostile.mjs';

const ROOT = new URL('../', import.meta.url);
const text = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const json = (p) => JSON.parse(text(p));
// the page as a reader sees its words: tags dropped, entities a reader never sees as such turned back, spaces folded
const PAGE = text('index.html').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const says = (s, why) => assert.ok(PAGE.includes(s), (why ? why + ': ' : '') + 'the page should say «' + s + '»');
const n = (x) => x.toLocaleString('en-GB');
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const MB = 1 << 20;

test('the tampering counts (claim L1c) are the receipt\'s, and every change was refused', () => {
  const c = json('receipts/l1.json').facts.L1c;
  assert.equal(c.genomeRefused, c.genomeBits); assert.equal(c.genomeFlips, c.genomeBits);
  assert.equal(c.blockRefused, c.blockCases);
  says('every one of the genome\'s ' + n(c.genomeBits) + ' bits and ' + n(c.blockCases) + ' bits across the blocks was changed in turn, and every change was refused');
});

test('the vault\'s single-bit changes (claim L4) are the receipt\'s, and every one was refused', () => {
  const v = json('receipts/l4.json').facts.L4;
  assert.equal(v.headerRefused, v.headerFlips); assert.equal(v.bodyRefused, v.bodyFlips);
  says('every one of ' + n(v.headerFlips + v.bodyFlips) + ' single-bit changes to a vault was refused');
});

test('the sealed day (claims L6, L6b, L6c2): more than the stated actions each way, and the two sends', () => {
  const l6 = json('receipts/l6.json').facts.L6, b = json('receipts/l6b.json').facts.L6b.ci, tab = json('receipts/l6c2.json').facts.L6c2.tab;
  const each = [b.actions, l6.local.actions, tab.actions];
  const floor = Math.floor(Math.min(...each) / 100) * 100;
  says('over a sealed day of more than ' + floor + ' actions');
  for (const a of each) assert.ok(a > floor, 'each way made more than ' + floor + ' actions');
  assert.equal(b.sends, b.sentOk); assert.equal(l6.local.sends, b.sends);
  says('The only traffic allowed is the ' + WORDS[b.sends] + ' emails the user chooses to send');
});

test('the stock seed\'s size in the white paper is the committed seed\'s', () => {
  const g = json('seeds/stock.genome.json').body;
  const files = g.blocks.flatMap((x) => x.files);
  const bytes = files.reduce((a, f) => a + f.bytes, 0);
  const kb = (x) => Math.round(x / 1000) + ' KB';
  says('the stock seed: ' + WORDS[g.blocks.length] + ' blocks, ' + WORDS[files.length] + ' files, ' + kb(bytes) + ' as files, ' + kb(statSync(new URL('seeds/stock.full', ROOT)).size) + ' packed');
  assert.ok(text('index.html').includes('>' + g.blocks.length + ' blocks, each in</text><text x="650" y="140" text-anchor="middle" fill="var(--dim)" font-size="12">its own sandbox<'), 'the germination diagram names the seed\'s blocks');
  // the blocks named on the page are the seed's own, in its order, by the repositories they come from
  const repos = g.blocks.map((x) => x.from.replace(/^[^/]+\//, '').replace(/@.*$/, ''));
  const words = WORDS[g.blocks.length];
  says(words[0].toUpperCase() + words.slice(1) + ' blocks of existing estate gear, each pinned by hash: ' + repos[0] + ' (Words, Sheets, Slides, Calendar, Notes, Tasks), ' + repos.slice(1).join(', ') + '.');
  says('the ' + words + ' blocks (' + repos.join(', ') + ')');
});

test('the vault\'s cipher settings are the vault kernel\'s', () => {
  says('PBKDF2-SHA256, ' + n(ITERATIONS) + ' rounds');
  assert.equal(PAGE.split('PBKDF2-SHA256, ' + n(ITERATIONS) + ' rounds').length, 3, 'both places that name the rounds');
  says('its ' + HEADER + '-byte header is the cipher\'s additional data');
  assert.equal(MIN_PHRASE, SEED_MIN_PHRASE, 'the vault and the owner identity take the same shortest phrase');
  says('Type a phrase of at least ' + MIN_PHRASE + ' characters twice');
});

test('the sandbox\'s limits and every file cap are the kernels\'', () => {
  says('a ' + LIMITS.heapMb + ' MB heap and a ' + LIMITS.ms / 1000 + ' s limit');
  says('Each reading has ' + LIMITS.ms / 1000 + ' seconds (and, on a laptop, ' + LIMITS.heapMb + ' MB of memory)');
  const cap = (t) => TYPES[t].max / MB;
  assert.equal(cap('docx'), cap('xlsx')); assert.equal(cap('ics'), cap('vcf'));
  for (const t of ['jpeg', 'gif', 'webp']) assert.equal(cap(t), cap('png'), t + ' shares the image cap');
  says('PDF ' + cap('pdf') + ' MB, Word and Excel ' + cap('docx') + ' MB, zip ' + cap('zip') + ' MB, email ' + cap('eml') + ' MB, calendars and contacts ' + cap('ics') + ' MB, CSV ' + cap('csv') + ' MB, images ' + cap('png') + ' MB');
  assert.deepEqual(Object.keys(TYPES).sort(), ['csv', 'docx', 'eml', 'gif', 'ics', 'jpeg', 'pdf', 'png', 'vcf', 'webp', 'xlsx', 'zip'], 'the page names every type the edge reads');
});

test('the behaviour watch\'s forming time and the hostile battery are the code\'s', () => {
  says('it learns how you work over ' + PARAMS.formDays + ' days');
  assert.equal(json('measure/claims.json').claims.find((c) => c.id === 'G1').bound.fuzz_per_function, PER_FUNCTION, 'the battery is the size G1 sealed');
  says(n(PER_FUNCTION) + ' hostile inputs per function');
  assert.ok(text('page/page.mjs').includes('The hostile-input battery (' + n(PER_FUNCTION) + ' inputs per function)'), 'the G1 row says the same');
});

test('the failures the risks section counts are the receipts\' failures', () => {
  const failed = new Set();
  for (const f of ['l1', 'l1b2', 'l1e', 'l2', 'l3', 'l3b', 'l4', 'l5', 'l6', 'l6b', 'l6c2']) for (const v of json('receipts/' + f + '.json').verdicts) if (v.verdict === 'FAILED') failed.add(v.id);
  assert.deepEqual([...failed].sort(), ['L1b', 'L2b', 'L3', 'L6', 'L6c2']);
  // the instrument's faults are the failed claims a later seal fixed: L1b by L1b2, L3 by L3b, L6 by L6b (L6c2, the fix for
  // L6's tab day, failed on its own count and is one of the office's)
  const fixes = { L1b: 'L1b2', L3: 'L3b', L6: 'L6b' };
  for (const [was, fix] of Object.entries(fixes)) assert.ok(text('measure/claims-' + { L1b2: 'c', L3b: 'e', L6b: 'b' }[fix] + '.json').includes('"' + fix + '"'), fix + ' is sealed');
  const office = [...failed].filter((id) => !fixes[id]);
  says(WORDS[Object.keys(fixes).length].replace(/^t/, 'T') + ' failed because of a fault in the measuring instrument');
  says(WORDS[office.length].replace(/^t/, 'T') + ' are about the office itself');
});

test('Node 25: what the page asks for is what the package requires', () => {
  assert.equal(json('package.json').engines.node, '>=25');
  says('On a machine with Node 25 you can also plant from the command line');
});
