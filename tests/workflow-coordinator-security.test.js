'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { WorkflowCoordinator } = require('../scripts/lib/workflow-coordinator');
const { WorkflowCoordinatorEvidence } = require('../scripts/lib/workflow-coordinator-evidence');
const {
  clone,
  coordinator,
  latestDecision,
  makeAuthorityReceipt,
  makeFreshnessReceipt,
  receipt,
  receiptsForHistory,
  reduce,
  withAuthorityTrustPolicy,
} = require('./_lib/workflow-coordinator-fixture');

const SECRET = 'hostile-secret-must-not-echo';

function assertBlocked(result, reasonCode) {
  assert.strictEqual(result.schema, 'dhpk.workflow-projection.v1');
  assert.strictEqual(result.evidenceAccepted, false);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.deepStrictEqual(result.condition, {
    type: 'BLOCKED',
    resumeState: 'EVIDENCE_PENDING',
    reasonCodes: [reasonCode],
  });
  assert.strictEqual(result.control.authority, 'SENTINEL');
  assert.strictEqual(result.control.allowsTargetProgress, false);
  assert.strictEqual(JSON.stringify(result).includes(SECRET), false);
}

function assertPending(result, refreshLanes) {
  assert.strictEqual(result.evidenceAccepted, true);
  assert.strictEqual(result.state, 'EVIDENCE_PENDING');
  assert.strictEqual(result.condition, null);
  assert.deepStrictEqual(result.refreshLanes, refreshLanes);
  assert.strictEqual(result.control.allowsTargetProgress, false);
}

function decisions(receipts) {
  return receipts.filter(({ kind }) => kind === 'decision');
}

function mutateAllDecisions(receipts, mutator) {
  decisions(receipts).forEach(mutator);
  return receipts;
}

function receiptById(receipts, receiptId) {
  const found = receipts.find((candidate) => candidate.receiptId === receiptId);
  if (!found) throw new Error(`Receipt not present in scenario: ${receiptId}`);
  return found;
}

for (const [label, mutate, reasonCode] of [
  [
    'unsupported envelope schema',
    (receipts) => { receipts[0].schema = 'dhpk.review-gate.evidence-receipt.v2'; },
    'UNSUPPORTED_SCHEMA',
  ],
  [
    'unsupported decision payload schema',
    (receipts) => { receipts[0].payload.schema = 'dhpk.workflow.decision.v2'; },
    'UNSUPPORTED_SCHEMA',
  ],
  [
    'unsupported receipt kind',
    (receipts) => { receipts[0].kind = 'unsupported-kind'; },
    'UNSUPPORTED_KIND',
  ],
]) {
  test(`fails closed for ${label}`, () => {
    const receipts = receiptsForHistory('merge-ready');
    mutate(receipts);
    assertBlocked(reduce(receipts), reasonCode);
  });
}

for (const [label, mutate] of [
  ['foreign producer', (receiptToMutate) => { receiptToMutate.producer = 'foreign-producer'; }],
  ['foreign adapter', (receiptToMutate) => { receiptToMutate.adapter = 'foreign-adapter'; }],
  ['producer and kind combination not trusted', (receiptToMutate) => {
    receiptToMutate.kind = 'authority';
  }],
]) {
  test(`fails closed for ${label}`, () => {
    const receipts = receiptsForHistory('merge-ready');
    mutate(receipts[0]);
    const trustPolicy = label === 'producer and kind combination not trusted'
      ? {
        producers: [{
          producer: 'fixture-workflow',
          adapter: 'fixture-adapter',
          receiptKinds: ['decision', 'review', 'verification'],
        }],
      }
      : undefined;
    assertBlocked(reduce(receipts, trustPolicy ? { trustPolicy } : {}), 'UNTRUSTED_PRODUCER');
  });
}

test('fails closed for invalid timestamps', () => {
  const receipts = receiptsForHistory('merge-ready');
  receipts[0].recordedAt = 'not-a-timestamp';
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

for (const [field, value, reasonCode] of [
  ['workId', 'foreign-work', 'MIXED_IDENTITY'],
  ['waveId', 'foreign-wave', 'MIXED_IDENTITY'],
  ['planId', 'foreign-plan', 'MIXED_IDENTITY'],
  ['decisionId', 'foreign-decision', 'MIXED_IDENTITY'],
]) {
  test(`fails closed for foreign ${field} binding`, () => {
    const receipts = receiptsForHistory('merge-ready');
    const candidate = receipts[receipts.length - 1];
    candidate[field] = value;
    assertBlocked(reduce(receipts), reasonCode);
  });
}

for (const [field, value] of [
  ['sourceCommit', '5555555555555555555555555555555555555555'],
  ['sourceTree', '6666666666666666666666666666666666666666'],
  ['policyVersion', 'dhpk.risk-policy.foreign.v1'],
  ['contractVersion', 'dhpk.reviewer-contract.foreign.v2'],
]) {
  test(`fails closed for foreign ${field} binding`, () => {
    const receipts = receiptsForHistory('merge-ready');
    receiptById(receipts, 'receipt-local-gate-pass')[field] = value;
    assertBlocked(reduce(receipts), 'STALE_EVIDENCE');
  });
}

test('fails closed for conflicting duplicate receipt IDs', () => {
  const receipts = receiptsForHistory('merge-ready');
  const conflicting = clone(receipts[0]);
  conflicting.payload.fact = 'DECISION_REQUIRED';
  assertBlocked(reduce([...receipts, conflicting]), 'CONFLICTING_DUPLICATE_RECEIPT');
});

test('rejects sparse receipt arrays without invoking hidden values', () => {
  const receipts = receiptsForHistory('merge-ready');
  delete receipts[0];
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects accessor-backed receipt fields without invoking the getter', () => {
  const receipts = receiptsForHistory('merge-ready');
  let invoked = false;
  Object.defineProperty(receipts[0], 'producer', {
    enumerable: true,
    configurable: true,
    get() {
      invoked = true;
      return SECRET;
    },
  });

  const result = reduce(receipts);

  assertBlocked(result, 'MALFORMED_RECEIPT');
  assert.strictEqual(invoked, false);
});

test('rejects non-plain receipt prototypes without echoing hostile values', () => {
  const receipts = receiptsForHistory('merge-ready');
  Object.setPrototypeOf(receipts[0], { hostile: SECRET });
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects symbol-bearing receipts without echoing symbol values', () => {
  const receipts = receiptsForHistory('merge-ready');
  receipts[0][Symbol(SECRET)] = SECRET;
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects cyclic evidence without traversing forever or echoing the cycle', () => {
  const receipts = receiptsForHistory('merge-ready');
  receipts[0].payload.cycle = receipts[0];
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects excessive evidence depth without echoing the deepest value', () => {
  const receipts = receiptsForHistory('merge-ready');
  let cursor = receipts[0].payload;
  for (let index = 0; index < 16; index += 1) {
    cursor.next = { marker: index === 15 ? SECRET : `depth-${index}` };
    cursor = cursor.next;
  }
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects excessive evidence count without echoing hostile values', () => {
  const receipts = receiptsForHistory('merge-ready');
  for (let index = 0; index < 205; index += 1) receipts[0].payload[`extra-${index}`] = index;
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects excessive strings without echoing their contents', () => {
  const receipts = receiptsForHistory('merge-ready');
  receipts[0].receiptId = `${SECRET}-${'x'.repeat(5000)}`;
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('rejects forbidden sensitive keys without echoing their values', () => {
  const receipts = receiptsForHistory('merge-ready');
  receipts[0].payload.authorization = SECRET;
  assertBlocked(reduce(receipts), 'SENSITIVE_EVIDENCE');
});

for (const [label, mutate] of [
  ['obligation identity', (review) => {
    review.obligationId = 'obligation-foreign';
    review.payload.obligationId = 'obligation-foreign';
  }],
  ['lane identity', (review) => {
    review.lane = 'foreign-reviewer';
    review.payload.lane = 'foreign-reviewer';
  }],
  ['scope digest', (review) => {
    review.payload.scopeDigest = 'sha256:abababababababababababababababababababababababababababababababab';
  }],
  ['base identity', (review) => {
    review.payload.baseIdentity = {
      commit: '5555555555555555555555555555555555555555',
      tree: '6666666666666666666666666666666666666666',
    };
  }],
  ['head identity', (review) => {
    review.payload.headIdentity = {
      commit: '5555555555555555555555555555555555555555',
      tree: '6666666666666666666666666666666666666666',
    };
  }],
  ['diff digest', (review) => {
    review.payload.diff.digest = 'sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
  }],
  ['material risk set', (review) => {
    review.payload.materialRisks = ['UNDECLARED_RISK'];
  }],
  ['material risk hash', (review) => {
    review.payload.materialRisksHash = 'sha256:abababababababababababababababababababababababababababababababab';
  }],
  ['governing input set', (review) => {
    review.payload.governingInputs = [{
      reference: 'docs/adr/foreign-input.md',
      digest: 'sha256:abababababababababababababababababababababababababababababababab',
    }];
  }],
  ['governing inputs hash', (review) => {
    review.payload.governingInputsHash = 'sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef';
  }],
  ['policy version', (review) => {
    review.payload.policyVersion = 'dhpk.risk-policy.foreign.v1';
  }],
  ['contract version', (review) => {
    review.payload.contractVersion = 'dhpk.reviewer-contract.foreign.v2';
  }],
]) {
  test(`rejects review ${label} that is not bound to the decision snapshot`, () => {
    const receipts = receiptsForHistory('merge-ready');
    mutate(receiptById(receipts, 'receipt-review-pass'));
    assertBlocked(reduce(receipts), 'DECISION_BINDING_MISMATCH');
  });
}

for (const [label, mutate] of [
  ['verification ID', (verification) => { verification.payload.verificationId = 'verification-foreign'; }],
  ['verification type', (verification) => { verification.payload.evidenceType = 'IMPLEMENTATION'; }],
  ['verification lane', (verification) => { verification.payload.lane = 'foreign-unit'; }],
]) {
  test(`rejects LOCAL_GATE evidence with undeclared ${label}`, () => {
    const receipts = receiptsForHistory('merge-ready');
    mutate(receiptById(receipts, 'receipt-local-gate-pass'));
    assertBlocked(reduce(receipts), 'VERIFICATION_BINDING_MISMATCH');
  });
}

test('duplicate required review obligation IDs fail closed instead of collapsing lanes', () => {
  const receipts = receiptsForHistory('ready');
  const decision = latestDecision(receipts);
  decision.payload.requiredReviews.push({
    obligationId: 'obligation-code-review',
    lane: 'security-reviewer',
  });

  assertBlocked(reduce(receipts), 'DUPLICATE_REQUIREMENT');
});

test('duplicate required verification IDs fail closed instead of collapsing types', () => {
  const receipts = receiptsForHistory('ready');
  const decision = latestDecision(receipts);
  decision.payload.requiredVerifications.push({
    verificationId: 'verification-local-gate',
    evidenceType: 'IMPLEMENTATION',
    lane: 'implementation',
  });

  assertBlocked(reduce(receipts), 'DUPLICATE_REQUIREMENT');
});

for (const scenario of [
  {
    label: 'IMPLEMENTATION with PASS outcome',
    receiptId: 'receipt-implementation-complete',
    mutate: (verification) => { verification.outcome = 'PASS'; },
  },
  {
    label: 'IMPLEMENTATION without an owner',
    receiptId: 'receipt-implementation-complete',
    mutate: (verification) => { delete verification.owner; },
  },
  {
    label: 'LOCAL_GATE with STARTED outcome',
    receiptId: 'receipt-local-gate-pass',
    mutate: (verification) => { verification.outcome = 'STARTED'; },
  },
  {
    label: 'LOCAL_GATE with COMPLETE outcome',
    receiptId: 'receipt-local-gate-pass',
    mutate: (verification) => { verification.outcome = 'COMPLETE'; },
  },
  {
    label: 'FRESHNESS with PASS outcome',
    receiptId: 'receipt-freshness-review-expired',
    build: () => [
      ...receiptsForHistory('merge-ready'),
      makeFreshnessReceipt({ outcome: 'PASS' }),
    ],
    mutate: (verification) => {},
  },
  {
    label: 'FRESHNESS with COMPLETE outcome',
    receiptId: 'receipt-freshness-review-expired',
    build: () => [
      ...receiptsForHistory('merge-ready'),
      makeFreshnessReceipt({ outcome: 'COMPLETE' }),
    ],
    mutate: (verification) => {},
  },
]) {
  test(`rejects discriminated verification ${scenario.label}`, () => {
    const receipts = scenario.build ? scenario.build() : receiptsForHistory('merge-ready');
    scenario.mutate(receiptById(receipts, scenario.receiptId).payload);
    assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
  });
}

test('decision requiredVerifications cannot declare FRESHNESS as a required gate', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.requiredVerifications.push({
      verificationId: 'verification-freshness-code-review',
      evidenceType: 'FRESHNESS',
      lane: 'code-reviewer',
    });
  });

  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

test('authority receipts reject extra payload fields outside the ReviewGate shape', () => {
  const authority = makeAuthorityReceipt();
  authority.payload.unrecognizedField = 'must-not-be-accepted';

  assertBlocked(
    reduce(
      [...receiptsForHistory('merge-ready'), authority],
      { trustPolicy: withAuthorityTrustPolicy() },
    ),
    'MALFORMED_RECEIPT',
  );
});

test('implementation evidence owner must equal the decision implementation owner', () => {
  const receipts = receiptsForHistory('merge-ready');
  receiptById(receipts, 'receipt-implementation-complete').payload.owner = 'worker:foreign';
  assertBlocked(reduce(receipts), 'IMPLEMENTATION_OWNER_MISMATCH');
});

test('decision chain keeps one judgment owner across snapshots', () => {
  const receipts = receiptsForHistory('merge-ready');
  latestDecision(receipts).payload.ownership.judgmentOwner = 'architect:foreign';
  assertBlocked(reduce(receipts), 'OWNERSHIP_CHAIN_CONFLICT');
});

test('decision chain keeps one implementation owner across the wave', () => {
  const receipts = receiptsForHistory('merge-ready');
  latestDecision(receipts).payload.ownership.implementationOwner = 'worker:foreign';
  assertBlocked(reduce(receipts), 'OWNERSHIP_CHAIN_CONFLICT');
});

test('routing assistants are limited to planner, reasoner, and tdd-guide roles', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.routing.assistants[0].role = 'reviewer';
  });
  assertBlocked(reduce(receipts), 'ROUTING_ROLE_INVALID');
});

test('routing reasonSignals must be a subset of material risks', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.routing.assistants[0].reasonSignals = ['UNDECLARED_RISK'];
  });
  assertBlocked(reduce(receipts), 'ROUTING_REASON_SIGNAL_MISMATCH');
});

test('multiple writers require MULTI_WRITER material risk and disjoint paths', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.routing.writers = [
      { owner: 'worker:368', paths: ['scripts/lib/a.js'] },
      { owner: 'worker:369', paths: ['scripts/lib/b.js'] },
    ];
  });
  assertBlocked(reduce(receipts), 'MULTI_WRITER_REQUIRED');
});

test('multiple writers with overlapping paths fail closed', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.materialRisks = [...decision.payload.materialRisks, 'MULTI_WRITER'];
    decision.payload.routing.writers = [
      { owner: 'worker:368', paths: ['scripts/lib/shared.js'] },
      { owner: 'worker:369', paths: ['scripts/lib/shared.js'] },
    ];
  });
  assertBlocked(reduce(receipts), 'WRITER_PATH_OVERLAP');
});

test('multiple writers require one reconciliation owner', () => {
  const receipts = receiptsForHistory('merge-ready');
  mutateAllDecisions(receipts, (decision) => {
    decision.payload.materialRisks = [...decision.payload.materialRisks, 'MULTI_WRITER'];
    decision.payload.routing.writers = [
      { owner: 'worker:368', paths: ['scripts/lib/a.js'] },
      { owner: 'worker:369', paths: ['scripts/lib/b.js'] },
    ];
    decision.payload.routing.reconciliationOwner = null;
  });
  assertBlocked(reduce(receipts), 'RECONCILIATION_OWNER_REQUIRED');
});

test('CI evidence is not an allowed verification lane for issue 368', () => {
  const receipts = receiptsForHistory('merge-ready');
  receiptById(receipts, 'receipt-local-gate-pass').payload.evidenceType = 'CI';
  assertBlocked(reduce(receipts), 'UNSUPPORTED_EVIDENCE_TYPE');
});

test('NOT_APPLICABLE is not a required review PASS', () => {
  const receipts = receiptsForHistory('merge-ready');
  const review = receiptById(receipts, 'receipt-review-pass');
  review.payload.applicability = 'NOT_APPLICABLE';
  delete review.payload.semanticVerdict;
  assertPending(reduce(receipts), ['code-reviewer']);
});

test('a PASS review with an unresolved MUST_FIX finding fails closed', () => {
  const receipts = receiptsForHistory('merge-ready');
  receiptById(receipts, 'receipt-review-pass').payload.findings = [{
    id: 'finding-unresolved',
    severity: 'HIGH',
    disposition: 'MUST_FIX',
    summary: 'the required fix is unresolved',
    evidence: ['artifact:finding-unresolved'],
  }];
  assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
});

for (const scenario of [
  {
    label: 'HIGH finding with NOTE disposition',
    finding: {
      id: 'finding-high-note',
      severity: 'HIGH',
      disposition: 'NOTE',
      summary: 'a high finding cannot be a note under PASS',
      evidence: ['artifact:finding-high-note'],
    },
  },
  {
    label: 'CRITICAL finding with FOLLOW_UP disposition',
    finding: {
      id: 'finding-critical-follow-up',
      severity: 'CRITICAL',
      disposition: 'FOLLOW_UP',
      summary: 'a critical finding cannot be deferred under PASS',
      evidence: ['artifact:finding-critical-follow-up'],
    },
  },
  {
    label: 'finding without a disposition',
    finding: {
      id: 'finding-missing-disposition',
      severity: 'HIGH',
      summary: 'every finding needs an explicit disposition',
      evidence: ['artifact:finding-missing-disposition'],
    },
  },
  {
    label: 'non-record finding element',
    finding: 'not-a-finding-record',
  },
]) {
  test(`PASS review rejects ${scenario.label}`, () => {
    const receipts = receiptsForHistory('merge-ready');
    receiptById(receipts, 'receipt-review-pass').payload.findings = [scenario.finding];
    assertBlocked(reduce(receipts), 'MALFORMED_RECEIPT');
  });
}

test('the positive fixture keeps MERGE_READY with meaningful ReviewGate evidence', () => {
  const result = reduce(receiptsForHistory('merge-ready'));
  assert.strictEqual(result.evidenceAccepted, true);
  assert.strictEqual(result.state, 'MERGE_READY');
});

for (const scenario of [
  {
    label: 'an empty inspectedScope',
    mutate: (payload) => { payload.inspectedScope = []; },
    reasonCode: 'DECISION_BINDING_MISMATCH',
  },
  {
    label: 'empty evidenceReferences',
    mutate: (payload) => { payload.evidenceReferences = []; },
    reasonCode: 'MISSING_REVIEW_EVIDENCE',
  },
  {
    label: 'empty executedCommands',
    mutate: (payload) => { payload.executedCommands = []; },
    reasonCode: 'MISSING_REVIEW_EVIDENCE',
  },
  {
    label: 'an unknown command outcome',
    mutate: (payload) => {
      payload.executedCommands = [{
        command: 'digest:sha256:9999999999999999999999999999999999999999999999999999999999999999',
        outcome: 'UNKNOWN',
      }];
    },
    reasonCode: 'MALFORMED_RECEIPT',
  },
  {
    label: 'a raw command instead of a digest summary',
    mutate: (payload) => {
      payload.executedCommands = [{
        command: 'node tests/workflow-coordinator.test.js',
        outcome: 'PASS',
      }];
    },
    reasonCode: 'MALFORMED_RECEIPT',
  },
]) {
  test(`completed REQUIRED PASS review rejects ${scenario.label}`, () => {
    const receipts = receiptsForHistory('merge-ready');
    scenario.mutate(receiptById(receipts, 'receipt-review-pass').payload);
    assertBlocked(reduce(receipts), scenario.reasonCode);
  });
}

for (const scenario of [
  {
    label: 'featureControl enabled getter',
    make: () => {
      let invoked = false;
      const featureControl = { enabled: false, phase: 'BASELINE' };
      Object.defineProperty(featureControl, 'enabled', {
        enumerable: true,
        configurable: true,
        get() {
          invoked = true;
          return SECRET;
        },
      });
      return {
        featureControl,
        trustPolicy: { producers: [] },
        wasInvoked: () => invoked,
      };
    },
  },
  {
    label: 'trustPolicy producers getter',
    make: () => {
      let invoked = false;
      const trustPolicy = { producers: [] };
      Object.defineProperty(trustPolicy, 'producers', {
        enumerable: true,
        configurable: true,
        get() {
          invoked = true;
          return SECRET;
        },
      });
      return {
        featureControl: { enabled: false, phase: 'BASELINE' },
        trustPolicy,
        wasInvoked: () => invoked,
      };
    },
  },
]) {
  test(`rejects hostile ${scenario.label} without getter invocation or secret echo`, () => {
    const input = scenario.make();
    let thrown = null;
    try {
      coordinator({
        featureControl: input.featureControl,
        trustPolicy: input.trustPolicy,
        evaluatedAt: '2026-09-06T04:00:00.000Z',
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error);
    assert.strictEqual(input.wasInvoked(), false);
    assert.strictEqual(String(thrown).includes(SECRET), false);
  });
}

for (const scenario of [
  {
    label: 'WorkflowCoordinator featureControl outer option',
    option: 'featureControl',
    construct: (options) => new WorkflowCoordinator(options),
    extra: { trustPolicy: { producers: [] } },
  },
  {
    label: 'WorkflowCoordinatorEvidence trustPolicy outer option',
    option: 'trustPolicy',
    construct: (options) => new WorkflowCoordinatorEvidence(options),
    extra: {},
  },
]) {
  test(`rejects accessor-backed ${scenario.label} without invoking the getter`, () => {
    let invoked = false;
    const options = {
      ...scenario.extra,
      evaluatedAt: '2026-09-06T04:00:00.000Z',
    };
    Object.defineProperty(options, scenario.option, {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        return SECRET;
      },
    });

    let thrown = null;
    try {
      scenario.construct(options);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof Error);
    assert.strictEqual(invoked, false);
    assert.strictEqual(String(thrown).includes(SECRET), false);
  });
}

test('spoofed state, completion, or target authority fields cannot grant progress', () => {
  const receipts = receiptsForHistory('decision-pending');
  const decision = receiptById(receipts, 'receipt-decision-required');
  decision.payload.state = 'MERGE_READY';
  decision.payload.completion = {
    implementation: 'COMPLETE',
    delivery: 'COMPLETE',
    workflow: 'COMPLETE',
  };
  decision.payload.allowsTargetProgress = true;

  const result = reduce(receipts);

  assert.strictEqual(result.state, 'DECISION_PENDING');
  assert.deepStrictEqual(result.completion, {
    implementation: 'PENDING',
    delivery: 'PENDING',
    workflow: 'PENDING',
  });
  assert.strictEqual(result.control.allowsTargetProgress, false);
});

run('workflow-coordinator-security');
