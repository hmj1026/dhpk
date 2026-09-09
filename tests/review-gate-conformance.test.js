'use strict';

// Unit tests for the pure, I/O-free cross-platform conformance report
// builder (issue #372). scripts/lib/review-gate-conformance.js never touches
// ReceiptStore or ReviewGate, so it structurally
// cannot promote a migration phase -- these tests prove that in isolation
// from the live-adapter integration proofs in
// tests/review-gate-cross-platform-differential.test.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const conformance = require('../scripts/lib/review-gate-conformance');

const ROOT = path.join(__dirname, '..');
const NOW = '2026-09-07T04:00:00.000Z';

const MINI_CORPUS = Object.freeze({
  cases: [
    { caseId: 'mini-pass', scenarioKind: 'RESULT', adapters: ['CLAUDE', 'CODEX'] },
    { caseId: 'mini-unavailable', scenarioKind: 'FAILURE', adapters: ['CODEX'] },
    { caseId: 'mini-blocked', scenarioKind: 'PROVIDER', adapters: ['GIT_PROVIDER'] },
  ],
});
const MINI_OBSERVATIONS = [
  { caseId: 'mini-pass', adapter: 'CLAUDE', unavailable: false, blocked: false },
  { caseId: 'mini-pass', adapter: 'CODEX', unavailable: false, blocked: false },
  { caseId: 'mini-unavailable', adapter: 'CODEX', unavailable: true, blocked: false },
  { caseId: 'mini-blocked', adapter: 'GIT_PROVIDER', unavailable: false, blocked: true },
];

test('buildConformanceReport separates PASS, BLOCKED, UNAVAILABLE, and NOT_RUN and never claims promotion', () => {
  const report = conformance.buildConformanceReport({ corpus: MINI_CORPUS, observations: MINI_OBSERVATIONS, generatedAt: NOW });

  assert.strictEqual(report.schema, conformance.CONFORMANCE_REPORT_SCHEMA);
  assert.strictEqual(report.migrationPhase, 'OBSERVE');
  assert.strictEqual(report.promotionEligible, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(report, 'promote'));
  assert.ok(Object.isFrozen(report));

  const passCase = report.cases.find((entry) => entry.caseId === 'mini-pass');
  assert.strictEqual(passCase.byAdapter.CLAUDE, 'PASS');
  assert.strictEqual(passCase.byAdapter.CODEX, 'PASS');
  assert.strictEqual(passCase.byAdapter.CI, 'NOT_RUN');
  assert.strictEqual(passCase.byAdapter.GIT_PROVIDER, 'NOT_RUN');

  const unavailableCase = report.cases.find((entry) => entry.caseId === 'mini-unavailable');
  assert.strictEqual(unavailableCase.byAdapter.CODEX, 'UNAVAILABLE');

  const blockedCase = report.cases.find((entry) => entry.caseId === 'mini-blocked');
  assert.strictEqual(blockedCase.byAdapter.GIT_PROVIDER, 'BLOCKED');

  assert.strictEqual(report.totals.PASS, 2);
  assert.strictEqual(report.totals.UNAVAILABLE, 1);
  assert.strictEqual(report.totals.BLOCKED, 1);
  assert.strictEqual(report.totals.NOT_RUN, 11);
  assert.strictEqual(
    report.totals.PASS + report.totals.BLOCKED + report.totals.UNAVAILABLE + report.totals.NOT_RUN,
    MINI_CORPUS.cases.length * conformance.ADAPTER_KEYS.length,
  );
});

test('an observation for an inapplicable adapter is rejected rather than silently accepted', () => {
  assert.throws(() => conformance.buildConformanceReport({
    corpus: MINI_CORPUS,
    observations: [{ caseId: 'mini-blocked', adapter: 'CI', unavailable: false, blocked: false }],
    generatedAt: NOW,
  }), /INAPPLICABLE_OBSERVATION/);
});

test('a case missing an observation for one of its applicable adapters is rejected rather than defaulted', () => {
  assert.throws(() => conformance.buildConformanceReport({
    corpus: MINI_CORPUS,
    observations: MINI_OBSERVATIONS.filter((entry) => entry.caseId !== 'mini-blocked'),
    generatedAt: NOW,
  }), /MISSING_OBSERVATION/);
});

test('a duplicate observation for the same case and adapter is rejected', () => {
  assert.throws(() => conformance.buildConformanceReport({
    corpus: MINI_CORPUS,
    observations: [...MINI_OBSERVATIONS, { caseId: 'mini-pass', adapter: 'CLAUDE', unavailable: false, blocked: false }],
    generatedAt: NOW,
  }), /DUPLICATE_OBSERVATION/);
});

test('malformed corpus adapter lists and duplicate case IDs fail closed', () => {
  assert.throws(() => conformance.buildConformanceReport({
    corpus: {
      cases: [{ caseId: 'unknown-adapter', scenarioKind: 'RESULT', adapters: ['MISSPELLED'] }],
    },
    observations: [],
    generatedAt: NOW,
  }), /MALFORMED_CORPUS/);

  assert.throws(() => conformance.buildConformanceReport({
    corpus: {
      cases: [
        { caseId: 'duplicate-case', scenarioKind: 'RESULT', adapters: ['CLAUDE'] },
        { caseId: 'duplicate-case', scenarioKind: 'RESULT', adapters: ['CODEX'] },
      ],
    },
    observations: [],
    generatedAt: NOW,
  }), /MALFORMED_CORPUS/);
});

test('report preserves expected-versus-actual parity and exact mismatch context', () => {
  const corpus = {
    cases: [{
      caseId: 'parity-mismatch',
      scenarioKind: 'RESULT',
      adapters: ['CLAUDE', 'CODEX'],
      expected: { semanticVerdict: 'PASS', allowsTargetProgress: false },
    }],
  };
  const report = conformance.buildConformanceReport({
    corpus,
    observations: [
      {
        caseId: 'parity-mismatch',
        adapter: 'CLAUDE',
        actual: { semanticVerdict: 'PASS', allowsTargetProgress: false },
        context: {
          identity: { taskId: 'task-372' },
          policyVersion: 'policy-v1',
          contractVersion: 'contract-v1',
          legacyOutcome: { status: 'CLEARED', verdict: 'PASS' },
        },
      },
      {
        caseId: 'parity-mismatch',
        adapter: 'CODEX',
        actual: { semanticVerdict: 'CHANGES_REQUIRED', allowsTargetProgress: false },
        context: {
          identity: { taskId: 'task-372' },
          policyVersion: 'policy-v1',
          contractVersion: 'contract-v1',
          legacyOutcome: { status: 'CLEARED', verdict: 'PASS' },
        },
      },
    ],
    generatedAt: NOW,
  });

  assert.strictEqual(report.mismatches.length, 1);
  assert.deepStrictEqual(report.mismatches[0], {
    caseId: 'parity-mismatch',
    adapter: 'CODEX',
    expected: corpus.cases[0].expected,
    actual: { semanticVerdict: 'CHANGES_REQUIRED', allowsTargetProgress: false },
    context: {
      identity: { taskId: 'task-372' },
      policyVersion: 'policy-v1',
      contractVersion: 'contract-v1',
      legacyOutcome: { status: 'CLEARED', verdict: 'PASS' },
    },
  });
  assert.deepStrictEqual(report.cases[0].comparisons.CLAUDE, {
    expected: corpus.cases[0].expected,
    actual: { semanticVerdict: 'PASS', allowsTargetProgress: false },
    match: true,
  });
  assert.strictEqual(report.cases[0].comparisons.CODEX.match, false);
});

test('an expected case without an actual observation is an attributed mismatch', () => {
  const report = conformance.buildConformanceReport({
    corpus: { cases: [{ caseId: 'missing-actual', scenarioKind: 'RESULT', adapters: ['CLAUDE'], expected: { status: 'PASS' } }] },
    observations: [{ caseId: 'missing-actual', adapter: 'CLAUDE' }],
    generatedAt: NOW,
  });
  assert.deepStrictEqual(report.mismatches, [{
    caseId: 'missing-actual',
    adapter: 'CLAUDE',
    expected: { status: 'PASS' },
    actual: null,
    context: null,
    reason: 'MISSING_ACTUAL',
  }]);
});

test('report rejects accessor-backed actual values without invoking hostile getters', () => {
  let accessed = false;
  const actual = {};
  Object.defineProperty(actual, 'status', {
    enumerable: true,
    get() {
      accessed = true;
      return 'PASS';
    },
  });
  assert.throws(() => conformance.buildConformanceReport({
    corpus: { cases: [{ caseId: 'hostile-actual', scenarioKind: 'RESULT', adapters: ['CLAUDE'], expected: { status: 'PASS' } }] },
    observations: [{ caseId: 'hostile-actual', adapter: 'CLAUDE', actual }],
    generatedAt: NOW,
  }), /MALFORMED_OBSERVATION/);
  assert.strictEqual(accessed, false);
});

test('report clones a JSON __proto__ key as data without changing the result prototype', () => {
  const actual = JSON.parse('{"status":"PASS","__proto__":{"polluted":true}}');
  const report = conformance.buildConformanceReport({
    corpus: { cases: [{ caseId: 'proto-key', scenarioKind: 'RESULT', adapters: ['CLAUDE'], expected: { status: 'PASS' } }] },
    observations: [{ caseId: 'proto-key', adapter: 'CLAUDE', actual }],
    generatedAt: NOW,
  });
  const cloned = report.cases[0].comparisons.CLAUDE.actual;
  assert.strictEqual(Object.getPrototypeOf(cloned), Object.prototype);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cloned, '__proto__'), true);
  assert.deepStrictEqual(cloned.__proto__, { polluted: true });
  assert.strictEqual({}.polluted, undefined);
});

test('the conformance report is pure: no filesystem writes or workflow-state access', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-conformance-purity-'));
  const previous = process.cwd();
  try {
    process.chdir(temporary);
    conformance.buildConformanceReport({ corpus: MINI_CORPUS, observations: MINI_OBSERVATIONS, generatedAt: NOW });
    assert.deepStrictEqual(fs.readdirSync(temporary), []);
  } finally {
    process.chdir(previous);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.ok(
    !fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'review-gate-conformance.js'), 'utf8').includes('workflow-coordinator'),
    'the report builder must never import workflow state',
  );
});

const COMPLETE_METRICS = {
  modelTokens: 1200,
  dispatchCount: 2,
  semanticReviewCount: 1,
  remediationRounds: 1,
  humanTurns: 0,
  elapsedMs: 4800,
  falseBlockCount: 0,
  receiptReuseCount: 0,
};

const costRecord = ({ observationId, acceptedOutcome, metrics }) => ({
  schema: 'dhpk.accepted-outcome-cost.v1',
  observationId,
  acceptedOutcome,
  metrics,
  retirementEligible: acceptedOutcome && Object.keys(metrics).length === Object.keys(COMPLETE_METRICS).length,
});

test('groupCostByCohort distinguishes Accepted-Outcome Cost by risk cohort', () => {
  const lowRisk = costRecord({
    observationId: 'accepted-outcome-372-low',
    acceptedOutcome: true,
    metrics: { ...COMPLETE_METRICS, modelTokens: 400 },
  });
  const highRiskA = costRecord({
    observationId: 'accepted-outcome-372-high-a',
    acceptedOutcome: true,
    metrics: { ...COMPLETE_METRICS, modelTokens: 4000 },
  });
  const highRiskB = costRecord({
    observationId: 'accepted-outcome-372-high-b',
    acceptedOutcome: false,
    metrics: { dispatchCount: 1, semanticReviewCount: 1 },
  });

  const cohorts = conformance.groupCostByCohort([
    { cohort: 'LOW_RISK', cost: lowRisk },
    { cohort: 'HIGH_RISK', cost: highRiskA },
    { cohort: 'HIGH_RISK', cost: highRiskB },
  ]);

  assert.strictEqual(cohorts.LOW_RISK.observationCount, 1);
  assert.strictEqual(cohorts.LOW_RISK.metrics.modelTokens.sum, 400);
  assert.strictEqual(cohorts.LOW_RISK.retirementEligibleCount, 1);

  assert.strictEqual(cohorts.HIGH_RISK.observationCount, 2);
  assert.strictEqual(cohorts.HIGH_RISK.metrics.modelTokens.sum, 4000);
  assert.strictEqual(cohorts.HIGH_RISK.metrics.modelTokens.count, 1);
  assert.strictEqual(cohorts.HIGH_RISK.metrics.dispatchCount.sum, 3);
  assert.strictEqual(cohorts.HIGH_RISK.retirementEligibleCount, 1);
  assert.ok(Object.isFrozen(cohorts.HIGH_RISK));
});

test('groupCostByCohort rejects non-canonical metric values and keys', () => {
  assert.throws(() => conformance.groupCostByCohort([
    { cohort: 'LOW_RISK', cost: { metrics: { modelTokens: -1 } } },
  ]), /MALFORMED_COST_ENTRY/);
  assert.throws(() => conformance.groupCostByCohort([
    { cohort: 'LOW_RISK', cost: { metrics: { unknownMetric: 1 } } },
  ]), /MALFORMED_COST_ENTRY/);
});

test('deriveCaseStatus is the single source of truth for the PASS/BLOCKED/UNAVAILABLE ordering', () => {
  assert.strictEqual(conformance.deriveCaseStatus({ unavailable: true, blocked: true }), 'UNAVAILABLE');
  assert.strictEqual(conformance.deriveCaseStatus({ unavailable: false, blocked: true }), 'BLOCKED');
  assert.strictEqual(conformance.deriveCaseStatus({ unavailable: false, blocked: false }), 'PASS');
  assert.strictEqual(conformance.deriveCaseStatus(), 'PASS');
});

run('review-gate-conformance');
