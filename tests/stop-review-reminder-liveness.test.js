'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop-review-reminder.sh');

function mkTempRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stop-reminder-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function writeFile(repo, name, body) {
  fs.mkdirSync(sessDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessDir(repo), name), body);
}

function runHook(repo) {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS;
  env.CLAUDE_PLUGIN_ROOT = ROOT;
  env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE = 'standard';
  env.DHPK_TEST_HOOK = HOOK;
  env.DHPK_TEST_PAYLOAD = JSON.stringify({});
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_TEST_PAYLOAD" | bash "$DHPK_TEST_HOOK"'], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('Stop reminder prints exact sentinel basename in manual clear command', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-db-review', '2026-07-07 12:00 src/Repo.php\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('clear-sentinel.sh" .pending-db-review manual'),
      `manual clear command must use exact basename:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('clear-sentinel.sh" db manual'),
      `manual clear command must not use shorthand:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder reports matching active marker as in-flight work to wait for', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    writeFile(repo, '.active-doc-review', '1783440000 doc-reviewer\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] IN-FLIGHT: doc-reviewer'),
      `missing in-flight status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('wait for the existing doc-reviewer result'),
      `missing wait instruction:\n${res.stderr}`);
    assert.ok(!res.stderr.includes('Recommended: invoke \'doc-reviewer\''),
      `must not suggest duplicate dispatch for in-flight reviewer:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('Stop reminder keeps existing idle-pending guidance when no active marker exists', () => {
  const repo = mkTempRepo();
  try {
    writeFile(repo, '.pending-doc-review', '2026-07-07 12:00 docs/Guide.md\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 2, `expected stop block, got ${res.status}`);
    assert.ok(res.stderr.includes('[WARN] PENDING: doc-reviewer'),
      `missing existing pending status:\n${res.stderr}`);
    assert.ok(res.stderr.includes('Recommended: invoke \'doc-reviewer\''),
      `missing existing invoke guidance:\n${res.stderr}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-review-reminder-liveness');
