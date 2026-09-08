'use strict';

// Unit tests for the Accepted-Outcome Cost aggregation extracted from
// scripts/lib/review-gate-retirement.js (issue #375 file-size follow-up).

const { test, run, assert } = require('./_lib/tinytest');
const { COST_FIELDS, aggregate } = require('../scripts/lib/review-gate-retirement-cost');

function cost(overrides = {}) {
  return {
    retirementEligible: true,
    metrics: {
      modelTokens: null,
      dispatchCount: 1,
      semanticReviewCount: 1,
      remediationRounds: 0,
      humanTurns: 1,
      elapsedMs: 10,
      falseBlockCount: 0,
      receiptReuseCount: 0,
    },
    ...overrides,
  };
}

test('COST_FIELDS lists the metric fields aggregate compares', () => {
  assert.deepStrictEqual(COST_FIELDS, [
    'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
    'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
  ]);
});

test('aggregate reports an unmatched cohort when CUTOVER has no baseline counterpart', () => {
  const result = aggregate([
    { phase: 'CUTOVER', cohort: 'risk-a', cost: cost() },
  ]);
  assert.deepStrictEqual(result.unmatchedCutoverCohorts, ['risk-a']);
  assert.deepStrictEqual(result.comparableCohorts, []);
  assert.strictEqual(result.strictImprovement, false);
});

test('aggregate marks a lower CUTOVER metric as IMPROVED and sets strictImprovement', () => {
  const result = aggregate([
    { phase: 'OBSERVE', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 100 } }) },
    { phase: 'CUTOVER', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 10 } }) },
  ]);
  assert.deepStrictEqual(result.comparableCohorts, ['risk-a']);
  assert.strictEqual(result.cohorts['risk-a'].metrics.elapsedMs, 'IMPROVED');
  assert.strictEqual(result.strictImprovement, true);
  assert.deepStrictEqual(result.regressions, []);
});

test('aggregate marks a higher CUTOVER metric as REGRESSED and records it', () => {
  const result = aggregate([
    { phase: 'OBSERVE', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 10 } }) },
    { phase: 'CUTOVER', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 100 } }) },
  ]);
  assert.strictEqual(result.cohorts['risk-a'].metrics.elapsedMs, 'REGRESSED');
  assert.deepStrictEqual(result.regressions, [{ cohort: 'risk-a', field: 'elapsedMs' }]);
});

test('aggregate marks an unchanged metric as UNCHANGED and a null-valued field as NOT_COMPARABLE', () => {
  const result = aggregate([
    { phase: 'OBSERVE', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 10, humanTurns: null } }) },
    { phase: 'CUTOVER', cohort: 'risk-a', cost: cost({ metrics: { ...cost().metrics, elapsedMs: 10, humanTurns: null } }) },
  ]);
  assert.strictEqual(result.cohorts['risk-a'].metrics.elapsedMs, 'UNCHANGED');
  assert.strictEqual(result.cohorts['risk-a'].metrics.humanTurns, 'NOT_COMPARABLE');
});

test('aggregate excludes entries whose cost is not retirementEligible', () => {
  const result = aggregate([
    { phase: 'OBSERVE', cohort: 'risk-a', cost: cost({ retirementEligible: false }) },
    { phase: 'CUTOVER', cohort: 'risk-a', cost: cost() },
  ]);
  assert.deepStrictEqual(result.unmatchedCutoverCohorts, ['risk-a']);
});

run('review-gate-retirement-cost');
