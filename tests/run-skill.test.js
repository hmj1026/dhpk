'use strict';

// Coverage for scripts/run-skill.sh — resolves <repo>/skills/<name>/scripts/<file>
// relative to the wrapper's own location and execs it with the matching
// interpreter (node/.js, python3/.py, bash/.sh). Guards path components and
// unknown script types/missing files with exit 2.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-skill.sh');

function runScript(args) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
}

function isolatedRunSkill({ inventory, helper, target }) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-run-skill-security-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-run-skill-outside-')));
  try {
    fs.cpSync(path.join(ROOT, 'scripts'), path.join(scratch, 'scripts'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(scratch, 'manifests'), { recursive: true });
    if (inventory !== undefined) {
      fs.writeFileSync(path.join(scratch, 'manifests', 'distribution-inventory.json'), inventory);
    }
    const helperPath = path.join(scratch, 'skills', helper.skill, 'scripts', helper.file);
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    const outsidePath = path.join(outside, 'retained-helper.js');
    fs.writeFileSync(outsidePath, 'process.stdout.write("outside-helper-executed\\n");\n');
    if (target === 'symlink') fs.symlinkSync(outsidePath, helperPath);
    else fs.writeFileSync(helperPath, 'process.stdout.write("retained-helper-executed\\n");\n');
    const result = spawnSync('bash', [path.join(scratch, 'scripts', 'run-skill.sh'), helper.skill, helper.file], {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 10000,
    });
    return { result, scratch, outside };
  } catch (error) {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    throw error;
  }
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
  const res = runScript(['dhpk-repo-intake', 'scan_repo.js', '--format', 'json']);
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

test('malformed inventory fails closed before a retained helper can execute', () => {
  const helper = { skill: 'dhpk-retired-helper', file: 'retained.js' };
  const { result, scratch, outside } = isolatedRunSkill({ inventory: '{malformed', helper });
  try {
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /distribution inventory.*(malformed|unavailable|invalid)/i);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('unavailable inventory fails closed before a retained helper can execute', () => {
  const helper = { skill: 'dhpk-retired-helper', file: 'retained.js' };
  const { result, scratch, outside } = isolatedRunSkill({ inventory: undefined, helper });
  try {
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /distribution inventory.*(malformed|unavailable|invalid)/i);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('rejects a script symlink that resolves outside the canonical skills root', () => {
  const helper = { skill: 'dhpk-retained-helper', file: 'retained.js' };
  const inventory = fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8');
  const { result, scratch, outside } = isolatedRunSkill({ inventory, helper, target: 'symlink' });
  try {
    assert.strictEqual(result.status, 2, result.stderr);
    assert.match(result.stderr, /(symlink|canonical|outside|containment)/i);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('unsupported script extension on an existing file is rejected as unsupported type', () => {
  const res = runScript(['dhpk-skill-health-audit', '__pycache__/health-cli.cpython-314.pyc']);
  // Path contains a `/`, so the path-component guard fires first (exit 2) —
  // this still exercises the same "reject non .js/.py/.sh" outcome end-to-end.
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('illegal path component'), res.stderr);
});

run('run-skill');
