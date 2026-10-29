// measure/webrtc.mjs — run measure/webrtc.html in headless Chrome (its own throwaway profile) and read its result.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { launch, CHROME } from '../tools/cdp.mjs';
import { serve } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function measureWebRTC() {
  if (!CHROME) return null;
  const srv = await serve(ROOT);
  const profile = join(ROOT, '.out', 'cw' + (Date.now() % 100000));
  const c = await launch({ profile });
  const p = await c.page();
  await p.send('Page.navigate', { url: srv.url + 'measure/webrtc.html' });
  let r = null;
  for (let i = 0; i < 600 && !r; i++) { r = await p.eval('window.__webrtc || null'); if (!r) await new Promise((ok) => setTimeout(ok, 100)); }
  await c.close(); await srv.close();
  rmSync(profile, { recursive: true, force: true });
  return r || { error: 'no result in 60 s' };
}
