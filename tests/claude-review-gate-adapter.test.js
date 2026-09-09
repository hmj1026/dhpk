'use strict';

// Focused contract coverage for the active Claude -> Review Gate adapter.
// The retired Sentinel, migration phase, and cost-observation surfaces are
// intentionally absent: this suite exercises only Review Gate submission.

const { test, run, assert } = require('./_lib/tinytest');
const {
  createReviewGateFixture,
  makePlan,
  makeReviewResult,
  NOW,
  NOW_MS,
  registerPlan,
  requestFor,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const { ClaudeReviewGateAdapter } = require('../scripts/lib/claude-review-gate-adapter');

const ADAPTER_VERSION = 'claude-review-gate.v1';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function deepFrozen(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

function identity(overrides = {}) {
  return {
    taskId: 'task-369',
    attemptId: 'task-369:attempt:1',
    attempt: 1,
    sessionId: 'session-369',
    dispatchId: 'dispatch-369',
    scopeId: 'scope-369',
    diffId: 'diff-369',
    ...overrides,
  };
}

function lifecycleEvent(state, overrides = {}) {
  const ids = identity(overrides);
  return {
    schema_version: 1,
    event_id: `${state}-event-369`,
    event_type: 'review-lifecycle',
    state,
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'code-reviewer',
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
    event_id: 'ready-event-369',
    state: 'artifact-ready',
    task_id: ids.taskId,
    attempt_id: ids.attemptId,
    agent: 'code-reviewer',
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

function planAndReview(verdict = 'PASS', executionStatus = 'COMPLETE') {
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
    semanticVerdict: executionStatus === 'COMPLETE' ? verdict : undefined,
    executionStatus,
    evidenceReferences: executionStatus === 'COMPLETE'
      ? [`artifact-sha256:${DIGEST.slice('sha256:'.length)}`]
      : [],
  });
  const lifecycleEvents = executionStatus === 'COMPLETE'
    ? [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started'),
      lifecycleEvent('artifact-ready'),
      lifecycleEvent('verdicted', { verdict }),
    ]
    : [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started'),
      lifecycleEvent('incomplete'),
    ];
  return {
    plan,
    obligation,
    reviewRequest,
    reviewResult,
    lifecycleEvents,
    readinessEvents: executionStatus === 'COMPLETE' ? [readinessEvent()] : [],
  };
}

function observeInput(options = {}) {
  const {
    verdict = 'PASS',
    executionStatus = 'COMPLETE',
    ...overrides
  } = options;
  const prepared = planAndReview(verdict, executionStatus);
  return {
    plan: prepared.plan,
    identity: identity(),
    lifecycleEvents: prepared.lifecycleEvents,
    readinessEvents: prepared.readinessEvents,
    reviewRequest: prepared.reviewRequest,
    reviewResult: prepared.reviewResult,
    executedCommands: [{
      command: 'node tests/reviewer-contract-v2.test.js',
      outcome: 'PASS',
      durationMs: 12,
    }],
    ...overrides,
  };
}

function stubReviewGate({ accepted = true } = {}) {
  const events = [];
  return {
    events,
    reviewGate: {
      handle: ({ event }) => {
        events.push(event);
        return {
          accepted,
          decision: {
            accepted,
            allowsProgress: accepted,
            lifecycleStatus: accepted ? 'RESOLVED' : 'PENDING',
            executionStatus: event.payload.result.executionStatus,
            applicability: event.payload.result.applicability,
            ...(event.payload.result.semanticVerdict
              ? { semanticVerdict: event.payload.result.semanticVerdict }
              : {}),
            blockingReasons: accepted ? [] : ['REVIEW_GATE_REJECTED'],
          },
        };
      },
    },
  };
}

function makeAdapter(reviewGate, now = () => NOW_MS) {
  return new ClaudeReviewGateAdapter({
    reviewGate,
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    adapterVersion: ADAPTER_VERSION,
    now,
  });
}

function assertCode(call, code, label = code) {
  assert.throws(call, (error) => error && error.code === code, label);
}

test('capabilities expose only the active Claude Review Gate submission contract', () => {
  const adapter = makeAdapter({ handle: () => { throw new Error('must not be called'); } });
  const capabilities = adapter.capabilities();

  assert.strictEqual(capabilities.adapter, 'claude-review-gate');
  assert.strictEqual(capabilities.version, ADAPTER_VERSION);
  assert.strictEqual(capabilities.storeEventSchema, STORE_EVENT_SCHEMA);
  assert.strictEqual(capabilities.submissionReceiptSchema, 'dhpk.review-gate.claude-submission.v1');
  assert.strictEqual(capabilities.reviewerContractVersion, REVIEWER_CONTRACT_VERSION);
  assert.strictEqual(capabilities.authority, 'REVIEW_GATE');
  assert.strictEqual(capabilities.effect, 'ENFORCE');
  assert.strictEqual(capabilities.explicitInvocationOnly, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(capabilities, 'phases'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(capabilities, 'migrationObservationReceiptKind'), false);
  assert.ok(deepFrozen(capabilities), 'capabilities must be deeply immutable');
  assert.throws(() => { capabilities.adapter = 'foreign-adapter'; });
});

test('record binds a completed PASS to the same lifecycle terminal and receipt provenance', () => {
  const fixture = stubReviewGate();
  const adapter = makeAdapter(fixture.reviewGate);
  const result = adapter.record(observeInput());
  const event = fixture.events[0];

  assert.strictEqual(fixture.events.length, 1);
  assert.strictEqual(event.schema, STORE_EVENT_SCHEMA);
  assert.strictEqual(event.eventType, 'REVIEW_RESULT_RECORDED');
  assert.strictEqual(event.effect, 'ENFORCE');
  assert.strictEqual(event.payload.result.semanticVerdict, 'PASS');
  assert.strictEqual(result.reviewGate.accepted, true);
  assert.strictEqual(result.receipt.obligationId, event.obligationId);
  assert.strictEqual(result.receipt.lane, event.lane);
  assert.strictEqual(result.receipt.provenance.eventId, result.receipt.eventId);
  assert.strictEqual(result.receipt.provenance.receiptId, result.receipt.receiptId);
  assert.strictEqual(result.receipt.provenance.terminalLifecycleVerdict, 'PASS');
  assert.deepStrictEqual(result.receipt.provenance.lifecycleEventIds, [
    'planned-event-369',
    'dispatched-event-369',
    'started-event-369',
    'artifact-ready-event-369',
    'verdicted-event-369',
  ]);
  assert.strictEqual(result.receipt.provenance.artifactDigest, DIGEST);
});

test('record accepts canonical CHANGES_REQUIRED and BLOCKED lifecycle verdicts', () => {
  for (const verdict of ['CHANGES_REQUIRED', 'BLOCKED']) {
    const fixture = stubReviewGate();
    const result = makeAdapter(fixture.reviewGate).record(observeInput({ verdict }));
    assert.strictEqual(result.receipt.reviewGateStatus, verdict);
    assert.strictEqual(result.receipt.provenance.terminalLifecycleVerdict, verdict);
  }
});

test('record maps lifecycle compatibility labels to the Review Result semantic verdict', () => {
  const fixture = stubReviewGate();
  const input = observeInput();
  input.reviewResult = planAndReview('CHANGES_REQUIRED').reviewResult;
  input.lifecycleEvents[input.lifecycleEvents.length - 1] = {
    ...input.lifecycleEvents[input.lifecycleEvents.length - 1],
    verdict: 'WARNING',
  };
  const result = makeAdapter(fixture.reviewGate).record(input);
  assert.strictEqual(result.receipt.provenance.terminalLifecycleVerdict, 'CHANGES_REQUIRED');
});

test('record accepts an unavailable review only with one exceptional lifecycle terminal', () => {
  const fixture = stubReviewGate();
  const result = makeAdapter(fixture.reviewGate).record(observeInput({
    executionStatus: 'UNAVAILABLE',
  }));

  assert.strictEqual(result.receipt.reviewGateStatus, 'NOT_RUN');
  assert.strictEqual(result.receipt.artifactDigest, null);
  assert.strictEqual(result.receipt.provenance.terminalLifecycleVerdict, null);
  assert.strictEqual(result.receipt.provenance.terminalLifecycleEventId, 'incomplete-event-369');
});

test('record rejects a lifecycle terminal whose verdict disagrees with the Review Result', () => {
  const input = observeInput();
  input.lifecycleEvents[input.lifecycleEvents.length - 1] = {
    ...input.lifecycleEvents[input.lifecycleEvents.length - 1],
    verdict: 'WARNING',
  };
  const fixture = stubReviewGate();
  assertCode(
    () => makeAdapter(fixture.reviewGate).record(input),
    'VERDICT_MISMATCH',
  );
  assert.strictEqual(fixture.events.length, 0, 'mismatch must not reach Review Gate');
});

test('record rejects contradictory lifecycle terminals before Review Gate submission', () => {
  const input = observeInput();
  const terminal = input.lifecycleEvents[input.lifecycleEvents.length - 1];
  input.lifecycleEvents = [
    ...input.lifecycleEvents,
    { ...terminal, event_id: 'second-verdicted-event-369', verdict: 'CHANGES_REQUIRED' },
  ];
  const fixture = stubReviewGate();
  assertCode(
    () => makeAdapter(fixture.reviewGate).record(input),
    'CONTRADICTORY_VERDICT',
  );
  assert.strictEqual(fixture.events.length, 0);
});

test('record rejects foreign identity evidence before Review Gate submission', () => {
  const input = observeInput();
  input.lifecycleEvents = input.lifecycleEvents.map((event) => (
    event.state === 'started' ? { ...event, session_id: 'foreign-session-369' } : event
  ));
  const fixture = stubReviewGate();
  assertCode(
    () => makeAdapter(fixture.reviewGate).record(input),
    'FOREIGN_IDENTITY',
  );
  assert.strictEqual(fixture.events.length, 0);
});

test('event identity and submission provenance are stable for exact retries and change with evidence', () => {
  const fixture = stubReviewGate();
  const adapter = makeAdapter(fixture.reviewGate);
  const input = observeInput();
  const first = adapter.record(input);
  const second = adapter.record(input);
  const changed = adapter.record({
    ...input,
    lifecycleEvents: input.lifecycleEvents.map((event, index) => (
      index === 0 ? { ...event, occurred_at: '2026-09-06T04:00:01.000Z' } : event
    )),
  });

  assert.strictEqual(first.receipt.eventId, second.receipt.eventId);
  assert.strictEqual(first.receipt.receiptId, second.receipt.receiptId);
  assert.deepStrictEqual(first.receipt.provenance, second.receipt.provenance);
  assert.notStrictEqual(changed.receipt.eventId, first.receipt.eventId);
  assert.notStrictEqual(changed.receipt.provenance.lifecycleDigest, first.receipt.provenance.lifecycleDigest);
  assert.strictEqual(fixture.events.length, 3);
});

test('record preserves a Review Gate rejection for the runtime composition to fail closed', () => {
  const fixture = stubReviewGate({ accepted: false });
  const result = makeAdapter(fixture.reviewGate).record(observeInput());

  assert.strictEqual(result.reviewGate.accepted, false);
  assert.strictEqual(result.receipt.reviewGateStatus, 'PASS');
});

test('record integrates with the durable Review Gate receipt contract', () => {
  const fixture = createReviewGateFixture();
  try {
    const plan = makePlan();
    const registered = registerPlan(fixture.gate, plan);
    const request = requestFor(registered, plan.obligations[0]);
    const prepared = observeInput({
      plan,
      reviewRequest: request,
      expectedRevision: registered.revision,
      expectedChainDigest: registered.chainDigest,
    });
    const reviewGate = {
      handle: (input) => {
        const projection = fixture.gate.handle(input);
        return { ...projection, accepted: projection.decision.accepted };
      },
    };
    const result = makeAdapter(reviewGate).record(prepared);
    const history = fixture.store.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: 2,
      expectedChainDigest: result.reviewGate.chainDigest,
    });

    assert.strictEqual(result.reviewGate.accepted, true);
    assert.strictEqual(history.events.length, 2);
    assert.strictEqual(history.receipts.length, 1);
    assert.strictEqual(history.events[1].eventId, result.receipt.eventId);
    assert.strictEqual(history.receipts[0].kind, 'review');
    assert.strictEqual(history.receipts[0].payload.eventId, result.receipt.eventId);
  } finally {
    fixture.cleanup();
  }
});

run('claude-review-gate-adapter');
