'use strict';

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateAssertionSummary(assertions, label, requireObservedStatus = true, allowUnknownSkipped = false) {
  if (!assertions || typeof assertions !== 'object' || Array.isArray(assertions)) {
    return [`${label} has no assertion summary.`];
  }
  if (requireObservedStatus && assertions.status !== 'OBSERVED') {
    return [`${label} assertion evidence is not observed.`];
  }

  const counts = ['total', 'passed', 'failed'];
  if (!allowUnknownSkipped || assertions.skipped !== null) counts.push('skipped');
  const invalidCount = counts.find((field) => !isCount(assertions[field]));
  if (invalidCount) return [`${label} has an invalid ${invalidCount} assertion count.`];
  if (assertions.total !== assertions.passed + assertions.failed) {
    return [`${label} assertion totals are inconsistent.`];
  }
  if (assertions.failed !== 0) return [`${label} contains failed assertions.`];
  return [];
}


module.exports = { validateAssertionSummary };
