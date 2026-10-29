// ════════════════════════════════════════════════════════════════
// src/parse/text.mjs — the text formats: CSV, iCalendar (ICS) and vCard (VCF). Only ever inside the sandbox.
//
//   csv(text, caps?)  → { ok, delimiter, rows: [[cell]] } RFC 4180: quotes, doubled quotes, CRLF or LF, a BOM;
//                                                        the delimiter is the one of , ; tab that splits line 1 most
//                                                        (on a tie, the first of them)
//   lines(text)→ content lines, unfolded (RFC 5545 §3.1 / RFC 6350 §3.2): { name, params: { NAME: value }, value }
//   ics(text, caps?)  → { ok, events: [{ uid, summary, start, end, location, description }] }   an event's own
//                       properties only: an alarm's or a time zone's inside it are not the event's
//   vcf(text, caps?)  → { ok, contacts: [{ fn, n, emails: [], tels: [], org, title }] }
//   A calendar whose components do not all end, or a card that does not end, is cut short, and refused.
//   caps { rows, items } lowers the caps (the tests check each at its exact edge); the office reads with the defaults
// Pure and total.
// ════════════════════════════════════════════════════════════════

const no = (why) => ({ ok: false, why });
export const MAX_ROWS = 1000000, MAX_ITEMS = 100000;
const capOf = (c, k, d) => { try { const x = c[k]; return Number.isSafeInteger(x) && x > 0 ? x : d; } catch { return d; } };

export function csv(text, caps) {
  if (typeof text !== 'string') return no('CSV is text');
  const maxRows = capOf(Object(caps), 'rows', MAX_ROWS);
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = t.split(/\r?\n/, 1)[0] || '';
  const count = (d) => first.split(d).length;
  const delimiter = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows = [];
  let row = [], cell = '', q = false, i = 0, quoted = false;
  while (i < t.length) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '' && !quoted) { q = true; quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; quoted = false; i++; continue; }
    if (ch === '\r' && t[i + 1] === '\n') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; quoted = false; i++; if (rows.length > maxRows) return no('more than ' + maxRows + ' rows'); continue; }
    cell += ch; i++;
  }
  if (q) return no('a quoted cell never ends');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (rows.length > maxRows) return no('more than ' + maxRows + ' rows');
  return { ok: true, delimiter, rows };
}

const unescape = (v) => v.replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));

export function lines(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  const raw = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  for (const l of raw) {
    if (!l.trim()) continue;
    let inQ = false, colon = -1;
    for (const [i, ch] of l.split('').entries()) { if (ch === '"') inQ = !inQ; else if (ch === ':' && !inQ) { colon = i; break; } }
    if (colon < 1) continue;   // a content line has a name before its colon
    const head = l.slice(0, colon).split(';');
    const params = {};
    for (const p of head.slice(1)) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); }
    out.push({ name: head[0].toUpperCase().replace(/^ITEM\d+\./, ''), params, value: l.slice(colon + 1) });
  }
  return out;
}

export function ics(text, caps) {
  if (typeof text !== 'string') return no('a calendar is text');
  const maxItems = capOf(Object(caps), 'items', MAX_ITEMS);
  const ls = lines(text);
  if (ls.length === 0 || ls[0].name !== 'BEGIN' || ls[0].value.toUpperCase() !== 'VCALENDAR') return no('a calendar begins with BEGIN:VCALENDAR');
  const events = [], open = [];   // the components open around each line
  let cur = null;
  for (const l of ls) {
    const v = l.value.toUpperCase();
    if (l.name === 'BEGIN') { open.push(v); if (v === 'VEVENT') cur = { uid: '', summary: '', start: '', end: '', location: '', description: '' }; }
    else if (l.name === 'END') { if (open.pop() === 'VEVENT' && cur) { events.push(cur); cur = null; if (events.length > maxItems) return no('more than ' + maxItems + ' events'); } }
    else if (cur && open[open.length - 1] === 'VEVENT') {
      const k = { UID: 'uid', SUMMARY: 'summary', DTSTART: 'start', DTEND: 'end', LOCATION: 'location', DESCRIPTION: 'description' }[l.name];
      if (k) cur[k] = k === 'start' || k === 'end' ? (l.params.TZID ? l.params.TZID + ':' : '') + l.value : unescape(l.value);
    }
  }
  if (open.length !== 0) return no('the calendar is cut short: ' + open[open.length - 1].slice(0, 20) + ' never ends');   // RFC 5545: every BEGIN has its END
  return { ok: true, events };
}

export function vcf(text, caps) {
  if (typeof text !== 'string') return no('a contact card is text');
  const maxItems = capOf(Object(caps), 'items', MAX_ITEMS);
  const ls = lines(text);
  if (ls.length === 0 || ls[0].name !== 'BEGIN' || ls[0].value.toUpperCase() !== 'VCARD') return no('a contact card begins with BEGIN:VCARD');
  const contacts = [];
  let cur = null;
  for (const l of ls) {
    if (l.name === 'BEGIN' && l.value.toUpperCase() === 'VCARD') cur = { fn: '', n: '', emails: [], tels: [], org: '', title: '' };
    else if (l.name === 'END' && l.value.toUpperCase() === 'VCARD' && cur) { contacts.push(cur); cur = null; if (contacts.length > maxItems) return no('more than ' + maxItems + ' contacts'); }
    else if (cur) {
      if (l.name === 'FN') cur.fn = unescape(l.value);
      else if (l.name === 'N') cur.n = l.value;
      else if (l.name === 'EMAIL') cur.emails.push(l.value);
      else if (l.name === 'TEL') cur.tels.push(l.value.replace(/^tel:/i, ''));
      else if (l.name === 'ORG') cur.org = unescape(l.value.split(';')[0]);
      else if (l.name === 'TITLE') cur.title = unescape(l.value);
    }
  }
  if (cur !== null) return no('a contact card is cut short: it never ends');   // RFC 6350: every card ends END:VCARD
  return { ok: true, contacts };
}
