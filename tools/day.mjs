#!/usr/bin/env node
// tools/day.mjs — a sealed day of normal use, run end to end by the office's core (claim L6).
//
//   node tools/day.mjs --home <empty folder> --sink <host:port> [--out <facts.json>]
//
// The network trap (tools/trap.mjs) is installed before anything else is loaded. Then the office is planted from the
// stock seed and the day's actions run in their sealed order (planDay(SEED)): open each block, edit across the blocks,
// bring files in (verify-before-parse here, reading only in the sandbox), write files out, ask Kar, back up to the
// vault, and exactly two emails the user chooses to send to their own mail provider (the sink stands in for it). Each
// action leaves a receipt in the store. Writes the facts: actions, receipts, every network call the trap saw, and
// each send's window.
import { installTrap, attempts, openWindow, closeWindow } from './trap.mjs';
installTrap();

const { readFileSync, writeFileSync, mkdirSync, readdirSync } = await import('node:fs');
const { join, dirname, resolve } = await import('node:path');
const { fileURLToPath, pathToFileURL } = await import('node:url');
const { germinate, POLICY } = await import('../src/germinate.mjs');
const { emptyStore, write, digest, read, keysOf } = await import('../src/store.mjs');
const { writesFor, seedOf } = await import('../src/office.mjs');
const { composeDoc } = await import('../src/compose.mjs');
const { tag } = await import('../src/value.mjs');
const { parse, answer } = await import('../src/kar.mjs');
const { receipt } = await import('../src/receipt.mjs');
const { verify, declaredOf } = await import('../src/edge-in.mjs');
const { docx, xlsx, pdf, eml, ics, csv } = await import('../src/edge-out.mjs');
const { seal: sealVault } = await import('../src/vault.mjs');
const { sandboxParse } = await import('./sandbox.mjs');
const { mint, recognise, EDGE_FILES } = await import('../src/immune.mjs');
const { createHash } = await import('node:crypto');
const { sendMail } = await import('./smtp.mjs');
void POLICY;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = createHash('sha256').update(EDGE_FILES.map((f) => f + String.fromCharCode(10) + readFileSync(join(ROOT, f), 'utf8')).join(String.fromCharCode(10))).digest('hex');   // the edge's version (src/immune.mjs)
export const SEED = 20261029, PHRASE = 'the measured owner of the stock office, a public test phrase';
const B64 = (u8) => Buffer.from(u8).toString('base64');

/** The day's actions, in order: the same list every run (a seeded generator). */
export function planDay(seed, blocks, corpus) {
  let x = seed >>> 0;
  const rnd = () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const plan = [];
  for (let r = 0; r < 3; r++) for (const b of blocks) plan.push({ do: 'open', block: b });
  for (let i = 0; i < 200; i++) plan.push({ do: 'edit', block: pick(blocks), n: i });
  for (const f of corpus.slice(0, 20)) plan.push({ do: 'import', file: f });
  for (const k of ['cut-50', 'zeroed', 'polyglot', 'mislabelled', 'cut-50']) plan.push({ do: 'import-hostile', kind: k });   // the second cut-50 meets the immune memory
  for (const fmt of ['pdf', 'docx', 'xlsx', 'eml', 'ics', 'csv', 'pdf', 'docx', 'xlsx', 'eml', 'ics', 'csv']) plan.push({ do: 'export', format: fmt });
  const asks = ['help', 'list', 'recent', 'find Okafor', 'find window frames', 'open crm', 'open accounts', 'find lintel', 'what changed', 'show my office'];
  for (let i = 0; i < 40; i++) plan.push({ do: 'ask', text: asks[i % asks.length] });
  plan.push({ do: 'backup' }, { do: 'backup' }, { do: 'backup' });
  plan.push({ do: 'send', n: 1 }, { do: 'send', n: 2 });
  for (let i = plan.length - 1; i > 6 * blocks.length; i--) { const j = 3 * blocks.length + Math.floor(rnd() * (i - 3 * blocks.length)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  return plan;
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? undefined : process.argv[i + 1]; };
  const home = resolve(arg('--home'));
  const [sinkHost, sinkPort] = String(arg('--sink') || '127.0.0.1:2525').split(':');
  mkdirSync(join(home, 'out'), { recursive: true });
  const pinned = JSON.parse(readFileSync(join(ROOT, 'seeds', 'publisher.json'), 'utf8')).pinned;
  const g = await germinate({ full: new Uint8Array(readFileSync(join(ROOT, 'seeds', 'stock.full'))) }, { pinned, phrase: PHRASE, at: '2026-10-29T12:00:00Z' });
  const files = new Map(g.files.map((f) => [f.path, f.bytes]));
  const blocks = g.office.blocks.map((b) => b.id);
  const corpusDir = join(ROOT, 'corpus');
  const corpus = readdirSync(corpusDir).filter((f) => declaredOf(f)).sort();
  const me = 'd0'.repeat(16);   // the writer id of this day's one device
  let store = emptyStore();
  let receipts = 0, actions = 0;
  const put = (key, value) => { const w = write(store, me, key, value); if (w.ok) store = w.store; return w.ok; };
  const kinds = {};   // receipts by kind (a refusal by its stage), for the day's facts
  const say = (kind, facts) => { const r = receipt(kind, facts, new Date().toISOString().slice(0, 19) + 'Z'); if (r) { const k = kind === 'refused' ? 'refused at ' + facts.stage : kind; kinds[k] = (kinds[k] || 0) + 1; } if (r && put('kar/receipts/' + String(++receipts).padStart(6, '0'), ['s', JSON.stringify(r)])) return true; receipts--; return false; };
  say('grew', { seed: g.genome.name, genome: g.genome.id, blocks: g.office.blocks.length, files: g.files.length, owner: g.owner.id });
  const sends = [];
  const plan = planDay(SEED, blocks, corpus);
  for (const a of plan) {
    actions++;
    if (a.do === 'open') {
      const b = g.office.blocks.find((x) => x.id === a.block);
      const d = composeDoc(new TextDecoder().decode(files.get('blocks/' + b.id + '/' + b.entry)), { seed: seedOf(store, b.id) });
      say('opened', { block: b.name.slice(0, 80) });
      void d;
    } else if (a.do === 'edit') {
      const msg = a.n % 3 === 0 ? { t: 'ls', op: 'set', k: 'note-' + (a.n % 17), v: 'day note ' + a.n }
        : { t: 'idb', op: 'put', db: a.block + '-db', store: 'rows', key: 'row-' + (a.n % 23), value: { id: 'row-' + (a.n % 23), text: 'entry ' + a.n + ' for ' + a.block, amount: a.n * 3.5, when: new Date(Date.UTC(2026, 10, 1 + (a.n % 28))) } };
      const t = msg.t === 'idb' ? (await tag([msg.key, msg.value])).t[1] : null;
      let n = 0;
      for (const x of writesFor(store, a.block, msg, t)) n += put(x.key, x.value) ? 1 : 0;
      say('saved', { block: g.office.blocks.find((x) => x.id === a.block).name.slice(0, 80), changes: n });
    } else if (a.do === 'import' || a.do === 'import-hostile') {
      let name = a.file, bytes = new Uint8Array(readFileSync(join(corpusDir, a.file || corpus[0])));
      if (a.do === 'import-hostile') {
        name = 'hostile-' + a.kind + '.' + (a.kind === 'mislabelled' ? 'docx' : 'pdf');
        const src = corpus.find((f) => f.endsWith('.pdf'));
        bytes = new Uint8Array(readFileSync(join(corpusDir, src)));
        if (a.kind === 'cut-50') bytes = bytes.slice(0, bytes.length >> 1);
        if (a.kind === 'polyglot') bytes = Uint8Array.from([...bytes, ...readFileSync(join(corpusDir, corpus.find((f) => f.endsWith('.zip'))))]);
        if (a.kind === 'zeroed') { bytes = bytes.slice(); bytes.fill(0, 0, 16); }
      }
      const type = declaredOf(name);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const antibodies = keysOf(store, 'immune/').map((k) => JSON.parse(read(store, k).value[1]));
      if (recognise(antibodies, sha, type, EDGE, me).own) { say('refused', { what: name, stage: 'immune', why: 'these exact bytes were refused here before, so nothing read them again' }); continue; }
      const remember = (refusal) => { const ab = mint(sha, type, refusal, EDGE, me, Date.now()); if (ab) put('immune/' + sha + '.' + type + '.' + me.slice(0, 16), ['s', JSON.stringify(ab)]); };
      const v = verify(bytes, type);
      if (!v.ok) { remember(v); say('refused', { what: name, stage: v.stage, why: v.why.slice(0, 240) }); continue; }
      const r = await sandboxParse(type, bytes);
      if (!r.ok) { if (!r.killed) remember({ stage: 'reader', why: r.why }); say('quarantined', { file: name, why: String(r.why).slice(0, 240) }); continue; }
      put('file/' + sha, ['ab', B64(bytes)]);
      put('files/' + sha + '/read', (await tag(r.result)).t);
      say('imported', { file: name, type, sha });
    } else if (a.do === 'export') {
      const W = { pdf: () => pdf({ paragraphs: ['Day report', 'Every action of the day left a receipt.'] }), docx: () => docx({ paragraphs: ['Day report'] }), xlsx: () => xlsx({ sheets: [{ name: 'Day', rows: [['actions', actions]] }] }), eml: () => eml({ from: 'owner@example.com', to: 'friend@example.org', subject: 'Day', date: 'Thu, 05 Nov 2026 10:30:00 +0000', id: 'day' + actions, text: 'Day report' }), ics: () => ics({ stamp: '20261105T103000Z', events: [{ uid: 'day' + actions + '@example.com', start: '20261106T090000Z', end: '20261106T100000Z', summary: 'Review the day' }] }), csv: () => csv([['actions', String(actions)]]) };
      const bytes = W[a.format]();
      const name = 'day-' + actions + '.' + a.format;
      writeFileSync(join(home, 'out', name), bytes);
      say('exported', { file: name, format: a.format, bytes: bytes.length });
    } else if (a.do === 'ask') {
      const p = parse(a.text, g.office.blocks.map((b) => ({ id: b.id, name: b.name })));
      const ans = p.intent ? answer(p.intent, p.arg, { blocks: g.office.blocks, store, receipts: [] }) : { says: 'I did not understand: ' + p.why + '.' };
      say('asked', { asked: a.text, said: ans.says.slice(0, 600) });
    } else if (a.do === 'backup') {
      const s = await sealVault([{ path: 'store.json', bytes: new TextEncoder().encode(JSON.stringify(store)) }], PHRASE, { iterations: 100000 });
      writeFileSync(join(home, 'vault.slv'), s.bytes);
      say('saved', { block: 'The vault', changes: Object.keys(store.keys).length });
    } else if (a.do === 'send') {
      const data = eml({ from: 'Owner <owner@example.com>', to: 'friend@example.org', subject: 'The day, part ' + a.n, date: 'Thu, 05 Nov 2026 1' + a.n + ':00:00 +0000', id: 'send' + a.n, text: 'Sent by the owner, through their own mail provider.' });
      const w = { n: a.n, start: Date.now() };
      openWindow(sinkHost, Number(sinkPort));
      const r = await sendMail({ host: sinkHost, port: Number(sinkPort), from: 'owner@example.com', to: ['friend@example.org'], data });
      closeWindow();
      w.end = Date.now(); w.ok = r.ok;
      sends.push(w);
      say('exported', { file: 'email to friend@example.org', format: 'eml (sent)', bytes: data.length });
    }
  }
  const facts = { actions, receipts: receipts - 1, plan: plan.length, attempts, sends, kinds, digest: digest(store), sink: sinkHost + ':' + sinkPort };
  const out = arg('--out');
  if (out) writeFileSync(out, JSON.stringify(facts, null, 1));
  console.log(JSON.stringify({ actions, receipts: facts.receipts, attempts: attempts.length, allowed: attempts.filter((t) => t.allowed).length, sends: sends.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
