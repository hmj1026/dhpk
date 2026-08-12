'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  RECEIPT_SCHEMA,
  SURFACE_OWNERS,
  createSurfaceReceipt,
  validateSurfaceReceipt,
  assertRollbackOwnership,
} = require('../scripts/lib/platform-provenance');

test('surface receipts carry an owner that is independent per publication surface', () => {
  const receipt = createSurfaceReceipt({
    surface: 'agent-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: { 'dhpk-example': 'c'.repeat(64) },
    route: 'local-agent-plugin',
  });
  assert.strictEqual(receipt.schema, RECEIPT_SCHEMA);
  assert.strictEqual(receipt.surface, 'agent-plugin');
  assert.strictEqual(receipt.owner, SURFACE_OWNERS['agent-plugin']);
  assert.strictEqual(validateSurfaceReceipt(receipt, 'agent-plugin').ok, true);
  assert.strictEqual(validateSurfaceReceipt(receipt, 'cursor-plugin').ok, false);
});

test('receipt validation rejects an owner or surface swap', () => {
  const receipt = createSurfaceReceipt({
    surface: 'cursor-plugin',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: {},
  });
  const swapped = { ...receipt, owner: SURFACE_OWNERS['agent-plugin'] };
  const result = validateSurfaceReceipt(swapped, 'cursor-plugin');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /owner/i.test(error)));
});

test('rollback guard refuses to mutate a different surface owner', () => {
  const receipt = createSurfaceReceipt({
    surface: 'codex-native',
    sourceVersion: '1.2.3',
    sourceCommit: 'a'.repeat(40),
    inventoryDigest: 'b'.repeat(64),
    fingerprints: {},
  });
  assert.doesNotThrow(() => assertRollbackOwnership(receipt, 'codex-native'));
  assert.throws(() => assertRollbackOwnership(receipt, 'agent-plugin'), /ownership|surface/i);
});

run('platform-provenance');
