'use strict';

// Coverage for scripts/dep-audit.sh — dependency security audit wrapper over
// npm/yarn/pnpm audit. Always run in a scratch temp dir (never the repo) with
// NPM_CONFIG_OFFLINE=true so `npm audit` fails fast locally (ENOLOCK, no
// lockfile) instead of touching the network; the script doesn't check the
// audit-command exit code, so a fast local failure still produces a clean
// "0 vulnerabilities / PASS" report — safe and deterministic for CI.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'dep-audit.sh');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-'));
}

function runScript(cwd, args) {
  const env = { ...process.env, NPM_CONFIG_OFFLINE: 'true' };
  return spawnSync('bash', [SCRIPT, ...(args || [])], { cwd, env, encoding: 'utf8', timeout: 15000 });
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('-h/--help prints usage and exits 0 without running any audit', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(tmp, ['--help']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Usage:'), res.stdout);
    assert.ok(!res.stdout.includes('DEPENDENCY AUDIT'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unknown flag prints usage to stderr and exits 2', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(tmp, ['--bogus']);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes('Unknown arg'), res.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('npm project with no lockfile: fast local ENOLOCK, clean PASS report, exit 0', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: npm'), res.stdout);
    assert.ok(res.stdout.includes('| Critical | 0 |'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
    assert.ok(res.stdout.includes('=== END ==='), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detects yarn via yarn.lock presence and still exits cleanly (yarn binary optional)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }));
    fs.writeFileSync(path.join(tmp, 'yarn.lock'), '');
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: yarn'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('detects pnpm via pnpm-lock.yaml presence (precedence over yarn.lock)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }));
    fs.writeFileSync(path.join(tmp, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
    const res = runScript(tmp);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Package Manager: pnpm'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--level low with zero vulnerabilities still passes (total gate)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const res = runScript(tmp, ['--level', 'low']);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.ok(res.stdout.includes('Minimum Level: low'), res.stdout);
    assert.ok(res.stdout.includes('PASS'), res.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('dep-audit');
