'use strict';

// Cross-platform differential conformance for issue #372: a pure, I/O-free
// report builder that aggregates already-executed per-adapter case
// observations (produced by driving the real Claude/Codex/CI/Git-provider
// adapters against the shared corpus in
// tests/fixtures/review-gate/cross-platform-differential-v1.json) into one
// PASS/BLOCKED/UNAVAILABLE/NOT_RUN report. It never touches ReceiptStore or
// ReviewGate, so it can only report on runs the caller already performed.

const SCENARIO_KINDS = Object.freeze(['REQUEST', 'RESULT', 'RECEIPT', 'REPLAY', 'WORKFLOW', 'PROVIDER', 'FAILURE']);
const ADAPTER_KEYS = Object.freeze(['CLAUDE', 'CODEX', 'CI', 'GIT_PROVIDER', 'CORE']);
const REPORT_STATUSES = Object.freeze(['PASS', 'BLOCKED', 'UNAVAILABLE', 'NOT_RUN']);
const CONFORMANCE_REPORT_SCHEMA = 'dhpk.cross-platform-differential-report.v1';
const FIXED_MIGRATION_PHASE = 'OBSERVE';
const COST_METRIC_FIELDS = Object.freeze([
  'modelTokens', 'dispatchCount', 'semanticReviewCount', 'remediationRounds',
  'humanTurns', 'elapsedMs', 'falseBlockCount', 'receiptReuseCount',
]);

class ConformanceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = (code) => { throw new ConformanceError(code); };

const isRecord = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
};

const deriveCaseStatus = ({ unavailable = false, blocked = false } = {}) => {
  if (unavailable) return 'UNAVAILABLE';
  if (blocked) return 'BLOCKED';
  return 'PASS';
};

function cloneJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('MALFORMED_OBSERVATION');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) fail('MALFORMED_OBSERVATION');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = [];
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => key !== 'length'
      && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
      fail('MALFORMED_OBSERVATION');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) fail('MALFORMED_OBSERVATION');
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
        fail('MALFORMED_OBSERVATION');
      }
      result.push(cloneJson(descriptor.value, seen));
    }
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) fail('MALFORMED_OBSERVATION');
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
      fail('MALFORMED_OBSERVATION');
    }
    Object.defineProperty(result, key, {
      value: cloneJson(descriptor.value, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return result;
}

function comparableJson(value) {
  if (Array.isArray(value)) return `[${value.map(comparableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${comparableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return comparableJson(left) === comparableJson(right);
}

function conformsToExpected(expected, actual) {
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.keys(expected).every((key) => (
      Object.prototype.hasOwnProperty.call(actual, key)
      && conformsToExpected(expected[key], actual[key])
    ));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => conformsToExpected(value, actual[index]));
  }
  return sameJson(expected, actual);
}

function comparisonFor(corpusCase, observation) {
  const hasExpected = Object.prototype.hasOwnProperty.call(observation, 'expected')
    || Object.prototype.hasOwnProperty.call(corpusCase, 'expected');
  const hasActual = Object.prototype.hasOwnProperty.call(observation, 'actual');
  if (!hasExpected) return null;
  const expectedSource = Object.prototype.hasOwnProperty.call(observation, 'expected')
    ? observation.expected : corpusCase.expected;
  const expected = cloneJson(expectedSource);
  if (!hasActual) return { expected, actual: null, match: false, reason: 'MISSING_ACTUAL' };
  const actual = cloneJson(observation.actual);
  return { expected, actual, match: conformsToExpected(expected, actual) };
}

function assertObservation(observation) {
  if (!isRecord(observation)) fail('MALFORMED_OBSERVATION');
  if (typeof observation.caseId !== 'string' || observation.caseId.length === 0) fail('MALFORMED_OBSERVATION');
  if (!ADAPTER_KEYS.includes(observation.adapter)) fail('MALFORMED_OBSERVATION');
  if (observation.unavailable !== undefined && typeof observation.unavailable !== 'boolean') fail('MALFORMED_OBSERVATION');
  if (observation.blocked !== undefined && typeof observation.blocked !== 'boolean') fail('MALFORMED_OBSERVATION');
  if (Object.prototype.hasOwnProperty.call(observation, 'context')) cloneJson(observation.context);
}

function buildConformanceReport({ corpus, observations, generatedAt, costObservations = [] }) {
  if (!isRecord(corpus) || !Array.isArray(corpus.cases)) fail('MALFORMED_CORPUS');
  if (!Array.isArray(observations)) fail('MALFORMED_OBSERVATIONS');
  if (typeof generatedAt !== 'string' || generatedAt.length === 0) fail('MALFORMED_TIMESTAMP');
  if (!Array.isArray(costObservations)) fail('MALFORMED_COST_ENTRIES');

  const applicableByCase = new Map();
  for (const corpusCase of corpus.cases) {
    if (!isRecord(corpusCase)) fail('MALFORMED_CORPUS');
    if (typeof corpusCase.caseId !== 'string' || corpusCase.caseId.length === 0) fail('MALFORMED_CORPUS');
    if (applicableByCase.has(corpusCase.caseId)) fail('MALFORMED_CORPUS');
    if (!SCENARIO_KINDS.includes(corpusCase.scenarioKind)) fail('MALFORMED_CORPUS');
    if (!Array.isArray(corpusCase.adapters)) fail('MALFORMED_CORPUS');
    if (corpusCase.adapters.length === 0) fail('MALFORMED_CORPUS');
    const adapterSet = new Set();
    for (const adapter of corpusCase.adapters) {
      if (!ADAPTER_KEYS.includes(adapter) || adapterSet.has(adapter)) fail('MALFORMED_CORPUS');
      adapterSet.add(adapter);
    }
    applicableByCase.set(corpusCase.caseId, adapterSet);
  }

  const observedByCase = new Map();
  for (const observation of observations) {
    assertObservation(observation);
    const applicable = applicableByCase.get(observation.caseId);
    if (!applicable) fail('UNKNOWN_CASE');
    if (!applicable.has(observation.adapter)) fail('INAPPLICABLE_OBSERVATION');
    if (!observedByCase.has(observation.caseId)) observedByCase.set(observation.caseId, new Map());
    const byAdapter = observedByCase.get(observation.caseId);
    if (byAdapter.has(observation.adapter)) fail('DUPLICATE_OBSERVATION');
    byAdapter.set(observation.adapter, {
      status: deriveCaseStatus(observation),
      observation,
    });
  }

  const totals = { PASS: 0, BLOCKED: 0, UNAVAILABLE: 0, NOT_RUN: 0 };
  const cases = [];
  const mismatches = [];
  for (const corpusCase of corpus.cases) {
    const applicable = applicableByCase.get(corpusCase.caseId);
    const observed = observedByCase.get(corpusCase.caseId) || new Map();
    const byAdapter = {};
    const comparisons = {};
    for (const adapterKey of ADAPTER_KEYS) {
      let status;
      if (!applicable.has(adapterKey)) {
        status = 'NOT_RUN';
      } else {
        if (!observed.has(adapterKey)) fail('MISSING_OBSERVATION');
        const observedEntry = observed.get(adapterKey);
        status = observedEntry.status;
        const comparison = comparisonFor(corpusCase, observedEntry.observation);
        if (comparison) {
          comparisons[adapterKey] = comparison;
          if (!comparison.match) {
            mismatches.push({
              caseId: corpusCase.caseId,
              adapter: adapterKey,
              expected: comparison.expected,
              actual: comparison.actual,
              context: Object.prototype.hasOwnProperty.call(observedEntry.observation, 'context')
                ? cloneJson(observedEntry.observation.context) : null,
              ...(comparison.reason ? { reason: comparison.reason } : {}),
            });
          }
        }
      }
      byAdapter[adapterKey] = status;
      totals[status] += 1;
    }
    const reportCase = { caseId: corpusCase.caseId, scenarioKind: corpusCase.scenarioKind, byAdapter };
    if (Object.prototype.hasOwnProperty.call(corpusCase, 'expected')) reportCase.expected = cloneJson(corpusCase.expected);
    if (Object.keys(comparisons).length > 0) reportCase.comparisons = comparisons;
    cases.push(reportCase);
  }

  const reportCostEntries = costObservations.length > 0
    ? costObservations : observations.filter((observation) => observation.cohort && observation.cost)
      .map((observation) => ({ cohort: observation.cohort, cost: observation.cost }));

  return deepFreeze({
    schema: CONFORMANCE_REPORT_SCHEMA,
    generatedAt,
    migrationPhase: FIXED_MIGRATION_PHASE,
    promotionEligible: false,
    totals,
    cases,
    mismatches,
    costCohorts: groupCostByCohort(reportCostEntries),
  });
}

function groupCostByCohort(entries) {
  if (!Array.isArray(entries)) fail('MALFORMED_COST_ENTRIES');
  const cohorts = Object.create(null);
  for (const entry of entries) {
    if (!isRecord(entry)) fail('MALFORMED_COST_ENTRY');
    const { cohort, cost } = entry;
    if (typeof cohort !== 'string' || cohort.length === 0) fail('MALFORMED_COHORT');
    if (!isRecord(cost) || !isRecord(cost.metrics)) fail('MALFORMED_COST_ENTRY');
    if (!cohorts[cohort]) {
      cohorts[cohort] = { cohort, observationCount: 0, retirementEligibleCount: 0, metrics: Object.create(null) };
    }
    const bucket = cohorts[cohort];
    bucket.observationCount += 1;
    if (cost.retirementEligible === true) bucket.retirementEligibleCount += 1;
    for (const [field, value] of Object.entries(cost.metrics)) {
      if (!COST_METRIC_FIELDS.includes(field)) fail('MALFORMED_COST_ENTRY');
      if (value === null) continue;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('MALFORMED_COST_ENTRY');
      if (!bucket.metrics[field]) bucket.metrics[field] = { sum: 0, count: 0 };
      bucket.metrics[field].sum += value;
      bucket.metrics[field].count += 1;
    }
  }
  const plainCohorts = Object.fromEntries(Object.entries(cohorts).map(([cohort, bucket]) => [
    cohort,
    { ...bucket, metrics: Object.fromEntries(Object.entries(bucket.metrics)) },
  ]));
  return deepFreeze(plainCohorts);
}

module.exports = {
  SCENARIO_KINDS,
  ADAPTER_KEYS,
  REPORT_STATUSES,
  COST_METRIC_FIELDS,
  CONFORMANCE_REPORT_SCHEMA,
  FIXED_MIGRATION_PHASE,
  ConformanceError,
  deriveCaseStatus,
  buildConformanceReport,
  groupCostByCohort,
};
