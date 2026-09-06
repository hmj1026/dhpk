'use strict';

// RED contract for the Claude -> Review Gate migration adapter (issue #369).
// These tests deliberately exercise only the adapter's public constructor,
// capabilities, and observe seams.  Legacy hook state is input evidence, not
// an authority that the adapter may clear or reinterpret.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  makePlan,
  makeReviewResult,
  registerPlan,
  TRUST_POLICY,
  NOW,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
  createReviewGateFixture,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const { MigrationCoordinator } = require('../scripts/lib/migration-coordinator');
const { runHook: runHookRaw, mkRepo, sessionsDir } = require('./_lib/hookharness');
const { ClaudeReviewGateAdapter } = require('../scripts/lib/claude-review-gate-adapter');

const ADAPTER_VERSION = 'claude-review-gate.v1';
const INTEGRITY_KEY = 'claude-review-gate-adapter-369-integrity-key';
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
  return {
    phase: 'OBSERVE',
    plan,
    identity: ids,
    lifecycleEvents: [
      lifecycleEvent('planned'),
      lifecycleEvent('dispatched'),
      lifecycleEvent('started'),
      lifecycleEvent('verdicted', { verdict: 'PASS' }),
    ],
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
      cost: {
        dispatchCount: 1,
        semanticReviewCount: 1,
        remediationRounds: 0,
        humanTurns: 0,
        elapsedMs: 42,
      },
    },
    expectedRevision: 0,
    expectedChainDigest: null,
    ...overrides,
  };
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
    lifecycleEvents: [],
    readinessEvents: [],
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
  assert.strictEqual(observation.cost.dispatchCount, 1);
  assert.ok(result, 'BASELINE returns a caller-visible recording result');
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

test('real Claude hooks clear only the legacy Sentinel while adapter observes the same identity', () => {
  const repo = mkRepo({ prefix: 'dhpk-adapter-369-', gitConfig: true });
  const observeTrustPolicy = {
    producers: TRUST_POLICY.producers.map((entry) => (
      entry.producer === 'fixture-reviewer' && entry.adapter === 'fixture-adapter'
        ? {
          ...entry,
          eventTypes: [...entry.eventTypes, 'MIGRATION_OBSERVATION_RECORDED'],
          receiptKinds: [...entry.receiptKinds, 'migration-observation'],
        }
        : entry
    )),
  };
  const gateFixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy, now: NOW_MS });
  try {
    const dispatch = runHookRaw('pre-agent-liveness-mark.sh', {
      payload: {
        session_id: 'session-hook-369',
        tool_use_id: 'dispatch-hook-369',
        tool_input: { subagent_type: 'code-reviewer' },
      },
      cwd: repo,
      projectDir: repo,
      deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(dispatch.status, 0, dispatch.stderr);

    const lifecycleFile = path.join(sessionsDir(repo), '.lifecycle-events.jsonl');
    const lifecycleBeforeStop = fs.readFileSync(lifecycleFile, 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const started = lifecycleBeforeStop.find((event) => event.state === 'started');
    const sentinel = path.join(sessionsDir(repo), '.pending-review');
    const artifactDir = path.join(repo, '.claude', 'artifacts', 'reviews');
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifact = path.join(artifactDir, 'code-reviewer-20260906-040000-hook.md');
    fs.writeFileSync(artifact, [
      '---',
      'agent: code-reviewer',
      'generated_at: 2026-09-06T04:00:02.000Z',
      'commit: test',
      'scope: [scripts/lib/review-gate.js]',
      `scope_id: ${started.scope_id}`,
      `diff_id: ${started.diff_id}`,
      `task_id: ${started.task_id}`,
      `attempt_id: ${started.attempt_id}`,
      `session_id: ${started.session_id}`,
      'dispatch_attempt: 1',
      'dispatch_id: dispatch-hook-369',
      'producer: code-reviewer',
      'wave: dispatch-hook-369',
      'adapter: code-reviewer',
      'stage: review',
      'severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }',
      'verdict: PASS',
      '---',
      'clean',
    ].join('\n'));
    const fresh = new Date(Date.now() + 2000);
    fs.utimesSync(artifact, fresh, fresh);

    const stopped = runHookRaw('subagent-stop-verify.sh', {
      payload: {
        session_id: 'session-hook-369',
        agent_type: 'code-reviewer',
        exit_status: 0,
      },
      cwd: repo,
      projectDir: repo,
      deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
    });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.strictEqual(fs.existsSync(sentinel), false, 'legacy Sentinel must retain its existing clear behavior');

    const lifecycleEvents = fs.readFileSync(lifecycleFile, 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const legacyVerdict = lifecycleEvents.find((event) => (
      event.state === 'verdicted'
      && event.task_id === started.task_id
      && event.attempt_id === started.attempt_id
      && event.session_id === started.session_id
      && event.wave === started.wave
      && event.scope_id === started.scope_id
      && event.diff_id === started.diff_id
    ));
    assert.ok(legacyVerdict, 'the hook must durably emit the same-identity legacy outcome');
    assert.strictEqual(legacyVerdict.verdict, 'PASS');
    const readinessFile = path.join(sessionsDir(repo), '.producer-ready.jsonl');
    const readinessEvents = fs.readFileSync(readinessFile, 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const { plan, obligation, reviewRequest } = planAndReview();
    const reviewResult = makeReviewResult(plan, obligation, {
      semanticVerdict: 'PASS',
      evidenceReferences: [`artifact-sha256:${readinessEvents.find((event) => event.state === 'artifact-ready').artifact_sha256.replace(/^sha256:/, '')}`],
    });
    const registration = registerPlan(gateFixture.gate, plan, 'plan-registered-hook-369');
    const migrationCoordinator = new MigrationCoordinator({
      receiptStore: gateFixture.store,
      phase: 'OBSERVE',
      now: () => NOW_MS,
    });
    const adapter = makeAdapter({
      reviewGate: gateFixture.gate,
      migrationCoordinator,
    });
    const recorded = adapter.observe({
      phase: 'OBSERVE',
      plan,
      identity: {
        taskId: started.task_id,
        attemptId: started.attempt_id,
        attempt: started.attempt,
        sessionId: started.session_id,
        dispatchId: started.wave,
        scopeId: started.scope_id,
        diffId: started.diff_id,
      },
      lifecycleEvents,
      readinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'digest:sha256:' + 'b'.repeat(64), outcome: 'PASS' }],
      sentinelOutcome: { status: 'CLEARED', verdict: 'PASS', outcome: 'PASS' },
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    });
    const history = gateFixture.store.inspect({
      workId: plan.workId,
      expectedRevision: recorded.revision,
      expectedChainDigest: recorded.chainDigest,
    });
    const observations = history.receipts.filter((receipt) => receipt.kind === 'migration-observation');
    assert.strictEqual(observations.length, 1);
    assert.strictEqual(observations[0].payload.taskId, started.task_id);
    assert.strictEqual(observations[0].payload.dispatchId, started.wave);
    assert.strictEqual(observations[0].payload.scopeId, started.scope_id);
    assert.strictEqual(observations[0].payload.diffId, started.diff_id);
    assert.strictEqual(observations[0].payload.processLivenessRole, 'COMPATIBILITY_ONLY');
    assert.strictEqual(recorded.authority, 'SENTINEL');
    assert.strictEqual(recorded.effect, 'OBSERVE_ONLY');
    assert.strictEqual(recorded.allowsTargetProgress, false);
  } finally {
    gateFixture.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('claude-review-gate-adapter');
