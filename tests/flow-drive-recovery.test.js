'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { spawnSync } = require('node:child_process');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const { nodeTaskDigest } = require('../skills/flow-drive/scripts/task-graph');
const { createNodeTask } = require('../skills/flow-drive/scripts/task-contract');
const {
  createRunnerFixture,
  DEFAULT_TASK,
  CATALOG,
  CLAUDE_PROFILE,
} = require('./_lib/flow-drive-runner-fixtures');

const ANTHROPIC_TARGET = Object.freeze({
  target_agent: 'claude-code', provider: 'anthropic', model_id: 'claude-opus-5-5', effort: 'medium',
});
const OPENAI_TARGET = Object.freeze({
  target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'high',
});
const GOOGLE_TARGET = Object.freeze({
  target_agent: 'agy', provider: 'google', model_id: 'gemini-3.8-flash-high', effort: 'high',
});
const BASELINE_ID = 'recovery-baseline-917';

function makeWorkdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `flow-drive-recovery-${label}-`));
}

function taskFor(assignedFiles = ['src/receipt.js']) {
  return {
    goal: 'Repair the receipt total in the assigned files.',
    acceptance: ['The receipt total matches its line items.'],
    constraints: {
      authority: 'workspace-write',
      assigned_files: [...assignedFiles],
      delegation: 'coordinated',
    },
  };
}

function graphFixture({ assignedFiles = ['src/receipt.js'], nodes, target = ANTHROPIC_TARGET } = {}) {
  const task = taskFor(assignedFiles);
  const graphNodes = nodes || [{
    id: 'repair', goal: 'repair the receipt total', acceptance: ['receipt total verified'],
    role: 'worker', authority: 'workspace-write', assigned_files: [...assignedFiles],
    dependencies: [], target,
  }];
  return createRunnerFixture({
    task,
    capabilities: { host_profile: CLAUDE_PROFILE, catalog: CATALOG },
    decision: { mode: 'coordinated', nodes: graphNodes },
  });
}

function attemptOf(context) {
  return context && (context.request || context.resolution && context.resolution.request);
}

function observedTarget(target) {
  return {
    target_agent: target.target_agent,
    provider: target.provider,
    model_id: target.model_id,
    effort: target.effort,
  };
}

function allowProviders(host, providers, answerId) {
  host.askProviderScope = async () => ({ status: 'ANSWERED', answer_id: answerId, providers: [...providers] });
  host.getCapabilities = async (context) => ({
    host_profile: { ...CLAUDE_PROFILE, access: { ...CLAUDE_PROFILE.access,
      ...(context.allow_external_probe ? Object.fromEntries(context.authorized_targets.map((target) =>
        [target.provider, { status: 'AVAILABLE', evidence: 'stub scoped executor available' }])) : {}) } },
    catalog: CATALOG,
  });
}

function parseExecutionEvidence(report) {
  return JSON.parse(report.execution.evidence);
}

test('availability failures can use one authorized alternate target when no effects occurred', async () => {
  const cases = [
    { name: 'missing CLI', failure_class: 'CLI_UNAVAILABLE' },
    { name: 'authentication unavailable', failure_class: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE' },
    { name: 'model unavailable', failure_class: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE' },
  ];

  for (const scenario of cases) {
    const fixture = graphFixture();
    const workdir = makeWorkdir(scenario.name.replaceAll(' ', '-'));
    const executions = [];
    fixture.host.execute = async (target, _task, context) => {
      const request = attemptOf(context);
      executions.push({ provider: target.provider, attempt_id: request.attempt_id });
      if (executions.length === 1) {
        return {
          status: 'FAILED', failure_class: scenario.failure_class, side_effects: 'none',
        };
      }
      return { status: 'SUCCEEDED', observed_target: observedTarget(target) };
    };
    fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
    allowProviders(fixture.host, ['openai'], `authorize-openai-${scenario.name.replaceAll(' ', '-')}`);
    fixture.host.verify = async (_task, outcome) => ({
      status: outcome.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED',
      evidence: outcome.status === 'SUCCEEDED' ? 'receipt lines verified' : 'execution did not succeed',
    });

    try {
      const report = await runFlowDrive(['Repair the receipt total.', '--cross-provider'], {
        host: fixture.host,
        workdir,
        recovery: { retryBudget: 1 },
      });
      assert.strictEqual(report.acceptance.status, 'PASSED', scenario.name);
      assert.deepStrictEqual(executions.map((entry) => entry.provider), ['anthropic', 'openai'], scenario.name);
      assert.notStrictEqual(executions[0].attempt_id, executions[1].attempt_id, scenario.name);
      assert.ok(JSON.stringify(report).includes(scenario.failure_class), scenario.name);
    } finally {
      fixture.cleanup();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }
});

test('one retry budget is shared across authorized providers and keeps each failed attempt receipt', async () => {
  const fixture = graphFixture();
  const workdir = makeWorkdir('shared-budget');
  const executions = [];
  const recoveryRequests = [];
  fixture.host.execute = async (target, _task, context) => {
    const request = attemptOf(context);
    executions.push({ provider: target.provider, attempt_id: request.attempt_id });
    const failure_class = executions.length === 1 ? 'CLI_UNAVAILABLE' : 'AUTHENTICATION_OR_MODEL_UNAVAILABLE';
    return {
      status: 'FAILED', failure_class, side_effects: 'none',
    };
  };
  fixture.host.recover = async (_task, context) => {
    recoveryRequests.push(context);
    return {
      action: 'substitute',
      target: executions.length === 1 ? OPENAI_TARGET : GOOGLE_TARGET,
    };
  };
  allowProviders(fixture.host, ['openai', 'google'], 'authorize-openai-google');
  fixture.host.verify = async () => ({ status: 'FAILED', evidence: 'execution failed' });

  try {
    const report = await runFlowDrive(['Repair the receipt total.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 1 },
    });
    assert.deepStrictEqual(executions.map((entry) => entry.provider), ['anthropic', 'openai']);
    assert.strictEqual(new Set(executions.map((entry) => entry.attempt_id)).size, 2);
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.ok(recoveryRequests.length > 0);
    assert.strictEqual(recoveryRequests[0].remaining_budget, 1);
    assert.strictEqual(Object.isFrozen(recoveryRequests[0].receipt), true);
    assert.strictEqual(recoveryRequests[0].request.attempt_id, executions[0].attempt_id);
    assert.strictEqual(recoveryRequests[0].failure_class, 'CLI_UNAVAILABLE');
    for (const execution of executions) assert.ok(report.execution.evidence.includes(execution.attempt_id));
    assert.ok(report.execution.evidence.includes('CLI_UNAVAILABLE'));
    assert.ok(report.execution.evidence.includes('AUTHENTICATION_OR_MODEL_UNAVAILABLE'));
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('quota failure stops on its provider instead of substituting an authorized provider', async () => {
  const fixture = graphFixture();
  const workdir = makeWorkdir('quota-stop');
  const providers = [];
  fixture.host.execute = async (target) => {
    providers.push(target.provider);
    return { status: 'FAILED', failure_class: 'QUOTA_OR_RATE_LIMIT', side_effects: 'none' };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  allowProviders(fixture.host, ['openai', 'google'], 'authorize-alternates-for-quota-case');
  fixture.host.verify = async () => ({ status: 'FAILED', evidence: 'quota prevented execution' });

  try {
    const report = await runFlowDrive(['Repair the receipt total.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 1 },
    });
    assert.deepStrictEqual(providers, ['anthropic']);
    assert.strictEqual(report.execution.status, 'FAILED');
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.ok(JSON.stringify(report).includes('QUOTA_OR_RATE_LIMIT'));
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('zero retry budget does not launch a substitute after an availability failure', async () => {
  const fixture = graphFixture();
  const workdir = makeWorkdir('zero-budget');
  const providers = [];
  fixture.host.execute = async (target, _task, context) => {
    providers.push(target.provider);
    return {
      status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none',
    };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  allowProviders(fixture.host, ['openai'], 'authorize-openai-zero-budget');
  fixture.host.verify = async () => ({ status: 'FAILED', evidence: 'execution failed' });

  try {
    const report = await runFlowDrive(['Repair the receipt total.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 0 },
    });
    assert.deepStrictEqual(providers, ['anthropic']);
    assert.notStrictEqual(report.acceptance.status, 'PASSED');
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('semantic failure repairs observed file effects with the same provider', async () => {
  const fixture = graphFixture();
  const workdir = makeWorkdir('semantic-repair');
  const receiptPath = path.join(workdir, 'src/receipt.js');
  const providers = [];
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fixture.host.inspectScope = async () => ({ identity: BASELINE_ID, within_scope: true, wip_preserved: true });
  fixture.host.execute = async (target, _task, context) => {
    providers.push(target.provider);
    const request = attemptOf(context);
    if (providers.length === 1) {
      fs.writeFileSync(receiptPath, 'total = 0;');
      return {
        status: 'FAILED', failure_class: 'TASK_OR_SEMANTIC_FAILURE', side_effects: 'observed',
      };
    }
    fs.writeFileSync(receiptPath, 'total = 12;');
    return { status: 'SUCCEEDED', observed_target: observedTarget(target) };
  };
  let repairRequest;
  fixture.host.recover = async (_task, context) => {
    repairRequest = context;
    return { action: 'repair', target: ANTHROPIC_TARGET };
  };
  fixture.host.verify = async (_task, outcome) => ({
    status: outcome.status === 'SUCCEEDED' && fs.readFileSync(receiptPath, 'utf8') === 'total = 12;' ? 'PASSED' : 'FAILED',
    evidence: fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : 'receipt file missing',
  });

  try {
    const report = await runFlowDrive(['Repair the receipt total.'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 1 },
    });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.deepStrictEqual(providers, ['anthropic', 'anthropic']);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), 'total = 12;');
    assert.strictEqual(repairRequest.failure_class, 'TASK_OR_SEMANTIC_FAILURE');
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a user or safety denial cannot be bypassed by an authorized substitute', async () => {
  const fixture = graphFixture();
  const workdir = makeWorkdir('denial');
  const providers = [];
  fixture.host.execute = async (target, _task, context) => {
    providers.push(target.provider);
    return {
      status: 'FAILED', failure_class: 'SAFETY_OR_USER_DENIAL', side_effects: 'none',
    };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  allowProviders(fixture.host, ['openai'], 'authorize-openai-but-not-denial');
  fixture.host.verify = async () => ({ status: 'FAILED', evidence: 'execution was denied' });

  try {
    const report = await runFlowDrive(['Repair the receipt total.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 2 },
    });
    assert.deepStrictEqual(providers, ['anthropic']);
    assert.notStrictEqual(report.acceptance.status, 'PASSED');
    assert.ok(JSON.stringify(report).includes('SAFETY_OR_USER_DENIAL'));
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('an explicit strict target cannot be substituted after an availability failure', async () => {
  const task = taskFor();
  task.constraints.strict_target = {
    provider: 'anthropic', target_agent: 'claude-code', model_id: 'claude-opus-5-5', effort: 'medium',
  };
  task.constraints.delegation = 'none';
  const fixture = createRunnerFixture({
    task,
    capabilities: { host_profile: CLAUDE_PROFILE, catalog: CATALOG },
    decision: { mode: 'solo', target: ANTHROPIC_TARGET },
  });
  const workdir = makeWorkdir('strict-target');
  const providers = [];
  fixture.host.execute = async (target, _task, context) => {
    providers.push(target.provider);
    return {
      status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none',
    };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  allowProviders(fixture.host, ['openai'], 'authorize-openai-strict-target');
  fixture.host.verify = async () => ({ status: 'FAILED', evidence: 'execution failed' });

  try {
    const report = await runFlowDrive(['Use the exact approved target.', '--cross-provider'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 2 },
    });
    assert.deepStrictEqual(providers, ['anthropic']);
    assert.notStrictEqual(report.acceptance.status, 'PASSED');
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function awaitRecoveryReport(promise, releasePendingExecution) {
  const watchdog = {};
  let timer;
  const report = await Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(watchdog), 1000); }),
  ]);
  clearTimeout(timer);
  if (report !== watchdog) return report;
  if (releasePendingExecution) {
    releasePendingExecution();
    return promise;
  }
  return watchdog;
}

test('timeout recovery stops and reconciles the prior scope before a fresh writer attempt', async () => {
  const assignedFiles = ['src/receipt.js', 'scratch/recovery-notes.md'];
  const fixture = graphFixture({ assignedFiles });
  const workdir = makeWorkdir('timeout-reconciled');
  const receiptPath = path.join(workdir, assignedFiles[0]);
  const scratchPath = path.join(workdir, assignedFiles[1]);
  const events = [];
  const attempts = [];
  const stopAcknowledgements = [];
  const reconciliations = [];
  const pending = deferred();
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.mkdirSync(path.dirname(scratchPath), { recursive: true });
  fixture.host.inspectScope = async (_task, context) => {
    events.push(`scope-${context.phase}`);
    return { identity: BASELINE_ID, within_scope: true, wip_preserved: true };
  };
  fixture.host.execute = async (target, _task, context) => {
    const request = attemptOf(context);
    attempts.push({ provider: target.provider, task_id: request.task_id, attempt_id: request.attempt_id });
    events.push(`execute-${attempts.length}`);
    if (attempts.length === 1) {
      fs.writeFileSync(receiptPath, 'partial receipt change');
      fs.writeFileSync(scratchPath, 'partial scratch proposal');
      return pending.promise;
    }
    fs.writeFileSync(receiptPath, 'verified receipt change');
    fs.writeFileSync(scratchPath, 'verified scratch proposal');
    return { status: 'SUCCEEDED', observed_target: observedTarget(target) };
  };
  fixture.host.stop = async (_task, context) => {
    events.push('stop');
    const acknowledgement = { status: 'STOPPED', task_id: context.request.task_id, attempt_id: context.request.attempt_id };
    stopAcknowledgements.push({ request: context.request, acknowledgement });
    pending.resolve({
      status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed',
      receipt: { attempt_id: context.request.attempt_id, task_id: context.request.task_id, status: 'INTERRUPTED' },
    });
    return acknowledgement;
  };
  fixture.host.reconcile = async (_task, context) => {
    events.push('reconcile');
    const proof = {
      status: 'PASSED',
      task_id: context.request.task_id,
      attempt_id: context.request.attempt_id,
      baseline_id: BASELINE_ID,
      scope_contained: true,
      wip_preserved: true,
      diff_verified: true,
      attributable_changes: assignedFiles,
      unconfirmed: [...assignedFiles],
      remaining: [],
      out_of_scope: [],
      raw_transcript: 'reconciliation-secret-sentinel',
      confirmed: [...assignedFiles],
    };
    reconciliations.push({ request: context.request, proof });
    return proof;
  };
  fixture.host.recover = async (_task, context) => {
    events.push('recover');
    assert.strictEqual(context.reconciliation.status, 'PASSED');
    return { action: 'resume', target: ANTHROPIC_TARGET };
  };
  fixture.host.verify = async (_task, outcome) => ({
    status: outcome.status === 'SUCCEEDED' && fs.readFileSync(receiptPath, 'utf8') === 'verified receipt change'
      && fs.readFileSync(scratchPath, 'utf8') === 'verified scratch proposal' ? 'PASSED' : 'FAILED',
    evidence: 'assigned product and scratch files verified',
  });

  let runPromise;
  try {
    runPromise = runFlowDrive(['Repair the receipt total.'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 1, executionTimeoutMs: 20, controlTimeoutMs: 200 },
    });
    const report = await awaitRecoveryReport(runPromise, () => pending.resolve({
      status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed',
    }));
    assert.notStrictEqual(report.status, undefined, 'runner returns a terminal report before the test watchdog');
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(attempts.length, 2);
    assert.notStrictEqual(attempts[0].attempt_id, attempts[1].attempt_id);
    const stopIndex = events.indexOf('stop');
    const reconcileIndex = events.indexOf('reconcile');
    const replacementIndex = events.indexOf('execute-2');
    assert.ok(stopIndex >= 0 && stopIndex < reconcileIndex && reconcileIndex < replacementIndex);
    assert.deepStrictEqual(stopAcknowledgements[0].acknowledgement, {
      status: 'STOPPED', task_id: attempts[0].task_id, attempt_id: attempts[0].attempt_id,
    });
    assert.strictEqual(reconciliations[0].request.task_id, attempts[0].task_id);
    assert.strictEqual(reconciliations[0].request.attempt_id, attempts[0].attempt_id);
    assert.deepStrictEqual(reconciliations[0].proof.attributable_changes, assignedFiles);
    assert.deepStrictEqual(reconciliations[0].proof.out_of_scope, []);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), 'verified receipt change');
    assert.strictEqual(fs.readFileSync(scratchPath, 'utf8'), 'verified scratch proposal');
    const evidence = report.execution.evidence;
    assert.ok(evidence.includes(attempts[0].attempt_id));
    assert.ok(evidence.includes(attempts[1].attempt_id));
    assert.ok(evidence.includes('TIMEOUT_OR_INTERRUPTION'));
    assert.strictEqual(JSON.stringify(report).includes('reconciliation-secret-sentinel'), false);
    const firstAttempt = parseExecutionEvidence(report)[0].attempts[0];
    assert.deepStrictEqual(firstAttempt.reconciliation.completion_ledger.confirmed, [], 'Host claimed completion cannot replace failed acceptance');
    assert.deepStrictEqual(firstAttempt.reconciliation.completion_ledger.unconfirmed, [...assignedFiles].sort());
  } finally {
    pending.resolve({ status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed' });
    if (runPromise) await Promise.race([runPromise, new Promise((resolve) => setTimeout(resolve, 1100))]);
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

async function missingNegativeScopeScenario() {
  const assignedFiles = ['src/receipt.js', 'scratch/recovery-notes.md'];
  const nodes = [
    { id: 'reader', goal: 'inspect receipt evidence', acceptance: ['evidence inspected'], role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: ANTHROPIC_TARGET },
    { id: 'writer', goal: 'repair receipt', acceptance: ['receipt repaired'], role: 'worker', authority: 'workspace-write', assigned_files: [...assignedFiles], dependencies: [], target: ANTHROPIC_TARGET },
  ];
  const fixture = graphFixture({ assignedFiles, nodes });
  const workdir = makeWorkdir('timeout-unproven');
  const pending = deferred();
  let readersCompleted = 0;
  let writerAttempts = 0;
  fs.mkdirSync(path.join(workdir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(workdir, 'scratch'), { recursive: true });
  fixture.host.inspectScope = async () => ({ identity: BASELINE_ID, within_scope: true, wip_preserved: true });
  fixture.host.execute = async (_target, _task, context) => {
    if (context.node.id === 'reader') {
      readersCompleted += 1;
      return { status: 'SUCCEEDED', observed_target: observedTarget(ANTHROPIC_TARGET) };
    }
    writerAttempts += 1;
    fs.writeFileSync(path.join(workdir, assignedFiles[0]), 'partial receipt change');
    fs.writeFileSync(path.join(workdir, assignedFiles[1]), 'partial scratch proposal');
    return pending.promise;
  };
  fixture.host.stop = async (_task, context) => {
    pending.resolve({ status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed' });
    return { status: 'STOPPED', task_id: context.request.task_id, attempt_id: context.request.attempt_id };
  };
  fixture.host.reconcile = async (_task, context) => ({
    status: 'PASSED',
    task_id: context.request.task_id,
    attempt_id: context.request.attempt_id,
    baseline_id: BASELINE_ID,
    scope_contained: true,
    wip_preserved: true,
    diff_verified: true,
    attributable_changes: [assignedFiles[0]],
    unconfirmed: [assignedFiles[0]],
    remaining: [assignedFiles[1]],
    // No out_of_scope list: the absence of changes outside the assigned scope is unproven.
  });
  fixture.host.recover = async () => ({ action: 'resume', target: ANTHROPIC_TARGET });
  fixture.host.verify = async () => ({ status: 'PASSED', evidence: 'read-only evidence inspected' });

  let runPromise;
  try {
    runPromise = runFlowDrive(['Inspect and repair the receipt.'], {
      host: fixture.host,
      workdir,
      recovery: { retryBudget: 1, executionTimeoutMs: 20, controlTimeoutMs: 200 },
    });
    const report = await awaitRecoveryReport(runPromise, () => pending.resolve({
      status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed',
    }));
    assert.notStrictEqual(report.status, undefined, 'runner returns a terminal report before the test watchdog');
    assert.strictEqual(readersCompleted, 1);
    assert.strictEqual(writerAttempts, 1);
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    const results = parseExecutionEvidence(report);
    assert.strictEqual(results.find((result) => result.id === 'reader').status, 'SUCCEEDED');
    assert.notStrictEqual(results.find((result) => result.id === 'writer').status, 'SUCCEEDED');
  } finally {
    pending.resolve({ status: 'INTERRUPTED', failure_class: 'TIMEOUT_OR_INTERRUPTION', side_effects: 'observed' });
    if (runPromise) await Promise.race([runPromise, new Promise((resolve) => setTimeout(resolve, 1100))]);
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('missing negative scope proof suspends the writer while an independent reader completes', () => runIsolated('negative-proof'));

async function secretScenario() {
  const fixture = createRunnerFixture();
  const workdir = makeWorkdir('redacted-error');
  const secret = 'sk-ant-api03-sensitive-test-token';
  const recoveryRequests = [];
  let executed = 0;
  fixture.host.execute = async () => { executed += 1; throw new Error(`provider request failed: ${secret}`); };
  fixture.host.recover = async (_task, context) => {
    recoveryRequests.push(context);
    return { action: 'stop' };
  };

  try {
    let report;
    try {
      report = await runFlowDrive(['Update the receipt total.'], {
        host: fixture.host,
        workdir,
        recovery: { retryBudget: 0 },
      });
    } catch (error) {
      report = { status: 'THREW', error: error.message };
    }
    assert.notStrictEqual(report.status, 'THREW', 'executor failure still produces a terminal report');
    assert.strictEqual(executed, 1, 'the throwing executor was actually invoked');
    assert.strictEqual(JSON.stringify(report).includes(secret), false);
    assert.strictEqual(JSON.stringify(recoveryRequests).includes(secret), false);
    assert.notStrictEqual(report.acceptance && report.acceptance.status, 'PASSED');
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('raw provider credentials from an executor error are absent from the terminal report', () => runIsolated('secret'));

function runIsolated(scenario) {
  const child = spawnSync(process.execPath, [__filename, '--isolation', scenario], { encoding: 'utf8', timeout: 3000 });
  assert.strictEqual(child.error, undefined, `bounded child completed: ${scenario}`);
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.ok(child.stdout.includes('isolated recovery scenario passed'));
}

async function suspensionScenario(scenario) {
  const workdir = makeWorkdir(`suspended-${scenario}`);
  fs.mkdirSync(path.join(workdir, 'src'));
  fs.writeFileSync(path.join(workdir, 'unrelated-wip.txt'), 'preserve this WIP');
  const fixture = createRunnerFixture();
  const queued = createRunnerFixture();
  const reader = createRunnerFixture({ task: { goal: 'read evidence', acceptance: ['read evidence verified'], constraints: { authority: 'read-only' } } });
  const pending = deferred();
  const entered = deferred();
  let replacementExecutions = 0;
  let stopCalls = 0;
  fixture.host.execute = async () => {
    fs.writeFileSync(path.join(workdir, 'src/receipt.js'), 'partial assigned edit');
    if (scenario === 'out-of-scope') fs.writeFileSync(path.join(workdir, 'unrelated-wip.txt'), 'damaged WIP');
    entered.resolve();
    if (scenario === 'ordinary-throw') throw new Error('unresolved provider writer failed');
    if (scenario === 'ordinary-malformed') return { status: 'INVALID' };
    if (scenario === 'ordinary-timeout') return { status: 'TIMEOUT', failure_class: 'TASK_OR_SEMANTIC_FAILURE', side_effects: 'observed' };
    return pending.promise;
  };
  fixture.host.inspectScope = async () => ({ ...(scenario === 'missing-baseline' ? {} : { identity: BASELINE_ID }), within_scope: true, wip_preserved: true });
  if (scenario !== 'missing-stop') fixture.host.stop = async (_task, context) => {
    stopCalls += 1;
    if (scenario === 'stop-timeout') return new Promise(() => {});
    return { status: ['negative-stop', 'ordinary-timeout', 'ordinary-throw', 'ordinary-malformed'].includes(scenario) ? 'FAILED' : 'STOPPED', task_id: context.request.task_id,
      attempt_id: scenario === 'wrong-stop' ? 'foreign-attempt' : context.request.attempt_id };
  };
  if (scenario !== 'missing-reconcile') fixture.host.reconcile = async (_task, context) => {
    if (scenario === 'reconcile-timeout') return new Promise(() => {});
    return { status: scenario === 'negative-reconcile' ? 'FAILED' : 'PASSED', task_id: context.request.task_id,
      attempt_id: context.request.attempt_id, baseline_id: BASELINE_ID,
      scope_contained: true, wip_preserved: true, diff_verified: true,
      attributable_changes: scenario === 'forged-diff' ? [] : ['src/receipt.js'],
      unconfirmed: ['src/receipt.js'], remaining: [], out_of_scope: [] };
  };
  fixture.host.recover = async () => ({ action: 'resume', target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'max' } });
  queued.host.execute = async () => { replacementExecutions += 1; return { status: 'SUCCEEDED' }; };
  try {
    const first = runFlowDrive(['Interrupt a partial write.'], { host: fixture.host, workdir,
      ...(scenario.startsWith('ordinary-') ? {} : { recovery: { retryBudget: 1, executionTimeoutMs: 20, controlTimeoutMs: 30 } }) });
    await entered.promise;
    const second = runFlowDrive(['Queue another writer.'], { host: queued.host, workdir });
    const readReport = await runFlowDrive(['Read independent evidence.'], { host: reader.host, workdir });
    assert.strictEqual(readReport.acceptance.status, 'PASSED');
    const firstReport = await awaitRecoveryReport(first);
    const queuedReport = await awaitRecoveryReport(second);
    assert.strictEqual(firstReport.status, 'REPORTED');
    assert.strictEqual(firstReport.acceptance.status, 'BLOCKED');
    if (scenario === 'ordinary-timeout') assert.strictEqual(stopCalls, 1, 'timeout status requires stopping even without retry opt-in or matching failure_class');
    assert.strictEqual(queuedReport.status, 'REPORTED');
    assert.ok(queuedReport.blockers.some((reason) => reason.includes('RECONCILIATION_REQUIRED')));
    assert.strictEqual(replacementExecutions, 0);
    pending.resolve({ status: 'SUCCEEDED' });
    await new Promise((resolve) => setImmediate(resolve));
    const newWriter = await awaitRecoveryReport(runFlowDrive(['Writer after late completion.'], { host: queued.host, workdir }));
    assert.strictEqual(newWriter.status, 'REPORTED');
    assert.ok(newWriter.blockers.some((reason) => reason.includes('RECONCILIATION_REQUIRED')));
    assert.strictEqual(replacementExecutions, 0, 'late completion cannot clear the suspended owner');
    if (scenario !== 'out-of-scope') assert.strictEqual(fs.readFileSync(path.join(workdir, 'unrelated-wip.txt'), 'utf8'), 'preserve this WIP');
  } finally {
    pending.resolve({ status: 'INTERRUPTED' });
    fixture.cleanup(); queued.cleanup(); reader.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('unconfirmed stop and reconciliation suspend queued and new writers while readers progress', () => {
  for (const scenario of ['missing-stop', 'negative-stop', 'wrong-stop', 'stop-timeout', 'missing-reconcile',
    'negative-reconcile', 'reconcile-timeout', 'forged-diff', 'out-of-scope', 'ordinary-timeout', 'ordinary-throw', 'ordinary-malformed', 'missing-baseline']) runIsolated(scenario);
});

test('solo recovery shares the public attempt lifecycle and retains parent acceptance', async () => {
  const fixture = createRunnerFixture({ task: { ...taskFor(), constraints: { ...taskFor().constraints, delegation: 'none' } },
    capabilities: { host_profile: CLAUDE_PROFILE, catalog: CATALOG }, decision: { mode: 'solo', target: ANTHROPIC_TARGET } });
  const workdir = makeWorkdir('solo-recovery');
  const attempts = [];
  allowProviders(fixture.host, ['openai'], 'solo-provider-grant');
  fixture.host.execute = async (target, _task, context) => {
    attempts.push(context.request);
    return attempts.length === 1 ? { status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none' }
      : { status: 'SUCCEEDED', observed_target: observedTarget(target) };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  fixture.host.verify = async (_task, outcome) => ({ status: outcome.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED', evidence: 'literal acceptance checked' });
  try {
    const report = await runFlowDrive(['Recover one solo task.', '--cross-provider'], { host: fixture.host, workdir, recovery: { retryBudget: 1 } });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(attempts.length, 2);
    assert.strictEqual(attempts[0].task_id, attempts[1].task_id);
    assert.notStrictEqual(attempts[0].attempt_id, attempts[1].attempt_id);
    const evidence = JSON.parse(report.execution.evidence);
    assert.strictEqual(evidence.length, 2);
    assert.strictEqual(evidence[0].receipt.schema, 'dhpk.dispatch.receipt.v2');
    assert.strictEqual(evidence[0].receipt.attempt_id, attempts[0].attempt_id);
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

test('recovery blocks assigned symlinks and symlink ancestors before any executor call', async () => {
  for (const recovery of [undefined, { retryBudget: 1 }]) for (const ancestor of [false, true]) {
    const workdir = makeWorkdir('symlink-workspace');
    const outside = makeWorkdir('symlink-outside');
    fs.writeFileSync(path.join(outside, 'receipt.js'), 'outside WIP');
    fs.mkdirSync(path.join(workdir, 'src'));
    if (ancestor) fs.symlinkSync(outside, path.join(workdir, 'linked'));
    else fs.symlinkSync(path.join(outside, 'receipt.js'), path.join(workdir, 'src/receipt.js'));
    const assigned = ancestor ? 'linked/receipt.js' : 'src/receipt.js';
    const fixture = createRunnerFixture({ task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, assigned_files: [assigned] } } });
    let executed = 0;
    fixture.host.execute = async () => { executed += 1; fs.writeFileSync(path.join(workdir, assigned), 'damaged'); return { status: 'FAILED' }; };
    try {
      const report = await runFlowDrive(['Write within physical scope.'], { host: fixture.host, workdir, recovery });
      assert.strictEqual(executed, 0);
      assert.notStrictEqual(report.acceptance.status, 'PASSED');
      assert.strictEqual(fs.readFileSync(path.join(outside, 'receipt.js'), 'utf8'), 'outside WIP');
    } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  }
});

test('the retry budget is shared across graph nodes and verified independent work executes once', async () => {
  const nodes = [
    { id: 'reader', goal: 'read', acceptance: ['verified'], role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: ANTHROPIC_TARGET },
    ...['first', 'second'].map((id) => ({ id, goal: 'repair', acceptance: ['verified'], role: 'worker', authority: 'workspace-write',
      assigned_files: [`src/${id}.js`], dependencies: [], target: ANTHROPIC_TARGET })),
  ];
  const fixture = graphFixture({ assignedFiles: ['src/first.js', 'src/second.js'], nodes });
  const workdir = makeWorkdir('graph-budget');
  const executions = [];
  allowProviders(fixture.host, ['openai'], 'graph-node-budget');
  fixture.host.execute = async (target, _task, context) => {
    executions.push({ id: context.node.id, provider: target.provider });
    return context.node.id === 'reader' || target.provider === 'openai' ? { status: 'SUCCEEDED', observed_target: observedTarget(target) }
      : { status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none' };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  fixture.host.verify = async (_task, outcome) => ({ status: outcome.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED', evidence: 'acceptance checked' });
  try {
    const report = await runFlowDrive(['Recover only affected graph work.', '--cross-provider'], { host: fixture.host, workdir, recovery: { retryBudget: 1 } });
    assert.deepStrictEqual(executions.filter((entry) => entry.id === 'first').map((entry) => entry.provider), ['anthropic', 'openai']);
    assert.deepStrictEqual(executions.filter((entry) => entry.id === 'second').map((entry) => entry.provider), ['anthropic']);
    assert.strictEqual(executions.filter((entry) => entry.id === 'reader').length, 1);
    const results = parseExecutionEvidence(report);
    assert.strictEqual(results.find((entry) => entry.id === 'reader').status, 'SUCCEEDED');
    assert.strictEqual(results.find((entry) => entry.id === 'first').status, 'SUCCEEDED');
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

test('concurrent read-only failures admit only one replacement from the shared budget', async () => {
  const nodes = ['one', 'two'].map((id) => ({ id, goal: 'inspect', acceptance: ['verified'], role: 'worker',
    authority: 'read-only', assigned_files: [], dependencies: [], target: ANTHROPIC_TARGET }));
  const fixture = graphFixture({ nodes });
  const workdir = makeWorkdir('concurrent-budget');
  const getCapabilities = fixture.host.getCapabilities;
  fixture.host.getCapabilities = async (context) => {
    const capabilities = await getCapabilities(context);
    const pool = capabilities.host_profile.quota_pools.anthropic;
    return { ...capabilities, host_profile: { ...capabilities.host_profile,
      concurrency_limits: { ...capabilities.host_profile.concurrency_limits, [pool]: 2 } } };
  };
  const selectionsReady = deferred();
  let selections = 0;
  const executions = [];
  fixture.host.askProviderScope = async () => ({ status: 'ANSWERED', answer_id: 'concurrent-readers', providers: ['openai'] });
  fixture.host.execute = async (target, _task, context) => {
    executions.push({ provider: target.provider, model: target.model_id, attempt_id: context.request.attempt_id });
    return target.model_id !== 'sonnet5' ? { status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none' }
      : { status: 'SUCCEEDED', observed_target: observedTarget(target) };
  };
  fixture.host.recover = async () => {
    selections += 1;
    if (selections === 2) selectionsReady.resolve();
    await selectionsReady.promise;
    return { action: 'substitute', target: { ...ANTHROPIC_TARGET, model_id: 'sonnet5' } };
  };
  fixture.host.verify = async (_task, outcome) => ({ status: outcome.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED', evidence: 'acceptance checked' });
  try {
    const report = await runFlowDrive(['Inspect independent evidence.', '--cross-provider'], { host: fixture.host, workdir,
      recovery: { retryBudget: 1, controlTimeoutMs: 200 } });
    assert.strictEqual(executions.filter((entry) => entry.model === 'sonnet5').length, 1);
    assert.strictEqual(executions.length, 3);
    const attempts = parseExecutionEvidence(report).flatMap((entry) => entry.attempts);
    assert.strictEqual(attempts.length, 3, 'budget exhaustion keeps both initial receipts');
    assert.ok(attempts.every((attempt) => attempt.remaining_budget >= 0));
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

test('a recovered prerequisite invalidates downstream reuse while parent acceptance still verifies fresh work', async () => {
  const nodes = [
    { id: 'writer', goal: 'repair', acceptance: ['verified'], role: 'worker', authority: 'workspace-write',
      assigned_files: ['src/receipt.js'], dependencies: [], target: ANTHROPIC_TARGET },
    { id: 'dependent', goal: 'inspect repaired receipt', acceptance: ['verified'], role: 'reviewer', authority: 'read-only', independent_of: ['writer'],
      assigned_files: [], dependencies: ['writer'], target: ANTHROPIC_TARGET },
  ];
  const fixture = graphFixture({ nodes });
  const workdir = makeWorkdir('dependency-reuse');
  let reuseCalls = 0;
  let freshReads = 0;
  let parentVerifications = 0;
  allowProviders(fixture.host, ['openai'], 'dependency-reuse-grant');
  fixture.host.coordinate = async (task) => {
    const dependent = nodes[1];
    return { mode: 'coordinated', nodes: [nodes[0], { ...dependent, reuse: {
      prompt_sha256: task.constraints.prompt_evidence.sha256, baseline_identity: 'fixture-baseline',
      task_digest: nodeTaskDigest(dependent, createNodeTask(task, dependent), workdir),
    } }] };
  };
  fixture.host.verifyReuse = async () => { reuseCalls += 1; return { status: 'PASSED', evidence: 'old dependency acceptance', executor_identity: { agent_id: 'old-review-agent', session_id: 'old-review-session' } }; };
  fixture.host.execute = async (target, _task, context) => {
    if (context.node.id === 'dependent') { freshReads += 1; return { status: 'SUCCEEDED', observed_target: observedTarget(target), executor_identity: { agent_id: 'review-agent', session_id: 'review-session' } }; }
    return target.provider === 'anthropic' ? { status: 'FAILED', failure_class: 'CLI_UNAVAILABLE', side_effects: 'none' }
      : { status: 'SUCCEEDED', observed_target: observedTarget(target), executor_identity: { agent_id: 'writer-agent', session_id: 'writer-session' } };
  };
  fixture.host.recover = async () => ({ action: 'substitute', target: OPENAI_TARGET });
  fixture.host.verify = async (_task, outcome, context) => {
    if (context.graph) parentVerifications += 1;
    return { status: outcome.status === 'SUCCEEDED' ? 'PASSED' : 'FAILED', evidence: 'fresh dependency acceptance verified' };
  };
  try {
    const report = await runFlowDrive(['Recover and verify the dependency.', '--cross-provider'], { host: fixture.host, workdir, recovery: { retryBudget: 1 } });
    assert.strictEqual(reuseCalls, 0);
    assert.strictEqual(freshReads, 1);
    assert.strictEqual(parentVerifications, 1);
    assert.strictEqual(report.acceptance.status, 'PASSED');
  } finally { fixture.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
});

if (process.argv[2] === '--isolation') {
  const scenario = process.argv[3];
  (scenario === 'negative-proof' ? missingNegativeScopeScenario() : scenario === 'secret' ? secretScenario() : suspensionScenario(scenario))
    .then(() => console.log('isolated recovery scenario passed'))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
} else run('flow-drive-recovery');
