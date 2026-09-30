'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  ReviewGate,
} = require('../scripts/lib/review-gate');
const { ReviewGateEvidence } = require('../scripts/lib/review-gate-evidence');
const {
  AUTHORITY_PRODUCER,
  AUTHORITY_TRUST_POLICY,
  EVIDENCE_RECEIPT_SCHEMA,
  NOW,
  makeAuthorityEvent,
  makeAuthorityReceipt,
  makeInputsInvalidatedEvent,
  makePlan,
  makePlanEvent,
  makeReviewEvent,
  recordPasses,
  registerPlan,
  requestFor,
  withGate,
} = require('./_lib/review-gate-fixture');

const authorityTrustPolicy = ({ eventTypes, receiptKinds, lanes } = {}) => Object.freeze({
  producers: Object.freeze(AUTHORITY_TRUST_POLICY.producers.map((entry) => {
    if (entry.producer !== AUTHORITY_PRODUCER.producer) return entry;
    return Object.freeze({
      ...entry,
      ...(eventTypes === undefined ? {} : { eventTypes: Object.freeze([...eventTypes]) }),
      ...(receiptKinds === undefined ? {} : { receiptKinds: Object.freeze([...receiptKinds]) }),
      ...(lanes === undefined ? {} : { lanes: Object.freeze([...lanes]) }),
    });
  })),
});

const currentHead = (store, plan, expected) => store.inspect({
  workId: plan.workId,
  expectedRevision: expected.revision,
  expectedChainDigest: expected.chainDigest,
});

const assertHeadUnchanged = (store, plan, before, label = 'public receipt head') => {
  const after = currentHead(store, plan, before);
  assert.strictEqual(after.revision, before.revision, `${label} revision`);
  assert.strictEqual(after.chainDigest, before.chainDigest, `${label} chain digest`);
  assert.strictEqual(after.events.length, before.events.length, `${label} event count`);
  assert.strictEqual(after.receipts.length, before.receipts.length, `${label} receipt count`);
};

const assertRejected = (result, reason, label = reason) => {
  assert.strictEqual(result.decision.accepted, false, `${label} acceptance`);
  assert.strictEqual(result.decision.allowsProgress, false, `${label} progress`);
  assert.deepStrictEqual(result.decision.blockingReasons, [reason], `${label} reason`);
  assert.deepStrictEqual(result.receipts, [], `${label} receipts`);
};

const appendPersistedAuthority = (store, plan, before, {
  obligation = null,
  eventId,
  receiptOptions = {},
  eventOptions = {},
} = {}) => {
  const receipt = makeAuthorityReceipt(plan, { obligation, eventId, ...receiptOptions });
  const event = makeAuthorityEvent(plan, { obligation, receipt, eventId, ...eventOptions });
  const appended = store.append({
    expectedRevision: before.revision,
    event,
    receipts: [receipt],
  });
  assert.strictEqual(appended.status, 'APPENDED');
  return { event, receipt, appended };
};

const inspectAtHead = (gate, plan, head, waveId = plan.waveId) => gate.inspect({
    workId: plan.workId,
    waveId,
    expectedRevision: head.revision,
    expectedChainDigest: head.chainDigest,
  });

test('ReviewGateEvidence rejects malformed producer policy before the owned store changes', () => {
  withGate(({ store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-malformed-trust-policy' });
    const before = currentHead(store, plan, { revision: 0, chainDigest: null });
    assert.doesNotThrow(() => new ReviewGateEvidence({ trustPolicy: { producers: [] } }));

    const malformedTrustPolicy = { producers: {} };
    assert.throws(
      () => new ReviewGateEvidence({ trustPolicy: malformedTrustPolicy }),
      (error) => error instanceof TypeError
        && error.message === 'Review Gate trustPolicy.producers must be an array',
    );
    assertHeadUnchanged(store, plan, before, 'malformed trust policy leaves the owned store empty');
  });
});

test('inspection rejects authority persisted before its producer event trust was withdrawn', () => {
  withGate(({ gate, store, now }) => {
    const plan = makePlan({ requestId: 'github:issue:743-withdrawn-authority-event-trust' });
    const registration = registerPlan(gate, plan, 'plan-743-withdrawn-authority-event-trust');
    const receipt = makeAuthorityReceipt(plan, { eventId: 'authority-743-withdrawn-event-trust' });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-743-withdrawn-event-trust' });
    const admitted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(admitted.decision.accepted, true, 'the original trust policy admits the authority');
    assert.strictEqual(admitted.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, plan, admitted);
    const withdrawnEventTrust = new ReviewGate({
      receiptStore: store,
      trustPolicy: authorityTrustPolicy({ eventTypes: [] }),
      now,
    });
    const inspected = withdrawnEventTrust.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: beforeInspection.revision,
      expectedChainDigest: beforeInspection.chainDigest,
    });

    assertRejected(inspected, 'UNTRUSTED_PRODUCER', 'withdrawn event-type trust');
    assertHeadUnchanged(store, plan, beforeInspection, 'withdrawn trust does not rewrite history');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('inspection rejects persisted WAVE authority when one required lane is not trusted', () => {
  withGate(({ gate, store, now }) => {
    const plan = makePlan({
      requestId: 'github:issue:743-wave-lane-inspection',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-743-wave-lane-inspection');
    const receipt = makeAuthorityReceipt(plan, { eventId: 'authority-743-wave-lane-inspection' });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-743-wave-lane-inspection' });
    const admitted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(admitted.decision.accepted, true, 'the broad trust policy admits both lanes');
    assert.strictEqual(admitted.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, plan, admitted);
    const codeOnlyTrust = new ReviewGate({
      receiptStore: store,
      trustPolicy: authorityTrustPolicy({ lanes: ['code-reviewer'] }),
      now,
    });
    const inspected = codeOnlyTrust.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: beforeInspection.revision,
      expectedChainDigest: beforeInspection.chainDigest,
    });

    assertRejected(inspected, 'UNTRUSTED_LANE', 'WAVE authority needs every planned lane');
    assertHeadUnchanged(store, plan, beforeInspection, 'lane withdrawal does not rewrite history');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('inspection rejects persisted obligation authority when its target lane is not trusted', () => {
  withGate(({ gate, store, now }) => {
    const plan = makePlan({
      requestId: 'github:issue:743-obligation-lane-inspection',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-743-obligation-lane-inspection');
    const security = plan.obligations.find(({ lane }) => lane === 'security-reviewer');
    const receipt = makeAuthorityReceipt(plan, {
      obligation: security,
      eventId: 'authority-743-obligation-lane-inspection',
    });
    const event = makeAuthorityEvent(plan, {
      obligation: security,
      receipt,
      eventId: 'authority-743-obligation-lane-inspection',
    });
    const admitted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(admitted.decision.accepted, true, 'the broad trust policy admits the obligation');

    const beforeInspection = currentHead(store, plan, admitted);
    const codeOnlyTrust = new ReviewGate({
      receiptStore: store,
      trustPolicy: authorityTrustPolicy({ lanes: ['code-reviewer'] }),
      now,
    });
    const inspected = codeOnlyTrust.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: beforeInspection.revision,
      expectedChainDigest: beforeInspection.chainDigest,
    });

    assertRejected(inspected, 'UNTRUSTED_LANE', 'obligation authority lane trust');
    assertHeadUnchanged(store, plan, beforeInspection, 'obligation lane withdrawal does not rewrite history');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('obligation authority is rejected when its exact lane is outside producer trust', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({
      requestId: 'github:issue:743-obligation-lane-trust',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-743-obligation-lane-trust');
    const code = plan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const security = plan.obligations.find(({ lane }) => lane === 'security-reviewer');
    const codeReceipt = makeAuthorityReceipt(plan, {
      obligation: code,
      eventId: 'authority-743-authorized-code-lane',
    });
    const codeAuthority = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeAuthorityEvent(plan, {
        obligation: code,
        receipt: codeReceipt,
        eventId: 'authority-743-authorized-code-lane',
      }),
    });
    assert.strictEqual(codeAuthority.decision.accepted, true, 'the trusted code lane is the positive control');

    const beforeRejection = currentHead(store, plan, codeAuthority);
    const securityReceipt = makeAuthorityReceipt(plan, {
      obligation: security,
      eventId: 'authority-743-untrusted-security-lane',
    });
    const rejected = gate.handle({
      expectedRevision: beforeRejection.revision,
      expectedChainDigest: beforeRejection.chainDigest,
      event: makeAuthorityEvent(plan, {
        obligation: security,
        receipt: securityReceipt,
        eventId: 'authority-743-untrusted-security-lane',
      }),
    });

    assertRejected(rejected, 'UNTRUSTED_LANE', 'untrusted obligation lane');
    assertHeadUnchanged(store, plan, beforeRejection, 'untrusted obligation authority');
  }, { trustPolicy: authorityTrustPolicy({ lanes: ['code-reviewer'] }) });
});

test('authority receipt trust is checked independently from authority event trust', () => {
  withGate(({ gate, store, now }) => {
    const plan = makePlan({ requestId: 'github:issue:743-authority-receipt-kind-trust' });
    const registration = registerPlan(gate, plan, 'plan-743-authority-receipt-kind-trust');
    const receipt = makeAuthorityReceipt(plan, { eventId: 'authority-743-receipt-kind-trust' });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-743-receipt-kind-trust' });
    const admitted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(admitted.decision.accepted, true, 'event and receipt are trusted by the positive policy');

    const beforeRejection = currentHead(store, plan, admitted);
    const eventTrustedWithoutAuthorityReceiptKind = new ReviewGate({
      receiptStore: store,
      trustPolicy: authorityTrustPolicy({ receiptKinds: [] }),
      now,
    });
    const rejected = eventTrustedWithoutAuthorityReceiptKind.handle({
      expectedRevision: beforeRejection.revision,
      expectedChainDigest: beforeRejection.chainDigest,
      event,
    });

    assertRejected(rejected, 'UNTRUSTED_PRODUCER', 'untrusted authority receipt kind');
    assertHeadUnchanged(store, plan, beforeRejection, 'receipt trust denial');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('authority receipt schema mutation is rejected without a second append', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-authority-schema' });
    const registration = registerPlan(gate, plan, 'plan-743-authority-schema');
    const receipt = makeAuthorityReceipt(plan, { eventId: 'authority-743-schema' });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-743-schema' });
    const accepted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(accepted.decision.accepted, true, 'the valid authority receipt is the positive control');

    const beforeRejection = currentHead(store, plan, accepted);
    const malformedReceipt = { ...receipt, schema: `${EVIDENCE_RECEIPT_SCHEMA}.unsupported` };
    const rejected = gate.handle({
      expectedRevision: beforeRejection.revision,
      expectedChainDigest: beforeRejection.chainDigest,
      event: { ...event, payload: { receipt: malformedReceipt } },
    });

    assertRejected(rejected, 'UNSUPPORTED_SCHEMA', 'unsupported authority schema');
    assertHeadUnchanged(store, plan, beforeRejection, 'unsupported schema');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('authority obligation receipt must supply lane and obligation ID together', () => {
  for (const missingField of ['lane', 'obligationId']) {
    withGate(({ gate, store }) => {
      const plan = makePlan({ requestId: `github:issue:743-authority-pair-${missingField}` });
      const obligation = plan.obligations[0];
      const registration = registerPlan(gate, plan, `plan-743-authority-pair-${missingField}`);
      const receipt = makeAuthorityReceipt(plan, {
        obligation,
        eventId: `authority-743-pair-${missingField}`,
      });
      const event = makeAuthorityEvent(plan, {
        obligation,
        receipt,
        eventId: `authority-743-pair-${missingField}`,
      });
      const accepted = gate.handle({
        expectedRevision: registration.revision,
        expectedChainDigest: registration.chainDigest,
        event,
      });
      assert.strictEqual(accepted.decision.accepted, true, `${missingField} variant positive control`);

      const beforeRejection = currentHead(store, plan, accepted);
      const incompleteReceipt = { ...receipt };
      delete incompleteReceipt[missingField];
      const rejected = gate.handle({
        expectedRevision: beforeRejection.revision,
        expectedChainDigest: beforeRejection.chainDigest,
        event: { ...event, payload: { receipt: incompleteReceipt } },
      });

      assertRejected(rejected, 'MALFORMED_EVIDENCE', `missing authority ${missingField}`);
      assertHeadUnchanged(store, plan, beforeRejection, `missing authority ${missingField}`);
    }, { trustPolicy: AUTHORITY_TRUST_POLICY });
  }
});

test('authority expiring exactly at the trusted clock is rejected without appending', () => {
  const submit = (expiresAt, expectRejection) => withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-authority-equality-expiry' });
    const registration = registerPlan(gate, plan, 'plan-743-authority-equality-expiry');
    const receipt = makeAuthorityReceipt(plan, {
      eventId: 'authority-743-equality-expiry',
      issuedAt: '2026-09-06T03:00:00.000Z',
      expiresAt,
    });
    const event = makeAuthorityEvent(plan, { receipt, eventId: 'authority-743-equality-expiry' });
    const before = currentHead(store, plan, registration);
    const result = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    if (expectRejection) {
      assertRejected(result, 'OVERRIDE_EXPIRED', 'expiry equals the trusted clock');
      assertHeadUnchanged(store, plan, before, 'expiry equality');
    } else {
      assert.strictEqual(result.decision.accepted, true, 'one second of remaining validity is accepted');
    }
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });

  submit('2026-09-06T04:00:01.000Z', false);
  submit(NOW, true);
});

test('authority without a preceding plan is rejected by handle and by inspection of imported history', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-authority-before-plan' });
    const eventId = 'authority-743-before-plan';
    const receipt = makeAuthorityReceipt(plan, { eventId });
    const event = makeAuthorityEvent(plan, { receipt, eventId });
    const emptyHead = currentHead(store, plan, { revision: 0, chainDigest: null });
    const rejectedHandle = gate.handle({
      expectedRevision: emptyHead.revision,
      expectedChainDigest: emptyHead.chainDigest,
      event,
    });
    assertRejected(rejectedHandle, 'MISSING_PLAN', 'authority handle before plan');
    assertHeadUnchanged(store, plan, emptyHead, 'authority handle before plan');

    // Public store appends model a persisted import whose authority predates its plan.
    const authorityAppend = store.append({ expectedRevision: 0, event, receipts: [receipt] });
    const planAppend = store.append({
      expectedRevision: authorityAppend.revision,
      event: makePlanEvent(plan, 'plan-743-after-authority'),
      receipts: [],
    });
    assert.strictEqual(planAppend.status, 'APPENDED');
    const importedHead = currentHead(store, plan, planAppend);
    const inspected = gate.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: importedHead.revision,
      expectedChainDigest: importedHead.chainDigest,
    });
    assertRejected(inspected, 'MISSING_PLAN', 'imported authority has no preceding plan');
    assertHeadUnchanged(store, plan, importedHead, 'invalid imported history is not rewritten');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('an exact duplicate INPUTS_INVALIDATED retry reuses the stored revision and receipts', () => {
  withGate(({ gate, store }) => {
    const requestId = 'github:issue:743-duplicate-invalidation';
    const decisionKey = 'issue-743-duplicate-invalidation';
    const planA = makePlan({ requestId, decisionKey });
    const registration = registerPlan(gate, planA, 'plan-743-before-invalidation');
    const planB = makePlan({
      requestId,
      decisionKey,
      diff: { digest: `sha256:${'b'.repeat(64)}`, reference: 'git-diff:issue-743-retry' },
    });
    const invalidation = makeInputsInvalidatedEvent(planB, 'inputs-invalidated-743-exact-retry');
    const first = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: invalidation,
    });
    assert.strictEqual(first.decision.accepted, true, 'the first invalidation is accepted');
    const beforeRetry = currentHead(store, planB, first);
    const retried = gate.handle({
      expectedRevision: beforeRetry.revision,
      expectedChainDigest: beforeRetry.chainDigest,
      event: invalidation,
    });

    assert.strictEqual(retried.decision.accepted, true, 'an exact retry remains accepted');
    assert.deepStrictEqual(retried.receipts, [], 'an exact retry creates no new receipt');
    assert.strictEqual(retried.revision, beforeRetry.revision);
    assert.strictEqual(retried.chainDigest, beforeRetry.chainDigest);
    assertHeadUnchanged(store, planB, beforeRetry, 'exact invalidation retry');
  });
});

test('later wave PASS results do not resolve an explicitly inspected earlier wave', () => {
  withGate(({ gate, store }) => {
    const requestId = 'github:issue:743-earlier-wave-inspection';
    const decisionKey = 'issue-743-earlier-wave-inspection';
    const planA = makePlan({ requestId, decisionKey });
    const registration = registerPlan(gate, planA, 'plan-743-wave-a');
    const planB = makePlan({
      requestId,
      decisionKey,
      diff: { digest: `sha256:${'c'.repeat(64)}`, reference: 'git-diff:issue-743-wave-b' },
    });
    const invalidated = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeInputsInvalidatedEvent(planB, 'inputs-invalidated-743-wave-b'),
    });
    assert.strictEqual(invalidated.decision.accepted, true);
    const laterPasses = recordPasses(gate, planB, invalidated, 'review-743-wave-b-pass');
    assert.strictEqual(laterPasses.decision.accepted, true, 'the later-wave PASS is a valid positive control');
    assert.strictEqual(laterPasses.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, planA, laterPasses);
    const earlier = gate.inspect({
      workId: planA.workId,
      waveId: planA.waveId,
      expectedRevision: beforeInspection.revision,
      expectedChainDigest: beforeInspection.chainDigest,
    });
    assert.strictEqual(earlier.decision.accepted, true);
    assert.strictEqual(earlier.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(earlier.decision.allowsProgress, false);
    assert.strictEqual(earlier.waveId, planA.waveId);
    assertHeadUnchanged(store, planA, beforeInspection, 'earlier-wave inspection');
  });
});

test('a persisted future-issued authority stays pending and does not advance its head', () => {
  const inspectAuthority = (issuedAt, expectPending) => withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-future-inspection-time' });
    const registration = registerPlan(gate, plan, 'plan-743-future-inspection-time');
    const { appended } = appendPersistedAuthority(store, plan, registration, {
      eventId: 'authority-743-future-inspection-time',
      receiptOptions: { issuedAt, expiresAt: '2026-09-06T06:00:00.000Z' },
    });
    const head = currentHead(store, plan, appended);
    const inspected = inspectAtHead(gate, plan, head);
    if (expectPending) {
      assert.strictEqual(inspected.decision.accepted, true);
      assert.strictEqual(inspected.decision.lifecycleStatus, 'PENDING');
      assert.strictEqual(inspected.decision.allowsProgress, false);
      assert.ok(inspected.decision.blockingReasons.includes('OVERRIDE_NOT_ACTIVE'));
      assertHeadUnchanged(store, plan, head, 'future persisted authority');
    } else {
      assert.strictEqual(inspected.decision.accepted, true, 'the active persisted receipt is accepted');
      assert.strictEqual(inspected.decision.lifecycleStatus, 'RESOLVED');
      assert.strictEqual(inspected.decision.allowsProgress, true);
    }
    return inspected;
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });

  inspectAuthority(NOW, false);
  inspectAuthority('2026-09-06T05:00:00.000Z', true);
});

test('inspection expires a persisted authority exactly when its injected clock reaches expiry', () => {
  withGate(({ gate, store, setNow }) => {
    const plan = makePlan({ requestId: 'github:issue:743-expiry-inspection-boundary' });
    const registration = registerPlan(gate, plan, 'plan-743-expiry-inspection-boundary');
    const expiresAt = '2026-09-06T04:00:01.000Z';
    const persisted = appendPersistedAuthority(store, plan, registration, {
      eventId: 'authority-743-expiry-inspection-boundary',
      receiptOptions: { issuedAt: '2026-09-06T03:00:00.000Z', expiresAt },
    });
    const storedHead = currentHead(store, plan, persisted.appended);
    const beforeExpiry = inspectAtHead(gate, plan, storedHead);
    assert.strictEqual(beforeExpiry.decision.accepted, true);
    assert.strictEqual(beforeExpiry.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(beforeExpiry.decision.allowsProgress, true);

    setNow(expiresAt);
    const atExpiry = inspectAtHead(gate, plan, storedHead);
    assert.strictEqual(atExpiry.decision.accepted, true);
    assert.strictEqual(atExpiry.decision.lifecycleStatus, 'PENDING');
    assert.strictEqual(atExpiry.decision.allowsProgress, false);
    assert.ok(atExpiry.decision.blockingReasons.includes('OVERRIDE_EXPIRED'));
    assertHeadUnchanged(store, plan, storedHead, 'inspection-time expiry');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('an active WAVE override supersedes an expired obligation authority during inspection', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({
      requestId: 'github:issue:743-expired-obligation-wave-override',
      materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'],
    });
    const registration = registerPlan(gate, plan, 'plan-743-expired-obligation-wave-override');
    const obligation = plan.obligations[0];
    const expired = appendPersistedAuthority(store, plan, registration, {
      obligation,
      eventId: 'authority-743-expired-obligation-before-wave',
      receiptOptions: {
        issuedAt: '2026-09-06T02:00:00.000Z',
        expiresAt: '2026-09-06T03:00:00.000Z',
      },
    });
    const waveReceipt = makeAuthorityReceipt(plan, {
      eventId: 'authority-743-active-wave-after-expired-obligation',
    });
    const activeWave = gate.handle({
      expectedRevision: expired.appended.revision,
      expectedChainDigest: expired.appended.chainDigest,
      event: makeAuthorityEvent(plan, {
        receipt: waveReceipt,
        eventId: 'authority-743-active-wave-after-expired-obligation',
      }),
    });
    assert.strictEqual(activeWave.decision.accepted, true);
    assert.strictEqual(activeWave.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, plan, activeWave);
    const inspected = inspectAtHead(gate, plan, beforeInspection);
    assert.strictEqual(inspected.decision.accepted, true);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(inspected.decision.allowsProgress, true);
    assert.deepStrictEqual(inspected.decision.blockingReasons, []);
    assertHeadUnchanged(store, plan, beforeInspection, 'superseded expired obligation authority');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('an active obligation override supersedes its expired historical override', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-active-obligation-supersedes-expired' });
    const registration = registerPlan(gate, plan, 'plan-743-active-obligation-supersedes-expired');
    const obligation = plan.obligations[0];
    const expired = appendPersistedAuthority(store, plan, registration, {
      obligation,
      eventId: 'authority-743-expired-obligation-history',
      receiptOptions: {
        issuedAt: '2026-09-06T02:00:00.000Z',
        expiresAt: '2026-09-06T03:00:00.000Z',
      },
    });
    const activeReceipt = makeAuthorityReceipt(plan, {
      obligation,
      eventId: 'authority-743-active-obligation-replacement',
      issuedAt: NOW,
      expiresAt: '2026-09-06T05:00:00.000Z',
    });
    const active = gate.handle({
      expectedRevision: expired.appended.revision,
      expectedChainDigest: expired.appended.chainDigest,
      event: makeAuthorityEvent(plan, {
        obligation,
        receipt: activeReceipt,
        eventId: 'authority-743-active-obligation-replacement',
      }),
    });
    assert.strictEqual(active.decision.accepted, true);
    assert.strictEqual(active.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, plan, active);
    const inspected = inspectAtHead(gate, plan, beforeInspection);
    assert.strictEqual(inspected.decision.accepted, true);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(inspected.decision.allowsProgress, true);
    assert.deepStrictEqual(inspected.decision.blockingReasons, []);
    assertHeadUnchanged(store, plan, beforeInspection, 'active obligation replaces expired authority');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

test('an exact PASS resolves its obligation despite an expired persisted override', () => {
  withGate(({ gate, store }) => {
    const plan = makePlan({ requestId: 'github:issue:743-resolved-obligation-expired-authority' });
    const registration = registerPlan(gate, plan, 'plan-743-resolved-obligation-expired-authority');
    const obligation = plan.obligations[0];
    const expired = appendPersistedAuthority(store, plan, registration, {
      obligation,
      eventId: 'authority-743-expired-before-obligation-pass',
      receiptOptions: {
        issuedAt: '2026-09-06T02:00:00.000Z',
        expiresAt: '2026-09-06T03:00:00.000Z',
      },
    });
    const pass = gate.handle({
      expectedRevision: expired.appended.revision,
      expectedChainDigest: expired.appended.chainDigest,
      event: makeReviewEvent(plan, obligation, requestFor(registration, obligation), {
        eventId: 'review-743-exact-pass-after-expired-authority',
        semanticVerdict: 'PASS',
      }),
    });
    assert.strictEqual(pass.decision.accepted, true, 'the exact obligation PASS remains accepted');
    assert.strictEqual(pass.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(pass.decision.allowsProgress, true);

    const beforeInspection = currentHead(store, plan, pass);
    const inspected = inspectAtHead(gate, plan, beforeInspection);
    assert.strictEqual(inspected.decision.accepted, true);
    assert.strictEqual(inspected.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(inspected.decision.allowsProgress, true);
    assert.deepStrictEqual(inspected.decision.blockingReasons, []);
    assertHeadUnchanged(store, plan, beforeInspection, 'resolved obligation with expired authority');
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

run('review-gate-authority-residual-security');
