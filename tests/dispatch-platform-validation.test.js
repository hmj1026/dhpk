'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  VALIDATION_SCHEMA,
  validateDispatchPlatformEvidence,
  validateDispatchSurfaceSet,
} = require('../scripts/lib/dispatch-platform-validation');
const catalog = require('../manifests/provider-model-catalog.json');
const profile = require('../manifests/host-profiles.json').profiles.find((entry) => entry.host === 'cursor');

const target = { provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli' };

test('platform evidence separates catalog support, Host access, and runtime probe status', () => {
  const evidence = validateDispatchPlatformEvidence({ hostProfile: profile, catalog, target });
  assert.strictEqual(evidence.schema, VALIDATION_SCHEMA);
  assert.strictEqual(evidence.status.catalog_support, 'AVAILABLE');
  assert.strictEqual(evidence.status.host_access, 'NOT_RUN');
  assert.strictEqual(evidence.status.runtime, 'NOT_RUN');
  assert.strictEqual(evidence.status.terminal, 'NOT_RUN');
});

test('runtime and verification evidence are recorded without turning a receipt into capability proof', () => {
  const evidence = validateDispatchPlatformEvidence({
    hostProfile: { ...profile, access: { ...profile.access, 'codex-cli': { status: 'AVAILABLE', evidence: 'bounded probe' } } },
    catalog,
    target,
    probe: { status: 'AVAILABLE', evidence: 'executable and auth fixture' },
    receipt: { receipt_id: 'receipt-platform-1', status: 'SUCCEEDED', verification: 'PASSED' },
  });
  assert.strictEqual(evidence.status.host_access, 'AVAILABLE');
  assert.strictEqual(evidence.status.runtime, 'AVAILABLE');
  assert.strictEqual(evidence.status.terminal, 'SUCCEEDED');
  assert.strictEqual(evidence.status.verification, 'PASSED');
});

test('surface validation marks missing catalog support incomplete', () => {
  const result = validateDispatchSurfaceSet([{
    hostProfile: profile,
    catalog,
    target: { provider: 'codex-cli', model: 'missing-model', effort: 'high', transport: 'local-cli' },
  }]);
  assert.strictEqual(result.verdict, 'INCOMPLETE');
  assert.strictEqual(result.surfaces[0].status.catalog_support, 'UNAVAILABLE');
});

run('dispatch-platform-validation');
