'use strict';

// Coverage for skills/opsx-apply-resume/scripts/detect-phase.sh — determines the
// opsx-apply-resume phase from .claude/artifacts/apply-resume/latest.md.
// The script reads a CWD-relative path, so each case runs from a scratch dir.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'opsx-apply-resume', 'scripts', 'detect-phase.sh');

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

function runScript(cwd, handoffFile) {
  const args = handoffFile ? [SCRIPT, handoffFile] : [SCRIPT];
  return spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 10000 });
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

for (const [label, parentRelative] of [
  ['.dhpk', '.dhpk'],
  ['.claude', '.claude'],
  ['an explicit nested parent', path.join('explicit', 'nested-parent')],
]) {
  test(`missing explicit handoff below symlinked ${label} fails before Save`, () => {
    const tmp = mkTmp();
    const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'detect-phase-external-')));
    try {
      const symlinkParent = path.join(tmp, parentRelative);
      fs.mkdirSync(path.dirname(symlinkParent), { recursive: true });
      fs.symlinkSync(external, symlinkParent, 'dir');
      const handoff = path.join(symlinkParent, 'handoff', 'latest.md');
      const relativeHandoff = path.relative(tmp, handoff);
      const res = runScript(tmp, relativeHandoff);
      assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.doesNotMatch(res.stdout, /^save\s*$/m, 'unsafe missing leaf must not select Save');
      assert.ok(!fs.existsSync(path.join(external, 'handoff', 'latest.md')),
        'detector must not create or touch a handoff beneath the external target');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(external, { recursive: true, force: true });
    }
  });
}

run('detect-phase');
