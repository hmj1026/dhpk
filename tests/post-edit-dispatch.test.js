'use strict';

// Coverage for post-edit-dispatch.sh (PostToolUse Edit|Write|MultiEdit
// dispatcher): always runs the core post-edit-remind.sh synchronously (its
// sentinel-writing side effects must be visible immediately), and — when
// DHPK_ACTIVE_MODULES is set — fires module post-edit-*.sh hooks in the
// background. This suite exercises the synchronous core path (module
// dispatch is backgrounded/async and not asserted on here).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'post-edit-dispatch.sh');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ped-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function runHook(repo, filePath, extraEnv = {}) {
  const payload = JSON.stringify({ tool_input: { file_path: filePath } });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, ...extraEnv };
  delete env.DHPK_ACTIVE_MODULES;
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = payload;
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('editing a .php file synchronously arms the code-reviewer sentinel', () => {
  const repo = mkRepo();
  try {
    const phpFile = path.join(repo, 'Foo.php');
    fs.writeFileSync(phpFile, '<?php class Foo {}\n');
    const res = runHook(repo, phpFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(fs.existsSync(path.join(sessDir(repo), '.pending-review')),
      'expected .pending-review sentinel to be armed synchronously');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('editing a .md file arms the doc-reviewer sentinel, not the code sentinel', () => {
  const repo = mkRepo();
  try {
    const mdFile = path.join(repo, 'README.md');
    fs.writeFileSync(mdFile, '# hi\n');
    const res = runHook(repo, mdFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(fs.existsSync(path.join(sessDir(repo), '.pending-doc-review')),
      'expected .pending-doc-review sentinel to be armed');
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')),
      'expected .pending-review (code) sentinel NOT armed for a doc-only edit');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('no active modules → dispatcher exits with the core hook exit code (0)', () => {
  const repo = mkRepo();
  try {
    const phpFile = path.join(repo, 'Bar.php');
    fs.writeFileSync(phpFile, '<?php class Bar {}\n');
    const res = runHook(repo, phpFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('self-edit under .claude/artifacts/ does not arm any sentinel', () => {
  const repo = mkRepo();
  try {
    const artifactFile = path.join(repo, '.claude', 'artifacts', 'reviews', 'report.md');
    fs.mkdirSync(path.dirname(artifactFile), { recursive: true });
    fs.writeFileSync(artifactFile, '# report\n');
    const res = runHook(repo, artifactFile);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    const dir = sessDir(repo);
    const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.strictEqual(entries.filter((e) => e.startsWith('.pending-')).length, 0,
      `expected no pending sentinel from a self-edit, got: ${entries}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('post-edit-dispatch');
