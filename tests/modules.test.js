'use strict';

// Coverage for scripts/hooks/_lib/modules.sh: active_modules_list().

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'modules.sh');

function sh(cmd, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  delete env.DHPK_ACTIVE_MODULES;
  delete env.CLAUDE_PLUGIN_OPTION_MODULES;
  Object.assign(env, extraEnv || {});
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000, env });
}

test('DHPK_ACTIVE_MODULES lists modules one per line', () => {
  const res = sh('active_modules_list', { DHPK_ACTIVE_MODULES: 'php,laravel' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), ['php', 'laravel']);
});

test('falls back to CLAUDE_PLUGIN_OPTION_MODULES when DHPK_ACTIVE_MODULES unset', () => {
  const res = sh('active_modules_list', { CLAUDE_PLUGIN_OPTION_MODULES: 'nextjs' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'nextjs');
});

test('trims whitespace and dedupes preserving first-seen order', () => {
  const res = sh('active_modules_list', { DHPK_ACTIVE_MODULES: ' php , php,react ,php ' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), ['php', 'react']);
});

test('blank entries are skipped', () => {
  const res = sh('active_modules_list', { DHPK_ACTIVE_MODULES: 'php,,react,' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(res.stdout.trim().split('\n'), ['php', 'react']);
});

test('no modules set (edge case) prints nothing and returns success', () => {
  const res = sh('active_modules_list; echo "EXIT:$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'EXIT:0');
});

run('modules');
