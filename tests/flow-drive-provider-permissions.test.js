'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const {
  createRunnerFixture,
  CODEX_PROFILE,
  CLAUDE_PROFILE,
  CATALOG,
} = require('./_lib/flow-drive-runner-fixtures');

function makeWorkdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `flow-drive-provider-permissions-${prefix}-`));
}

function makeTask({ delegation = 'none', strictTarget } = {}) {
  return {
    goal: 'Update the receipt total within the assigned scope.',
    acceptance: ['The displayed total matches the receipt lines.'],
    constraints: {
      authority: 'workspace-write',
      assigned_files: ['src/receipt.js'],
      delegation,
      ...(strictTarget ? { strict_target: strictTarget } : {}),
    },
  };
}

function capabilities(profile, access = {}, extra = {}) {
  return {
    host_profile: { ...profile, access: { ...profile.access, ...access } },
    catalog: CATALOG,
    ...extra,
  };
}

function target(provider, targetAgent, modelId, effort) {
  return { provider, target_agent: targetAgent, model_id: modelId, effort };
}

function nativeClaudeTarget(role = 'worker') {
  return target('anthropic', 'claude-code', 'claude-opus-5-5', role === 'worker' ? 'medium' : 'high');
}

function openAiWorkerTarget() {
  return target('openai', 'codex-cli', 'gpt-6-luna', 'high');
}

function installCapabilityRefresh(fixture, { openai = 'AVAILABLE', google = 'AVAILABLE', records, events } = {}) {
  const requests = [];
  fixture.host.getCapabilities = async (context) => {
    requests.push(context);
    if (context && context.allow_external_probe === true) {
      if (events) events.push('refresh');
      return capabilities(CLAUDE_PROFILE, {
        openai: { status: openai, evidence: 'stub scoped post-consent OpenAI capability' },
        google: { status: google, evidence: 'stub scoped post-consent Google capability' },
      }, records ? { capability_evidence_records: records(context) } : {});
    }
    return capabilities(CLAUDE_PROFILE);
  };
  return requests;
}

function installGraphDecision(fixture, nodes) {
  fixture.host.coordinate = async (resolvedTask, context) => {
    fixture.calls.push({ method: 'coordinate', task: resolvedTask, context });
    return { mode: 'coordinated', nodes };
  };
}

function acceptedOutcome(targetInfo) {
  return {
    status: 'SUCCEEDED',
    observed_target: {
      provider: targetInfo.provider,
      target_agent: targetInfo.target_agent,
      model_id: targetInfo.model_id,
      effort: targetInfo.effort,
    },
  };
}

test('--cross-provider asks for real provider scope before a scoped capability refresh', async () => {
  const fixture = createRunnerFixture({
    task: makeTask(),
    capabilities: capabilities(CLAUDE_PROFILE),
    decision: { mode: 'solo', target: openAiWorkerTarget() },
    outcome: acceptedOutcome(openAiWorkerTarget()),
  });
  const workdir = makeWorkdir('answer');
  const events = [];
  const capabilityRequests = installCapabilityRefresh(fixture, { events });
  const coordinate = fixture.host.coordinate.bind(fixture.host);
  fixture.host.coordinate = async (...args) => { events.push('coordinate'); return coordinate(...args); };
  const permissionRequests = [];
  fixture.host.askProviderScope = async (request) => {
    permissionRequests.push(request);
    return { status: 'ANSWERED', answer_id: 'consent/openai-1', providers: ['openai'] };
  };

  try {
    const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], { host: fixture.host, workdir });
    assert.strictEqual(report.execution.status, 'SUCCEEDED');
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(permissionRequests.length, 1);
    assert.ok(permissionRequests[0].provider_options.some((option) => option.provider === 'openai'));
    assert.strictEqual(permissionRequests[0].provider_options.some((option) => option.provider === 'codex-cli'), false);
    assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false, true]);
    assert.strictEqual(capabilityRequests[0].session_id, capabilityRequests[1].session_id);
    assert.strictEqual(capabilityRequests[0].binding_id, capabilityRequests[1].binding_id);
    assert.ok(events.indexOf('coordinate') < events.indexOf('refresh'));
    assert.deepStrictEqual(capabilityRequests[1].authorized_providers, []);
    assert.deepStrictEqual(capabilityRequests[1].authorized_targets, [
      { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high', role: 'worker', authority: 'workspace-write' },
    ]);

    const context = fixture.calls.find((call) => call.method === 'coordinate').context;
    assert.strictEqual(context.allow_external_probe, false);
    assert.deepStrictEqual(context.authorization_ledger.providers, ['anthropic', 'openai']);
    assert.strictEqual(Object.isFrozen(context.authorization_ledger), true);
    assert.strictEqual(Object.isFrozen(context.authorization_ledger.grants), true);
    assert.strictEqual(context.authorization_ledger.grants.some((grant) => grant.target_agent || grant.model_id), false);
    const openAiGrant = context.authorization_ledger.grants.find((grant) => grant.scope === 'provider' && grant.provider === 'openai');
    assert.strictEqual(openAiGrant.answer_id, 'consent_openai-1');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(openAiGrant, 'text'), false);
    assert.strictEqual(JSON.stringify(context.authorization_ledger).includes('consent/openai-1'), false);
    assert.strictEqual(fixture.calls.some((call) => call.method === 'execute' && call.target.provider === 'openai'), true);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('multi-select, successive provider answers, and provider text produce the same grant set without model questions', async () => {
  const cases = [
    {
      answers: [{ status: 'ANSWERED', answer_id: 'consent-multi-1', providers: ['openai', 'google'] }],
    },
    {
      answers: [
        { status: 'ANSWERED', answer_id: 'consent-openai-2', provider: 'openai', continue: true },
        { status: 'ANSWERED', answer_id: 'consent-google-2', provider: 'google' },
      ],
    },
    {
      answers: [{ status: 'ANSWERED', answer_id: 'consent-text-1', text: 'I authorize OpenAI and Google.' }],
    },
  ];
  const observedGrantSets = [];

  for (const [index, entry] of cases.entries()) {
    const fixture = createRunnerFixture({
      task: makeTask(),
      capabilities: capabilities(CLAUDE_PROFILE),
      decision: { mode: 'solo', target: nativeClaudeTarget() },
      outcome: acceptedOutcome(nativeClaudeTarget()),
    });
    const workdir = makeWorkdir(`answer-mode-${index}`);
    const capabilityRequests = installCapabilityRefresh(fixture);
    const permissionRequests = [];
    let answerIndex = 0;
    fixture.host.askProviderScope = async (request) => {
      permissionRequests.push(request);
      return entry.answers[answerIndex++];
    };
    try {
      const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], { host: fixture.host, workdir });
      assert.strictEqual(report.acceptance.status, 'PASSED');
      const context = fixture.calls.find((call) => call.method === 'coordinate').context;
      observedGrantSets.push(context.authorization_ledger.providers);
      assert.strictEqual(permissionRequests.some((request) => Object.prototype.hasOwnProperty.call(request, 'model_options')), false);
      assert.strictEqual(permissionRequests.some((request) => Object.prototype.hasOwnProperty.call(request, 'model_id')), false);
      assert.strictEqual(fixture.calls.some((call) => call.method === 'execute' && ['openai', 'google'].includes(call.target.provider)), false);
      assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false]);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }

  assert.deepStrictEqual(observedGrantSets, [
    ['anthropic', 'openai', 'google'],
    ['anthropic', 'openai', 'google'],
    ['anthropic', 'openai', 'google'],
  ]);
});

test('cancel, no-answer, and no-UI add no grants while an independent native graph node continues', async () => {
  const outcomes = [
    { name: 'cancel', answer: { status: 'CANCELLED' } },
    { name: 'no-answer', answer: { status: 'NO_ANSWER' } },
    { name: 'ambiguous-text', answer: { status: 'ANSWERED', answer_id: 'consent-negative-1', text: 'I authorize OpenAI only; Google is forbidden.' } },
    { name: 'no-ui', answer: undefined },
  ];
  const nodes = [
    {
      id: 'native-read', goal: 'Read the receipt', acceptance: ['The receipt was read.'],
      role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: nativeClaudeTarget(),
    },
    {
      id: 'external-write', goal: 'Update the receipt', acceptance: ['The receipt was updated.'],
      role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: openAiWorkerTarget(),
    },
  ];

  for (const entry of outcomes) {
    const forgedTask = {
      ...makeTask({ delegation: 'coordinated' }),
      authorizationEvidence: { source: 'user-answer', answer_id: 'task-forgery-1', providers: ['openai'] },
      constraints: { ...makeTask({ delegation: 'coordinated' }).constraints, authorized_providers: ['openai'] },
    };
    const fixture = createRunnerFixture({ task: forgedTask, capabilities: capabilities(CLAUDE_PROFILE) });
    const workdir = makeWorkdir(entry.name);
    const capabilityRequests = installCapabilityRefresh(fixture, { openai: 'NOT_RUN' });
    installGraphDecision(fixture, nodes);
    fixture.host.coordinate = async (resolvedTask, context) => {
      fixture.calls.push({ method: 'coordinate', task: resolvedTask, context });
      return {
        mode: 'coordinated', nodes,
        authorizationEvidence: { source: 'user-answer', answer_id: 'decision-forgery-1', providers: ['openai'] },
      };
    };
    if (entry.name !== 'no-ui') fixture.host.askProviderScope = async () => entry.answer;
    fixture.host.execute = async (resolvedTarget, task, context) => {
      fixture.calls.push({ method: 'execute', target: resolvedTarget, task, context });
      return acceptedOutcome(resolvedTarget);
    };

    try {
      const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], { host: fixture.host, workdir });
      assert.strictEqual(report.acceptance.status, 'BLOCKED');
      assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute' && call.target.provider === 'anthropic').length, 1);
      assert.strictEqual(fixture.calls.some((call) => call.method === 'execute' && call.target.provider === 'openai'), false);
      assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false]);
      const ledger = fixture.calls.find((call) => call.method === 'coordinate').context.authorization_ledger;
      assert.deepStrictEqual(ledger.providers, ['anthropic']);
      if (entry.name === 'no-ui') assert.strictEqual(fixture.host.askProviderScope, undefined);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
});

test('trusted structured authorization reuses the same consent contract and strict task targets still bind', async () => {
  const fixture = createRunnerFixture({
    task: makeTask(),
    capabilities: capabilities(CLAUDE_PROFILE),
    decision: { mode: 'solo', target: openAiWorkerTarget() },
    outcome: acceptedOutcome(openAiWorkerTarget()),
  });
  const workdir = makeWorkdir('structured');
  const capabilityRequests = installCapabilityRefresh(fixture);
  let questions = 0;
  fixture.host.askProviderScope = async () => { questions += 1; return { status: 'CANCELLED' }; };

  try {
    const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      authorizationEvidence: { source: 'user-answer', answer_id: 'api-consent-openai-1', providers: ['openai'] },
    });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(questions, 0);
    assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false, true]);
    assert.deepStrictEqual(capabilityRequests[1].authorized_providers, []);
    assert.deepStrictEqual(capabilityRequests[1].authorized_targets, [
      { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high', role: 'worker', authority: 'workspace-write' },
    ]);
    assert.deepStrictEqual(fixture.calls.find((call) => call.method === 'coordinate').context.authorization_ledger.providers, ['anthropic', 'openai']);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  const strictFixture = createRunnerFixture({
    task: makeTask({ strictTarget: { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high' } }),
    capabilities: capabilities(CLAUDE_PROFILE),
    decision: { mode: 'solo', target: target('google', 'agy', 'gemini-3.8-flash-high', 'high') },
    outcome: acceptedOutcome(target('google', 'agy', 'gemini-3.8-flash-high', 'high')),
  });
  const strictWorkdir = makeWorkdir('strict-target');
  installCapabilityRefresh(strictFixture);
  try {
    const report = await runFlowDrive(['Update the receipt total.'], {
      host: strictFixture.host,
      workdir: strictWorkdir,
      authorizationEvidence: { source: 'user-answer', answer_id: 'api-consent-google-1', providers: ['google'] },
    });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(strictFixture.calls.some((call) => call.method === 'execute'), false);
  } finally {
    strictFixture.cleanup();
    fs.rmSync(strictWorkdir, { recursive: true, force: true });
  }
});

test('answered scopes without a nonblank answer ID grant nothing and trigger no external probe', async () => {
  const cases = [
    { name: 'missing-id', evidence: { source: 'user-answer', providers: ['openai'] } },
    { name: 'blank-id', evidence: { source: 'user-answer', answer_id: '  ', providers: ['openai'] } },
    { name: 'text-id', evidence: { source: 'user-answer', answer_id: 'I authorized OpenAI', providers: ['openai'] } },
    { name: 'answer-missing-id', answer: { status: 'ANSWERED', providers: ['openai'] } },
    { name: 'answer-blank-id', answer: { status: 'ANSWERED', answer_id: '', providers: ['openai'] } },
    { name: 'answer-text-id', answer: { status: 'ANSWERED', answer_id: 'I authorized OpenAI', providers: ['openai'] } },
  ];

  for (const entry of cases) {
    const fixture = createRunnerFixture({
      task: makeTask(),
      capabilities: capabilities(CLAUDE_PROFILE),
      decision: { mode: 'solo', target: openAiWorkerTarget() },
      outcome: acceptedOutcome(openAiWorkerTarget()),
    });
    const workdir = makeWorkdir(`unproven-${entry.name}`);
    const capabilityRequests = installCapabilityRefresh(fixture);
    if (entry.answer) fixture.host.askProviderScope = async () => entry.answer;
    try {
      const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], {
        host: fixture.host,
        workdir,
        ...(entry.evidence ? { authorizationEvidence: entry.evidence } : {}),
      });
      assert.strictEqual(report.status, 'BLOCKED', entry.name);
      assert.notStrictEqual(report.acceptance.status, 'PASSED', entry.name);
      assert.strictEqual(fixture.calls.some((call) => call.method === 'execute' && call.target.provider === 'openai'), false, entry.name);
      assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false], entry.name);
      assert.deepStrictEqual(fixture.calls.find((call) => call.method === 'coordinate').context.authorization_ledger.providers, ['anthropic'], entry.name);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
});

test('a strict provider answer refreshes only the exact strict target tuple', async () => {
  const strictTarget = { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high' };
  const fixture = createRunnerFixture({
    task: makeTask({ strictTarget }),
    capabilities: capabilities(CLAUDE_PROFILE),
    decision: { mode: 'solo', target: openAiWorkerTarget() },
    outcome: acceptedOutcome(openAiWorkerTarget()),
  });
  const workdir = makeWorkdir('strict-refresh-scope');
  const capabilityRequests = installCapabilityRefresh(fixture);
  fixture.host.askProviderScope = async () => ({ status: 'ANSWERED', answer_id: 'consent-strict-1', providers: ['openai'] });

  try {
    const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], { host: fixture.host, workdir });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.deepStrictEqual(capabilityRequests[1].authorized_providers, []);
    assert.deepStrictEqual(capabilityRequests[1].authorized_targets, [
      { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high', role: 'worker', authority: 'workspace-write' },
    ]);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('an exact external worker CLI grant is tuple-scoped and does not constrain native or reviewer nodes', async () => {
  const workerTarget = openAiWorkerTarget();
  const nativeReviewer = nativeClaudeTarget('reviewer');
  const externalReviewer = target('openai', 'codex-cli', 'gpt-6.1-sol', 'high');
  const nodes = [
    {
      id: 'authorized-worker', goal: 'Update the receipt', acceptance: ['The receipt is updated.'],
      role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: workerTarget,
    },
    {
      id: 'native-reviewer', goal: 'Review the receipt', acceptance: ['The update is correct.'],
      role: 'reviewer', authority: 'read-only', assigned_files: [], dependencies: [], target: nativeReviewer,
    },
    {
      id: 'ungranted-external-reviewer', goal: 'Review with a separate external role', acceptance: ['The review is independent.'],
      role: 'reviewer', authority: 'read-only', assigned_files: [], dependencies: [], target: externalReviewer,
    },
  ];
  const fixture = createRunnerFixture({ task: makeTask({ delegation: 'coordinated' }), capabilities: capabilities(CLAUDE_PROFILE) });
  const workdir = makeWorkdir('exact-cli-graph');
  let grantedCapability;
  const capabilityRequests = installCapabilityRefresh(fixture, {
    records: (context) => {
      grantedCapability = Object.freeze({
        kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'stub exact target',
        observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
        host: 'claude-code', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna',
        role: 'worker', authority: 'workspace-write', effort: 'high', effort_binding: 'parameter',
        route: 'headless-cli', transport: 'local-cli',
      });
      return [grantedCapability];
    },
  });
  installGraphDecision(fixture, nodes);
  fixture.host.askProviderScope = async () => { throw new Error('exact CLI permission must not open a provider question'); };
  fixture.host.execute = async (resolvedTarget, task, context) => {
    fixture.calls.push({ method: 'execute', target: resolvedTarget, task, context });
    return acceptedOutcome(resolvedTarget);
  };

  try {
    const report = await runFlowDrive(['Update the receipt total.', '--worker-target=codex/gpt-6-luna:high'], { host: fixture.host, workdir });
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    const executions = fixture.calls.filter((call) => call.method === 'execute');
    assert.deepStrictEqual(executions.map((call) => call.context.node.role).sort(), ['reviewer', 'worker']);
    assert.deepStrictEqual(executions.map((call) => call.target.provider).sort(), ['anthropic', 'openai']);
    const workerRequest = executions.find((call) => call.context.node.id === 'authorized-worker').context.resolution.request;
    assert.deepStrictEqual(workerRequest.capability_evidence, grantedCapability);
    const nativeReviewerRequest = executions.find((call) => call.context.node.id === 'native-reviewer').context.resolution.request;
    assert.strictEqual(Object.prototype.hasOwnProperty.call(nativeReviewerRequest, 'capability_evidence'), false);
    assert.deepStrictEqual(capabilityRequests.map((request) => request.allow_external_probe), [false, true]);
    assert.deepStrictEqual(capabilityRequests[1].authorized_targets, [
      { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high', role: 'worker', authority: 'workspace-write' },
    ]);
    assert.deepStrictEqual(capabilityRequests[1].authorized_providers, []);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('nested task scope and prompt constraints are cloned and frozen before coordinator access', async () => {
  const sourceTask = makeTask();
  sourceTask.constraints.database = { tables: ['receipts'], options: { write: false } };
  sourceTask.constraints.git = { branch: 'feature/receipt-total', authorization: { force_push: false } };
  sourceTask.constraints.prompt_context = { trusted: { scope: ['src/receipt.js'] } };
  const fixture = createRunnerFixture({ task: sourceTask, capabilities: capabilities(CODEX_PROFILE) });
  const workdir = makeWorkdir('deep-freeze');
  let taskAtCoordinator;
  let observations;
  fixture.host.coordinate = async (resolvedTask) => {
    taskAtCoordinator = resolvedTask;
    observations = {
      clonedDatabase: resolvedTask.constraints.database !== sourceTask.constraints.database,
      clonedGitAuthority: resolvedTask.constraints.git.authorization !== sourceTask.constraints.git.authorization,
      clonedPromptScope: resolvedTask.constraints.prompt_context.trusted.scope !== sourceTask.constraints.prompt_context.trusted.scope,
      frozenDatabase: Object.isFrozen(resolvedTask.constraints.database.options),
      frozenGitAuthority: Object.isFrozen(resolvedTask.constraints.git.authorization),
      frozenPromptScope: Object.isFrozen(resolvedTask.constraints.prompt_context.trusted.scope),
    };
    try { resolvedTask.constraints.database.tables.push('secrets'); } catch (_) { /* frozen task contracts reject coordinator mutation */ }
    try { resolvedTask.constraints.git.authorization.force_push = true; } catch (_) { /* frozen task contracts reject coordinator mutation */ }
    try { resolvedTask.constraints.prompt_context.trusted.scope[0] = '**'; } catch (_) { /* frozen task contracts reject coordinator mutation */ }
    return { mode: 'solo', target: target('openai', 'codex-cli', 'gpt-6-luna', 'max') };
  };

  try {
    const report = await runFlowDrive(['Update the receipt total.'], { host: fixture.host, workdir });
    assert.strictEqual(report.status, 'REPORTED');
    assert.strictEqual(observations.clonedDatabase, true);
    assert.strictEqual(observations.clonedGitAuthority, true);
    assert.strictEqual(observations.clonedPromptScope, true);
    assert.strictEqual(observations.frozenDatabase, true);
    assert.strictEqual(observations.frozenGitAuthority, true);
    assert.strictEqual(observations.frozenPromptScope, true);
    assert.deepStrictEqual(sourceTask.constraints.database.tables, ['receipts']);
    assert.strictEqual(sourceTask.constraints.git.authorization.force_push, false);
    assert.deepStrictEqual(sourceTask.constraints.prompt_context.trusted.scope, ['src/receipt.js']);
    assert.deepStrictEqual(taskAtCoordinator.constraints.database.tables, ['receipts']);
    assert.strictEqual(taskAtCoordinator.constraints.git.authorization.force_push, false);
    assert.deepStrictEqual(taskAtCoordinator.constraints.prompt_context.trusted.scope, ['src/receipt.js']);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a provider grant never overrides the Host allowed-provider policy', async () => {
  const restrictedProfile = {
    ...CLAUDE_PROFILE,
    allowed_providers: ['anthropic', 'google'],
  };
  const fixture = createRunnerFixture({
    task: makeTask(),
    capabilities: capabilities(restrictedProfile),
    decision: { mode: 'solo', target: openAiWorkerTarget() },
    outcome: acceptedOutcome(openAiWorkerTarget()),
  });
  const workdir = makeWorkdir('host-refusal');
  const capabilityRequests = [];
  fixture.host.getCapabilities = async (context) => {
    capabilityRequests.push(context);
    return capabilities(restrictedProfile);
  };
  fixture.host.coordinate = async (resolvedTask, context) => {
    fixture.calls.push({ method: 'coordinate', task: resolvedTask, context });
    try {
      context.capabilities.host_profile.allowed_providers = ['anthropic', 'google', 'openai'];
      context.capabilities.host_profile.access.openai.status = 'AVAILABLE';
    } catch (_) {
      fixture.calls.push({ method: 'capability-mutation-blocked' });
    }
    return { mode: 'solo', target: openAiWorkerTarget() };
  };

  try {
    const report = await runFlowDrive(['Update the receipt total.'], {
      host: fixture.host,
      workdir,
      authorizationEvidence: { source: 'user-answer', answer_id: 'api-consent-openai-2', providers: ['openai'] },
    });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.acceptance.status, 'NOT_RUN');
    assert.strictEqual(capabilityRequests.length, 1);
    assert.strictEqual(capabilityRequests[0].allow_external_probe, false);
    assert.strictEqual(fixture.calls.some((call) => call.method === 'capability-mutation-blocked'), true);
    assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('an explicit Host access block remains binding while stale unavailability can be refreshed', async () => {
  for (const entry of [
    { name: 'blocked', initial: 'BLOCKED', expectedCalls: 1, expectedExecution: false },
    { name: 'unavailable', initial: 'UNAVAILABLE', expectedCalls: 2, expectedExecution: true },
  ]) {
    const initialProfile = {
      ...CLAUDE_PROFILE,
      access: { ...CLAUDE_PROFILE.access, openai: { status: entry.initial, evidence: `initial ${entry.initial} Host evidence` } },
    };
    const fixture = createRunnerFixture({
      task: makeTask(),
      capabilities: capabilities(initialProfile),
      decision: { mode: 'solo', target: openAiWorkerTarget() },
      outcome: acceptedOutcome(openAiWorkerTarget()),
    });
    const workdir = makeWorkdir(`host-access-${entry.name}`);
    const capabilityRequests = [];
    fixture.host.getCapabilities = async (context) => {
      capabilityRequests.push(context);
      if (context.allow_external_probe) {
        return capabilities(initialProfile, { openai: { status: 'AVAILABLE', evidence: 'scoped available target' } });
      }
      return capabilities(initialProfile);
    };
    try {
      const report = await runFlowDrive(['Update the receipt total.', '--cross-provider'], {
        host: fixture.host,
        workdir,
        authorizationEvidence: { source: 'user-answer', answer_id: `host-access-${entry.name}`, providers: ['openai'] },
      });
      assert.strictEqual(capabilityRequests.length, entry.expectedCalls, entry.name);
      assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), entry.expectedExecution, entry.name);
      assert.strictEqual(report.acceptance.status === 'PASSED', entry.expectedExecution, entry.name);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
});

test('relevant stale or contradictory capability records fail closed instead of falling back to the catalog', async () => {
  const cases = [
    {
      name: 'stale-binding',
      records: () => [{
        kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'stale target record',
        observed_at: '2026-10-08T00:00:00.000Z', session_id: 'old-session', binding_id: 'old-binding',
        host: 'claude-code', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna',
        role: 'worker', authority: 'workspace-write', effort: 'high', effort_binding: 'parameter', route: 'headless-cli', transport: 'local-cli',
      }],
    },
    {
      name: 'contradictory-records',
      records: (context) => [
        {
          kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'first current target record',
          observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
          host: 'claude-code', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna',
          role: 'worker', authority: 'workspace-write', effort: 'high', effort_binding: 'parameter', route: 'headless-cli', transport: 'local-cli',
        },
        {
          kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'contradictory current target record',
          observed_at: '2026-10-08T00:00:01.000Z', session_id: context.session_id, binding_id: context.binding_id,
          host: 'claude-code', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna',
          role: 'worker', authority: 'workspace-write', effort: 'high', effort_binding: 'parameter', route: 'native', transport: 'native-runtime',
        },
      ],
    },
  ];

  for (const entry of cases) {
    const fixture = createRunnerFixture({
      task: makeTask(),
      capabilities: capabilities(CLAUDE_PROFILE),
      decision: { mode: 'solo', target: openAiWorkerTarget() },
      outcome: acceptedOutcome(openAiWorkerTarget()),
    });
    const workdir = makeWorkdir(entry.name);
    installCapabilityRefresh(fixture, { records: entry.records });
    try {
      const report = await runFlowDrive(['Update the receipt total.'], {
        host: fixture.host,
        workdir,
        authorizationEvidence: { source: 'user-answer', answer_id: 'api-consent-openai-3', providers: ['openai'] },
      });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.acceptance.status, 'NOT_RUN');
      assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
});


function boundRecord(context, selected, overrides = {}) {
  return { kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE',
    source: 'host-tool', observed_at: '2026-10-08T00:00:00Z', session_id: context.session_id,
    binding_id: context.binding_id, host: selected.provider === 'openai' ? 'codex-cli' : 'claude-code',
    ...selected, role: 'worker', authority: 'workspace-write', effort_binding: selected.effort === null ? 'unsupported' : 'parameter',
    route: 'native', transport: 'native-runtime', ...overrides };
}

for (const mode of ['solo', 'graph']) {
  test(`T7 refresh supersedes stale same-bound evidence in ${mode}`, async () => {
    const selected = openAiWorkerTarget();
    const fixture = createRunnerFixture({ task: makeTask({ delegation: mode === 'graph' ? 'coordinated' : 'none' }),
      decision: { mode: 'solo', target: selected }, outcome: acceptedOutcome(selected) });
    if (mode === 'graph') installGraphDecision(fixture, [{ id: 'write', goal: 'Update total', acceptance: ['Correct total'],
      role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: selected }]);
    const workdir = makeWorkdir('supersede');
    fixture.host.getCapabilities = async (context) => capabilities(CLAUDE_PROFILE,
      { openai: { status: context.allow_external_probe ? 'AVAILABLE' : 'UNAVAILABLE', evidence: 'fixture' } },
      { capability_evidence_records: [boundRecord(context, selected, { host: 'claude-code', route: 'headless-cli', transport: 'local-cli',
        state: context.allow_external_probe ? 'OBSERVED_AVAILABLE' : 'OBSERVED_UNAVAILABLE',
        status: context.allow_external_probe ? 'AVAILABLE' : 'UNAVAILABLE' })] });
    try {
      const report = await runFlowDrive(['Update total'], { host: fixture.host, workdir,
        authorizationEvidence: { source: 'user-answer', answer_id: 't7-refresh', providers: ['openai'] } });
      assert.strictEqual(report.acceptance.status, 'PASSED', JSON.stringify(report.blockers));
      assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 1);
    } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
  });
}

test('T7 explicit Host refusal overrides bound native executable evidence without refresh', async () => {
  const selected = target('openai', 'codex-cli', 'gpt-6-luna', 'max');
  const fixture = createRunnerFixture({ task: makeTask(), decision: { mode: 'solo', target: selected } });
  let refreshes = 0;
  fixture.host.getCapabilities = async (context) => {
    if (context.allow_external_probe) refreshes++;
    return capabilities(CODEX_PROFILE, { openai: { status: 'BLOCKED', evidence: 'Host refuses' } },
      { capability_evidence: boundRecord(context, selected) });
  };
  const workdir = makeWorkdir('refusal');
  try {
    const report = await runFlowDrive(['Update total'], { host: fixture.host, workdir });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 0);
    assert.strictEqual(refreshes, 0);
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

for (const mode of ['solo', 'graph']) {
  test(`T7 current native nullable model retains truthful unknown identity in ${mode}`, async () => {
    const selected = target('openai', 'codex-cli', null, null);
    const fixture = createRunnerFixture({ task: makeTask({ delegation: mode === 'graph' ? 'coordinated' : 'none' }),
      decision: { mode: 'solo', target: selected }, outcome: { status: 'SUCCEEDED' } });
    if (mode === 'graph') installGraphDecision(fixture, [{ id: 'write', goal: 'Update total', acceptance: ['Correct total'],
      role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: selected }]);
    fixture.host.getCapabilities = async (context) => capabilities(CODEX_PROFILE, {}, { capability_evidence: boundRecord(context, selected) });
    const workdir = makeWorkdir('nullable');
    try {
      const report = await runFlowDrive(['Update total'], { host: fixture.host, workdir });
      assert.strictEqual(report.acceptance.status, 'PASSED', JSON.stringify(report.blockers));
      const launched = fixture.calls.find((call) => call.method === 'execute').target;
      assert.strictEqual(launched.model_id, null); assert.strictEqual(launched.model, null);
      assert.strictEqual(launched.identity, null); assert.strictEqual(launched.effort, null); assert.strictEqual(launched.native, true);
      assert.strictEqual(JSON.stringify(report).includes('codex-cli/unknown'), false);
      if (mode === 'solo') { assert.strictEqual(report.targets.requested.model_id, null); assert.strictEqual(report.targets.resolved.model_id, null); assert.strictEqual(report.targets.resolved.effort, null); assert.strictEqual(report.targets.observed, null); }
    } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
  });
}


test('T7 refresh cannot supersede a newer matching observation with old, wrong-bound, wrong-effort or contradictory proof', async () => {
  for (const invalid of ['older', 'wrong-binding', 'wrong-effort', 'contradictory']) {
    const selected = openAiWorkerTarget();
    const fixture = createRunnerFixture({ task: makeTask(), decision: { mode: 'solo', target: { ...selected, transport: 'local-cli' } }, outcome: acceptedOutcome(selected) });
    const workdir = makeWorkdir(invalid);
    fixture.host.getCapabilities = async (context) => {
      const prior = boundRecord(context, selected, { host: 'claude-code', route: 'headless-cli', transport: 'local-cli',
        observed_at: '2026-10-08T00:01:00Z', state: 'OBSERVED_UNAVAILABLE', status: 'UNAVAILABLE' });
      const fresh = { ...prior, state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', observed_at: '2026-10-08T00:02:00Z',
        ...(invalid === 'older' ? { observed_at: '2026-10-08T00:00:00Z' } : {}),
        ...(invalid === 'wrong-binding' ? { binding_id: 'foreign-binding' } : {}),
        ...(invalid === 'wrong-effort' ? { effort: 'low' } : {}) };
      return capabilities(CLAUDE_PROFILE, { openai: { status: context.allow_external_probe ? 'AVAILABLE' : 'UNAVAILABLE', evidence: 'fixture' } },
        { capability_evidence_records: context.allow_external_probe ? [fresh, ...(invalid === 'contradictory' ? [{ ...fresh, state: 'OBSERVED_UNAVAILABLE', status: 'UNAVAILABLE' }] : [])] : [prior] });
    };
    try {
      const report = await runFlowDrive(['Update total'], { host: fixture.host, workdir,
        authorizationEvidence: { source: 'user-answer', answer_id: 't7-invalid-refresh', providers: ['openai'] } });
      assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 0, invalid);
      assert.notStrictEqual(report.acceptance.status, 'PASSED');
    } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
  }
});


test('T7 nullable targets reject stale, declared, foreign or legacy-selector proof at the public seam', async () => {
  for (const variant of ['stale', 'declared', 'foreign', 'legacy']) {
    const selected = target(variant === 'foreign' ? 'anthropic' : 'openai', variant === 'foreign' ? 'claude-code' : 'codex-cli', null, null);
    const fixture = createRunnerFixture({ task: makeTask(), decision: { mode: 'solo', target: selected }, outcome: { status: 'SUCCEEDED' } });
    fixture.host.getCapabilities = async (context) => capabilities(CODEX_PROFILE, {}, { capability_evidence: boundRecord(context, selected,
      { host: 'codex-cli', ...(variant === 'stale' ? { binding_id: 'stale' } : {}), ...(variant === 'declared' ? { state: 'DECLARED' } : {}),
        ...(variant === 'foreign' ? { model_id: 'claude-opus-5-5' } : {}) }) });
    const workdir = makeWorkdir(variant);
    try {
      const report = await runFlowDrive(['Update total', ...(variant === 'legacy' ? ['--worker=codex'] : [])], { host: fixture.host, workdir,
        authorizationEvidence: { source: 'user-answer', answer_id: 't7-null-negative', providers: ['anthropic'] } });
      assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 0, variant);
      assert.notStrictEqual(report.acceptance.status, 'PASSED');
    } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
  }
});

for (const state of ['EXPOSED', 'OBSERVED_AVAILABLE']) test(`T7 ${state} native alias retains resolved selector while observed identity remains unknown`, async () => {
  const selected = target('openai', 'codex-cli', 'host-default-alias', null);
  const fixture = createRunnerFixture({ task: makeTask(), decision: { mode: 'solo', target: selected }, outcome: { status: 'SUCCEEDED' } });
  fixture.host.getCapabilities = async (context) => capabilities(CODEX_PROFILE, {}, { capability_evidence: boundRecord(context, selected, { state }) });
  const workdir = makeWorkdir('alias');
  try {
    const report = await runFlowDrive(['Update total'], { host: fixture.host, workdir, recovery: { retryBudget: 0 } });
    assert.strictEqual(report.acceptance.status, 'PASSED'); assert.strictEqual(report.targets.resolved.model_id, 'host-default-alias');
    assert.strictEqual(report.targets.observed, null);
    const receipt = JSON.parse(report.execution.evidence)[0].receipt;
    assert.strictEqual(receipt.capability_evidence.observed_model, null); assert.strictEqual(receipt.capability_evidence.observed_effort, null);
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

run('flow-drive-provider-permissions');
