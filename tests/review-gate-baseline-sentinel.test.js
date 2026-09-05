'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const baseline = require('../scripts/lib/review-gate-baseline');

const ROOT = path.join(__dirname, '..');
const CORPUS_PATH = path.join(__dirname, 'fixtures', 'review-gate', 'sentinel-differential-v1.json');
const CORPUS = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));
const REQUIRED_CASES = [
  'no-op-not-applicable',
  'fresh-pass',
  'missing-artifact',
  'stale-artifact',
  'malformed-native-artifact',
  'misplaced-artifact',
  'foreign-identity',
  'concurrent-session',
  'resumed-pass',
  'resumed-intermediate',
  'resumed-malformed',
  'interrupted-reviewer',
  'retry-allowed',
  'retry-exhausted',
  'unresolved-fail',
  'unresolved-resumed-block',
  'unresolved-clean-follow-up',
];
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

function expectedOutcome(input) {
  return {
    schema: baseline.SENTINEL_OUTCOME_SCHEMA,
    caseId: input.caseId,
    evidenceCondition: input.evidenceCondition,
    lifecycleClearance: input.lifecycleClearance,
    semanticApproval: input.semanticApproval,
    completion: input.completion,
    sentinelAuthority: true,
    unresolvedVerdict: input.unresolvedVerdict,
    reasonCodes: input.reasonCodes,
  };
}

function assertDeepFrozen(value) {
  assert.strictEqual(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') assertDeepFrozen(child);
  }
}

test('corpus names every required legacy scenario and stays platform-neutral', () => {
  assert.strictEqual(CORPUS.schema, 'dhpk.sentinel-differential-corpus.v1');
  assert.strictEqual(CORPUS.authority, 'SENTINEL');
  assert.deepStrictEqual(CORPUS.cases.map(({ input }) => input.caseId), REQUIRED_CASES);
  assert.doesNotMatch(JSON.stringify(CORPUS.cases.map(({ input }) => input)), /\.claude|\/home\/|\\Users\\/);
});

test('every corpus case is bound to an executable legacy characterization', () => {
  const proofFiles = new Set();
  for (const entry of [...CORPUS.cases, ...CORPUS.deterministicProtections]) {
    const proofFile = entry.proof?.file || entry.file;
    const source = fs.readFileSync(path.join(ROOT, proofFile), 'utf8');
    assert.ok(source.includes(`test('${entry.proof?.test || entry.test}'`), `${entry.input?.caseId || entry.kind} proof is missing`);
    proofFiles.add(proofFile);
  }
  for (const proofFile of proofFiles) {
    const proof = spawnSync(process.execPath, [path.join(ROOT, proofFile)], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(proof.status, 0, `${proofFile} failed:\n${proof.stdout}\n${proof.stderr}`);
  }
});

test('normalizes lifecycle clearance separately from semantic approval', () => {
  for (const { input } of CORPUS.cases) {
    assert.deepStrictEqual(baseline.normalizeSentinelOutcome(input), expectedOutcome(input));
  }
  const resumedMalformed = baseline.normalizeSentinelOutcome(
    CORPUS.cases.find(({ input }) => input.caseId === 'resumed-malformed').input
  );
  assert.strictEqual(resumedMalformed.lifecycleClearance, 'CLEARED');
  assert.strictEqual(resumedMalformed.semanticApproval, 'NOT_ESTABLISHED');
  assert.strictEqual(resumedMalformed.completion, 'BLOCKED');
});

test('rejects contradictory passing outcomes and returns immutable records', () => {
  const input = CORPUS.cases.find(({ input: row }) => row.caseId === 'fresh-pass').input;
  const normalized = baseline.normalizeSentinelOutcome(input);
  assertDeepFrozen(normalized);
  assert.throws(() => baseline.normalizeSentinelOutcome({
    ...input,
    lifecycleClearance: 'PENDING',
  }), /passing completion.*pending lifecycle/i);
  assert.throws(() => baseline.normalizeSentinelOutcome({
    ...input,
    unresolvedVerdict: true,
  }), /passing completion.*unresolved verdict/i);
});

test('records complete Accepted-Outcome Cost without mutating the input', () => {
  const input = {
    observationId: 'accepted-outcome-1',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures: [],
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const normalized = baseline.normalizeAcceptedOutcomeCost(input);
  assert.deepStrictEqual(input, snapshot);
  assert.deepStrictEqual(normalized.metrics, COMPLETE_METRICS);
  assert.strictEqual(normalized.telemetryStatus, 'COMPLETE');
  assert.strictEqual(normalized.retirementEligible, true);
  assertDeepFrozen(normalized);
});

test('keeps unavailable counters null and excludes partial observations', () => {
  const normalized = baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-2',
    acceptedOutcome: true,
    metrics: { dispatchCount: 1, semanticReviewCount: 1 },
  });
  assert.strictEqual(normalized.metrics.dispatchCount, 1);
  for (const field of baseline.COST_FIELDS) {
    if (!['dispatchCount', 'semanticReviewCount'].includes(field)) assert.strictEqual(normalized.metrics[field], null);
  }
  assert.strictEqual(normalized.telemetryStatus, 'PARTIAL');
  assert.strictEqual(normalized.retirementEligible, false);
});

test('redacts bounded telemetry failures and excludes failed observations', () => {
  const marker = 'BASELINE_SECRET_12345678901234567890';
  const normalized = baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-3',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures: [{
      code: 'COLLECTOR_FAILED',
      detail: `Authorization: Bearer ${marker} at /home/example/private/telemetry.jsonl ${'x'.repeat(600)}`,
    }],
  });
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.doesNotMatch(serialized, /\/home\/example/);
  assert.ok(normalized.telemetryFailures[0].detail.length <= 256);
  assert.strictEqual(normalized.telemetryStatus, 'FAILED');
  assert.strictEqual(normalized.retirementEligible, false);
});

test('never executes object hooks or accessors while projecting telemetry failures', () => {
  let toJsonCalled = false;
  let getterCalled = false;
  const withToJson = {
    code: 'COLLECTOR_FAILED',
    detail: 'safe',
    toJSON() {
      toJsonCalled = true;
      return { detail: 'BASELINE_SECRET_FROM_TO_JSON' };
    },
  };
  assert.throws(() => baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-hostile-to-json',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures: [withToJson],
  }), /JSON-compatible data/i);
  assert.strictEqual(toJsonCalled, false);

  const withAccessor = { code: 'COLLECTOR_FAILED' };
  Object.defineProperty(withAccessor, 'detail', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'BASELINE_SECRET_FROM_GETTER';
    },
  });
  assert.throws(() => baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-hostile-accessor',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures: [withAccessor],
  }), /JSON-compatible data/i);
  assert.strictEqual(getterCalled, false);
});

test('rejects inherited metrics and non-JSON failure details without echoing values', () => {
  const inherited = Object.create(COMPLETE_METRICS);
  assert.throws(() => baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-inherited-metrics',
    acceptedOutcome: true,
    metrics: inherited,
  }), /metrics must be a plain record/i);

  const hidden = { ...COMPLETE_METRICS };
  Object.defineProperty(hidden, 'modelTokens', {
    configurable: true,
    value: 1200,
    enumerable: false,
  });
  assert.throws(() => baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-hidden-metrics',
    acceptedOutcome: true,
    metrics: hidden,
  }), /JSON-compatible data/i);

  const secret = 'BASELINE_SECRET_BIGINT_1234567890';
  let failure;
  try {
    baseline.normalizeAcceptedOutcomeCost({
      observationId: 'accepted-outcome-bigint',
      acceptedOutcome: true,
      metrics: COMPLETE_METRICS,
      telemetryFailures: [{ code: secret, detail: 1n }],
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.match(failure.message, /JSON-compatible data/i);
  assert.doesNotMatch(failure.message, new RegExp(secret));
});

test('does not retain raw prompts, session material, or host paths in telemetry output', () => {
  const marker = 'BASELINE_SECRET_SESSION_1234567890';
  const normalized = baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-sensitive-detail',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures: [{
      code: `PROMPT_${marker}`,
      detail: `reasoning=${marker}; Cookie: session=${marker}; C:\\Users\\private\\trace; /var/run/${marker}`,
    }],
  });
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, new RegExp(marker));
  assert.doesNotMatch(serialized, /reasoning=|Cookie:|\\\\Users\\\\|\/var\/run\//);
  assert.strictEqual(normalized.telemetryFailures[0].detail, '<redacted>');
});

test('validation errors never echo unsupported vocabulary values', () => {
  const marker = 'BASELINE_SECRET_VOCABULARY_1234567890';
  let failure;
  try {
    baseline.normalizeSentinelOutcome({
      ...CORPUS.cases[1].input,
      lifecycleClearance: marker,
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.doesNotMatch(failure.message, new RegExp(marker));
});

test('validation errors do not echo hostile property names', () => {
  const marker = 'BASELINE_SECRET_PROPERTY_1234567890';
  const input = {
    observationId: 'accepted-outcome-hostile-property',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
  };
  input[marker] = 1n;
  let failure;
  try {
    baseline.normalizeAcceptedOutcomeCost(input);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.match(failure.message, /JSON-compatible data/i);
  assert.doesNotMatch(failure.message, new RegExp(marker));
});

test('rejects sparse and prototype-backed arrays before semantic normalization', () => {
  const input = CORPUS.cases[1].input;
  const sparse = [];
  sparse.length = 1_000_000;
  assert.throws(() => baseline.normalizeSentinelOutcome({
    ...input,
    reasonCodes: sparse,
  }), /bounded JSON-compatible data/i);

  const inherited = [];
  inherited.length = 1;
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  let failure;
  try {
    Object.defineProperty(Array.prototype, '0', {
      configurable: true,
      writable: true,
      value: 'FRESH_PASSING_ARTIFACT',
    });
    baseline.normalizeSentinelOutcome({ ...input, reasonCodes: inherited });
  } catch (error) {
    failure = error;
  } finally {
    if (previous) Object.defineProperty(Array.prototype, '0', previous);
    else delete Array.prototype[0];
  }
  assert.ok(failure, 'an inherited array element must not become semantic evidence');
  assert.match(failure.message, /bounded JSON-compatible data/i);
});

test('exported lifecycle collector enforces byte and event limits', () => {
  const options = { taskId: 'task-bounded', verdict: 'PASS', measurements: {} };
  const oversized = baseline.collectLegacyAcceptedOutcomeCost('x'.repeat((1024 * 1024) + 1), options);
  assert.strictEqual(oversized.telemetryStatus, 'FAILED');
  assert.deepStrictEqual(oversized.telemetryFailures.map(({ code }) => code), [
    'LIFECYCLE_SOURCE_TOO_LARGE',
  ]);
  assert.strictEqual(oversized.retirementEligible, false);

  const tooManyEvents = baseline.collectLegacyAcceptedOutcomeCost('x\n'.repeat(10_001), options);
  assert.strictEqual(tooManyEvents.telemetryStatus, 'FAILED');
  assert.ok(tooManyEvents.telemetryFailures.some(({ code }) => code === 'LIFECYCLE_EVENT_LIMIT'));
  assert.strictEqual(tooManyEvents.retirementEligible, false);
});

test('bounds failure collections without hiding the observed failure count', () => {
  const telemetryFailures = Array.from({ length: 25 }, (_, index) => ({
    code: `COLLECTOR_FAILED_${index + 1}`,
    detail: `collector ${index + 1} unavailable`,
  }));
  const normalized = baseline.normalizeAcceptedOutcomeCost({
    observationId: 'accepted-outcome-many-failures',
    acceptedOutcome: true,
    metrics: COMPLETE_METRICS,
    telemetryFailures,
  });
  assert.strictEqual(normalized.telemetryFailureCount, 25);
  assert.strictEqual(normalized.telemetryFailures.length, 20);
  assert.strictEqual(normalized.telemetryStatus, 'FAILED');
  assert.strictEqual(normalized.retirementEligible, false);
});

test('telemetry failure cannot change Sentinel authority or create runtime state', () => {
  const before = baseline.normalizeSentinelOutcome(
    CORPUS.cases.find(({ input }) => input.caseId === 'missing-artifact').input
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-review-baseline-'));
  const previous = process.cwd();
  try {
    process.chdir(temporary);
    baseline.normalizeAcceptedOutcomeCost({
      observationId: 'accepted-outcome-4',
      acceptedOutcome: true,
      metrics: COMPLETE_METRICS,
      telemetryFailures: [{ code: 'COLLECTOR_FAILED', detail: 'unavailable' }],
    });
    assert.deepStrictEqual(baseline.normalizeSentinelOutcome(CORPUS.cases[2].input), before);
    assert.deepStrictEqual(fs.readdirSync(temporary), []);
  } finally {
    process.chdir(previous);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

run('review-gate-baseline-sentinel');
