'use strict';

// Smoke coverage for postcompact-restore.sh (PostCompact hook).
//   1. bash -n syntax check.
//   2. Safe invocation against a scratch project dir with NO checkpoint file
//      present — the hook's first guard (`[ -e "$CKPT" ] || exit 0`) makes
//      this a provable no-op: exit 0, no sentinel files created/touched, no
//      stdout JSON emitted.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'postcompact-restore.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('no checkpoint present → safe no-op, exit 0, no sessions/ artifacts written', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pcr-')));
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: scratch };
    const res = spawnSync('bash', ['-c', 'printf %s "{}" | bash "$1"', '_', HOOK], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.strictEqual(res.stdout.trim(), '', `expected no stdout JSON, got: ${res.stdout}`);
    const sessDir = path.join(scratch, '.claude', 'artifacts', 'sessions');
    assert.ok(!fs.existsSync(sessDir) || fs.readdirSync(sessDir).length === 0,
      'expected no sentinel files restored when no checkpoint exists');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('postcompact-restore');
