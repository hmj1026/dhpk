'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  ADAPTER_PROVIDERS,
  createAdapterRegistry,
  createCapabilityProbe,
  createExecutionAdapter,
} = require('../scripts/lib/provider-adapter');
const { SCHEMAS } = require('../scripts/lib/dispatch-contract');
const catalog = require('../manifests/provider-model-catalog.json');

const hostProfile = {
  schema: SCHEMAS.HOST_PROFILE,
  version: 'cursor.v1', host: 'cursor', native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
  allowed_providers: ['cursor-native', 'codex-cli'],
  access: {
    'cursor-native': { status: 'AVAILABLE', evidence: 'native runtime fixture' },
    'codex-cli': { status: 'AVAILABLE', evidence: 'bounded CLI fixture' },
  },
  quota_pools: { 'cursor-native': 'cursor', 'codex-cli': 'codex' },
  concurrency_limits: { cursor: 1, codex: 1 },
  observed_at: '2026-09-11T00:00:00.000Z',
};

const request = {
  schema: SCHEMAS.REQUEST, host_profile: hostProfile, task_id: 'adapter-task', attempt_id: 'adapter-attempt',
  role: 'reasoner', authority: 'read-only', task: { description_digest: 'a'.repeat(64) },
  scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  effort: 'high', fallback: { allow: true, retry_budget: 1 }, parallelism: { dependencies: [], max_concurrency: 1 },
};

const target = { provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli', native: false };

test('Probe is separate from execution and conservatively defaults to NOT_RUN', () => {
  const probe = createCapabilityProbe({ provider: 'codex-cli', version: 'codex-probe.v1' });
  const result = probe.probe(target, request);
  assert.deepStrictEqual(result, {
    status: 'NOT_RUN', provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli', evidence: 'bounded capability probe was not run', source: 'codex-probe.v1',
  });
});

test('Probe returns explicit availability evidence without launching a SubAgent', () => {
  let probeCalls = 0;
  let executorCalls = 0;
  const registry = createAdapterRegistry({
    probes: {
      'codex-cli': () => {
        probeCalls += 1;
        return { status: 'AVAILABLE', evidence: 'fixture executable and auth check' };
      },
    },
    executors: {
      'codex-cli': () => {
        executorCalls += 1;
        return { status: 'SUCCEEDED' };
      },
    },
  });
  const result = registry.probe('codex-cli').probe(target, request);
  assert.strictEqual(result.status, 'AVAILABLE');
  assert.strictEqual(result.evidence, 'fixture executable and auth check');
  assert.strictEqual(probeCalls, 1);
  assert.strictEqual(executorCalls, 0);
  assert.throws(() => registry.probe('codex-cli').probe({ ...target, provider: 'agy' }, request), /target|provider/i);
  assert.strictEqual(probeCalls, 1);
  assert.strictEqual(executorCalls, 0);

  const invalidProbeRegistry = createAdapterRegistry({
    probes: { 'codex-cli': () => ({ status: 'UNRECOGNIZED', evidence: 'fixture status' }) },
  });
  assert.throws(
    () => invalidProbeRegistry.probe('codex-cli').probe(target, request),
    /explicit capability status/,
  );
});

test('Execution Adapter consumes one resolved target and returns a canonical receipt', () => {
  let received;
  const adapter = createExecutionAdapter({
    provider: 'codex-cli', version: 'codex-adapter.v1',
    execute(resolvedTarget, normalizedRequest) {
      received = { resolvedTarget, normalizedRequest };
      return { status: 'SUCCEEDED', verification: 'NOT_RUN' };
    },
  });
  const outcome = adapter.execute(target, request);
  assert.strictEqual(outcome.status, 'SUCCEEDED');
  assert.strictEqual(outcome.receipt.schema, SCHEMAS.RECEIPT);
  assert.strictEqual(outcome.receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(outcome.receipt.requested_role, 'reasoner');
  assert.strictEqual(received.normalizedRequest.role, 'reasoner');
});

test('Adapter blocks target-provider mismatch and never substitutes another Provider', () => {
  let launched = false;
  const adapter = createExecutionAdapter({
    provider: 'codex-cli',
    execute() { launched = true; return { status: 'SUCCEEDED' }; },
  });
  const outcome = adapter.execute({ ...target, provider: 'claude-code', model: 'opus5' }, request);
  assert.strictEqual(outcome.status, 'BLOCKED');
  assert.strictEqual(outcome.receipt.resolved_target, null);
  assert.strictEqual(launched, false);
  assert.ok(!JSON.stringify(outcome).includes('agy'));
});

test('Adapter preserves timeout and observed side-effect state without retrying or switching Provider', () => {
  let calls = 0;
  const adapter = createExecutionAdapter({ provider: 'codex-cli', execute() {
    calls += 1;
    return { status: 'TIMEOUT', side_effects: 'unknown', verification: 'RECONCILIATION_REQUIRED' };
  } });
  const outcome = adapter.execute(target, request);
  assert.strictEqual(outcome.status, 'TIMEOUT');
  assert.strictEqual(outcome.receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(outcome.receipt.side_effects, 'unknown');
  assert.strictEqual(outcome.receipt.verification, 'RECONCILIATION_REQUIRED');
  assert.strictEqual(calls, 1);
});

test('Adapter returns BLOCKED for invalid attestation before invoking the Provider', () => {
  let launched = false;
  const adapter = createExecutionAdapter({ provider: 'codex-cli', execute() { launched = true; return { status: 'SUCCEEDED' }; } });
  const outcome = adapter.execute(target, { ...request, scope: undefined });
  assert.strictEqual(outcome.status, 'BLOCKED');
  assert.strictEqual(outcome.failure_class, 'ATTESTATION_INVALID');
  assert.strictEqual(outcome.receipt, null);
  assert.strictEqual(launched, false);
});

test('Adapter registry exposes the four supported execution families', () => {
  const registry = createAdapterRegistry({
    executors: Object.fromEntries(ADAPTER_PROVIDERS.map((provider) => [provider, () => ({ status: 'SUCCEEDED' })])),
  });
  assert.deepStrictEqual(registry.providers, ['claude-code', 'codex-cli', 'agy', 'cursor-native']);
  assert.strictEqual(registry.get('codex-cli').provider, 'codex-cli');
  assert.strictEqual(registry.get('cursor-native').provider, 'cursor-native');

  const legacyCursor = registry.get('cursor-native').execute({
    provider: 'cursor-native', model_id: 'cursor-default', effort: 'high', transport: 'native-runtime',
  }, request);
  assert.strictEqual(legacyCursor.status, 'SUCCEEDED');
  assert.strictEqual(legacyCursor.receipt.resolved_target.provider, 'xai');
});

function registerProviderCliAdapterTests() {
  const { buildInvocation, createCliAdapter } = require('../scripts/lib/provider-cli-adapters');
  const { SCHEMAS: CLI_SCHEMAS } = require('../scripts/lib/dispatch-contract');

  const cliRequest = {
    schema: CLI_SCHEMAS.REQUEST,
    host_profile: {
      schema: CLI_SCHEMAS.HOST_PROFILE, version: 'cursor.v2', host: 'cursor', native_target_agent: 'cursor', native_provider: 'cursor', native_model: 'composer-2.5', native_transport: 'native-runtime',
      allowed_providers: ['cursor', 'openai', 'google', 'anthropic'],
      access: {
        cursor: { status: 'AVAILABLE', evidence: 'native fixture' },
        openai: { status: 'AVAILABLE', evidence: 'codex fixture' },
        google: { status: 'AVAILABLE', evidence: 'agy fixture' },
        anthropic: { status: 'AVAILABLE', evidence: 'claude fixture' },
      },
      quota_pools: { cursor: 'cursor', openai: 'codex', google: 'agy', anthropic: 'claude' }, concurrency_limits: { cursor: 1, codex: 1, agy: 1, claude: 1 }, observed_at: '2026-09-11T00:00:00.000Z',
    },
    task_id: 'adapter-command-task', attempt_id: 'adapter-command-attempt', role: 'reasoner', authority: 'read-only',
    task: { description_digest: 'a'.repeat(64) }, scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 1 },
  };

  const expectedNormalizedRequest = {
    ...cliRequest,
    host_profile: {
      ...cliRequest.host_profile,
      native_route: 'native',
      role_defaults: {
        planner: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'high', route: 'native', transport: 'native-runtime' },
        reasoner: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'high', route: 'native', transport: 'native-runtime' },
        worker: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'medium', route: 'native', transport: 'native-runtime' },
        reviewer: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'high', route: 'native', transport: 'native-runtime' },
      },
      role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
    },
  };

  test('Codex CLI adapter keeps canonical effort and exact bounded argv shape', () => {
    const invocation = buildInvocation({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, cliRequest);
    assert.strictEqual(invocation.executable, 'codex');
    assert.deepStrictEqual(invocation.argv, [
      'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--cd', '/workspace',
      '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high', '--output-last-message', '{transport_output}', '-',
    ]);
    assert.strictEqual(invocation.stdin_mode, 'prompt');
  });

  test('AGY adapter uses its own confirmation transport and never emits Codex output placeholders', () => {
    const invocation = buildInvocation({ target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, { ...cliRequest, role: 'worker', authority: 'workspace-write' });
    assert.deepStrictEqual(invocation, {
      provider: 'google',
      transport: 'local-cli',
      executable: 'agy',
      argv: [
        '--dangerously-skip-permissions', '--mode', 'accept-edits', '--add-dir', '/workspace',
        '--model', 'Gemini 3.8 Flash (High)', '--print-timeout', '300s', '-p', '{prompt}',
      ],
      stdin_mode: 'agy-confirmation',
      output: 'none',
    });
  });

  test('Claude Code and Cursor native adapters remain explicit target adapters', () => {
    const claude = buildInvocation({ target_agent: 'claude-code', provider: 'anthropic', model_id: 'opus5', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, cliRequest);
    assert.strictEqual(claude.executable, 'claude');
    assert.deepStrictEqual(claude.argv, ['--print', '--model', 'opus5', '--effort', 'high', '--output-format', 'json']);
    assert.strictEqual(claude.stdin_mode, 'prompt');
    assert.ok(!claude.argv.includes('--prompt-file'));
    const native = buildInvocation({ target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5', effort: 'medium', route: 'native', transport: 'native-runtime' }, cliRequest);
    assert.strictEqual(native.executable, null);
    assert.deepStrictEqual(native.argv, []);
  });

  test('native Host routes do not become a vendor CLI when the target Agent differs', () => {
    const cursorAnthropic = buildInvocation({
      target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-thinking-high',
      effort: 'high', route: 'native', transport: 'native-runtime',
    }, cliRequest);
    assert.strictEqual(cursorAnthropic.executable, null);
    assert.deepStrictEqual(cursorAnthropic.argv, []);
    assert.strictEqual(cursorAnthropic.stdin_mode, 'native');
    assert.strictEqual(cursorAnthropic.output, 'native-result');
  });

  test('CLI adapter callback receives only its resolved target and invocation', () => {
    let callback;
    let callbackInvoked = false;
    const adapter = createCliAdapter({ provider: 'openai', version: 'codex-adapter.v2', execute(target, normalizedRequest, invocation) {
      callbackInvoked = true;
      callback = { target, normalizedRequest, invocation };
      return { status: 'SUCCEEDED' };
    } });
    const result = adapter.execute({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, cliRequest);
    assert.strictEqual(result.status, 'SUCCEEDED');
    assert.deepStrictEqual(callback, {
      target: {
        target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol', model: 'gpt-5.6-sol',
        effort: 'high', route: 'headless-cli', transport: 'local-cli', native: false, identity: 'codex-cli/gpt-5.6-sol',
      },
      normalizedRequest: expectedNormalizedRequest,
      invocation: {
        provider: 'openai', transport: 'local-cli', executable: 'codex',
        argv: [
          'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy=never', '--cd', '/workspace',
          '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort=high', '--output-last-message', '{transport_output}', '-',
        ],
        stdin_mode: 'prompt', output: 'transport-file',
      },
    });

    callbackInvoked = false;
    const mismatch = adapter.execute({ target_agent: 'claude-code', provider: 'anthropic', model_id: 'opus5', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, cliRequest);
    assert.deepStrictEqual({
      status: mismatch.status,
      failure_class: mismatch.failure_class,
      resolved_target: mismatch.receipt.resolved_target,
      callbackInvoked,
    }, {
      status: 'BLOCKED',
      failure_class: 'ADAPTER_TARGET_MISMATCH',
      resolved_target: null,
      callbackInvoked: false,
    });
  });
}

registerProviderCliAdapterTests();
run('provider-adapter');
