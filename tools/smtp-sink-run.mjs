#!/usr/bin/env node
// tools/smtp-sink-run.mjs — the stand-in for the owner's mail provider, for claim L6's runs: node tools/smtp-sink-run.mjs <host> <port>
import { startSink } from './smtp.mjs';
const s = await startSink(process.argv[2] || '127.0.0.1', Number(process.argv[3] || 2525));
console.log(JSON.stringify({ port: s.port }));
process.on('SIGTERM', () => { console.log(JSON.stringify({ messages: s.messages.length })); process.exit(0); });
setInterval(() => {}, 1 << 30);
