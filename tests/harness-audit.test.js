'use strict';

// Coverage for scripts/harness-audit.js — deterministic, read-only harness
// audit. Supports --root so it can be pointed at a temp fixture (consumer
// mode) or the real repo root (repo mode) without ever writing anything.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'harness-audit.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-'));
}

function runScript(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 15000 });
}

test('--help prints usage and exits 0', () => {
  const res = runScript(['--help']);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('Usage: node scripts/harness-audit.js'), res.stdout);
});

test('unknown flag exits 1 with an error message', () => {
  const res = runScript(['--bogus']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('Unknown argument'), res.stderr);
});

test('invalid --scope exits 1', () => {
  const res = runScript(['--scope', 'nonsense']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('Invalid scope'), res.stderr);
});

test('invalid --format exits 1', () => {
  const res = runScript(['--format', 'yaml']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stderr.includes('Invalid format'), res.stderr);
});

test('--root pointed at the real repo detects repo mode and emits a scored JSON report', () => {
  const res = runScript(['--root', ROOT, '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stderr);
  const report = JSON.parse(res.stdout);
  assert.strictEqual(report.scope, 'repo');
  assert.strictEqual(report.target_mode, 'repo');
  assert.ok(Array.isArray(report.checks) && report.checks.length > 0);
  assert.ok(report.max_score > 0);
  assert.ok(report.overall_score >= 0 && report.overall_score <= report.max_score);
  assert.ok(report.categories && typeof report.categories === 'object');
});

test('--scope hooks filters checks to the hooks scope only', () => {
  const res = runScript(['--root', ROOT, '--scope', 'hooks', '--format', 'json']);
  assert.strictEqual(res.status, 0, res.stderr);
  const report = JSON.parse(res.stdout);
  assert.strictEqual(report.scope, 'hooks');
  assert.ok(report.checks.length > 0);
});

test('text format prints a human report (non-JSON) for the real repo root', () => {
  const res = runScript(['--root', ROOT]);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.length > 0);
  assert.throws(() => {
    JSON.parse(res.stdout);
  }, 'text format output unexpectedly parsed as valid JSON — did the format default change?');
});

test('empty fixture dir is detected as consumer mode with low/zero scores', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(['--root', tmp, '--format', 'json']);
    assert.strictEqual(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    assert.strictEqual(report.target_mode, 'consumer');
    assert.ok(report.checks.length > 0);
    assert.ok(report.overall_score < report.max_score);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('consumer fixture with AGENTS.md and tests/ passes those specific checks', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '# Agents\n');
    fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'tests', 'sample.test.js'), '// placeholder\n');
    const res = runScript(['--root', tmp, '--format', 'json']);
    assert.strictEqual(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    const instructions = report.checks.find((c) => c.id === 'consumer-instructions');
    assert.ok(instructions, 'expected a consumer-instructions check');
    assert.strictEqual(instructions.pass, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('harness-audit');
