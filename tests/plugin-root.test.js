'use strict';

// ADR 0038 (#1446): hook scripts resolve their package root from the PHYSICAL
// executing script through _lib/plugin-root.sh. CLAUDE_PLUGIN_ROOT is
// process-wide and never selects the root, even when it holds dhpk files.

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

function withTmp(fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk plugin-root ')));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Minimal package: <pkg>/scripts/hooks/{probe.sh,_lib/{plugin-root.sh,session-env.sh}}.
function makePackage(base, name, { withAsset = true } = {}) {
  const pkg = path.join(base, name);
  const hooks = path.join(pkg, 'scripts', 'hooks');
  fs.mkdirSync(path.join(hooks, '_lib'), { recursive: true });
  fs.copyFileSync(LIB, path.join(hooks, '_lib', 'plugin-root.sh'));
  if (withAsset) fs.writeFileSync(path.join(hooks, '_lib', 'session-env.sh'), '');
  fs.writeFileSync(
    path.join(hooks, 'probe.sh'),
    [
      '#!/usr/bin/env bash',
      '_dhpk_self="$0"',
      'while [ -L "$_dhpk_self" ]; do',
      '    _dhpk_link="$(readlink "$_dhpk_self")"',
      '    case "$_dhpk_link" in /*) _dhpk_self="$_dhpk_link" ;; *) _dhpk_self="$(dirname "$_dhpk_self")/$_dhpk_link" ;; esac',
      'done',
      '_dhpk_hooks_dir="$(cd -P "$(dirname "$_dhpk_self")" && pwd)"',
      '. "$_dhpk_hooks_dir/_lib/plugin-root.sh"',
      'dhpk_plugin_root "$_dhpk_hooks_dir" || exit 1',
      'printf \'%s\\n\' "$PLUGIN_ROOT"',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return pkg;
}

function probe(script, envRoot, args = [], extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.CLAUDE_PLUGIN_ROOT;
  if (envRoot !== undefined) env.CLAUDE_PLUGIN_ROOT = envRoot;
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
}

function foreignPlugin(base) {
  const foreign = path.join(base, 'foreign plugin');
  fs.mkdirSync(path.join(foreign, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(foreign, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'foreign-fixture', version: '999.0.0' })
  );
  return foreign;
}

test('unset CLAUDE_PLUGIN_ROOT resolves to the owning package', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg one');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), undefined);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('empty CLAUDE_PLUGIN_ROOT resolves to the owning package', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), '');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('nonexistent CLAUDE_PLUGIN_ROOT is ignored', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), path.join(base, 'does-not-exist'));
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('foreign plugin in CLAUDE_PLUGIN_ROOT is ignored', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), foreignPlugin(base));
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('another full dhpk copy in CLAUDE_PLUGIN_ROOT is NOT chosen', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg a');
    const copy = makePackage(base, 'pkg b');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), copy);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('symlink invoked from another directory resolves to the physical package', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg real');
    const elsewhere = path.join(base, 'other dir');
    fs.mkdirSync(elsewhere);
    const link = path.join(elsewhere, 'link-probe.sh');
    fs.symlinkSync(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), link);
    const res = spawnSync('bash', [link], {
      cwd: elsewhere,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: makePackage(base, 'decoy') },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('relative symlink chain resolves to the physical package', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'pkg real');
    const elsewhere = path.join(base, 'other dir');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(path.join('..', 'pkg real', 'scripts', 'hooks', 'probe.sh'), path.join(elsewhere, 'hop1.sh'));
    fs.symlinkSync('hop1.sh', path.join(elsewhere, 'hop2.sh'));
    const res = spawnSync('bash', ['hop2.sh'], {
      cwd: elsewhere,
      encoding: 'utf8',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), pkg);
  });
});

test('missing required asset fails with stderr and never searches elsewhere', () => {
  withTmp((base) => {
    const pkg = makePackage(base, 'broken pkg', { withAsset: false });
    const copy = makePackage(base, 'complete copy');
    const res = probe(path.join(pkg, 'scripts', 'hooks', 'probe.sh'), copy);
    assert.notStrictEqual(res.status, 0);
    assert.strictEqual(res.stdout.trim(), '');
    assert.ok(/no dhpk package root/.test(res.stderr), res.stderr);
  });
});

test('unresolvable hooks directory fails with one stderr line', () => {
  for (const dir of ['/nonexistent/dhpk/scripts/hooks', 'hooks', 'a/hooks']) {
    const res = spawnSync('bash', ['-c', '. "$1"; dhpk_plugin_root "$2"', '_', LIB, dir], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0, dir);
    assert.strictEqual(res.stdout.trim(), '');
    assert.strictEqual(res.stderr.trim().split('\n').length, 1, res.stderr);
  }
});

test('empty hooks directory argument fails with stderr', () => {
  const res = spawnSync('bash', ['-c', '. "$1"; dhpk_plugin_root ""', '_', LIB], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.ok(res.stderr.length > 0);
});

test('helper cites ADR 0038 and never reads CLAUDE_PLUGIN_ROOT', () => {
  const text = fs.readFileSync(LIB, 'utf8');
  assert.ok(text.includes('0038'));
  const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(!code.includes('CLAUDE_PLUGIN_ROOT'));
});

test('every hook that resolves PLUGIN_ROOT uses the shared resolver', () => {
  for (const name of HOOK_FILES) {
    const text = fs.readFileSync(path.join(HOOKS, name), 'utf8');
    assert.ok(text.includes('_lib/plugin-root.sh'), `${name} must source _lib/plugin-root.sh`);
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT:-$(cd'), `${name} still trusts CLAUDE_PLUGIN_ROOT blindly`);
    assert.ok(text.includes('dhpk_plugin_root "$_dhpk_hooks_dir"'), `${name} must pass the physical hooks directory`);
  }
});

test('session-start runs when CLAUDE_PLUGIN_ROOT names another plugin', () => {
  withTmp((other) => {
    const env = { ...process.env, LC_ALL: 'C', LANG: 'C', CLAUDE_PLUGIN_ROOT: foreignPlugin(other), CLAUDE_PROJECT_DIR: other };
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

test('session-start invoked through a symlink still finds its package', () => {
  withTmp((base) => {
    const link = path.join(base, 'session-start-link.sh');
    fs.symlinkSync(path.join(HOOKS, 'session-start.sh'), link);
    const env = { ...process.env, LC_ALL: 'C', LANG: 'C', CLAUDE_PLUGIN_ROOT: foreignPlugin(base), CLAUDE_PROJECT_DIR: base };
    const res = spawnSync('bash', [link], { cwd: base, encoding: 'utf8', input: '{}', env });
    assert.ok(!/No such file/.test(res.stderr), res.stderr);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('[dhpk dispatch]'), res.stdout);
  });
});

run('plugin-root');
