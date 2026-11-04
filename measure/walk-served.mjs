#!/usr/bin/env node
// measure/walk-served.mjs — the buyer walk's mechanical half: open the SERVED page cold in headless Chrome (its own
// throwaway profile), read every section, press every button of the cost case with good and bad inputs, open every
// question, fetch every link, then again at phone width and in the dark scheme, and the office from the hero button.
// It decides nothing: it records what a visitor would see, for the persona reading (receipts/walk-2026-11-04.json).
//
//   node measure/walk-served.mjs [url]      default https://sjgant80-hub.github.io/seed-laptop/
//       writes .out/walk-served/record.json and its screenshots (never committed; the receipt quotes the record)
import { launch } from '../tools/cdp.mjs';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'walk-served');
mkdirSync(HERE, { recursive: true });
const URL0 = process.argv[2] || 'https://sjgant80-hub.github.io/seed-laptop/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { url: URL0, at: new Date().toISOString(), errors: [], failed: [], sections: {}, actions: [], links: [], mobile: {}, dark: {} };
const profile = join(HERE, 'profile');
rmSync(profile, { recursive: true, force: true });
const c = await launch({ profile });
out.chrome = c.version;
const p = await c.page();
await p.send('Runtime.enable'); await p.send('Network.enable'); await p.send('Page.enable'); await p.send('Log.enable');
p.on('Runtime.exceptionThrown', (e) => out.errors.push('exception: ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
p.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error' || e.type === 'warning') out.errors.push('console.' + e.type + ': ' + e.args.map((a) => a.value ?? a.description).join(' ')); });
p.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') out.errors.push('log: ' + e.entry.text + ' ' + (e.entry.url || '')); });
p.on('Network.responseReceived', (e) => { if (e.response.status >= 400) out.failed.push(e.response.status + ' ' + e.response.url); });
p.on('Network.loadingFailed', (e) => out.failed.push('failed ' + e.errorText + ' ' + (e.type || '')));

const shot = async (name) => { const r = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(HERE, name + '.png'), Buffer.from(r.data, 'base64')); };
const text = (sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText : null; })()`);

await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const ready = async () => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { if (await p.eval('!!window.__page')) return Date.now() - t0; await wait(100); } return null; };
await p.send('Page.navigate', { url: URL0 + '?v=' + Date.now() });
out.readyMs = await ready();
await wait(500);
for (const id of ['what', 'start', 'how', 'demo', 'blueprint', 'results', 'business', 'cost', 'security', 'rollout', 'risks', 'board', 'paper', 'words', 'faq']) out.sections[id] = await text('#' + id);
out.page = await p.eval('JSON.stringify(window.__page ? { coverage: window.__page.coverage, working: window.__page.working, rows: window.__page.rows.map((r) => r.id + ":" + r.verdict) } : null)');
await p.eval("document.querySelector('#cost').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('desk-cost');

// the worked example: as loaded, then 10 years, then a bad year, then CRM unticked, then a bad people count
const ex = async (label, js) => { await p.eval("(() => { " + js + " })()"); await wait(400); out.actions.push({ label, result: await text('#example') }); };
await ex('example as loaded', 'void 0');
await ex('example: years 10, submit', "document.getElementById('example-years').value='10'; document.getElementById('example-form').requestSubmit()");
await ex('example: years 11, submit', "document.getElementById('example-years').value='11'; document.getElementById('example-form').requestSubmit()");
await ex('example: years 3, CRM unticked (change event)', "document.getElementById('example-years').value='3'; const b=document.querySelector('#example-rows input[type=checkbox]'); b.checked=false; b.dispatchEvent(new Event('change',{bubbles:true}))");
await ex('example: CRM people 2.5', "const n=document.querySelector('#example-rows input[inputmode=numeric]'); n.value='2.5'; document.getElementById('example-form').requestSubmit()");
await ex('example: CRM people 10 and ticked again', "const n=document.querySelector('#example-rows input[inputmode=numeric]'); n.value='10'; const b=document.querySelector('#example-rows input[type=checkbox]'); b.checked=true; document.getElementById('example-form').requestSubmit()");

// the visitor's own calculator: empty submit, then three typed lines (test inputs of the walk, not figures on the page)
const calc = async (label, js) => { await p.eval("(() => { " + js + " })()"); await wait(400); out.actions.push({ label, result: await text('#calc-out') }); };
await calc('calculator: submit with nothing typed', "document.getElementById('calc').requestSubmit()");
await calc('calculator: three lines typed, one partly-covered ticked, add a line pressed', `(() => {
  const rows = document.getElementById('calc-rows').children;
  const fill = (d, n, a, per, s, m) => { const [ni, ai, pi, si, mi] = d.querySelectorAll('input, select'); ni.value = n; ai.value = a; pi.value = per; si.value = s; mi.checked = m; };
  fill(rows[0], 'Pipedrive', '24.00', 'month', '4', false);
  fill(rows[1], 'Xero Standard', '33', 'month', '1', true);
  fill(rows[2], 'Zoom Pro', '149.90', 'year', '2', false);
  document.getElementById('calc-add').click();
  document.getElementById('calc').requestSubmit();
  return document.getElementById('calc-rows').children.length;
})()`);
await calc('calculator: a bad amount', "document.querySelector('#calc-rows input[aria-label=\"Amount in pounds\"]').value='twelve'; document.getElementById('calc').requestSubmit()");
await calc('calculator: years 0', "document.querySelector('#calc-rows input[aria-label=\"Amount in pounds\"]').value='24.00'; document.getElementById('calc-years').value='0'; document.getElementById('calc').requestSubmit()");
await p.eval("document.getElementById('calc-years').value='3'; document.getElementById('calc').requestSubmit(); document.querySelector('#calc-out').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('desk-calc');
out.sources = await text('#sources');

// every link on the page, fetched (same origin and outside), and every details opened
out.details = await p.eval("[...document.querySelectorAll('details')].map((d) => { d.open = true; return d.querySelector('summary').innerText; })");
const hrefs = await p.eval("[...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href))]");
for (const h of hrefs) {
  if (h.startsWith(URL0.replace(/\/$/, '')) && h.includes('#')) { const id = h.split('#')[1]; out.links.push({ href: h, status: (await p.eval(`!!document.getElementById(${JSON.stringify(id)})`)) ? 'anchor ok' : 'ANCHOR MISSING' }); continue; }
  try { const r = await fetch(h, { method: 'GET', redirect: 'follow' }); out.links.push({ href: h, status: r.status, type: r.headers.get('content-type') }); } catch (e) { out.links.push({ href: h, status: 'ERR ' + e.message }); }
}
out.controls = await p.eval(`[...document.querySelectorAll('input, select, button, textarea')].filter((e) => e.type !== 'hidden').map((e) => ({ tag: e.tagName, type: e.type, label: e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.innerText || null })).filter((x) => !x.label)`);
out.headings = await p.eval("[...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ' ' + h.innerText)");

// phone width
await p.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await p.send('Page.reload', { ignoreCache: true }); await wait(300); out.mobile.readyMs = await ready(); await wait(500);
out.mobile.scrollWidth = await p.eval('document.documentElement.scrollWidth');
out.mobile.wide = await p.eval("[...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.tablewrap, header, svg, pre, code'); }).slice(0, 12).map((e) => e.tagName + (e.id ? '#' + e.id : '') + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))");
await shot('phone-top');
await p.eval("document.querySelector('#cost').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('phone-cost');
await p.eval("document.querySelector('#example').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('phone-example');

// dark
await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await wait(500);
out.dark.bg = await p.eval("getComputedStyle(document.body).backgroundColor");
out.dark.ink = await p.eval("getComputedStyle(document.body).color");
await p.eval("document.querySelector('#how').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('phone-dark-how');
await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await p.eval("document.querySelector('#cost').scrollIntoView({ behavior: 'instant' })"); await wait(300); await shot('desk-dark-cost');

// the office page, opened from the hero button
await p.send('Emulation.setEmulatedMedia', { features: [] });
await p.send('Page.navigate', { url: URL0 + 'office/?v=' + Date.now() }); await wait(5000);
out.office = { text: (await p.eval('document.body.innerText')).slice(0, 3000) };
await shot('office');

writeFileSync(join(HERE, 'record.json'), JSON.stringify(out, null, 1));
await c.close();
console.log('errors', out.errors.length, 'failed', out.failed.length, 'links', out.links.length, 'unlabelled', out.controls.length, 'mobile scrollWidth', out.mobile.scrollWidth);
