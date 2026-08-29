'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dhpk');
const SURFACES = ['agent-plugin', 'cursor-plugin', 'codex-native', 'agy-plugin'];

function invoke(args) {
  return spawnSync('bash', [CLI, 'distribution', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function report(result) {
  return JSON.parse(result.stdout);
}

test('rejects an unknown retained surface before any package operation runs', () => {
  const result = invoke(['unknown-plugin', 'validate']);
  assert.strictEqual(result.status, 64);
  assert.match(result.stderr, /unknown surface/i);
});

test('rejects missing option values as usage instead of silently using defaults', () => {
  for (const args of [
    ['agy-plugin', 'validate', '--output', '--json'],
    ['agy-plugin', 'validate', '--output='],
    ['agy-plugin', 'validate', '--version='],
  ]) {
    const result = invoke(args);
    assert.strictEqual(result.status, 64, result.stderr);
    assert.match(result.stderr, /option value is required/i);
  }
});

test('validates every retained package surface through one JSON command contract', () => {
  for (const surface of SURFACES) {
    const result = invoke([surface, 'validate', '--json']);
    assert.strictEqual(result.status, 0, `${surface}: ${result.stderr}`);
    const payload = report(result);
    assert.strictEqual(payload.surface, surface);
    assert.strictEqual(payload.operation, 'validate');
    assert.strictEqual(payload.verdict, 'PASS', JSON.stringify(payload));
  }
});

test('generates a disposable AGY package and validates that exact output', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-distribution-cli-'));
  const outDir = path.join(temporaryRoot, 'agy-package');
  try {
    const generated = invoke(['agy-plugin', 'generate', '--output', outDir, '--version', '0.42.2', '--json']);
    assert.strictEqual(generated.status, 0, generated.stderr);
    assert.strictEqual(report(generated).verdict, 'PASS');
    assert.ok(fs.existsSync(path.join(outDir, 'plugin.json')));

    const validated = invoke(['agy-plugin', 'validate', '--output', outDir, '--version', '0.42.2', '--json']);
    assert.strictEqual(validated.status, 0, validated.stderr);
    assert.strictEqual(report(validated).verdict, 'PASS');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects provenance-bound generation from a dirty source checkout before writing output', () => {
  const worktreeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-distribution-dirty-'));
  const worktreeRoot = path.join(worktreeParent, 'checkout');
  const outDir = path.join(worktreeParent, 'agent-package');
  let worktreeAdded = false;
  const marker = path.join(worktreeRoot, `.issue-237-dirty-source-${process.pid}`);
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeRoot, 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worktreeAdded = true;
    fs.writeFileSync(marker, 'uncommitted source input\n');
    const result = spawnSync('bash', [path.join(worktreeRoot, 'bin', 'dhpk'), 'distribution', 'agent-plugin', 'generate', '--output', outDir, '--json'], {
      cwd: worktreeRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /source checkout must be clean/i);
    assert.strictEqual(fs.existsSync(outDir), false, 'dirty generation must abort before materializing output');
  } finally {
    fs.rmSync(marker, { force: true });
    if (worktreeAdded) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    fs.rmSync(worktreeParent, { recursive: true, force: true });
  }
});

test('refuses to replace a foreign output directory before package materialization', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-distribution-foreign-'));
  const outDir = path.join(temporaryRoot, 'foreign-package');
  fs.mkdirSync(outDir);
  const sentinel = path.join(outDir, 'user-owned.txt');
  fs.writeFileSync(sentinel, 'preserve me');
  try {
    const result = invoke(['agent-plugin', 'generate', '--output', outDir, '--json']);
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /owner receipt|foreign output/i);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'preserve me');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('keeps structural validation separate from evidence-bound verification', () => {
  for (const surface of SURFACES) {
    const result = invoke([surface, 'verify', '--json']);
    assert.strictEqual(result.status, 0, `${surface}: ${result.stderr}`);
    const payload = report(result);
    assert.strictEqual(payload.operation, 'verify');
    assert.strictEqual(payload.verdict, 'PASS', JSON.stringify(payload));
    assert.ok(payload.evidence, `${surface} must return verification evidence`);
    if (surface === 'codex-native') assert.strictEqual(payload.deterministic, 'PASS', JSON.stringify(payload));
  }
});

// v1 GREEN contract (tests above): distribution CLI validate/generate/verify
// for retained surfaces, foreign-output refusal, evidence-bound verify.
// v2 RED contract (this test): required_core includes `do` and validators must
// not keep an exact-nine count literal. See tests/dhpk-do-portable.test.js [5.1].

test('minimal required_core includes do without an exact-nine count literal (RED until 5.1)', () => {
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const core = inventory.profile_policy.required_core_ids;
  assert.ok(Array.isArray(core), 'profile_policy.required_core_ids must be an array');
  assert.ok(core.includes('do'), "minimal required_core_ids must include stable id 'do'");
  const validator = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'distribution-inventory.js'), 'utf8');
  assert.doesNotMatch(validator, /length !== 9/);
  assert.doesNotMatch(validator, /exactly nine/);
  const installerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh'), 'utf8');
  assert.doesNotMatch(installerSrc, /!= 9/);
  assert.doesNotMatch(installerSrc, /exactly nine/i);
  assert.doesNotMatch(installerSrc, /exactly the nine/);
});

run('dhpk-distribution');
