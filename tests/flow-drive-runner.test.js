'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { parseInvocation } = require('../skills/flow-drive/scripts/invocation');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const {
  createRunnerFixture,
  DEFAULT_TASK,
  CODEX_PROFILE,
  CLAUDE_PROFILE,
  CATALOG,
} = require('./_lib/flow-drive-runner-fixtures');

test('a quoted task is exposed as task input while preserving the legacy change ID', () => {
  const task = 'Fix the receipt total and verify the displayed balance.';
  const parsed = parseInvocation([task]);

  assert.strictEqual(parsed.status, 'ready');
  assert.strictEqual(parsed.changeId, task);
  assert.strictEqual(parsed.taskInput, task);
});

test('a bare specification ID remains both the legacy change ID and task input', () => {
  const parsed = parseInvocation(['#918']);

  assert.strictEqual(parsed.status, 'ready');
  assert.strictEqual(parsed.changeId, '#918');
  assert.strictEqual(parsed.taskInput, '#918');
});

test('the invocation parser rejects multiple positional task inputs', () => {
  const parsed = parseInvocation(['Fix one thing.', 'Fix another thing.']);

  assert.strictEqual(parsed.status, 'blocked');
  assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.includes('only one task input is allowed')));
});

test('a native task reaches the executor and reports parser, execution, and acceptance separately', async () => {
  const fixture = createRunnerFixture();
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.status, 'REPORTED');
  assert.strictEqual(report.parser.status, 'ready');
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(report.targets.requested.provider, 'openai');
  assert.strictEqual(report.targets.resolved.provider, 'openai');
  assert.strictEqual(report.targets.resolved.route, 'native');
  assert.strictEqual(report.targets.observed.model_id, 'gpt-6-luna');
  assert.deepStrictEqual(fixture.calls.find((call) => call.method === 'resolveTask').input, 'Fix the receipt total.');
  assert.deepStrictEqual(fixture.calls.find((call) => call.method === 'resolveTask').context, { workdir: '/repo' });
  const executedTarget = fixture.calls.find((call) => call.method === 'execute').target;
  assert.deepStrictEqual({
    provider: executedTarget.provider,
    model_id: executedTarget.model_id,
    route: executedTarget.route,
    effort: executedTarget.effort,
  }, { provider: 'openai', model_id: 'gpt-6-luna', route: 'native', effort: 'max' });
  const dispatchRequest = fixture.calls.find((call) => call.method === 'execute').context.resolution.request;
  assert.strictEqual(dispatchRequest.authority, 'workspace-write');
  assert.deepStrictEqual(dispatchRequest.scope.assigned_files, ['src/receipt.js']);
});

test('bound Host capability evidence can resolve a target absent from a stale catalog', async () => {
  const fixture = createRunnerFixture({
    decision: {
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'fresh-model', effort: 'max' },
      mode: 'solo',
    },
    outcome: {
      status: 'SUCCEEDED',
      observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'fresh-model' },
    },
    capabilities: {
      host_profile: CODEX_PROFILE,
      catalog: { ...CATALOG, routes: CATALOG.routes.filter((route) => route.model_id !== 'fresh-model') },
    },
  });
  const original = fixture.host.getCapabilities;
  fixture.host.getCapabilities = async (context) => ({
    ...(await original(context)),
    capability_evidence: {
      kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'stub injected executor',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
      host: 'codex-cli', target_agent: 'codex-cli', provider: 'openai', model_id: 'fresh-model',
      role: 'worker', authority: 'workspace-write', effort: 'max', effort_binding: 'parameter',
      route: 'native', transport: 'native-runtime',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.status, 'REPORTED');
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'PASSED');
  const call = fixture.calls.find((entry) => entry.method === 'execute');
  assert.strictEqual(call.context.execution_binding.binding_id.startsWith('flow-drive-binding-'), true);
  assert.strictEqual(call.context.resolution.target.model_id, 'fresh-model');
});

test('a contradictory observed Provider blocks acceptance', async () => {
  const fixture = createRunnerFixture({
    outcome: { status: 'SUCCEEDED', observed_target: { target_agent: 'codex-cli', provider: 'anthropic', model_id: 'gpt-6-luna' } },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
  assert.ok(report.blockers.some((blocker) => blocker.includes('observed provider')));
});

test('runner blocks capability evidence bound to another session', async () => {
  const fixture = createRunnerFixture();
  const original = fixture.host.getCapabilities;
  fixture.host.getCapabilities = async (context) => ({
    ...(await original(context)),
    capability_evidence: {
      kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'wrong binding fixture',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: 'other-session', binding_id: 'other-binding',
      host: 'codex-cli', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', role: 'worker', authority: 'workspace-write', effort: 'max', effort_binding: 'parameter', route: 'native', transport: 'native-runtime',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('an executor success remains distinct from a failed acceptance check', async () => {
  const fixture = createRunnerFixture({
    acceptance: { status: 'FAILED', evidence: 'the displayed total is 19, expected 20' },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.status, 'REPORTED');
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'FAILED');
  assert.strictEqual(report.acceptance.evidence, 'the displayed total is 19, expected 20');
});

test('a successful verifier result cannot pass a failed execution', async () => {
  const fixture = createRunnerFixture({
    outcome: { status: 'FAILED', observed_target: { provider: 'openai', model_id: 'gpt-6-luna' } },
    acceptance: { status: 'PASSED', evidence: 'the final state appears correct' },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.execution.status, 'FAILED');
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
  assert.ok(report.blockers.includes('acceptance requires successful execution and non-empty verification evidence'));
});

test('a successful verifier without evidence cannot produce accepted status', async () => {
  const fixture = createRunnerFixture({ acceptance: { status: 'PASSED' } });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
  assert.ok(report.blockers.includes('acceptance requires successful execution and non-empty verification evidence'));
});

test('an external provider selection is blocked when --cross-provider has no exact authorization', async () => {
  const fixture = createRunnerFixture({
    task: {
      goal: 'Update the receipt total display.',
      acceptance: ['The displayed total matches the receipt lines.'],
      constraints: { authority: 'workspace-write', assigned_files: ['src/receipt.js'] },
    },
    decision: {
      target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5', effort: 'max' },
      mode: 'solo',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.', '--cross-provider'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(report.execution.status, 'NOT_RUN');
  assert.strictEqual(report.acceptance.status, 'NOT_RUN');
  assert.ok(report.parser.notices.some((notice) => notice.includes('--cross-provider')));
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
  assert.strictEqual(fixture.calls.some((call) => call.method === 'verify'), false);
});

test('an exact external target resolves only when the task constraint permits that Provider', async () => {
  const hostProfile = {
    ...CLAUDE_PROFILE,
    access: {
      ...CLAUDE_PROFILE.access,
      openai: { status: 'AVAILABLE', evidence: 'stub Host exposes the selected OpenAI target' },
    },
  };
  const task = {
    goal: 'Use the explicitly selected OpenAI target for the bounded task.',
    acceptance: ['The requested result is independently verified.'],
    constraints: { provider: 'openai', authority: 'workspace-write', assigned_files: ['src/receipt.js'] },
  };
  const fixture = createRunnerFixture({
    task,
    capabilities: { host_profile: hostProfile, catalog: CATALOG },
    decision: {
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'high' },
      mode: 'solo',
    },
  });
  const report = await runFlowDrive(['#918', '--worker-target=codex/gpt-6-luna:high'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'REPORTED');
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.targets.resolved.provider, 'openai');
  assert.strictEqual(report.targets.resolved.route, 'headless-cli');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), true);
});

test('an exact alternate target tuple remains within the current Provider', async () => {
  const fixture = createRunnerFixture({
    decision: {
      target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'high' },
      mode: 'solo',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.', '--worker-target=codex/gpt-6-luna:high'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'REPORTED');
  assert.strictEqual(report.targets.resolved.provider, 'openai');
  assert.strictEqual(report.targets.resolved.route, 'native');
  assert.strictEqual(report.targets.resolved.effort, 'high');
  assert.strictEqual(report.parser.notices.some((notice) => notice.includes('--cross-provider')), false);
});

test('a task Provider constraint takes precedence over an exact legacy worker target', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { provider: 'openai' } },
    decision: {
      target: { target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5', effort: 'max' },
      mode: 'solo',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.', '--worker-target=claude/claude-opus-5-5:max'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.deepStrictEqual(report.blockers, ['selected Provider conflicts with the task constraint']);
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('an unknown Provider is not inferred from a known Target Agent', async () => {
  const fixture = createRunnerFixture({
    decision: {
      target: { target_agent: 'codex-cli', provider: 'future-vendor', model_id: 'future-model' },
      mode: 'solo',
    },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(report.blockers[0], 'Host coordination did not select a valid target');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('an unresolved task reports missing acceptance and does not start dispatch', async () => {
  const fixture = createRunnerFixture({ task: { goal: DEFAULT_TASK.goal, acceptance: [], constraints: {} } });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(report.parser.status, 'ready');
  assert.deepStrictEqual(report.blockers, ['task acceptance is missing']);
  assert.strictEqual(fixture.calls.some((call) => call.method === 'getCapabilities'), false);
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('a write task without an assigned file scope is blocked before capability lookup', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { authority: 'workspace-write', assigned_files: [] } },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.deepStrictEqual(report.blockers, ['task a non-empty write scope assigned_files constraint is missing']);
  assert.strictEqual(fixture.calls.some((call) => call.method === 'getCapabilities'), false);
});

test('read-only tasks remain read-only when no authority is supplied', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { provider: 'openai' } },
  });
  const report = await runFlowDrive(['Inspect the receipt total.'], { host: fixture.host, workdir: '/repo' });
  const dispatchRequest = fixture.calls.find((call) => call.method === 'execute').context.resolution.request;

  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(dispatchRequest.authority, 'read-only');
  assert.deepStrictEqual(dispatchRequest.scope.assigned_files, []);
});

test('file and specification inputs reach Host task resolution unchanged', async () => {
  const fixture = createRunnerFixture();
  await runFlowDrive(['/tmp/confirmed-task.md'], { host: fixture.host, workdir: '/repo' });
  await runFlowDrive(['#918'], { host: fixture.host, workdir: '/repo' });

  assert.deepStrictEqual(fixture.calls.filter((call) => call.method === 'resolveTask').map((call) => call.input), [
    '/tmp/confirmed-task.md',
    '#918',
  ]);
});

test('unsupported advanced selection returns a migration notice instead of being ignored', async () => {
  for (const option of ['--plan', '--reasoner=codex', '--architect']) {
    const fixture = createRunnerFixture();
    const report = await runFlowDrive(['Fix the receipt total.', option], {
      host: fixture.host,
      workdir: '/repo',
    });

    assert.strictEqual(report.status, 'BLOCKED', option);
    assert.strictEqual(report.parser.status, 'ready', option);
    assert.ok(report.parser.notices.some((notice) => notice.includes('legacy Flow Drive path')), option);
    assert.strictEqual(fixture.calls.some((call) => call.method === 'resolveTask'), false, option);
  }
});

test('--no-architect remains a notice-only compatibility option', async () => {
  const fixture = createRunnerFixture();
  const report = await runFlowDrive(['Fix the receipt total.', '--no-architect'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'REPORTED');
  assert.ok(report.parser.notices.some((notice) => notice.includes('--no-architect')));
});

test('retired --codex remains a blocking parser diagnostic', async () => {
  const fixture = createRunnerFixture();
  const report = await runFlowDrive(['Fix the receipt total.', '--codex'], {
    host: fixture.host,
    workdir: '/repo',
  });

  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(report.parser.status, 'blocked');
  assert.ok(report.parser.diagnostics.some((diagnostic) => diagnostic.includes('--codex is retired')));
  assert.strictEqual(fixture.calls.length, 0);
});

run('flow-drive-runner');
