'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { buildToolsOnlyDir } = require('./_lib/restricted-path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');
const REQUIRED_TOOLS = ['mktemp', 'rm', 'cat', 'bash', 'python3'];
const SYSTEM_PYTHON = '/usr/bin/python3';

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(pwd)/argv.txt"
cat > "$(pwd)/stdin.txt"
[ -f "$(pwd)/agy-sleep-secs" ] && sleep "$(cat "$(pwd)/agy-sleep-secs")"
[ -f "$(pwd)/agy-empty" ] || printf 'agy-stub-response\\n'
[ -f "$(pwd)/agy-exit-code" ] && exit "$(cat "$(pwd)/agy-exit-code")"
exit 0
`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v -- ${name}`], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`missing ${name}`);
  return fs.realpathSync(result.stdout.trim());
}

function roleContract(role, authority, requestedRole = role) {
  const fields = { requested_role: requestedRole, effective_role: role, authority, source_id: 'test.dispatch' };
  return {
    schema: 'dhpk.role-contract.v1', ...fields,
    evidence_sha256: crypto.createHash('sha256').update(JSON.stringify(fields, Object.keys(fields).sort())).digest('hex'),
  };
}

function promptEvidence(promptFile) {
  const info = fs.statSync(promptFile);
  return { path: fs.realpathSync(promptFile), dev: info.dev, ino: info.ino, sha256: crypto.createHash('sha256').update(fs.readFileSync(promptFile)).digest('hex') };
}

function withStub(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-agy-'));
  try {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'agy'), STUB, { mode: 0o755 });
    const promptFile = path.join(dir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'apply the fix spec');
    fn({ dir, binDir, promptFile, argvOut: path.join(dir, 'argv.txt'), stdinOut: path.join(dir, 'stdin.txt') });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runtimePath(binDir) {
  return [...new Set([binDir, path.dirname(SYSTEM_PYTHON), path.dirname(commandPath('bash'))])].join(path.delimiter);
}

function writeContext(ctx, overrides = {}) {
  const artifactRoot = path.join(ctx.dir, '.dhpk', 'cli-receipts');
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);
  const sequence = (ctx.sequence = (ctx.sequence || 0) + 1);
  const model = overrides.model === undefined ? 'Gemini 3.6 Flash (High)' : overrides.model;
  const requestedRole = overrides.role || 'agy-fast-worker';
  const effectiveRole = requestedRole === 'agy-fast-worker' ? 'agy-worker' : requestedRole;
  const context = {
    schema: 'dhpk.cli.context.v1', provider: 'agy',
    requested_role: requestedRole, effective_role: effectiveRole,
    role_contract: roleContract(effectiveRole, 'workspace-write', requestedRole),
    mode: 'workspace-write', workdir: ctx.dir, prompt_file: ctx.promptFile, prompt_evidence: promptEvidence(ctx.promptFile),
    artifact_root: artifactRoot, receipt_path: path.join(artifactRoot, `receipt-${sequence}.json`),
    assigned_files: ['argv.txt', 'stdin.txt'], report_only: true, timeout_secs: overrides.timeoutSecs ?? 3,
    task_id: 'task-agy-test', attempt_id: `attempt-${sequence}`,
    transport: 'agy-print', requested_model: model, requested_effort: null,
    runtime_path: overrides.runtimePath || runtimePath(ctx.binDir),
  };
  const contextPath = path.join(ctx.dir, `dispatch-${sequence}.json`);
  fs.writeFileSync(contextPath, JSON.stringify(context), { mode: 0o600 });
  return { contextPath, receiptPath: context.receipt_path };
}

function runWrapper(ctx, args, { contextPath, toolsDir, env = {} } = {}) {
  const PATH = `${ctx.binDir}:${toolsDir || process.env.PATH}`;
  return spawnSync(commandPath('bash'), [WRAPPER, ...args], {
    cwd: ctx.dir,
    env: { ...process.env, PATH, DHPK_CLI_TRANSPORT_PYTHON3: SYSTEM_PYTHON, ...env,
      ...(contextPath ? { DHPK_CLI_TRANSPORT_CONTEXT: contextPath } : {}) },
    encoding: 'utf8', timeout: 12000,
  });
}

test('direct legacy AGY call without attested context is BLOCKED before provider execution', () => {
  withStub((ctx) => {
    const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)']);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(/BLOCKED.*context/i.test(result.stderr), result.stderr);
    assert.ok(!fs.existsSync(ctx.argvOut));
  });
});

test('restricted PATH explicitly supplies python3, omits timeout/gtimeout, and preserves AGY argv and Y stdin', () => {
  withStub((ctx) => {
    const { contextPath, receiptPath } = writeContext(ctx);
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { contextPath, toolsDir });
      assert.strictEqual(result.status, 0, result.stderr);
      const argv = fs.readFileSync(ctx.argvOut, 'utf8');
      for (const flag of ['--dangerously-skip-permissions', '--mode', 'accept-edits', '--add-dir', '--model', '--print-timeout', '-p']) {
        assert.ok(argv.includes(flag), `missing ${flag}: ${argv}`);
      }
      assert.ok(!argv.includes('--cwd'), argv);
      assert.ok(!argv.includes('--effort'), argv);
      assert.ok(argv.includes('apply the fix spec'), argv);
      assert.strictEqual(fs.readFileSync(ctx.stdinOut, 'utf8'), 'Y\n');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(receipt.status, 'SUCCEEDED');
      assert.strictEqual(fs.statSync(receiptPath).mode & 0o777, 0o600);
    } finally { fs.rmSync(toolsDir, { recursive: true, force: true }); }
  });
});

test('attested runtime path without named python3 blocks before AGY can execute', () => {
  withStub((ctx) => {
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS.filter((name) => name !== 'python3'));
    try {
      const { contextPath } = writeContext(ctx, { runtimePath: `${ctx.binDir}:${toolsDir}` });
      const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { contextPath, toolsDir });
      assert.strictEqual(result.status, 65, result.stderr);
      assert.ok(!fs.existsSync(ctx.argvOut));
    } finally { fs.rmSync(toolsDir, { recursive: true, force: true }); }
  });
});

test('external bootstrap-python override never executes', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx);
    const marker = path.join(ctx.dir, 'untrusted-bootstrap-ran');
    const evilPython = path.join(ctx.dir, 'evil-python3');
    fs.writeFileSync(evilPython, `#!/bin/sh\nprintf ran > '${marker}'\nexit 91\n`, { mode: 0o755 });
    const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], {
      contextPath, env: { DHPK_CLI_TRANSPORT_PYTHON3: evilPython },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(marker));
    assert.ok(fs.existsSync(ctx.argvOut));
  });
});

test('Python startup paths cannot execute before AGY context validation', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx);
    const poison = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-python-startup-'));
    const marker = path.join(ctx.dir, 'python-startup-ran');
    try {
      fs.writeFileSync(path.join(poison, 'sitecustomize.py'), `open(${JSON.stringify(marker)}, 'w').write('ran')\n`);
      const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], {
        contextPath,
        env: { PYTHONPATH: poison },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(!fs.existsSync(marker), 'PYTHONPATH startup code must not run before context validation');
    } finally {
      fs.rmSync(poison, { recursive: true, force: true });
    }
  });
});

test('attested model mismatch blocks before AGY execution', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx, { model: 'approved-model' });
    const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'unapproved-model'], { contextPath });
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(ctx.argvOut));
  });
});

test('runner owns the bounded timeout and persists a contained 0600 TIMEOUT receipt', () => {
  withStub((ctx) => {
    const { contextPath, receiptPath } = writeContext(ctx, { timeoutSecs: 1 });
    fs.writeFileSync(path.join(ctx.dir, 'agy-sleep-secs'), '4');
    const result = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { contextPath });
    assert.strictEqual(result.status, 124, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(receipt.status, 'TIMEOUT');
    assert.strictEqual(fs.statSync(receiptPath).mode & 0o777, 0o600);
  });
});

test('provider failure and an empty structured report remain terminal FAILED receipts', () => {
  withStub((ctx) => {
    const failed = writeContext(ctx);
    fs.writeFileSync(path.join(ctx.dir, 'agy-exit-code'), '7');
    const providerFailure = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], {
      contextPath: failed.contextPath,
    });
    assert.strictEqual(providerFailure.status, 7, providerFailure.stderr);
    const failedReceipt = JSON.parse(fs.readFileSync(failed.receiptPath, 'utf8'));
    assert.strictEqual(failedReceipt.status, 'FAILED');
    assert.strictEqual(failedReceipt.exit_code, 7);

    fs.unlinkSync(path.join(ctx.dir, 'agy-exit-code'));
    fs.writeFileSync(path.join(ctx.dir, 'agy-empty'), '');
    const empty = writeContext(ctx);
    const emptyResult = runWrapper(ctx, [ctx.dir, ctx.promptFile, 'Gemini 3.6 Flash (High)'], { contextPath: empty.contextPath });
    assert.strictEqual(emptyResult.status, 1, emptyResult.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(empty.receiptPath, 'utf8')).status, 'FAILED');
  });
});

run('run-agy');
