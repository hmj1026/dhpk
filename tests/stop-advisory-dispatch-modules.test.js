'use strict';

// Coverage for stop-advisory-dispatch.sh (module-dispatch advisory) (Stop dispatcher for module-contributed Stop
// hooks + consolidated module-findings surfacing).
//   - No active modules, no findings file → silent exit 0.
//   - A pre-populated .module-findings file (as post-edit-dispatch.sh would
//     leave behind) is surfaced once via a systemMessage, then cleared.
//   - minimal profile suppresses the surfaced message but still clears the
//     findings file.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'stop-advisory-dispatch.sh');

function mkRepo() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sd-')));
}

function sessDir(repo) {
  return path.join(repo, '.claude', 'artifacts', 'sessions');
}

function findingsPath(repo) {
  return path.join(sessDir(repo), '.module-findings');
}

function runHook(repo, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT, ...extraEnv };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_MODULES;
  return spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('no modules, no findings file → silent exit 0', () => {
  const repo = mkRepo();
  try {
    const res = runHook(repo);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stdout.trim(), '', `expected no stdout, got: ${res.stdout}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('pre-populated findings file is surfaced via systemMessage, then cleared', () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(findingsPath(repo), 'eslint: 2 problems in foo.js\n');
    const res = runHook(repo);
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes('"systemMessage"'), `expected systemMessage JSON, got: ${res.stdout}`);
    assert.ok(res.stdout.includes('eslint: 2 problems in foo.js'),
      `expected findings content in message, got: ${res.stdout}`);
    assert.ok(!fs.existsSync(findingsPath(repo)), 'expected findings file cleared after surfacing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('minimal profile suppresses the surfaced message but still clears the findings file', () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    fs.writeFileSync(findingsPath(repo), 'some finding\n');
    const res = runHook(repo, { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.ok(!res.stdout.includes('systemMessage'), `expected no message in minimal profile, got: ${res.stdout}`);
    assert.ok(!fs.existsSync(findingsPath(repo)), 'expected findings file cleared even under minimal profile');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('stop-advisory-dispatch-modules');
