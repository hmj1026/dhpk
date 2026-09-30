'use strict';

// Behavior coverage for scripts/hooks/postcompact-restore.sh (PostCompact hook).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'postcompact-restore.sh');

function makeScratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pcr-')));
}

function writeHandoff(scratch, content) {
  const checkpoint = path.join(scratch, '.claude', 'artifacts', 'checkpoints');
  fs.mkdirSync(checkpoint, { recursive: true });
  fs.writeFileSync(path.join(checkpoint, 'handoff-latest.md'), content);
}

function runHook(scratch, profile = '') {
  return spawnSync('/bin/bash', [HOOK], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: scratch,
      DHPK_HOOK_PROFILE: profile,
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: '',
    },
  });
}

test('handoff-latest content is emitted as PostCompact additional context', () => {
  const scratch = makeScratch();
  const handoff = '# Work handoff\n\nBranch: feature/example\nNext: run focused checks.\n';
  try {
    writeHandoff(scratch, handoff);
    const res = runHook(scratch);
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout.trim());
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostCompact');
    assert.ok(output.hookSpecificOutput.additionalContext.includes(handoff.trimEnd()));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('no handoff-latest file produces no output', () => {
  const scratch = makeScratch();
  try {
    const res = runHook(scratch);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    const sessDir = path.join(scratch, '.claude', 'artifacts', 'sessions');
    assert.ok(!fs.existsSync(sessDir) || fs.readdirSync(sessDir).length === 0,
      'expected no session artifacts when there is no handoff');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('minimal profile suppresses handoff context', () => {
  const scratch = makeScratch();
  try {
    writeHandoff(scratch, '# Work handoff\nThis should remain suppressed.\n');
    const res = runHook(scratch, 'minimal');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// Consolidated source suite: precompact-archive.
{

  // Observable coverage for precompact-archive.sh's scratch-only handoff.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync, execFileSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const HOOK = path.join(ROOT, 'scripts', 'hooks', 'precompact-archive.sh');

  function makeScratchRepo() {
    const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pca-')));
    let ready = false;
    try {
      execFileSync('git', ['init', '-q'], { cwd: scratch });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: scratch });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: scratch });
      execFileSync('git', ['checkout', '-q', '-b', 'feat/handoff-evidence'], { cwd: scratch });
      fs.writeFileSync(path.join(scratch, 'README.md'), 'tracked handoff state\n');
      execFileSync('git', ['add', 'README.md'], { cwd: scratch });
      execFileSync('git', ['commit', '-q', '-m', 'handoff evidence commit'], { cwd: scratch });
      fs.writeFileSync(path.join(scratch, 'working-tree-evidence.txt'), 'uncommitted\n');
      const taskDir = path.join(scratch, 'openspec', 'changes', 'handoff-task');
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'tasks.md'), [
        '- [x] Confirm branch state',
        '- [ ] Finish replacement assertions',
        '- [ ] Verify generated mirrors',
      ].join('\n') + '\n');
      ready = true;
      return scratch;
    } finally {
      if (!ready) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  test('bash -n syntax check passes', () => {
    const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
  });

  test('scratch invocation writes branch, OpenSpec task, working-tree, and recent-commit evidence', () => {
    const scratch = makeScratchRepo();
    const realHandoffPath = path.join(ROOT, '.claude', 'artifacts', 'checkpoints', 'handoff-latest.md');
    const realHandoffBefore = fs.existsSync(realHandoffPath)
      ? fs.readFileSync(realHandoffPath, 'utf8')
      : null;
    try {
      const env = { ...process.env, CLAUDE_PROJECT_DIR: scratch, CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard' };
      const res = spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
        cwd: scratch,
        env,
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);

      const handoffPath = path.join(scratch, '.claude', 'artifacts', 'checkpoints', 'handoff-latest.md');
      assert.ok(fs.existsSync(handoffPath), `expected scratch handoff at ${handoffPath}`);
      const handoff = fs.readFileSync(handoffPath, 'utf8');
      assert.match(handoff, /- \*\*branch\*\*: `feat\/handoff-evidence`/);
      assert.match(handoff, /- \*\*OpenSpec change\*\*: `handoff-task`/);
      assert.match(handoff, /tasks: 1 done \/ 2 open/);
      assert.match(handoff, /\?\? working-tree-evidence\.txt/);
      assert.match(handoff, /handoff evidence commit/);
      assert.match(handoff, new RegExp(execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim()));
      assert.strictEqual(
        fs.existsSync(realHandoffPath),
        realHandoffBefore !== null,
        'hook must not change whether a real-checkout handoff exists'
      );
      if (realHandoffBefore !== null) {
        assert.strictEqual(fs.readFileSync(realHandoffPath, 'utf8'), realHandoffBefore,
          'hook must not change a pre-existing real-checkout handoff');
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}


run('postcompact-restore');
