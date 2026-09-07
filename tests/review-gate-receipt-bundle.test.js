'use strict';

// RED contract for the provider-neutral Receipt Bundle transport (issue #371,
// ADR-0017 "Export a provider-neutral, redacted, content-addressed Receipt
// Bundle ... A remote gate imports it only after verifying commit or tree
// identity, hashes, and producer trust.").

const { test, run, assert } = require('./_lib/tinytest');
const {
  FIXTURE,
  clone,
  receiptsForHistory,
} = require('./_lib/workflow-coordinator-fixture');
const {
  BUNDLE_SCHEMA,
  ReceiptBundleError,
  exportBundle,
  importBundle,
} = require('../scripts/lib/review-gate-receipt-bundle');

const EXPORTED_AT = '2026-09-07T00:00:00.000Z';

function expectRejected(fn, code, message) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReceiptBundleError, `${message}: expected ReceiptBundleError, got ${error}`);
    assert.strictEqual(error.code, code, message);
    return;
  }
  throw new Error(`${message}: expected rejection ${code}`);
}

function mergeReadyReceipts() {
  return receiptsForHistory('merge-ready');
}

function exportMergeReady(overrides = {}) {
  return exportBundle({
    receipts: mergeReadyReceipts(),
    trustPolicy: FIXTURE.trustPolicy,
    exportedAt: EXPORTED_AT,
    producer: 'ci',
    adapter: 'ci-review-gate-adapter',
    ...overrides,
  });
}

test('exports a bundle bound to the evidence identity and content digest', () => {
  const bundle = exportMergeReady();
  assert.strictEqual(bundle.schema, BUNDLE_SCHEMA);
  assert.strictEqual(bundle.sourceCommit, '3333333333333333333333333333333333333333');
  assert.strictEqual(bundle.sourceTree, '4444444444444444444444444444444444444444');
  assert.strictEqual(bundle.receiptCount, mergeReadyReceipts().length);
  assert.strictEqual(bundle.receipts.length, bundle.receiptCount);
  assert.ok(bundle.digest.startsWith('sha256:'));
});

test('exported bundle is deeply frozen', () => {
  const bundle = exportMergeReady();
  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.receipts));
  assert.ok(Object.isFrozen(bundle.receipts[0]));
});

test('export fails closed for an untrusted producer', () => {
  const foreignReceipts = mergeReadyReceipts().map((receipt) => ({ ...receipt, producer: 'foreign-producer' }));
  expectRejected(
    () => exportBundle({
      receipts: foreignReceipts,
      trustPolicy: FIXTURE.trustPolicy,
      exportedAt: EXPORTED_AT,
      producer: 'ci',
      adapter: 'ci-review-gate-adapter',
    }),
    'UNTRUSTED_PRODUCER',
    'an untrusted producer must not export',
  );
});

test('import round-trips an exported bundle into the same evidence identity', () => {
  const bundle = exportMergeReady();
  const evidence = importBundle({
    bundle,
    trustPolicy: FIXTURE.trustPolicy,
    expectedIdentity: { commit: bundle.sourceCommit, tree: bundle.sourceTree },
  });
  assert.strictEqual(evidence.identity.workId, 'work-368');
  assert.strictEqual(evidence.decisionChain.latest.payload.fact, 'DECISION_RESOLVED');
  assert.strictEqual(evidence.receipts.length, bundle.receiptCount);
});

test('import rejects an unsupported schema', () => {
  const bundle = clone(exportMergeReady());
  bundle.schema = 'dhpk.review-gate.receipt-bundle.v2';
  expectRejected(
    () => importBundle({ bundle, trustPolicy: FIXTURE.trustPolicy }),
    'UNSUPPORTED_SCHEMA',
    'an unknown major schema must fail closed',
  );
});

test('import rejects a tampered receipt whose digest no longer matches', () => {
  const bundle = clone(exportMergeReady());
  bundle.receipts[0] = { ...bundle.receipts[0], sourceTree: 'ffffffffffffffffffffffffffffffffffffffff' };
  expectRejected(
    () => importBundle({ bundle, trustPolicy: FIXTURE.trustPolicy }),
    'DIGEST_MISMATCH',
    'a tampered receipt must invalidate the bundle digest',
  );
});

test('import rejects a foreign commit identity', () => {
  const bundle = exportMergeReady();
  expectRejected(
    () => importBundle({
      bundle,
      trustPolicy: FIXTURE.trustPolicy,
      expectedIdentity: { commit: 'ffffffffffffffffffffffffffffffffffffffff' },
    }),
    'FOREIGN_IDENTITY',
    'a bundle for a different commit must not import against this identity',
  );
});

test('import fails closed when the local trust policy does not trust the bundled producer', () => {
  const bundle = exportMergeReady();
  expectRejected(
    () => importBundle({ bundle, trustPolicy: { producers: [] } }),
    'UNTRUSTED_PRODUCER',
    'evidence must not affect a gate before producer trust is verified',
  );
});

test('export requires a non-empty receipt set', () => {
  expectRejected(
    () => exportBundle({
      receipts: [],
      trustPolicy: FIXTURE.trustPolicy,
      exportedAt: EXPORTED_AT,
      producer: 'ci',
      adapter: 'ci-review-gate-adapter',
    }),
    'MALFORMED_RECEIPT',
    'an empty receipt set has nothing to export',
  );
});

test('import rejects a missing bundle', () => {
  expectRejected(
    () => importBundle({ trustPolicy: FIXTURE.trustPolicy }),
    'MALFORMED_BUNDLE',
    'missing transport evidence must not silently pass',
  );
});

run('review-gate-receipt-bundle');
