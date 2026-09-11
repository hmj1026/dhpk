'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  AUTHORITIES,
  CANONICAL_ROLES,
  EFFORTS,
  SCHEMAS,
  TRANSPORTS,
  createDispatchRequest,
  createDispatchReceipt,
  createHostProfile,
  createHostProfileSet,
  createProviderModelCatalog,
  translateLegacyRequest,
} = require('../scripts/lib/dispatch-contract');
const PROVIDER_CATALOG = require('../manifests/provider-model-catalog.json');
const HOST_PROFILES = require('../manifests/host-profiles.json');

const HOST_PROFILE = {
  schema: SCHEMAS.HOST_PROFILE,
  version: 'host-profile.test.v1',
  host: 'cursor',
  native_provider: 'cursor-native',
  native_model: 'cursor-default',
  native_transport: 'native-runtime',
  allowed_providers: ['cursor-native', 'claude-code', 'codex-cli', 'agy'],
  access: {
    'cursor-native': { status: 'AVAILABLE', evidence: 'fixture native runtime' },
    'claude-code': { status: 'NOT_RUN', evidence: 'fixture probe not run' },
    'codex-cli': { status: 'AVAILABLE', evidence: 'fixture bounded probe' },
    agy: { status: 'UNAVAILABLE', evidence: 'fixture executable missing' },
  },
  quota_pools: { 'cursor-native': 'native', 'claude-code': 'claude', 'codex-cli': 'codex', agy: 'agy' },
  concurrency_limits: { native: 1, claude: 1, codex: 2, agy: 1 },
  observed_at: '2026-09-11T00:00:00.000Z',
};

function request(overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST,
    host_profile: HOST_PROFILE,
    task_id: 'task-contract-1',
    attempt_id: 'attempt-contract-1',
    role: 'worker',
    authority: 'workspace-write',
    task: { description_digest: 'a'.repeat(64) },
    scope: {
      workdir: '/workspace/project',
      assigned_files: ['src/example.js'],
      prompt_evidence: {
        path: '/workspace/project/.dhpk/prompt.txt',
        dev: 1,
        ino: 2,
        sha256: 'b'.repeat(64),
      },
    },
    effort: 'high',
    fallback: { allow: true, retry_budget: 1 },
    parallelism: { dependencies: [], max_concurrency: 1 },
    ...overrides,
  };
}

test('canonical request keeps Host, Provider-scoped target, Role, Effort, and authority distinct', () => {
  const normalized = createDispatchRequest(request({
    role: 'reasoner',
    authority: 'read-only',
    target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' },
  }));

  assert.strictEqual(normalized.schema, SCHEMAS.REQUEST);
  assert.strictEqual(normalized.host_profile.host, 'cursor');
  assert.strictEqual(normalized.role, 'reasoner');
  assert.strictEqual(normalized.authority, 'read-only');
  assert.deepStrictEqual(normalized.target, {
    provider: 'codex-cli',
    model: 'sol5.6',
    transport: 'local-cli',
  });
  assert.strictEqual(normalized.effort, 'high');
  assert.strictEqual(Object.isFrozen(normalized), true);
  assert.strictEqual(Object.isFrozen(normalized.host_profile), true);
});

test('canonical contract exposes bounded role, authority, effort, and transport vocabularies', () => {
  assert.deepStrictEqual(CANONICAL_ROLES, ['planner', 'reasoner', 'worker', 'reviewer']);
  assert.deepStrictEqual(AUTHORITIES, ['read-only', 'workspace-write']);
  assert.deepStrictEqual(EFFORTS, ['low', 'medium', 'high', 'max']);
  assert.deepStrictEqual(TRANSPORTS, ['native-runtime', 'local-cli', 'app-server']);
});

test('provider-bound role names are rejected at the canonical seam', () => {
  assert.throws(() => createDispatchRequest(request({ role: 'codex-reasoner', authority: 'read-only' })), /canonical Role|unknown role|role/i);
  assert.throws(() => createDispatchRequest(request({ role: 'agy-worker' })), /canonical Role|unknown role|role/i);
});

test('bare Model names cannot identify a canonical execution target', () => {
  assert.throws(() => createDispatchRequest(request({ target: { model: 'opus5', transport: 'local-cli' } })), /Provider|provider-scoped|target/i);
});

test('read-only Roles cannot be widened to workspace-write', () => {
  for (const role of ['planner', 'reasoner', 'reviewer']) {
    assert.throws(() => createDispatchRequest(request({ role, authority: 'workspace-write' })), /authority/i);
  }
});

test('raw prompt/output/secret fields do not enter the canonical request', () => {
  const normalized = createDispatchRequest(request({
    prompt: 'do not persist this prompt',
    output: 'do not persist this output',
    secret: 'do not persist this secret',
  }));
  const serialized = JSON.stringify(normalized);
  assert.ok(!serialized.includes('do not persist this prompt'));
  assert.ok(!serialized.includes('do not persist this output'));
  assert.ok(!serialized.includes('do not persist this secret'));
});

test('versioned catalog and Host profiles keep Provider capability separate from Host access', () => {
  const catalog = createProviderModelCatalog(PROVIDER_CATALOG);
  const profiles = createHostProfileSet(HOST_PROFILES);
  assert.strictEqual(catalog.version, 'provider-catalog.v1');
  assert.deepStrictEqual(catalog.providers.map((entry) => entry.provider), ['claude-code', 'codex-cli', 'agy', 'cursor-native']);
  assert.strictEqual(catalog.providers[1].models[0].id, 'sol5.6');
  assert.strictEqual(catalog.providers[1].models[0].effort_mapping.high, 'high');
  assert.deepStrictEqual(profiles.profiles.map((profile) => profile.host), ['cursor', 'claude-code', 'codex-cli', 'agy']);
  assert.strictEqual(profiles.profiles[0].native_provider, 'cursor-native');
  assert.strictEqual(profiles.profiles[0].access['codex-cli'].status, 'NOT_RUN');
  assert.strictEqual(Object.isFrozen(catalog.providers[0].models[0]), true);
});

test('capability statuses are explicit and static catalog data cannot become runtime proof', () => {
  const profile = createHostProfile({
    ...HOST_PROFILE,
    access: {
      ...HOST_PROFILE.access,
      'codex-cli': { status: 'BLOCKED', evidence: 'Host policy denied external CLI' },
      agy: { status: 'UNAVAILABLE', evidence: 'missing executable: agy' },
    },
  });
  assert.strictEqual(profile.access['codex-cli'].status, 'BLOCKED');
  assert.strictEqual(profile.access.agy.status, 'UNAVAILABLE');
  assert.ok(PROVIDER_CATALOG.providers.some((entry) => entry.provider === 'codex-cli'));
});

test('v1 compatibility translation preserves alias and resolves one canonical v2 request', () => {
  const translated = translateLegacyRequest({
    schema: 'dhpk.cli.request.v1',
    host_profile: HOST_PROFILE,
    task_id: 'legacy-task-1',
    attempt_id: 'legacy-attempt-1',
    requested_role: 'codex-fast-worker',
    mode: 'workspace-write',
    model: 'sol5.6',
    effort: 'high',
    task: { description_digest: 'c'.repeat(64) },
    scope: request().scope,
  });
  assert.strictEqual(translated.request.schema, SCHEMAS.REQUEST);
  assert.strictEqual(translated.request.role, 'worker');
  assert.strictEqual(translated.request.target.provider, 'codex-cli');
  assert.strictEqual(translated.request.target.model, 'sol5.6');
  assert.strictEqual(translated.compatibility.requested_alias, 'codex-fast-worker');
  assert.strictEqual(translated.compatibility.canonical_role, 'worker');
  assert.strictEqual(translated.compatibility.provider_constraint, 'codex-cli');
  assert.strictEqual(translated.compatibility.deprecated, true);
});

test('codex-bridge translation requires explicit mode and never guesses a Role', () => {
  assert.throws(() => translateLegacyRequest({
    schema: 'dhpk.cli.context.v1',
    host_profile: HOST_PROFILE,
    task_id: 'legacy-task-2',
    attempt_id: 'legacy-attempt-2',
    requested_role: 'codex-bridge',
    task: { description_digest: 'd'.repeat(64) },
    scope: request().scope,
  }), /explicit.*mode/i);

  const reviewer = translateLegacyRequest({
    schema: 'dhpk.cli.context.v1',
    host_profile: HOST_PROFILE,
    task_id: 'legacy-task-3',
    attempt_id: 'legacy-attempt-3',
    requested_role: 'codex-bridge',
    mode: 'read-only',
    task: { description_digest: 'e'.repeat(64) },
    scope: request().scope,
  });
  assert.strictEqual(reviewer.request.role, 'reviewer');
  assert.strictEqual(reviewer.request.authority, 'read-only');
});

test('v2 receipt identifies target and verification without raw prompt, output, or secret content', () => {
  const normalized = createDispatchRequest(request({
    role: 'reasoner',
    authority: 'read-only',
    target: { provider: 'codex-cli', model: 'sol5.6', transport: 'local-cli' },
  }));
  const receipt = createDispatchReceipt({
    receipt_id: 'receipt-contract-1',
    request: normalized,
    target: { provider: 'codex-cli', model: 'sol5.6', effort: 'high', transport: 'local-cli' },
    status: 'SUCCEEDED',
    verification: 'PASSED',
    catalog_version: 'provider-catalog.v1',
    adapter_version: 'codex-adapter.v1',
    capability_evidence: { status: 'AVAILABLE', source: 'fixture' },
    prompt: 'raw prompt must not be persisted',
    output: 'raw output must not be persisted',
    secret: 'secret must not be persisted',
  });
  assert.strictEqual(receipt.schema, SCHEMAS.RECEIPT);
  assert.strictEqual(receipt.requested_role, 'reasoner');
  assert.strictEqual(receipt.resolved_target.identity, 'codex-cli/sol5.6');
  assert.strictEqual(receipt.verification, 'PASSED');
  assert.strictEqual(receipt.host_profile_version, HOST_PROFILE.version);
  const serialized = JSON.stringify(receipt);
  assert.ok(!serialized.includes('raw prompt must not be persisted'));
  assert.ok(!serialized.includes('raw output must not be persisted'));
  assert.ok(!serialized.includes('secret must not be persisted'));
});

test('receipt evidence rejects raw or provider-private fields', () => {
  const normalized = createDispatchRequest(request({
    role: 'reasoner',
    authority: 'read-only',
  }));
  assert.throws(() => createDispatchReceipt({
    receipt_id: 'receipt-contract-2',
    request: normalized,
    status: 'BLOCKED',
    fallback_history: [{ provider: 'codex-cli', raw_output: 'must not cross receipt boundary' }],
  }), /fallback_history.*unsupported/i);
  assert.throws(() => createDispatchReceipt({
    receipt_id: 'receipt-contract-3',
    request: normalized,
    status: 'BLOCKED',
    capability_evidence: { secret: 'must not cross receipt boundary' },
  }), /capability_evidence.*unsupported/i);
});

test('legacy transport names translate to the canonical local-cli transport', () => {
  const translated = translateLegacyRequest({
    schema: 'dhpk.cli.context.v1',
    host_profile: HOST_PROFILE,
    task_id: 'legacy-task-4',
    attempt_id: 'legacy-attempt-4',
    requested_role: 'codex-fast-worker',
    mode: 'workspace-write',
    transport: 'codex-exec',
    task: { description_digest: 'f'.repeat(64) },
    scope: request().scope,
  });
  assert.strictEqual(translated.request.target.transport, 'local-cli');
});

run('dispatch-contract');
