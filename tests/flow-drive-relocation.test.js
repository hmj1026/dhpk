'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { test, run, assert } = require('./_lib/tinytest');
const { runRelocatedFlowDrive } = require('./_lib/flow-drive-relocation-fixtures');

function relocated(scenario, options) {
  const result = runRelocatedFlowDrive(scenario, options);
  assert.strictEqual(result.error, undefined, 'the isolated child completes within its deadline');
  assert.strictEqual(result.status, 0, result.stderr);
  const value = result.value;
  assert.deepStrictEqual(value.guard, { module_denied: true, file_denied: true, sibling_denied: true, async_file_denied: true, module_search_clean: true });
  assert.strictEqual(value.evidence_kind, 'fixture');
  assert.strictEqual(value.provider_runtime, 'NOT_RUN');
  assert.ok(value.loaded_modules.length > 0, 'the public copied runner was loaded');
  assert.ok(value.loaded_modules.every((file) => file.startsWith(`${result.skillDir}${path.sep}`)), 'all project modules belong to the relocated skill');
  if (!value.setup_error) assert.ok(value.loaded_modules.some((file) => file.endsWith(`${path.sep}scripts${path.sep}run.js`)));
  return value;
}

function passed(value) {
  assert.strictEqual(value.report.status, 'REPORTED');
  assert.strictEqual(value.report.parser.status, 'ready');
  assert.strictEqual(value.report.execution.status, 'SUCCEEDED');
  assert.strictEqual(value.report.acceptance.status, 'PASSED');
  assert.deepStrictEqual(value.report.blockers, []);
  assert.strictEqual(value.effects['src/receipt.js'], 'total=12');
}

test('the relocated native solo runner resolves local contracts and verifies actual assigned effects', () => {
  const value = relocated('solo');
  passed(value);
  assert.strictEqual(value.executions.length, 1);
  assert.strictEqual(value.executions[0].provider, 'openai');
  assert.strictEqual(value.executions[0].request.authority, 'workspace-write');
  assert.deepStrictEqual(value.executions[0].request.scope.assigned_files, ['src/receipt.js']);
  const attempts = JSON.parse(value.report.execution.evidence);
  assert.strictEqual(attempts.length, 1);
  assert.strictEqual(attempts[0].receipt.schema, 'dhpk.dispatch.receipt.v2');
  assert.strictEqual(attempts[0].receipt.attempt_id, value.executions[0].request.attempt_id);
  assert.strictEqual(attempts[0].receipt.verification, 'PASSED');
});

test('relocated current bound capability evidence corrects an absent static catalog model', () => {
  const value = relocated('stale-catalog');
  passed(value);
  assert.strictEqual(value.executions.length, 1);
  assert.strictEqual(value.executions[0].model_id, 'relocated-current-model');
  assert.strictEqual(value.report.targets.resolved.model_id, 'relocated-current-model');
  const binding = value.executions[0].request.execution_binding;
  assert.strictEqual(binding.session_id, value.capabilityRequests[0].session_id);
  assert.strictEqual(binding.binding_id, value.capabilityRequests[0].binding_id);
  assert.strictEqual(value.capabilityRequests[0].allow_external_probe, false);
});

test('relocated native coordination diagnoses before serial writers and verifies the parent', () => {
  const value = relocated('coordinated');
  passed(value);
  assert.deepStrictEqual(value.executions.map((execution) => execution.node), ['reasoner', 'writer-0', 'writer-1']);
  assert.strictEqual(value.executions[0].request.authority, 'read-only');
  assert.strictEqual(value.maxWriters, 1);
  assert.strictEqual(value.activeWriters, 0);
  assert.ok(value.events.indexOf('scope-post:writer-0') < value.events.indexOf('execute:writer-1'));
  assert.strictEqual(value.parentVerifications, 1);
  assert.strictEqual(value.effects['scratch/notes.md'], 'diagnosis applied');
  const results = JSON.parse(value.report.execution.evidence);
  assert.ok(results.every((result) => result.status === 'SUCCEEDED'));
  for (const result of results) assert.strictEqual(result.attempts[0].receipt.task_id, result.id);
});

test('relocated answered Provider consent refreshes and executes only the selected external tuple', () => {
  const value = relocated('cross-provider');
  passed(value);
  assert.strictEqual(value.events.filter((event) => event === 'provider-answer').length, 1);
  assert.deepStrictEqual(value.capabilityRequests.map((request) => request.allow_external_probe), [false, true]);
  assert.deepStrictEqual(value.capabilityRequests[0].authorized_providers, []);
  assert.deepStrictEqual(value.capabilityRequests[0].authorized_targets, []);
  assert.deepStrictEqual(value.capabilityRequests[1].authorized_targets, [{
    provider: 'openai', target_agent: 'codex-cli', model_id: 'gpt-6-luna', effort: 'high', role: 'worker', authority: 'workspace-write',
  }]);
  assert.deepStrictEqual(value.executions.map((execution) => execution.provider), ['openai']);
  assert.strictEqual(value.report.targets.resolved.route, 'headless-cli');
});

test('valid prior diagnosis remains reusable with no peer skill or canonical checkout visibility', () => {
  const value = relocated('reuse');
  passed(value);
  assert.strictEqual(value.reuseCalls, 1);
  assert.deepStrictEqual(value.executions.map((execution) => execution.node), ['writer-0', 'writer-1']);
  assert.strictEqual(value.parentVerifications, 1);
});

test('a relocated missing independent reviewer reports the precise observed identity gap', () => {
  const value = relocated('review-independence');
  assert.strictEqual(value.report.status, 'REPORTED');
  assert.strictEqual(value.report.acceptance.status, 'BLOCKED');
  assert.ok(value.report.blockers.some((blocker) => blocker.includes('reviewer independence was not observed')));
  assert.strictEqual(value.parentVerifications, 0);
  assert.strictEqual(value.effects['src/receipt.js'], 'total=12');
  assert.strictEqual(value.effects['scratch/notes.md'], 'diagnosis applied');
});

test('a missing required copied resolver fails locally instead of finding the canonical checkout', () => {
  const value = relocated('solo', { missingResource: 'references/execution-bundle/scripts/lib/dispatch-engine.js' });
  assert.strictEqual(value.setup_error.code, 'MODULE_NOT_FOUND');
  assert.ok(value.setup_error.message.includes('dispatch-engine'));
  assert.strictEqual(value.report, undefined);
});

function relocatedCli({ missingResource } = {}) {
  return withIsolatedSkill({ source: path.join(__dirname, '..', 'skills', 'flow-drive'), stubs: {
    codex: { body: `const fs = require('node:fs');
      const args = process.argv.slice(1);
      fs.readFileSync(0);
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'fixture completed');
      fs.writeFileSync('allowed.txt', 'approved');`, status: 0 },
  } }, (context) => {
    const artifactRoot = path.join(context.projectDir, '.dhpk', 'attempt');
    fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    const prompt = path.join(context.projectDir, 'prompt.txt');
    fs.writeFileSync(prompt, 'write the literal approved value');
    const scope = path.join(context.projectDir, 'scope.json');
    const receiptPath = path.join(artifactRoot, 'receipt.json');
    fs.writeFileSync(scope, JSON.stringify({ artifact_root: artifactRoot,
      context_path: path.join(artifactRoot, 'context.json'), receipt_path: receiptPath,
      assigned_files: ['allowed.txt'], report_only: true, runtime_path: `${context.binDir}:/usr/bin:/bin` }));
    const config = path.join(context.projectDir, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ codex_worker_timeout_secs: 3 }));
    if (missingResource) {
      const resource = path.join(context.skillDir, missingResource);
      if (fs.existsSync(resource)) fs.unlinkSync(resource);
    }
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, [path.join(context.skillDir, 'scripts/dispatch-runtime/launch-cli-dispatch.js'),
      '--dispatching-agent', 'fixture-host', '--execution-provider', 'codex',
      '--requested-role', 'codex-worker', '--mode', 'workspace-write',
      '--task-id', 'relocated-cli', '--attempt-id', 'relocated-attempt',
      '--workdir', context.projectDir, '--prompt', prompt, '--scope', scope, '--config-layer', config],
    { cwd: context.projectDir, env: context.env, encoding: 'utf8', timeout: 10000 });
    return { ...result, started: fs.existsSync(path.join(context.projectDir, 'allowed.txt')),
      effect: fs.existsSync(path.join(context.projectDir, 'allowed.txt'))
        ? fs.readFileSync(path.join(context.projectDir, 'allowed.txt'), 'utf8') : null,
      receipt: fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null };
  });
}

test('the raw relocated owned CLI runtime creates an attested receipt and verifies the assigned effect', () => {
  const result = relocatedCli();
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.effect, 'approved');
  assert.strictEqual(result.receipt.schema, 'dhpk.cli.receipt.v1');
  assert.strictEqual(result.receipt.status, 'SUCCEEDED');
  assert.strictEqual(result.receipt.task_id, 'relocated-cli');
  assert.strictEqual(result.receipt.attempt_id, 'relocated-attempt');
});

test('a missing owned physical context helper fails explicitly before the external provider starts', () => {
  const result = relocatedCli({ missingResource: 'scripts/dispatch-runtime/physical-file.py' });
  assert.strictEqual(result.status, 65, result.stderr);
  assert.match(result.stderr, /BLOCKED.*physical-file\.py/);
  assert.strictEqual(result.started, false);
  assert.strictEqual(result.receipt, null);
});

run('flow-drive-relocation');
