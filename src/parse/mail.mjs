// ════════════════════════════════════════════════════════════════
// src/parse/mail.mjs — an email message (RFC 5322 + MIME), read only ever inside the sandbox (claims L2a, L2b).
//
//   eml(bytes, caps?) → Promise<{ ok, subject, from, to, cc, date, messageId, text, html, attachments: [{ name, type, size, sha256 }] }>
//   caps { parts, depth } lowers the caps (the tests check each at its exact edge); the office reads with the defaults
//   Headers unfolded, encoded words (RFC 2047, B and Q) decoded in any charset the platform knows, multipart parts
//   (nested) split by their boundary, base64 and quoted-printable undone, each text part decoded in its charset.
//   A multipart part with no closing boundary (RFC 2046 §5.1.1) is cut short, and the message is refused.
//   An attachment is never opened here: its name, type, size and SHA-256 are read, and its bytes stay where they are.
// ════════════════════════════════════════════════════════════════

const no = (why) => ({ ok: false, why });
export const MAX_PARTS = 1000, MAX_DEPTH = 20;
const capOf = (c, k, d) => { try { const x = c[k]; return Number.isSafeInteger(x) && x > 0 ? x : d; } catch { return d; } };
const latin = new TextDecoder('latin1');

export function charsetDecode(bytes, charset) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array)) return '';
  try { return new TextDecoder(typeof charset === 'string' ? charset.trim().toLowerCase() : 'utf-8', { fatal: false }).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}
const bytesOf = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

export function qp(s, header = false) {
  if (typeof s !== 'string') return new Uint8Array(0);
  const t = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(t.charCodeAt(i) & 255);
  }
  return Uint8Array.from(out);
}
export function b64(s) {
  if (typeof s !== 'string') return new Uint8Array(0);
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  try { return bytesOf(atob(clean.replace(/=+$/, '').padEnd(Math.ceil(clean.replace(/=+$/, '').length / 4) * 4, '='))); } catch { return new Uint8Array(0); }
}

export function words(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, text) => charsetDecode(enc.toUpperCase() === 'B' ? b64(text) : qp(text, true), cs.replace(/\*.*$/, '')));
}

export function headers(text) {
  const h = {};
  if (typeof text !== 'string') return h;
  for (const line of text.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n')) {
    const c = line.indexOf(':');
    if (c > 0) { const k = line.slice(0, c).trim().toLowerCase(); if (!(k in h)) h[k] = line.slice(c + 1).trim(); }
  }
  return h;
}

export function params(v) {
  if (typeof v !== 'string') v = '';
  const out = { value: v.split(';')[0].trim().toLowerCase() };
  const re = /;\s*([A-Za-z0-9*_.-]+)\s*=\s*("([^"]*)"|[^;\s]*)/g;
  let m;
  while ((m = re.exec(v))) {
    const k = m[1].toLowerCase(), val = m[3] !== undefined ? m[3] : m[2];
    if (k.endsWith('*')) { const p = /^([^']*)'[^']*'(.*)$/.exec(val); out[k.slice(0, -1)] = p ? charsetDecode(qp(p[2].replace(/%([0-9A-Fa-f]{2})/g, '=$1')), p[1]) : val; }
    else if (!(k in out)) out[k] = words(val);
  }
  return out;
}

function split(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? [raw.slice(0, m.index), raw.slice(m.index + m[0].length)] : [raw, ''];
}

async function sha(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function eml(bytes, caps) {
  if (!(ArrayBuffer.isView(bytes) && bytes instanceof Uint8Array)) return no('a message is bytes');
  const c = Object(caps), maxParts = capOf(c, 'parts', MAX_PARTS), maxDepth = capOf(c, 'depth', MAX_DEPTH);
  const raw = latin.decode(bytes);
  const [head] = split(raw);
  const h = headers(head);
  if (!h.from && !h.subject && !h.date) return no('a message has headers (From, Subject or Date)');
  const out = { ok: true, subject: words(h.subject || ''), from: words(h.from || ''), to: words(h.to || ''), cc: words(h.cc || ''), date: h.date || '', messageId: h['message-id'] || '', text: '', html: '', attachments: [] };
  let parts = 0;
  async function walk(text, depth) {
    if (++parts > maxParts || depth > maxDepth) throw new Error('more than ' + maxParts + ' parts, or nested deeper than ' + maxDepth);
    const [hd, body] = split(text);
    const ph = headers(hd);
    const ct = params(ph['content-type'] || 'text/plain; charset=us-ascii');
    const cd = params(ph['content-disposition'] || '');
    const cte = String(ph['content-transfer-encoding'] || '7bit').toLowerCase().trim();
    if (ct.value.startsWith('multipart/') && ct.boundary) {
      const b = ('--' + ct.boundary).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp('(^|\\n)' + b + '--').test(body)) throw new Error('a multipart part has no closing boundary: it is cut short');
      const chunks = body.split(new RegExp('\\r?\\n?' + b + '(?:--)?[ \\t]*\\r?\\n?'));
      for (const c of chunks.slice(1)) if (c.trim()) await walk(c, depth + 1);
      return;
    }
    const data = cte === 'base64' ? b64(body) : cte === 'quoted-printable' ? qp(body) : bytesOf(body);
    const name = cd.filename || ct.name || '';
    if (cd.value === 'attachment' || (name && !ct.value.startsWith('text/'))) { out.attachments.push({ name, type: ct.value, size: data.length, sha256: await sha(data) }); return; }
    if (ct.value === 'text/plain' && !out.text) out.text = charsetDecode(data, ct.charset).replace(/\r\n/g, '\n');
    else if (ct.value === 'text/html' && !out.html) out.html = charsetDecode(data, ct.charset);
    else if (name) out.attachments.push({ name, type: ct.value, size: data.length, sha256: await sha(data) });
  }
  try { await walk(raw, 0); } catch (e) { return no(String(e.message)); }
  return out;
}
