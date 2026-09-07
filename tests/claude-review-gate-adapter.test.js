'use strict';

// RED contract for the Claude -> Review Gate migration adapter (issue #369).
// These tests deliberately exercise only the adapter's public constructor,
// capabilities, and observe seams.  Legacy hook state is input evidence, not
// an authority that the adapter may clear or reinterpret.

const { test, run, assert } = require('./_lib/tinytest');
const {
  createFinding,
  makePlan,
  makeReviewResult,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const {
  ACCEPTED_OUTCOME_COST_SCHEMA,
  normalizeAcceptedOutcomeCost,
} = require('../scripts/lib/review-gate-baseline');
const { sha256 } = require('../scripts/lib/receipt-primitives');
const { ClaudeReviewGateAdapter } = require('../scripts/lib/claude-review-gate-adapter');

const ADAPTER_VERSION = 'claude-review-gate.v1';
const INTEGRITY_KEY = 'claude-review-gate-adapter-369-integrity-key';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const ACCEPTED_OUTCOME_COST_METRICS = Object.freeze({
  modelTokens: 1200,
  dispatchCount: 2,
  semanticReviewCount: 1,
  remediationRounds: 1,
  humanTurns: null,
  elapsedMs: 42,
  falseBlockCount: 0,
  receiptReuseCount: null,
});

function canonicalAcceptedOutcomeCost({
  taskId = 'task-369',
  observationId = `legacy-${sha256(taskId).slice(0, 32)}`,
  acceptedOutcome = true,
  metrics = ACCEPTED_OUTCOME_COST_METRICS,
} = {}) {
  return normalizeAcceptedOutcomeCost({
    schema: ACCEPTED_OUTCOME_COST_SCHEMA,
    observationId,
    acceptedOutcome,
    metrics,
    telemetryFailures: [],
  });
}

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

function planAndReview() {
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
  });
  return { plan, obligation, reviewRequest, reviewResult };
}

function observeInput(overrides = {}) {
  const { plan, reviewRequest, reviewResult } = planAndReview();
  const ids = identity();
  const lifecycleEvents = [
    lifecycleEvent('planned'),
    lifecycleEvent('dispatched'),
    lifecycleEvent('started'),
    lifecycleEvent('verdicted', { verdict: 'PASS' }),
  ];
  return {
    phase: 'OBSERVE',
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
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'PASS',
      outcome: 'PASS',
      lifecycleEventId: lifecycleEvents[3].event_id,
    },
    acceptedOutcomeCost: canonicalAcceptedOutcomeCost({ taskId: ids.taskId }),
    expectedRevision: 0,
    expectedChainDigest: null,
    ...overrides,
  };
}

function legacyBaselineInput(overrides = {}) {
  return observeInput({
    phase: 'BASELINE',
    lifecycleEvents: [],
    readinessEvents: [],
    reviewRequest: undefined,
    reviewResult: undefined,
    acceptedOutcomeCost: undefined,
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'APPROVE',
      outcome: 'APPROVE',
      cost: { dispatchCount: 1 },
    },
    ...overrides,
  });
}

function makeAdapter({ reviewGate, migrationCoordinator, now = () => NOW_MS } = {}) {
  return new ClaudeReviewGateAdapter({
    reviewGate,
    migrationCoordinator,
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    adapterVersion: ADAPTER_VERSION,
    now,
  });
}

function capturedObservation(record) {
  return record && (record.observation || record.payload || record);
}

function expectRejected(call, label) {
  assert.throws(call, (error) => {
    assert.ok(error, label);
    return true;
  }, label);
}

test('capabilities are immutable and advertise the Claude Review Gate contract', () => {
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('must not be called'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  });
  const capabilities = adapter.capabilities();

  assert.strictEqual(capabilities.adapter, 'claude-review-gate');
  assert.strictEqual(capabilities.version, ADAPTER_VERSION);
  assert.strictEqual(capabilities.storeEventSchema, STORE_EVENT_SCHEMA);
  assert.strictEqual(capabilities.migrationObservationReceiptKind, 'migration-observation');
  assert.strictEqual(capabilities.reviewerContractVersion, REVIEWER_CONTRACT_VERSION);
  assert.deepStrictEqual(capabilities.phases, ['BASELINE', 'OBSERVE', 'DUAL_ENFORCE', 'CUTOVER']);
  assert.strictEqual(capabilities.authorities.CUTOVER, 'REVIEW_GATE');
  assert.strictEqual(capabilities.effects.CUTOVER, 'ENFORCE');
  assert.ok(deepFrozen(capabilities), 'capabilities must be deeply immutable');
  assert.throws(() => { capabilities.adapter = 'foreign-adapter'; });
});

test('BASELINE records normalized Sentinel/cost evidence without invoking Review Gate', () => {
  let gateCalls = 0;
  const records = [];
  const adapter = makeAdapter({
    reviewGate: { handle: () => { gateCalls += 1; throw new Error('BASELINE must not call Review Gate'); } },
    migrationCoordinator: { record: (record) => { records.push(record); return { status: 'RECORDED' }; } },
  });
  const input = observeInput({
    phase: 'BASELINE',
    reviewRequest: undefined,
    reviewResult: undefined,
  });

  const result = adapter.observe(input);
  const observation = capturedObservation(records[0]);
  assert.strictEqual(gateCalls, 0);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(observation.phase, 'BASELINE');
  assert.strictEqual(observation.taskId, input.identity.taskId);
  assert.strictEqual(observation.sessionId, input.identity.sessionId);
  assert.strictEqual(observation.sentinelOutcome.verdict, 'PASS');
  assert.strictEqual(observation.sentinelOutcome.status, 'CLEARED');
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.dispatchCount, 2);
  assert.ok(result, 'BASELINE returns a caller-visible recording result');
});

test('BASELINE preserves the prior empty-lifecycle Sentinel snapshot without inventing lifecycle evidence', () => {
  let gateCalls = 0;
  let observation;
  const input = observeInput({
    phase: 'BASELINE',
    lifecycleEvents: [],
    readinessEvents: [],
    reviewRequest: undefined,
    reviewResult: undefined,
    acceptedOutcomeCost: undefined,
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'APPROVE',
      outcome: 'APPROVE',
      cost: {
        dispatchCount: 2,
        semanticReviewCount: 1,
        remediationRounds: 1,
        humanTurns: 0,
        elapsedMs: 42,
        receiptReuse: 3,
        falseBlocks: 0,
        unsafeClearance: 0,
        missedRequiredReview: 0,
        postMergeEscapes: 0,
      },
    },
  });
  const adapter = makeAdapter({
    reviewGate: { handle: () => { gateCalls += 1; throw new Error('BASELINE must not call Review Gate'); } },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(gateCalls, 0);
  assert.strictEqual(observation.phase, 'BASELINE');
  assert.strictEqual(observation.sentinelOutcome.verdict, 'APPROVE');
  assert.strictEqual(observation.sentinelOutcome.lifecycleEventId, undefined);
  assert.deepStrictEqual(observation.cost, input.sentinelOutcome.cost);
  assert.strictEqual(observation.acceptedOutcomeCost.acceptedOutcome, true);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.dispatchCount, 2);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.falseBlockCount, 0);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.receiptReuseCount, 3);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.modelTokens, null);
  assert.strictEqual(observation.acceptedOutcomeCost.telemetryStatus, 'PARTIAL');
  assert.strictEqual(observation.acceptedOutcomeCost.retirementEligible, false);
  assert.deepStrictEqual(observation.provenance.lifecycleEventIds, []);
  assert.strictEqual(observation.provenance.lifecycleEventId, undefined);
});

test('BASELINE rejects foreign review bindings before Gate or migration persistence', () => {
  for (const [field, foreign] of [
    ['obligationId', 'foreign-obligation-369'],
    ['lane', 'foreign-lane-369'],
  ]) {
    const input = observeInput({ phase: 'BASELINE' });
    input.reviewResult = { ...input.reviewResult, [field]: foreign };
    let gateCalls = 0;
    let recordCalls = 0;
    assert.throws(() => makeAdapter({
      reviewGate: { handle: () => { gateCalls += 1; return {}; } },
      migrationCoordinator: { record: () => { recordCalls += 1; return {}; } },
    }).observe(input), (error) => error && error.code === 'MALFORMED_REVIEW');
    assert.strictEqual(gateCalls, 0);
    assert.strictEqual(recordCalls, 0);
  }
});

test('BASELINE without a review result requires a unique plan obligation', () => {
  const plan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
  const input = legacyBaselineInput({ plan });
  let gateCalls = 0;
  let recordCalls = 0;
  assert.ok(plan.obligations.length > 1);
  assert.throws(() => makeAdapter({
    reviewGate: { handle: () => { gateCalls += 1; return {}; } },
    migrationCoordinator: { record: () => { recordCalls += 1; return {}; } },
  }).observe(input), (error) => error && error.code === 'MALFORMED_REVIEW');
  assert.strictEqual(gateCalls, 0);
  assert.strictEqual(recordCalls, 0);
});

test('BASELINE rejects explicitly non-array evidence collections', () => {
  for (const [field, value, code] of [
    ['lifecycleEvents', null, 'MALFORMED_LIFECYCLE'],
    ['lifecycleEvents', {}, 'MALFORMED_LIFECYCLE'],
    ['readinessEvents', null, 'MALFORMED_READINESS'],
    ['readinessEvents', {}, 'MALFORMED_READINESS'],
  ]) {
    const input = legacyBaselineInput({ [field]: value });
    let gateCalls = 0;
    let recordCalls = 0;
    assert.throws(() => makeAdapter({
      reviewGate: { handle: () => { gateCalls += 1; return {}; } },
      migrationCoordinator: { record: () => { recordCalls += 1; return {}; } },
    }).observe(input), (error) => error && error.code === code);
    assert.strictEqual(gateCalls, 0);
    assert.strictEqual(recordCalls, 0);
  }
});

test('BASELINE rejects unknown or invalid legacy cost fields', () => {
  for (const cost of [
    { dispatchCount: 1, unexpected: 1 },
    { dispatchCount: 1.5 },
    { dispatchCount: -1 },
    { dispatchCount: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const input = legacyBaselineInput({
      sentinelOutcome: {
        status: 'CLEARED',
        verdict: 'APPROVE',
        outcome: 'APPROVE',
        cost,
      },
    });
    let gateCalls = 0;
    let recordCalls = 0;
    assert.throws(() => makeAdapter({
      reviewGate: { handle: () => { gateCalls += 1; return {}; } },
      migrationCoordinator: { record: () => { recordCalls += 1; return {}; } },
    }).observe(input), (error) => error && error.code === 'MALFORMED_LEGACY_COST');
    assert.strictEqual(gateCalls, 0);
    assert.strictEqual(recordCalls, 0);
  }
});

test('OBSERVE still rejects the legacy empty-lifecycle Sentinel snapshot', () => {
  const input = observeInput({
    lifecycleEvents: [],
    readinessEvents: [],
    acceptedOutcomeCost: undefined,
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'APPROVE',
      outcome: 'APPROVE',
      cost: { dispatchCount: 1 },
    },
  });
  input.phase = 'OBSERVE';

  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('legacy OBSERVE evidence reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(input), 'OBSERVE must retain strict lifecycle evidence requirements');
});

test('OBSERVE binds Sentinel outcome to the unique same-identity terminal lifecycle event', () => {
  let observation;
  const input = observeInput();
  const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
  input.sentinelOutcome = {
    ...input.sentinelOutcome,
    lifecycleEventId: terminal.event_id,
  };
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(observation.sentinelOutcome.lifecycleEventId, terminal.event_id);
  assert.strictEqual(
    input.lifecycleEvents.filter((event) => event.state === 'verdicted').length,
    1,
    'the fixture must contain one terminal lifecycle event',
  );
});

test('OBSERVE review events are self-describing and unique per obligation and lane', () => {
  const plan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
  const events = [];
  const adapter = makeAdapter({
    reviewGate: {
      handle: ({ event }) => {
        events.push(event);
        return { accepted: true, revision: events.length, chainDigest: DIGEST };
      },
    },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  });
  for (const obligation of plan.obligations) {
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
    adapter.observe(observeInput({
      plan,
      reviewRequest,
      reviewResult: makeReviewResult(plan, obligation, {
        semanticVerdict: 'PASS',
        evidenceReferences: [`artifact-sha256:${DIGEST.replace(/^sha256:/, '')}`],
      }),
    }));
  }

  assert.strictEqual(events.length, 2);
  assert.ok(events.every((event) => event.effect === 'OBSERVE_ONLY'));
  assert.notStrictEqual(events[0].eventId, events[1].eventId);
});

test('OBSERVE rejects Sentinel lifecycle IDs that are foreign, non-terminal, or duplicated', () => {
  const cases = [
    {
      label: 'foreign event ID',
      input: observeInput({
        sentinelOutcome: {
          ...observeInput().sentinelOutcome,
          lifecycleEventId: 'foreign-terminal-event-369',
        },
      }),
    },
    {
      label: 'non-terminal event ID',
      input: observeInput({
        sentinelOutcome: {
          ...observeInput().sentinelOutcome,
          lifecycleEventId: 'started-event-369',
        },
      }),
    },
    {
      label: 'duplicate terminal event',
      input: (() => {
        const input = observeInput();
        const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
        input.lifecycleEvents = [
          ...input.lifecycleEvents,
          lifecycleEvent('verdicted', { event_id: 'second-verdicted-event-369', verdict: terminal.verdict }),
        ];
        input.sentinelOutcome = {
          ...input.sentinelOutcome,
          lifecycleEventId: terminal.event_id,
        };
        return input;
      })(),
    },
  ];

  for (const { label, input } of cases) {
    expectRejected(() => makeAdapter({
      reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
      migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
    }).observe(input), `${label} must fail closed`);
  }
});

test('OBSERVE rejects a Sentinel verdict inconsistent with its terminal lifecycle verdict', () => {
  const input = observeInput();
  const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
  input.sentinelOutcome = {
    ...input.sentinelOutcome,
    lifecycleEventId: terminal.event_id,
    status: 'CHANGES_REQUIRED',
    verdict: 'CHANGES_REQUIRED',
    outcome: 'CHANGES_REQUIRED',
  };

  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(input), 'Sentinel verdict must agree with the terminal lifecycle verdict');
});

test('OBSERVE preserves canonical Accepted-Outcome Cost metrics, including nullable fields', () => {
  let observation;
  const input = observeInput();
  const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
  const acceptedOutcomeCost = canonicalAcceptedOutcomeCost();
  input.acceptedOutcomeCost = acceptedOutcomeCost;
  input.sentinelOutcome = {
    ...input.sentinelOutcome,
    lifecycleEventId: terminal.event_id,
  };
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.deepStrictEqual(observation.acceptedOutcomeCost, acceptedOutcomeCost);
  assert.strictEqual(observation.acceptedOutcomeCost.schema, ACCEPTED_OUTCOME_COST_SCHEMA);
  assert.deepStrictEqual(observation.acceptedOutcomeCost.metrics, ACCEPTED_OUTCOME_COST_METRICS);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.modelTokens, 1200);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.falseBlockCount, 0);
  assert.strictEqual(observation.acceptedOutcomeCost.metrics.receiptReuseCount, null);
});

test('OBSERVE rejects cost observations with a foreign task-derived ID or inconsistent accepted outcome', () => {
  const cases = [
    {
      label: 'foreign task-derived observation ID',
      acceptedOutcomeCost: canonicalAcceptedOutcomeCost({ taskId: 'foreign-task-369' }),
    },
    {
      label: 'accepted outcome inconsistent with terminal PASS',
      acceptedOutcomeCost: canonicalAcceptedOutcomeCost({ acceptedOutcome: false }),
    },
  ];

  for (const { label, acceptedOutcomeCost } of cases) {
    const input = observeInput();
    const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
    input.acceptedOutcomeCost = acceptedOutcomeCost;
    input.sentinelOutcome = {
      ...input.sentinelOutcome,
      lifecycleEventId: terminal.event_id,
    };
    expectRejected(() => makeAdapter({
      reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
      migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
    }).observe(input), `${label} must fail closed`);
  }
});

test('BASELINE consumes completed durable lifecycle evidence without invoking Review Gate', () => {
  let gateCalls = 0;
  let observation;
  const input = observeInput({
    phase: 'BASELINE',
    acceptedOutcomeCost: canonicalAcceptedOutcomeCost(),
  });
  const terminal = input.lifecycleEvents.find((event) => event.state === 'verdicted');
  input.sentinelOutcome = {
    ...input.sentinelOutcome,
    lifecycleEventId: terminal.event_id,
  };
  const adapter = makeAdapter({
    reviewGate: { handle: () => { gateCalls += 1; throw new Error('BASELINE must not call Review Gate'); } },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(gateCalls, 0);
  assert.deepStrictEqual(
    observation.provenance.lifecycleEventIds,
    input.lifecycleEvents.map((event) => event.event_id),
  );
  assert.deepStrictEqual(
    observation.provenance.readinessEventIds,
    input.readinessEvents.map((event) => event.event_id),
  );
  assert.deepStrictEqual(observation.acceptedOutcomeCost, input.acceptedOutcomeCost);
});

test('BASELINE rejects foreign durable lifecycle evidence without invoking Review Gate', () => {
  let gateCalls = 0;
  const input = observeInput({
    phase: 'BASELINE',
    acceptedOutcomeCost: canonicalAcceptedOutcomeCost(),
  });
  input.lifecycleEvents = input.lifecycleEvents.map((event) => (
    event.state === 'verdicted' ? { ...event, session_id: 'foreign-session-369' } : event
  ));

  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { gateCalls += 1; throw new Error('BASELINE must not call Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(input), 'BASELINE must reject foreign lifecycle evidence');
  assert.strictEqual(gateCalls, 0);
});

test('OBSERVE records PASS legacy versus CHANGES_REQUIRED Review Gate as a non-enforcing disagreement', () => {
  let observation;
  const input = observeInput();
  const { plan, obligation } = planAndReview();
  input.reviewResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'CHANGES_REQUIRED',
    evidenceReferences: [
      `artifact-sha256:${input.readinessEvents[0].artifact_sha256.replace(/^sha256:/, '')}`,
    ],
    findings: [createFinding({
      id: 'issue-369-diagnostic-finding',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'diagnostic disagreement only',
      evidence: ['artifact:issue-369'],
    })],
  });
  const adapter = makeAdapter({
    reviewGate: {
      handle: () => ({
        accepted: true,
        revision: 1,
        chainDigest: DIGEST,
        decision: {
          lifecycleStatus: 'PENDING',
          semanticVerdict: 'CHANGES_REQUIRED',
          allowsProgress: false,
        },
      }),
    },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe({ ...input, plan });

  assert.strictEqual(observation.sentinelOutcome.verdict, 'PASS');
  assert.strictEqual(observation.reviewGate.semanticVerdict, 'CHANGES_REQUIRED');
  assert.strictEqual(observation.comparison, 'DISAGREE');
  assert.strictEqual(observation.authority, 'SENTINEL');
  for (const field of [
    'authorizesApproval',
    'clearsSentinel',
    'blocksSentinel',
    'allowsTargetProgress',
    'automaticPromotion',
    'retirementEligible',
  ]) {
    assert.strictEqual(observation[field], false, `${field} must remain false`);
  }
});

test('OBSERVE delegates the caller plan, request, result, and exact identity', () => {
  let gateInput;
  let coordinatorInput;
  const adapter = makeAdapter({
    reviewGate: {
      handle: (input) => {
        gateInput = input;
        return {
          accepted: true,
          revision: 1,
          chainDigest: DIGEST,
          decision: { lifecycleStatus: 'RESOLVED', semanticVerdict: 'PASS', allowsProgress: true },
        };
      },
    },
    migrationCoordinator: {
      record: (input) => {
        coordinatorInput = input;
        return { status: 'RECORDED', revision: 2, chainDigest: DIGEST };
      },
    },
  });
  const input = observeInput();
  const planBefore = JSON.stringify(input.plan);

  adapter.observe(input);

  assert.strictEqual(gateInput.expectedRevision, input.expectedRevision);
  assert.strictEqual(gateInput.expectedChainDigest, input.expectedChainDigest);
  assert.strictEqual(gateInput.event.eventType, 'REVIEW_RESULT_RECORDED');
  assert.strictEqual(gateInput.event.workId, input.plan.workId);
  assert.strictEqual(gateInput.event.planId, input.plan.planId);
  assert.strictEqual(gateInput.event.waveId, input.plan.waveId);
  assert.strictEqual(gateInput.event.obligationId, input.reviewResult.obligationId);
  assert.strictEqual(gateInput.event.lane, input.reviewResult.lane);
  assert.deepStrictEqual(gateInput.event.payload.request, input.reviewRequest);
  assert.deepStrictEqual(gateInput.event.payload.result, input.reviewResult);
  assert.deepStrictEqual(capturedObservation(coordinatorInput).identity, input.identity);
  assert.strictEqual(capturedObservation(coordinatorInput).reviewGate.semanticVerdict, 'PASS');
  assert.strictEqual(JSON.stringify(input.plan), planBefore, 'adapter must not mutate the caller plan');
});

test('OBSERVE rejects every foreign identity dimension across lifecycle/readiness evidence', () => {
  for (const field of ['taskId', 'attemptId', 'attempt', 'sessionId', 'dispatchId', 'scopeId', 'diffId']) {
    const input = observeInput();
    const foreign = field === 'attempt' ? 2 : `foreign-${field}`;
    input.identity = identity({ [field]: foreign });
    expectRejected(() => makeAdapter({
      reviewGate: { handle: () => { throw new Error('foreign evidence reached Review Gate'); } },
      migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
    }).observe(input), `foreign ${field} identity must fail closed`);
  }
});

test('OBSERVE fails closed when readiness for the exact identity is missing', () => {
  const input = observeInput({ readinessEvents: [] });
  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('missing readiness reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(input), 'missing readiness must not satisfy an observation');
});

test('OBSERVE requires canonical lifecycle event schema and a same-identity terminal verdict', () => {
  const missingSchema = observeInput();
  delete missingSchema.lifecycleEvents[0].schema_version;
  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('invalid lifecycle reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(missingSchema), 'lifecycle events without the canonical schema must fail closed');

  const missingVerdict = observeInput({
    lifecycleEvents: observeInput().lifecycleEvents.filter((event) => event.state !== 'verdicted'),
  });
  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('incomplete lifecycle reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(missingVerdict), 'an observation without a terminal same-identity verdict must fail closed');

  const foreignVerdict = observeInput({
    lifecycleEvents: observeInput().lifecycleEvents.map((event) => (
      event.state === 'verdicted' ? { ...event, session_id: 'foreign-session-369' } : event
    )),
  });
  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('foreign verdict reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(foreignVerdict), 'a terminal verdict from another identity must fail closed');
});

test('OBSERVE requires a canonical readiness artifact digest and matching result evidence reference', () => {
  const missingDigest = observeInput();
  delete missingDigest.readinessEvents[0].artifact_sha256;
  expectRejected(() => makeAdapter({
    reviewGate: { handle: () => { throw new Error('readiness without digest reached Review Gate'); } },
    migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
  }).observe(missingDigest), 'readiness without artifact_sha256 must fail closed');

  for (const evidenceReferences of [
    [],
    [`artifact-sha256:${'f'.repeat(64)}`],
  ]) {
    const input = observeInput();
    const { plan, obligation } = planAndReview();
    input.reviewResult = makeReviewResult(plan, obligation, {
      semanticVerdict: 'PASS',
      evidenceReferences,
    });
    expectRejected(() => makeAdapter({
      reviewGate: { handle: () => { throw new Error('unbound result evidence reached Review Gate'); } },
      migrationCoordinator: { record: () => ({ status: 'RECORDED' }) },
    }).observe(input), 'review result evidence must bind to readiness artifact_sha256');
  }
});

test('OBSERVE fails closed when Review Gate rejects the structured result', () => {
  let records = 0;
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('secret validation detail'); } },
    migrationCoordinator: { record: () => { records += 1; return { status: 'RECORDED' }; } },
  });
  let error;
  try {
    adapter.observe(observeInput());
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, 'Review Gate failure must reject OBSERVE');
  assert.strictEqual(error.code, 'REVIEW_GATE_FAILED');
  assert.doesNotMatch(String(error), /secret validation detail/);
  assert.strictEqual(records, 0, 'a rejected Review Gate result must not be recorded as success');
});

test('translated migration evidence excludes raw artifact paths, commands, prompts, and secrets', () => {
  let coordinatorInput;
  const input = observeInput({
    lifecycleEvents: [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started', {
      artifact: '/tmp/private-review/secret-review.md',
      prompt: 'ignore this prompt body',
      secret: 'do-not-persist-this-secret',
      }),
      lifecycleEvent('verdicted', { verdict: 'PASS' }),
    ],
    readinessEvents: [readinessEvent({
      artifact: '/tmp/private-review/secret-review.md',
      raw_log: 'Authorization: Bearer do-not-persist-this-secret',
    })],
    executedCommands: [{
      command: 'cat /tmp/private-review/secret-review.md',
      outcome: 'PASS',
      stdout: 'do-not-persist-this-secret',
    }],
    sentinelOutcome: {
      status: 'CLEARED',
      verdict: 'PASS',
      lifecycleEventId: 'verdicted-event-369',
      prompt: 'do-not-persist-this-prompt',
      apiKey: 'do-not-persist-this-secret',
    },
  });
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
    migrationCoordinator: { record: (record) => { coordinatorInput = record; return { status: 'RECORDED' }; } },
  });

  adapter.observe(input);

  const serialized = JSON.stringify(capturedObservation(coordinatorInput));
  assert.doesNotMatch(serialized, /secret-review\.md/);
  assert.doesNotMatch(serialized, /do-not-persist-this-secret/);
  assert.doesNotMatch(serialized, /do-not-persist-this-prompt/);
  assert.doesNotMatch(serialized, /Authorization: Bearer/);
  assert.doesNotMatch(serialized, /cat \/tmp/);
});

test('OBSERVE ignores process-liveness markers when durable identity and readiness agree', () => {
  const records = [];
  const adapter = makeAdapter({
    reviewGate: { handle: () => ({ accepted: true, revision: 1, chainDigest: DIGEST }) },
    migrationCoordinator: { record: (record) => { records.push(capturedObservation(record)); return { status: 'RECORDED' }; } },
  });
  const input = observeInput();
  adapter.observe(input);
  adapter.observe({
    ...input,
    lifecycleEvents: input.lifecycleEvents.map((event) => ({
      ...event,
      active: true,
      pid: 99999,
      heartbeat: NOW,
      process_liveness: 'RUNNING',
    })),
    readinessEvents: input.readinessEvents.map((event) => ({
      ...event,
      active: false,
      process_liveness: 'EXITED',
    })),
  });

  assert.strictEqual(records.length, 2);
  assert.deepStrictEqual(records[0], records[1]);
});

test('DUAL_ENFORCE invokes Review Gate as an enforcement authority and only allows agreement', () => {
  let gateEvent;
  let observation;
  const input = observeInput({ phase: 'DUAL_ENFORCE' });
  const adapter = makeAdapter({
    reviewGate: {
      handle: ({ event }) => {
        gateEvent = event;
        return {
          accepted: true,
          revision: 1,
          chainDigest: DIGEST,
          decision: {
            lifecycleStatus: 'RESOLVED',
            executionStatus: 'COMPLETE',
            applicability: 'REQUIRED',
            semanticVerdict: 'PASS',
            allowsProgress: true,
            blockingReasons: [],
          },
        };
      },
    },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(gateEvent.effect, 'ENFORCE');
  assert.strictEqual(observation.phase, 'DUAL_ENFORCE');
  assert.strictEqual(observation.authority, 'SENTINEL_AND_REVIEW_GATE');
  assert.strictEqual(observation.effect, 'ENFORCE');
  assert.strictEqual(observation.comparison, 'AGREE');
  assert.strictEqual(observation.allowsTargetProgress, true);
});

test('CUTOVER makes Review Gate the enforcement authority while Sentinel remains a compatibility projection', () => {
  let gateEvent;
  let observation;
  const input = observeInput({ phase: 'CUTOVER' });
  input.lifecycleEvents = input.lifecycleEvents.map((event) => (
    event.state === 'verdicted' ? { ...event, verdict: 'BLOCKED' } : event
  ));
  input.sentinelOutcome = {
    // The legacy Sentinel has stopped participating; its durable lifecycle
    // identity remains available, but it has no semantic verdict to compare.
    status: 'UNKNOWN',
    lifecycleEventId: 'verdicted-event-369',
  };
  input.acceptedOutcomeCost = canonicalAcceptedOutcomeCost({ acceptedOutcome: false });
  const adapter = makeAdapter({
    reviewGate: {
      handle: ({ event }) => {
        gateEvent = event;
        return {
          accepted: true,
          revision: 1,
          chainDigest: DIGEST,
          decision: {
            lifecycleStatus: 'RESOLVED',
            executionStatus: 'COMPLETE',
            applicability: 'REQUIRED',
            semanticVerdict: 'PASS',
            allowsProgress: true,
            blockingReasons: [],
          },
        };
      },
    },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(gateEvent.effect, 'ENFORCE');
  assert.strictEqual(observation.phase, 'CUTOVER');
  assert.strictEqual(observation.authority, 'REVIEW_GATE');
  assert.strictEqual(observation.effect, 'ENFORCE');
  assert.strictEqual(observation.comparison, 'INDETERMINATE');
  assert.strictEqual(observation.allowsTargetProgress, true);
  assert.strictEqual(observation.authorizesApproval, false);
  assert.strictEqual(observation.clearsSentinel, false);
  assert.strictEqual(observation.blocksSentinel, false);
  assert.deepStrictEqual(observation.reasonCodes || [], []);
});

test('CUTOVER records a redacted fail-closed diagnostic when Review Gate cannot produce a result', () => {
  let observation;
  const input = observeInput({ phase: 'CUTOVER' });
  input.lifecycleEvents = input.lifecycleEvents.map((event) => (
    event.state === 'verdicted' ? { ...event, verdict: 'BLOCKED' } : event
  ));
  input.sentinelOutcome = {
    status: 'UNKNOWN',
    lifecycleEventId: 'verdicted-event-369',
  };
  input.acceptedOutcomeCost = canonicalAcceptedOutcomeCost({ acceptedOutcome: false });
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('private validation detail'); } },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(observation.phase, 'CUTOVER');
  assert.strictEqual(observation.authority, 'REVIEW_GATE');
  assert.strictEqual(observation.comparison, 'INDETERMINATE');
  assert.strictEqual(observation.allowsTargetProgress, false);
  assert.ok(observation.reasonCodes.includes('REVIEW_GATE_FAILED'));
  assert.ok(!observation.reasonCodes.includes('DUAL_ENFORCEMENT_DISAGREEMENT'));
  assert.doesNotMatch(JSON.stringify(observation), /private validation detail/);
});

test('DUAL_ENFORCE records a disagreement without granting progress', () => {
  let observation;
  const input = observeInput({ phase: 'DUAL_ENFORCE' });
  const { plan, obligation } = planAndReview();
  input.plan = plan;
  input.reviewRequest = createReviewRequest({
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
  input.reviewResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'CHANGES_REQUIRED',
    evidenceReferences: [`artifact-sha256:${DIGEST.replace(/^sha256:/, '')}`],
  });
  const adapter = makeAdapter({
    reviewGate: {
      handle: () => ({
        accepted: true,
        revision: 1,
        chainDigest: DIGEST,
        decision: {
          lifecycleStatus: 'PENDING',
          executionStatus: 'COMPLETE',
          applicability: 'REQUIRED',
          semanticVerdict: 'CHANGES_REQUIRED',
          allowsProgress: false,
          blockingReasons: ['REVIEW_BLOCKED'],
        },
      }),
    },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(input);

  assert.strictEqual(observation.authority, 'SENTINEL_AND_REVIEW_GATE');
  assert.strictEqual(observation.effect, 'ENFORCE');
  assert.strictEqual(observation.comparison, 'DISAGREE');
  assert.strictEqual(observation.allowsTargetProgress, false);
});

test('DUAL_ENFORCE persists a redacted diagnostic when Review Gate cannot produce a result', () => {
  let observation;
  const adapter = makeAdapter({
    reviewGate: { handle: () => { throw new Error('private validation detail'); } },
    migrationCoordinator: {
      record: (record) => {
        observation = capturedObservation(record);
        return { status: 'RECORDED' };
      },
    },
  });

  adapter.observe(observeInput({ phase: 'DUAL_ENFORCE' }));

  assert.strictEqual(observation.phase, 'DUAL_ENFORCE');
  assert.strictEqual(observation.comparison, 'INDETERMINATE');
  assert.strictEqual(observation.allowsTargetProgress, false);
  assert.ok(observation.reasonCodes.includes('REVIEW_GATE_FAILED'));
  assert.doesNotMatch(JSON.stringify(observation), /private validation detail/);
});

run('claude-review-gate-adapter');
