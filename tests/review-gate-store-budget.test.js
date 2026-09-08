'use strict';

// RED contract for the extracted store-budget accounting boundary.  The
// implementation is intentionally absent until the production worker owns the
// bounded counters; keep this test free of filesystem or store fixtures.

const { test, run, assert } = require('./_lib/tinytest');
const budget = require('../scripts/lib/review-gate-store-budget');

const LIMITS = Object.freeze({
  revisions: 10000,
  receiptsPerSequence: 200,
  receiptsPerWork: 10000,
  replayBytesPerWork: 16 * 1024 * 1024,
  leaseClaims: 20000,
  leaseReleases: 20000,
  leaseRecordBytes: 4096,
});

const DATA_LIMIT_FIELDS = Object.freeze([
  ['revisions', 'MALFORMED_EVIDENCE'],
  ['receiptsPerSequence', 'MALFORMED_EVIDENCE'],
  ['receiptsPerWork', 'MALFORMED_EVIDENCE'],
  ['replayBytesPerWork', 'MALFORMED_EVIDENCE'],
]);

const LEASE_LIMIT_FIELDS = Object.freeze([
  ['leaseClaims', 'LEASE_CONFLICT'],
  ['leaseReleases', 'LEASE_CONFLICT'],
  ['leaseRecordBytes', 'LEASE_CONFLICT'],
]);

const emptyAccounting = () => budget.emptyAccounting();

const assertLimitCase = (field, expectedCode) => {
  const initial = emptyAccounting();
  const atLimit = budget.addAccounting(initial, { [field]: LIMITS[field] });
  assert.notStrictEqual(atLimit, initial, `${field} accounting must be immutable`);
  assert.strictEqual(atLimit[field], LIMITS[field]);
  assert.strictEqual(initial[field], 0, `${field} accounting mutated its input`);

  const secretPayload = 'STORE_BUDGET_PRIVATE_PAYLOAD_SHOULD_NOT_ECHO';
  assert.throws(
    () => budget.addAccounting(initial, { [field]: LIMITS[field] + 1 }, secretPayload),
    (error) => error
      && error.code === expectedCode
      && !String(error.message).includes(secretPayload),
  );
};

test('store budget exports the exact immutable ceilings', () => {
  assert.deepStrictEqual(budget.LIMITS, LIMITS);
  assert.ok(Object.isFrozen(budget.LIMITS));
});

test('store budget accepts each counter at its limit and rejects one over without echoing payload', () => {
  for (const [field, code] of [...DATA_LIMIT_FIELDS, ...LEASE_LIMIT_FIELDS]) {
    assertLimitCase(field, code);
  }
});

test('store budget preserves independent immutable counters across increments', () => {
  const initial = emptyAccounting();
  const first = budget.addAccounting(initial, {
    revisions: 1,
    receiptsPerSequence: 2,
    receiptsPerWork: 3,
    replayBytesPerWork: 4,
    leaseClaims: 5,
    leaseReleases: 6,
  });
  const second = budget.addAccounting(first, { receiptsPerWork: 7 });
  assert.deepStrictEqual(initial, {
    revisions: 0,
    receiptsPerSequence: 0,
    receiptsPerWork: 0,
    replayBytesPerWork: 0,
    leaseClaims: 0,
    leaseReleases: 0,
    leaseRecordBytes: 0,
  });
  assert.strictEqual(first.receiptsPerWork, 3);
  assert.strictEqual(second.receiptsPerWork, 10);
  assert.strictEqual(first.revisions, 1);
  assert.strictEqual(second.revisions, 1);
});

test('lease record byte validation accepts 4 KiB and rejects one byte over', () => {
  assert.strictEqual(budget.assertLeaseRecordBytes('x'.repeat(LIMITS.leaseRecordBytes)), true);
  const secretPayload = 'LEASE_RECORD_PRIVATE_PAYLOAD_SHOULD_NOT_ECHO';
  assert.throws(
    () => budget.assertLeaseRecordBytes('x'.repeat(LIMITS.leaseRecordBytes + 1), secretPayload),
    (error) => error
      && error.code === 'LEASE_CONFLICT'
      && !String(error.message).includes(secretPayload),
  );
});

run('review-gate-store-budget');
