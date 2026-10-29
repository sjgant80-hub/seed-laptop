// office/keep.mjs — the vault in a tab: save it, and regrow an office from it. Glue: the decisions are in
// src/vault.mjs (the cipher), src/regrow.mjs (what is kept, and whether a vault may be restored) and the foundation's
// seed (the owner from the phrase).
import { seal, open } from '../src/vault.mjs';
import { entriesOf, restore, watchOf, eventOf } from '../src/regrow.mjs';
import { plant } from '../vendor/fall-kit-core/seed.mjs';
import { POLICY } from '../src/germinate.mjs';
import { step } from '../vendor/bes-inward/watch.mjs';
import { merge } from '../src/store.mjs';

const $ = (id) => document.getElementById(id);

export async function ownerOf(phrase) {
  const p = await plant(phrase, ['device'], { policy: { ...POLICY } });
  return p.ok ? p.ids.founder.id : null;
}

export async function saveVault(ctx, phrase) {
  if ((await ownerOf(phrase)) !== ctx.owner.founder) return { ok: false, why: 'that is not the phrase this office was planted with' };
  const entries = entriesOf(ctx.store(), { digest: ctx.digest, founder: ctx.owner.founder });
  if (!entries) return { ok: false, why: 'the office could not be packed' };
  const s = await seal(entries, phrase);
  if (!s.ok) return s;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([s.bytes], { type: 'application/octet-stream' }));
  a.download = 'office-' + new Date().toISOString().slice(0, 10) + '.slv';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { ok: true, bytes: s.bytes.length, ref: s.ref };
}

/** Regrow: the seed's office and the phrase's owner, then the vault's state if it is theirs. */
export async function regrowFrom(planted, vaultBytes, phrase) {
  const o = await open(vaultBytes, phrase);
  if (!o.ok) return { ok: false, why: o.why };
  const r = restore(o.entries, { digest: planted.digest, owner: { id: planted.owner.id } });
  return r.ok ? { ok: true, store: r.store } : r;
}

/** The behavioural watch for this device: observe-only while it forms (vendor/bes-inward). */
export function besWatch(owner, saved) {
  let w = saved && typeof saved === 'object' ? saved : watchOf(owner);
  const days = () => (w.first ? Math.floor((Date.now() - w.first) / 86400000) : 0);
  return {
    see(action) { const r = step(w, eventOf(action, Date.now()), {}); w = r.w; return r.out; },
    state: () => w,
    says: () => (w.formed ? 'Your behaviour watch has formed: it now asks before an action that does not look like you.' : 'Your behaviour watch is learning how you work (observe-only, day ' + days() + ' of 14): it refuses nothing while it learns.'),
  };
}

/** An update: this office was grown from a newer seed; bring the owner's office across from a vault saved under an
 * earlier one. Merged into what is here (src/store.mjs merge), so nothing in either is lost. */
export async function upgradeFrom(ctx, vaultBytes, phrase) {
  if ((await ownerOf(phrase)) !== ctx.owner.founder) return { ok: false, why: 'that is not the phrase this office was planted with' };
  const o = await open(vaultBytes, phrase);
  if (!o.ok) return { ok: false, why: o.why };
  const r = restore(o.entries, { digest: ctx.digest, owner: { id: ctx.owner.founder }, blocks: ctx.blocks.map((b) => b.id) }, { upgrade: true });
  if (!r.ok) return r;
  if (!r.from) return { ok: false, why: 'this vault was saved under this same seed, so there is nothing to bring across (on a new machine, use Regrow)' };
  const m = merge(ctx.store(), r.store);
  if (!m.ok) return { ok: false, why: m.why };
  return { ok: true, store: m.store, keys: Object.keys(r.store.keys).length, from: r.from, orphaned: r.orphaned.length };
}

export function installKeep(ctx) {
  $('vault-upgrade').addEventListener('change', async () => {
    const says = $('backup-says'), f = $('vault-upgrade').files[0];
    if (!f) return;
    says.textContent = 'Opening the vault…';
    const r = await upgradeFrom(ctx, new Uint8Array(await f.arrayBuffer()), $('backup-phrase').value);
    $('vault-upgrade').value = '';
    if (!r.ok) { says.textContent = 'Not brought across: ' + r.why + '.'; return; }
    $('backup-phrase').value = '';
    ctx.setStore(r.store);
    says.textContent = r.keys + ' things brought across and merged in; nothing dropped.';
    ctx.receipt('upgraded', { keys: r.keys, from: r.from, orphaned: r.orphaned });
  });
  $('backup-save').addEventListener('click', async () => {
    const says = $('backup-says');
    says.textContent = 'Sealing your vault…';
    const r = await saveVault(ctx, $('backup-phrase').value);
    $('backup-phrase').value = '';
    if (!r.ok) { says.textContent = 'Not saved: ' + r.why + '.'; return; }
    says.textContent = 'Saved: ' + r.bytes + ' bytes, encrypted with your phrase.';
    ctx.receipt('backed-up', { bytes: r.bytes, ref: r.ref });
  });
}
