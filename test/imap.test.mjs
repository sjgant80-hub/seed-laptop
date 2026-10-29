import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quote, commands, fetchLine, parse, status, uids, masked } from '../src/imap.mjs';
import { fetchMail, startImapSink } from '../tools/imap.mjs';

const enc = new TextEncoder(), dec = new TextDecoder();
const CRLF = String.fromCharCode(13, 10);

test('quote: an IMAP quoted string, or null', () => {
  assert.equal(quote('a"b' + String.fromCharCode(92) + 'c'), '"a' + String.fromCharCode(92) + '"b' + String.fromCharCode(92, 92) + 'c"');
  for (const bad of ['a' + CRLF, 'a' + String.fromCharCode(10), 'a' + String.fromCharCode(0), 5]) assert.equal(quote(bad), null);
  assert.equal(quote(''), '""');
});

test('commands: LOGIN, EXAMINE (read-only), UID SEARCH; a date as IMAP writes it', () => {
  assert.deepEqual(commands({ user: 'u', pass: 'p' }), ['a1 LOGIN "u" "p"', 'a2 EXAMINE "INBOX"', 'a3 UID SEARCH ALL']);
  assert.deepEqual(commands({ user: 'u', pass: 'p', mailbox: 'Work', since: new Date('2026-10-01T00:00:00Z') })[1], 'a2 EXAMINE "Work"');
  assert.equal(commands({ user: 'u', pass: 'p', since: new Date('2026-02-09T00:00:00Z') })[2], 'a3 UID SEARCH SINCE 9-Feb-2026');
  assert.equal(commands({ user: 'u', pass: 'p', since: new Date('x') })[2], 'a3 UID SEARCH ALL', 'a date that is not one is no date');
  for (const o of [{ user: 'u' + CRLF, pass: 'p' }, { user: 'u', pass: 5 }, { user: 'u', pass: 'p', mailbox: 'a' + CRLF }, null]) assert.equal(commands(o), null);
  assert.equal(fetchLine('a4', 7), 'a4 UID FETCH 7 (BODY.PEEK[])', 'PEEK: nothing is marked read');
  for (const [t, u] of [['a4', 0], ['a4', 1.5], ['4', 1], ['a1234567', 1], [5, 1]]) assert.equal(fetchLine(t, u), null);
  assert.equal(fetchLine('a123456', 1), 'a123456 UID FETCH 1 (BODY.PEEK[])');
});

test('parse: lines, a literal read by its exact byte count, a response not yet whole', () => {
  const msg = 'Subject: x' + CRLF + CRLF + 'body {5}' + CRLF;
  const all = enc.encode('* OK hi' + CRLF + '* 1 FETCH (UID 7 BODY[] {' + msg.length + '}' + CRLF + msg + ')' + CRLF + 'a4 OK done' + CRLF);
  const r = parse(all);
  assert.deepEqual(r.responses.map((x) => x.kind), ['line', 'fetch', 'line']);
  assert.equal(r.responses[1].uid, 7);
  assert.equal(dec.decode(r.responses[1].bytes), msg, 'a {n} inside the message is only bytes');
  assert.equal(r.rest.length, 0);
  for (let cut = 1; cut < all.length; cut++) {   // any split of the stream gives the same responses, once the rest arrives
    const a = parse(all.slice(0, cut));
    const joined = new Uint8Array(a.rest.length + all.length - cut); joined.set(a.rest); joined.set(all.slice(cut), a.rest.length);
    const b = parse(joined);
    assert.deepEqual([...a.responses, ...b.responses].map((x) => x.kind), ['line', 'fetch', 'line'], 'cut at ' + cut);
  }
  const after = parse(enc.encode('* 2 FETCH (BODY[] {3}' + CRLF + 'abc UID 9)' + CRLF));
  assert.equal(after.responses[0].uid, 9, 'the UID after the literal');
  assert.equal(parse(enc.encode('* 3 FETCH (BODY[] {3}' + CRLF + 'abc)' + CRLF)).responses[0].uid, null);
  assert.match(parse(enc.encode('* 1 FETCH (BODY[] {999999999}' + CRLF)).responses[0].text, /past the cap/);
  assert.equal(parse(enc.encode('* 1 FETCH (BODY[] {' + (25 << 20) + '}' + CRLF)).responses.length, 0, 'exactly the cap waits for its bytes');
  assert.deepEqual(parse(enc.encode('a' + String.fromCharCode(13) + 'b')).responses, [], 'a CR alone does not end a line');
  assert.deepEqual(parse('x'), { responses: [], rest: new Uint8Array(0) });
});

test('status, uids, masked', () => {
  assert.equal(status('a1 OK done', 'a1'), 'ok');
  assert.equal(status('a1 no wrong', 'a1'), 'no');
  assert.equal(status('a1 BAD x', 'a1'), 'bad');
  assert.equal(status('a2 OK done', 'a1'), null, 'another command\'s result');
  assert.equal(status('* OK hi', 'a1'), null);
  assert.equal(status(5, 'a1'), null);
  assert.deepEqual(uids('* SEARCH 3 4 10'), [3, 4, 10]);
  assert.deepEqual(uids('* SEARCH'), []);
  assert.deepEqual(uids('* OK x'), []);
  assert.equal(masked('a1 LOGIN "me@example.com" "secret pass"'), 'a1 LOGIN "me@example.com" ********');
  assert.equal(masked('a2 EXAMINE "INBOX"'), 'a2 EXAMINE "INBOX"');
  assert.equal(masked(5), '');
});

test('fetchMail against a local stand-in: read-only, the password never in the transcript, the newest at most max', async () => {
  const msgs = ['Subject: one' + CRLF + CRLF + 'first', 'Subject: two' + CRLF + CRLF + 'second', 'Subject: three' + CRLF + CRLF + 'third'];
  const sink = await startImapSink(msgs, { user: 'me@example.com', pass: 'a test password' });
  const r = await fetchMail({ host: '127.0.0.1', port: sink.port, tls: false, timeoutMs: 3000, user: 'me@example.com', pass: 'a test password', max: 2 });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.messages.map((m) => [m.uid, dec.decode(m.bytes)]), [[2, msgs[1]], [3, msgs[2]]]);
  assert.ok(sink.seen.some((l) => /EXAMINE/.test(l)) && !sink.seen.some((l) => /SELECT|STORE|EXPUNGE/.test(l)), 'never SELECT, STORE or EXPUNGE');
  assert.ok(sink.seen.filter((l) => /FETCH/.test(l)).every((l) => /BODY\.PEEK\[\]/.test(l)));
  assert.equal(r.transcript.join(' ').includes('a test password'), false, 'the password is never in the transcript');
  const wrong = await fetchMail({ host: '127.0.0.1', port: sink.port, tls: false, timeoutMs: 3000, user: 'me@example.com', pass: 'not it' });
  assert.match(wrong.why, /refused the login/);
  const box = await fetchMail({ host: '127.0.0.1', port: sink.port, tls: false, timeoutMs: 3000, user: 'me@example.com', pass: 'a test password', mailbox: 'Nope' });
  assert.match(box.why, /no such mailbox/);
  await sink.close();
  assert.match((await fetchMail({ host: 'imap.example.com', tls: false, user: 'u', pass: 'p' })).why, /only ever sent inside TLS/);
  assert.match((await fetchMail({ host: '127.0.0.1', tls: false, user: 'u' + CRLF, pass: 'p' })).why, /no line breaks/);
});
