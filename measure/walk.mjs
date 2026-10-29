#!/usr/bin/env node
// measure/walk.mjs — the prospective-client walkthrough: buyer personas read the live page cold and list every gap.
//
//   node measure/walk.mjs [url]     default https://sjgant80-hub.github.io/seed-laptop/
//
// Chrome opens the page and waits for its receipts to load, so the personas read what a visitor reads, numbers and
// all; the buttons and links are exercised separately (every link fetched, the calculator run). Each persona is a local
// model on this machine (Ollama, qwen2.5:7b): nothing about the page or the build leaves the laptop. Writes
// receipts/walks.json (the personas' words, verbatim) for the gaps to be answered on the page before "done".
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launch } from '../tools/cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.argv[2] || 'https://sjgant80-hub.github.io/seed-laptop/';
const MODEL = 'qwen2.5:7b', OLLAMA = 'http://127.0.0.1:11434/api/generate';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PERSONAS = [
  ['CFO of a 60-person professional-services firm', 'You sign off every software spend. You want the saving in money, what stays on the bill, the risks to the business, and who carries them.'],
  ['CTO and CISO of a 200-person company', 'You own security, data protection and the IT estate. You want to know what runs, what can reach the network, how keys and recovery work, and what an auditor would ask.'],
  ['COO of a 40-person firm with two offices', 'You run operations. You want to know how people start, what happens when a laptop is lost, how the roll-out goes team by team, and who supports it.'],
  ['owner-manager of a 12-person accountancy practice', 'You decide everything yourself and have no IT team. You want to know if your people can use it, what it replaces, and what happens if something goes wrong.'],
  ['procurement lead at a public body', 'You must justify any supplier. You want the supplier named, the licence, support terms, the evidence behind every claim, and the exit route.'],
];
const ASK = 'Walk this product page as a sceptical buyer who has never heard of it. Answer in four numbered lists, quoting the page where you can:\n'
  + '1. What confused you or was unclear.\n2. Objections the page does not answer.\n3. Claims you could not find evidence for on the page.\n4. What would stop you signing, and what would make you sign.\nBe specific and short. Do not invent facts about the product.';

// node:http with no timeout: a CPU model reads a long page for minutes before it answers (fetch gives up at 5)
function ask(prompt, system) {
  const body = JSON.stringify({ model: MODEL, prompt, system, stream: false, options: { temperature: 0.2, num_ctx: 16384 } });
  return new Promise((ok, no) => {
    const req = http.request(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (d) => { t += d; });
      res.on('end', () => { if (res.statusCode !== 200) return no(new Error('the local model answered ' + res.statusCode)); try { ok(JSON.parse(t).response); } catch (e) { no(e); } });
    });
    req.setTimeout(0); req.on('error', no); req.end(body);
  });
}

const profile = join(ROOT, '.out', 'walk');
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
const c = await launch({ profile });
const p = await c.page();
await p.send('Runtime.enable');
await p.send('Page.navigate', { url: URL_ });
for (let i = 0; i < 200 && !(await p.eval('!!window.__page')); i++) await wait(100);
const text = await p.eval('document.body.innerText');
const links = await p.eval("[...document.querySelectorAll('a[href]')].map((a) => a.href)");
await c.close();
const checked = [];
for (const href of [...new Set(links)]) {
  if (!/^https?:/.test(href)) continue;
  let status = 0;
  try { status = (await fetch(href, { method: 'GET', redirect: 'follow' })).status; } catch { status = 0; }
  checked.push({ href, status });
}
const walks = [];
for (const [who, brief] of PERSONAS) {
  const t0 = Date.now();
  const said = await ask('THE PAGE, as rendered:\n\n' + text.slice(0, 48000) + '\n\nYOU ARE the ' + who + '. ' + brief + '\n\n' + ASK, 'You read product pages as the buyer you are told you are.');
  walks.push({ who, ms: Date.now() - t0, said });
  console.log('— ' + who + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
}
const doc = { kind: 'seed-laptop.walks', v: 1, url: URL_, model: MODEL, commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), at: new Date().toISOString(), pageChars: text.length, links: checked, walks };
writeFileSync(join(ROOT, 'receipts', 'walks.json'), JSON.stringify(doc, null, 1) + '\n');
console.log('links: ' + checked.filter((l) => l.status === 200).length + ' of ' + checked.length + ' answered 200; broken: ' + checked.filter((l) => l.status !== 200).map((l) => l.status + ' ' + l.href).join(', '));
