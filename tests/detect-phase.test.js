'use strict';

// Coverage for scripts/opsx-apply-resume/detect-phase.sh — determines the
// opsx-apply-resume phase from .claude/artifacts/apply-resume/latest.md.
// The script reads a CWD-relative path, so each case runs from a scratch dir.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'opsx-apply-resume', 'detect-phase.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-phase-'));
}

function latestPath(dir) {
  return path.join(dir, '.claude', 'artifacts', 'apply-resume', 'latest.md');
}

function writeLatest(dir, state, savedAt) {
  const p = latestPath(dir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `state: ${state}\nsaved_at: ${savedAt}\n`);
}

function runScript(cwd) {
  return spawnSync('bash', [SCRIPT], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('no latest.md → save', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'save');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('state: saved, old timestamp → resume', () => {
  const tmp = mkTmp();
  try {
    writeLatest(tmp, 'saved', '2020-01-01T00:00:00Z');
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'resume');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('state: saved, very recent timestamp → warn-recent', () => {
  const tmp = mkTmp();
  try {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    writeLatest(tmp, 'saved', now);
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'warn-recent');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('state: consuming → consuming', () => {
  const tmp = mkTmp();
  try {
    writeLatest(tmp, 'consuming', '2020-01-01T00:00:00Z');
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'consuming');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unknown/corrupt state → save', () => {
  const tmp = mkTmp();
  try {
    writeLatest(tmp, 'garbled', '2020-01-01T00:00:00Z');
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'save');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('detect-phase');
