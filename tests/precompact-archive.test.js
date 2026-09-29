'use strict';

// Observable coverage for precompact-archive.sh's scratch-only handoff.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

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

run('precompact-archive');
