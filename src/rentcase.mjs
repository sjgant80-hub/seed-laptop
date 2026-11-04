// ════════════════════════════════════════════════════════════════
// src/rentcase.mjs — the cost case over the years, for the page's "Cost case": what a company rents now for what the
// grown office grows, carried forward by inflation, against the grown office. Pure, total, gated.
//
// It follows liveware's src/mintcase.mjs. Every external figure is read from the vendored, sourced basis
// (vendor/sovereign-enterprise/data/basis.json, byte for byte; vendor/sovereign-enterprise/SOURCES.json names its
// commit): UK CPI, and the list price of each rented line the worked example uses. The lines, the users, the years
// and every choice are the reader's own. Whether a line is covered is decided by the coverage map sealed in seal 2
// (src/cost.mjs), never here. A line moves to the grown office when the map covers it whole, or covers it in part and
// the reader says the covered part is all they use; a line the office does not cover always stays. Both sides run on
// the same machines, so the machines and their power cancel out; the office adds no server and no licence fee (MIT).
// No price of ours appears here: these are the reader's costs. Whole pence; each year after the first rises by CPI.
//
//   SEAT_KEYS, BASIS_KEYS          the basis entries the case reads
//   DEFAULT_USERS, DEFAULT_MOVES   the worked example's inputs, the reader's to change
//   cpiOf(basis)                   → the sourced CPI as a rate from 0 up to (not including) 1, or null
//   carry(yearly, cpi, years)      → the yearly pence carried over 1 to 10 years, each year rounded to whole pence
//   heldBlocks(receipt)            → the blocks that held in the measured browser run (L1b2's receipt; L7's own rule)
//   seatLines(basis, users, moves) → the worked example's lines, each priced from the basis
//   sourcesOf(basis)               → every figure the case reads: what it is, its value, where it came from
//   rentCase(basis, input)         → { ok, years, cpi, items, yearly, over } or { ok: false, why }
//       input = { lines: [{ name, amount (whole pence), per: 'month' | 'year', seats, move }], working, years }
// ════════════════════════════════════════════════════════════════

import { cost } from './cost.mjs';

export const SEAT_KEYS = Object.freeze(['seat.crm', 'seat.finance', 'seat.hr']);
export const BASIS_KEYS = Object.freeze(['cpi', ...SEAT_KEYS]);
export const DEFAULT_USERS = Object.freeze({ 'seat.crm': 10, 'seat.finance': 2, 'seat.hr': 2 });
export const DEFAULT_MOVES = Object.freeze({ 'seat.crm': true, 'seat.finance': false, 'seat.hr': false });
export const DEFAULT_YEARS = 3;

const isRate = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1;
const isPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6;
const isYears = (y) => Number.isInteger(y) && y >= 1 && y <= 10;

export function cpiOf(basis) {
  try { const v = basis.cpi.value; return isRate(v) ? v : null; } catch { return null; }
}

export function carry(yearly, cpi, years) {
  if (!Number.isSafeInteger(yearly) || yearly < 0 || !isRate(cpi) || !isYears(years)) return null;
  let total = 0, factor = 1;
  for (let y = 0; y < years; y++) { total += Math.round(yearly * factor); factor *= 1 + cpi; }
  return Number.isSafeInteger(total) ? total : null;
}

export function heldBlocks(receipt) {
  try {
    const f = receipt.facts.L1b2 || receipt.facts;
    if (!Array.isArray(f.blocks)) return [];
    return f.blocks.filter((b) => b.frame === 'found' && b.loaded === true && b.exceptions === 0 && b.elements > 0 && typeof b.id === 'string').map((b) => b.id);
  } catch { return []; }
}

export function seatLines(basis, users, moves) {
  try {
    const u = { ...DEFAULT_USERS, ...users };
    const m = { ...DEFAULT_MOVES, ...moves };
    const out = [];
    for (const key of SEAT_KEYS) {
      const e = basis[key];
      if (!e || !isPrice(e.value) || typeof e.product !== 'string' || e.product.length === 0) return null;
      const n = u[key];
      if (!Number.isSafeInteger(n) || n < 0 || n > 100000) return null;
      if (n > 0) out.push({ key, name: e.product, amount: Math.round(e.value * 100), per: 'month', seats: n, move: m[key] === true });
    }
    return out;
  } catch { return null; }
}

export function sourcesOf(basis) {
  try {
    return BASIS_KEYS.map((k) => {
      const e = basis[k];
      return { key: k, what: e.what || e.product, value: e.value, unit: e.unit || null, source: e.source, via: e.via || null };
    });
  } catch { return []; }
}

export function rentCase(basis, input) {
  try {
    const cpi = cpiOf(basis);
    if (cpi === null) return { ok: false, why: 'a sourced basis with the CPI the case reads' };
    const i = input && typeof input === 'object' ? input : {};
    const years = i.years === undefined ? DEFAULT_YEARS : i.years;
    if (!isYears(years)) return { ok: false, why: 'years: 1 to 10' };
    if (!Array.isArray(i.lines)) return { ok: false, why: 'a cost case starts from the owner\'s own list: there is none' };
    const r = cost(i.lines, i.working);   // the sealed map reads only name, amount, per and seats; move is the reader's, read below
    if (!r.ok) return r;
    const items = r.items.map((it, k) => {
      const asked = i.lines[k].move === true;
      const moved = it.level === 'covered' || (it.level === 'partly' && asked);
      return { ...it, moved, over: carry(it.yearly, cpi, years) };
    });
    if (items.some((x) => x.over === null)) return { ok: false, why: 'the amounts are too large to carry forward' };
    const sum = (keep, f) => items.filter(keep).reduce((a, x) => a + x[f], 0);
    const all = () => true, stays = (x) => !x.moved, moves = (x) => x.moved;
    const yearly = { today: sum(all, 'yearly'), office: sum(stays, 'yearly'), saving: sum(moves, 'yearly') };
    const over = {
      today: sum(all, 'over'), office: sum(stays, 'over'), saving: sum(moves, 'over'),
      atStake: sum((x) => x.level === 'partly' && !x.moved, 'over'), notCovered: sum((x) => x.level === 'not', 'over'),
    };
    if (![...Object.values(yearly), ...Object.values(over)].every(Number.isSafeInteger)) return { ok: false, why: 'the amounts are too large to carry forward' };
    return { ok: true, years, cpi, items, yearly, over };
  } catch { return { ok: false, why: 'the inputs could not be read' }; }
}
