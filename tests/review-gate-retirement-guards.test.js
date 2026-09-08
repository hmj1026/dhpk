'use strict';

// Unit tests for the generic ledger/receipt shape guards extracted from
// scripts/lib/review-gate-retirement.js (issue #375 file-size follow-up).

const { test, run, assert } = require('./_lib/tinytest');
const guards = require('../scripts/lib/review-gate-retirement-guards');

test('isRecord accepts plain objects and rejects arrays, null, and class instances', () => {
  assert.strictEqual(guards.isRecord({}), true);
  assert.strictEqual(guards.isRecord({ a: 1 }), true);
  assert.strictEqual(guards.isRecord([]), false);
  assert.strictEqual(guards.isRecord(null), false);
  assert.strictEqual(guards.isRecord('x'), false);
  assert.strictEqual(guards.isRecord(new (class Foo {})()), false);
});

test('requireRecord throws RetirementReportError with the given code on a non-record', () => {
  assert.throws(() => guards.requireRecord([], 'BAD_SHAPE'), (err) => (
    err instanceof guards.RetirementReportError && err.code === 'BAD_SHAPE'
  ));
  guards.requireRecord({});
});

test('requireArray enforces both array-ness and an optional max length', () => {
  assert.throws(() => guards.requireArray({}, 'NOT_ARRAY'), (err) => err.code === 'NOT_ARRAY');
  assert.throws(() => guards.requireArray([1, 2, 3], 'TOO_LONG', 2), (err) => err.code === 'TOO_LONG');
  guards.requireArray([1, 2], 'TOO_LONG', 2);
});

test('requireText rejects empty strings, control characters, and oversized text', () => {
  assert.throws(() => guards.requireText(''), (err) => err.code === 'MALFORMED_LEDGER');
  assert.throws(() => guards.requireText('has\x01control'), (err) => err.code === 'MALFORMED_LEDGER');
  assert.throws(() => guards.requireText('a'.repeat(10), 'TOO_BIG', 4), (err) => err.code === 'TOO_BIG');
  guards.requireText('ordinary text');
});

test('requireId enforces the SAFE_ID shape', () => {
  assert.throws(() => guards.requireId('not a safe id!'), (err) => err.code === 'MALFORMED_LEDGER');
  guards.requireId('work-368');
});

test('requireDigest enforces the sha256 fingerprint shape', () => {
  assert.throws(() => guards.requireDigest('not-a-digest'), (err) => err.code === 'MALFORMED_LEDGER');
  guards.requireDigest(`sha256:${'a'.repeat(64)}`);
});

test('requireTimestamp enforces a parseable date string', () => {
  assert.throws(() => guards.requireTimestamp('not-a-date'), (err) => err.code === 'MALFORMED_LEDGER');
  guards.requireTimestamp('2026-09-08T00:00:00.000Z');
});

test('fail throws a RetirementReportError carrying the given code', () => {
  assert.throws(() => guards.fail('SOME_CODE'), (err) => (
    err instanceof guards.RetirementReportError
      && err.name === 'RetirementReportError'
      && err.code === 'SOME_CODE'
  ));
});

run('review-gate-retirement-guards');
