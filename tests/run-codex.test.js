'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { buildToolsOnlyDir } = require('./_lib/restricted-path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'skills', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh');
const REQUIRED_TOOLS = ['mktemp', 'rm', 'cat', 'bash', 'python3'];
const SYSTEM_PYTHON = '/usr/bin/python3';

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$(pwd)/argv.txt"
cat > "$(pwd)/stdin.txt"
out=""; previous=""
for value in "$@"; do [ "$previous" = "--output-last-message" ] && out="$value"; previous="$value"; done
[ -f "$(pwd)/codex-sleep-secs" ] && sleep "$(cat "$(pwd)/codex-sleep-secs")"
[ -f "$(pwd)/codex-empty" ] || { [ -f "$(pwd)/codex-secret" ] && cat "$(pwd)/codex-secret" || printf 'codex-stub-response\\n'; } > "$out"
`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v -- ${name}`], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`missing ${name}`);
  return fs.realpathSync(result.stdout.trim());
}

function promptEvidence(promptFile) {
  const info = fs.statSync(promptFile);
  return { path: fs.realpathSync(promptFile), dev: info.dev, ino: info.ino, sha256: crypto.createHash('sha256').update(fs.readFileSync(promptFile)).digest('hex') };
}

function roleContract(role, authority, requestedRole = role) {
  const fields = { requested_role: requestedRole, effective_role: role, authority, source_id: 'test.dispatch' };
  return { schema: 'dhpk.role-contract.v1', ...fields, evidence_sha256: crypto.createHash('sha256').update(JSON.stringify(fields, Object.keys(fields).sort())).digest('hex') };
}

function withStub(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-codex-'));
  try {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'codex'), STUB, { mode: 0o755 });
    const promptFile = path.join(dir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'do the thing');
    fn({ dir, binDir, promptFile, argvOut: path.join(dir, 'argv.txt'), stdinOut: path.join(dir, 'stdin.txt') });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function runtimePath(binDir) {
  return [...new Set([binDir, path.dirname(SYSTEM_PYTHON), path.dirname(commandPath('bash'))])].join(path.delimiter);
}

function writeContext(ctx, overrides = {}) {
  const artifactRoot = path.join(ctx.dir, '.dhpk', 'cli-receipts');
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);
  const sequence = (ctx.sequence = (ctx.sequence || 0) + 1);
  const role = overrides.role || 'codex-bridge';
  const mode = overrides.mode || 'workspace-write';
  const effectiveRole = role === 'codex-fast-worker' ? 'codex-worker'
    : role === 'codex-deep-reasoner' ? 'codex-reasoner'
      : role === 'codex-bridge' ? (mode === 'read-only' ? 'codex-reviewer' : 'codex-worker')
        : role;
  const authority = effectiveRole === 'codex-reasoner' || effectiveRole === 'codex-reviewer' ? 'read-only' : 'workspace-write';
  const model = overrides.model === undefined ? null : overrides.model;
  const effort = overrides.effort === undefined ? null : overrides.effort;
  const context = {
    schema: 'dhpk.cli.context.v1', provider: 'codex', requested_role: role, effective_role: effectiveRole,
    role_contract: roleContract(effectiveRole, authority, role), mode,
    workdir: ctx.dir, prompt_file: ctx.promptFile, prompt_evidence: promptEvidence(ctx.promptFile),
    artifact_root: artifactRoot, receipt_path: path.join(artifactRoot, `receipt-${sequence}.json`),
    assigned_files: ['argv.txt', 'stdin.txt'], report_only: true, timeout_secs: overrides.timeoutSecs ?? 3,
    task_id: 'task-codex-test', attempt_id: `attempt-${sequence}`,
    transport: 'codex-exec', requested_model: model, requested_effort: effort,
    runtime_path: overrides.runtimePath || runtimePath(ctx.binDir),
  };
  const contextPath = path.join(ctx.dir, `dispatch-${sequence}.json`);
  fs.writeFileSync(contextPath, JSON.stringify(context), { mode: 0o600 });
  return { contextPath, receiptPath: context.receipt_path };
}

function runWrapper(ctx, args, { contextPath, toolsDir, env = {} } = {}) {
  return spawnSync(commandPath('bash'), [WRAPPER, ...args], {
    cwd: ctx.dir,
    env: { ...process.env, PATH: `${ctx.binDir}:${toolsDir || process.env.PATH}`,
      DHPK_CLI_TRANSPORT_PYTHON3: SYSTEM_PYTHON, ...env,
      ...(contextPath ? { DHPK_CLI_TRANSPORT_CONTEXT: contextPath } : {}) },
    encoding: 'utf8', timeout: 12000,
  });
}

test('direct legacy Codex call without attested context is BLOCKED before provider execution', () => {
  withStub((ctx) => {
    const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile]);
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(ctx.argvOut));
  });
});

test('restricted PATH explicitly supplies python3, omits timeout/gtimeout, and keeps the prompt on stdin', () => {
  withStub((ctx) => {
    const { contextPath, receiptPath } = writeContext(ctx);
    const toolsDir = buildToolsOnlyDir(REQUIRED_TOOLS);
    try {
      const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { contextPath, toolsDir });
      assert.strictEqual(result.status, 0, result.stderr);
      const argv = fs.readFileSync(ctx.argvOut, 'utf8');
      assert.ok(!argv.includes('do the thing'), argv);
      for (const flag of ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-c', 'approval_policy=never', '--cd', '--output-last-message', '-']) {
        assert.ok(argv.includes(flag), `missing ${flag}: ${argv}`);
      }
      assert.strictEqual(fs.readFileSync(ctx.stdinOut, 'utf8'), 'do the thing');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(receipt.status, 'SUCCEEDED');
      assert.strictEqual(fs.statSync(receiptPath).mode & 0o777, 0o600);
    } finally { fs.rmSync(toolsDir, { recursive: true, force: true }); }
  });
});

test('attested runtime path without named python3 blocks before Codex execution', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx, { runtimePath: ctx.binDir });
    const result = spawnSync(commandPath('bash'), [WRAPPER, 'workspace-write', ctx.dir, ctx.promptFile], {
      cwd: ctx.dir, env: { ...process.env, PATH: ctx.binDir, DHPK_CLI_TRANSPORT_CONTEXT: contextPath }, encoding: 'utf8', timeout: 12000,
    });
    assert.strictEqual(result.status, 65, result.stderr);
    assert.ok(!fs.existsSync(ctx.argvOut));
  });
});

test('external bootstrap-python override never executes', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx);
    const marker = path.join(ctx.dir, 'untrusted-bootstrap-ran');
    const evilPython = path.join(ctx.dir, 'evil-python3');
    fs.writeFileSync(evilPython, `#!/bin/sh\nprintf ran > '${marker}'\nexit 91\n`, { mode: 0o755 });
    const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {
      contextPath, env: { DHPK_CLI_TRANSPORT_PYTHON3: evilPython },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(marker));
    assert.ok(fs.existsSync(ctx.argvOut));
  });
});

test('Python startup paths cannot execute before Codex context validation', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx);
    const poison = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-python-startup-'));
    const marker = path.join(ctx.dir, 'python-startup-ran');
    try {
      fs.writeFileSync(path.join(poison, 'sitecustomize.py'), `open(${JSON.stringify(marker)}, 'w').write('ran')\n`);
      const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], {
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

test('attested model and effort bind the Codex argv', () => {
  withStub((ctx) => {
    const { contextPath } = writeContext(ctx, { model: 'gpt-5.6-luna', effort: 'xhigh' });
    const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'gpt-5.6-luna', 'xhigh'], { contextPath });
    assert.strictEqual(result.status, 0, result.stderr);
    const argv = fs.readFileSync(ctx.argvOut, 'utf8');
    assert.ok(argv.includes('gpt-5.6-luna') && argv.includes('model_reasoning_effort=xhigh'), argv);
    const mismatch = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile, 'other-model', 'xhigh'], { contextPath });
    assert.strictEqual(mismatch.status, 65, mismatch.stderr);
  });
});

test('runner owns the bounded timeout and persists a contained 0600 TIMEOUT receipt', () => {
  withStub((ctx) => {
    const { contextPath, receiptPath } = writeContext(ctx, { timeoutSecs: 1 });
    fs.writeFileSync(path.join(ctx.dir, 'codex-sleep-secs'), '4');
    const result = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { contextPath });
    assert.strictEqual(result.status, 124, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(receipt.status, 'TIMEOUT');
    assert.strictEqual(fs.statSync(receiptPath).mode & 0o777, 0o600);
  });
});

test('quoted secret output is redacted and a zero-exit empty report fails closed', () => {
  withStub((ctx) => {
    const first = writeContext(ctx);
    fs.writeFileSync(path.join(ctx.dir, 'codex-secret'), 'token="quoted-secret"\n');
    const secretResult = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { contextPath: first.contextPath });
    assert.strictEqual(secretResult.status, 0, secretResult.stderr);
    assert.ok(!secretResult.stdout.includes('quoted-secret'), secretResult.stdout);
    assert.ok(secretResult.stdout.includes('[REDACTED]'), secretResult.stdout);
    fs.rmSync(path.join(ctx.dir, 'codex-secret'));
    fs.writeFileSync(path.join(ctx.dir, 'codex-empty'), '');
    const second = writeContext(ctx);
    const emptyResult = runWrapper(ctx, ['workspace-write', ctx.dir, ctx.promptFile], { contextPath: second.contextPath });
    assert.strictEqual(emptyResult.status, 1, emptyResult.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(second.receiptPath, 'utf8')).status, 'FAILED');
  });
});

run('run-codex');
