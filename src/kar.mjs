// ════════════════════════════════════════════════════════════════
// src/kar.mjs — Kar, the office's conductor (layer 5 of the seed laptop). Organ 3; later organs add their doings.
//
// Kar understands a closed list of things, on a floor that needs no model at all: plain words are matched to one of
// them. A local model, if the owner has one, may only CHOOSE from the same list (pick); its words never reach the page.
// Everything Kar does leaves a receipt (src/receipt.mjs).
//
//   INTENTS                     help · list · open · find · recent (the office) — later organs add theirs
//   parse(text, blocks)         → { intent, arg } | { intent: null, why }    blocks = [{ id, name }]
//   pick(reply, allowed)        → the intent a model's reply names, only if its first word is exactly one allowed
//   textOf(tagged)              → every piece of text inside a stored value (for find)
//   find(store, words, limit)   → [{ key, block, snippet }]   keys whose text holds every word (case ignored): every
//                                 block's data, and the reading of every file brought in ('files')
//   answer(intent, arg, ctx)    → { says, open?, results? }   ctx = { blocks, store, receipts }
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════
import { keysOf, read } from './store.mjs';

export const INTENTS = Object.freeze(['help', 'list', 'open', 'find', 'recent']);
export const MAX_TEXT = 400, MAX_RESULTS = 20;

const RULES = [
  ['help', /^(help|what can you do|how do i|\?)\b|^\?$/],
  ['list', /^(list|what'?s in my office|what is in my office|show (me )?(my )?office|my blocks|blocks)\b/],
  ['recent', /^(recent|what changed|what happened|history|receipts|show (me )?(the )?receipts)\b/],
  ['open', /^(open|go to|show|start)\s+(.+)$/],
  ['find', /^(find|search( for)?|look for|where is|where are)\s+(.+)$/],
];

const clean = (t) => String(t).toLowerCase().replace(/[^a-z0-9'? ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function parse(text, blocks) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return { intent: null, why: 'ask me in up to ' + MAX_TEXT + ' characters' };
  const t = clean(text);
  if (!t) return { intent: null, why: 'ask me something: try "help"' };
  for (const [intent, re] of RULES) {
    const m = re.exec(t);
    if (!m) continue;
    if (intent === 'open') {
      const want = m[2].replace(/^(the|my)\s+/, '');
      const list = Array.isArray(blocks) ? blocks : [];
      const b = list.find((x) => x && (x.id === want || clean(x.name) === want)) || list.find((x) => x && (clean(x.name).split(' ').includes(want) || x.id.startsWith(want)));
      return b ? { intent, arg: b.id } : { intent: null, why: 'there is no block called "' + want + '" in your office: say "list" to see them' };
    }
    if (intent === 'find') return { intent, arg: m[3] };
    return { intent, arg: null };
  }
  return { intent: null, why: 'I do not know how to do that yet: say "help" to see what I can do' };
}

export function pick(reply, allowed) {
  if (typeof reply !== 'string' || !Array.isArray(allowed)) return null;
  const first = clean(reply).split(' ')[0];
  return allowed.includes(first) && INTENTS.includes(first) ? first : null;
}

export function textOf(t, out = [], depth = 0) {
  if (!Array.isArray(t) || depth > 64) return out;
  if (t[0] === 's' && typeof t[1] === 'string') out.push(t[1]);
  else if ((t[0] === 'a' || t[0] === 'set') && Array.isArray(t[1])) for (const x of t[1]) textOf(x, out, depth + 1);
  else if ((t[0] === 'o' || t[0] === 'map') && Array.isArray(t[1])) for (const p of t[1]) if (Array.isArray(p)) { if (t[0] === 'map') textOf(p[0], out, depth + 1); textOf(p[1], out, depth + 1); }
  return out;
}

export function find(store, words, limit = MAX_RESULTS) {
  const ws = clean(typeof words === 'string' ? words : '').split(' ').filter((w) => w.length > 0);
  if (!ws.length) return [];
  const max = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_RESULTS) : MAX_RESULTS;
  const out = [];
  // every block's data, and the reading of every file brought in at the edge (never the file's raw bytes)
  const keys = [...keysOf(store, 'b/'), ...keysOf(store, 'files/').filter((k) => k.endsWith('/read'))];
  for (const key of keys) {
    const text = textOf(read(store, key).value).join(' ');
    const low = text.toLowerCase();
    if (!ws.every((w) => low.includes(w))) continue;
    const at = low.indexOf(ws[0]);
    out.push({ key, block: key.startsWith('files/') ? 'files' : key.split('/')[1], snippet: text.slice(Math.max(0, at - 40), at + 80) });
    if (out.length >= max) break;
  }
  return out;
}

export function answer(intent, arg, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const blocks = Array.isArray(c.blocks) ? c.blocks : [];
  if (intent === 'help') return { says: 'I can: list your office · open a block (say "open crm") · find something in any block or any file you brought in (say "find invoice") · show what changed (say "recent"). Bring files in and write them out in Files in and Write out; keep a vault in Your vault; pair a device in Your devices. Everything leaves a receipt.' };
  if (intent === 'list') return { says: 'Your office has ' + blocks.length + ' blocks: ' + blocks.map((b) => b.name + ' (' + b.id + ')').join(', ') + '.' };
  if (intent === 'open') {
    const b = blocks.find((x) => x && x.id === arg);
    return b ? { says: 'Opening ' + b.name + '.', open: b.id } : { says: 'There is no block called ' + String(arg) + '.' };
  }
  if (intent === 'find') {
    const results = find(c.store, arg);
    return { says: results.length ? 'Found ' + arg + ' in ' + results.length + (results.length === 1 ? ' place' : ' places') + ': ' + [...new Set(results.map((r) => r.block))].join(', ') + '.' : 'Nothing in your office mentions ' + arg + '.', results };
  }
  if (intent === 'recent') {
    const rs = Array.isArray(c.receipts) ? c.receipts.slice(-5) : [];
    return { says: rs.length ? 'The last ' + rs.length + ': ' + rs.map((r) => r && r.says).filter(Boolean).join(' · ') : 'Nothing has happened yet.' };
  }
  return { says: 'I do not know how to do that yet: say "help" to see what I can do.' };
}
