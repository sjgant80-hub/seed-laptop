// measure/l5-script.mjs — claim L5's sealed script, shared by the relay measure (Node) and the WebRTC tab: the same
// generator and the same edits wherever it runs.
export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One device's edits for a round: the first two on the one key both devices edit that round (so at least 10% of
 * every device's edits in every round meet the other's), about 30% of the rest on keys both may edit; some deletes. */
export function editsFor(r, who, round, count) {
  const shared = ['b/office/idb/app/s/["s","state"]', 'b/crm/ls/theme', 'b/ledger/idb/books/accounts/["n",1]', 'b/mind/ls/today'];
  return Array.from({ length: count }, (_, i) => {
    const forced = i < 2;
    const same = forced || r() < 0.3;
    const key = forced ? shared[round % shared.length] : same ? shared[Math.floor(r() * shared.length)] :'b/' + ['office', 'crm', 'ledger', 'pdf', 'mind', 'image', 'layout'][Math.floor(r() * 7)] + '/ls/' + who + '-' + Math.floor(r() * 40);
    const del = !same && r() < 0.08;
    return { key, value: del ? null : ['s', who + ' round ' + round + ' edit ' + i], same };
  });
}
