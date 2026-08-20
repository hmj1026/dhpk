'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

run('dhpk-distribution');
