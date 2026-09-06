'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { canonicalJson, sha256 } = require('../scripts/lib/receipt-primitives');
const {
  AUTHORITY_TRUST_POLICY,
  NOW,
  createFinding,
  isDeepFrozen,
  makeAuthorityEvent,
  makeAuthorityReceipt,
  makeInputsInvalidatedEvent,
  makePlan,
  makePlanEvent,
  makeReviewEvent,
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

const CODE_ONLY_AUTHORITY_TRUST_POLICY = Object.freeze({
  producers: Object.freeze(AUTHORITY_TRUST_POLICY.producers.map((entry) => (
    entry.producer === 'human-authority'
      ? Object.freeze({ ...entry, lanes: Object.freeze(['code-reviewer']) })
      : entry
  ))),
});

const authorityScenario = (gate, plan, registration, {
  obligation = null,
  eventId = 'authority-override-1',
  receiptOptions = {},
  eventOptions = {},
} = {}) => {
  const receipt = makeAuthorityReceipt(plan, { obligation, eventId, ...receiptOptions });
  const event = makeAuthorityEvent(plan, { obligation, receipt, eventId, ...eventOptions });
  return {
    receipt,
    event,
    result: gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    }),
  };
};

const prepareLaneRemoval = (gate, suffix) => {
  const planA = makePlan({
    requestId: `github:issue:367-${suffix}`,
    decisionKey: suffix,
    materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
  });
  const registration = registerPlan(gate, planA, `plan-registered-${suffix}`);
  const code = planA.obligations.find(({ lane }) => lane === 'code-reviewer');
  const security = planA.obligations.find(({ lane }) => lane === 'security-reviewer');
  const codePass = gate.handle({
    expectedRevision: registration.revision,
    expectedChainDigest: registration.chainDigest,
    event: makeReviewEvent(planA, code, requestFor(registration, code), {
      eventId: `review-result-${suffix}-code-pass`,
      semanticVerdict: 'PASS',
    }),
  });
  const finding = createFinding({
    id: `finding-${suffix}`,
    severity: 'HIGH',
    disposition: 'MUST_FIX',
    summary: 'security review must complete before its lane can be removed',
    evidence: [`artifact:finding-${suffix}`],
  });
  const securityChanges = gate.handle({
    expectedRevision: codePass.revision,
    expectedChainDigest: codePass.chainDigest,
    event: makeReviewEvent(planA, security, requestFor(codePass, security), {
      eventId: `review-result-${suffix}-security-changes`,
      semanticVerdict: 'CHANGES_REQUIRED',
      findings: [finding],
    }),
  });
  const planB = makePlan({
    requestId: `github:issue:367-${suffix}`,
    decisionKey: suffix,
    materialRisks: ['BEHAVIOR_CHANGE'],
  });
  return { planA, planB, registration, code, security, codePass, finding, securityChanges };
};

test('a trusted human supplies an exact obligation or wave authority receipt without synthetic PASS', () => {
  withGate(({ gate, store }) => {
    const obligationPlan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
    const registration = registerPlan(gate, obligationPlan, 'plan-registered-authority-obligation');
    const obligation = obligationPlan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const obligationOverride = authorityScenario(gate, obligationPlan, registration, {
      obligation,
      eventId: 'authority-obligation',
    });
    assert.strictEqual(obligationOverride.event.payload.receipt, obligationOverride.receipt);
    assert.strictEqual(obligationOverride.result.decision.accepted, true);
    assert.strictEqual(obligationOverride.result.decision.allowsProgress, false);
    assert.strictEqual(obligationOverride.result.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(obligationOverride.result.decision.resolution, undefined);
    assert.strictEqual(obligationOverride.result.receipts.length, 1);
    assert.deepStrictEqual(obligationOverride.result.receipts[0], obligationOverride.receipt);

    const wavePlan = makePlan({
      requestId: 'github:issue:367-authority-wave',
      decisionKey: 'authority-wave-target',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const waveRegistration = registerPlan(gate, wavePlan, 'plan-registered-authority-wave');
    const waveOverride = authorityScenario(gate, wavePlan, waveRegistration, {
      eventId: 'authority-wave',
    });
    assert.strictEqual(waveOverride.result.decision.accepted, true);
    assert.strictEqual(waveOverride.result.decision.allowsProgress, true);
    assert.strictEqual(waveOverride.result.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(waveOverride.result.decision.resolution, 'AUTHORITY_OVERRIDE');
    assert.strictEqual(waveOverride.result.decision.semanticVerdict, undefined);
    assert.ok(waveOverride.result.decision.obligations.every(({ lifecycleStatus }) => lifecycleStatus === 'RESOLVED'));
    assert.deepStrictEqual(waveOverride.result.reviewRequests, []);
    assert.deepStrictEqual(store.inspect({
      workId: wavePlan.workId,
      expectedRevision: waveOverride.result.revision,
      expectedChainDigest: waveOverride.result.chainDigest,
    }).receipts, [waveOverride.receipt]);
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });

  withGate(({ gate }) => {
    const plan = makePlan({
      requestId: 'github:issue:367-authority-prior',
      decisionKey: 'authority-preserve-prior-verdict',
    });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-prior');
    const finding = createFinding({
      id: 'finding-authority-prior',
      severity: 'HIGH',
      disposition: 'MUST_FIX',
      summary: 'prior reviewer result remains visible under an override',
      evidence: ['artifact:finding-authority-prior'],
    });
    const changesRequired = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, plan.obligations[0], registration.reviewRequests[0], {
        eventId: 'review-result-authority-prior',
        semanticVerdict: 'CHANGES_REQUIRED',
        findings: [finding],
      }),
    });
    const override = authorityScenario(gate, plan, changesRequired, {
      obligation: plan.obligations[0],
      eventId: 'authority-preserve-prior',
    });
    assert.strictEqual(override.result.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(override.result.decision.allowsProgress, true);
    assert.strictEqual(override.result.decision.resolution, 'AUTHORITY_OVERRIDE');
    assert.strictEqual(override.result.decision.semanticVerdict, 'CHANGES_REQUIRED');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('authority overrides fail closed for expiry, scope, identity, trust, and unknown versions without mutation', () => {
  const cases = [
    {
      name: 'expired-at-handle',
      receiptOptions: { expiresAt: '2026-09-06T03:59:59.000Z' },
      reason: 'OVERRIDE_EXPIRED',
    },
    {
      name: 'malformed-target',
      receiptOptions: { overrides: { target: null } },
      reason: 'MALFORMED_EVIDENCE',
    },
    {
      name: 'missing-target-field',
      receiptOptions: { overrides: { target: { type: 'OBLIGATION' } } },
      reason: 'MALFORMED_EVIDENCE',
    },
    {
      name: 'unexpected-target-alias',
      receiptOptions: {
        overrides: {
          target: { type: 'OBLIGATION', obligationId: 'placeholder', id: 'unexpected-alias' },
        },
      },
      reason: 'MALFORMED_EVIDENCE',
      targetUsesPlaceholder: true,
    },
    {
      name: 'foreign-target',
      receiptOptions: { overrides: { target: { type: 'OBLIGATION', obligationId: 'foreign-obligation' } } },
      reason: 'FOREIGN_EVIDENCE',
    },
    {
      name: 'stale-event-identity',
      eventOptions: { sourceCommit: '0'.repeat(40) },
      receiptOptions: { overrides: { sourceCommit: '0'.repeat(40) } },
      reason: 'STALE_EVIDENCE',
    },
    {
      name: 'untrusted-producer',
      eventOptions: { producer: 'untrusted-human', adapter: 'unknown-authority-adapter' },
      reason: 'UNTRUSTED_PRODUCER',
    },
    {
      name: 'wrong-receipt-kind',
      receiptOptions: { kind: 'review' },
      reason: 'UNTRUSTED_PRODUCER',
    },
    {
      name: 'unknown-policy-version',
      eventOptions: { policyVersion: 'dhpk.risk-policy.v999' },
      receiptOptions: { overrides: { policyVersion: 'dhpk.risk-policy.v999' } },
      reason: 'STALE_EVIDENCE',
    },
    {
      name: 'unknown-contract-version',
      eventOptions: { contractVersion: 'dhpk.reviewer-contract.v999' },
      receiptOptions: { overrides: { contractVersion: 'dhpk.reviewer-contract.v999' } },
      reason: 'STALE_EVIDENCE',
    },
    {
      name: 'blank-required-reason',
      receiptOptions: { reason: '' },
      reason: 'MALFORMED_EVIDENCE',
    },
    {
      name: 'expiry-not-after-issued',
      receiptOptions: {
        issuedAt: '2026-09-06T04:00:00.000Z',
        expiresAt: '2026-09-06T04:00:00.000Z',
      },
      reason: 'MALFORMED_EVIDENCE',
    },
    {
      name: 'receipt-event-id-mismatch',
      receiptOptions: { overrides: { eventId: 'authority-receipt-event-id' } },
      reason: 'FOREIGN_EVIDENCE',
    },
    {
      name: 'receipt-event-session-mismatch',
      receiptOptions: { sessionId: 'authority-receipt-session' },
      eventOptions: { sessionId: 'authority-event-session' },
      reason: 'FOREIGN_EVIDENCE',
    },
  ];

  for (const item of cases) {
    withGate(({ gate, store }) => {
      const plan = makePlan({ requestId: `github:issue:367-authority-${item.name}` });
      const registration = registerPlan(gate, plan, `plan-registered-authority-${item.name}`);
      const obligation = plan.obligations[0];
      const receiptOptions = item.targetUsesPlaceholder
        ? {
          ...item.receiptOptions,
          overrides: {
            ...item.receiptOptions.overrides,
            target: {
              ...item.receiptOptions.overrides.target,
              obligationId: obligation.obligationId,
            },
          },
        }
        : item.receiptOptions;
      const { result } = authorityScenario(gate, plan, registration, {
        obligation,
        eventId: `authority-invalid-${item.name}`,
        receiptOptions,
        eventOptions: item.eventOptions,
      });
      assertRejected(result, item.reason, item.name);
      assertSameHead(store, plan, registration, item.name);
    }, { trustPolicy: AUTHORITY_TRUST_POLICY });
  }
});

test('a changed binding invalidates an active authority override without reuse', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({
      requestId: 'github:issue:367-authority-invalidation',
      decisionKey: 'authority-invalidation',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-invalidation');
    const authority = authorityScenario(gate, plan, registration, {
      eventId: 'authority-active-invalidation',
      receiptOptions: { expiresAt: '2026-09-06T05:00:00.000Z' },
    });
    assert.strictEqual(authority.result.decision.allowsProgress, true);
    const changedPlan = makePlan({
      requestId: 'github:issue:367-authority-invalidation',
      decisionKey: 'authority-invalidation',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
      diff: { digest: `sha256:${'8'.repeat(64)}`, reference: 'git-diff:authority-invalidation-changed' },
    });
    const invalidated = gate.handle({
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
      event: makeInputsInvalidatedEvent(changedPlan, 'inputs-invalidated-authority-active'),
    });
    assert.strictEqual(invalidated.decision.accepted, true);
    assert.strictEqual(invalidated.decision.allowsProgress, false);
    assert.strictEqual(invalidated.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(invalidated.decision.resolution, undefined);
    assert.ok(invalidated.decision.obligations.every(({ lifecycleStatus }) => lifecycleStatus === 'PENDING'));
    assert.deepStrictEqual(invalidated.receipts, []);
    assert.strictEqual(store.inspect({
      workId: plan.workId,
      expectedRevision: invalidated.revision,
      expectedChainDigest: invalidated.chainDigest,
    }).receipts.length, 1);
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('an authority override becomes pending with OVERRIDE_EXPIRED after its expiry', () => {
  withGate(({ gate, setNow }) => {
    const plan = makePlan({
      requestId: 'github:issue:367-authority-expiry',
      decisionKey: 'authority-expiry',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-expiry');
    const authority = authorityScenario(gate, plan, registration, {
      eventId: 'authority-expiry-wave',
      receiptOptions: { expiresAt: '2026-09-06T04:00:01.000Z' },
    });
    assert.strictEqual(authority.result.decision.allowsProgress, true);
    setNow('2026-09-06T04:00:02.000Z');
    const expired = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
      evaluatedAt: '2026-09-06T04:00:02.000Z',
    });
    assert.strictEqual(expired.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(expired.decision.allowsProgress, false);
    assert.ok(expired.decision.blockingReasons.includes('OVERRIDE_EXPIRED'));
    assert.ok(expired.decision.obligations.every(({ lifecycleStatus }) => lifecycleStatus === 'PENDING'));
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('duplicate authority event is idempotent and a conflicting event identity leaves the head unchanged', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-idempotency' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-idempotency');
    const receipt = makeAuthorityReceipt(plan, { eventId: 'authority-idempotent' });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-idempotent' });
    const first = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    const duplicate = gate.handle({
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
      event: JSON.parse(JSON.stringify(event)),
    });
    assert.strictEqual(duplicate.decision.accepted, true);
    assert.strictEqual(duplicate.revision, first.revision);
    assert.strictEqual(duplicate.chainDigest, first.chainDigest);
    assert.deepStrictEqual(duplicate.decision, first.decision);
    assert.deepStrictEqual(duplicate.receipts, []);
    const conflictingReceipt = makeAuthorityReceipt(plan, {
      eventId: 'authority-idempotent',
      reason: 'a conflicting reason must not replace the original event',
    });
    const conflict = gate.handle({
      expectedRevision: first.revision,
      expectedChainDigest: first.chainDigest,
      event: makeAuthorityEvent(plan, { receipt: conflictingReceipt, eventId: 'authority-idempotent' }),
    });
    assertRejected(conflict, 'IDEMPOTENCY_CONFLICT');
    assertSameHead(store, plan, first);
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('tampered persisted history returns a fail-closed pending decision during inspect', () => {
  withGate(({ gate, store, root }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-tamper' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-tamper');
    const authority = authorityScenario(gate, plan, registration, { eventId: 'authority-tamper' });
    const history = store.inspect({
      workId: plan.workId,
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
    });
    const event = history.events[0];
    const digest = sha256(canonicalJson(event));
    const objectPath = path.join(root, 'objects', 'sha256', digest.slice(0, 2), `${digest}.json`);
    const object = JSON.parse(fs.readFileSync(objectPath, 'utf8'));
    object.payload.plan.scope.paths = ['tampered/path'];
    fs.writeFileSync(objectPath, `${canonicalJson(object)}\n`);
    const inspected = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
      evaluatedAt: NOW,
    });
    assert.strictEqual(inspected.decision.accepted, false);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(inspected.decision.allowsProgress, false);
    assert.ok(inspected.decision.blockingReasons.includes('TAMPERED_EVIDENCE'));
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('authority results and ReviewGate public projections are deeply immutable', () => {
  withGate(({ gate }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-immutable' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-immutable');
    const authority = authorityScenario(gate, plan, registration, { eventId: 'authority-immutable' });
    assert.strictEqual(authority.result.decision.accepted, true);
    assert.strictEqual(authority.result.decision.allowsProgress, true);
    assert.strictEqual(authority.result.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(authority.result.decision.resolution, 'AUTHORITY_OVERRIDE');
    assert.strictEqual(authority.result.receipts.length, 1);
    assert.ok(isDeepFrozen(authority.result));
    assert.ok(isDeepFrozen(authority.result.decision));
    assert.ok(isDeepFrozen(authority.result.reviewRequests));
    assert.ok(isDeepFrozen(authority.result.receipts));
    assert.ok(isDeepFrozen(authority.result.receipts[0]));
    const inspected = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
      evaluatedAt: NOW,
    });
    assert.ok(isDeepFrozen(inspected));
    assert.ok(isDeepFrozen(inspected.decision));
    assert.ok(isDeepFrozen(inspected.reviewRequests));
    assert.ok(isDeepFrozen(inspected.receipts));
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('a WAVE authority override cannot cross an unauthorized lane or smuggle top-level lane fields', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({
      requestId: 'github:issue:367-authority-wave-lane',
      decisionKey: 'authority-wave-lane',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-wave-lane');
    const waveReceipt = makeAuthorityReceipt(plan, { eventId: 'authority-wave-unauthorized-lane' });
    const unauthorized = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeAuthorityEvent(plan, {
        receipt: waveReceipt,
        eventId: 'authority-wave-unauthorized-lane',
      }),
    });
    assertRejected(unauthorized, 'UNTRUSTED_LANE');
    assertSameHead(store, plan, registration, 'unauthorized WAVE override preserves head');
    const codeObligation = plan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const forgedWaveReceipt = {
      ...waveReceipt,
      receiptId: 'authority-wave-forged-top-level-lane',
      payload: { ...waveReceipt.payload, eventId: 'authority-wave-forged-top-level-lane' },
      obligationId: codeObligation.obligationId,
      lane: codeObligation.lane,
    };
    const malformed = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeAuthorityEvent(plan, {
        receipt: forgedWaveReceipt,
        eventId: 'authority-wave-forged-top-level-lane',
      }),
    });
    assertRejected(malformed, 'MALFORMED_EVIDENCE');
    assertSameHead(store, plan, registration, 'forged WAVE target preserves head');
  }, { trustPolicy: CODE_ONLY_AUTHORITY_TRUST_POLICY });
});
test('future-issued authority is not active at the trusted clock', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-future-issued' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-future-issued');
    const future = authorityScenario(gate, plan, registration, {
      eventId: 'authority-future-issued',
      receiptOptions: {
        issuedAt: '2026-09-06T05:00:00.000Z',
        expiresAt: '2026-09-06T06:00:00.000Z',
      },
    });
    assertRejected(future.result, 'OVERRIDE_NOT_ACTIVE');
    assertSameHead(store, plan, registration, 'future-issued override preserves head');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('trusted clock expiry cannot be bypassed by an earlier caller evaluatedAt', () => {
  withGate(({ gate, setNow }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-clock-expiry' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-clock-expiry');
    const authority = authorityScenario(gate, plan, registration, {
      eventId: 'authority-clock-expiry',
      receiptOptions: { expiresAt: '2026-09-06T04:00:01.000Z' },
    });
    assert.strictEqual(authority.result.decision.accepted, true);
    setNow('2026-09-06T04:00:02.000Z');
    const inspected = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: authority.result.revision,
      expectedChainDigest: authority.result.chainDigest,
      evaluatedAt: '2026-09-06T04:00:00.500Z',
    });
    assert.strictEqual(inspected.decision.accepted, true);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(inspected.decision.allowsProgress, false);
    assert.ok(inspected.decision.blockingReasons.includes('OVERRIDE_EXPIRED'));
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('receipt and event recordedAt mismatch is foreign authority evidence', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:367-authority-recorded-at' });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-recorded-at');
    const mismatched = authorityScenario(gate, plan, registration, {
      eventId: 'authority-recorded-at-mismatch',
      receiptOptions: { recordedAt: '2026-09-06T04:00:01.000Z' },
      eventOptions: { recordedAt: '2026-09-06T04:00:02.000Z' },
    });
    assertRejected(mismatched.result, 'FOREIGN_EVIDENCE');
    assertSameHead(store, plan, registration, 'recordedAt mismatch preserves head');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('MUST_FIX findings survive every intermediate result and cannot be laundered from the next request', () => {
  const intermediateStates = [
    { name: 'BLOCKED', executionStatus: 'COMPLETE', semanticVerdict: 'BLOCKED' },
    { name: 'UNAVAILABLE', executionStatus: 'UNAVAILABLE' },
    { name: 'NOT_RUN', executionStatus: 'NOT_RUN' },
    { name: 'INTERRUPTED', executionStatus: 'INTERRUPTED' },
  ];
  for (const item of intermediateStates) {
    withGate(({ gate }) => {
      const plan = makePlan({ requestId: `github:issue:367-finding-continuity-${item.name.toLowerCase()}` });
      const registration = registerPlan(gate, plan, `plan-registered-finding-${item.name.toLowerCase()}`);
      const finding = createFinding({
        id: `finding-must-fix-${item.name.toLowerCase()}`,
        severity: 'HIGH',
        disposition: 'MUST_FIX',
        summary: 'the intermediate result must not erase this remediation',
        evidence: [`artifact:finding-${item.name.toLowerCase()}`],
      });
      const changesRequired = gate.handle({
        expectedRevision: registration.revision,
        expectedChainDigest: registration.chainDigest,
        event: makeReviewEvent(plan, plan.obligations[0], registration.reviewRequests[0], {
          eventId: `review-result-finding-required-${item.name.toLowerCase()}`,
          semanticVerdict: 'CHANGES_REQUIRED',
          findings: [finding],
        }),
      });
      assert.strictEqual(changesRequired.decision.accepted, true, `${item.name}: prerequisite`);
      assert.deepStrictEqual(changesRequired.reviewRequests[0].priorFindings, [finding], item.name);
      const intermediate = gate.handle({
        expectedRevision: changesRequired.revision,
        expectedChainDigest: changesRequired.chainDigest,
        event: makeReviewEvent(plan, plan.obligations[0], changesRequired.reviewRequests[0], {
          eventId: `review-result-finding-intermediate-${item.name.toLowerCase()}`,
          executionStatus: item.executionStatus,
          ...(item.semanticVerdict ? { semanticVerdict: item.semanticVerdict } : {}),
          findings: [],
        }),
      });
      assert.strictEqual(intermediate.decision.accepted, true, `${item.name}: intermediate`);
      assert.deepStrictEqual(intermediate.reviewRequests[0].priorFindings, [finding], item.name);
      const forgedRequest = {
        ...intermediate.reviewRequests[0],
        priorFindings: [],
      };
      const forged = gate.handle({
        expectedRevision: intermediate.revision,
        expectedChainDigest: intermediate.chainDigest,
        event: makeReviewEvent(plan, plan.obligations[0], forgedRequest, {
          eventId: `review-result-finding-forged-${item.name.toLowerCase()}`,
          semanticVerdict: 'PASS',
          findings: [],
        }),
      });
      assertRejected(forged, 'FOREIGN_EVIDENCE', `${item.name}: forged request`);
      const remediated = gate.handle({
        expectedRevision: intermediate.revision,
        expectedChainDigest: intermediate.chainDigest,
        event: makeReviewEvent(plan, plan.obligations[0], intermediate.reviewRequests[0], {
          eventId: `review-result-finding-remediated-${item.name.toLowerCase()}`,
          semanticVerdict: 'PASS',
          findings: [],
        }),
      });
      assert.strictEqual(remediated.decision.accepted, true, `${item.name}: remediation`);
      assert.strictEqual(remediated.decision.lifecycleStatus, 'RESOLVED', item.name);
      assert.strictEqual(remediated.decision.semanticVerdict, 'PASS', item.name);
    });
  }
});
test('a trusted authority result from a superseded wave cannot roll the current plan back', () => {
  withGate(({ gate, store }) => {
    const planA = makePlan({
      requestId: 'github:issue:367-late-authority',
      decisionKey: 'late-authority',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registrationA = registerPlan(gate, planA, 'plan-registered-late-authority-a');
    const planB = makePlan({
      requestId: 'github:issue:367-late-authority',
      decisionKey: 'late-authority',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
      diff: { digest: `sha256:${'a'.repeat(64)}`, reference: 'git-diff:late-authority-b' },
    });
    const invalidatedB = gate.handle({
      expectedRevision: registrationA.revision,
      expectedChainDigest: registrationA.chainDigest,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-late-authority-b'),
    });
    assert.strictEqual(invalidatedB.decision.accepted, true);
    const receiptA = makeAuthorityReceipt(planA, { eventId: 'authority-late-wave-a' });
    const lateA = gate.handle({
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
      event: makeAuthorityEvent(planA, {
        receipt: receiptA,
        eventId: 'authority-late-wave-a',
      }),
    });
    assertRejected(lateA, 'STALE_EVIDENCE', 'late superseded-wave authority');
    assertSameHead(store, planA, invalidatedB, 'late authority preserves current head');
    const current = gate.inspect({
      workId: planA.workId,
      waveId: planB.waveId,
      expectedRevision: invalidatedB.revision,
      expectedChainDigest: invalidatedB.chainDigest,
    });
    assert.strictEqual(current.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(current.decision.allowsProgress, false);
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});
test('lane removal is rejected while the removed lane has unresolved MUST_FIX findings', () => {
  withGate(({ gate, store }) => {
    const {
      planA,
      planB,
      security,
      finding,
      securityChanges,
    } = prepareLaneRemoval(gate, 'lane-removal-findings');
    assert.strictEqual(securityChanges.decision.accepted, true);
    assert.deepStrictEqual(requestFor(securityChanges, security).priorFindings, [finding]);
    const rejected = gate.handle({
      expectedRevision: securityChanges.revision,
      expectedChainDigest: securityChanges.chainDigest,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-lane-removal-rejected'),
    });
    assertRejected(rejected, 'UNRESOLVED_MUST_FIX');
    assertSameHead(store, planA, securityChanges, 'unresolved lane removal preserves head');
    const currentA = gate.inspect({
      workId: planA.workId,
      waveId: planA.waveId,
      expectedRevision: securityChanges.revision,
      expectedChainDigest: securityChanges.chainDigest,
    });
    assert.strictEqual(currentA.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(currentA.decision.allowsProgress, false);
    assert.deepStrictEqual(requestFor(currentA, security).priorFindings, [finding]);
  });
});
test('lane removal is accepted after the removed lane completes with its exact finding-bearing request', () => {
  withGate(({ gate }) => {
    const {
      planA,
      planB,
      security,
      securityChanges,
    } = prepareLaneRemoval(gate, 'lane-removal-safe-control');
    const securityPass = gate.handle({
      expectedRevision: securityChanges.revision,
      expectedChainDigest: securityChanges.chainDigest,
      event: makeReviewEvent(planA, security, requestFor(securityChanges, security), {
        eventId: 'review-result-lane-removal-safe-control-security-pass',
        semanticVerdict: 'PASS',
        findings: [],
      }),
    });
    assert.strictEqual(securityPass.decision.accepted, true);
    assert.strictEqual(securityPass.decision.lifecycleStatus, 'RESOLVED');
    const accepted = gate.handle({
      expectedRevision: securityPass.revision,
      expectedChainDigest: securityPass.chainDigest,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-lane-removal-safe-control'),
    });
    assert.strictEqual(accepted.decision.accepted, true);
    assert.strictEqual(accepted.decision.allowsProgress, true);
    assert.strictEqual(accepted.decision.lifecycleStatus, 'RESOLVED');
    assert.deepStrictEqual(accepted.reviewRequests, []);
    assert.strictEqual(accepted.decision.obligations.find(({ lane }) => lane === 'code-reviewer').lifecycleStatus, 'RESOLVED');
  });
});
test('inspect fails closed for a trusted persisted lane removal that bypassed ReviewGate', () => {
  withGate(({ gate, store }) => {
    const { planA, planB, securityChanges } = prepareLaneRemoval(gate, 'replay-lane-removal');
    const appended = store.append({
      expectedRevision: securityChanges.revision,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-replay-lane-removal'),
      receipts: [],
    });
    assert.strictEqual(appended.status, 'APPENDED');
    const inspected = gate.inspect({
      workId: planA.workId,
      waveId: planB.waveId,
      expectedRevision: appended.revision,
      expectedChainDigest: appended.chainDigest,
    });
    assert.strictEqual(inspected.decision.accepted, false);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(inspected.decision.allowsProgress, false);
    assert.ok(inspected.decision.blockingReasons.includes('UNRESOLVED_MUST_FIX'));
  });
});
test('structured command summaries never persist credential values in events or receipts', () => {
  const cases = [
    {
      name: 'token-password-whitespace',
      command: 'node verify --token fake-token-367 --password fake-password-367',
      secrets: ['fake-token-367', 'fake-password-367'],
    },
    {
      name: 'access-secret-whitespace',
      command: 'node verify --access-token fake-access-token-367 --secret-access-key fake-secret-access-key-367',
      secrets: ['fake-access-token-367', 'fake-secret-access-key-367'],
    },
    {
      name: 'access-secret-equals',
      command: 'node verify --access-token=fake-access-token-eq --secret-access-key=fake-secret-access-key-eq',
      secrets: ['fake-access-token-eq', 'fake-secret-access-key-eq'],
    },
    {
      name: 'curl-basic-auth',
      command: 'curl -u user:fake-basic-password-367 https://example.test/health',
      secrets: ['fake-basic-password-367'],
    },
  ];
  for (const item of cases) {
    withGate(({ gate, store }) => {
      const plan = makePlan({ requestId: `github:issue:367-command-redaction-${item.name}` });
      const registration = registerPlan(gate, plan, `plan-registered-command-redaction-${item.name}`);
      const result = gate.handle({
        expectedRevision: registration.revision,
        expectedChainDigest: registration.chainDigest,
        event: makeReviewEvent(plan, plan.obligations[0], registration.reviewRequests[0], {
          eventId: `review-result-command-redaction-${item.name}`,
          semanticVerdict: 'PASS',
          executedCommands: [{ command: item.command, outcome: 'PASS' }],
        }),
      });
      assert.strictEqual(result.decision.accepted, true, item.name);
      assert.strictEqual(result.receipts.length, 1, item.name);
      const history = store.inspect({
        workId: plan.workId,
        expectedRevision: result.revision,
        expectedChainDigest: result.chainDigest,
      });
      const eventCommand = history.events.at(-1).payload.executedCommands[0].command;
      const receiptCommand = history.receipts.at(-1).payload.executedCommands[0].command;
      const persistedEvents = JSON.stringify(history.events);
      const persistedReceipts = JSON.stringify(history.receipts);
      for (const secret of item.secrets) {
        assert.ok(!persistedEvents.includes(secret), `${item.name}: event leaked ${secret}`);
        assert.ok(!persistedReceipts.includes(secret), `${item.name}: receipt leaked ${secret}`);
      }
      assert.notStrictEqual(eventCommand, item.command, `${item.name}: raw event command persisted`);
      assert.notStrictEqual(receiptCommand, item.command, `${item.name}: raw receipt command persisted`);
      assert.ok(/redact|digest|reference|template/i.test(`${eventCommand} ${receiptCommand}`), item.name);
    });
  }
});
test('ReviewGate exposes only constructor, handle, and inspect as public lifecycle methods', () => {
  const { ReviewGate } = require('../scripts/lib/review-gate');
  assert.deepStrictEqual(Object.getOwnPropertyNames(ReviewGate.prototype).sort(), ['constructor', 'handle', 'inspect']);
  for (const forbidden of ['clear', 'markPassed', 'delete', 'rewrite', 'dispatch']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(ReviewGate.prototype, forbidden), false, forbidden);
  }
});
run('review-gate-security');
