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
