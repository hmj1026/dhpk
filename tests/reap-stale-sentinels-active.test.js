'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'reap-stale-sentinels.sh');

function mkTempRepo() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-reap-active-')));
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function writeSessionFile(repo, name, body) {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function readLines(repo, name) {
  const file = path.join(sessDir(repo), name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function runReap(repo, args = []) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
  return spawnSync('bash', [HOOK, ...args], {
    cwd: repo,
    env,
    encoding: 'utf8',
  });
}

test('default active sweep prunes only stale entries and keeps fresh entries', () => {
  const repo = mkTempRepo();
  try {
    const now = Math.floor(Date.now() / 1000);
    writeSessionFile(repo, '.active-review', [
      `${now - 3 * 60 * 60} code-reviewer stale`,
      `${now - 10 * 60} code-reviewer fresh`,
      '',
    ].join('\n'));
    writeSessionFile(repo, '.pending-review', '2026-07-07 12:00 src/Foo.php\n');
    const res = runReap(repo);
    assert.strictEqual(res.status, 0, `reap failed: ${res.stderr}`);
    assert.deepStrictEqual(readLines(repo, '.active-review'), [`${now - 10 * 60} code-reviewer fresh`]);
    assert.ok(fs.existsSync(path.join(sessDir(repo), '.pending-review')),
      'pending sentinels should keep their independent 24h default behavior');
    assert.ok(res.stderr.includes('reaped ACTIVE: .active-review'),
      `missing active reap message:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('active threshold override prunes entries older than the override and removes empty marker file', () => {
  const repo = mkTempRepo();
  try {
    const now = Math.floor(Date.now() / 1000);
    writeSessionFile(repo, '.active-db-review', `${now - 10 * 60} database-reviewer stale\n`);
    const res = runReap(repo, ['--active-threshold-minutes', '5']);
    assert.strictEqual(res.status, 0, `reap failed: ${res.stderr}`);
    assert.ok(!fs.existsSync(path.join(sessDir(repo), '.active-db-review')),
      'empty active marker file should be removed after its last stale entry is pruned');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fast-worker active marker uses the same stale-entry lifecycle', () => {
  const repo = mkTempRepo();
  try {
    const now = Math.floor(Date.now() / 1000);
    writeSessionFile(repo, '.active-fast-worker', [
      `${now - 20 * 60} fast-worker stale`,
      `${now - 60} codex-fast-worker fresh`,
      '',
    ].join('\n'));
    const res = runReap(repo, ['--active-threshold-minutes', '5']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(readLines(repo, '.active-fast-worker'), [`${now - 60} codex-fast-worker fresh`]);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('reap-stale-sentinels-active');
