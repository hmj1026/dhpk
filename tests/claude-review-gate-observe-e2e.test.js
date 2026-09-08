'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createFinding,
  makePlan,
  makeReviewResult,
  registerPlan,
  TRUST_POLICY,
  NOW_MS,
  REVIEWER_CONTRACT_VERSION,
  createReviewGateFixture,
} = require('./_lib/review-gate-fixture');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const { MigrationCoordinator } = require('../scripts/lib/migration-coordinator');
const { runHook: runHookRaw, mkRepo, sessionsDir } = require('./_lib/hookharness');
const { ClaudeReviewGateAdapter } = require('../scripts/lib/claude-review-gate-adapter');

const ADAPTER_VERSION = 'claude-review-gate.v1';

function planAndReview(readinessEvents) {
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
  const artifactDigest = readinessEvents.find((event) => event.state === 'artifact-ready')
    .artifact_sha256.replace(/^sha256:/, '');
  const reviewResult = makeReviewResult(plan, obligation, {
    semanticVerdict: 'CHANGES_REQUIRED',
    evidenceReferences: [`artifact-sha256:${artifactDigest}`],
    findings: [createFinding({
      id: 'issue-369-observe-disagreement',
      severity: 'MEDIUM',
      disposition: 'MUST_FIX',
      summary: 'diagnostic Review Gate disagreement',
      evidence: ['artifact:issue-369'],
    })],
  });
  return { plan, reviewRequest, reviewResult };
}

function makeAdapter(reviewGate, migrationCoordinator) {
  return new ClaudeReviewGateAdapter({
    reviewGate,
    migrationCoordinator,
    producer: 'fixture-reviewer',
    adapter: 'fixture-adapter',
    adapterVersion: ADAPTER_VERSION,
    now: () => NOW_MS,
  });
}

test('real Claude hook evidence records BASELINE and non-enforcing OBSERVE disagreement', () => {
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
  const baselineFixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy, now: NOW_MS });
  const observeFixture = createReviewGateFixture({ trustPolicy: observeTrustPolicy, now: NOW_MS });
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
    const beforeStop = fs.readFileSync(lifecycleFile, 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const started = beforeStop.find((event) => event.state === 'started');
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
    assert.strictEqual(fs.existsSync(sentinel), false, 'legacy Sentinel keeps its existing clear behavior');

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
    const readinessEvents = fs.readFileSync(path.join(sessionsDir(repo), '.producer-ready.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const acceptedOutcomeCost = JSON.parse(fs.readFileSync(
      path.join(sessionsDir(repo), '.accepted-outcome-cost.jsonl'),
      'utf8',
    ).trim().split('\n').filter(Boolean).pop());
    const identity = {
      taskId: started.task_id,
      attemptId: started.attempt_id,
      attempt: started.attempt,
      sessionId: started.session_id,
      dispatchId: started.wave,
      scopeId: started.scope_id,
      diffId: started.diff_id,
    };
    const sentinelOutcome = {
      status: 'CLEARED',
      verdict: 'PASS',
      outcome: 'PASS',
      lifecycleEventId: legacyVerdict.event_id,
    };
    const { plan, reviewRequest, reviewResult } = planAndReview(readinessEvents);
    const baselineRegistration = registerPlan(
      baselineFixture.gate,
      plan,
      'plan-registered-baseline-hook-369',
    );
    const baselineCoordinator = new MigrationCoordinator({
      receiptStore: baselineFixture.store,
      phase: 'BASELINE',
      now: () => NOW_MS,
    });
    const baseline = makeAdapter(baselineFixture.gate, baselineCoordinator).observe({
      phase: 'BASELINE',
      plan,
      identity,
      lifecycleEvents,
      readinessEvents,
      sentinelOutcome,
      acceptedOutcomeCost,
      expectedRevision: baselineRegistration.revision,
      expectedChainDigest: baselineRegistration.chainDigest,
    });
    assert.strictEqual(baseline.authority, 'SENTINEL');
    assert.strictEqual(baseline.effect, 'DISABLED');
    assert.strictEqual(baseline.allowsTargetProgress, false);

    const observeRegistration = registerPlan(
      observeFixture.gate,
      plan,
      'plan-registered-observe-hook-369',
    );
    const observeCoordinator = new MigrationCoordinator({
      receiptStore: observeFixture.store,
      phase: 'OBSERVE',
      now: () => NOW_MS,
    });
    const observed = makeAdapter(observeFixture.gate, observeCoordinator).observe({
      phase: 'OBSERVE',
      plan,
      identity,
      lifecycleEvents,
      readinessEvents,
      reviewRequest,
      reviewResult,
      executedCommands: [{ command: 'digest:sha256:' + 'b'.repeat(64), outcome: 'PASS' }],
      sentinelOutcome,
      acceptedOutcomeCost,
      expectedRevision: observeRegistration.revision,
      expectedChainDigest: observeRegistration.chainDigest,
    });
    const history = observeFixture.store.inspect({
      workId: plan.workId,
      expectedRevision: observed.revision,
      expectedChainDigest: observed.chainDigest,
    });
    const baselineHistory = baselineFixture.store.inspect({
      workId: plan.workId,
      expectedRevision: baseline.revision,
      expectedChainDigest: baseline.chainDigest,
    });
    const observations = history.receipts.filter((receipt) => receipt.kind === 'migration-observation');
    const diagnosticReviews = history.receipts.filter((receipt) => receipt.kind === 'review');
    assert.strictEqual(baselineHistory.receipts.filter((receipt) => receipt.kind === 'migration-observation').length, 1);
    assert.strictEqual(baselineHistory.receipts.filter((receipt) => receipt.kind === 'review').length, 0);
    assert.strictEqual(observations.length, 1);
    assert.strictEqual(diagnosticReviews.length, 1);
    assert.strictEqual(diagnosticReviews[0].payload.effect, 'OBSERVE_ONLY');
    assert.deepStrictEqual(observations[0].payload.acceptedOutcomeCost, acceptedOutcomeCost);
    assert.strictEqual(observations[0].payload.sentinelOutcome.lifecycleEventId, legacyVerdict.event_id);
    assert.strictEqual(observed.comparison, 'DISAGREE');
    assert.strictEqual(observed.authority, 'SENTINEL');
    assert.strictEqual(observed.effect, 'OBSERVE_ONLY');
    for (const field of [
      'authorizesApproval', 'clearsSentinel', 'blocksSentinel',
      'allowsTargetProgress', 'automaticPromotion', 'retirementEligible',
    ]) assert.strictEqual(observed[field], false, `${field} must remain false`);
    assert.strictEqual(fs.existsSync(sentinel), false, 'observation cannot change the legacy Sentinel result');
  } finally {
    baselineFixture.cleanup();
    observeFixture.cleanup();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('claude-review-gate-observe-e2e');
