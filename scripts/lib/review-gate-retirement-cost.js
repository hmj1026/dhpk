'use strict';

// Accepted-Outcome Cost aggregation for scripts/lib/review-gate-retirement.js.
// Extracted to keep that file under the project's file-size guideline; pure
// function over an already-validated `entries` array, no ledger/receipt
// parsing of its own.

const { groupCostByCohort } = require('./review-gate-conformance');

const COST_FIELDS = Object.freeze([
  'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
  'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
]);

function aggregate(entries) {
  const baseline = groupCostByCohort(entries.filter((entry) => entry.phase !== 'CUTOVER')
    .filter((entry) => entry.cost.retirementEligible)
    .map((entry) => ({ cohort: entry.cohort, cost: entry.cost })));
  const cutover = groupCostByCohort(entries.filter((entry) => entry.phase === 'CUTOVER')
    .filter((entry) => entry.cost.retirementEligible)
    .map((entry) => ({ cohort: entry.cohort, cost: entry.cost })));
  const cohorts = {};
  const comparable = [];
  const unmatched = [];
  const regressions = [];
  let strictImprovement = false;
  const exactMetrics = (items) => {
    const result = {};
    for (const entry of items.filter((item) => item.cost.retirementEligible)) {
      if (!result[entry.cohort]) result[entry.cohort] = {};
      for (const field of COST_FIELDS) {
        const value = entry.cost.metrics[field];
        if (value === null) continue;
        if (!result[entry.cohort][field]) result[entry.cohort][field] = { sum: 0n, count: 0 };
        result[entry.cohort][field].sum += BigInt(value);
        result[entry.cohort][field].count += 1;
      }
    }
    return result;
  };
  const exactBaseline = exactMetrics(entries.filter((entry) => entry.phase !== 'CUTOVER'));
  const exactCutover = exactMetrics(entries.filter((entry) => entry.phase === 'CUTOVER'));
  for (const cohort of Object.keys(cutover)) {
    const current = cutover[cohort];
    const previous = baseline[cohort];
    const metrics = {};
    if (!previous) {
      unmatched.push(cohort);
      cohorts[cohort] = { baseline: null, cutover: current, metrics };
      continue;
    }
    comparable.push(cohort);
    for (const field of COST_FIELDS) {
      const before = exactBaseline[cohort] && exactBaseline[cohort][field];
      const after = exactCutover[cohort] && exactCutover[cohort][field];
      if (!before || !after || before.count === 0 || after.count === 0) {
        metrics[field] = 'NOT_COMPARABLE';
        continue;
      }
      const left = after.sum * BigInt(before.count);
      const right = before.sum * BigInt(after.count);
      const direction = left < right ? 'IMPROVED' : left > right ? 'REGRESSED' : 'UNCHANGED';
      metrics[field] = direction;
      if (direction === 'IMPROVED') strictImprovement = true;
      if (direction === 'REGRESSED') regressions.push({ cohort, field });
    }
    cohorts[cohort] = { baseline: previous, cutover: current, metrics };
  }
  return {
    baseline,
    cutover,
    cohorts,
    comparableCohorts: comparable,
    unmatchedCutoverCohorts: unmatched,
    regressions,
    strictImprovement,
  };
}

module.exports = {
  COST_FIELDS,
  aggregate,
};
