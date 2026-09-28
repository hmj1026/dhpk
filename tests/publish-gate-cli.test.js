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

function withStageFiles(stages, callback) {
  const roots = [];
  try {
    const files = stages.map((stage) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-publish-gate-'));
      roots.push(root);
      const file = path.join(root, 'stage.json');
      fs.writeFileSync(file, JSON.stringify(stage));
      return file;
    });
    return callback(files);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
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
  spawnSync('git', ['tag', 'baseline-v1'], { cwd: root });
  return root;
}

function gitState(root) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const tags = spawnSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(head.status, 0, head.stderr);
  assert.strictEqual(tags.status, 0, tags.stderr);
  return { head: head.stdout.trim(), tags: tags.stdout.trim() };
}

test('allows publication when SOURCE and PACKAGE both PASS', () => {
  withStageFiles([passStage(), passStage()], ([sourceFile, packageFile]) => {
    const res = spawnSync('node', [
      CLI, '--version', '1.0.0',
      '--source-gate-json', sourceFile,
      '--package-gate-json', packageFile,
    ], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const evidence = JSON.parse(res.stdout);
    assert.strictEqual(evidence.overall, 'PUBLISHED_PENDING');
    assert.strictEqual(evidence.stages.CONSUMER.verdict, 'PENDING');
  });
});

test('passes target branch context without mutating refs or publishing', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  assert.ok(!source.includes('git tag'), 'publish-gate must never create a tag itself');
  assert.ok(!source.includes('git push'), 'publish-gate must never push anything itself');
  assert.ok(!source.includes('gh pr merge') && !source.includes('pr merge'), 'publish-gate must never merge a PR itself');

  const repo = mkPublishRepo();
  try {
    const before = gitState(repo);
    const res = spawnSync('node', [CLI, '--version', '1.0.0', '--repo-root', repo], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stderr);
    const evidence = JSON.parse(res.stdout);
    assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
    assert.strictEqual(evidence.stages.PACKAGE.verdict, 'PASS');
    assert.deepStrictEqual(gitState(repo), before);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('blocks publication when PACKAGE fails, even though SOURCE passes', () => {
  withStageFiles([passStage(), failStage('staged package missing declared asset')], ([sourceFile, packageFile]) => {
    const res = spawnSync('node', [
      CLI, '--version', '1.0.0',
      '--source-gate-json', sourceFile,
      '--package-gate-json', packageFile,
    ], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    const evidence = JSON.parse(res.stdout);
    assert.strictEqual(evidence.overall, 'BLOCKED');
    assert.strictEqual(evidence.stages.SOURCE.verdict, 'PASS');
    assert.strictEqual(evidence.stages.PACKAGE.verdict, 'FAIL');
  });
});

test('blocks publication when SOURCE fails', () => {
  withStageFiles([failStage('tests/run-all.js failed'), passStage()], ([sourceFile, packageFile]) => {
    const res = spawnSync('node', [
      CLI, '--version', '1.0.0',
      '--source-gate-json', sourceFile,
      '--package-gate-json', packageFile,
    ], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    const evidence = JSON.parse(res.stdout);
    assert.strictEqual(evidence.overall, 'BLOCKED');
  });
});

run('publish-gate-cli');
