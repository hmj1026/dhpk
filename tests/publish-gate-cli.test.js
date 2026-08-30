'use strict';

// CLI-level coverage for scripts/release/publish-gate.js: the task-3.4
// mechanism that blocks tag/publication preparation unless SOURCE and
// PACKAGE both PASS. Uses --source-gate-json/--package-gate-json (test-only
// overrides) to inject pre-baked stage JSON instead of spawning the real
// (heavy) source-gate.js/package-gate.js — those are covered by their own
// CLI test files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'publish-gate.js');

function mkStageFile(stage) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publish-gate-')), 'stage.json');
  fs.writeFileSync(file, JSON.stringify(stage));
  return file;
}

function passStage() {
  return { verdict: 'PASS', commands: [], environment: 'test', artifacts: [], failureReasons: [] };
}

function failStage(reason) {
  return { verdict: 'FAIL', commands: [], environment: 'test', artifacts: [], failureReasons: [reason] };
}

function mkPublishRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publish-gate-repo-')));
  const releaseDir = path.join(root, 'scripts', 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'source-gate.js'), [
    '#!/usr/bin/env node',
    "const pass = process.env.DHPK_RELEASE_TARGET_BRANCH === 'main';",
    'const stage = { verdict: pass ? \'PASS\' : \'FAIL\', commands: [], environment: \'test\', artifacts: [], failureReasons: pass ? [] : [\'missing publish target context\'] };',
    'console.log(JSON.stringify(stage));',
    'process.exit(pass ? 0 : 1);',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(releaseDir, 'package-gate.js'), [
    '#!/usr/bin/env node',
    "console.log(JSON.stringify({ verdict: 'PASS', commands: [], environment: 'test', artifacts: [], failureReasons: [] }));",
    '',
  ].join('\n'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  spawnSync('git', ['checkout', '-q', '-b', 'main'], { cwd: root });
  return root;
}

test('allows publication when SOURCE and PACKAGE both PASS', () => {
  const res = spawnSync('node', [
    CLI, '--version', '1.0.0',
    '--source-gate-json', mkStageFile(passStage()),
    '--package-gate-json', mkStageFile(passStage()),
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const evidence = JSON.parse(res.stdout);
  assert.notStrictEqual(evidence.overall, 'BLOCKED');
});

test('passes the merged publish target branch context to SOURCE', () => {
  const repo = mkPublishRepo();
  try {
    const res = spawnSync('node', [CLI, '--version', '1.0.0', '--repo-root', repo], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const evidence = JSON.parse(res.stdout);
    assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
    assert.strictEqual(evidence.stages.PACKAGE.verdict, 'PASS');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('blocks publication when PACKAGE fails, even though SOURCE passes', () => {
  const res = spawnSync('node', [
    CLI, '--version', '1.0.0',
    '--source-gate-json', mkStageFile(passStage()),
    '--package-gate-json', mkStageFile(failStage('staged package missing declared asset')),
  ], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  const evidence = JSON.parse(res.stdout);
  assert.strictEqual(evidence.overall, 'BLOCKED');
  assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
  assert.strictEqual(evidence.stages.PACKAGE.verdict, 'FAIL');
});

test('blocks publication when SOURCE fails', () => {
  const res = spawnSync('node', [
    CLI, '--version', '1.0.0',
    '--source-gate-json', mkStageFile(failStage('tests/run-all.js failed')),
    '--package-gate-json', mkStageFile(passStage()),
  ], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  const evidence = JSON.parse(res.stdout);
  assert.strictEqual(evidence.overall, 'BLOCKED');
});

test('never merges a PR or creates a tag itself (advisory gate only)', () => {
  const raw = fs.readFileSync(CLI, 'utf8');
  assert.ok(!raw.includes('git tag'), 'publish-gate must not create tags itself');
  assert.ok(!raw.includes('pr merge') && !raw.includes('gh pr merge'), 'publish-gate must not merge PRs itself');
});

run('publish-gate-cli');
