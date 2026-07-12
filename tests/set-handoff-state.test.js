'use strict';

// Coverage for scripts/opsx-apply-resume/set-handoff-state.sh — atomically
// updates the `state:` frontmatter field in .claude/artifacts/apply-resume/latest.md.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'opsx-apply-resume', 'set-handoff-state.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'set-handoff-state-'));
}

function latestPath(dir) {
  return path.join(dir, '.claude', 'artifacts', 'apply-resume', 'latest.md');
}

function writeLatest(dir, state) {
  const p = latestPath(dir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `state: ${state}\nsaved_at: 2020-01-01T00:00:00Z\n`);
  return p;
}

function runScript(cwd, args) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

test('valid state transition updates the state field in place', () => {
  const tmp = mkTmp();
  try {
    const p = writeLatest(tmp, 'saved');
    const res = runScript(tmp, ['consuming']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('state updated to: consuming'));
    assert.match(fs.readFileSync(p, 'utf8'), /^state: consuming$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid state value is rejected before touching the file', () => {
  const tmp = mkTmp();
  try {
    const p = writeLatest(tmp, 'saved');
    const before = fs.readFileSync(p, 'utf8');
    const res = runScript(tmp, ['bogus-state']);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes("invalid state 'bogus-state'"));
    assert.strictEqual(fs.readFileSync(p, 'utf8'), before, 'file must be unchanged on rejection');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing state argument → error, exit 1', () => {
  const tmp = mkTmp();
  try {
    writeLatest(tmp, 'saved');
    const res = runScript(tmp, []);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('state argument required'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('missing latest.md file → error, exit 1', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(tmp, ['saved']);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('latest.md not found'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('set-handoff-state');
