'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { resolveTarget } = require('../scripts/lib/dispatch-engine');
const { SCHEMAS, createProviderModelCatalog } = require('../scripts/lib/dispatch-contract');

const rawCatalog = require('../manifests/provider-model-catalog.json');
const profiles = require('../manifests/host-profiles.json');
const catalog = createProviderModelCatalog(rawCatalog);
const codexProfile = profiles.profiles.find((profile) => profile.host === 'codex-cli');
const claudeProfile = profiles.profiles.find((profile) => profile.host === 'claude-code');

function request(overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST,
    host_profile: codexProfile,
    task_id: 'codex-native-effort-task',
    attempt_id: 'codex-native-effort-attempt',
    role: 'worker',
    authority: 'workspace-write',
    task: { description_digest: 'a'.repeat(64) },
    scope: {
      workdir: '/workspace/project',
      assigned_files: [],
      prompt_evidence: {
        path: '/workspace/project/.dhpk/prompt.txt',
        dev: 1,
        ino: 2,
        sha256: 'b'.repeat(64),
      },
    },
    effort: 'max',
    fallback: { allow: false, retry_budget: 0 },
    parallelism: { dependencies: [], max_concurrency: 1 },
    ...overrides,
  };
}

function nativeRoute(modelId) {
  return catalog.routes.find((route) => route.host === 'codex-cli' && route.route === 'native' && route.model_id === modelId);
}

test('codex native routes follow the 2026-10-21 cache without one global effort', () => {
  assert.deepStrictEqual(nativeRoute('gpt-6-luna').efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepStrictEqual(nativeRoute('gpt-6-sol').efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepStrictEqual(nativeRoute('gpt-6.1-sol').efforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepStrictEqual(nativeRoute('gpt-6.1-sol').roles, ['planner', 'reasoner', 'worker', 'reviewer']);
  assert.deepStrictEqual(nativeRoute('gpt-6.1-terra').efforts, ['medium']);
  assert.deepStrictEqual(nativeRoute('gpt-6.1-terra').roles, ['worker', 'reviewer']);
  assert.deepStrictEqual(
    catalog.routes.filter((route) => route.model_id === 'gpt-6.1-terra').map(({ host, route: routeType }) => ({ host, route: routeType })),
    [{ host: 'codex-cli', route: 'native' }],
  );
  for (const modelId of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol']) {
    assert.strictEqual(nativeRoute(modelId).source, 'codex-cli 0.163.0; models cache client_version 0.162.0 supported_reasoning_levels');
  }
  const headlessLuna = catalog.routes.find((route) => route.host === 'claude-code' && route.route === 'headless-cli' && route.model_id === 'gpt-6-luna');
  assert.deepStrictEqual(headlessLuna.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.strictEqual(headlessLuna.efforts.includes('ultra'), false);
  assert.deepStrictEqual(
    { model: codexProfile.role_defaults.worker.model_id, effort: codexProfile.role_defaults.worker.effort },
    { model: 'gpt-6.1-sol', effort: 'medium' },
  );
  assert.strictEqual(claudeProfile.role_fallbacks.worker[0].effort, 'high');
});

test('advertised native effort still stops when provider access is NOT_RUN', () => {
  const luna = resolveTarget(request({
    effort: 'xhigh',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(luna.status, 'RESOLVED');
  assert.strictEqual(luna.target.effort, 'xhigh');

  const sol = resolveTarget(request({
    role: 'reasoner',
    authority: 'read-only',
    effort: 'ultra',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-sol', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(sol.status, 'RESOLVED');
  assert.strictEqual(sol.target.effort, 'ultra');

  const sibling = resolveTarget(request({
    role: 'reasoner',
    authority: 'read-only',
    effort: 'xhigh',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-sol', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(sibling.status, 'RESOLVED');
  assert.strictEqual(sibling.target.effort, 'xhigh');

  const terraWorker = resolveTarget(request({
    effort: 'medium',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-terra', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(terraWorker.status, 'RESOLVED');
  assert.strictEqual(terraWorker.target.model_id, 'gpt-6.1-terra');
  assert.strictEqual(terraWorker.target.effort, 'medium');

  const terraReviewer = resolveTarget(request({
    role: 'reviewer',
    authority: 'read-only',
    effort: 'medium',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-terra', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(terraReviewer.status, 'RESOLVED');
  assert.strictEqual(terraReviewer.target.effort, 'medium');

  const terraUnsupported = resolveTarget(request({
    effort: 'high',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-terra', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(terraUnsupported.status, 'UNAVAILABLE');
  assert.strictEqual(terraUnsupported.fallback_eligible, false);
  assert.match(terraUnsupported.reason, /does not support Effort high/);

  const ultraLuna = resolveTarget(request({
    effort: 'ultra',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(ultraLuna.status, 'UNAVAILABLE');
  assert.match(ultraLuna.reason, /does not support Effort ultra/);

  const dark = {
    ...codexProfile,
    access: {
      ...codexProfile.access,
      openai: { status: 'NOT_RUN', evidence: 'bounded probe not run' },
    },
  };
  const held = resolveTarget(request({
    host_profile: dark,
    effort: 'xhigh',
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(held.status, 'NOT_RUN');
  assert.strictEqual(held.fallback_eligible, false);

  const terraHeld = resolveTarget(request({
    host_profile: dark,
    effort: 'medium',
    fallback: { allow: true, retry_budget: 1 },
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-terra', transport: 'native-runtime' },
  }), { catalog: rawCatalog });
  assert.strictEqual(terraHeld.status, 'NOT_RUN');
  assert.strictEqual(terraHeld.fallback_eligible, false);
});

run('codex-native-effort');
