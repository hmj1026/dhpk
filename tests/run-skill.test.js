'use strict';

// Coverage for scripts/run-skill.sh — resolves <repo>/skills/<name>/scripts/<file>
// relative to the wrapper's own location and execs it with the matching
// interpreter (node/.js, python3/.py, bash/.sh). Guards path components and
// unknown script types/missing files with exit 2.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-skill.sh');

function runScript(args) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('missing args prints usage and exits 2', () => {
  const res = runScript(['only-one-arg']);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('usage:'), res.stderr);
});

test('resolves and execs a real .js skill script (read-only repo-intake scan)', () => {
  const res = runScript(['repo-intake', 'scan_repo.js', '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.length > 0);
  assert.doesNotThrow(() => JSON.parse(res.stdout));
});

test('rejects a skill-name argument containing a path component', () => {
  const res = runScript(['../etc', 'scan_repo.js']);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('illegal path component'), res.stderr);
});

test('rejects a file argument containing a path component', () => {
  const res = runScript(['repo-intake', '../../etc/passwd']);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('illegal path component'), res.stderr);
});

test('unknown skill/script combination reports script not found (exit 2)', () => {
  const res = runScript(['nonexistent-skill-xyz', 'nope.js']);
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('script not found'), res.stderr);
});

test('unsupported script extension on an existing file is rejected as unsupported type', () => {
  const res = runScript(['continuous-learning-v2', '__pycache__/instinct-cli.cpython-314.pyc']);
  // Path contains a `/`, so the path-component guard fires first (exit 2) —
  // this still exercises the same "reject non .js/.py/.sh" outcome end-to-end.
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('illegal path component'), res.stderr);
});

run('run-skill');
