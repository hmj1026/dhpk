'use strict';

// Provider-neutral Receipt Bundle transport (issue #371, ADR-0017 "Do not
// commit runtime receipts. Export a provider-neutral, redacted,
// content-addressed Receipt Bundle ... A remote gate imports it only after
// verifying commit or tree identity, hashes, and producer trust.").
//
// This module owns only the bundle envelope: redaction, content-addressing,
// and import verification. It never judges review outcomes or workflow
// state; validated receipts are handed to WorkflowCoordinator/ReviewGate
// unchanged.

const {
  canonicalJson,
  sha256,
  redactEvidence,
  deepFreeze,
  COMMIT,
  TREE,
} = require('./receipt-primitives');
const { evaluateReceipts } = require('./workflow-coordinator-evidence');

const BUNDLE_SCHEMA = 'dhpk.review-gate.receipt-bundle.v1';
const SUPPORTED_SCHEMAS = Object.freeze([BUNDLE_SCHEMA]);

class ReceiptBundleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReceiptBundleError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new ReceiptBundleError(code);
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

function asBundleError(error) {
  if (error instanceof ReceiptBundleError) return error;
  const code = error && typeof error.code === 'string' ? error.code : 'MALFORMED_RECEIPT';
  return new ReceiptBundleError(code);
}

function digestReceipts(receipts) {
  return `sha256:${sha256(canonicalJson(receipts))}`;
}

function exportBundle({
  receipts, trustPolicy, exportedAt, producer, adapter,
} = {}) {
  if (!isNonEmptyString(exportedAt) || !Number.isFinite(Date.parse(exportedAt))) fail('MALFORMED_EXPORT');
  if (!isNonEmptyString(producer)) fail('MALFORMED_EXPORT');
  if (!isNonEmptyString(adapter)) fail('MALFORMED_EXPORT');

  let evidence;
  try {
    evidence = evaluateReceipts(receipts, trustPolicy);
  } catch (error) {
    throw asBundleError(error);
  }

  const redactedReceipts = evidence.receipts.map((receipt) => redactEvidence(receipt));
  return deepFreeze({
    schema: BUNDLE_SCHEMA,
    producer,
    adapter,
    exportedAt,
    sourceCommit: evidence.bindings.sourceCommit,
    sourceTree: evidence.bindings.sourceTree,
    policyVersion: evidence.bindings.policyVersion,
    contractVersion: evidence.bindings.contractVersion,
    receiptCount: redactedReceipts.length,
    digest: digestReceipts(redactedReceipts),
    receipts: redactedReceipts,
  });
}

function importBundle({ bundle, trustPolicy, expectedIdentity } = {}) {
  if (!isRecord(bundle)) fail('MALFORMED_BUNDLE');
  if (bundle.schema === undefined) fail('MALFORMED_BUNDLE');
  if (!SUPPORTED_SCHEMAS.includes(bundle.schema)) fail('UNSUPPORTED_SCHEMA');
  if (!Array.isArray(bundle.receipts) || bundle.receipts.length === 0) fail('MALFORMED_BUNDLE');
  if (!isNonEmptyString(bundle.digest)) fail('MALFORMED_BUNDLE');
  if (digestReceipts(bundle.receipts) !== bundle.digest) fail('DIGEST_MISMATCH');
  if (!COMMIT.test(bundle.sourceCommit || '') || !TREE.test(bundle.sourceTree || '')) fail('MALFORMED_BUNDLE');

  // The envelope's sourceCommit/sourceTree are declared metadata, not
  // protected by `digest` (which hashes only `receipts`). Identity checks
  // must instead run against `evidence.bindings`, which evaluateReceipts
  // derives from the per-receipt sourceCommit/sourceTree fields that ARE
  // inside the hashed receipts — an envelope claiming a commit its own
  // receipts disagree with is a malformed bundle, not the caller's evidence.
  let evidence;
  try {
    evidence = evaluateReceipts(bundle.receipts, trustPolicy);
  } catch (error) {
    throw asBundleError(error);
  }
  if (bundle.sourceCommit.toLowerCase() !== evidence.bindings.sourceCommit.toLowerCase()
    || bundle.sourceTree.toLowerCase() !== evidence.bindings.sourceTree.toLowerCase()) {
    fail('MALFORMED_BUNDLE');
  }

  if (expectedIdentity !== undefined) {
    if (!isRecord(expectedIdentity) || !isNonEmptyString(expectedIdentity.commit)) fail('MALFORMED_BUNDLE');
    if (evidence.bindings.sourceCommit.toLowerCase() !== expectedIdentity.commit.toLowerCase()) fail('FOREIGN_IDENTITY');
    if (expectedIdentity.tree !== undefined
      && evidence.bindings.sourceTree.toLowerCase() !== String(expectedIdentity.tree).toLowerCase()) fail('FOREIGN_IDENTITY');
  }

  return evidence;
}

module.exports = {
  BUNDLE_SCHEMA,
  ReceiptBundleError,
  exportBundle,
  importBundle,
};
