'use strict';

// Dedicated coverage for scripts/hooks/clear-sentinel.sh — parametric
// sentinel cleaner. tests/subagent-stop-verify-autoclear.test.js exercises it
// indirectly (via subagent-stop-verify.sh); this file calls it directly with
// a scratch git repo + sessions dir, covering: normal clear, idempotency on
// an already-missing sentinel, --all, unknown-name rejection, and the
// fail-loud empty-name front door.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'clear-sentinel.sh');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clear-sentinel-')));
  spawnSync('git', ['init', '-q', dir]);
  spawnSync('git', ['-C', dir, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t.test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function mkSentinel(repo, name, body = 'stub') {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function runHook(repo, args) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
}

test('clears an existing sentinel and reports success', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel cleared (.pending-review)'));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('idempotent on an already-missing sentinel (no error, distinct message)', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['.pending-review', 'code-reviewer']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel already clean (.pending-review)'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--all clears every present sentinel and reports each', () => {
  const repo = mkRepo();
  try {
    mkSentinel(repo, '.pending-review');
    mkSentinel(repo, '.pending-db-review');
    const res = runHook(repo, ['--all', 'batch']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('sentinel cleared (.pending-review)'));
    assert.ok(res.stdout.includes('sentinel cleared (.pending-db-review)'));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-review')));
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.pending-db-review')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--all with nothing to clear reports "no sentinels to clear"', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['--all']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('no sentinels to clear'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('unknown sentinel name is rejected with exit 2', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, ['.pending-bogus', 'x']);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("unknown sentinel name '.pending-bogus'"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('empty sentinel name fails loud with exit 2 (stale/partial payload front door)', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo, []);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes('no sentinel name provided'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('clear-sentinel');
