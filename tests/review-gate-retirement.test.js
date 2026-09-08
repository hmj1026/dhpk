'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { buildRetirementReport } = require('../scripts/lib/review-gate-retirement');
const {
  FIXTURE,
  receiptsForHistory,
  withAuthorityTrustPolicy,
} = require('./_lib/workflow-coordinator-fixture');
const { exportBundle } = require('../scripts/lib/review-gate-receipt-bundle');
const {
  ciVerificationReceipt,
  cutoverMigrationObservationReceipt,
  cutoverPhaseTransitionAuthorityReceipt,
  dualMigrationObservationReceipt,
  rollbackPhaseTransitionAuthorityReceipt,
  singleMaintainerCollectionAuthority,
  singleMaintainerCutoverAuthorityReceipt,
} = require('./_lib/migration-observation-fixture');

const NOW = '2026-09-08T06:00:00.000Z';
const DRILL_NOW = '2026-09-06T04:20:00.000Z';

function completeCutoverCost(observation) {
  observation.payload.acceptedOutcomeCost = {
    schema: 'dhpk.accepted-outcome-cost.v1',
    observationId: observation.payload.acceptedOutcomeCost.observationId,
    acceptedOutcome: true,
    metrics: {
      modelTokens: 100,
      dispatchCount: 1,
      semanticReviewCount: 1,
      remediationRounds: 0,
      humanTurns: 1,
      elapsedMs: 10,
      falseBlockCount: 0,
      receiptReuseCount: 0,
    },
    telemetryFailures: [],
    telemetryFailureCount: 0,
    telemetryStatus: 'COMPLETE',
    retirementEligible: true,
  };
  return observation;
}

function cutoverReceipts() {
  const receipts = receiptsForHistory('merge-ready').map((item) => (
    item.receiptId === 'receipt-review-pass'
      ? { ...item, payload: { ...item.payload, effect: 'ENFORCE' } }
      : item
  ));
  return [
    ...receipts,
    dualMigrationObservationReceipt(),
    completeCutoverCost(cutoverMigrationObservationReceipt()),
    cutoverPhaseTransitionAuthorityReceipt(),
  ];
}

function exportEvidence(receipts, exportedAt = DRILL_NOW) {
  return exportBundle({
    receipts,
    trustPolicy: withAuthorityTrustPolicy(),
    exportedAt,
    producer: 'maintainer-control-plane',
    adapter: 'maintainer-control-plane-adapter',
  });
}

function ledgerEntry(bundle) {
  return {
    bundle,
    expectedIdentity: {
      commit: bundle.sourceCommit,
      tree: bundle.sourceTree,
    },
  };
}

// Issue #375 Option B: the single-maintainer track's CI-verification receipt
// is checked against the same producer-trust policy as every other receipt
// (security-reviewer finding: an untrusted-producer verification must not be
// able to satisfy the track). Scoped to this test file rather than added to
// the shared `withAuthorityTrustPolicy()` fixture, since that fixture is
// used broadly and trusting `git-provider-review-gate` globally would change
// what other suites are exercising.
function withSingleMaintainerTrustPolicy() {
  const base = withAuthorityTrustPolicy();
  return {
    ...base,
    producers: [
      ...base.producers,
      {
        producer: 'git-provider-review-gate',
        adapter: 'git-provider-review-gate-adapter',
        receiptKinds: ['verification'],
      },
    ],
  };
}

test('empty external evidence produces a blocked non-promoting retirement report', () => {
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [],
      rollbackDrill: null,
      collectionAuthority: null,
    },
    trustPolicy: { producers: [] },
  });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(report.recommendation, 'DO_NOT_RETIRE');
  assert.strictEqual(report.retirementEligible, false);
  assert.strictEqual(report.promotionEligible, false);
  assert.strictEqual(report.phaseMutationPerformed, false);
  assert.ok(report.blockingReasons.includes('MINIMUM_ACCEPTED_OUTCOMES_NOT_MET'));
  assert.ok(report.blockingReasons.includes('DURABLE_EVIDENCE_LOCATION_REQUIRED'));
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
  assert.ok(report.blockingReasons.includes('ROLLBACK_DRILL_REQUIRED'));
  assert.ok(Object.isFrozen(report));
});

test('retirement report rejects an unversioned or unbounded ledger before reading evidence', () => {
  assert.throws(() => buildRetirementReport({
    generatedAt: NOW,
    ledger: { baselineBundles: [], cutoverBundles: [] },
    trustPolicy: { producers: [] },
  }), /UNSUPPORTED_SCHEMA/);

  assert.throws(() => buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: Array.from({ length: 1001 }, () => ({})),
      cutoverBundles: [],
    },
    trustPolicy: { producers: [] },
  }), /MALFORMED_LEDGER/);
});

test('retirement report rejects an unsafe durable evidence location', () => {
  assert.throws(() => buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      evidenceLocation: {
        reference: '/tmp/retirement-ledger.json',
        digest: 'sha256:' + 'a'.repeat(64),
      },
      baselineBundles: [],
      cutoverBundles: [],
    },
    trustPolicy: { producers: [] },
  }), /MALFORMED_EVIDENCE_LOCATION/);
});

test('the report builder is read-only when no external bundles are supplied', () => {
  const before = process.cwd();
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [],
      rollbackDrill: null,
      collectionAuthority: null,
    },
    trustPolicy: { producers: [] },
  });
  assert.strictEqual(process.cwd(), before);
  assert.strictEqual(report.phaseMutationPerformed, false);
});

test('a supplied bundle is imported through the trusted evidence boundary', () => {
  const ledger = {
    schema: 'dhpk.review-gate.retirement-ledger.v1',
    baselineBundles: [],
    cutoverBundles: [{
      bundle: {
        schema: 'dhpk.review-gate.receipt-bundle.v1',
        sourceCommit: '1'.repeat(40),
        sourceTree: '2'.repeat(40),
        digest: 'sha256:' + 'a'.repeat(64),
        receipts: [],
      },
      expectedIdentity: { commit: '1'.repeat(40), tree: '2'.repeat(40) },
    }],
    rollbackDrill: null,
    collectionAuthority: null,
  };
  assert.throws(() => buildRetirementReport({
    generatedAt: NOW,
    ledger,
    trustPolicy: { producers: [] },
  }), /MALFORMED_BUNDLE/);
});

test('a trusted bundle without migration observations remains blocked', () => {
  const bundle = exportBundle({
    receipts: receiptsForHistory('merge-ready'),
    trustPolicy: FIXTURE.trustPolicy,
    exportedAt: NOW,
    producer: 'ci',
    adapter: 'ci-review-gate-adapter',
  });
  assert.throws(() => buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [{
        bundle,
        expectedIdentity: { commit: bundle.sourceCommit, tree: bundle.sourceTree },
      }],
      rollbackDrill: null,
      collectionAuthority: null,
    },
    trustPolicy: FIXTURE.trustPolicy,
  }), /MISSING_MIGRATION_OBSERVATION/);
});

test('an unrelated maintainer authority cannot authorize CUTOVER outcomes', () => {
  const receipts = cutoverReceipts();
  const authority = receipts.find((item) => item.receiptId === 'receipt-phase-transition-cutover-authority');
  authority.taskId = 'task-unrelated';
  const bundle = exportEvidence(receipts);
  const report = buildRetirementReport({
    generatedAt: DRILL_NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: { receipt: authority },
    },
    trustPolicy: withAuthorityTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('rollback drill rejects a diagnostic from another execution session', () => {
  const receipts = cutoverReceipts();
  const cutover = receipts.find((item) => item.kind === 'migration-observation' && item.payload.phase === 'CUTOVER');
  const rollback = rollbackPhaseTransitionAuthorityReceipt(
    'receipt-phase-transition-rollback-drill',
    '2026-09-06T04:15:00.000Z',
    {
      digest: cutover.payload.provenance.digest,
      reference: cutover.payload.provenance.reference,
    },
  );
  const diagnostic = dualMigrationObservationReceipt('receipt-dual-rollback-drill', {
    reasonCodes: ['MIGRATION_ROLLBACK'],
    allowsTargetProgress: false,
    clearsSentinel: false,
    authorizesApproval: false,
  });
  diagnostic.recordedAt = '2026-09-06T04:16:00.000Z';
  diagnostic.payload.recordedAt = diagnostic.recordedAt;
  diagnostic.payload.provenance.recordedAt = diagnostic.recordedAt;
  diagnostic.sessionId = 'session-rollback-mismatch';
  diagnostic.payload.sessionId = diagnostic.sessionId;
  diagnostic.payload.identity.sessionId = diagnostic.sessionId;
  const bundle = exportEvidence([...receipts, rollback, diagnostic]);
  const report = buildRetirementReport({
    generatedAt: DRILL_NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [],
      collectionAuthority: null,
      rollbackDrill: {
        ...ledgerEntry(bundle),
        isolationReference: 'drill:session-mismatch',
      },
    },
    trustPolicy: withAuthorityTrustPolicy(),
  });
  assert.strictEqual(report.rollbackDrill.passed, false);
  assert.strictEqual(report.rollbackDrill.reason, 'ROLLBACK_DIAGNOSTIC_MISMATCH');
});

// Issue #375 Option B: single-maintainer authorization track
// (openspec/changes/adjust-review-gate-retirement-threshold/specs/
// review-gate-retirement-evidence/spec.md, "Requirement: Single-maintainer
// authorization track"). All three scenarios reuse `cutoverReceipts()`'s
// single CUTOVER outcome, whose observation carries sessionId 'session-368'
// and is recorded at CUTOVER_MIGRATION_RECORDED_AT ('2026-09-06T04:14:00.000Z').

test('a same-session, immediate self-authorization is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'session-368', // same session/identity that produced the CUTOVER outcome
    recordedAt: '2026-09-06T04:14:30.000Z', // 30s after the outcome: no cool-down elapsed
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: DRILL_NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('a time-separated self-authorization without CI corroboration is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct', // distinct session/identity
    recordedAt: '2026-09-08T05:00:00.000Z', // ~48h45m after the CUTOVER outcome
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: null, // no independently recorded external CI verification
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('a time-separated, CI-corroborated self-authorization satisfies phase-promotion authority via the single-maintainer track', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct', // distinct session/identity
    recordedAt: '2026-09-08T05:00:00.000Z', // ~48h45m after the CUTOVER outcome
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(!report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
  assert.strictEqual(report.decisionPacket.authorizationTrack, 'SINGLE_MAINTAINER');
});

// The tests above cover the two failure conditions together (same session +
// no cool-down elapsed) and the fully-satisfied accept path. The tests below
// isolate each condition individually, per code-reviewer finding
// (2026-09-08): a test that changes two independent conditions at once
// doesn't prove which one it verifies.

test('a distinct-session authorization within the cool-down window is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct', // distinct session/identity
    recordedAt: '2026-09-06T04:14:30.000Z', // 30s after the outcome: no cool-down elapsed
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: DRILL_NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('a same-session authorization after the cool-down window is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'session-368', // same session/identity as the CUTOVER outcome
    recordedAt: '2026-09-08T05:00:00.000Z', // ~48h45m after the outcome
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('an authorization at exactly the cool-down boundary satisfies phase-promotion authority via the single-maintainer track', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct',
    recordedAt: '2026-09-07T04:14:00.000Z', // exactly 24h after the outcome
    issuedAt: '2026-09-08T04:00:00.000Z', // brackets generatedAt (NOW), independent of recordedAt
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(!report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
  assert.strictEqual(report.decisionPacket.authorizationTrack, 'SINGLE_MAINTAINER');
});

// The tests below isolate the CI-verification checks themselves (producer
// trust, outcome, provenance binding), per code-reviewer finding
// (2026-09-08): the original tests only ever exercised present-vs-absent
// ciVerification, never a malformed/untrusted/mismatched one.

test('an untrusted CI-verification producer is rejected even with a valid time-separated authorization', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct',
    recordedAt: '2026-09-08T05:00:00.000Z',
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt(),
      }),
    },
    // deliberately missing the git-provider-review-gate producer entry that
    // withSingleMaintainerTrustPolicy() adds
    trustPolicy: withAuthorityTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
  assert.notStrictEqual(report.decisionPacket.authorizationTrack, 'SINGLE_MAINTAINER');
});

test('a CI verification with a failing outcome is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct',
    recordedAt: '2026-09-08T05:00:00.000Z',
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt({ outcome: 'FAIL' }),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

test('a CI verification bound to a different outcome is rejected as missing authority', () => {
  const receipts = cutoverReceipts();
  const authority = singleMaintainerCutoverAuthorityReceipt({
    sessionId: 'human-authority-session-368-distinct',
    recordedAt: '2026-09-08T05:00:00.000Z',
    issuedAt: '2026-09-08T04:00:00.000Z',
    expiresAt: '2026-09-08T08:00:00.000Z',
  });
  const bundle = exportEvidence([...receipts, authority]);
  const report = buildRetirementReport({
    generatedAt: NOW,
    ledger: {
      schema: 'dhpk.review-gate.retirement-ledger.v1',
      baselineBundles: [],
      cutoverBundles: [ledgerEntry(bundle)],
      rollbackDrill: null,
      collectionAuthority: singleMaintainerCollectionAuthority({
        receipt: authority,
        ciVerification: ciVerificationReceipt({
          evidenceBundle: {
            digest: `sha256:${'f'.repeat(64)}`,
            reference: 'artifact:unrelated-outcome',
          },
        }),
      }),
    },
    trustPolicy: withSingleMaintainerTrustPolicy(),
  });
  assert.ok(report.blockingReasons.includes('CUTOVER_COLLECTION_AUTHORITY_REQUIRED'));
});

run('review-gate-retirement');
