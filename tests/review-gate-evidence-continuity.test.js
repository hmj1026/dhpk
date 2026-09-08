'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  createFinding,
  makeInputsInvalidatedEvent,
  makePlan,
  makePlanEvent,
  makeReviewEvent,
  recordPasses,
  registerPlan,
  requestFor,
  withGate,
} = require('./_lib/review-gate-fixture');

const assertRejected = (result, reason, label = reason) => {
  assert.strictEqual(result.decision.accepted, false, label);
  assert.strictEqual(result.decision.allowsProgress, false, label);
  assert.ok(result.decision.blockingReasons.includes(reason), label);
  assert.deepStrictEqual(result.receipts, [], label);
};

const assertSameHead = (store, plan, state, label = 'head') => {
  const replayed = store.inspect({
    workId: plan.workId,
    expectedRevision: state.revision,
    expectedChainDigest: state.chainDigest,
  });
  assert.strictEqual(replayed.revision, state.revision, label);
  assert.strictEqual(replayed.chainDigest, state.chainDigest, label);
};

test('INPUTS_INVALIDATED accepts only a new same-work plan and reopens every bound lane', () => {
  const initialRisks = ['BEHAVIOR_CHANGE', 'SECURITY'];
  const changes = [
    {
      name: 'patch',
      plan: makePlan({
        materialRisks: initialRisks,
        diff: { digest: `sha256:${'7'.repeat(64)}`, reference: 'git-diff:issue-367-patched' },
      }),
    },
    {
      name: 'scope',
      plan: makePlan({
        materialRisks: initialRisks,
        paths: ['scripts/lib/review-gate.js', 'scripts/lib/risk-router.js'],
      }),
    },
    {
      name: 'base-head',
      plan: makePlan({
        materialRisks: initialRisks,
        baseIdentity: { commit: '7'.repeat(40), tree: '8'.repeat(40) },
        headIdentity: { commit: '9'.repeat(40), tree: 'a'.repeat(40) },
      }),
    },
    {
      name: 'governing-inputs',
      plan: makePlan({
        materialRisks: initialRisks,
        governingInputs: [{
          reference: 'docs/adr/0017-review-gate-continuity.md',
          digest: `sha256:${'7'.repeat(64)}`,
        }],
      }),
    },
  ];

  for (const item of changes) {
    withGate(({ gate, store }) => {
      const initialPlan = makePlan({ materialRisks: initialRisks });
      const registration = registerPlan(gate, initialPlan, `plan-registered-invalidation-${item.name}`);
      const resolved = recordPasses(gate, initialPlan, registration, `review-result-invalidation-${item.name}`);
      const priorReceiptIds = store.inspect({
        workId: initialPlan.workId,
        expectedRevision: resolved.revision,
        expectedChainDigest: resolved.chainDigest,
      }).receipts.map(({ receiptId }) => receiptId);
      const nextPlan = item.plan;
      const event = makeInputsInvalidatedEvent(nextPlan, `inputs-invalidated-${item.name}`);

      assert.strictEqual(nextPlan.workId, initialPlan.workId, item.name);
      assert.strictEqual(nextPlan.decisionId, initialPlan.decisionId, item.name);
      assert.notStrictEqual(nextPlan.planId, initialPlan.planId, item.name);
      assert.deepStrictEqual(Object.keys(event.payload), ['plan'], item.name);
      assert.strictEqual(event.obligationId, undefined, item.name);
      assert.strictEqual(event.lane, undefined, item.name);

      const invalidated = gate.handle({
        expectedRevision: resolved.revision,
        expectedChainDigest: resolved.chainDigest,
        event,
      });
      assert.strictEqual(invalidated.decision.accepted, true, item.name);
      assert.strictEqual(invalidated.decision.allowsProgress, false, item.name);
      assert.strictEqual(invalidated.decision.lifecycleStatus, 'PENDING', item.name);
      assert.deepStrictEqual(
        invalidated.decision.obligations.map(({ lane, lifecycleStatus }) => ({ lane, lifecycleStatus })),
        nextPlan.obligations.map(({ lane }) => ({ lane, lifecycleStatus: 'PENDING' })),
        item.name,
      );
      assert.deepStrictEqual(invalidated.receipts, [], item.name);
      assert.deepStrictEqual(store.inspect({
        workId: initialPlan.workId,
        expectedRevision: invalidated.revision,
        expectedChainDigest: invalidated.chainDigest,
      }).receipts.map(({ receiptId }) => receiptId), priorReceiptIds, item.name);
    });
  }
});

test('risk-only invalidation reuses unaffected lanes and deterministically adds or removes risk lanes', () => {
  const cases = [
    {
      name: 'changed-security-risk',
      initialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
      nextRisks: ['BEHAVIOR_CHANGE', 'PRIVACY'],
      lanes: ['code-reviewer', 'security-reviewer'],
      pending: ['security-reviewer'],
    },
    {
      name: 'added-security-lane',
      initialRisks: ['BEHAVIOR_CHANGE'],
      nextRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
      lanes: ['code-reviewer', 'security-reviewer'],
      pending: ['security-reviewer'],
    },
    {
      name: 'removed-security-lane',
      initialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
      nextRisks: ['BEHAVIOR_CHANGE'],
      lanes: ['code-reviewer'],
      pending: [],
    },
  ];

  for (const item of cases) {
    withGate(({ gate, store }) => {
      const initialPlan = makePlan({ materialRisks: item.initialRisks });
      const registration = registerPlan(gate, initialPlan, `plan-registered-risk-${item.name}`);
      const resolved = recordPasses(gate, initialPlan, registration, `review-result-risk-${item.name}`);
      const nextPlan = makePlan({ materialRisks: item.nextRisks });
      const invalidated = gate.handle({
        expectedRevision: resolved.revision,
        expectedChainDigest: resolved.chainDigest,
        event: makeInputsInvalidatedEvent(nextPlan, `inputs-invalidated-risk-${item.name}`),
      });

      assert.strictEqual(nextPlan.workId, initialPlan.workId, item.name);
      assert.strictEqual(nextPlan.decisionId, initialPlan.decisionId, item.name);
      assert.strictEqual(invalidated.decision.accepted, true, item.name);
      assert.deepStrictEqual(invalidated.decision.obligations.map(({ lane, lifecycleStatus }) => ({
        lane,
        lifecycleStatus,
      })), item.lanes.map((lane) => ({
        lane,
        lifecycleStatus: item.pending.includes(lane) ? 'PENDING' : 'RESOLVED',
      })), item.name);
      assert.deepStrictEqual(invalidated.reviewRequests.map(({ lane }) => lane), item.pending, item.name);
      assert.strictEqual(invalidated.decision.allowsProgress, item.pending.length === 0, item.name);
      assert.deepStrictEqual(invalidated.receipts, [], item.name);
      assert.strictEqual(store.inspect({
        workId: initialPlan.workId,
        expectedRevision: invalidated.revision,
        expectedChainDigest: invalidated.chainDigest,
      }).receipts.length, initialPlan.obligations.length, item.name);
    });
  }
});

test('remediation invalidation carries unresolved findings and requires the complete new scope', () => {
  withGate(({ gate, store }) => {
    const initialPlan = makePlan();
    const registration = registerPlan(gate, initialPlan, 'plan-registered-remediation');
    const finding = createFinding({
      id: 'finding-367-remediation',
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'the review gate lifecycle still needs remediation',
      evidence: ['artifact:finding-367-remediation'],
    });
    const changesRequired = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(initialPlan, initialPlan.obligations[0], registration.reviewRequests[0], {
        eventId: 'review-result-remediation-required',
        semanticVerdict: 'CHANGES_REQUIRED',
        findings: [finding],
      }),
    });
    const remediationPlan = makePlan({
      paths: ['scripts/lib/review-gate.js', 'scripts/lib/review-gate-receipt-store.js'],
      diff: { digest: `sha256:${'7'.repeat(64)}`, reference: 'git-diff:issue-367-remediation' },
    });
    const invalidation = gate.handle({
      expectedRevision: changesRequired.revision,
      expectedChainDigest: changesRequired.chainDigest,
      event: makeInputsInvalidatedEvent(remediationPlan, 'inputs-invalidated-remediation'),
    });
    assert.strictEqual(invalidation.decision.accepted, true);
    assert.strictEqual(invalidation.reviewRequests.length, 1);
    assert.deepStrictEqual(invalidation.reviewRequests[0].priorFindings, [finding]);
    assert.deepStrictEqual(invalidation.reviewRequests[0].scope, remediationPlan.scope);

    const incomplete = gate.handle({
      expectedRevision: invalidation.revision,
      expectedChainDigest: invalidation.chainDigest,
      event: makeReviewEvent(
        remediationPlan,
        remediationPlan.obligations[0],
        invalidation.reviewRequests[0],
        {
          eventId: 'review-result-remediation-incomplete-scope',
          semanticVerdict: 'PASS',
          inspectedScope: [remediationPlan.scope.paths[0]],
        },
      ),
    });
    assertRejected(incomplete, 'MISSING_SCOPE');
    assertSameHead(store, remediationPlan, invalidation);

    const remediated = gate.handle({
      expectedRevision: invalidation.revision,
      expectedChainDigest: invalidation.chainDigest,
      event: makeReviewEvent(
        remediationPlan,
        remediationPlan.obligations[0],
        invalidation.reviewRequests[0],
        { eventId: 'review-result-remediation-pass', semanticVerdict: 'PASS' },
      ),
    });
    assert.strictEqual(remediated.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(store.inspect({
      workId: initialPlan.workId,
      expectedRevision: remediated.revision,
      expectedChainDigest: remediated.chainDigest,
    }).receipts.length, 2);
  });
});

test('a later same-lane MUST_FIX result prevents reuse of an older PASS after another risk lane changes', () => {
  withGate(({ gate }) => {
    const initialPlan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
    const registration = registerPlan(gate, initialPlan, 'plan-registered-reuse-remediation');
    const code = initialPlan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const security = initialPlan.obligations.find(({ lane }) => lane === 'security-reviewer');
    const codePass = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(initialPlan, code, requestFor(registration, code), {
        eventId: 'review-result-reuse-remediation-code-pass',
        semanticVerdict: 'PASS',
      }),
    });
    const finding = createFinding({
      id: 'finding-367-reuse-remediation-code',
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'the code lane still requires remediation',
      evidence: ['artifact:finding-367-reuse-remediation-code'],
    });
    const codeChangesRequired = gate.handle({
      expectedRevision: codePass.revision,
      expectedChainDigest: codePass.chainDigest,
      event: makeReviewEvent(initialPlan, code, requestFor(registration, code), {
        eventId: 'review-result-reuse-remediation-code-changes',
        semanticVerdict: 'CHANGES_REQUIRED',
        findings: [finding],
      }),
    });
    const securityPass = gate.handle({
      expectedRevision: codeChangesRequired.revision,
      expectedChainDigest: codeChangesRequired.chainDigest,
      event: makeReviewEvent(initialPlan, security, requestFor(codeChangesRequired, security), {
        eventId: 'review-result-reuse-remediation-security-pass',
        semanticVerdict: 'PASS',
      }),
    });
    const nextPlan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'PRIVACY'] });
    const invalidated = gate.handle({
      expectedRevision: securityPass.revision,
      expectedChainDigest: securityPass.chainDigest,
      event: makeInputsInvalidatedEvent(nextPlan, 'inputs-invalidated-reuse-remediation'),
    });

    const codeStatus = invalidated.decision.obligations.find(({ lane }) => lane === 'code-reviewer');
    const codeRequest = requestFor(invalidated, nextPlan.obligations.find(({ lane }) => lane === 'code-reviewer'));
    assert.strictEqual(codeStatus.lifecycleStatus, 'PENDING');
    assert.strictEqual(codeStatus.executionStatus, 'NOT_RUN');
    assert.ok(codeRequest, 'code lane remains actionable after the later MUST_FIX result');
    assert.deepStrictEqual(codeRequest.priorFindings, [finding]);
  });
});

test('an UNAVAILABLE result may be replaced by a trusted same-lane reviewer, but not another lane', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
    const registration = registerPlan(gate, plan, 'plan-registered-replacement');
    const code = plan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const security = plan.obligations.find(({ lane }) => lane === 'security-reviewer');
    const unavailable = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, code, requestFor(registration, code), {
        eventId: 'review-result-code-unavailable',
        executionStatus: 'UNAVAILABLE',
        sessionId: 'session-367-unavailable',
      }),
    });
    const replacement = gate.handle({
      expectedRevision: unavailable.revision,
      expectedChainDigest: unavailable.chainDigest,
      event: makeReviewEvent(plan, code, requestFor(unavailable, code), {
        eventId: 'review-result-code-replacement-pass',
        semanticVerdict: 'PASS',
        producer: 'replacement-reviewer',
        adapter: 'replacement-adapter',
        sessionId: 'session-367-replacement-code',
      }),
    });
    assert.strictEqual(replacement.decision.accepted, true);
    assert.strictEqual(replacement.decision.obligations.find(({ lane }) => lane === 'code-reviewer').lifecycleStatus, 'RESOLVED');
    assert.strictEqual(replacement.decision.obligations.find(({ lane }) => lane === 'security-reviewer').lifecycleStatus, 'PENDING');

    const wrongLane = gate.handle({
      expectedRevision: replacement.revision,
      expectedChainDigest: replacement.chainDigest,
      event: makeReviewEvent(plan, security, requestFor(replacement, security), {
        eventId: 'review-result-security-replacement-rejected',
        semanticVerdict: 'PASS',
        producer: 'replacement-reviewer',
        adapter: 'replacement-adapter',
        sessionId: 'session-367-replacement-wrong-lane',
      }),
    });
    assertRejected(wrongLane, 'UNTRUSTED_LANE');
    assert.strictEqual(store.inspect({
      workId: plan.workId,
      expectedRevision: replacement.revision,
      expectedChainDigest: replacement.chainDigest,
    }).receipts.length, 2);
  });
});

const chronologyFixture = (gate) => {
  const planA = makePlan({
    requestId: 'github:issue:367-plan-chronology',
    decisionKey: 'plan-chronology',
  });
  const registrationA = registerPlan(gate, planA, 'plan-registered-chronology-a');
  const resolvedA = recordPasses(gate, planA, registrationA, 'review-result-chronology-a');
  const planB = makePlan({
    requestId: 'github:issue:367-plan-chronology',
    decisionKey: 'plan-chronology',
    diff: { digest: `sha256:${'8'.repeat(64)}`, reference: 'git-diff:chronology-b' },
  });
  const invalidatedB = gate.handle({
    expectedRevision: resolvedA.revision,
    expectedChainDigest: resolvedA.chainDigest,
    event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-chronology-b'),
  });
  assert.strictEqual(registrationA.decision.accepted, true);
  assert.strictEqual(resolvedA.decision.accepted, true);
  assert.strictEqual(invalidatedB.decision.accepted, true);
  assert.strictEqual(invalidatedB.decision.lifecycleStatus, 'PENDING');
  assert.strictEqual(invalidatedB.decision.allowsProgress, false);
  return { planA, planB, invalidatedB };
};

test('a superseded PLAN_REGISTERED cannot roll chronology back after a newer invalidation', () => {
  withGate(({ gate, store }) => {
    const { planA, planB, invalidatedB } = chronologyFixture(gate);
    const beforeRollback = store.inspect({
      workId: planA.workId,
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
    });
    const staleRegistration = gate.handle({
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
      event: makePlanEvent(planA, 'plan-registered-chronology-stale-a'),
    });
    assertRejected(staleRegistration, 'STALE_EVIDENCE', 'stale PLAN_REGISTERED');
    assertSameHead(store, planA, invalidatedB, 'stale PLAN_REGISTERED preserves head');
    const current = gate.inspect({
      workId: planA.workId,
      waveId: planB.waveId,
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
    });
    assert.strictEqual(current.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(current.decision.allowsProgress, false);
    assert.deepStrictEqual(current.receipts.map(({ receiptId }) => receiptId), beforeRollback.receipts.map(({ receiptId }) => receiptId));
  });
});

test('a superseded INPUTS_INVALIDATED cannot reopen an older plan after a newer invalidation', () => {
  withGate(({ gate, store }) => {
    const { planA, planB, invalidatedB } = chronologyFixture(gate);
    const staleInvalidation = gate.handle({
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
      event: makeInputsInvalidatedEvent(planA, 'inputs-invalidated-chronology-stale-a'),
    });
    assertRejected(staleInvalidation, 'STALE_EVIDENCE', 'stale INPUTS_INVALIDATED');
    assertSameHead(store, planA, invalidatedB, 'stale INPUTS_INVALIDATED preserves head');
    const current = gate.inspect({
      workId: planA.workId,
      waveId: planB.waveId,
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
    });
    assert.strictEqual(current.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(current.decision.allowsProgress, false);
  });
});

test('a late review result from a superseded wave cannot roll the current plan back', () => {
  withGate(({ gate, store }) => {
    const planA = makePlan({
      requestId: 'github:issue:367-late-review',
      decisionKey: 'late-review-result',
    });
    const registrationA = registerPlan(gate, planA, 'plan-registered-late-review-a');
    const planB = makePlan({
      requestId: 'github:issue:367-late-review',
      decisionKey: 'late-review-result',
      diff: { digest: `sha256:${'9'.repeat(64)}`, reference: 'git-diff:late-review-b' },
    });
    const invalidatedB = gate.handle({
      expectedRevision: registrationA.revision,
      expectedChainDigest: registrationA.chainDigest,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-late-review-b'),
    });
    assert.strictEqual(invalidatedB.decision.accepted, true);
    const finding = createFinding({
      id: 'finding-late-review-must-fix',
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'late review must not clear the current remediation',
      evidence: ['artifact:finding-late-review-must-fix'],
    });
    const changesRequired = gate.handle({
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
      event: makeReviewEvent(planB, planB.obligations[0], invalidatedB.reviewRequests[0], {
        eventId: 'review-result-late-review-b-changes',
        semanticVerdict: 'CHANGES_REQUIRED',
        findings: [finding],
      }),
    });
    assert.strictEqual(changesRequired.decision.accepted, true);
    assert.deepStrictEqual(changesRequired.reviewRequests[0].priorFindings, [finding]);

    const lateARequest = {
      ...requestFor(registrationA, planA.obligations[0]),
      priorFindings: [finding],
    };
    const lateA = gate.handle({
      expectedRevision: changesRequired.revision,
      expectedChainDigest: changesRequired.chainDigest,
      event: makeReviewEvent(planA, planA.obligations[0], lateARequest, {
        eventId: 'review-result-late-review-a-pass',
        semanticVerdict: 'PASS',
      }),
    });
    assertRejected(lateA, 'STALE_EVIDENCE', 'late superseded-wave review');
    assertSameHead(store, planA, changesRequired, 'late review preserves current head');

    const forgedBRequest = {
      ...changesRequired.reviewRequests[0],
      priorFindings: [],
    };
    const forgedB = gate.handle({
      expectedRevision: changesRequired.revision,
      expectedChainDigest: changesRequired.chainDigest,
      event: makeReviewEvent(planB, planB.obligations[0], forgedBRequest, {
        eventId: 'review-result-late-review-b-forged',
        semanticVerdict: 'PASS',
      }),
    });
    assertRejected(forgedB, 'FOREIGN_EVIDENCE', 'B request omits accumulated MUST_FIX');
    const current = gate.inspect({
      workId: planA.workId,
      waveId: planB.waveId,
      expectedRevision: changesRequired.revision,
      expectedChainDigest: changesRequired.chainDigest,
    });
    assert.strictEqual(current.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(current.decision.allowsProgress, false);
    assert.deepStrictEqual(current.reviewRequests[0].priorFindings, [finding]);
  });
});

run('review-gate-evidence-continuity');
