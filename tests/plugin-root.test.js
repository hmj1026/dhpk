'use strict';

// Hook scripts resolve the plugin root through _lib/plugin-root.sh.
// CLAUDE_PLUGIN_ROOT is process-wide and can name another plugin. A hook must
// then use its own root, so sourcing its libraries does not fail.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = fs.realpathSync(path.join(__dirname, '..'));
const HOOKS = path.join(ROOT, 'scripts', 'hooks');
const LIB = path.join(HOOKS, '_lib', 'plugin-root.sh');

const HOOK_FILES = [
  'pre-bash-dispatch.sh',
  'session-start.sh',
  'session-end.sh',
  'userpromptsubmit-skill-hint.sh',
  'stop-advisory-dispatch.sh',
];

function resolve(envRoot) {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  if (envRoot !== undefined) env.CLAUDE_PLUGIN_ROOT = envRoot;
  const res = spawnSync('bash', ['-c', '. "$1"; dhpk_plugin_root "$2"', '_', LIB, HOOKS], {
    encoding: 'utf8',
    env,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  return res.stdout.trim();
}

function withTmp(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-plugin-root-')));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('unset CLAUDE_PLUGIN_ROOT resolves to the script root', () => {
  assert.strictEqual(resolve(undefined), ROOT);
});

test('CLAUDE_PLUGIN_ROOT naming another plugin falls back to the script root', () => {
  withTmp((other) => {
    fs.mkdirSync(path.join(other, 'scripts', 'hooks'), { recursive: true });
    assert.strictEqual(resolve(other), ROOT);
  });
});

test('CLAUDE_PLUGIN_ROOT holding the dhpk hook library is kept', () => {
  withTmp((dhpk) => {
    const lib = path.join(dhpk, 'scripts', 'hooks', '_lib');
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(path.join(lib, 'session-env.sh'), '');
    assert.strictEqual(resolve(dhpk), dhpk);
  });
});

test('every hook that resolves PLUGIN_ROOT uses the shared resolver', () => {
  for (const name of HOOK_FILES) {
    const text = fs.readFileSync(path.join(HOOKS, name), 'utf8');
    assert.ok(text.includes('_lib/plugin-root.sh'), `${name} must source _lib/plugin-root.sh`);
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT:-$(cd'), `${name} still trusts CLAUDE_PLUGIN_ROOT blindly`);
  }
});

test('session-start runs when CLAUDE_PLUGIN_ROOT names another plugin', () => {
  withTmp((other) => {
    const env = { ...process.env, LC_ALL: 'C', LANG: 'C', CLAUDE_PLUGIN_ROOT: other, CLAUDE_PROJECT_DIR: other };
    const res = spawnSync('bash', [path.join(HOOKS, 'session-start.sh')], {
      cwd: other,
      encoding: 'utf8',
      input: '{}',
      env,
    });
    assert.ok(!/No such file/.test(res.stderr), res.stderr);
    assert.strictEqual(res.status, 0, res.stderr);
  });
});

run('plugin-root');
