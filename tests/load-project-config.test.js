'use strict';

// Coverage for scripts/hooks/_lib/load-project-config.sh: overlays project
// pluginConfigs.dhpk@dhpk.options.* onto CLAUDE_PLUGIN_OPTION_* env vars, with
// settings.local.json preferred over settings.json, plus the DHPK_HOOK_PROFILE
// one-shot override.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'load-project-config.sh');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-lpc-'));
}

function writeSettings(root, filename, options) {
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const cfg = { pluginConfigs: { 'dhpk@dhpk': { options } } };
  fs.writeFileSync(path.join(root, '.claude', filename), JSON.stringify(cfg));
}

function sh(root, cmd, extraEnv) {
  const env = { ...process.env, ROOT: root, ...(extraEnv || {}) };
  delete env.DHPK_HOOK_PROFILE;
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000, env });
}

test('exports CLAUDE_PLUGIN_OPTION_* from settings.local.json options', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { hook_profile: 'minimal' });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('settings.local.json takes precedence over settings.json', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.json', { hook_profile: 'full' });
  writeSettings(root, 'settings.local.json', { hook_profile: 'minimal' });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

test('array option is joined with commas', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { modules: ['php', 'laravel'] });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_MODULES"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'php,laravel');
});

test('boolean option is converted to lowercase true/false string', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { learning_db_enabled: true });
  const res = sh(root, 'echo "$CLAUDE_PLUGIN_OPTION_LEARNING_DB_ENABLED"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'true');
});

test('no settings file present (edge case) leaves env untouched, no error', () => {
  const root = tmpRoot();
  const res = sh(root, 'echo "OUT:[${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-unset}]"; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('OUT:[unset]'), res.stdout);
});

test('DHPK_HOOK_PROFILE env one-shot override wins over settings file', () => {
  const root = tmpRoot();
  writeSettings(root, 'settings.local.json', { hook_profile: 'full' });
  const env = { ...process.env, ROOT: root, DHPK_HOOK_PROFILE: 'minimal' };
  const res = spawnSync('bash', ['-c', `source "${LIB}"; echo "$CLAUDE_PLUGIN_OPTION_HOOK_PROFILE"`], {
    encoding: 'utf8',
    timeout: 10000,
    env,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'minimal');
});

run('load-project-config');
