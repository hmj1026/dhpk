'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SCHEMA,
  createFlowHandoff,
  validateFlowHandoff,
} = require('../scripts/lib/flow-handoff-contract');

const ROOT = path.join(__dirname, '..');

test('shared flow handoff carries Host-neutral target and evidence without execution authority', () => {
  const handoff = createFlowHandoff({
    handoff_id: 'handoff-flow-1',
    owner: 'flow-drive',
    host: 'cursor',
    disposition: 'ready',
    target: {
      provider: 'codex-cli',
      model: 'sol5.6',
      role: 'reasoner',
      effort: 'high',
      transport: 'local-cli',
    },
    evidence: [{ kind: 'capability', state: 'available', detail: 'bounded probe receipt' }],
    next_action: '$flow-drive confirmed-change',
  });

  assert.strictEqual(handoff.schema, SCHEMA);
  assert.strictEqual(handoff.target.role, 'reasoner');
  assert.strictEqual(handoff.execution, 'not-started');
  assert.strictEqual(Object.isFrozen(handoff), true);
  assert.doesNotThrow(() => validateFlowHandoff(handoff));
});

test('shared handoff rejects provider-private execution claims and unsupported target fields', () => {
  assert.throws(() => createFlowHandoff({
    handoff_id: 'handoff-flow-2', owner: 'flow-guide', host: 'cursor', disposition: 'ready',
    target: { provider: 'codex-cli', argv: ['codex', 'exec'] },
    next_action: 'inspect',
  }), /unsupported fields/i);
  assert.throws(() => validateFlowHandoff({
    handoff_id: 'handoff-flow-3', owner: 'flow-guide', host: 'cursor', disposition: 'ready',
    next_action: 'inspect', execution: 'SUCCEEDED',
  }), /cannot claim execution|execution/i);
});

test('flow skills do not import each other or duplicate the shared contract', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'skills', 'flow-guide', 'SKILL.md'), 'utf8');
  const drive = fs.readFileSync(path.join(ROOT, 'skills', 'flow-drive', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(guide, /require\([^)]*flow-drive|import[^\n]*flow-drive/i);
  assert.doesNotMatch(drive, /require\([^)]*flow-guide|import[^\n]*flow-guide/i);
  assert.match(guide, /shared.*handoff|neutral.*contract/i);
  assert.match(drive, /shared.*handoff|neutral.*contract/i);
});

test('flow-guide adapts its closed route result into the shared handoff contract', () => {
  const route = require('../skills/flow-guide/scripts/route-result').createRouteResult({
    host: 'cursor', argv: ['--go', 'implement', 'the', 'confirmed', 'change'],
    observed: { invocationClasses: { 'flow-drive': 'explicit-only' } },
  });
  const handoff = require('../skills/flow-guide/scripts/route-result').createRouteHandoff(route);
  assert.strictEqual(handoff.schema, SCHEMA);
  assert.strictEqual(handoff.owner, 'flow-drive');
  assert.strictEqual(handoff.execution, 'not-started');
});

test('flow-guide route contract accepts each supported Host identity', () => {
  const { createRouteResult } = require('../skills/flow-guide/scripts/route-result');
  for (const host of ['claude-code', 'codex-cli', 'agy', 'cursor']) {
    const result = createRouteResult({ host, argv: ['inspect', 'the', 'route'] });
    assert.strictEqual(result.host, host);
  }
});

test('flow-drive validates confirmation and resolves Roles through the common Dispatch Engine', () => {
  const { prepareDispatch } = require('../skills/flow-drive/scripts/dispatch');
  const result = prepareDispatch({
    change: { confirmed: true, change_id: 'provider-neutral-subagent-orchestration' },
    request: {
      schema: 'dhpk.dispatch.request.v2',
      host_profile: {
        schema: 'dhpk.host.profile.v1', version: 'test.v1', host: 'cursor',
        native_provider: 'cursor-native', native_model: 'cursor-default', native_transport: 'native-runtime',
        allowed_providers: ['cursor-native'],
        access: { 'cursor-native': { status: 'AVAILABLE', evidence: 'test native runtime' } },
        quota_pools: { 'cursor-native': 'native' }, concurrency_limits: { native: 1 },
        observed_at: '2026-09-11T00:00:00.000Z',
      },
      task_id: 'flow-drive-task', attempt_id: 'flow-drive-attempt', role: 'reviewer', authority: 'read-only',
      task: { description_digest: '1'.repeat(64) },
      scope: { workdir: '/workspace', assigned_files: [], prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: '2'.repeat(64) } },
      effort: 'high', fallback: { allow: false, retry_budget: 0 }, parallelism: { dependencies: [], max_concurrency: 1 },
    },
    catalog: require('../manifests/provider-model-catalog.json'),
  });
  assert.strictEqual(result.resolution.status, 'RESOLVED');
  assert.strictEqual(result.resolution.request.role, 'reviewer');
  assert.strictEqual(result.handoff.execution, 'not-started');
  assert.throws(() => prepareDispatch({ change: { confirmed: false }, request: result.request, catalog: require('../manifests/provider-model-catalog.json') }), /confirmed change/i);
});

run('flow-contract');
