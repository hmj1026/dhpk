'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { applyDispatchConfig, createDispatchConfigReport, diagnoseDispatchConfig, resolveDispatchConfig } = require('../scripts/lib/dispatch-config');
const catalog = require('../manifests/provider-model-catalog.json');
const profiles = require('../manifests/host-profiles.json');

test('canonical project target wins over legacy and global values with observable source', () => {
  const result = resolveDispatchConfig({
    project: { worker_target: 'codex-cli/sol5.6:high', fast_worker_backend: 'agy' },
    global: { worker_target: 'claude-code/opus5:medium' },
  });
  assert.deepStrictEqual(result.worker_target, { provider: 'codex-cli', model: 'sol5.6', effort: 'high' });
  assert.strictEqual(result.source.worker_target, 'project.worker_target');
  assert.deepStrictEqual(result.legacy_sources, []);
});

test('legacy backend/model values remain bounded compatibility inputs', () => {
  const result = resolveDispatchConfig({ project: { fast_worker_backend: 'codex', codex_fast_worker_model: 'sol5.6' }, global: {} });
  assert.strictEqual(result.worker_target.provider, 'codex-cli');
  assert.strictEqual(result.worker_target.model, 'sol5.6');
  assert.ok(result.legacy_sources.some((entry) => entry.field === 'worker_target'));
});

test('invalid canonical values block only the invalid field and retain orchestration kill switch semantics', () => {
  const result = resolveDispatchConfig({ project: { orchestration_dispatch: 'off', reasoner_target: 'bare-model' } });
  assert.strictEqual(result.orchestration_dispatch, 'off');
  assert.ok(result.diagnostics.some((entry) => entry.field === 'reasoner_target'));
});

test('diagnostics keep catalog support, Host access, runtime, and fallback distinct', () => {
  const config = resolveDispatchConfig({ project: { reasoner_target: 'codex-cli/sol5.6:high', fallback_allow: true } });
  const cursor = profiles.profiles.find((profile) => profile.host === 'cursor');
  const result = diagnoseDispatchConfig({ config, catalog, hostProfile: cursor, role: 'reasoner', authority: 'read-only', effort: 'high' });
  assert.strictEqual(result.catalog_support, 'AVAILABLE');
  assert.strictEqual(result.host_access, 'NOT_RUN');
  assert.strictEqual(result.runtime, 'NOT_RUN');
  assert.strictEqual(result.fallback, 'allowed');
});

test('session-start report keeps invalid configuration and runtime evidence separate', () => {
  const config = resolveDispatchConfig({
    project: { worker_target: 'codex-cli/sol5.6:high', fallback_allow: false },
  });
  const report = createDispatchConfigReport({ config });
  assert.strictEqual(report.schema, 'dhpk.dispatch.config-report.v1');
  assert.strictEqual(report.targets.worker.provider, 'codex-cli');
  assert.deepStrictEqual(report.status, {
    catalog_support: 'NOT_RUN',
    host_access: 'NOT_RUN',
    runtime: 'NOT_RUN',
    fallback: 'disabled',
  });
  assert.deepStrictEqual(report.diagnostics, []);
});

test('applying a canonical role target keeps Effort top-level for the v2 request', () => {
  const config = resolveDispatchConfig({ project: { worker_target: 'codex-cli/sol5.6:high', fallback_allow: true } });
  const applied = applyDispatchConfig({ config, role: 'worker', request: { task_id: 'task', effort: 'medium' } });
  assert.deepStrictEqual(applied.target, { provider: 'codex-cli', model: 'sol5.6' });
  assert.strictEqual(applied.effort, 'high');
  assert.strictEqual(applied.fallback.allow, true);
});

run('dispatch-config');
