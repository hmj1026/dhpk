'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  DEFAULT_CROSS_PROVIDER,
  ROLE_POLICY,
  resolveDispatchPlan,
} = require('../scripts/lib/native-dispatch-policy');

const ROOT = path.join(__dirname, '..');

test('all delegated roles share the native-only default dispatch plan', () => {
  assert.strictEqual(DEFAULT_CROSS_PROVIDER, false);

  for (const role of ['planner', 'reasoner', 'worker', 'reviewer']) {
    const plan = resolveDispatchPlan({
      role,
      requestedBackend: 'auto',
      configuredOrder: ['codex', 'agy', 'claude'],
    });

    assert.deepStrictEqual(plan, {
      role,
      native_backend: 'claude',
      requested_backend: 'auto',
      candidate_scope: 'native-only',
      candidates: ['claude'],
      suppressed_candidates: [
        { backend: 'codex', reason: 'cross-provider disabled' },
        { backend: 'agy', reason: 'cross-provider disabled' },
      ],
      native_agent: ROLE_POLICY[role].native_agent,
    });
  }
});

test('explicit targets remain directional while automatic cross-provider expansion stays opt-in', () => {
  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'worker',
    requestedBackend: 'codex',
    configuredOrder: ['claude', 'codex', 'agy'],
  }), {
    role: 'worker',
    native_backend: 'claude',
    requested_backend: 'codex',
    candidate_scope: 'explicit',
    candidates: ['codex'],
    suppressed_candidates: [],
    native_agent: 'dhpk:fast-worker',
  });

  assert.deepStrictEqual(resolveDispatchPlan({
    role: 'reasoner',
    requestedBackend: 'auto',
    configuredOrder: ['claude', 'codex', 'agy'],
    crossProvider: true,
  }), {
    role: 'reasoner',
    native_backend: 'claude',
    requested_backend: 'auto',
    candidate_scope: 'cross-provider',
    candidates: ['claude', 'codex', 'agy'],
    suppressed_candidates: [],
    native_agent: 'dhpk:deep-reasoner',
  });
});

test('unknown roles fail closed before a dispatch plan can be created', () => {
  assert.throws(
    () => resolveDispatchPlan({ role: 'architect', requestedBackend: 'auto' }),
    /unknown delegated role: architect/,
  );
});

test('delegated role definitions point to the shared native dispatch policy', () => {
  for (const role of ['planner', 'deep-reasoner', 'fast-worker', 'code-reviewer']) {
    const document = fs.readFileSync(path.join(ROOT, 'agents', `${role}.md`), 'utf8');
    assert.ok(document.includes('Native dispatch baseline'), `${role} missing native dispatch policy reference`);
    assert.ok(document.includes('${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md'), `${role} missing execution policy reference`);
  }
});

run('native-dispatch-policy');
