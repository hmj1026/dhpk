'use strict';

// Coverage for scripts/ci/run-portable-bounded-command.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'run-portable-bounded-command.js');

function runPortable(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000,
  });
}

test('runs a command with the requested Node heap cap and no bounded control variables', () => {
  const child = [
    "if (process.env.DHPK_BOUNDED_ALLOW_FALLBACK) process.exit(17);",
    "if (process.env.NODE_OPTIONS !== '--max-old-space-size=512') process.exit(18);",
    "console.log('portable command ok');",
  ].join('\n');
  const res = runPortable(['--timeout', '5s', '--node-heap-mb', '512', '--', process.execPath, '-e', child], {
    DHPK_BOUNDED_ALLOW_FALLBACK: '1',
  });
  assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /portable command ok/);
});

test('returns 124 and terminates a command after the portable wall-time bound', () => {
  const res = runPortable(['--timeout', '1s', '--node-heap-mb', '512', '--', process.execPath, '-e', 'setTimeout(() => {}, 5000);']);
  assert.strictEqual(res.status, 124, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stderr, /timed out/i);
});

test('keeps SIGKILL escalation alive after the group leader exits on SIGTERM', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-portable-descendant-'));
  const marker = path.join(root, 'late-descendant');
  const descendant = [
    "process.on('SIGTERM', () => {});",
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 7000);`,
  ].join('\n');
  const child = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });`,
    'setTimeout(() => {}, 5000);',
  ].join('\n');
  try {
    const res = runPortable(['--timeout', '1s', '--node-heap-mb', '512', '--', process.execPath, '-e', child]);
    assert.strictEqual(res.status, 124, `${res.stdout}\n${res.stderr}`);
    spawnSync('sleep', ['7']);
    assert.strictEqual(fs.existsSync(marker), false, 'portable timeout must kill descendants after the leader exits');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed portable runner configuration', () => {
  const res = runPortable(['--timeout', '0s', '--node-heap-mb', '512', '--', process.execPath, '-e', 'process.exit(0);']);
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /Usage:/);
});

run('run-portable-bounded-command');
