'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SOURCE_SCRIPTS = path.join(ROOT, 'skills', 'dhpk-cli-dispatch-context', 'scripts');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function projectedPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cli-dispatch-launcher-'));
  const scripts = path.join(root, 'skills', 'dhpk-cli-dispatch-context', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const fileName of ['cli-role-resolver.js', 'build-cli-dispatch-context.js', 'launch-cli-dispatch.js']) {
    fs.copyFileSync(path.join(SOURCE_SCRIPTS, fileName), path.join(scripts, fileName));
  }
  return { root, scripts, launcher: path.join(scripts, 'launch-cli-dispatch.js') };
}

test('public launcher keeps Codex dispatcher identity separate while AGY binds role and adapter execution', () => {
  const projected = projectedPackage();
  try {
    const workdir = path.join(projected.root, 'work');
    const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
    const prompt = path.join(workdir, 'prompt.txt');
    const contextPath = path.join(artifactRoot, 'context.json');
    const receiptPath = path.join(artifactRoot, 'receipt.json');
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(prompt, 'bounded AGY task');

    const adapter = path.join(projected.root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, '#!/bin/sh\nprintf "context=%s\\nworkdir=%s\\nprompt=%s\\nmodel=%s\\n" "$DHPK_CLI_TRANSPORT_CONTEXT" "$1" "$2" "$3"\n', { mode: 0o755 });

    const scopePath = path.join(projected.root, 'scope.json');
    writeJson(scopePath, {
      artifact_root: artifactRoot,
      receipt_path: receiptPath,
      context_path: contextPath,
      assigned_files: ['src/worker.js'],
      report_only: true,
      runtime_path: '/usr/bin:/bin',
    });
    const baseConfig = path.join(projected.root, 'base-config.json');
    const taskConfig = path.join(projected.root, 'task-config.json');
    writeJson(baseConfig, { agy_worker_model: 'base-model', agy_worker_timeout_secs: 90 });
    writeJson(taskConfig, { agy_worker_model: 'task-model' });

    const result = spawnSync(process.execPath, [projected.launcher,
      '--dispatching-agent', 'codex',
      '--execution-provider', 'agy',
      '--requested-role', 'agy-worker',
      '--mode', 'workspace-write',
      '--task-id', 'task-123',
      '--attempt-id', 'attempt-1',
      '--workdir', workdir,
      '--prompt', prompt,
      '--scope', scopePath,
      '--config-layer', baseConfig,
      '--config-layer', taskConfig,
    ], { encoding: 'utf8' });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '');
    assert.ok(result.stdout.includes(`context=${contextPath}\n`));
    assert.ok(result.stdout.includes(`workdir=${workdir}\n`));
    assert.ok(result.stdout.includes(`prompt=${prompt}\n`));
    assert.ok(result.stdout.includes('model=task-model\n'));
    const contextStat = fs.lstatSync(contextPath);
    assert.strictEqual(contextStat.isFile(), true);
    assert.strictEqual(contextStat.isSymbolicLink(), false);
    assert.strictEqual(contextStat.mode & 0o777, 0o600);
    const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    assert.strictEqual(context.schema, 'dhpk.cli.context.v1');
    assert.strictEqual(context.dispatching_agent, 'codex');
    assert.strictEqual(context.execution_provider, 'agy');
    assert.strictEqual(context.provider, 'agy');
    assert.strictEqual(context.effective_role, 'agy-worker');
    assert.strictEqual(context.requested_model, 'task-model');
  } finally {
    fs.rmSync(projected.root, { recursive: true, force: true });
  }
});

test('contradictory authority is BLOCKED before context creation or adapter execution', () => {
  const projected = projectedPackage();
  try {
    const workdir = path.join(projected.root, 'work');
    const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
    const prompt = path.join(workdir, 'prompt.txt');
    const contextPath = path.join(artifactRoot, 'context.json');
    const marker = path.join(projected.root, 'adapter-started');
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(prompt, 'must not execute');

    const adapter = path.join(projected.root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, `#!/bin/sh\nprintf started > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    const scopePath = path.join(projected.root, 'scope.json');
    const configPath = path.join(projected.root, 'config.json');
    writeJson(scopePath, {
      artifact_root: artifactRoot,
      receipt_path: path.join(artifactRoot, 'receipt.json'),
      context_path: contextPath,
      assigned_files: ['src/worker.js'],
      report_only: true,
      runtime_path: '/usr/bin:/bin',
    });
    writeJson(configPath, { agy_worker_model: 'task-model', agy_worker_timeout_secs: 90 });

    const result = spawnSync(process.execPath, [projected.launcher,
      '--dispatching-agent', 'codex', '--execution-provider', 'agy',
      '--requested-role', 'agy-worker', '--mode', 'read-only',
      '--task-id', 'task-123', '--attempt-id', 'attempt-1',
      '--workdir', workdir, '--prompt', prompt, '--scope', scopePath,
      '--config-layer', configPath,
    ], { encoding: 'utf8' });

    assert.strictEqual(result.status, 65);
    assert.match(result.stderr, /BLOCKED.*contradicts mode read-only/);
    assert.strictEqual(fs.existsSync(contextPath), false);
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(projected.root, { recursive: true, force: true });
  }
});

test('symlink-resolved artifact or context paths are BLOCKED before any outside write', () => {
  const projected = projectedPackage();
  try {
    const workdir = path.join(projected.root, 'work');
    const outside = path.join(projected.root, 'outside');
    const prompt = path.join(workdir, 'prompt.txt');
    const marker = path.join(projected.root, 'adapter-started');
    fs.mkdirSync(workdir);
    fs.mkdirSync(outside);
    fs.writeFileSync(prompt, 'must stay physically contained');

    const adapter = path.join(projected.root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, `#!/bin/sh\nprintf started > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    const configPath = path.join(projected.root, 'config.json');
    writeJson(configPath, { agy_worker_model: 'task-model', agy_worker_timeout_secs: 90 });

    fs.symlinkSync(outside, path.join(workdir, '.dhpk'));
    const escapedArtifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
    const escapedContextPath = path.join(escapedArtifactRoot, 'context.json');
    fs.mkdirSync(escapedArtifactRoot);
    const escapedScopePath = path.join(projected.root, 'escaped-scope.json');
    writeJson(escapedScopePath, {
      artifact_root: escapedArtifactRoot,
      receipt_path: path.join(escapedArtifactRoot, 'receipt.json'),
      context_path: escapedContextPath,
      assigned_files: ['src/worker.js'],
      report_only: true,
      runtime_path: '/usr/bin:/bin',
    });

    const escaped = spawnSync(process.execPath, [projected.launcher,
      '--dispatching-agent', 'codex', '--execution-provider', 'agy',
      '--requested-role', 'agy-worker', '--mode', 'workspace-write',
      '--task-id', 'task-123', '--attempt-id', 'attempt-1',
      '--workdir', workdir, '--prompt', prompt, '--scope', escapedScopePath,
      '--config-layer', configPath,
    ], { encoding: 'utf8' });
    const escapedOutsideWrite = fs.existsSync(path.join(outside, 'cli-receipts', 'context.json'));

    fs.rmSync(path.join(outside, 'cli-receipts'), { recursive: true, force: true });
    fs.unlinkSync(path.join(workdir, '.dhpk'));
    const safeArtifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
    fs.mkdirSync(safeArtifactRoot, { recursive: true });
    const outsideTarget = path.join(outside, 'context-target.json');
    fs.writeFileSync(outsideTarget, 'outside sentinel');
    const symlinkedContextPath = path.join(safeArtifactRoot, 'context.json');
    fs.symlinkSync(outsideTarget, symlinkedContextPath);
    const symlinkedContextScopePath = path.join(projected.root, 'symlinked-context-scope.json');
    writeJson(symlinkedContextScopePath, {
      artifact_root: safeArtifactRoot,
      receipt_path: path.join(safeArtifactRoot, 'receipt.json'),
      context_path: symlinkedContextPath,
      assigned_files: ['src/worker.js'],
      report_only: true,
      runtime_path: '/usr/bin:/bin',
    });

    const symlinkedContext = spawnSync(process.execPath, [projected.launcher,
      '--dispatching-agent', 'codex', '--execution-provider', 'agy',
      '--requested-role', 'agy-worker', '--mode', 'workspace-write',
      '--task-id', 'task-123', '--attempt-id', 'attempt-2',
      '--workdir', workdir, '--prompt', prompt, '--scope', symlinkedContextScopePath,
      '--config-layer', configPath,
    ], { encoding: 'utf8' });

    assert.strictEqual(escaped.status, 65, escaped.stderr);
    assert.match(escaped.stderr, /BLOCKED.*symlink|BLOCKED.*physical/i);
    assert.strictEqual(escapedOutsideWrite, false);
    assert.strictEqual(symlinkedContext.status, 65, symlinkedContext.stderr);
    assert.match(symlinkedContext.stderr, /BLOCKED.*context/i);
    assert.strictEqual(fs.readFileSync(outsideTarget, 'utf8'), 'outside sentinel');
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(projected.root, { recursive: true, force: true });
  }
});

test('adapter execution uses only the declared restricted runtime PATH', () => {
  const projected = projectedPackage();
  try {
    const workdir = path.join(projected.root, 'work');
    const artifactRoot = path.join(workdir, '.dhpk', 'cli-receipts');
    const prompt = path.join(workdir, 'prompt.txt');
    const contextPath = path.join(artifactRoot, 'context.json');
    const hostileBin = path.join(projected.root, 'hostile-bin');
    const hostileMarker = path.join(projected.root, 'hostile-shell-ran');
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.mkdirSync(hostileBin);
    fs.writeFileSync(prompt, 'use only the attested runtime PATH');

    const adapter = path.join(projected.root, 'skills', 'dhpk-agy-fast-worker', 'scripts', 'run-agy.sh');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, '#!/usr/bin/env sh\nprintf "declared-runtime-path=%s\\n" "$PATH"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(hostileBin, 'sh'), `#!/bin/sh\nprintf hostile > ${JSON.stringify(hostileMarker)}\nexit 91\n`, { mode: 0o755 });

    const scopePath = path.join(projected.root, 'scope.json');
    const configPath = path.join(projected.root, 'config.json');
    writeJson(scopePath, {
      artifact_root: artifactRoot,
      receipt_path: path.join(artifactRoot, 'receipt.json'),
      context_path: contextPath,
      assigned_files: ['src/worker.js'],
      report_only: true,
      runtime_path: '/usr/bin:/bin',
    });
    writeJson(configPath, { agy_worker_model: 'task-model', agy_worker_timeout_secs: 90 });

    const result = spawnSync(process.execPath, [projected.launcher,
      '--dispatching-agent', 'codex', '--execution-provider', 'agy',
      '--requested-role', 'agy-worker', '--mode', 'workspace-write',
      '--task-id', 'task-123', '--attempt-id', 'attempt-1',
      '--workdir', workdir, '--prompt', prompt, '--scope', scopePath,
      '--config-layer', configPath,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${hostileBin}:${process.env.PATH}` },
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, 'declared-runtime-path=/usr/bin:/bin\n');
    assert.strictEqual(fs.existsSync(hostileMarker), false);
  } finally {
    fs.rmSync(projected.root, { recursive: true, force: true });
  }
});

test('public launcher emits one bounded legacy-alias diagnostic per session without changing authority or leaking inputs', () => {
  const projected = projectedPackage();
  try {
    const workdir = path.join(projected.root, 'work');
    const prompt = path.join(workdir, 'prompt.txt');
    fs.mkdirSync(workdir);
    fs.writeFileSync(prompt, 'session-bounded alias dispatch');

    const adapter = path.join(projected.root, 'skills', 'dhpk-codex-bridge', 'scripts', 'run-codex.sh');
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    fs.writeFileSync(adapter, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const configPath = path.join(projected.root, 'config.json');
    writeJson(configPath, {
      codex_worker_timeout_secs: 90,
      codex_reasoner_timeout_secs: 90,
      authority: 'read-only',
      effective_role: 'codex-reviewer',
      private_path: '/private/secret/config.json',
      api_secret: 'super-secret-value',
    });

    const dispatches = [
      { requestedRole: 'codex-fast-worker', mode: 'workspace-write', attemptId: 'attempt-1' },
      { requestedRole: 'codex-deep-reasoner', mode: 'read-only', attemptId: 'attempt-2' },
    ].map((dispatch) => {
      const artifactRoot = path.join(workdir, '.dhpk', dispatch.attemptId);
      fs.mkdirSync(artifactRoot, { recursive: true });
      const scopePath = path.join(projected.root, `${dispatch.attemptId}-scope.json`);
      writeJson(scopePath, {
        artifact_root: artifactRoot,
        receipt_path: path.join(artifactRoot, 'receipt.json'),
        context_path: path.join(artifactRoot, 'context.json'),
        assigned_files: ['src/worker.js'],
        report_only: true,
        runtime_path: '/usr/bin:/bin',
      });
      return {
        args: [
          '--dispatching-agent', 'claude', '--execution-provider', 'codex',
          '--requested-role', dispatch.requestedRole, '--mode', dispatch.mode,
          '--task-id', 'task-123', '--attempt-id', dispatch.attemptId,
          '--workdir', workdir, '--prompt', prompt, '--scope', scopePath,
          '--config-layer', configPath,
        ],
        contextPath: path.join(artifactRoot, 'context.json'),
      };
    });

    const probe = spawnSync(process.execPath, ['-e', `
      const { main } = require(${JSON.stringify(projected.launcher)});
      const dispatches = ${JSON.stringify(dispatches.map(({ args }) => args))};
      for (const args of dispatches) {
        if (main(args) !== 0) process.exitCode = 1;
      }
    `], { encoding: 'utf8' });

    assert.strictEqual(probe.status, 0, probe.stderr);
    const diagnostics = probe.stderr.split('\n').filter((line) => line.includes('deprecated role alias'));
    assert.deepStrictEqual(diagnostics, [
      'launch-cli-dispatch: WARNING: deprecated role alias codex-fast-worker; use codex-worker',
    ]);
    assert.strictEqual(probe.stderr.includes('/private/secret/config.json'), false);
    assert.strictEqual(probe.stderr.includes('super-secret-value'), false);

    const workerContext = JSON.parse(fs.readFileSync(dispatches[0].contextPath, 'utf8'));
    const reasonerContext = JSON.parse(fs.readFileSync(dispatches[1].contextPath, 'utf8'));
    assert.strictEqual(workerContext.effective_role, 'codex-worker');
    assert.strictEqual(workerContext.role_contract.authority, 'workspace-write');
    assert.strictEqual(reasonerContext.effective_role, 'codex-reasoner');
    assert.strictEqual(reasonerContext.role_contract.authority, 'read-only');
  } finally {
    fs.rmSync(projected.root, { recursive: true, force: true });
  }
});

run('cli-dispatch-launcher');
