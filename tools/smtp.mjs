// tools/smtp.mjs — plain email out, through the OWNER'S OWN mail provider (the outbound edge's one network path).
//
//   sendMail({ host, port, starttls, user, pass, from, to, data }) → Promise<{ ok, code, why?, transcript }>
//       data = the message bytes (src/edge-out.mjs eml). STARTTLS when asked; a user name and password are sent only
//       inside TLS (AUTH PLAIN), never in the clear, and never stored or logged by this file (the transcript masks them).
//       The owner's account is theirs to connect: the office holds no credential of its own.
//   startSink(host, port) → Promise<{ port, messages: [{ from, to, bytes }], close() }>   a local stand-in for a mail
//       provider, for the measurements only: it accepts mail and keeps it in memory.
import { createConnection, createServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

function lineReader(sock) {
  let buf = '';
  const waiting = [];
  const lines = [];
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 2); }
    while (waiting.length && lines.length) waiting.shift()(lines.shift());
  });
  return () => new Promise((r) => (lines.length ? r(lines.shift()) : waiting.push(r)));
}

async function reply(next) {
  let line = await next(), all = [line];
  while (/^\d{3}-/.test(line)) { line = await next(); all.push(line); }
  return { code: Number(line.slice(0, 3)), lines: all };
}

export async function sendMail(m) {
  const transcript = [];
  let sock = await new Promise((ok, bad) => { const s = createConnection({ host: m.host, port: m.port }, () => ok(s)); s.on('error', bad); });
  let next = lineReader(sock);
  const say = async (cmd, mask) => { transcript.push('> ' + (mask || cmd)); sock.write(cmd + '\r\n'); const r = await reply(next); transcript.push('< ' + r.lines.join(' | ')); return r; };
  const expect = (r, ok, what) => { if (!ok.includes(r.code)) throw Object.assign(new Error(what + ' refused: ' + r.lines.join(' ')), { code: r.code }); };
  try {
    const hello = await reply(next); transcript.push('< ' + hello.lines.join(' | '));
    expect(hello, [220], 'the greeting');
    let ehlo = await say('EHLO localhost');
    expect(ehlo, [250], 'EHLO');
    if (m.starttls) {
      expect(await say('STARTTLS'), [220], 'STARTTLS');
      sock = await new Promise((ok, bad) => { const t = tlsConnect({ socket: sock, servername: m.host }, () => ok(t)); t.on('error', bad); });
      next = lineReader(sock);
      ehlo = await say('EHLO localhost');
      expect(ehlo, [250], 'EHLO after STARTTLS');
    }
    if (m.user) {
      if (!m.starttls) throw new Error('a password is never sent without TLS');
      expect(await say('AUTH PLAIN ' + Buffer.from('\0' + m.user + '\0' + m.pass).toString('base64'), 'AUTH PLAIN ********'), [235], 'AUTH');
    }
    expect(await say('MAIL FROM:<' + m.from + '>'), [250], 'MAIL FROM');
    for (const r of m.to) expect(await say('RCPT TO:<' + r + '>'), [250, 251], 'RCPT TO');
    expect(await say('DATA'), [354], 'DATA');
    const text = Buffer.from(m.data).toString('latin1').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    sock.write(text + (text.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
    const done = await reply(next); transcript.push('< ' + done.lines.join(' | '));
    expect(done, [250], 'the message');
    await say('QUIT');
    sock.end();
    return { ok: true, code: 250, transcript };
  } catch (e) {
    sock.destroy();
    return { ok: false, code: e.code || 0, why: String(e.message), transcript };
  }
}

export function startSink(host = '127.0.0.1', port = 0) {
  const messages = [];
  const server = createServer((s) => {
    s.write('220 sink ready\r\n');
    let buf = '', data = null, from = '', to = [];
    s.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') { messages.push({ from, to, bytes: Buffer.byteLength(data.join('\r\n'), 'latin1') }); data = null; s.write('250 kept\r\n'); }
          else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO') || up.startsWith('HELO')) s.write('250-sink\r\n250 8BITMIME\r\n');
        else if (up.startsWith('MAIL FROM:')) { from = line.slice(10).replace(/[<>]/g, ''); to = []; s.write('250 ok\r\n'); }
        else if (up.startsWith('RCPT TO:')) { to.push(line.slice(8).replace(/[<>]/g, '')); s.write('250 ok\r\n'); }
        else if (up === 'DATA') { data = []; s.write('354 go on\r\n'); }
        else if (up === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
        else s.write('502 not here\r\n');
      }
    });
    s.on('error', () => {});
  });
  return new Promise((ok) => server.listen(port, host, () => ok({ port: server.address().port, messages, close: () => new Promise((r) => server.close(r)) })));
}
