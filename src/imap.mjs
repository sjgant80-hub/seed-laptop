// ════════════════════════════════════════════════════════════════
// src/imap.mjs — mail in from the owner's own account: the IMAP words (RFC 9051), pure. Organ 4 (the inbound edge).
//
// tools/imap.mjs holds the socket; this kernel holds every byte decision. The client is read-only by construction:
// it EXAMINEs a mailbox (never SELECT, so nothing can be expunged) and fetches BODY.PEEK[] (so nothing is marked read).
// Each message comes back as bytes, and the office brings it in through its edge like any other file.
//
//   quote(s)              → s as an IMAP quoted string, or null when it cannot be one (a CR, LF or NUL in it)
//   commands(o)           → the client's lines in order: LOGIN, EXAMINE, UID SEARCH; o = { user, pass, mailbox, since }
//   fetchLine(tag, uid)   → 'tag UID FETCH uid (BODY.PEEK[])'
//   parse(bytes)          → { responses: [{ kind: 'line', text } | { kind: 'fetch', uid, bytes }], rest }
//       the server's responses as far as the bytes go (a literal {n} is read by its exact byte count); rest = the bytes
//       of a response not yet complete
//   status(text, tag)     → 'ok' | 'no' | 'bad' | null   the tagged result of a command
//   uids(text)            → the UIDs a '* SEARCH' line names, in order
//   masked(line)          → the line with a LOGIN password replaced by ********, for the transcript
// Pure and total.
// Powered by the Konomi architecture, created by Thomas Frumkin.
// ════════════════════════════════════════════════════════════════

const MAX_LITERAL = 25 << 20;   // a message is at most the inbound edge's cap for an email
const isBytes = (x) => ArrayBuffer.isView(x) && x instanceof Uint8Array;
const latin = new TextDecoder('latin1');

export function quote(s) {
  if (typeof s !== 'string' || /[\r\n\0]/.test(s)) return null;
  return '"' + s.replace(/[\\"]/g, (c) => '\\' + c) + '"';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function commands(o) {
  let user, pass, box, since;
  try { user = quote(o.user); pass = quote(o.pass); box = quote(o.mailbox === undefined ? 'INBOX' : o.mailbox); since = o.since; } catch { return null; }
  if (user === null || pass === null || box === null) return null;
  const d = since instanceof Date && Number.isFinite(since.getTime()) ? since.getUTCDate() + '-' + MONTHS[since.getUTCMonth()] + '-' + since.getUTCFullYear() : null;
  return ['a1 LOGIN ' + user + ' ' + pass, 'a2 EXAMINE ' + box, 'a3 UID SEARCH ' + (d === null ? 'ALL' : 'SINCE ' + d)];
}

export const fetchLine = (tag, uid) => (typeof tag === 'string' && /^[a-z][0-9]{1,6}$/.test(tag) && Number.isSafeInteger(uid) && uid > 0 ? tag + ' UID FETCH ' + uid + ' (BODY.PEEK[])' : null);

/** Where the next CRLF is, from i; -1 if none yet. */
function crlf(b, i) {
  for (let k = b.indexOf(13, i); k !== -1; k = b.indexOf(13, k + 1)) if (b[k + 1] === 10) return k;
  return -1;
}

export function parse(bytes) {
  if (!isBytes(bytes)) return { responses: [], rest: new Uint8Array(0) };
  const responses = [];
  let i = 0;
  for (;;) {
    const e = crlf(bytes, i);
    if (e === -1) break;
    const line = latin.decode(bytes.subarray(i, e));
    const lit = /\{(\d{1,9})\}$/.exec(line);
    if (lit === null) { responses.push({ kind: 'line', text: line }); i = e + 2; continue; }
    const n = Number(lit[1]);
    if (n > MAX_LITERAL) { responses.push({ kind: 'line', text: '* BAD a literal of ' + n + ' bytes is past the cap' }); i = bytes.length; break; }
    const start = e + 2, end = start + n;
    const close = crlf(bytes, end);
    if (close === -1) break;   // the literal, or the line that ends its response, has not all arrived
    const uid = /\bUID (\d+)/.exec(line + latin.decode(bytes.subarray(end, close)));
    responses.push({ kind: 'fetch', uid: uid === null ? null : Number(uid[1]), bytes: bytes.slice(start, end) });
    i = close + 2;
  }
  return { responses, rest: bytes.slice(i) };
}

export function status(text, tag) {
  if (typeof text !== 'string' || typeof tag !== 'string') return null;
  const m = /^(\S+) (OK|NO|BAD)\b/i.exec(text);
  return m !== null && m[1] === tag ? m[2].toLowerCase() : null;
}

export function uids(text) {
  const m = typeof text === 'string' ? /^\* SEARCH((?: \d+)*)\s*$/i.exec(text) : null;
  return m === null ? [] : m[1].split(' ').filter(Boolean).map(Number);
}

export const masked = (line) => (typeof line === 'string' ? line.replace(/^(a1 LOGIN "(?:[^"\\]|\\.)*") .*$/, '$1 ********') : '');
