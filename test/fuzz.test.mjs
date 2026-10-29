// test/fuzz.test.mjs — claim G1: every exported function of every gated kernel, 2,000 hostile inputs, never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { throwsOn, PER_FUNCTION } from './hostile.mjs';
import { KERNELS } from './kernels.mjs';

for (const path of KERNELS) {
  test('fuzz ' + path, async () => {
    const mod = await import('../' + path);
    const fns = Object.entries(mod).filter(([, v]) => typeof v === 'function');
    assert.ok(fns.length > 0, path + ' exports no function');
    for (const [name, fn] of fns) {
      const bad = await throwsOn(fn);
      assert.deepEqual(bad.slice(0, 3), [], path + ' ' + name + ' threw on ' + bad.length + ' of ' + PER_FUNCTION + ' inputs');
    }
  });
}
