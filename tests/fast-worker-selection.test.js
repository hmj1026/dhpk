'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SELECTOR = path.join(ROOT, 'scripts', 'fast-worker-selector.js');
const SESSION_START = path.join(ROOT, 'scripts', 'hooks', 'session-start.sh');
const selector = require(SELECTOR);

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function fakeCli(dir, name) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return bin;
}

function select(args, env = {}) {
  const keys = ['CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND', 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER', 'CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK', 'CODEX', 'PATH', 'DHPK_CLAUDE_BACKEND_AVAILABLE'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(env, key)) process.env[key] = env[key];
      else delete process.env[key];
    }
    const value = selector.select(selector.parseArgs(args));
    return { status: value.status === 'blocked' ? 1 : 0, stdout: `${JSON.stringify(value)}\n`, stderr: '', value };
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function sessionStart(repo, env = {}, payload = { source: 'startup', session_id: 'selection-test' }) {
  const childEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: repo, ...env };
  return spawnSync('bash', ['-c', 'printf %s "$DHPK_PAYLOAD" | bash "$DHPK_SESSION_START"'], {
    cwd: repo,
    env: { ...childEnv, DHPK_SESSION_START: SESSION_START, DHPK_PAYLOAD: JSON.stringify(payload) },
    encoding: 'utf8',
  });
}

test('default selector maps to the in-process fast-worker', () => {
  const res = select([], { PATH: '/usr/bin:/bin', CLAUDE_PLUGIN_OPTION_CODEX: 'off' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.value, {
    status: 'selected',
    requested_backend: 'claude',
    selected_backend: 'claude',
    selected_agent: 'dhpk:fast-worker',
    reason: 'shipped default',
    fallback: 'none',
  });
});

test('explicit and auto selection honor availability and configured order', () => {
  const dir = tempDir('dhpk-selector-');
  try {
    const bin = fakeCli(dir, 'codex');
    const explicit = select(['--backend', 'codex'], { PATH: `${bin}:/usr/bin:/bin`, CODEX: 'on' });
    assert.strictEqual(explicit.value.selected_backend, 'codex');
    assert.strictEqual(explicit.value.selected_agent, 'dhpk:codex-fast-worker');
    const auto = select(['--backend', 'auto', '--order', 'agy,codex,claude'], { PATH: `${bin}:/usr/bin:/bin`, CODEX: 'on' });
    assert.strictEqual(auto.value.selected_backend, 'codex');
    assert.ok(auto.value.rejected_candidates.some((item) => item.backend === 'agy'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing executable blocks unless the configured fallback is claude', () => {
  const blocked = select(['--backend', 'agy'], { PATH: '/usr/bin:/bin' });
  assert.strictEqual(blocked.value.status, 'blocked');
  assert.strictEqual(blocked.value.selected_backend, 'agy');
  const fallback = select(['--backend', 'agy', '--fallback', 'claude'], { PATH: '/usr/bin:/bin' });
  assert.strictEqual(fallback.value.status, 'selected');
  assert.strictEqual(fallback.value.selected_backend, 'claude');
  assert.ok(fallback.value.reason.includes('missing executable'));
});

test('authorization or model failures never fall back, and CODEX-off blocks codex', () => {
  const failed = select(['--backend', 'codex', '--failure', 'authorization', '--fallback', 'claude'], { PATH: '/usr/bin:/bin', CODEX: 'on' });
  assert.strictEqual(failed.value.status, 'blocked');
  assert.strictEqual(failed.value.selected_backend, 'codex');
  assert.strictEqual(failed.value.fallback, 'none');
  const modelFailed = select(['--backend', 'codex', '--failure', 'model', '--fallback', 'claude'], { PATH: '/usr/bin:/bin', CODEX: 'on' });
  assert.strictEqual(modelFailed.value.status, 'blocked');
  assert.ok(modelFailed.value.reason.includes('model failure'));
  assert.strictEqual(modelFailed.value.fallback, 'none');
  const off = select(['--backend', 'codex'], { PATH: '/usr/bin:/bin', CODEX: 'off' });
  assert.strictEqual(off.value.status, 'blocked');
  assert.ok(off.value.reason.includes('CODEX=off'));
});

test('invalid selector inputs normalize to shipped defaults before dispatch', () => {
  const invalidBackend = select(['--backend', 'wat'], { PATH: '/usr/bin:/bin' });
  assert.strictEqual(invalidBackend.value.status, 'selected');
  assert.strictEqual(invalidBackend.value.selected_backend, 'claude');

  const invalidFallback = select(['--backend', 'agy', '--fallback', 'wat'], { PATH: '/usr/bin:/bin' });
  assert.strictEqual(invalidFallback.value.status, 'blocked');
  assert.strictEqual(invalidFallback.value.reason, 'missing executable: agy');

  const invalidOrder = select(['--backend', 'auto', '--order', 'wat'], { PATH: '/usr/bin:/bin' });
  assert.strictEqual(invalidOrder.value.status, 'selected');
  assert.strictEqual(invalidOrder.value.selected_backend, 'claude');
});

test('session start is silent for defaults, reports overrides, and warns once for invalid values', () => {
  const repo = tempDir('dhpk-session-selector-');
  try {
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const defaults = sessionStart(repo);
    assert.ok(!defaults.stdout.includes('fast_worker_backend='), defaults.stdout);
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { fast_worker_backend: 'agy', fast_worker_fallback: 'none' } } },
    }));
    const override = sessionStart(repo, {}, { source: 'startup', session_id: 'override' });
    assert.ok(override.stdout.includes('fast_worker_backend=agy'), override.stdout);
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({
      pluginConfigs: { 'dhpk@dhpk': { options: { fast_worker_backend: 'wat' } } },
    }));
    const invalid1 = sessionStart(repo, {}, { source: 'startup', session_id: 'invalid' });
    const invalid2 = sessionStart(repo, {}, { source: 'startup', session_id: 'invalid' });
    assert.strictEqual((invalid1.stderr.match(/invalid fast-worker selector/g) || []).length, 1, invalid1.stderr);
    assert.strictEqual((invalid2.stderr.match(/invalid fast-worker selector/g) || []).length, 0, invalid2.stderr);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('all fast-worker report schemas expose the auditable selector contract', () => {
  for (const file of ['fast-worker.md', 'codex-fast-worker.md', 'agy-fast-worker.md']) {
    const prompt = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    for (const field of ['Requested backend:', 'Selected backend:', 'Availability:', 'Fallback reason:', 'Model/effort:', 'Verify:', 'Edited files']) {
      assert.ok(prompt.includes(field), `${file} missing report field: ${field}`);
    }
  }
});

run('fast-worker-selection');
