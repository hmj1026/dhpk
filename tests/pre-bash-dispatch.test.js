'use strict';

// Coverage for pre-bash-dispatch.sh (PreToolUse Bash dispatcher): runs the
// core pre-bash-guard.sh first — any non-zero exit aborts the bash call
// immediately. With no active modules configured, the dispatcher's exit code
// mirrors the core guard exactly.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { ROOT, mkRepo, rmRepo, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'pre-bash-dispatch.sh';

function runHook(command, cwd, env = {}, pluginRoot = ROOT) {
  return runHookRaw(HOOK, {
    payload: { tool_input: { command } },
    cwd: cwd || ROOT,
    projectDir: cwd || ROOT,
    pluginRoot,
    env,
    deleteEnv: ['DHPK_ACTIVE_MODULES', 'CLAUDE_PLUGIN_OPTION_MODULES'],
  });
}

test('dangerous command (rm -rf /home) is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('rm -rf /home');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('safe command passes through (exit 0), no active modules', () => {
  const res = runHook('echo hello');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

test('.env write via redirection is blocked (exit 2), core guard bubbles up', () => {
  const res = runHook('echo SECRET=x > .env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('deep workspace path under /home still passes through the dispatcher', () => {
  const res = runHook('rm -rf /home/paul/projects/x/y');
  assert.strictEqual(res.status, 0, `expected allowed, got: ${res.status} / ${res.stderr}`);
});

test('combined dispatcher preserves protected-branch commit block', () => {
  const repo = mkRepo({ prefix: 'dhpk-pre-bash-compose-' });
  try {
    spawnSync('git', ['branch', '-M', 'main'], { cwd: repo });
    const res = runHook('git commit -m guarded', repo, { DHPK_BRANCH_SAFETY: 'block' });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, /branch-safety/i);
  } finally { rmRepo(repo); }
});

test('active module pass hooks compose in order and a block stops later hooks', () => {
  const repo = mkRepo({ prefix: 'dhpk-pre-bash-module-repo-' });
  let pluginRoot;
  try {
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pre-bash-module-plugin-'));
    const marker = path.join(pluginRoot, 'module-order.txt');
    fs.cpSync(path.join(ROOT, 'scripts', 'hooks'), path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    const hooksDir = path.join(pluginRoot, 'modules', 'batch-probe', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const [name, exitCode] of [['10-pass', 0], ['20-block', 2], ['30-unreachable', 0]]) {
      const label = name.split('-').slice(1).join('-');
      fs.writeFileSync(path.join(hooksDir, `pre-bash-${name}.sh`), `#!/usr/bin/env bash\nprintf '%s\\n' '${label}' >> "$DHPK_TEST_MARKER"\nexit ${exitCode}\n`);
    }

    const res = runHook('echo active module composition', repo, {
      DHPK_ACTIVE_MODULES: 'batch-probe',
      DHPK_BRANCH_SAFETY: 'off',
      DHPK_TEST_MARKER: marker,
    }, pluginRoot);
    assert.strictEqual(res.status, 2, `expected active module block to bubble up: ${res.stderr}`);
    assert.deepStrictEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['pass', 'block']);
  } finally {
    rmRepo(repo);
    if (pluginRoot) fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});

run('pre-bash-dispatch');
