'use strict';

// stop-advisory-dispatch.sh parses the project config once in the parent; the
// three advisory blocks inherit the overlay instead of each forking python3
// through load-project-config.sh. Also checks that the overlay still reaches
// the blocks (profile set only in settings.json).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

const HOOK = 'stop-advisory-dispatch.sh';

function writeSettings(repo, options) {
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.claude', 'settings.json'),
    JSON.stringify({ pluginConfigs: { 'dhpk@dhpk': { options } } })
  );
}

// A python3 shim that counts invocations, then runs the real interpreter.
function mkPythonCounter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pycount-'));
  const log = path.join(dir, 'calls.log');
  const real = execFileSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(dir, 'python3'), `#!/bin/sh\necho x >> "${log}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
  return { dir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0) };
}

const noProfileEnv = { profile: null, deleteEnv: ['CLAUDE_PLUGIN_OPTION_HOOK_PROFILE', 'DHPK_HOOK_PROFILE'] };

test('project config is parsed by exactly one python3 call per Stop dispatch', () => {
  const repo = mkRepo();
  const py = mkPythonCounter();
  try {
    writeSettings(repo, { modules: 'js', hook_profile: 'standard' });
    const res = runHook(HOOK, {
      payload: { session_id: 's1' },
      projectDir: repo,
      ...noProfileEnv,
      env: { PATH: `${py.dir}${path.delimiter}${process.env.PATH}` },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(py.calls(), 1);
  } finally {
    rmRepo(repo);
    fs.rmSync(py.dir, { recursive: true, force: true });
  }
});

test('settings.json profile=standard still surfaces module findings and clears the file', () => {
  const repo = mkRepo();
  try {
    writeSettings(repo, { hook_profile: 'standard' });
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, '.module-findings'), 'finding-from-lint\n');
    const res = runHook(HOOK, { payload: {}, projectDir: repo, ...noProfileEnv });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('finding-from-lint'), res.stdout);
    assert.ok(!fs.existsSync(path.join(sess, '.module-findings')));
  } finally {
    rmRepo(repo);
  }
});

test('settings.json hook_profile=minimal suppresses the surfaced findings but clears the file', () => {
  const repo = mkRepo();
  try {
    writeSettings(repo, { hook_profile: 'minimal' });
    const sess = sessionsDir(repo);
    fs.mkdirSync(sess, { recursive: true });
    fs.writeFileSync(path.join(sess, '.module-findings'), 'finding-from-lint\n');
    const res = runHook(HOOK, { payload: {}, projectDir: repo, ...noProfileEnv });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    assert.ok(!fs.existsSync(path.join(sess, '.module-findings')));
  } finally {
    rmRepo(repo);
  }
});

run('stop-advisory-dispatch-config-once');
