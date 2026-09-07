'use strict';

// RED contract for the Codex -> Review Gate submission adapter (issue #370).
// Unlike the Claude adapter (issue #369), there is no legacy Codex Sentinel to
// observe or compare against, so this adapter carries no phase pair, no
// sentinelOutcome/comparison concept, and no MigrationCoordinator dependency.
// It submits Codex-native Review Requests/Results directly into the same
// Reviewer Contract v2 + Review Gate machinery Claude uses, inert by default.

const { test, run, assert } = require('./_lib/tinytest');
const {
  makePlan,
  makeReviewResult,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const {
  CodexReviewGateAdapter,
  CodexReviewGateAdapterError,
  ADAPTER_NAME,
  SUBMISSION_SCHEMA,
} = require('../scripts/lib/codex-review-gate-adapter');

const ADAPTER_VERSION = 'codex-review-gate.v1';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

function identity(overrides = {}) {
  return {
    taskId: 'task-370',
    attemptId: 'task-370:attempt:1',
    attempt: 1,
    sessionId: 'session-370',
    dispatchId: 'dispatch-370',
    scopeId: 'scope-370',
    diffId: 'diff-370',
    ...overrides,
  };
}

function lifecycleEvent(state, overrides = {}) {
  const ids = identity(overrides);
  return {
    schema_version: 1,
    event_id: `${state}-event-370`,
    event_type: 'review-lifecycle',
    state,
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'codex-reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: NOW,
    ...overrides,
  };
}

function readinessEvent(overrides = {}) {
  const ids = identity(overrides);
  return {
    schema_version: 1,
    event_id: 'ready-event-370',
    state: 'artifact-ready',
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'codex-reviewer',
    session_id: ids.sessionId,
    attempt: ids.attempt,
    scope_id: ids.scopeId,
    diff_id: ids.diffId,
    wave: ids.dispatchId,
    occurred_at: NOW,
    artifact_sha256: DIGEST,
    ...overrides,
  };
}

function planAndReview(overrides = {}) {
  const plan = makePlan();
  const obligation = plan.obligations[0];
  const reviewRequest = createReviewRequest({
    decisionId: plan.decisionId,
    waveId: plan.waveId,
    obligationId: obligation.obligationId,
    lane: obligation.lane,
    scope: plan.scope,
    baseIdentity: plan.baseIdentity,
    headIdentity: plan.headIdentity,
    diff: plan.diff,
    materialRisks: plan.materialRisks,
    governingInputs: plan.governingInputs,
    exclusions: [],
    priorFindings: [],
    contractVersion: REVIEWER_CONTRACT_VERSION,
  });
  const reviewResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'PASS',
    evidenceReferences: [`artifact-sha256:${DIGEST.replace(/^sha256:/, '')}`],
    ...overrides,
  });
  return {
    plan, obligation, reviewRequest, reviewResult,
  };
}

function submissionInput(overrides = {}) {
  const { plan, reviewRequest, reviewResult } = planAndReview();
  const ids = identity();
  const lifecycleEvents = [
    lifecycleEvent('planned'),
    lifecycleEvent('dispatched'),
    lifecycleEvent('started'),
    lifecycleEvent('verdicted', { verdict: 'PASS' }),
  ];
  return {
    plan,
    identity: ids,
    lifecycleEvents,
    readinessEvents: [readinessEvent()],
    reviewRequest,
    reviewResult,
    executedCommands: [{
      command: 'node tests/reviewer-contract-v2.test.js',
      outcome: 'PASS',
      durationMs: 12,
    }],
    expectedRevision: 0,
    expectedChainDigest: null,
    ...overrides,
  };
}

function makeAdapter({ reviewGate, activation = 'ACTIVE', now = () => NOW_MS } = {}) {
  return new CodexReviewGateAdapter({
    reviewGate,
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    adapterVersion: ADAPTER_VERSION,
    activation,
    now,
  });
}

function expectRejected(call, expectedCode, label) {
  assert.throws(call, (error) => {
    assert.ok(error instanceof CodexReviewGateAdapterError, label);
    assert.strictEqual(error.code, expectedCode, label);
    return true;
  }, label);
}

test('capabilities are immutable, advertise the Codex Review Gate contract, and are readable before any evidence is submitted', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('must not be called before record()'); } },
    activation: 'INACTIVE',
  });
  const capabilities = adapter.capabilities();

  assert.strictEqual(capabilities.adapter, ADAPTER_NAME);
  assert.strictEqual(capabilities.version, ADAPTER_VERSION);
  assert.strictEqual(capabilities.storeEventSchema, STORE_EVENT_SCHEMA);
  assert.strictEqual(capabilities.submissionReceiptSchema, SUBMISSION_SCHEMA);
  assert.strictEqual(capabilities.reviewerContractVersion, REVIEWER_CONTRACT_VERSION);
  assert.strictEqual(capabilities.activation, 'INACTIVE');
  assert.strictEqual(capabilities.effect, 'DISABLED');
  assert.strictEqual(capabilities.authority, 'SENTINEL');
  assert.strictEqual(capabilities.allowsTargetProgress, false);
  assert.ok(deepFrozen(capabilities), 'capabilities must be deeply immutable');
  assert.throws(() => { capabilities.adapter = 'foreign-adapter'; });
});

test('adapter defaults to INACTIVE and refuses to record without explicit activation', () => {
  const adapter = new CodexReviewGateAdapter({
    reviewGate: { handle: () => { throw new Error('must not be called while inactive'); } },
  });
  assert.strictEqual(adapter.capabilities().activation, 'INACTIVE');
  assert.strictEqual(adapter.capabilities().effect, 'DISABLED');
  expectRejected(() => adapter.record(submissionInput()), 'ADAPTER_INACTIVE', 'inactive adapter must reject record()');
  try {
    adapter.record(submissionInput());
    assert.ok(false, 'record() must throw while inactive');
  } catch (error) {
    assert.ok(error instanceof CodexReviewGateAdapterError, 'must raise the adapter error type');
    assert.strictEqual(error.code, 'ADAPTER_INACTIVE');
  }
});

test('an ACTIVE adapter never authorizes approval, clears, blocks, or advances Sentinel', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ revision: 1, chainDigest: `sha256:${'b'.repeat(64)}`, decision: { accepted: true, semanticVerdict: 'PASS', allowsProgress: true, lifecycleStatus: 'CLEARED', executionStatus: 'COMPLETE', applicability: 'REQUIRED' } }) },
  });
  const { receipt } = adapter.record(submissionInput());

  assert.strictEqual(receipt.authority, 'SENTINEL');
  assert.strictEqual(receipt.authorizesApproval, false);
  assert.strictEqual(receipt.clearsSentinel, false);
  assert.strictEqual(receipt.blocksSentinel, false);
  assert.strictEqual(receipt.allowsTargetProgress, false);
  assert.strictEqual(receipt.effect, 'OBSERVE_ONLY');
});

test('the adapter selects lane and obligation from the caller plan rather than choosing them', () => {
  const { plan, obligation, reviewRequest, reviewResult } = planAndReview();
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ revision: 1, chainDigest: null, decision: { accepted: true, semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED' } }) },
  });
  const { receipt } = adapter.record(submissionInput({
    plan, reviewRequest, reviewResult,
  }));

  assert.strictEqual(receipt.obligationId, obligation.obligationId);
  assert.strictEqual(receipt.lane, obligation.lane);
  assert.strictEqual(receipt.workId, plan.workId);
  assert.strictEqual(receipt.waveId, plan.waveId);
});

test('record() delegates the caller plan, request, result, and exact identity to Review Gate', () => {
  let seenEvent = null;
  const adapter = makeAdapter({
    reviewGate: {
      handle: (call) => {
        seenEvent = call.event;
        return { revision: 1, chainDigest: null, decision: { accepted: true, semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED' } };
      },
    },
  });
  const input = submissionInput();
  adapter.record(input);

  assert.strictEqual(seenEvent.eventType, 'REVIEW_RESULT_RECORDED');
  assert.strictEqual(seenEvent.workId, input.plan.workId);
  assert.strictEqual(seenEvent.sessionId, input.identity.sessionId);
  assert.deepStrictEqual(seenEvent.payload.request, input.reviewRequest);
  assert.deepStrictEqual(seenEvent.payload.result, input.reviewResult);
  assert.strictEqual(seenEvent.producer, 'fixture-reviewer');
  assert.strictEqual(seenEvent.adapter, 'fixture-adapter');
});

test('review events are self-describing and unique per obligation and lane', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ revision: 1, chainDigest: null, decision: { accepted: true, semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED' } }) },
  });
  const otherIds = identity({ taskId: 'task-370-b', attemptId: 'task-370-b:attempt:1' });
  const first = adapter.record(submissionInput());
  const second = adapter.record(submissionInput({
    identity: otherIds,
    lifecycleEvents: [
      lifecycleEvent('planned', otherIds),
      lifecycleEvent('dispatched', otherIds),
      lifecycleEvent('started', otherIds),
      lifecycleEvent('verdicted', { ...otherIds, verdict: 'PASS' }),
    ],
    readinessEvents: [readinessEvent(otherIds)],
  }));

  assert.notStrictEqual(first.receipt.eventId, second.receipt.eventId);
});

test('rejects every foreign identity dimension across lifecycle and readiness evidence', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('must not reach Review Gate'); } } });
  const foreignLifecycle = submissionInput({
    lifecycleEvents: [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started'),
      lifecycleEvent('verdicted', { verdict: 'PASS', task_id: 'foreign-task' }),
    ],
  });
  expectRejected(() => adapter.record(foreignLifecycle), 'FOREIGN_IDENTITY', 'foreign lifecycle identity must fail closed');

  const foreignReadiness = submissionInput({ readinessEvents: [readinessEvent({ session_id: 'foreign-session' })] });
  expectRejected(() => adapter.record(foreignReadiness), 'FOREIGN_IDENTITY', 'foreign readiness identity must fail closed');
});

test('fails closed when readiness for the exact identity is missing', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('must not reach Review Gate'); } } });
  expectRejected(() => adapter.record(submissionInput({ readinessEvents: [] })), 'MISSING_READINESS', 'missing readiness must fail closed');
});

test('requires canonical lifecycle event schema and a terminal verdict', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('must not reach Review Gate'); } } });
  expectRejected(() => adapter.record(submissionInput({ lifecycleEvents: [] })), 'MISSING_LIFECYCLE', 'empty lifecycle must fail closed');
  expectRejected(() => adapter.record(submissionInput({
    lifecycleEvents: [lifecycleEvent('planned'), lifecycleEvent('dispatched')],
  })), 'MISSING_VERDICT', 'lifecycle without a terminal verdict must fail closed');
});

test('requires a canonical readiness artifact digest matching the review result evidence reference', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('must not reach Review Gate'); } } });
  const { plan, obligation, reviewRequest } = planAndReview();
  const mismatchedResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'PASS',
    evidenceReferences: [`artifact-sha256:${'f'.repeat(64)}`],
  });
  expectRejected(() => adapter.record(submissionInput({
    plan, reviewRequest, reviewResult: mismatchedResult,
  })), 'MISSING_ARTIFACT_EVIDENCE', 'mismatched artifact evidence must fail closed');
});

test('requires at least one executed command, matching the Claude adapter contract', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('must not reach Review Gate'); } } });
  expectRejected(() => adapter.record(submissionInput({ executedCommands: undefined })), 'MALFORMED_COMMANDS', 'missing executedCommands must fail closed');
  expectRejected(() => adapter.record(submissionInput({ executedCommands: [] })), 'MALFORMED_COMMANDS', 'empty executedCommands must fail closed');
});

test('fails closed when Review Gate rejects the structured result', () => {
  const adapter = makeAdapter({ reviewGate: { handle: () => { throw new Error('boom'); } } });
  try {
    adapter.record(submissionInput());
    assert.ok(false, 'record() must surface a Review Gate failure');
  } catch (error) {
    assert.ok(error instanceof CodexReviewGateAdapterError, 'must raise the adapter error type');
    assert.strictEqual(error.code, 'REVIEW_GATE_FAILED');
  }
});

test('the returned receipt excludes raw artifact paths, prompts, and secrets', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ revision: 1, chainDigest: null, decision: { accepted: true, semanticVerdict: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED' } }) },
  });
  const { receipt } = adapter.record(submissionInput());
  const serialized = JSON.stringify(receipt);

  assert.strictEqual(receipt.reviewGateStatus, 'PASS');
  assert.ok(!Object.prototype.hasOwnProperty.call(receipt, 'reviewRequest'));
  assert.ok(!Object.prototype.hasOwnProperty.call(receipt, 'reviewResult'));
  assert.ok(!serialized.includes('node tests/reviewer-contract-v2.test.js'), 'raw command text must not leak into the receipt');
});

// AC #4 -- adapter-submittable reviewer-contract v2 outcome shapes reach the
// adapter's caller with the same {executionStatus, applicability,
// semanticVerdict} triple the shared Review Gate produced, unmodified.
// Canonical NOT_APPLICABLE is an empty-plan registration outcome and is
// covered by the real Review Gate journey in codex-review-gate-e2e.test.js.
const CONFORMANCE_CASES = [
  {
    name: 'normal PASS',
    decision: {
      semanticVerdict: 'PASS', allowsProgress: true, executionStatus: 'COMPLETE', applicability: 'REQUIRED',
    },
    expect: {
      status: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED', semanticVerdict: 'PASS',
    },
  },
  {
    name: 'changes-required',
    decision: {
      semanticVerdict: 'CHANGES_REQUIRED', allowsProgress: false, executionStatus: 'COMPLETE', applicability: 'REQUIRED',
    },
    expect: {
      status: 'CHANGES_REQUIRED', executionStatus: 'COMPLETE', applicability: 'REQUIRED', semanticVerdict: 'CHANGES_REQUIRED',
    },
  },
  {
    name: 'unavailable reviewer',
    decision: { allowsProgress: false, executionStatus: 'UNAVAILABLE', applicability: 'REQUIRED' },
    expect: {
      status: 'NOT_RUN', executionStatus: 'UNAVAILABLE', applicability: 'REQUIRED',
    },
  },
  {
    name: 'receipt-reuse (unchanged evidence, no new verdict manufactured)',
    decision: {
      semanticVerdict: 'PASS', allowsProgress: true, executionStatus: 'COMPLETE', applicability: 'REQUIRED', lifecycleStatus: 'REUSED',
    },
    expect: {
      status: 'PASS', executionStatus: 'COMPLETE', applicability: 'REQUIRED', semanticVerdict: 'PASS', lifecycleStatus: 'REUSED',
    },
  },
];

for (const testCase of CONFORMANCE_CASES) {
  test(`core conformance outcome: ${testCase.name}`, () => {
    const adapter = makeAdapter({
      reviewGate: {
        handle: () => ({
          revision: 1,
          chainDigest: null,
          decision: { accepted: true, ...testCase.decision },
        }),
      },
    });
    const { receipt } = adapter.record(submissionInput());

    assert.strictEqual(receipt.reviewGate.status, testCase.expect.status);
    assert.strictEqual(receipt.reviewGate.executionStatus, testCase.expect.executionStatus);
    assert.strictEqual(receipt.reviewGate.applicability, testCase.expect.applicability);
    if (testCase.expect.semanticVerdict) {
      assert.strictEqual(receipt.reviewGate.semanticVerdict, testCase.expect.semanticVerdict);
    } else {
      assert.ok(!Object.prototype.hasOwnProperty.call(receipt.reviewGate, 'semanticVerdict'));
    }
    if (testCase.expect.lifecycleStatus) {
      assert.strictEqual(receipt.reviewGate.lifecycleStatus, testCase.expect.lifecycleStatus);
    }
    // Never authoritative, regardless of outcome.
    assert.strictEqual(receipt.authorizesApproval, false);
    assert.strictEqual(receipt.clearsSentinel, false);
  });
}

// AC #2 -- structural guard: the Codex adapter must never depend on Claude
// Code hook mechanics (pending files, SubagentStop, resumed-process
// identity, or self-clear behavior). Assert directly over the module's own
// source text so a future edit that reintroduces one of these fails closed.
test('the Codex adapter source contains no Claude hook-mechanics dependency', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'lib', 'codex-review-gate-adapter.js'),
    'utf8',
  );
  const forbidden = [/pending/i, /SubagentStop/i, /resumed/i, /clear-sentinel/i, /\.pending-review/i];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `codex-review-gate-adapter.js must not reference ${pattern}`);
  }
  assert.ok(!source.includes('claude-review-gate-legacy-observation'));
  assert.ok(!source.includes('migration-coordinator'));
});

test('accepts an UNAVAILABLE reviewer result without artifact-sha evidence and preserves its gate axes', () => {
  const adapter = makeAdapter({
    reviewGate: {
      handle: () => ({
        revision: 1,
        chainDigest: null,
        decision: {
          accepted: true,
          allowsProgress: false,
          executionStatus: 'UNAVAILABLE',
          applicability: 'REQUIRED',
        },
      }),
    },
  });
  const { plan, obligation, reviewRequest } = planAndReview();
  const reviewResult = makeReviewResult(plan, obligation, {
    executionStatus: 'UNAVAILABLE',
    evidenceReferences: ['capability:reviewer-unavailable'],
  });
  const { receipt } = adapter.record(submissionInput({
    plan,
    reviewRequest,
    reviewResult,
    lifecycleEvents: [lifecycleEvent('failed-start')],
    readinessEvents: [],
  }));

  assert.strictEqual(receipt.reviewGateStatus, 'NOT_RUN');
  assert.strictEqual(receipt.reviewGate.status, 'NOT_RUN');
  assert.strictEqual(receipt.reviewGate.accepted, true);
  assert.strictEqual(receipt.reviewGate.allowsProgress, false);
  assert.strictEqual(receipt.reviewGate.executionStatus, 'UNAVAILABLE');
  assert.strictEqual(receipt.reviewGate.applicability, 'REQUIRED');
  assert.ok(!Object.prototype.hasOwnProperty.call(receipt.reviewGate, 'semanticVerdict'));
});

test('requires artifact-sha evidence for a normal PASS result', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('PASS without artifact evidence reached Review Gate'); } },
  });
  const { plan, obligation, reviewRequest } = planAndReview();
  const reviewResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'PASS',
    evidenceReferences: [],
  });

  expectRejected(() => adapter.record(submissionInput({ plan, reviewRequest, reviewResult })), 'MISSING_ARTIFACT_EVIDENCE', 'PASS without artifact evidence must fail closed');
});

run();
