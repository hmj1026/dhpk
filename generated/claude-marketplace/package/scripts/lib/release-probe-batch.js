'use strict';

// Small dependency-free bounded concurrency primitive. It keeps result order
// stable while ensuring the number of live consumer processes never exceeds
// the configured limit.

function normalizeConcurrency(value, { fallback = 1, maximum = 4 } = {}) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1) throw new Error('probe concurrency must be a positive integer');
  return Math.min(candidate, maximum);
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items)) throw new Error('bounded batch items must be an array');
  if (typeof worker !== 'function') throw new Error('bounded batch worker must be a function');
  const limit = normalizeConcurrency(concurrency);
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

module.exports = { normalizeConcurrency, mapWithConcurrency };
