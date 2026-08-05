'use strict';

// SessionStart has one deterministic responsibility: activate configured
// modules. It must not create lifecycle artifacts or run health/orchestration
// diagnostics.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');

function runInScratch(modules) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ss-')));
  spawnSync('git', ['init', '-q'], { cwd: scratch });
  try {
    const env = {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
      CLAUDE_PROJECT_DIR: scratch,
      CLAUDE_PLUGIN_OPTION_MODULES: modules || '',
    };
    const res = spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env: { ...env, P: JSON.stringify({ source: 'startup' }) },
      encoding: 'utf8',
      timeout: 10000,
    });
    return { scratch, res };
  } catch (error) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('no configured modules is a silent no-op with no lifecycle artifacts', () => {
  const { scratch, res } = runInScratch('');
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '', `unexpected SessionStart output: ${res.stdout}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.claude', 'artifacts')),
      'module activation must not create session snapshots or lifecycle artifacts');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('configured modules are validated and reported without lifecycle diagnostics', () => {
  const { scratch, res } = runInScratch('php-5.6,not-a-module,php-5.6');
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /module enabled: php-5\.6/);
    assert.match(res.stderr, /module 'not-a-module' not found/);
    assert.ok(!res.stdout.includes('snapshot') && !res.stdout.includes('orchestration'), res.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('session-start');
