'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { runFlowDrive } = require('../skills/flow-drive/scripts/run');
const { createRunnerFixture, DEFAULT_TASK, DEFAULT_TARGET } = require('./_lib/flow-drive-runner-fixtures');

async function lifecycleScenario(mode, failure, stop) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-drive-lifecycle-'));
  const receiptFailure = failure.endsWith('receipt');
  const target = receiptFailure ? { ...DEFAULT_TARGET, model_id: 'fresh-model' } : DEFAULT_TARGET;
  const first = createRunnerFixture({
    task: { ...DEFAULT_TASK, constraints: { ...DEFAULT_TASK.constraints, delegation: mode === 'graph' ? 'coordinated' : 'none' } },
    decision: mode === 'graph' ? { mode: 'coordinated', nodes: [{ id: 'writer', goal: 'write', acceptance: ['verified'], role: 'worker', authority: 'workspace-write', assigned_files: ['src/receipt.js'], dependencies: [], target }] } : { mode: 'solo', target },
  });
  const queued = createRunnerFixture();
  const reader = createRunnerFixture({ task: { goal: 'read', acceptance: ['read verified'], constraints: { authority: 'read-only' } } });
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let laterWrites = 0;
  first.host.execute = async () => {
    fs.mkdirSync(path.join(workdir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workdir, 'src/receipt.js'), 'partial');
    enter(); await gate;
    return failure === 'malformed'
      ? JSON.parse('{"status":"TIMEOUT","observed_target":{"provider":{"toString":null}}}')
      : { status: failure === 'completed-receipt' ? 'SUCCEEDED' : 'TIMEOUT' };
  };
  if (stop === 'negative') first.host.stop = async () => ({ status: 'FAILED' });
  if (receiptFailure) {
    const original = first.host.getCapabilities;
    first.host.getCapabilities = async (context) => ({ ...(await original(context)), capability_evidence: {
      kind: 'host-executable-capability', state: 'OBSERVED_AVAILABLE', status: 'AVAILABLE', source: 'x'.repeat(513),
      observed_at: '2026-10-08T00:00:00.000Z', session_id: context.session_id, binding_id: context.binding_id,
      host: 'codex-cli', ...target, role: 'worker', authority: 'workspace-write', effort_binding: 'parameter', route: 'native', transport: 'native-runtime',
    } });
  }
  queued.host.execute = async () => { laterWrites += 1; return { status: 'SUCCEEDED' }; };
  try {
    const firstRun = runFlowDrive(['Partial writer.'], { host: first.host, workdir });
    await entered;
    const secondRun = runFlowDrive(['Queued writer.'], { host: queued.host, workdir });
    assert.strictEqual((await runFlowDrive(['Independent read.'], { host: reader.host, workdir })).acceptance.status, 'PASSED');
    release();
    const [firstReport, secondReport] = await Promise.all([firstRun, secondRun]);
    assert.strictEqual(firstReport.acceptance.status, 'BLOCKED');
    if (failure === 'completed-receipt') {
      assert.strictEqual(secondReport.acceptance.status, 'PASSED');
      assert.strictEqual(laterWrites, 1, 'a proven terminal lifecycle may release ownership despite a receipt error');
      return;
    }
    assert.ok(secondReport.blockers.some((reason) => reason.includes('RECONCILIATION_REQUIRED')));
    assert.strictEqual(laterWrites, 0, 'presentation failures must retain uncertain writer ownership');
    const newWriter = await runFlowDrive(['Later writer.'], { host: queued.host, workdir });
    assert.ok(newWriter.blockers.some((reason) => reason.includes('RECONCILIATION_REQUIRED')));
    assert.strictEqual(laterWrites, 0);
  } finally { release(); first.cleanup(); queued.cleanup(); reader.cleanup(); fs.rmSync(workdir, { recursive: true, force: true }); }
}

for (const mode of ['solo', 'graph']) test(`${mode} completed lifecycle releases queued writer after a receipt presentation failure`, () => {
  const child = spawnSync(process.execPath, [__filename, '--scenario', mode, 'completed-receipt', 'missing'], { encoding: 'utf8', timeout: 3000 });
  assert.strictEqual(child.error, undefined);
  assert.strictEqual(child.status, 0, child.stderr);
});

for (const mode of ['solo', 'graph']) for (const failure of ['malformed', 'receipt']) for (const stop of ['missing', 'negative']) {
  test(`${mode} ${failure} presentation with ${stop} stop suspends queued writers without recovery and permits readers`, () => {
    const child = spawnSync(process.execPath, [__filename, '--scenario', mode, failure, stop], { encoding: 'utf8', timeout: 3000 });
    assert.strictEqual(child.error, undefined, 'lifecycle scenario completed within its bound');
    assert.strictEqual(child.status, 0, child.stderr);
  });
}

if (process.argv[2] === '--scenario') lifecycleScenario(...process.argv.slice(3)).catch((error) => { console.error(error); process.exitCode = 1; });
else run('flow-drive-lifecycle-safety');
