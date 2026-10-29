// ════════════════════════════════════════════════════════════════
// src/cost.mjs — the cost case, from the owner's OWN subscription list (claim L7). Pure, total, gated.
//
// The office has no price: it is MIT, and it runs on a machine the owner already has. So the case is what the owner
// pays now, item by item, and which of those the grown office covers — whole, in part, or not at all, with the reason.
// Amounts are the owner's, in whole pence (or cents): this kernel never supplies a price of its own.
//
//   COVERAGE                       the sealed map: each kind of service, the words that name it, the blocks that cover
//                                  it, and whether that is whole ('covered') or in part ('partly'), with the reason
//   classify(name)                 → the kind a service's name falls under, or null
//   yearlyOf(item)                 → the item's yearly amount in pence: amount × 12 for 'month', × seats (default 1)
//   cost(list, working)            → { ok, items, yearly, coveredYearly, partlyYearly, notYearly, covered, partly, not }
//       list    = the owner's own [{ name, amount (pence, a whole number), per: 'month' | 'year', seats }]
//       working = the block ids that held in a sealed measurement (claim L1b): an item is covered only by blocks that
//                 work; one whose blocks did not hold is 'not', and says so
// ════════════════════════════════════════════════════════════════

export const COVERAGE = Object.freeze([
  { kind: 'office suite', words: ['microsoft 365', 'office 365', 'm365', 'google workspace', 'g suite', 'zoho workplace', 'word', 'excel', 'powerpoint'], blocks: ['office'], level: 'partly', why: 'documents, sheets, slides, calendar, notes and tasks are covered; email hosting and Teams-style calls are not' },
  { kind: 'CRM suite', words: ['salesforce', 'dynamics 365 sales', 'dynamics 365 customer service', 'sugarcrm', 'hubspot professional', 'hubspot enterprise'], blocks: ['crm'], level: 'partly', why: 'contacts, companies, deals and the pipeline are covered; service desks, marketing automation, commerce and the suite’s integrations are not' },
  { kind: 'CRM', words: ['hubspot', 'pipedrive', 'zoho crm', 'crm', 'close.com', 'freshsales', 'capsule'], blocks: ['crm'], level: 'covered', why: 'contacts, companies, deals and the pipeline, kept on your own machine' },
  { kind: 'accounts', words: ['quickbooks', 'xero', 'freeagent', 'sage', 'freshbooks', 'wave', 'dynamics 365 finance'], blocks: ['ledger'], level: 'partly', why: 'the double-entry books are covered; bank feeds and filing to the tax office are not' },
  { kind: 'PDF', words: ['acrobat', 'adobe pdf', 'smallpdf', 'pdfelement', 'nitro', 'foxit'], blocks: ['pdf'], level: 'partly', why: 'writing PDFs is covered; editing and e-signing other people\'s PDFs is not' },
  { kind: 'team workspace', words: ['notion', 'confluence', 'coda', 'microsoft loop'], blocks: ['mind', 'office'], level: 'partly', why: 'notes, pages and a linked notebook are covered, on your own devices; a workspace shared live with a team is not' },
  { kind: 'notes', words: ['evernote', 'onenote', 'obsidian', 'bear', 'roam', 'simplenote'], blocks: ['mind', 'office'], level: 'covered', why: 'notes and a linked notebook, offline, on every device you own' },
  { kind: 'design', words: ['canva', 'photoshop', 'indesign', 'creative cloud', 'affinity', 'figma', 'illustrator'], blocks: ['image', 'layout'], level: 'partly', why: 'image editing and page layout are covered; vector drawing, team design and stock libraries are not' },
  { kind: 'storage and backup', words: ['dropbox', 'google one', 'icloud', 'onedrive', 'box.com', 'backblaze', 'pcloud'], blocks: ['vault'], level: 'partly', why: 'the office backs itself up to an encrypted vault you keep; storing and sharing other files is not covered' },
]);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function classify(name) {
  if (typeof name !== 'string') return null;
  const n = ' ' + name.toLowerCase().replace(/[^a-z0-9.+ ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const hit = COVERAGE.find((c) => c.words.some((w) => n.includes(' ' + w + ' ')));
  return hit ? hit.kind : null;
}

export function yearlyOf(item) {
  try {
    if (!Number.isSafeInteger(item.amount) || item.amount < 0) return null;
    const seats = item.seats === undefined ? 1 : item.seats;
    if (!Number.isSafeInteger(seats) || seats < 1) return null;
    const per = item.per === 'month' ? 12 : item.per === 'year' ? 1 : 0;
    if (per === 0) return null;
    const y = item.amount * per * seats;
    return Number.isSafeInteger(y) ? y : null;
  } catch { return null; }
}

export function cost(list, working) {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, why: 'a cost case starts from the owner\'s own list: there is none' };
  const ok = new Set(Array.isArray(working) ? working.filter((x) => typeof x === 'string') : []);
  const items = [];
  for (const it of list) {
    const name = it && typeof it.name === 'string' ? it.name.slice(0, 80) : '';
    const yearly = yearlyOf(it);
    if (!name || yearly === null) return { ok: false, why: 'every item has a name, a whole amount, per month or per year, and whole seats' };
    const kind = classify(name);
    const c = kind ? COVERAGE.find((x) => x.kind === kind) : null;
    let level = 'not', by = [], why = 'nothing in the office covers this';
    if (c) {
      by = c.blocks.filter((b) => b === 'vault' || ok.has(b));
      if (by.length) { level = c.level; why = c.why; } else { why = 'the blocks that would cover it (' + c.blocks.join(', ') + ') did not hold in the measurement'; }
    }
    items.push({ name, kind, yearly, level, by, why });
  }
  const sum = (lv) => items.filter((x) => lv === null || x.level === lv).reduce((a, x) => a + x.yearly, 0);
  return {
    ok: true, items, yearly: sum(null), coveredYearly: sum('covered'), partlyYearly: sum('partly'), notYearly: sum('not'),
    covered: items.filter((x) => x.level === 'covered').length, partly: items.filter((x) => x.level === 'partly').length, not: items.filter((x) => x.level === 'not').length,
  };
}

export const hasKind = (kind) => typeof kind === 'string' && COVERAGE.some((c) => own(c, 'kind') && c.kind === kind);
