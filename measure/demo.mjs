#!/usr/bin/env node
// measure/demo.mjs — the on-camera demo, recorded as receipts: the real office in Chrome, the network off, driven
// step by step the way a person would, every step's own receipts (the office writes them, not this file) and a
// screenshot kept. Writes receipts/demo.json and page/demo/*.png. Not a measurement of a claim: the claims' receipts
// are the measurements; this is the same office, shown.
//
//   node measure/demo.mjs
//
// The story: plant the stock seed; meet Kar; open the blocks; bring in real files from the corpus and three hostile
// ones (a PDF cut short, the same again, a PDF named .docx); read a letter; write one out; ask Kar; save the vault;
// then a new machine (a fresh browser profile): regrow from the seed, the vault and the phrase, and find it all back.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform, release } from 'node:os';
import { launch } from '../tools/cdp.mjs';
import { serve } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.out', 'demo'), SHOTS = join(ROOT, 'page', 'demo');
const PHRASE = 'the demo owner of the stock office, a public test phrase';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
rmSync(OUT, { recursive: true, force: true }); mkdirSync(join(OUT, 'dl'), { recursive: true }); mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) if (f.endsWith('.png')) rmSync(join(SHOTS, f));
const corpus = join(ROOT, 'corpus');
const pdfB = readFileSync(join(corpus, 'letter-reportlab.pdf'));
writeFileSync(join(OUT, 'letter-cut.pdf'), pdfB.subarray(0, pdfB.length >> 1));
writeFileSync(join(OUT, 'letter-renamed.docx'), pdfB);

const srv = await serve(ROOT);
const steps = [];
let chrome = '';

async function machine(name) {
  const c = await launch({ profile: join(OUT, name) });
  chrome = c.version || chrome;
  const p = await c.page();
  await p.send('Runtime.enable'); await p.send('Network.enable'); await p.send('DOM.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await c.browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(OUT, 'dl'), eventsEnabled: true });
  await p.send('Page.navigate', { url: srv.url + 'office/' });
  for (let i = 0; i < 150 && !(await p.eval('!!(window.__office && window.__office.ready)')); i++) await wait(100);
  await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  return { c, p };
}
const receiptsOf = (p) => p.eval("(() => { const st = window.__office_store ? window.__office_store() : null; if (!st) return []; return Object.keys(st.keys).filter((k) => k.startsWith('kar/receipts/')).sort().map((k) => { try { const v = st.keys[k]; const last = v[v.length - 1]; return JSON.parse(last.v[1]).says; } catch { return null; } }).filter(Boolean); })()");
async function step(p, did, fn) {
  const before = (await receiptsOf(p)).length;
  const t0 = Date.now();
  await fn();
  const all = await receiptsOf(p);
  const n = steps.length + 1, shot = 'demo/' + String(n).padStart(2, '0') + '.png';
  const s = await p.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ROOT, 'page', shot), Buffer.from(s.data, 'base64'));
  steps.push({ n, did, ms: Date.now() - t0, receipts: all.slice(before), screenshot: 'page/' + shot });
  console.log(n + '. ' + did + ' → ' + all.slice(before).length + ' receipt(s)');
}
const click = (p, sel) => p.eval(`document.querySelector(${JSON.stringify(sel)}).click(); true`);
const setFiles = async (p, sel, files) => { const { root } = await p.send('DOM.getDocument', {}); const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); await p.send('DOM.setFileInputFiles', { nodeId, files }); };
const until = async (p, expr, n = 200) => { for (let i = 0; i < n && !(await p.eval(expr)); i++) await wait(100); };

// ── machine one ──
const one = await machine('machine-one');
let p = one.p;
await step(p, 'Plant the stock seed, with the network off, and meet Kar', async () => {
  await p.eval(`document.getElementById('phrase').value=${JSON.stringify(PHRASE)};document.getElementById('phrase2').value=${JSON.stringify(PHRASE)};true`);
  await click(p, '#plant-stock'); await until(p, '!!window.__office.planted'); await wait(400);
});
const planted = await p.eval('window.__office.planted');
for (const id of planted.blocks) {
  await step(p, 'Open the ' + id + ' block from the rail', async () => { await click(p, '#rail button[data-id="' + id + '"]'); await until(p, `!!window.__office.loaded[${JSON.stringify(id)}]`); await wait(700); });
}
await step(p, 'Bring in real files from the old world, and three hostile ones', async () => {
  await click(p, '#rail button[data-id="files"]');
  const files = ['letter-reportlab.pdf', 'letter-libreoffice.docx', 'orders-openpyxl.xlsx', 'mail-1.eml', 'diary.ics', 'contacts.vcf', 'orders-python.csv', 'photo.jpg'].map((f) => join(corpus, f));
  await setFiles(p, '#file-in', [...files, join(OUT, 'letter-cut.pdf'), join(OUT, 'letter-renamed.docx')]);
  await until(p, "/brought in/.test(document.getElementById('file-says').textContent)"); await wait(500);
});
await step(p, 'Bring the cut-short PDF in again: the edge remembers it', async () => {
  await setFiles(p, '#file-in', [join(OUT, 'letter-cut.pdf')]);
  await wait(300); await until(p, "/brought in/.test(document.getElementById('file-says').textContent)"); await wait(400);
});
await step(p, 'Open the letter: its reading, beside the original kept unchanged', async () => {
  await p.eval("(() => { const r = [...document.querySelectorAll('#file-rows tr')].find((tr) => /letter-reportlab/.test(tr.textContent)); r.querySelector('button').click(); return true; })()"); await wait(500);
});
await step(p, 'Write a letter out as PDF and as Word', async () => {
  await click(p, '#rail button[data-id="write"]');
  await p.eval("document.getElementById('w-title').value='Thank you';document.getElementById('w-body').value='Dear Ms Okafor,\\n\\nThank you for the order of window frames. They will be with you on Friday.\\n\\nWith best wishes';true");
  await click(p, '[data-out="pdf"]'); await wait(800); await click(p, '[data-out="docx"]'); await wait(800);
});
await step(p, 'Ask Kar to find something', async () => {
  await click(p, '#rail button[data-id="kar"]');
  await p.eval("document.getElementById('ask-text').value='find Okafor';document.getElementById('ask').requestSubmit();true"); await wait(600);
});
await step(p, 'Save the vault, encrypted with the phrase', async () => {
  await click(p, '#rail button[data-id="backup"]');
  await p.eval(`document.getElementById('backup-phrase').value=${JSON.stringify(PHRASE)};true`);
  await click(p, '#backup-save'); await until(p, "/^(Saved|Not)/.test(document.getElementById('backup-says').textContent)"); await wait(1500);
});
await step(p, 'Read the receipts: one plain sentence for every action', async () => { await click(p, '#rail button[data-id="receipts"]'); await wait(400); });
const keysOne = await p.eval('Object.keys(window.__office_store().keys).filter((k) => !k.startsWith("kar/receipts/")).length');
await one.c.close();

// ── machine two: a fresh profile stands in for a new machine ──
const vault = readdirSync(join(OUT, 'dl')).find((f) => f.endsWith('.slv'));
if (!vault) throw new Error('the demo saved no vault');
const two = await machine('machine-two');
p = two.p;
await step(p, 'On a new machine: regrow from the seed, the vault and the phrase', async () => {
  await p.eval(`document.getElementById('phrase').value=${JSON.stringify(PHRASE)};document.getElementById('phrase2').value=${JSON.stringify(PHRASE)};true`);
  await setFiles(p, '#vault-file', [join(OUT, 'dl', vault)]);
  await until(p, '!!window.__office.planted'); await wait(800);
});
await step(p, 'Everything is back: the files, their readings, the originals', async () => { await click(p, '#rail button[data-id="files"]'); await wait(500); });
const keysTwo = await p.eval('Object.keys(window.__office_store().keys).filter((k) => !k.startsWith("kar/receipts/")).length');
await step(p, 'The behaviour watch on the new machine: observe-only while it learns', async () => { await click(p, '#rail button[data-id="backup"]'); await wait(300); });
await two.c.close(); await srv.close();

const doc = { kind: 'seed-laptop.demo', v: 1, commit: git('rev-parse', 'HEAD'), machine: { os: platform() + ' ' + release(), node: process.version, chrome }, phrase: 'a public test phrase', downloads: readdirSync(join(OUT, 'dl')).sort(), kept: { machineOne: keysOne, machineTwo: keysTwo }, steps };
writeFileSync(join(ROOT, 'receipts', 'demo.json'), JSON.stringify(doc, null, 1) + '\n');
console.log('demo: ' + steps.length + ' steps, ' + steps.reduce((a, s) => a + s.receipts.length, 0) + ' receipts; entries kept ' + keysOne + ' → regrown ' + keysTwo);
