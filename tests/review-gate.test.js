'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { canonicalJson, sha256 } = require('../scripts/lib/receipt-primitives');
const {
  createFinding,
  EVIDENCE_RECEIPT_SCHEMA,
  NOW,
  REVIEWER_CONTRACT_VERSION,
  STORE_EVENT_SCHEMA,
  makeGate,
  withGate,
  makePlan,
  makeReviewEvent,
  makePlanEvent,
  registerPlan,
  requestFor,
  recordPasses,
  inspectHead,
  isDeepFrozen,
} = require('./_lib/review-gate-fixture');

test('valid plan registration opens exactly its obligations and returns derived Review Requests', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan();
    const registration = registerPlan(gate, plan);

    assert.strictEqual(registration.revision, 1);
    assert.match(registration.chainDigest, /^sha256:[a-f0-9]{64}$/);
    assert.strictEqual(registration.decision.accepted, true);
    assert.strictEqual(registration.decision.allowsProgress, false);
    assert.strictEqual(registration.decision.lifecycleStatus, 'PENDING');
    assert.deepStrictEqual(registration.decision.obligations.map(({ obligationId, lane, lifecycleStatus }) => ({
      obligationId,
      lane,
      lifecycleStatus,
    })), [{
      obligationId: plan.obligations[0].obligationId,
      lane: 'code-reviewer',
      lifecycleStatus: 'PENDING',
    }]);
    assert.strictEqual(registration.reviewRequests.length, plan.obligations.length);
    assert.deepStrictEqual(registration.reviewRequests[0], {
      decisionId: plan.decisionId,
      waveId: plan.waveId,
      obligationId: plan.obligations[0].obligationId,
      lane: 'code-reviewer',
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

    const replayed = inspectHead(store, plan, registration.revision, registration.chainDigest);
    assert.deepStrictEqual(replayed.events.map(({ schema, eventType, decisionId }) => ({
      schema,
      eventType,
      decisionId,
    })), [{
      schema: STORE_EVENT_SCHEMA,
      eventType: 'PLAN_REGISTERED',
      decisionId: plan.decisionId,
    }]);
    assert.deepStrictEqual(replayed.receipts, []);
  });
});

test('trusted same-lane PASS persists a typed receipt and replay derives RESOLVED/REVIEW_PASS', () => {
  withGate(({ root, gate, store }) => {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(gate, plan);
    const passEvent = makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
      eventId: 'review-result-pass',
      semanticVerdict: 'PASS',
    });
    assert.strictEqual(passEvent.decisionId, plan.decisionId);
    assert.deepStrictEqual(Object.keys(passEvent.payload).sort(), ['executedCommands', 'request', 'result']);
    assert.strictEqual(passEvent.payload.request, registration.reviewRequests[0]);
    const passEventSnapshot = JSON.parse(JSON.stringify(passEvent));
    const rawCommand = passEventSnapshot.payload.executedCommands[0].command;
    const passed = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: passEvent,
    });

    assert.strictEqual(passed.revision, 2);
    assert.strictEqual(passed.decision.accepted, true);
    assert.deepStrictEqual(passEvent, passEventSnapshot);
    assert.strictEqual(passEvent.payload.executedCommands[0].command, rawCommand);
    assert.strictEqual(passed.decision.allowsProgress, true);
    assert.strictEqual(passed.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(passed.decision.semanticVerdict, 'PASS');
    assert.strictEqual(passed.decision.resolution, 'REVIEW_PASS');
    assert.strictEqual(passed.decision.executionStatus, 'COMPLETE');
    assert.strictEqual(passed.decision.applicability, 'REQUIRED');
    assert.strictEqual(passed.receipts.length, 1);
    assert.strictEqual(passed.receipts[0].schema, EVIDENCE_RECEIPT_SCHEMA);
    assert.strictEqual(passed.receipts[0].kind, 'review');
    assert.strictEqual(passed.receipts[0].workId, plan.workId);
    assert.strictEqual(passed.receipts[0].waveId, plan.waveId);
    assert.strictEqual(passed.receipts[0].obligationId, obligation.obligationId);
    assert.strictEqual(passed.receipts[0].lane, 'code-reviewer');
    assert.strictEqual(passed.receipts[0].payload.executionStatus, 'COMPLETE');
    assert.strictEqual(passed.receipts[0].payload.applicability, 'REQUIRED');
    assert.strictEqual(passed.receipts[0].payload.semanticVerdict, 'PASS');

    const replayGate = makeGate(root);
    const status = replayGate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: passed.revision,
      expectedChainDigest: passed.chainDigest,
      evaluatedAt: NOW,
    });
    assert.strictEqual(status.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(status.semanticVerdict, 'PASS');
    assert.strictEqual(status.resolution, 'REVIEW_PASS');
    assert.strictEqual(status.executionStatus, 'COMPLETE');
    assert.strictEqual(status.applicability, 'REQUIRED');
    assert.notStrictEqual(status.lifecycleStatus, status.semanticVerdict);
    const replayed = store.inspect({
      workId: plan.workId,
      expectedRevision: passed.revision,
      expectedChainDigest: passed.chainDigest,
    });
    assert.deepStrictEqual(
      replayed.events.map(({ eventType, decisionId }) => ({ eventType, decisionId })),
      [
        { eventType: 'PLAN_REGISTERED', decisionId: plan.decisionId },
        { eventType: 'REVIEW_RESULT_RECORDED', decisionId: plan.decisionId },
      ],
    );
    assert.deepStrictEqual(replayed.events[1].payload.request, passEvent.payload.request);
    assert.deepStrictEqual(replayed.events[1].payload.result, passEvent.payload.result);
    assert.match(replayed.events[1].payload.executedCommands[0].command, /^digest:sha256:[a-f0-9]{64}$/);
    assert.deepStrictEqual(
      replayed.events[1].payload.executedCommands,
      passed.receipts[0].payload.executedCommands,
    );
  });
});

test('identical CHANGES_REQUIRED MUST_FIX results are idempotent without a new revision or receipt', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(gate, plan, 'plan-registered-idempotent-changes');
    const finding = createFinding({
      id: 'finding-367-idempotent-changes',
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'the same remediation finding must not be recorded twice',
      evidence: ['artifact:finding-367-idempotent-changes'],
    });
    const event = makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
      eventId: 'review-result-idempotent-changes',
      semanticVerdict: 'CHANGES_REQUIRED',
      findings: [finding],
    });
    const first = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(first.decision.accepted, true);
    const beforeDuplicate = store.inspect({
      workId: plan.workId,
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
    });
    const duplicate = gate.handle({
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
      event,
    });
    const afterDuplicate = store.inspect({
      workId: plan.workId,
      expectedRevision: duplicate.revision,
      expectedChainDigest: duplicate.chainDigest,
    });

    assert.strictEqual(duplicate.revision, first.revision);
    assert.strictEqual(duplicate.chainDigest, first.chainDigest);
    assert.deepStrictEqual(duplicate.decision, first.decision);
    assert.deepStrictEqual(duplicate.receipts, []);
    assert.strictEqual(afterDuplicate.events.length, beforeDuplicate.events.length);
    assert.deepStrictEqual(afterDuplicate.events, beforeDuplicate.events);
  });
});

test('review receipts hash complete material risks separately from obligation reason signals', () => {
  const digest = (value) => `sha256:${sha256(canonicalJson(value))}`;
  withGate(({ gate, store }) => {
    const plan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
    const registration = registerPlan(gate, plan, 'plan-registered-risk-hashes');
    const resolved = recordPasses(gate, plan, registration, 'review-result-risk-hashes');
    const history = store.inspect({
      workId: plan.workId,
      expectedRevision: resolved.revision,
      expectedChainDigest: resolved.chainDigest,
    });
    const materialRisksHash = digest(plan.materialRisks);

    for (const obligation of plan.obligations) {
      const receipt = history.receipts.find(({ obligationId }) => obligationId === obligation.obligationId);
      assert.ok(receipt, `receipt for ${obligation.lane}`);
      assert.strictEqual(receipt.payload.materialRisksHash, materialRisksHash, obligation.lane);
      assert.strictEqual(receipt.payload.reasonSignalsHash, digest(obligation.reasonSignals), obligation.lane);
      assert.notStrictEqual(
        receipt.payload.materialRisksHash,
        receipt.payload.reasonSignalsHash,
        `multi-risk hashes must differ for ${obligation.lane}`,
      );
    }
  });
});

test('non-passing or non-complete results remain PENDING with independent axes', () => {
  const cases = [
    {
      name: 'changes-required',
      options: {
        semanticVerdict: 'CHANGES_REQUIRED',
        findings: [createFinding({
          id: 'finding-367-must-fix',
          severity: 'HIGH',
          disposition: 'MUST_FIX',
          summary: 'the review gate lifecycle is incomplete',
          evidence: ['artifact:finding-367-must-fix'],
        })],
      },
      expectedSemanticVerdict: 'CHANGES_REQUIRED',
      expectedExecutionStatus: 'COMPLETE',
    },
    {
      name: 'blocked',
      options: { semanticVerdict: 'BLOCKED' },
      expectedSemanticVerdict: 'BLOCKED',
      expectedExecutionStatus: 'COMPLETE',
    },
    {
      name: 'not-run',
      options: { executionStatus: 'NOT_RUN' },
      expectedSemanticVerdict: undefined,
      expectedExecutionStatus: 'NOT_RUN',
    },
    {
      name: 'interrupted',
      options: { executionStatus: 'INTERRUPTED' },
      expectedSemanticVerdict: undefined,
      expectedExecutionStatus: 'INTERRUPTED',
    },
    {
      name: 'unavailable',
      options: { executionStatus: 'UNAVAILABLE' },
      expectedSemanticVerdict: undefined,
      expectedExecutionStatus: 'UNAVAILABLE',
    },
  ];

  for (const [index, item] of cases.entries()) {
    withGate(({ gate }) => {
      const plan = makePlan();
      const obligation = plan.obligations[0];
      const registration = registerPlan(gate, plan, `plan-registered-${item.name}`);
      const result = gate.handle({
        expectedRevision: registration.revision,
        expectedChainDigest: registration.chainDigest,
        event: makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
          ...item.options,
          eventId: `review-result-${item.name}-${index}`,
        }),
      });

      assert.strictEqual(result.decision.accepted, true, item.name);
      assert.strictEqual(result.decision.allowsProgress, false, item.name);
      assert.strictEqual(result.decision.lifecycleStatus, 'PENDING', item.name);
      assert.strictEqual(result.decision.executionStatus, item.expectedExecutionStatus, item.name);
      assert.strictEqual(result.decision.applicability, 'REQUIRED', item.name);
      assert.strictEqual(result.decision.semanticVerdict, item.expectedSemanticVerdict, item.name);
      assert.strictEqual(result.decision.resolution, undefined, item.name);
      assert.strictEqual(result.receipts.length, 1, item.name);
    });
  }
});

test('an exact empty plan is NOT_APPLICABLE with EMPTY_DIFF and no review work', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ empty: true });
    const registration = registerPlan(gate, plan);

    assert.strictEqual(registration.decision.accepted, true);
    assert.strictEqual(registration.decision.allowsProgress, true);
    assert.strictEqual(registration.decision.lifecycleStatus, 'NOT_APPLICABLE');
    assert.strictEqual(registration.decision.semanticVerdict, undefined);
    assert.strictEqual(registration.decision.resolution, 'EMPTY_DIFF');
    assert.deepStrictEqual(registration.reviewRequests, []);
    assert.deepStrictEqual(registration.receipts, []);

    const status = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      evaluatedAt: NOW,
    });
    assert.strictEqual(status.lifecycleStatus, 'NOT_APPLICABLE');
    assert.strictEqual(status.resolution, 'EMPTY_DIFF');
    assert.deepStrictEqual(status.reviewRequests, []);
    assert.deepStrictEqual(store.inspect({
      workId: plan.workId,
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    }).receipts, []);
  });
});

test('re-registering an unchanged binding derives RECEIPT_REUSE without a new review receipt', () => {
  withGate(({ gate, store, root }) => {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(gate, plan);
    const passed = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
        eventId: 'review-result-reuse-pass',
        semanticVerdict: 'PASS',
      }),
    });
    const reused = gate.handle({
      expectedRevision: passed.revision,
      expectedChainDigest: passed.chainDigest,
      event: makePlanEvent(plan, 'plan-registered-reuse'),
    });

    assert.strictEqual(reused.decision.accepted, true);
    assert.strictEqual(reused.decision.allowsProgress, true);
    assert.strictEqual(reused.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(reused.decision.semanticVerdict, 'PASS');
    assert.strictEqual(reused.decision.resolution, 'RECEIPT_REUSE');
    assert.deepStrictEqual(reused.receipts, []);

    const status = makeGate(root).inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: reused.revision,
      expectedChainDigest: reused.chainDigest,
      evaluatedAt: NOW,
    });
    assert.strictEqual(status.resolution, 'RECEIPT_REUSE');
    assert.strictEqual(store.inspect({
      workId: plan.workId,
      expectedRevision: reused.revision,
      expectedChainDigest: reused.chainDigest,
    }).receipts.length, 1);
  });
});

test('evidence, trust, lane, and revision failures return immutable rejected Gate Decisions', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan();
    const obligation = plan.obligations[0];
    const registration = registerPlan(gate, plan);
    const assertHeadUnchanged = () => {
      const replayed = store.inspect({
        workId: plan.workId,
        waveId: plan.waveId,
        expectedRevision: registration.revision,
        expectedChainDigest: registration.chainDigest,
      });
      assert.strictEqual(replayed.revision, registration.revision);
      assert.strictEqual(replayed.chainDigest, registration.chainDigest);
      assert.deepStrictEqual(replayed.receipts, []);
      assert.deepStrictEqual(replayed.events.map(({ eventType }) => eventType), ['PLAN_REGISTERED']);
    };
    const assertRejected = (
      rejected,
      label,
      { expectedRevision = registration.revision, expectedChainDigest = registration.chainDigest } = {},
    ) => {
      assert.strictEqual(rejected.decision.accepted, false, label);
      assert.strictEqual(rejected.decision.allowsProgress, false, label);
      assert.deepStrictEqual(rejected.receipts, [], label);
      assert.strictEqual(rejected.revision, expectedRevision, label);
      assert.strictEqual(rejected.chainDigest, expectedChainDigest, label);
      assert.ok(Array.isArray(rejected.decision.blockingReasons), label);
      assert.deepStrictEqual(
        rejected.decision.blockingReasons,
        [...rejected.decision.blockingReasons].sort(),
        label,
      );
      assert.ok(isDeepFrozen(rejected.decision), label);
    };

    assertRejected(gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
        eventId: 'review-result-untrusted',
        producer: 'untrusted-reviewer',
        semanticVerdict: 'PASS',
      }),
    }), 'untrusted producer');
    assertHeadUnchanged();

    assertRejected(gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
        eventId: 'review-result-wrong-lane',
        lane: 'security-reviewer',
        semanticVerdict: 'PASS',
      }),
    }), 'wrong lane');
    assertHeadUnchanged();

    const malformedEvidence = makeReviewEvent(
      plan,
      obligation,
      registration.reviewRequests[0],
      { eventId: 'review-result-missing-evidence', semanticVerdict: 'PASS' },
    );
    delete malformedEvidence.payload.executedCommands;
    assertRejected(gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: malformedEvidence,
    }), 'missing evidence');
    assertHeadUnchanged();

    assertRejected(gate.handle({
      expectedRevision: registration.revision - 1,
      expectedChainDigest: null,
      event: makeReviewEvent(plan, obligation, registration.reviewRequests[0], {
        eventId: 'review-result-revision-conflict',
        semanticVerdict: 'PASS',
      }),
    }), 'revision conflict', { expectedRevision: 0, expectedChainDigest: null });
    assertHeadUnchanged();
  });
});

test('review results require every planned path but allow additional read-only dependencies', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({
      paths: ['scripts/lib/review-gate.js', 'scripts/lib/review-gate-receipt-store.js'],
    });
    const registration = registerPlan(gate, plan, 'plan-registered-scope-coverage');
    const obligation = plan.obligations[0];
    const request = registration.reviewRequests[0];

    const missingPlannedPath = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, obligation, request, {
        eventId: 'review-result-missing-planned-path',
        semanticVerdict: 'PASS',
        inspectedScope: [plan.scope.paths[0]],
      }),
    });
    assert.strictEqual(missingPlannedPath.decision.accepted, false);
    assert.strictEqual(missingPlannedPath.decision.allowsProgress, false);
    assert.deepStrictEqual(missingPlannedPath.receipts, []);

    const additionalDependencyPath = 'docs/contracts/reviewer-contract.md';
    const acceptedWithDependency = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, obligation, request, {
        eventId: 'review-result-additional-read-only-dependency',
        semanticVerdict: 'PASS',
        inspectedScope: [...plan.scope.paths, additionalDependencyPath].sort(),
      }),
    });
    assert.strictEqual(acceptedWithDependency.decision.accepted, true);
    assert.strictEqual(acceptedWithDependency.decision.allowsProgress, true);
    assert.strictEqual(acceptedWithDependency.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(acceptedWithDependency.receipts.length, 1);
    assert.strictEqual(store.inspect({
      workId: plan.workId,
      expectedRevision: acceptedWithDependency.revision,
      expectedChainDigest: acceptedWithDependency.chainDigest,
    }).receipts.length, 1);
  });
});


run('review-gate');
