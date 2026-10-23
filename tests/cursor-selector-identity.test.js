'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { resolveTarget } = require('../scripts/lib/dispatch-engine');
const { SCHEMAS, createProviderModelCatalog } = require('../scripts/lib/dispatch-contract');
const { cursorAgentModel } = require('../scripts/lib/cursor-harness-adapt');
const catalog = require('../manifests/provider-model-catalog.json');
const profiles = require('../manifests/host-profiles.json');

const cursorProfile = profiles.profiles.find((profile) => profile.host === 'cursor');

function request(overrides = {}) {
  return {
    schema: SCHEMAS.REQUEST,
    host_profile: cursorProfile,
    task_id: 'cursor-selector-task',
    attempt_id: 'cursor-selector-attempt',
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
    effort: 'medium',
    fallback: { allow: false, retry_budget: 0 },
    parallelism: { dependencies: [], max_concurrency: 1 },
    ...overrides,
  };
}

test('selected Cursor projection selectors have catalog identities without a new route', () => {
  const normalized = createProviderModelCatalog(catalog);
  const fast = normalized.models['cursor/composer-2.5-fast'];
  const grok = normalized.models['xai/cursor-grok-4.6-high'];
  assert.ok(fast, 'composer-2.5-fast selector identity');
  assert.strictEqual(fast.provider, 'cursor');
  assert.strictEqual(fast.model_id, 'composer-2.5-fast');
  assert.ok(grok, 'cursor-grok-4.6-high selector identity');
  assert.strictEqual(grok.model_id, 'cursor-grok-4.6-high');
  assert.strictEqual(normalized.routes.some((route) => route.model_id === 'composer-2.5-fast'), false);
  const grokRoutes = normalized.routes.filter((route) => route.model_id === 'cursor-grok-4.6-high');
  assert.strictEqual(grokRoutes.length, 1);
  assert.deepStrictEqual(grokRoutes[0].roles, ['worker']);
  assert.deepStrictEqual(grokRoutes[0].authorities, ['workspace-write']);
  assert.strictEqual(cursorProfile.role_defaults.worker.model_id, 'composer-2.5');
  assert.strictEqual(cursorAgentModel('doc-reviewer.md'), 'composer-2.5-fast');
  assert.strictEqual(cursorAgentModel('code-reviewer.md'), 'cursor-grok-4.6-high');
});

test('a selector identity does not open an unsupported flow-drive combination', () => {
  const fast = resolveTarget(request({
    target: { target_agent: 'cursor', provider: 'cursor', model_id: 'composer-2.5-fast', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(fast.status, 'UNAVAILABLE');
  assert.match(fast.reason, /unsupported for Host cursor/);

  const grokReviewer = resolveTarget(request({
    role: 'reviewer',
    authority: 'read-only',
    effort: 'high',
    target: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', transport: 'native-runtime' },
  }), { catalog });
  assert.notStrictEqual(grokReviewer.status, 'RESOLVED');
  assert.match(grokReviewer.reason, /does not support Role reviewer/);

  const grokWorker = resolveTarget(request({
    role: 'worker',
    authority: 'workspace-write',
    effort: 'high',
    target: { target_agent: 'cursor', provider: 'xai', model_id: 'cursor-grok-4.6-high', transport: 'native-runtime' },
  }), { catalog });
  assert.strictEqual(grokWorker.status, 'NOT_RUN');
  assert.strictEqual(grokWorker.fallback_eligible, false);
});

run('cursor-selector-identity');
