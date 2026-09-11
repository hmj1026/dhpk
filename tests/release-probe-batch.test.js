'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { mapWithConcurrency, normalizeConcurrency } = require('../scripts/lib/release-probe-batch');

test('bounded probe batch preserves order and caps live workers', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency(['a', 'b', 'c', 'd', 'e'], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value === 'a' ? 12 : 4));
    active -= 1;
    return value.toUpperCase();
  });
  assert.deepStrictEqual(result, ['A', 'B', 'C', 'D', 'E']);
  assert.strictEqual(peak, 2);
});

test('bounded probe concurrency is clamped to the configured maximum', () => {
  assert.strictEqual(normalizeConcurrency(99, { maximum: 4 }), 4);
  assert.throws(() => normalizeConcurrency(0), /positive integer/);
});

run('release-probe-batch');
