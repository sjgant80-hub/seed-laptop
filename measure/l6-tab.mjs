// measure/l6-tab.mjs — claim L6 (c): the sealed day (tools/day.mjs planDay), driven through the real office in a Chrome
// tab over DevTools: the rail opens blocks, each block saves inside its own sandboxed frame, files come in through the
// Files panel (the day's hostile four too), files are written out, Kar is asked, the vault is saved. A "send" in a tab is
// the email written out for the owner's mail app: a browser has no mail connection, so in the tab nothing is sent at all.
// Every request from the page and every frame is watched; one that goes to another origin and is not refused by the
// browser's policy before it is sent counts as having left.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { launch, CHROME } from '../tools/cdp.mjs';
import { serve } from '../tools/serve.mjs';
import { planDay, SEED, PHRASE } from '../tools/day.mjs';
import { declaredOf } from '../src/edge-in.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function dayInTab() {
  if (!CHROME) return null;
  const dir = join(ROOT, '.out', 'l6', 'tab');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'downloads'), { recursive: true });
  const corpus = readdirSync(join(ROOT, 'corpus')).filter((f) => declaredOf(f)).sort();
  const pdfName = corpus.find((f) => f.endsWith('.pdf')), zipName = corpus.find((f) => f.endsWith('.zip'));
  const pdf = readFileSync(join(ROOT, 'corpus', pdfName));
  const hostile = { 'cut-50': ['hostile-cut-50.pdf', pdf.subarray(0, pdf.length >> 1)], zeroed: ['hostile-zeroed.pdf', (() => { const x = Buffer.from(pdf); x.fill(0, 0, 16); return x; })()], polyglot: ['hostile-polyglot.pdf', Buffer.concat([pdf, readFileSync(join(ROOT, 'corpus', zipName))])], mislabelled: ['hostile-mislabelled.docx', pdf] };
  for (const [, [n, b]] of Object.entries(hostile)) writeFileSync(join(dir, n), b);

  const srv = await serve(ROOT);
  const profile = join(ROOT, '.out', 'ct' + (Date.now() % 100000));
  const c = await launch({ profile });
  const p = await c.page();
  const urls = new Map(), failed = new Map(), frames = new Map();
  const watch = (sid) => {
    c.browser.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url), sid);
    c.browser.on('Network.loadingFailed', (e) => failed.set(e.requestId, e.blockedReason || ''), sid);
  };
  c.browser.on('Target.attachedToTarget', async (e) => {
    const m = /frame\.html\?b=([a-z0-9_-]+)/.exec(e.targetInfo.url);
    if (m) frames.set(m[1], e.sessionId);
    watch(e.sessionId);
    try { await c.browser.send('Network.enable', {}, e.sessionId); await c.browser.send('Runtime.enable', {}, e.sessionId); await c.browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, e.sessionId); } catch { /* gone */ }
  }, p.sessionId);
  watch(p.sessionId);
  await p.send('Network.enable'); await p.send('Runtime.enable'); await p.send('DOM.enable');
  await p.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await c.browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(dir, 'downloads') });
  await p.send('Page.navigate', { url: srv.url + 'office/' });
  for (let i = 0; i < 120 && !(await p.eval('!!(window.__office && window.__office.ready)')); i++) await wait(100);
  const js = (s) => p.eval(s);
  await js(`document.getElementById('phrase').value = ${JSON.stringify(PHRASE)}; document.getElementById('phrase2').value = ${JSON.stringify(PHRASE)}; document.getElementById('plant-stock').click(); true`);
  for (let i = 0; i < 300 && !(await js('!!window.__office.planted')); i++) await wait(50);
  const blocks = await js('window.__office.planted.blocks');
  const setFiles = async (sel, files) => { const { root } = await p.send('DOM.getDocument', {}); const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }); await p.send('DOM.setFileInputFiles', { nodeId, files }); };
  const receipts = () => js("Object.keys(window.__office_store ? window.__office_store().keys : {}).filter((k) => k.startsWith('kar/receipts/')).length");
  const plan = planDay(SEED, blocks, corpus);
  let done = 0;
  const t0 = Date.now();
  for (const a of plan) {
    if (a.do === 'open') {
      await js(`document.querySelector('#rail button[data-id="${a.block}"]').click(); true`);
      for (let i = 0; i < 200 && !(await js(`!!window.__office.loaded[${JSON.stringify(a.block)}]`)); i++) await wait(25);
    } else if (a.do === 'edit') {
      const sid = frames.get(a.block);
      if (sid) await c.browser.send('Runtime.evaluate', { expression: `localStorage.setItem('day-note-${a.n % 17}', 'day note ${a.n}')`, returnByValue: true }, sid);
      await wait(1150);   // a block's saves within a second are one receipt: one save, one receipt
    } else if (a.do === 'import' || a.do === 'import-hostile') {
      const file = a.do === 'import' ? join(ROOT, 'corpus', a.file) : join(dir, hostile[a.kind][0]);
      await js("document.querySelector('#rail button[data-id=\"files\"]').click(); true");
      const before = await js('window.__office.events.length');
      await setFiles('#file-in', [file]);
      for (let i = 0; i < 300; i++) { if ((await js("document.getElementById('file-says').textContent")).includes('brought in')) break; await wait(50); }
      await js("document.getElementById('file-says').textContent = ''; true");
      void before;
    } else if (a.do === 'export' || a.do === 'send') {
      await js("document.querySelector('#rail button[data-id=\"write\"]').click(); true");
      const fmt = a.do === 'send' ? 'eml' : a.format;
      await js(`(() => { const $ = (i) => document.getElementById(i); $('w-title').value = 'day ${done}'; $('w-body').value = 'Day report'; $('w-from').value = 'owner@example.com'; $('w-to').value = 'friend@example.org'; $('w-subject').value = 'The day ${done}'; $('w-mail').value = 'Sent by the owner'; $('w-event').value = 'Review'; $('w-place').value = 'Office'; $('w-table').value = 'actions,${done}'; document.querySelector('[data-out="${fmt}"]').click(); return true; })()`);
      await wait(150);
    } else if (a.do === 'ask') {
      await js("document.querySelector('#rail button[data-id=\"kar\"]').click(); true");
      await js(`document.getElementById('ask-text').value = ${JSON.stringify(a.text)}; document.getElementById('ask').requestSubmit(); true`);
    } else if (a.do === 'backup') {
      await js("document.querySelector('#rail button[data-id=\"backup\"]').click(); true");
      await js(`document.getElementById('backup-phrase').value = ${JSON.stringify(PHRASE)}; document.getElementById('backup-save').click(); true`);
      for (let i = 0; i < 100; i++) { if ((await js("document.getElementById('backup-says').textContent")).startsWith('Saved')) break; await wait(50); }
      await js("document.getElementById('backup-says').textContent = ''; true");
    }
    done++;
  }
  await wait(2000);
  const count = await receipts();
  const other = [...urls].filter(([, u]) => !u.startsWith(srv.url) && !/^(data|blob|about|chrome-extension|devtools):/.test(u));
  const refused = other.filter(([id]) => failed.get(id)).length;
  const facts = { actions: done, plan: plan.length, receipts: count - 1, left: other.length - refused, refused, hosts: [...new Set(other.map(([, u]) => { try { return new URL(u).host; } catch { return '?'; } }))].sort(), ms: Date.now() - t0, chrome: c.version };
  await c.close(); await srv.close();
  rmSync(profile, { recursive: true, force: true });
  return facts;
}
