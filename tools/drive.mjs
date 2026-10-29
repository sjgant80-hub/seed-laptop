// tools/drive.mjs — run tools/device.mjs as a child process and talk to it: await dev.do('edit', { key, value }).
// For the measures and the demo; it decides nothing.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEVICE = join(dirname(fileURLToPath(import.meta.url)), 'device.mjs');

export function startDevice(home) {
  return new Promise((ready) => {
    const p = spawn(process.execPath, [DEVICE, home], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = createInterface({ input: p.stdout });
    const pending = new Map();
    const events = [];
    let n = 0;
    rl.on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.event === 'ready') { ready(dev); return; }
      if (m.event) { events.push(m); return; }
      const w = pending.get(m.id);
      if (w) { pending.delete(m.id); w(m); }
    });
    const dev = {
      proc: p, events,
      do(cmd, args = {}) { const id = ++n; p.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n'); return new Promise((r) => pending.set(id, r)); },
      kill() { p.kill('SIGKILL'); return new Promise((r) => (p.exitCode !== null ? r() : p.once('exit', r))); },
    };
  });
}
