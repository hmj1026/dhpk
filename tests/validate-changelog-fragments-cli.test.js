'use strict';

// CLI-level coverage for scripts/ci/validate-changelog-fragments.js:
// argument parsing, check mode exit codes, --diff-base coverage gate, --write mode.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-changelog-fragments.js');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-fragments-cli-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'changelog.d'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  spawnSync('git', ['branch', '-q', 'develop'], { cwd: dir });
  return dir;
}

function runCli(repo, args) {
  return spawnSync('node', [CLI, '--repo-root', repo, ...args], { cwd: repo, encoding: 'utf8' });
}

test('check mode passes on an empty fragment directory', () => {
  const repo = mkRepo();
  const res = runCli(repo, []);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /PASS/);
});

test('check mode fails on an invalid fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'bogus.widget.md'), 'scope: widget\nnote: x\n');
  const res = runCli(repo, []);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /invalid category/);
});

test('--diff-base fails when a user-visible file changed with no fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /missing release fragment/);
});

test('--diff-base passes when a fragment covers the change', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file + fragment'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.strictEqual(res.status, 0, res.stderr);
});

test('--diff-base passes on a release-shaped diff: promoted section, no pending fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file + fragment'], { cwd: repo });
  // Release prep consumes the fragment into a CHANGELOG.md section.
  const write = runCli(repo, ['--write', '--version', '1.0.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.strictEqual(write.status, 0, write.stderr);
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'chore(release): 1.0.0'], { cwd: repo });

  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.strictEqual(res.status, 0, res.stderr);
});

test('--diff-base still fails when CHANGELOG.md changed without adding a release section', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.appendFileSync(path.join(repo, 'CHANGELOG.md'), '\nsome prose edit\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'edit changelog prose'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /missing release fragment/);
});

test('--write promotes fragments into CHANGELOG.md', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  const res = runCli(repo, ['--write', '--version', '1.0.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.strictEqual(res.status, 0, res.stderr);
  const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## 1.0.0 — 2026-07-27 — Add widget'));
  assert.ok(!fs.existsSync(path.join(repo, 'changelog.d', 'feat.widget.md')));
});

run('validate-changelog-fragments-cli');
