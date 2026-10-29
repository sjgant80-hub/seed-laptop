// tools/imap.mjs — mail in, from the OWNER'S OWN mail account (IMAP over TLS), as message files for the inbound edge.
//
//   fetchMail({ host, port, tls, user, pass, mailbox, since, max, timeoutMs }) → Promise<{ ok, messages: [{ uid, bytes }], why?, transcript }>
//       TLS on port 993 unless told otherwise; a LOGIN is only ever sent inside TLS (in the clear only to this machine,
//       for the tests' local stand-in). The password is never stored or logged: the transcript masks it. Read-only by
//       construction (src/imap.mjs): EXAMINE, never SELECT; BODY.PEEK[], so nothing is marked read. At most `max`
//       messages (default 50), the newest.
//   node tools/imap.mjs --host imap.example.com --user you@example.com --pass-env MAIL_PASS --out <folder> [--since 2026-10-01]
//       writes <uid>.eml into the folder, to bring in through the Files panel. The password comes from the environment
//       variable you name, never from the command line. The account is yours to connect: the office holds no credential.
//   startImapSink(messages, { user, pass }) → Promise<{ port, close(), seen: [lines] }>   a local stand-in, for the tests
import net from 'node:net';
import tls from 'node:tls';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commands, fetchLine, parse, status, uids, masked } from '../src/imap.mjs';

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);

export function fetchMail(o) {
  const host = String(o.host || ''), useTls = o.tls !== false, port = Number(o.port || (useTls ? 993 : 143));
  const max = Number.isSafeInteger(o.max) && o.max > 0 ? o.max : 50;
  const transcript = [];
  if (!useTls && !LOCAL.has(host)) return Promise.resolve({ ok: false, why: 'a password is only ever sent inside TLS', transcript });
  const lines = commands({ user: o.user, pass: o.pass, mailbox: o.mailbox, since: o.since });
  if (lines === null) return Promise.resolve({ ok: false, why: 'a user name, password and mailbox are text with no line breaks', transcript });
  return new Promise((done) => {
    const sock = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = new Uint8Array(0), waiting = null, finished = false;
    const queue = [];
    const finish = (r) => { if (finished) return; finished = true; try { sock.end(); } catch { /* closing */ } done({ ...r, transcript }); };
    sock.setTimeout(Number.isSafeInteger(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 30000, () => finish({ ok: false, why: 'the mail server went quiet' }));
    sock.on('error', (e) => finish({ ok: false, why: 'could not talk to the mail server: ' + e.code }));
    sock.on('close', () => finish({ ok: false, why: 'the mail server closed the connection' }));   // after LOGOUT, finish has already run
    sock.on('data', (d) => {
      const nb = new Uint8Array(buf.length + d.length); nb.set(buf); nb.set(d, buf.length);
      const p = parse(nb);
      buf = p.rest;
      for (const r of p.responses) { transcript.push(r.kind === 'line' ? 'S: ' + r.text.slice(0, 200) : 'S: (a message, ' + r.bytes.length + ' bytes)'); queue.push(r); }
      if (waiting && queue.length) { const w = waiting; waiting = null; w(); }   // only a whole response wakes the reader
    });
    const next = () => new Promise((ok) => { if (queue.length) ok(queue.shift()); else waiting = () => ok(queue.shift()); });
    const send = (line) => { transcript.push('C: ' + masked(line)); sock.write(line + '\r\n'); };
    async function until(tag) {   // the responses up to this command's tagged result
      const got = [];
      for (;;) { const r = await next(); got.push(r); if (r.kind === 'line' && status(r.text, tag) !== null) return { result: status(r.text, tag), got }; }
    }
    (async () => {
      const hello = await next();
      if (!hello || hello.kind !== 'line' || !/^\* (OK|PREAUTH)\b/i.test(hello.text)) return finish({ ok: false, why: 'not an IMAP server' });
      send(lines[0]); if ((await until('a1')).result !== 'ok') return finish({ ok: false, why: 'the mail server refused the login' });
      send(lines[1]); if ((await until('a2')).result !== 'ok') return finish({ ok: false, why: 'no such mailbox' });
      send(lines[2]); const s = await until('a3'); if (s.result !== 'ok') return finish({ ok: false, why: 'the search was refused' });
      const found = s.got.filter((r) => r.kind === 'line').flatMap((r) => uids(r.text)).slice(-max);
      const messages = [];
      let n = 4;
      for (const uid of found) {
        const tag = 'a' + n++;
        send(fetchLine(tag, uid));
        const f = await until(tag);
        const m = f.got.find((r) => r.kind === 'fetch');
        if (f.result === 'ok' && m) messages.push({ uid: m.uid === null ? uid : m.uid, bytes: m.bytes });
      }
      send('a' + n + ' LOGOUT');
      finish({ ok: true, messages });
    })().catch((e) => finish({ ok: false, why: String(e && e.message) }));
  });
}

/** A local IMAP stand-in for the tests: one account, one mailbox, the messages given; it records every line it hears. */
export function startImapSink(messages, account) {
  const seen = [];
  const server = net.createServer((s) => {
    s.write('* OK local stand-in ready\r\n');
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('latin1');
      let k;
      while ((k = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, k); buf = buf.slice(k + 2); seen.push(line);
        const [tag, cmd, ...rest] = line.split(' ');
        const C = (cmd || '').toUpperCase();
        if (C === 'LOGIN') s.write(rest.join(' ') === '"' + account.user + '" "' + account.pass + '"' ? tag + ' OK logged in\r\n' : tag + ' NO wrong login\r\n');
        else if (C === 'EXAMINE') s.write(rest[0] === '"INBOX"' ? '* ' + messages.length + ' EXISTS\r\n' + tag + ' OK [READ-ONLY] examined\r\n' : tag + ' NO no such mailbox\r\n');
        else if (C === 'UID' && /^SEARCH/i.test(rest[0])) s.write('* SEARCH ' + messages.map((_, i) => i + 1).join(' ') + '\r\n' + tag + ' OK search done\r\n');
        else if (C === 'UID' && /^FETCH/i.test(rest[0])) { const uid = Number(rest[1]); const m = messages[uid - 1]; if (m) { s.write('* ' + uid + ' FETCH (UID ' + uid + ' BODY[] {' + m.length + '}\r\n'); s.write(m); s.write(')\r\n'); } s.write(tag + ' OK fetched\r\n'); }
        else if (C === 'LOGOUT') { s.write('* BYE\r\n' + tag + ' OK bye\r\n'); s.end(); }
        else s.write(tag + ' BAD unknown\r\n');
      }
    });
    s.on('error', () => {});
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, seen, close: () => new Promise((c) => server.close(c)) })));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i === -1 ? undefined : process.argv[i + 1]; };
  const out = arg('--out'), passEnv = arg('--pass-env');
  if (!arg('--host') || !arg('--user') || !passEnv || !out) { console.log('usage: node tools/imap.mjs --host <imap host> --user <you@example.com> --pass-env <ENV VAR NAME> --out <folder> [--since YYYY-MM-DD] [--max N]'); process.exit(2); }
  const r = await fetchMail({ host: arg('--host'), port: arg('--port') ? Number(arg('--port')) : undefined, user: arg('--user'), pass: process.env[passEnv] || '', since: arg('--since') ? new Date(arg('--since') + 'T00:00:00Z') : undefined, max: arg('--max') ? Number(arg('--max')) : undefined });
  if (!r.ok) { console.log('Not fetched: ' + r.why); process.exit(1); }
  mkdirSync(resolve(out), { recursive: true });
  for (const m of r.messages) writeFileSync(join(resolve(out), m.uid + '.eml'), m.bytes);
  console.log('Fetched ' + r.messages.length + ' messages into ' + resolve(out) + '. Bring them in through the Files panel: each is checked before anything reads it.');
}
