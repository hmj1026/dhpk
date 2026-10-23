'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { prepareDispatch } = require('../skills/flow-drive/scripts/dispatch');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const { dispatch } = require('../scripts/lib/dispatch');
const { createAdapterRegistry } = require('../scripts/lib/provider-adapter');
const { createRunnerFixture } = require('./_lib/flow-drive-runner-fixtures');
const profiles = require('../manifests/host-profiles.json');
const catalog = require('../manifests/provider-model-catalog.json');

const DIGEST = 'a'.repeat(64);
const CASES = [
  ['cursor', 'planner', 'claude-code', 'anthropic', 'claude-opus-5-5-high', 'native', 'native-runtime'],
  ['cursor', 'reasoner', 'claude-code', 'anthropic', 'claude-opus-5-5-high', 'native', 'native-runtime'],
  ['cursor', 'reviewer', 'codex-cli', 'openai', 'gpt-5.6-sol-high', 'native', 'native-runtime'],
  ['agy', 'reasoner', 'agy', 'anthropic', 'claude-opus-4-6-thinking', 'native', 'native-runtime'],
  ['agy', 'reviewer', 'agy', 'anthropic', 'claude-opus-4-6-thinking', 'native', 'native-runtime'],
];

function profile(host) {
  return profiles.profiles.find((entry) => entry.host === host);
}

function scope() {
  return {
    workdir: '/workspace',
    assigned_files: [],
    prompt_evidence: { path: '/workspace/prompt', dev: 1, ino: 2, sha256: DIGEST },
  };
}

function dispatchRequest(host, role, overrides = {}) {
  const hostProfile = profile(host);
  return {
    change: { confirmed: true, change_id: 'native-evidence' },
    request: {
      schema: 'dhpk.dispatch.request.v2',
      host_profile: hostProfile,
      task_id: 'native-evidence',
      attempt_id: 'native-evidence-1',
      role,
      authority: 'read-only',
      task: { description_digest: DIGEST },
      scope: scope(),
      effort: hostProfile.role_defaults[role].effort,
      fallback: { allow: true, retry_budget: 1 },
      parallelism: { dependencies: [], max_concurrency: 1 },
      ...overrides,
    },
    catalog,
  };
}

function assertMissingEvidenceDiagnostic(detail, host, role, agent, provider, selector, route, transport) {
  for (const phrase of [
    `Host ${host}`,
    `role ${role}`,
    'authority read-only',
    `Target Agent ${agent}`,
    `Provider ${provider}`,
    `selector ${selector}`,
    `route ${route}`,
    `transport ${transport}`,
    'missing session-bound capability evidence',
    'resolution stays NOT_RUN',
    'not an observed model',
    'Host.getCapabilities',
    'existing capability schema',
    'static AVAILABLE',
    'arbitrary fallback',
    'model list',
  ]) {
    assert.ok(detail.includes(phrase), `missing ${phrase} in ${detail}`);
  }
}

for (const [host, role, agent, provider, selector, route, transport] of CASES) {
  test(`${host} ${role} without bound evidence stays NOT_RUN and names the gap`, () => {
    const prepared = prepareDispatch(dispatchRequest(host, role));
    assert.strictEqual(prepared.resolution.status, 'NOT_RUN');
    assert.strictEqual(prepared.resolution.fallback_eligible, false);
    assert.strictEqual(prepared.handoff.evidence[0].state, 'not-run');
    assertMissingEvidenceDiagnostic(
      prepared.handoff.evidence[0].detail,
      host, role, agent, provider, selector, route, transport,
    );
  });
}

test('cursor planner runner reports NOT_RUN and does not call host.execute', async () => {
  const fixture = createRunnerFixture({
    capabilities: { host_profile: profile('cursor'), catalog },
    task: {
      goal: 'Review the receipt.',
      acceptance: ['noted'],
      constraints: { authority: 'read-only', assigned_files: [], delegation: 'none' },
    },
  });
  try {
    const report = await runFlowDrive(['Review the receipt.', '--plan'], { host: fixture.host, workdir: fixture.workdir });
    assert.strictEqual(report.blockers.length, 1);
    assert.ok(report.blockers[0].startsWith('planner NOT_RUN:'), report.blockers[0]);
    assertMissingEvidenceDiagnostic(
      report.blockers[0],
      'cursor', 'planner', 'claude-code', 'anthropic', 'claude-opus-5-5-high', 'native', 'native-runtime',
    );
    assert.deepStrictEqual(fixture.calls.map((call) => call.method), ['resolveTask', 'getCapabilities']);
  } finally {
    fixture.cleanup();
  }
});

test('dispatch does not execute a readonly default that lacks bound evidence', async () => {
  const calls = [];
  const registry = createAdapterRegistry({
    executors: { anthropic: () => { calls.push('execute'); return { status: 'SUCCEEDED' }; } },
  });
  const result = await dispatch(dispatchRequest('cursor', 'planner').request, { catalog, registry, fallback: true });
  assert.strictEqual(result.resolution.status, 'NOT_RUN');
  assert.strictEqual(result.resolution.fallback_eligible, false);
  assert.deepStrictEqual(calls, []);
  assert.ok(String(result.resolution.reason).includes('Host.getCapabilities'));
});

test('matching exposed evidence resolves without claiming an observed model', () => {
  const prepared = prepareDispatch(dispatchRequest('cursor', 'planner', {
    strict_target: true,
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high' },
    execution_binding: { session_id: 'session-exposed', binding_id: 'binding-exposed' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE',
      source: 'injected Host.getCapabilities adapter', observed_at: '2026-10-21T00:00:00.000Z',
      session_id: 'session-exposed', binding_id: 'binding-exposed', host: 'cursor',
      provider: 'anthropic', target_agent: 'claude-code', model_id: 'claude-opus-5-5-high',
      role: 'planner', authority: 'read-only', effort: 'high', effort_binding: 'embedded',
      route: 'native', transport: 'native-runtime',
    },
  }));
  assert.strictEqual(prepared.resolution.status, 'RESOLVED');
  assert.strictEqual(prepared.resolution.capability.state, 'EXPOSED');
  assert.strictEqual(prepared.resolution.capability.observed_model, null);
  assert.ok(!String(prepared.handoff.evidence[0].detail).includes('model was executed'));
});

test('a mismatched executor binding stays blocked', () => {
  const prepared = prepareDispatch(dispatchRequest('agy', 'reasoner', {
    strict_target: true,
    target: { target_agent: 'agy', provider: 'anthropic', model_id: 'claude-opus-4-6-thinking' },
    execution_binding: { session_id: 'session-other', binding_id: 'binding-other' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE',
      source: 'injected Host.getCapabilities adapter', observed_at: '2026-10-21T00:00:00.000Z',
      session_id: 'session-real', binding_id: 'binding-real', host: 'agy',
      provider: 'anthropic', target_agent: 'agy', model_id: 'claude-opus-4-6-thinking',
      role: 'reasoner', authority: 'read-only', effort: 'high', effort_binding: 'embedded',
      route: 'native', transport: 'native-runtime',
    },
  }));
  assert.strictEqual(prepared.resolution.status, 'BLOCKED');
  assert.strictEqual(prepared.resolution.fallback_eligible, false);
  assert.match(prepared.resolution.reason, /bound to the injected executor/i);
});

test('explicit provider refusal is not bypassed by exposed evidence', () => {
  const hostProfile = structuredClone(profile('cursor'));
  hostProfile.access.anthropic = { status: 'BLOCKED', evidence: 'operator refused anthropic' };
  const prepared = prepareDispatch(dispatchRequest('cursor', 'planner', {
    host_profile: hostProfile,
    strict_target: true,
    target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5-high' },
    execution_binding: { session_id: 'session-exposed', binding_id: 'binding-exposed' },
    capability_evidence: {
      kind: 'host-executable-capability', state: 'EXPOSED', status: 'AVAILABLE',
      source: 'injected Host.getCapabilities adapter', observed_at: '2026-10-21T00:00:00.000Z',
      session_id: 'session-exposed', binding_id: 'binding-exposed', host: 'cursor',
      provider: 'anthropic', target_agent: 'claude-code', model_id: 'claude-opus-5-5-high',
      role: 'planner', authority: 'read-only', effort: 'high', effort_binding: 'embedded',
      route: 'native', transport: 'native-runtime',
    },
  }));
  assert.strictEqual(prepared.resolution.status, 'BLOCKED');
  assert.match(prepared.resolution.reason, /refuses this Provider/i);
});

test('confirmed unavailable access can still fall back, and native Claude and Codex defaults stay resolved', () => {
  const cursor = structuredClone(profile('cursor'));
  cursor.access.openai = { status: 'UNAVAILABLE', evidence: 'missing codex executable' };
  const unavailable = prepareDispatch(dispatchRequest('cursor', 'reviewer', {
    host_profile: cursor,
    strict_target: true,
    target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-5.6-sol-high' },
  }));
  assert.strictEqual(unavailable.resolution.status, 'UNAVAILABLE');
  assert.strictEqual(unavailable.resolution.fallback_eligible, true);
  assert.ok(!unavailable.resolution.reason.includes('missing session-bound capability evidence'));

  for (const host of ['claude-code', 'codex-cli']) {
    const native = prepareDispatch(dispatchRequest(host, 'planner'));
    assert.strictEqual(native.resolution.status, 'RESOLVED', host);
    assert.ok(!String(native.resolution.reason || '').includes('missing session-bound capability evidence'), host);
  }
});

run('native-readonly-evidence-diagnostic');
