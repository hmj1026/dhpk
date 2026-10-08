'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assert } = require('./tinytest');
const { runFlowDrive } = require('../../skills/flow-drive/scripts/run');
const { createRunnerFixture, DEFAULT_TASK, DEFAULT_TARGET } = require('./flow-drive-runner-fixtures');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function assertPostlaunchCleanupBarrier(mode, failureMode) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), `flow-drive-${mode}-cleanup-${failureMode}-`));
  const first = createRunnerFixture(mode === 'graph' ? {
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: 'coordinated' } },
    decision: { mode: 'coordinated', nodes: [{ id: 'graph-write', goal: 'write', acceptance: ['write verified'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target: DEFAULT_TARGET }] },
  } : {});
  const second = createRunnerFixture();
  const baseline = Object.freeze({ identity: `baseline-${failureMode}` });
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
    if (failureMode === 'throw') throw new Error('executor stopped after a partial write');
    return failureMode === 'observed-mismatch' ? { status: 'SUCCEEDED', observed_target: { ...DEFAULT_TARGET, provider: 'anthropic' } } : { status: 'INVALID' };
  };
  first.host.stop = async (_task, context) => ({ status: 'STOPPED', task_id: context.request.task_id, attempt_id: context.request.attempt_id });
  first.host.reconcile = async (_task, context) => ({
    status: 'PASSED', task_id: context.request.task_id, attempt_id: context.request.attempt_id,
    baseline_id: baseline.identity, scope_contained: true, wip_preserved: true, diff_verified: true,
    attributable_changes: ['src/receipt.js'], unconfirmed: ['src/receipt.js'], remaining: [], out_of_scope: [],
  });
  second.host.execute = async () => {
    secondExecutions += 1;
    return { status: 'SUCCEEDED', observed_target: { ...DEFAULT_TARGET } };
  };

  try {
    firstPromise = runFlowDrive(['Exercise solo cleanup.'], { host: first.host, workdir });
    await executeEntered.promise;
    secondPromise = runFlowDrive(['Queue the next solo writer.'], { host: second.host, workdir });
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
    assert.strictEqual(postCalls.length, 1, 'post-scope inspection must not be retried after completion or an inspection error');
    assert.strictEqual(postCalls[0].baseline, baseline, 'cleanup retains the original prelaunch baseline');
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


module.exports = Object.freeze({ assertPostlaunchCleanupBarrier });
