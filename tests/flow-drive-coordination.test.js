'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const { validateTaskGraph, nodeTaskDigest } = require('../skills/flow-drive/scripts/task-graph');
const { createRunnerFixture, DEFAULT_TASK, DEFAULT_TARGET, CODEX_PROFILE, CATALOG } = require('./_lib/flow-drive-runner-fixtures');
const REASONER_TARGET = Object.freeze({ target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-sol', effort: 'high' });

function makeWorkdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `flow-drive-${prefix}-`));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function assertGraphPostlaunchCleanupBarrier(failureMode) {
  const workdir = makeWorkdir(`graph-cleanup-${failureMode}`);
  const first = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'graph-write', goal: 'write', acceptance: ['write verified'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  const second = createRunnerFixture();
  const baseline = Object.freeze({ identity: `graph-baseline-${failureMode}` });
  const executeEntered = deferred();
  const executeGate = deferred();
  const postEntered = deferred();
  const postGate = deferred();
  const postCalls = [];
  let secondExecutions = 0;
  let firstPromise;
  let secondPromise;

  first.host.inspectScope = async (_task, context) => {
    if (context.phase === 'pre') return baseline;
    postCalls.push(context);
    postEntered.resolve();
    await postGate.promise;
    if (failureMode === 'observed-mismatch') throw new Error('post-scope inspection failed');
    return { within_scope: true, wip_preserved: true };
  };
  first.host.execute = async () => {
    executeEntered.resolve();
    await executeGate.promise;
    fs.mkdirSync(path.join(workdir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workdir, 'src/receipt.js'), 'partial');
    if (failureMode === 'throw') throw new Error('graph executor stopped after a partial write');
    return { status: 'SUCCEEDED', observed_target: { ...DEFAULT_TARGET, provider: 'anthropic' } };
  };
  second.host.execute = async () => {
    secondExecutions += 1;
    return { status: 'SUCCEEDED', observed_target: { ...DEFAULT_TARGET } };
  };

  try {
    firstPromise = runFlowDrive(['Exercise graph cleanup.'], { host: first.host, workdir });
    await executeEntered.promise;
    secondPromise = runFlowDrive(['Queue the next graph writer.'], { host: second.host, workdir });
    await new Promise((resolve) => setImmediate(resolve));
    executeGate.resolve();

    const cleanupStarted = await Promise.race([
      postEntered.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert.strictEqual(cleanupStarted, true, 'postlaunch failure must still inspect the writer scope');
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(secondExecutions, 0, 'the next writer must wait for post-scope inspection');
    assert.strictEqual(postCalls.length, 1, 'post-scope inspection must run exactly once');
    assert.strictEqual(postCalls[0].baseline, baseline, 'post-scope inspection must receive the prelaunch baseline');

    postGate.resolve();
    const firstReport = await firstPromise;
    assert.strictEqual(postCalls.length, 1, 'post-scope inspection must not be retried after an inspection error');
    assert.strictEqual(postCalls[0].baseline, baseline, 'post-scope inspection must receive the prelaunch baseline');
    await secondPromise;
    assert.notStrictEqual(firstReport.acceptance.status, 'PASSED');
    assert.ok(secondExecutions > 0, 'the queued writer should continue after scope inspection completes');
  } finally {
    executeGate.resolve();
    postGate.resolve();
    await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    first.cleanup();
    second.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

test('task graph rejects duplicate, unknown, and cyclic dependencies', () => {
  assert.throws(() => validateTaskGraph({ mode: 'coordinated', nodes: [
    { id: 'a', goal: 'a', acceptance: ['a'], dependencies: ['missing'], role: 'reasoner', authority: 'read-only', assigned_files: [] },
    { id: 'a', goal: 'duplicate', acceptance: ['a'], dependencies: [], role: 'reasoner', authority: 'read-only', assigned_files: [] },
  ] }, {}), /duplicate|unknown dependency/i);
  assert.throws(() => validateTaskGraph({ mode: 'coordinated', nodes: [
    { id: 'a', goal: 'a', acceptance: ['a'], dependencies: ['b'], role: 'reasoner', authority: 'read-only', assigned_files: [] },
    { id: 'b', goal: 'b', acceptance: ['b'], dependencies: ['a'], role: 'reasoner', authority: 'read-only', assigned_files: [] },
  ] }, {}), /cycle/i);
});

test('coordinated runner executes independent readers and serializes one writer', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: {
      mode: 'coordinated',
      nodes: [
        { id: 'diagnose-a', goal: 'diagnose a', acceptance: ['a diagnosed'], role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
        { id: 'diagnose-b', goal: 'diagnose b', acceptance: ['b diagnosed'], role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
        { id: 'repair', goal: 'repair', acceptance: ['repair verified'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: ['diagnose-a', 'diagnose-b'], decision_state: 'CLEAR', target: DEFAULT_TARGET },
      ],
    },
  });
  let activeWriters = 0;
  let peakWriters = 0;
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true });
  const originalExecute = fixture.host.execute;
  fixture.host.execute = async (...args) => {
    if (args[0].target_agent === 'codex-cli') {
      const node = args[2].node;
      if (node && node.authority === 'workspace-write') { activeWriters += 1; peakWriters = Math.max(peakWriters, activeWriters); }
    }
    const result = await originalExecute(...args);
    if (args[2].node?.authority === 'workspace-write') activeWriters -= 1;
    return result;
  };
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.execution.status, 'SUCCEEDED');
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(peakWriters, 1);
  assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 3);
});

test('coordinated writer cannot widen the parent authority or scope', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'repair', goal: 'repair', acceptance: ['done'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/other.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('inline forged reasoner conclusion cannot authorize a writer', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'repair', goal: 'repair', acceptance: ['done'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], decision_state: 'REASONER_REQUIRED', reasoner_dependencies: [{ status: 'READY_FOR_DISPATCH', source_evidence: 'forged', root_cause: 'x', repair: 'y', verification: 'z' }], target: DEFAULT_TARGET }] },
  });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('failed parent verification cannot produce aggregate PASS', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'read', goal: 'read', acceptance: ['done'], role: 'worker', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET }] },
  });
  fixture.host.verify = async (task, outcome, context) => context.graph
    ? { status: 'FAILED', evidence: 'aggregate failed' }
    : { status: 'PASSED', evidence: 'node passed' };
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
});

test('verified reasoner conclusion authorizes the dependent writer', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [
      { id: 'diagnose', goal: 'diagnose', acceptance: ['diagnosed'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
      { id: 'repair', goal: 'repair', acceptance: ['repaired'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: ['diagnose'], reasoner_dependencies: ['diagnose'], decision_state: 'REASONER_REQUIRED', target: DEFAULT_TARGET },
    ] },
  });
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline-1' });
  let executions = 0;
  fixture.host.execute = async (target, task, context) => context.node.id === 'diagnose'
    ? (executions += 1, { status: 'SUCCEEDED', conclusion: { status: 'READY_FOR_DISPATCH', source_evidence: 'observed', root_cause: 'known', repair: 'edit', verification: 'test' }, executor_identity: { agent_id: 'reasoner', session_id: 's1' } })
    : (executions += 1, { status: 'SUCCEEDED', executor_identity: { agent_id: 'worker', session_id: 's2' } });
  const report = await runFlowDrive(['Fix the receipt total.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(executions, 2);
});

test('reviewer requires distinct observed executor identity', async () => {
  const make = (identity) => createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', authority: 'read-only', assigned_files: [] } },
    decision: { mode: 'coordinated', nodes: [
      { id: 'author', goal: 'author', acceptance: ['authored'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
      { id: 'review', goal: 'review', acceptance: ['reviewed'], role: 'reviewer', authority: 'read-only', assigned_files: [], dependencies: ['author'], independent_of: ['author'], target: DEFAULT_TARGET },
    ] },
  });
  const same = make({ agent_id: 'same', session_id: 's' });
  same.host.execute = async () => ({ status: 'SUCCEEDED', executor_identity: { agent_id: 'same', session_id: 's' } });
  const blocked = await runFlowDrive(['Review.'], { host: same.host, workdir: '/repo' });
  assert.strictEqual(blocked.acceptance.status, 'BLOCKED');
  const distinct = make();
  let count = 0;
  distinct.host.execute = async () => { const index = count++; return { status: 'SUCCEEDED', executor_identity: { agent_id: index ? 'reviewer' : 'author', session_id: index ? 's2' : 's1' } }; };
  const passed = await runFlowDrive(['Review.'], { host: distinct.host, workdir: '/repo' });
  assert.strictEqual(passed.acceptance.status, 'PASSED');
  const missing = make();
  missing.host.execute = async () => ({ status: 'SUCCEEDED' });
  const missingReport = await runFlowDrive(['Review.'], { host: missing.host, workdir: '/repo' });
  assert.strictEqual(missingReport.acceptance.status, 'BLOCKED');
});

test('stale reuse evidence falls back to a fresh execution', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'reuse', goal: 'reuse', acceptance: ['done'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET, reuse: { prompt_sha256: 'PLACEHOLDER', task_digest: 'PLACEHOLDER', baseline_identity: 'baseline-1' } }] },
  });
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline-1' });
  fixture.host.verifyReuse = async (reuse) => ({ status: 'PASSED', evidence: 'prior verified receipt', executor_identity: { agent_id: 'prior', session_id: 'old' } });
  const originalResolve = fixture.host.resolveTask;
  fixture.host.resolveTask = async (...args) => {
    const task = await originalResolve(...args);
    fixture.decision = task;
    return task;
  };
  const report = await runFlowDrive(['Reuse.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 1);
});

test('host verified reuse can satisfy a writer without executing it', async () => {
  const fixture = createRunnerFixture({ task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } }, decision: { mode: 'solo' } });
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline-1' });
  fixture.host.coordinate = async (task) => { const node = { id: 'reuse', goal: 'reuse', acceptance: ['done'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'] }; const nodeTask = { ...task, goal: node.goal, acceptance: node.acceptance, constraints: { ...task.constraints, authority: node.authority, assigned_files: node.assigned_files } }; return { mode: 'coordinated', nodes: [{ ...node, dependencies: [], target: DEFAULT_TARGET, reuse: { prompt_sha256: task.constraints.prompt_evidence.sha256, task_digest: nodeTaskDigest(node, nodeTask, '/repo'), baseline_identity: 'baseline-1' } }] }; };
  fixture.host.verifyReuse = async () => ({ status: 'PASSED', evidence: 'verified prior result', executor_identity: { agent_id: 'prior', session_id: 'old' } });
  const report = await runFlowDrive(['Reuse.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(fixture.calls.filter((call) => call.method === 'execute').length, 0);
});

test('scheduler overlaps readers while globally serializing disjoint writers', async () => {
  const files = ['src/receipt.js', 'tests/receipt.test.js', '.scratch/proposal.md'];
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', assigned_files: files } },
    capabilities: { host_profile: { ...CODEX_PROFILE, concurrency_limits: { ...CODEX_PROFILE.concurrency_limits, [CODEX_PROFILE.quota_pools.openai]: 2 } }, catalog: CATALOG },
    decision: { mode: 'coordinated', nodes: [
      { id: 'read-a', goal: 'read a', acceptance: ['a'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
      { id: 'read-b', goal: 'read b', acceptance: ['b'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [], target: DEFAULT_TARGET },
      ...files.map((file, index) => ({ id: `write-${index}`, goal: `write ${file}`, acceptance: ['written'], role: 'worker', authority: 'workspace-write', assigned_files: [file], dependencies: [], target: DEFAULT_TARGET })),
    ] },
  });
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline' });
  let activeReaders = 0; let peakReaders = 0; let activeWriters = 0; let peakWriters = 0;
  fixture.host.execute = async (target, task, context) => {
    const writer = context.node.authority === 'workspace-write';
    if (writer) { activeWriters += 1; peakWriters = Math.max(peakWriters, activeWriters); } else { activeReaders += 1; peakReaders = Math.max(peakReaders, activeReaders); }
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (writer) activeWriters -= 1; else activeReaders -= 1;
    return { status: 'SUCCEEDED', executor_identity: { agent_id: context.node.id, session_id: context.node.id } };
  };
  const report = await runFlowDrive(['Concurrent.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(peakReaders, 2);
  assert.strictEqual(peakWriters, 1);
});

test('solo and coordinated writers share the global lease', async () => {
  const solo = createRunnerFixture({ task: DEFAULT_TASK, decision: { mode: 'solo', target: DEFAULT_TARGET } });
  const graph = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'graph-write', goal: 'write', acceptance: ['written'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  solo.host.inspectScope = graph.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline' });
  let active = 0; let peak = 0;
  const execute = async (target, task, context) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return { status: 'SUCCEEDED', executor_identity: { agent_id: context.node?.id || 'solo', session_id: context.node?.id || 'solo' } };
  };
  solo.host.execute = execute;
  graph.host.execute = execute;
  const reports = await Promise.all([
    runFlowDrive(['Solo.'], { host: solo.host, workdir: '/repo' }),
    runFlowDrive(['Graph.'], { host: graph.host, workdir: '/repo' }),
  ]);
  assert.ok(reports.every((report) => report.acceptance.status === 'PASSED'));
  assert.strictEqual(peak, 1);
});

test('writer scope inspection preserves unrelated temporary WIP', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-scope-'));
  const wip = path.join(root, 'WIP.md');
  const assigned = path.join(root, 'src');
  fs.mkdirSync(assigned);
  fs.writeFileSync(wip, 'keep this WIP');
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', assigned_files: ['src/receipt.js'] } },
    decision: { mode: 'coordinated', nodes: [{ id: 'write', goal: 'write', acceptance: ['written'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  const wipHash = () => fs.readFileSync(wip, 'utf8');
  fixture.host.inspectScope = async (task, context) => ({
    identity: 'temp-baseline', within_scope: context.phase === 'pre' || fs.existsSync(path.join(root, 'src', 'receipt.js')),
    wip_preserved: wipHash() === 'keep this WIP',
  });
  fixture.host.execute = async () => { fs.writeFileSync(path.join(root, 'src', 'receipt.js'), 'ok'); return { status: 'SUCCEEDED' }; };
  const report = await runFlowDrive(['Scope.'], { host: fixture.host, workdir: root });
  assert.strictEqual(report.acceptance.status, 'PASSED');
  assert.strictEqual(wipHash(), 'keep this WIP');
  fs.rmSync(root, { recursive: true, force: true });
});

test('graph strict target contradiction blocks before execution', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', strict_target: { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna' } } },
    decision: { mode: 'coordinated', nodes: [{ id: 'strict', goal: 'strict', acceptance: ['done'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: { ...DEFAULT_TARGET, model_id: 'gpt-6-other' } }] },
  });
  fixture.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'baseline' });
  const report = await runFlowDrive(['Strict.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.acceptance.status, 'BLOCKED');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('parent reasoner requirement cannot be bypassed by omitted node role', async () => {
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', decision_state: 'REASONER_REQUIRED' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'implicit-worker', goal: 'write', acceptance: ['done'], authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  const report = await runFlowDrive(['Gate.'], { host: fixture.host, workdir: '/repo' });
  assert.strictEqual(report.status, 'BLOCKED');
  assert.strictEqual(fixture.calls.some((call) => call.method === 'execute'), false);
});

test('solo writer requires scope inspection and rejects out of scope post evidence', async () => {
  const missing = createRunnerFixture({ task: DEFAULT_TASK, decision: { mode: 'solo', target: DEFAULT_TARGET } });
  delete missing.host.inspectScope;
  const blocked = await runFlowDrive(['Missing scope.'], { host: missing.host, workdir: '/repo' });
  assert.strictEqual(blocked.acceptance.status, 'NOT_RUN');
  assert.strictEqual(missing.calls.some((call) => call.method === 'execute'), false);
  const outside = createRunnerFixture({ task: DEFAULT_TASK, decision: { mode: 'solo', target: DEFAULT_TARGET } });
  let phase = 'pre';
  outside.host.inspectScope = async () => phase === 'pre' ? { within_scope: true, wip_preserved: true } : { within_scope: false, wip_preserved: true };
  outside.host.execute = async () => { phase = 'post'; return { status: 'SUCCEEDED' }; };
  const rejected = await runFlowDrive(['Outside scope.'], { host: outside.host, workdir: '/repo' });
  assert.strictEqual(rejected.acceptance.status, 'BLOCKED');
});

test('solo verification and post scope remain inside the shared lease', async () => {
  const solo = createRunnerFixture({ task: DEFAULT_TASK, decision: { mode: 'solo', target: DEFAULT_TARGET } });
  const graph = createRunnerFixture({ task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } }, decision: { mode: 'coordinated', nodes: [{ id: 'g', goal: 'g', acceptance: ['g'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] } });
  solo.host.inspectScope = graph.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true });
  let verifying = false; let graphStarted = false;
  solo.host.execute = async () => ({ status: 'SUCCEEDED' });
  solo.host.verify = async (task, outcome, context) => { verifying = true; await new Promise((resolve) => setTimeout(resolve, 15)); verifying = false; return { status: 'PASSED', evidence: 'solo' }; };
  graph.host.execute = async () => { graphStarted = true; assert.strictEqual(verifying, false); return { status: 'SUCCEEDED' }; };
  const reports = await Promise.all([runFlowDrive(['Solo lease.'], { host: solo.host, workdir: '/repo' }), runFlowDrive(['Graph lease.'], { host: graph.host, workdir: '/repo' })]);
  assert.ok(reports.every((report) => report.acceptance.status === 'PASSED'));
  assert.strictEqual(graphStarted, true);
});

test('queued writer does not launch after same-content prompt inode replacement', async () => {
  const workdir = makeWorkdir('prompt-inode');
  fs.mkdirSync(path.join(workdir, 'src'));
  fs.writeFileSync(path.join(workdir, 'WIP.md'), 'preserve');
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', assigned_files: ['src/first.js', 'src/queued.js'] } },
    decision: { mode: 'coordinated', nodes: [
      { id: 'first-write', goal: 'write first', acceptance: ['first file exists'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/first.js'], dependencies: [], target: DEFAULT_TARGET },
      { id: 'queued-write', goal: 'write queued', acceptance: ['queued file exists'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/queued.js'], dependencies: [], target: DEFAULT_TARGET },
    ] },
  });
  let initialPromptInode;
  let promptEvidencePath;
  const wipPath = path.join(workdir, 'WIP.md');
  fixture.host.inspectScope = async (task, context) => ({
    identity: 'prompt-inode-baseline',
    within_scope: context.phase === 'pre' || task.constraints.assigned_files.every((file) => fs.existsSync(path.join(workdir, file))),
    wip_preserved: fs.readFileSync(wipPath, 'utf8') === 'preserve',
  });
  fixture.host.execute = async (_target, task, context) => {
    const assignedPath = path.join(workdir, task.constraints.assigned_files[0]);
    fs.writeFileSync(assignedPath, context.node.id);
    if (context.node.id === 'first-write') {
      const promptPath = task.constraints.prompt_evidence.path;
      promptEvidencePath = promptPath;
      const content = fs.readFileSync(promptPath);
      initialPromptInode = fs.statSync(promptPath).ino;
      const replacementPath = `${promptPath}.replacement`;
      fs.writeFileSync(replacementPath, content);
      fs.renameSync(replacementPath, promptPath);
    }
    return { status: 'SUCCEEDED', observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'max' } };
  };
  try {
    const report = await runFlowDrive(['Queue after evidence replacement.'], { host: fixture.host, workdir });
    assert.notStrictEqual(fs.statSync(promptEvidencePath).ino, initialPromptInode);
    assert.strictEqual(fs.readFileSync(promptEvidencePath, 'utf8'), 'Queue after evidence replacement.');
    assert.strictEqual(fs.existsSync(path.join(workdir, 'src/first.js')), true);
    assert.strictEqual(fs.existsSync(path.join(workdir, 'src/queued.js')), false);
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.ok(report.blockers.some((blocker) => blocker.includes('queued-write')));
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('strict graph target blocks when bound capability evidence resolves another effort', async () => {
  const capabilityConflict = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: {
      ...DEFAULT_TASK.constraints,
      delegation: 'coordinated',
      strict_target: { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'max' },
    } },
    decision: { mode: 'coordinated', nodes: [{
      id: 'strict-write', goal: 'write strict output', acceptance: ['output exists'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET,
    }] },
  });
  const originalCapabilities = capabilityConflict.host.getCapabilities;
  capabilityConflict.host.getCapabilities = async (context) => ({
    ...(await originalCapabilities(context)),
    capability_evidence: {
      kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'test executor evidence',
      observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
      host: 'codex-cli', target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', role: 'worker', authority: 'workspace-write',
      effort: 'high', effort_binding: 'parameter', route: 'native', transport: 'native-runtime',
    },
  });
  const launchMarker = path.join(os.tmpdir(), `flow-drive-strict-launch-${process.pid}-${Date.now()}`);
  capabilityConflict.host.execute = async () => { fs.writeFileSync(launchMarker, 'launched'); return { status: 'SUCCEEDED' }; };
  capabilityConflict.host.inspectScope = async () => ({ within_scope: true, wip_preserved: true, identity: 'strict-baseline' });
  try {
    const report = await runFlowDrive(['Strict capability evidence.'], { host: capabilityConflict.host, workdir: '/repo' });
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.strictEqual(fs.existsSync(launchMarker), false);
  } finally {
    capabilityConflict.cleanup();
    fs.rmSync(launchMarker, { force: true });
  }
});

test('graph observed model mismatch blocks acceptance for a strict target', async () => {
  const workdir = makeWorkdir('observed-model');
  fs.mkdirSync(path.join(workdir, 'src'));
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', strict_target: { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'max' } } },
    decision: { mode: 'coordinated', nodes: [{ id: 'observed-model-write', goal: 'write under strict model', acceptance: ['receipt updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  fixture.host.inspectScope = async (task, context) => ({ identity: 'observed-model-baseline', within_scope: context.phase === 'pre' || fs.existsSync(path.join(workdir, task.constraints.assigned_files[0])), wip_preserved: true });
  const verificationMarker = path.join(os.tmpdir(), `flow-drive-observed-model-verify-${process.pid}-${Date.now()}`);
  fixture.host.verify = async () => { fs.writeFileSync(verificationMarker, 'verified'); return { status: 'PASSED', evidence: 'Host verification passed' }; };
  fixture.host.execute = async () => {
    fs.writeFileSync(path.join(workdir, 'src/receipt.js'), 'updated');
    return { status: 'SUCCEEDED', observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-sol', effort: 'max' } };
  };
  try {
    const report = await runFlowDrive(['Verify observed model.'], { host: fixture.host, workdir });
    assert.strictEqual(report.execution.status, 'FAILED');
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.strictEqual(fs.readFileSync(verificationMarker, 'utf8'), 'verified');
    assert.strictEqual(fs.readFileSync(path.join(workdir, 'src/receipt.js'), 'utf8'), 'updated');
  } finally {
    fixture.cleanup();
    fs.rmSync(verificationMarker, { force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('graph observed effort mismatch blocks acceptance for a strict target', async () => {
  const workdir = makeWorkdir('observed-effort');
  fs.mkdirSync(path.join(workdir, 'src'));
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', strict_target: { provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'max' } } },
    decision: { mode: 'coordinated', nodes: [{ id: 'observed-effort-write', goal: 'write under strict effort', acceptance: ['receipt updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  fixture.host.inspectScope = async (task, context) => ({ identity: 'observed-effort-baseline', within_scope: context.phase === 'pre' || fs.existsSync(path.join(workdir, task.constraints.assigned_files[0])), wip_preserved: true });
  const verificationMarker = path.join(os.tmpdir(), `flow-drive-observed-effort-verify-${process.pid}-${Date.now()}`);
  fixture.host.verify = async () => { fs.writeFileSync(verificationMarker, 'verified'); return { status: 'PASSED', evidence: 'Host verification passed' }; };
  fixture.host.execute = async () => {
    fs.writeFileSync(path.join(workdir, 'src/receipt.js'), 'updated');
    return { status: 'SUCCEEDED', observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6-luna', effort: 'high' } };
  };
  try {
    const report = await runFlowDrive(['Verify observed effort.'], { host: fixture.host, workdir });
    assert.strictEqual(report.execution.status, 'FAILED');
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.strictEqual(fs.readFileSync(verificationMarker, 'utf8'), 'verified');
    assert.strictEqual(fs.readFileSync(path.join(workdir, 'src/receipt.js'), 'utf8'), 'updated');
  } finally {
    fixture.cleanup();
    fs.rmSync(verificationMarker, { force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('graph explicit worker target rejects a mismatched observed canonical model', async () => {
  const workdir = makeWorkdir('observed-model-alias');
  fs.mkdirSync(path.join(workdir, 'src'));
  const verificationMarker = path.join(os.tmpdir(), `flow-drive-observed-alias-verify-${process.pid}-${Date.now()}`);
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'explicit-model-write', goal: 'write with exact model', acceptance: ['receipt updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  fixture.host.inspectScope = async (task, context) => ({ identity: 'observed-alias-baseline', within_scope: context.phase === 'pre' || fs.existsSync(path.join(workdir, task.constraints.assigned_files[0])), wip_preserved: true });
  fixture.host.execute = async (_target, task) => {
    fs.writeFileSync(path.join(workdir, task.constraints.assigned_files[0]), 'updated');
    return { status: 'SUCCEEDED', observed_target: { target_agent: 'codex-cli', provider: 'openai', model_id: 'gpt-6.1-sol', effort: 'max' } };
  };
  fixture.host.verify = async () => { fs.writeFileSync(verificationMarker, 'verified'); return { status: 'PASSED', evidence: 'Host verification passed' }; };
  try {
    const report = await runFlowDrive(['Use the exact selected model.', '--worker-target=codex/gpt-6-luna:max'], { host: fixture.host, workdir });
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.strictEqual(fs.readFileSync(verificationMarker, 'utf8'), 'verified');
    assert.strictEqual(fs.readFileSync(path.join(workdir, 'src/receipt.js'), 'utf8'), 'updated');
  } finally {
    fixture.cleanup();
    fs.rmSync(verificationMarker, { force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('verified reused diagnosis unlocks its writer without relaunching diagnosis', async () => {
  const workdir = makeWorkdir('reused-diagnosis');
  fs.mkdirSync(path.join(workdir, 'src'));
  const dispatchLog = path.join(os.tmpdir(), `flow-drive-reuse-log-${process.pid}-${Date.now()}`);
  const fixture = createRunnerFixture({ task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } } });
  fixture.host.coordinate = async (task) => {
    const diagnosis = { id: 'diagnosis', goal: 'diagnose receipt mismatch', acceptance: ['cause established'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [] };
    const diagnosisTask = { ...task, goal: diagnosis.goal, acceptance: [...diagnosis.acceptance], constraints: { ...task.constraints, authority: 'read-only', assigned_files: [] } };
    const repair = { id: 'repair', goal: 'repair receipt mismatch', acceptance: ['receipt file updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: ['diagnosis'], reasoner_dependencies: ['diagnosis'], decision_state: 'REASONER_REQUIRED', target: DEFAULT_TARGET };
    return { mode: 'coordinated', nodes: [
      { ...diagnosis, target: REASONER_TARGET, reuse: { prompt_sha256: task.constraints.prompt_evidence.sha256, task_digest: nodeTaskDigest(diagnosis, diagnosisTask, workdir), baseline_identity: 'reuse-baseline' } },
      repair,
    ] };
  };
  fixture.host.inspectScope = async (task, context) => ({
    identity: 'reuse-baseline',
    within_scope: context.phase === 'pre' || task.constraints.assigned_files.every((file) => fs.existsSync(path.join(workdir, file))),
    wip_preserved: true,
  });
  fixture.host.verifyReuse = async () => ({
    status: 'PASSED', evidence: 'prior diagnosis receipt verified',
    executor_identity: { agent_id: 'prior-reasoner', session_id: 'prior-session' },
    conclusion: { status: 'READY_FOR_DISPATCH', source_evidence: 'receipt lines', root_cause: 'stale total', repair: 'update total', verification: 'compare output' },
  });
  fixture.host.execute = async (_target, task, context) => {
    fs.appendFileSync(dispatchLog, `${context.node.id}\n`);
    if (context.node.id === 'diagnosis') return { status: 'SUCCEEDED', conclusion: { status: 'NOT_READY', source_evidence: 'none', root_cause: 'unknown', repair: 'unknown', verification: 'unknown' } };
    fs.writeFileSync(path.join(workdir, task.constraints.assigned_files[0]), 'updated');
    return { status: 'SUCCEEDED', executor_identity: { agent_id: 'repair-worker', session_id: 'current-session' } };
  };
  try {
    const report = await runFlowDrive(['Reuse verified diagnosis.'], { host: fixture.host, workdir });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(fs.existsSync(path.join(workdir, 'src/receipt.js')), true);
    assert.strictEqual(fs.readFileSync(dispatchLog, 'utf8'), 'repair\n');
  } finally {
    fixture.cleanup();
    fs.rmSync(dispatchLog, { force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('read-only evidence can progress while a parent-required writer remains gated', async () => {
  const workdir = makeWorkdir('reasoner-gate');
  fs.mkdirSync(path.join(workdir, 'src'));
  const writerArtifact = path.join(workdir, 'src/receipt.js');
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated', decision_state: 'REASONER_REQUIRED' } },
    decision: { mode: 'coordinated', nodes: [
      { id: 'evidence', goal: 'inspect receipt evidence', acceptance: ['evidence inspected'], role: 'reasoner', authority: 'read-only', assigned_files: [], dependencies: [], target: REASONER_TARGET },
      { id: 'gated-write', goal: 'repair receipt', acceptance: ['receipt updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: ['evidence'], reasoner_dependencies: ['evidence'], decision_state: 'REASONER_REQUIRED', target: DEFAULT_TARGET },
    ] },
  });
  fixture.host.inspectScope = async (_task, context) => ({ identity: 'gate-baseline', within_scope: context.phase === 'pre' || fs.existsSync(writerArtifact), wip_preserved: true });
  fixture.host.execute = async (_target, _task, context) => context.node.id === 'evidence'
    ? { status: 'SUCCEEDED', conclusion: { status: 'NOT_READY', source_evidence: 'receipt inspected', root_cause: '', repair: '', verification: '' } }
    : (fs.writeFileSync(writerArtifact, 'updated'), { status: 'SUCCEEDED' });
  try {
    const report = await runFlowDrive(['Inspect before repair.'], { host: fixture.host, workdir });
    const nodeResults = JSON.parse(report.execution.evidence);
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
    assert.strictEqual(nodeResults.find((result) => result.id === 'evidence').status, 'SUCCEEDED');
    assert.strictEqual(nodeResults.find((result) => result.id === 'gated-write').status, 'BLOCKED');
    assert.strictEqual(fs.existsSync(writerArtifact), false);
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('graph legacy worker selector mismatch blocks before launching the selected target', async () => {
  const launchMarker = path.join(os.tmpdir(), `flow-drive-worker-alias-${process.pid}-${Date.now()}`);
  const fixture = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'codex-writer', goal: 'write receipt', acceptance: ['receipt updated'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  });
  fixture.host.inspectScope = async () => ({ identity: 'legacy-selector-baseline', within_scope: true, wip_preserved: true });
  fixture.host.execute = async () => { fs.writeFileSync(launchMarker, 'launched'); return { status: 'SUCCEEDED' }; };
  try {
    const report = await runFlowDrive(['Use the selected worker.', '--worker=claude'], { host: fixture.host, workdir: '/repo' });
    assert.strictEqual(fs.existsSync(launchMarker), false);
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.acceptance.status, 'BLOCKED');
  } finally {
    fixture.cleanup();
    fs.rmSync(launchMarker, { force: true });
  }
});

test('reuse receipt from an earlier write scope does not skip the current scope', async () => {
  const workdir = makeWorkdir('reuse-scope');
  fs.mkdirSync(path.join(workdir, 'src'));
  const currentArtifact = path.join(workdir, 'src/receipt.js');
  const fixture = createRunnerFixture({ task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } } });
  fixture.host.coordinate = async (task) => {
    const currentNode = { id: 'scope-write', goal: 'update receipt', acceptance: ['current receipt file exists'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET };
    const oldNode = { ...currentNode, assigned_files: ['src/previous.js'] };
    const oldTask = { ...task, goal: currentNode.goal, acceptance: [...currentNode.acceptance], constraints: { ...task.constraints, authority: 'workspace-write', assigned_files: ['src/previous.js'] } };
    return { mode: 'coordinated', nodes: [{ ...currentNode, reuse: {
      prompt_sha256: task.constraints.prompt_evidence.sha256,
      task_digest: nodeTaskDigest(oldNode, oldTask, workdir),
      baseline_identity: 'scope-baseline',
    } }] };
  };
  fixture.host.inspectScope = async (_task, context) => ({ identity: 'scope-baseline', within_scope: context.phase === 'pre' || fs.existsSync(currentArtifact), wip_preserved: true });
  fixture.host.verifyReuse = async () => ({ status: 'PASSED', evidence: 'previous scoped write receipt', executor_identity: { agent_id: 'old-worker', session_id: 'old-session' } });
  fixture.host.execute = async () => { fs.writeFileSync(currentArtifact, 'current scope updated'); return { status: 'SUCCEEDED' }; };
  try {
    const report = await runFlowDrive(['Update the current receipt scope.'], { host: fixture.host, workdir });
    assert.strictEqual(report.acceptance.status, 'PASSED');
    assert.strictEqual(fs.existsSync(currentArtifact), true);
    assert.strictEqual(fs.readFileSync(currentArtifact, 'utf8'), 'current scope updated');
  } finally {
    fixture.cleanup();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('graph executor failure inspects scope with its baseline before releasing the next writer', async () => {
  await assertGraphPostlaunchCleanupBarrier('throw');
});

test('graph observed-target mismatch inspects scope exactly once before releasing the next writer', async () => {
  await assertGraphPostlaunchCleanupBarrier('observed-mismatch');
});

run('flow-drive-coordination');
