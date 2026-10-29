import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, pick, textOf, find, answer, INTENTS, MAX_TEXT, MAX_RESULTS } from '../src/kar.mjs';
import { emptyStore, write } from '../src/store.mjs';

const BLOCKS = [{ id: 'office', name: 'Words, Sheets, Slides' }, { id: 'crm', name: 'Contacts and deals' }, { id: 'ledger', name: 'Accounts' }];
const D = 'd'.repeat(64);

test('parse: each intent from plain words', () => {
  assert.deepEqual(parse('help', BLOCKS), { intent: 'help', arg: null });
  assert.deepEqual(parse('What can you do?', BLOCKS), { intent: 'help', arg: null });
  assert.deepEqual(parse('?', BLOCKS), { intent: 'help', arg: null });
  assert.deepEqual(parse('list', BLOCKS), { intent: 'list', arg: null });
  assert.deepEqual(parse("What's in my office", BLOCKS), { intent: 'list', arg: null });
  assert.deepEqual(parse('show me my office', BLOCKS), { intent: 'list', arg: null });
  assert.deepEqual(parse('recent', BLOCKS), { intent: 'recent', arg: null });
  assert.deepEqual(parse('What changed?', BLOCKS), { intent: 'recent', arg: null });
  assert.deepEqual(parse('show the receipts', BLOCKS), { intent: 'recent', arg: null });
  assert.deepEqual(parse('find the Acme invoice', BLOCKS), { intent: 'find', arg: 'the acme invoice' });
  assert.deepEqual(parse('search for Jane', BLOCKS), { intent: 'find', arg: 'jane' });
  assert.deepEqual(parse('where is the contract', BLOCKS), { intent: 'find', arg: 'the contract' });
});

test('parse: open by id, by name, by one word of the name', () => {
  assert.deepEqual(parse('open crm', BLOCKS), { intent: 'open', arg: 'crm' });
  assert.deepEqual(parse('Open the CRM', BLOCKS), { intent: 'open', arg: 'crm' });
  assert.deepEqual(parse('go to accounts', BLOCKS), { intent: 'open', arg: 'ledger' });
  assert.deepEqual(parse('open contacts', BLOCKS), { intent: 'open', arg: 'crm' });
  assert.deepEqual(parse('start my led', BLOCKS), { intent: 'open', arg: 'ledger' }, 'the start of an id');
  assert.deepEqual(parse('open contacts and deals', BLOCKS), { intent: 'open', arg: 'crm' }, 'the whole name');
  const none = parse('open spaceship', BLOCKS);
  assert.equal(none.intent, null);
  assert.match(none.why, /no block called "spaceship"/);
  assert.equal(parse('open crm', null).intent, null);
  assert.deepEqual(parse('open crm', [null, ...BLOCKS]), { intent: 'open', arg: 'crm' });
});

test('parse: nothing, too long, unknown', () => {
  assert.match(parse('', BLOCKS).why, /ask me something/);
  assert.match(parse('   !!! ', BLOCKS).why, /ask me something/);
  assert.match(parse('x'.repeat(MAX_TEXT + 1), BLOCKS).why, /up to/);
  assert.notEqual(parse('help ' + 'x'.repeat(MAX_TEXT - 5), BLOCKS).intent, null, 'exactly MAX_TEXT characters is read');
  assert.match(parse('make me a sandwich', BLOCKS).why, /do not know/);
  assert.equal(parse(5, BLOCKS).intent, null);
  assert.equal(parse('helpful advice', BLOCKS).intent, null, 'a word that only starts like one is not it');
  assert.equal(parse('listen', BLOCKS).intent, null);
});

test('pick: a model may only choose from the list, by its first word', () => {
  assert.equal(pick('find', INTENTS), 'find');
  assert.equal(pick('Open — the crm', ['open']), 'open');
  assert.equal(pick('I think you should find it', INTENTS), null);
  assert.equal(pick('delete everything', [...INTENTS, 'delete']), null, 'not one Kar has');
  assert.equal(pick('find', ['open']), null, 'not one allowed here');
  assert.equal(pick(5, INTENTS), null);
  assert.equal(pick('find', 'find'), null);
});

test('textOf: every piece of text in a stored value', () => {
  assert.deepEqual(textOf(['o', [['name', ['s', 'Jane']], ['tags', ['a', [['s', 'vip'], ['n', 1]]]], ['m', ['map', [[['s', 'k'], ['s', 'v']]]]], ['set', ['set', [['s', 'x']]]]]]), ['Jane', 'vip', 'k', 'v', 'x']);
  assert.deepEqual(textOf('x'), []);
  assert.deepEqual(textOf(['o', 'x']), []);
  assert.deepEqual(textOf(['o', [5, ['k', ['s', 'v']]]]), ['v']);
  let deep = ['s', 'deep']; for (let i = 0; i < 70; i++) deep = ['a', [deep]];
  assert.deepEqual(textOf(deep), [], 'past 64 levels nothing is read');
  let ok = ['s', 'ok']; for (let i = 0; i < 64; i++) ok = ['a', [ok]];
  assert.deepEqual(textOf(ok), ['ok']);
});

test('find: every word, any case, across blocks; never past the limit', () => {
  let st = emptyStore();
  const put = (k, v) => { st = write(st, D, k, v).store; };
  put('b/crm/idb/c/s/1', ['a', [['n', 1], ['o', [['name', ['s', 'Jane Doe, Acme Ltd']]]]]]);
  put('b/office/idb/o/s/1', ['a', [['s', 'state'], ['s', 'Invoice for ACME — March']]]);
  put('b/ledger/ls/x', ['s', 'nothing here']);
  put('kar/receipts/1', ['s', 'acme in a receipt is not office data']);
  const r = find(st, 'Acme');
  assert.deepEqual(r.map((x) => x.block).sort(), ['crm', 'office']);
  assert.ok(r.find((x) => x.block === 'office').snippet.includes('ACME'));
  assert.deepEqual(find(st, 'acme march').map((x) => x.block), ['office'], 'every word must be there');
  assert.deepEqual(find(st, ''), []);
  assert.deepEqual(find(st, 5), []);
  for (let i = 0; i < 30; i++) put('b/crm/ls/k' + i, ['s', 'acme ' + i]);
  assert.equal(find(st, 'acme').length, MAX_RESULTS);
  assert.equal(find(st, 'acme', 3).length, 3);
  assert.equal(find(st, 'acme', 1).length, 1);
  assert.equal(find(st, 'acme', 0).length, MAX_RESULTS, 'a limit that is not a positive whole number reads as the most');
  assert.equal(find(st, 'acme', 99).length, MAX_RESULTS);
  const long = 'x'.repeat(100) + 'needle' + 'y'.repeat(200);
  put('b/crm/ls/long', ['s', long]);
  assert.equal(find(st, 'needle')[0].snippet, long.slice(60, 180), '40 characters before, 80 from the word');
});

test('answer: each intent, in plain words', () => {
  let st = emptyStore();
  st = write(st, D, 'b/crm/ls/x', ['s', 'Acme']).store;
  const ctx = { blocks: BLOCKS, store: st, receipts: [{ says: 'one' }, { says: 'two' }] };
  assert.match(answer('help', null, ctx).says, /^I can: list/);
  assert.match(answer('help', null, ctx).says, /any file you brought in/);
  assert.equal(answer('list', null, ctx).says, 'Your office has 3 blocks: Words, Sheets, Slides (office), Contacts and deals (crm), Accounts (ledger).');
  assert.deepEqual(answer('open', 'crm', ctx), { says: 'Opening Contacts and deals.', open: 'crm' });
  assert.deepEqual(answer('open', 'zzz', ctx), { says: 'There is no block called zzz.' });
  const f = answer('find', 'acme', ctx);
  assert.equal(f.says, 'Found acme in 1 place: crm.');
  assert.equal(f.results.length, 1);
  st = write(st, D, 'b/office/ls/y', ['s', 'acme too']).store;
  assert.equal(answer('find', 'acme', { ...ctx, store: st }).says, 'Found acme in 2 places: crm, office.');
  assert.equal(answer('find', 'zebra', ctx).says, 'Nothing in your office mentions zebra.');
  assert.equal(answer('recent', null, ctx).says, 'The last 2: one · two');
  assert.equal(answer('recent', null, { ...ctx, receipts: [] }).says, 'Nothing has happened yet.');
  const six = Array.from({ length: 6 }, (_, i) => ({ says: 's' + i }));
  assert.equal(answer('recent', null, { ...ctx, receipts: six }).says, 'The last 5: s1 · s2 · s3 · s4 · s5');
  assert.equal(answer('recent', null, { ...ctx, receipts: [null, { says: 'ok' }] }).says, 'The last 2: ok');
  assert.match(answer('fly', null, ctx).says, /do not know/);
  assert.equal(answer('list', null, null).says, 'Your office has 0 blocks: .');
});

test('textOf: only the tags that hold text are opened, to a bounded depth through objects and maps', () => {
  assert.deepEqual(textOf(['zz', [['k', ['s', 'v']]]]), [], 'an unknown tag is not opened');
  let deep = ['s', 'deep']; for (let i = 0; i < 70; i++) deep = ['o', [['k', deep]]];
  assert.deepEqual(textOf(deep), []);
  let ok = ['s', 'ok']; for (let i = 0; i < 64; i++) ok = ['o', [['k', ok]]];
  assert.deepEqual(textOf(ok), ['ok']);
  let mk = ['s', 'mk']; for (let i = 0; i < 70; i++) mk = ['map', [[mk, ['n', 1]]]];
  assert.deepEqual(textOf(mk), []);
  let mk2 = ['s', 'mk']; for (let i = 0; i < 64; i++) mk2 = ['map', [[mk2, ['n', 1]]]];
  assert.deepEqual(textOf(mk2), ['mk']);
});

test('find: the reading of a file brought in is searched; its raw bytes and its meta are not', () => {
  let st = emptyStore();
  st = write(st, D, 'files/' + 'a'.repeat(64) + '/read', ['o', [['text', ['s', 'The rye loaf sold out on Friday']]]]).store;
  st = write(st, D, 'files/' + 'a'.repeat(64), ['o', [['name', ['s', 'rye-notes.pdf']]]]).store;
  const r = find(st, 'rye');
  assert.deepEqual(r.map((x) => [x.block, x.key.endsWith('/read')]), [['files', true]]);
  assert.equal(answer('find', 'rye', { blocks: BLOCKS, store: st }).says, 'Found rye in 1 place: files.');
});
