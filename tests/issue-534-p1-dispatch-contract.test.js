'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  CAPABILITY_STATUSES,
  SUPPORT_STATUSES,
  SCHEMAS,
  createHostProfile,
  createDispatchRequest,
  createProviderModelCatalog,
  translateLegacyRequest,
} = require('../scripts/lib/dispatch-contract');
const { buildInvocation } = require('../scripts/lib/provider-cli-adapters');
const { validateDispatchPlatformEvidence } = require('../scripts/lib/dispatch-platform-validation');

const timestamp = '2026-09-16T00:00:00.000Z';

const catalog = {
  schema: 'dhpk.model.catalog.v2',
  version: 'model-catalog.v2',
  observed_at: timestamp,
  models: {
    'anthropic/sonnet-5': {
      provider: 'anthropic',
      model_id: 'sonnet-5',
      display_name: 'Claude Sonnet 5',
      pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
    },
    'openai/gpt-5.6-luna': {
      provider: 'openai',
      model_id: 'gpt-5.6-luna',
      display_name: 'GPT-5.6 Luna',
      pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
    },
    'google/gemini-3.8-flash-high': {
      provider: 'google',
      model_id: 'gemini-3.8-flash-high',
      display_name: 'Gemini 3.8 Flash (High)',
      pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
    },
    'xai/cursor-grok-4.6-high': {
      provider: 'xai',
      model_id: 'cursor-grok-4.6-high',
      display_name: 'Grok 4.6 (High)',
      pricing: { unit: '1M tokens', input: 'unknown', output: 'unknown', currency: 'USD', source_url: 'not-published', observed_at: timestamp },
    },
  },
  routes: [
    {
      host: 'claude-code', target_agent: 'claude-code', provider: 'anthropic', model_id: 'sonnet-5',
      invocation_aliases: ['claude', 'claude-code'], route: 'native', transport: 'native-runtime',
      roles: ['planner', 'reasoner', 'worker', 'reviewer'], efforts: ['low', 'medium', 'high', 'max'],
      authorities: ['read-only', 'workspace-write'], effort_binding: 'parameter',
      parameter_mapping: { model: 'model_id', effort: '--effort' }, source: 'claude --help', observed_at: timestamp,
    },
    {
      host: 'cursor', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna',
      invocation_aliases: ['codex'], route: 'headless-cli', transport: 'local-cli',
      roles: ['worker'], efforts: ['high'], authorities: ['workspace-write'], effort_binding: 'parameter',
      parameter_mapping: { model: '-m', effort: 'model_reasoning_effort' }, source: 'codex --help', observed_at: timestamp,
    },
    {
      host: 'agy', target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high',
      invocation_aliases: ['agy'], route: 'native', transport: 'native-runtime',
      roles: ['worker'], efforts: ['high'], authorities: ['workspace-write'], effort_binding: 'embedded',
      parameter_mapping: { model: 'model_id' }, source: 'agy models', observed_at: timestamp,
    },
    {
      host: 'cursor', target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high',
      invocation_aliases: ['cursor'], route: 'native', transport: 'native-runtime',
      roles: ['planner', 'reasoner', 'worker', 'reviewer'], efforts: ['high'], authorities: ['read-only', 'workspace-write'], effort_binding: 'embedded',
      parameter_mapping: { model: 'model_id' }, source: 'cursor-agent models', observed_at: timestamp,
    },
  ],
};

const profile = {
  schema: 'dhpk.host.profile.v1', version: 'cursor.v2', host: 'cursor',
  native_provider: 'xai', native_model: 'cursor-grok-4.6-high', native_transport: 'native-runtime',
  allowed_providers: ['xai', 'anthropic', 'openai', 'google'],
  access: {
    xai: { status: 'AVAILABLE', evidence: 'cursor native runtime fixture' },
    anthropic: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
    openai: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
    google: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
  },
  quota_pools: { xai: 'cursor', anthropic: 'anthropic', openai: 'openai', google: 'google' },
  concurrency_limits: { cursor: 1, anthropic: 1, openai: 1, google: 1 }, observed_at: timestamp,
};

function request(overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST,
    host_profile: profile,
    task_id: 'route-boundary-task',
    attempt_id: 'route-boundary-attempt',
    role: 'worker',
    authority: 'workspace-write',
    task: { description_digest: 'a'.repeat(64) },
    scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
    effort: 'high',
    fallback: { allow: false, retry_budget: 0 },
    parallelism: { dependencies: [], max_concurrency: 1 },
    ...overrides,
  };
}

test('v2 catalog is a flat Host/Target-Agent/Provider/Model/Route matrix', () => {
  const normalized = createProviderModelCatalog(catalog);
  assert.strictEqual(normalized.schema, SCHEMAS.CATALOG);
  assert.strictEqual(normalized.schema, 'dhpk.model.catalog.v2');
  assert.ok(normalized.models['anthropic/sonnet-5']);
  assert.strictEqual(normalized.routes.length, 4);
  assert.strictEqual(normalized.routes[0].target_agent, 'claude-code');
  assert.strictEqual(normalized.routes[0].provider, 'anthropic');
  assert.strictEqual(normalized.routes[0].model_id, 'sonnet-5');
  assert.strictEqual(normalized.routes[0].route, 'native');
  assert.strictEqual(normalized.routes[2].effort_binding, 'embedded');
  assert.ok(!normalized.routes.some((row) => row.provider === 'cursor-native'));
  assert.ok(!Object.keys(normalized.models).some((id) => id.endsWith('/cursor-default')));
});

test('canonical requests reject caller-selected routes', () => {
  assert.throws(() => createDispatchRequest(request({
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna', route: 'headless-cli', transport: 'local-cli' },
  })), /target\.route.*catalog.*request boundary/i);
});

test('v2 catalog rejects duplicate route identity and placeholder Provider rows', () => {
  assert.throws(() => createProviderModelCatalog({
    ...catalog,
    routes: [...catalog.routes, catalog.routes[0]],
  }), /duplicate.*route|identity/i);
  assert.throws(() => createProviderModelCatalog({
    ...catalog,
    routes: [{ ...catalog.routes[0], provider: 'cursor-native' }],
  }), /Provider|vendor|unsupported/i);
});

test('Host Profiles expose defaults separately from static catalog support', () => {
  const normalized = createHostProfile({
    ...profile,
    role_defaults: {
      planner: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
      reasoner: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
      worker: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
      reviewer: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', effort: 'high' },
    },
    role_fallbacks: { planner: [], reasoner: [], worker: [], reviewer: [] },
  });
  assert.strictEqual(normalized.role_defaults.worker.model_id, 'cursor-grok-4.6-high');
  assert.deepStrictEqual(normalized.role_fallbacks.worker, []);
  assert.deepStrictEqual(SUPPORT_STATUSES, ['SUPPORTED', 'UNSUPPORTED']);
  assert.deepStrictEqual(CAPABILITY_STATUSES, ['AVAILABLE', 'UNAVAILABLE', 'BLOCKED', 'NOT_RUN']);
});

test('legacy Role aliases carry only canonical Role and authority', () => {
  const translated = translateLegacyRequest({
    schema: 'dhpk.cli.request.v1', host_profile: profile, task_id: 'legacy-p1', attempt_id: 'attempt-p1',
    requested_role: 'codex-fast-worker', mode: 'workspace-write', model: 'gpt-5.6-luna', effort: 'high',
    task: { description_digest: 'a'.repeat(64) },
    scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: 'b'.repeat(64) } },
  });
  assert.strictEqual(translated.compatibility.provider_constraint, null);
  assert.strictEqual(translated.request.target, undefined);
  assert.match(translated.compatibility.diagnostic, /explicit target/i);
});

test('static catalog support cannot be reported as runtime availability', () => {
  const evidence = validateDispatchPlatformEvidence({
    hostProfile: profile, catalog, target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna', effort: 'high', route: 'headless-cli', transport: 'local-cli' },
  });
  assert.strictEqual(evidence.status.catalog_support, 'SUPPORTED');
  assert.strictEqual(evidence.status.runtime, 'NOT_RUN');
});

test('all four adapters expose explicit argv contracts and Claude reads prompt from stdin', () => {
  const request = { authority: 'read-only', scope: { workdir: '/workspace' } };
  const claude = buildInvocation({ target_agent: 'claude-code', provider: 'anthropic', model_id: 'sonnet-5', model: 'sonnet-5', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
  assert.deepStrictEqual(claude.argv, ['--print', '--model', 'sonnet-5', '--effort', 'high', '--output-format', 'json']);
  assert.strictEqual(claude.stdin_mode, 'prompt');
  assert.ok(!claude.argv.includes('--prompt-file'));

  const codex = buildInvocation({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-luna', model: 'gpt-5.6-luna', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, request);
  assert.ok(codex.argv.includes('-m') && codex.argv.includes('gpt-5.6-luna'));
  const agy = buildInvocation({ target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', model: 'gemini-3.8-flash-high', effort: 'high', route: 'headless-cli', transport: 'local-cli' }, { ...request, authority: 'workspace-write' });
  assert.ok(agy.argv.includes('--model'));
  const cursor = buildInvocation({ target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', model: 'cursor-grok-4.6-high', effort: 'high', route: 'native', transport: 'native-runtime' }, request);
  assert.deepStrictEqual(cursor.argv, []);
});

run('issue-534-p1-dispatch-contract');
