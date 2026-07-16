'use strict';

// Contract tests for the normalized runtime configuration seam. The loader
// still exports CLAUDE_PLUGIN_OPTION_* for compatibility; these helpers define
// the precedence and value normalization consumed by hooks.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LOADER = path.join(ROOT, 'scripts', 'hooks', '_lib', 'load-project-config.sh');
const RUNTIME = path.join(ROOT, 'scripts', 'hooks', '_lib', 'runtime-config.sh');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-runtime-config-'));
}

function settings(root, options) {
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
    pluginConfigs: { 'dhpk@dhpk': { options } },
  }));
}

function sh(root, command, extraEnv = {}) {
  const env = { ...process.env, ROOT: root, ...extraEnv };
  return spawnSync('bash', ['-c', `source "${LOADER}"; source "${RUNTIME}"; ${command}`], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('config_get applies project-loaded values while preserving a default', () => {
  const root = tmpRoot();
  settings(root, { hook_profile: 'strict' });
  const res = sh(root, 'printf "%s|%s" "$(dhpk_config_get hook_profile standard)" "$(dhpk_config_get missing fallback)"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'strict|fallback');
});

test('config_profile gives one normalized value and honors the one-shot override', () => {
  const root = tmpRoot();
  settings(root, { hook_profile: 'strict' });
  const res = sh(root, 'dhpk_config_profile', { DHPK_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('config_bool accepts common spellings and falls back for invalid input', () => {
  const root = tmpRoot();
  const res = sh(root, [
    'printf "%s|" "$(dhpk_config_bool feature true)"',
    'export CLAUDE_PLUGIN_OPTION_FEATURE=off; printf "%s|" "$(dhpk_config_bool feature true)"',
    'export CLAUDE_PLUGIN_OPTION_FEATURE=maybe; printf "%s" "$(dhpk_config_bool feature false)"',
  ].join('; '));
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'true|false|false');
});

test('config_csv trims blanks and emits a stable comma-separated value', () => {
  const root = tmpRoot();
  settings(root, { modules: [' php ', 'laravel', ''] });
  const res = sh(root, 'dhpk_config_csv modules fallback');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'php,laravel');
});

test('runtime config is safe when no project settings or Python are available', () => {
  const root = tmpRoot();
  const res = sh(root, 'dhpk_config_profile; printf "\\n"; dhpk_config_bool absent false; printf "\\n"; dhpk_config_csv absent fallback; printf "\\n"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), ['standard', 'false', 'fallback']);
});

run('runtime-config');
