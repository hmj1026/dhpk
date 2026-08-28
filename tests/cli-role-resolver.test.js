'use strict';

const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const {
  createSessionDiagnostics,
  resolveConfig,
  resolvePublication,
  resolveRole,
} = require('../scripts/cli-role-resolver');

const digest = (fields) => crypto.createHash('sha256')
  .update(JSON.stringify(fields, Object.keys(fields).sort()))
  .digest('hex');

test('canonical provider role IDs resolve to their fixed mode and immutable role contract', () => {
  const cases = [
    ['codex-worker', 'workspace-write'],
    ['codex-reasoner', 'read-only'],
    ['codex-reviewer', 'read-only'],
    ['agy-worker', 'workspace-write'],
  ];
  for (const [requestedRole, mode] of cases) {
    const result = resolveRole({ requestedRole, mode });
    assert.strictEqual(result.status, 'RESOLVED');
    assert.strictEqual(result.requested_role, requestedRole);
    assert.strictEqual(result.effective_role, requestedRole);
    assert.strictEqual(result.role_contract.schema, 'dhpk.role-contract.v1');
    assert.strictEqual(result.role_contract.authority, mode);
    assert.strictEqual(Object.isFrozen(result.role_contract), true);
    const fields = {
      requested_role: requestedRole,
      effective_role: requestedRole,
      authority: mode,
      source_id: 'dhpk.cli-role-resolver',
    };
    assert.strictEqual(result.role_contract.evidence_sha256, digest(fields));
  }
});

test('legacy aliases resolve at the boundary and codex-bridge is explicitly mode-qualified', () => {
  const aliases = [
    ['codex-fast-worker', 'workspace-write', 'codex-worker'],
    ['codex-deep-reasoner', 'read-only', 'codex-reasoner'],
    ['agy-fast-worker', 'workspace-write', 'agy-worker'],
    ['codex-bridge', 'read-only', 'codex-reviewer'],
    ['codex-bridge', 'workspace-write', 'codex-worker'],
  ];
  for (const [requestedRole, mode, effectiveRole] of aliases) {
    const result = resolveRole({ requestedRole, mode });
    assert.strictEqual(result.status, 'RESOLVED');
    assert.strictEqual(result.effective_role, effectiveRole);
    assert.strictEqual(result.deprecated_alias, true);
  }
});

test('unknown, missing, and contradictory role or mode inputs fail closed', () => {
  const cases = [
    {},
    { requestedRole: 'codex-bridge' },
    { requestedRole: 'codex-bridge', mode: 'admin' },
    { requestedRole: 'codex-worker', mode: 'read-only' },
    { requestedRole: 'codex-reviewer', mode: 'workspace-write' },
    { requestedRole: 'invented-role', mode: 'read-only' },
  ];
  for (const input of cases) {
    const result = resolveRole(input);
    assert.strictEqual(result.status, 'BLOCKED');
    assert.strictEqual(result.role_contract, undefined);
  }
});

test('a provider cannot resolve a role that belongs to a different dispatch identity', () => {
  const result = resolveRole({ requestedRole: 'agy-worker', mode: 'workspace-write', provider: 'codex' });
  assert.deepStrictEqual(result, {
    status: 'BLOCKED',
    reason: 'role agy-worker is not bound to provider codex',
  });
});

test('legacy alias deprecation diagnostic is bounded to exactly once per session', () => {
  const diagnostics = [];
  const session = createSessionDiagnostics((message) => diagnostics.push(message));
  resolveRole({ requestedRole: 'codex-fast-worker', mode: 'workspace-write', diagnostics: session });
  resolveRole({ requestedRole: 'codex-deep-reasoner', mode: 'read-only', diagnostics: session });
  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].includes('deprecated role alias'));
});

test('canonical config wins over a legacy key and only declared aliases are considered', () => {
  const config = {
    codex_worker_model: 'canonical-model',
    codex_fast_worker_model: 'legacy-model',
    codex_worker_effort: 'high',
    codex_fast_worker_effort: 'low',
    codex_worker_timeout_secs: '90',
    codex_fast_worker_timeout_secs: '30',
  };
  const resolved = resolveConfig({ effectiveRole: 'codex-worker', config });
  assert.deepStrictEqual(resolved, {
    model: { value: 'canonical-model', source: 'codex_worker_model' },
    effort: { value: 'high', source: 'codex_worker_effort' },
    timeout_secs: { value: '90', source: 'codex_worker_timeout_secs' },
  });
  const fallback = resolveConfig({ effectiveRole: 'codex-worker', config: { codex_fast_worker_model: 'legacy-only' } });
  assert.deepStrictEqual(fallback.model, { value: 'legacy-only', source: 'codex_fast_worker_model' });
  assert.deepStrictEqual(fallback.effort, { value: undefined, source: undefined });
  assert.deepStrictEqual(fallback.timeout_secs, { value: undefined, source: undefined });
});

test('codex-reviewer remains shared-runner-only until the native read-only capability is present', () => {
  assert.deepStrictEqual(resolvePublication({ role: 'codex-reviewer', target: 'codex-native', capabilities: [] }), {
    status: 'UNAVAILABLE', reason: 'missing capability: codex-native-read-only-reviewer',
  });
  assert.deepStrictEqual(resolvePublication({ role: 'codex-reviewer', target: 'shared-runner', capabilities: [] }), {
    status: 'AVAILABLE', role: 'codex-reviewer',
  });
  assert.deepStrictEqual(resolvePublication({ role: 'codex-reviewer', target: 'codex-native', capabilities: ['codex-native-read-only-reviewer'] }), {
    status: 'AVAILABLE', role: 'codex-reviewer',
  });
});

run('canonical-cli-role-vocabulary');
