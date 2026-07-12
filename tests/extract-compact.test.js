'use strict';

// Coverage for scripts/opsx-apply-resume/extract-compact.sh — extracts
// human-readable fields from a compact-*.json file via jq. Covers the happy
// path (populated fields, string vs object array items) and the two error
// paths (missing arg / missing file).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'opsx-apply-resume', 'extract-compact.sh');

function mkTmpFile(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-compact-'));
  const file = path.join(dir, 'compact.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return { dir, file };
}

function runScript(args) {
  return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
}

test('populated compact file: extracts L0, goal, string + object list items', () => {
  const { dir, file } = mkTmpFile({
    L0: 'did the thing',
    session_goal: 'ship feature X',
    completed: ['step one', { task: 'step two' }],
    in_progress: ['step three'],
    key_decisions: [{ decision: 'use jq', reason: 'zero-dep' }],
    failed_approaches: [{ lesson: 'do not use sed for json' }],
  });
  try {
    const res = runScript([file]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('L0: did the thing'));
    assert.ok(res.stdout.includes('session_goal: ship feature X'));
    assert.ok(res.stdout.includes('  - step one'));
    assert.ok(res.stdout.includes('  - step two'));
    assert.ok(res.stdout.includes('  - step three'));
    assert.ok(res.stdout.includes('[use jq] zero-dep'));
    assert.ok(res.stdout.includes('lesson: do not use sed for json'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty-array fields render as (none)', () => {
  const { dir, file } = mkTmpFile({ completed: [], in_progress: [], key_decisions: [], failed_approaches: [] });
  try {
    const res = runScript([file]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('L0: (未取得)'));
    const noneCount = (res.stdout.match(/\(none\)/g) || []).length;
    assert.strictEqual(noneCount, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing path argument → error, exit 1', () => {
  const res = runScript([]);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stdout.includes('ERROR: no path provided'));
});

test('nonexistent file argument → error, exit 1', () => {
  const res = runScript(['/no/such/compact.json']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stdout.includes('ERROR: file not found'));
});

run('extract-compact');
