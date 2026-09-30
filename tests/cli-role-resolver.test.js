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

test('provider-neutral roles resolve authority independently from an optional Provider constraint', () => {
  const worker = resolveRole({ requestedRole: 'worker', mode: 'workspace-write', provider: 'codex-cli' });
  assert.strictEqual(worker.status, 'RESOLVED');
  assert.strictEqual(worker.effective_role, 'worker');
  assert.strictEqual(worker.canonical_role, 'worker');
  assert.strictEqual(worker.provider_constraint, 'codex-cli');
  assert.strictEqual(worker.role_contract.authority, 'workspace-write');

  const reviewer = resolveRole({ requestedRole: 'reviewer', mode: 'read-only', provider: 'agy' });
  assert.strictEqual(reviewer.status, 'RESOLVED');
  assert.strictEqual(reviewer.canonical_role, 'reviewer');
  assert.strictEqual(reviewer.provider_constraint, 'agy');
});

test('legacy aliases expose canonical Role and compatibility Provider metadata', () => {
  const result = resolveRole({ requestedRole: 'codex-fast-worker', mode: 'workspace-write' });
  assert.strictEqual(result.canonical_role, 'worker');
  assert.strictEqual(result.provider_constraint, 'codex-cli');
  assert.strictEqual(result.compatibility_source, 'legacy-role-alias');
  assert.ok(result.deprecation_evidence.includes('codex-fast-worker'));
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

{
  // Source suite: cli-dispatch-context.
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const { createSessionDiagnostics } = require('../skills/dhpk-cli-dispatch-context/scripts/cli-role-resolver');
  const { buildContext } = require('../skills/dhpk-cli-dispatch-context/scripts/build-cli-dispatch-context');

  const ROOT = path.join(__dirname, '..');

  function dispatchInput(overrides = {}) {
    return {
      dispatching_agent: 'claude',
      execution_provider: 'codex',
      requested_role: 'codex-fast-worker',
      mode: 'workspace-write',
      config: {
        codex_worker_model: 'canonical-codex-model',
        codex_fast_worker_model: 'legacy-codex-model',
        codex_worker_effort: 'high',
        codex_fast_worker_effort: 'low',
        codex_worker_timeout_secs: 90,
        codex_fast_worker_timeout_secs: 30,
      },
      workdir: '/trusted/workspace',
      prompt_file: '/trusted/workspace/prompt.txt',
      artifact_root: '/trusted/workspace/.dhpk/cli-receipts',
      receipt_path: '/trusted/workspace/.dhpk/cli-receipts/receipt.json',
      context_path: '/trusted/workspace/.dhpk/cli-receipts/context.json',
      assigned_files: ['src/worker.js'],
      report_only: true,
      task_id: 'task-123',
      attempt_id: 'attempt-1',
      runtime_path: '/trusted/bin:/usr/bin',
      prompt_evidence: { path: '/trusted/workspace/prompt.txt', dev: 1, ino: 2, sha256: 'a'.repeat(64) },
      ...overrides,
    };
  }

  test('Codex alias context keeps requested identity, uses canonical configuration, and emits one session diagnostic', () => {
    const diagnostics = [];
    const session = createSessionDiagnostics((message) => diagnostics.push(message));
    const writes = [];
    const writeFile = (filePath, payload, options) => writes.push({ filePath, payload, options });

    const first = buildContext(dispatchInput(), { writeFile, diagnostics: session });
    const second = buildContext(dispatchInput({
      requested_role: 'codex-deep-reasoner',
      mode: 'read-only',
      config: { codex_reasoner_timeout_secs: 90 },
    }), { diagnostics: session });

    assert.strictEqual(first.status, 'READY');
    assert.strictEqual(Object.isFrozen(first), true);
    assert.strictEqual(Object.isFrozen(first.context), true);
    assert.strictEqual(first.context.requested_role, 'codex-fast-worker');
    assert.strictEqual(first.context.effective_role, 'codex-worker');
    assert.strictEqual(first.context.dispatching_agent, 'claude');
    assert.strictEqual(first.context.execution_provider, 'codex');
    assert.strictEqual(first.context.provider, 'codex');
    assert.strictEqual(first.context.transport, 'codex-exec');
    assert.strictEqual(first.context.stdin_mode, 'prompt');
    assert.strictEqual(first.context.requested_model, 'canonical-codex-model');
    assert.strictEqual(first.context.requested_effort, 'high');
    assert.strictEqual(first.context.timeout_secs, 90);
    assert.strictEqual(first.legacyReport.requested_role, 'codex-fast-worker');
    assert.strictEqual(first.legacyReport.model_source, 'codex_worker_model');
    assert.strictEqual(writes.length, 1);
    const independentlyComputedSha256 = crypto.createHash('sha256')
      .update(writes[0].payload, 'utf8')
      .digest('hex');
    assert.strictEqual(first.contextSha256, independentlyComputedSha256);
    assert.deepStrictEqual(writes, [{
      filePath: '/trusted/workspace/.dhpk/cli-receipts/context.json',
      payload: JSON.stringify(first.context),
      options: { mode: 0o600, atomic: true, noFollow: true },
    }]);
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0].includes('codex-fast-worker'));
    assert.strictEqual(second.status, 'READY');
  });

  test('attested failure classification is optional, canonical, and carried to transport', () => {
    const valid = buildContext(dispatchInput({ failure_class: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE' }));
    assert.strictEqual(valid.status, 'READY');
    assert.strictEqual(valid.context.failure_class, 'AUTHENTICATION_OR_MODEL_UNAVAILABLE');

    const absent = buildContext(dispatchInput());
    assert.strictEqual(absent.status, 'READY');
    assert.strictEqual(absent.context.failure_class, null);

    const invalid = buildContext(dispatchInput({ failure_class: 'PROVIDER_EXHAUSTED' }));
    assert.strictEqual(invalid.status, 'BLOCKED');
    assert.match(invalid.reason, /failure_class/i);
  });

  test('cross-provider identity is BLOCKED without a write', () => {
    const writes = [];
    const result = buildContext(dispatchInput({ execution_provider: 'agy' }), {
      writeFile: (...args) => writes.push(args),
    });

    assert.strictEqual(result.status, 'BLOCKED');
    assert.strictEqual(result.reason, 'role codex-worker is not bound to provider agy');
    assert.strictEqual(result.context, undefined);
    assert.strictEqual(result.contextPath, undefined);
    assert.deepStrictEqual(writes, []);
  });

  test('dispatching agent identity is independent from the execution provider that binds the role', () => {
    const result = buildContext(dispatchInput({
      dispatching_agent: 'codex',
      execution_provider: 'agy',
      requested_role: 'agy-worker',
      config: { agy_worker_model: 'canonical-agy-model', agy_worker_timeout_secs: 90 },
    }));

    assert.strictEqual(result.status, 'READY');
    assert.strictEqual(result.context.dispatching_agent, 'codex');
    assert.strictEqual(result.context.execution_provider, 'agy');
    assert.strictEqual(result.context.provider, 'agy');
    assert.strictEqual(result.context.effective_role, 'agy-worker');
  });

  test('legacy provider input cannot substitute for explicit dispatch and execution identities', () => {
    const result = buildContext(dispatchInput({
      dispatching_agent: undefined,
      execution_provider: undefined,
      provider: 'codex',
    }));

    assert.strictEqual(result.status, 'BLOCKED');
    assert.match(result.reason, /dispatching_agent|execution_provider/);
    assert.strictEqual(result.context, undefined);
  });

  test('malformed prompt evidence is BLOCKED before a writer is called', () => {
    const malformed = [
      { path: '/trusted/workspace/prompt.txt', ino: 2, sha256: 'a'.repeat(64) },
      { path: '/trusted/workspace/prompt.txt', dev: 1, ino: -1, sha256: 'a'.repeat(64) },
      { path: '/trusted/workspace/prompt.txt', dev: 1, ino: 2, sha256: 'A'.repeat(64) },
    ];

    for (const promptEvidence of malformed) {
      const writes = [];
      const result = buildContext(dispatchInput({ prompt_evidence: promptEvidence }), {
        writeFile: (...args) => writes.push(args),
      });

      assert.strictEqual(result.status, 'BLOCKED');
      assert.match(result.reason, /prompt_evidence/i);
      assert.deepStrictEqual(writes, []);
    }
  });

  test('legacy report preserves only bounded selector metadata and cannot inject authority or paths', () => {
    const result = buildContext(dispatchInput({
      legacy_report: {
        status: 'selected',
        requested_backend: 'codex',
        selected_backend: 'codex',
        fallback: 'none',
        requested_role: 'agy-worker',
        effective_role: 'agy-worker',
        provider: 'agy',
        mode: 'read-only',
        transport: 'agy-print',
        authority: 'workspace-write',
        private_path: '/home/user/.ssh/id_rsa',
        reason: 'contains /private/path and should not cross the boundary',
      },
    }));

    assert.strictEqual(result.status, 'READY');
    assert.deepStrictEqual(result.legacyReport, {
      status: 'selected',
      requested_backend: 'codex',
      selected_backend: 'codex',
      fallback: 'none',
      requested_role: 'codex-fast-worker',
      effective_role: 'codex-worker',
      provider: 'codex',
      mode: 'workspace-write',
      transport: 'codex-exec',
      stdin_mode: 'prompt',
      requested_model: 'canonical-codex-model',
      requested_effort: 'high',
      timeout_secs: 90,
      model_source: 'codex_worker_model',
      effort_source: 'codex_worker_effort',
      timeout_source: 'codex_worker_timeout_secs',
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result.legacyReport, 'authority'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result.legacyReport, 'private_path'), false);
  });

  test('AGY worker context binds the AGY print and confirmation transports', () => {
    const result = buildContext(dispatchInput({
      execution_provider: 'agy',
      requested_role: 'agy-worker',
      config: { agy_worker_model: 'canonical-agy-model', agy_worker_timeout_secs: 90 },
    }));

    assert.strictEqual(result.status, 'READY');
    assert.strictEqual(result.context.provider, 'agy');
    assert.strictEqual(result.context.requested_role, 'agy-worker');
    assert.strictEqual(result.context.effective_role, 'agy-worker');
    assert.strictEqual(result.context.transport, 'agy-print');
    assert.strictEqual(result.context.stdin_mode, 'agy-confirmation');
    assert.strictEqual(result.context.requested_model, 'canonical-agy-model');
    assert.strictEqual(result.context.timeout_secs, 90);
  });

  test('AGY without an explicit resolved model is BLOCKED before the trusted writer', () => {
    const writes = [];
    const result = buildContext(dispatchInput({
      execution_provider: 'agy',
      requested_role: 'agy-worker',
      config: { agy_worker_timeout_secs: 90 },
    }), { writeFile: (...args) => writes.push(args) });

    assert.strictEqual(result.status, 'BLOCKED');
    assert.match(result.reason, /AGY model/i);
    assert.deepStrictEqual(writes, []);
  });

  test('projected builder loads the resolver from its package-local source', () => {
    const sourceBuilder = path.join(ROOT, 'skills', 'dhpk-cli-dispatch-context', 'scripts', 'build-cli-dispatch-context.js');
    const sourceResolver = path.join(ROOT, 'skills', 'dhpk-cli-dispatch-context', 'scripts', 'cli-role-resolver.js');

    const projectionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cli-dispatch-context-projection-'));
    try {
      const scripts = path.join(projectionRoot, 'skills', 'dhpk-cli-dispatch-context', 'scripts');
      fs.mkdirSync(scripts, { recursive: true });
      fs.copyFileSync(sourceBuilder, path.join(scripts, 'build-cli-dispatch-context.js'));
      fs.copyFileSync(sourceResolver, path.join(scripts, 'cli-role-resolver.js'));
      const modulePath = path.join(scripts, 'build-cli-dispatch-context.js');
      const probe = spawnSync(process.execPath, ['-e', `
        const { buildContext } = require(${JSON.stringify(modulePath)});
        const result = buildContext(${JSON.stringify(dispatchInput())});
        if (result.status !== 'READY') {
          console.error(JSON.stringify(result));
          process.exit(2);
        }
        process.stdout.write(result.context.transport);
      `], { cwd: projectionRoot, env: { ...process.env, NODE_PATH: '' }, encoding: 'utf8' });

      assert.strictEqual(probe.status, 0, probe.stderr);
      assert.strictEqual(probe.stdout, 'codex-exec');
    } finally {
      fs.rmSync(projectionRoot, { recursive: true, force: true });
    }
  });
}

run('canonical-cli-role-vocabulary');
