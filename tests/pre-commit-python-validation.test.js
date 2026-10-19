'use strict';

// pre-commit-python-validation.sh must pass staged paths and the runner as
// argv. Spaces, quotes, newlines, and shell metacharacters stay path data.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook: runHookRaw, ROOT } = require('./_lib/hookharness');

const HOOK = path.join(ROOT, 'modules/python/hooks/pre-commit-python-validation.sh');
const DELETE_ENV = [
  'CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER',
  'CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER',
  'CLAUDE_PLUGIN_OPTION_RUFF_BIN',
  'CLAUDE_PLUGIN_OPTION_PYTHON_PROJECT_ROOTS',
  'CLAUDE_PLUGIN_OPTION_PYRIGHT_BIN',
  'CLAUDE_PLUGIN_OPTION_MYPY_BIN',
  'ARGV_LOG',
  'STUB_EXIT',
];

function writeStub(binDir, name) {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const code = args.includes('--version') ? 0 : Number(process.env.STUB_EXIT || 0);
fs.appendFileSync(process.env.ARGV_LOG, JSON.stringify({ cwd: process.cwd(), argv: args }) + '\\n');
process.exit(code);
`);
  fs.chmodSync(file, 0o755);
}

function writeRel(repo, rel, content = 'x = 1\n') {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function stage(repo, relPaths) {
  const input = Buffer.concat(relPaths.map((rel) => Buffer.concat([
    Buffer.from(rel, 'utf8'),
    Buffer.from([0]),
  ])));
  const res = spawnSync('git', ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    cwd: repo,
    input,
  });
  if (res.status !== 0) {
    throw new Error(`git add failed: ${res.stderr.toString()}`);
  }
}

function runPyHook(repo, env, command = 'git commit -m test') {
  return runHookRaw(HOOK, {
    payload: { tool_input: { command } },
    cwd: repo,
    projectDir: repo,
    env,
    deleteEnv: DELETE_ENV,
    timeout: 15000,
  });
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function callsNamed(records, name) {
  return records
    .filter((record) => record.argv[0] === name)
    .map((record) => ({ cwd: record.cwd, argv: record.argv }));
}

function sorted(values) {
  return [...values].sort();
}

test('hostile staged paths stay single argv entries and are not executed', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-argv-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  const names = [
    'my file.py',
    'say "hi".py',
    '函式.py',
    'a;b.py',
    '$(touch side-effect).py',
    'line\nbreak.py',
  ];
  try {
    writeStub(binDir, 'ruff');
    writeRel(repo, 'pyproject.toml', '[project]\nname = "demo"\n');
    for (const name of names) writeRel(repo, name);
    writeRel(repo, 'vendor/hidden.py');
    stage(repo, ['pyproject.toml', ...names, 'vendor/hidden.py']);
    const res = runPyHook(repo, {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: '',
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(fs.existsSync(path.join(repo, 'side-effect')), false);
    const expected = names.map((name) => path.join(repo, name));
    const checks = callsNamed(readLog(logPath), 'check');
    assert.strictEqual(checks.length, 1, JSON.stringify(checks));
    assert.deepStrictEqual(sorted(checks[0].argv.slice(1)), sorted(expected));
    const formats = callsNamed(readLog(logPath), 'format');
    assert.strictEqual(formats.length, 1);
    assert.deepStrictEqual(formats[0].argv.slice(0, 2), ['format', '--check']);
    assert.deepStrictEqual(sorted(formats[0].argv.slice(2)), sorted(expected));
    const joined = readLog(logPath).map((record) => record.argv.join('\n')).join('\n');
    assert.strictEqual(joined.includes(`${path.sep}vendor${path.sep}hidden.py`), false);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('project directories that contain a comma or space keep their own files', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-group-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  try {
    writeStub(binDir, 'ruff');
    writeRel(repo, 'proj,a/pyproject.toml', '[project]\nname = "a"\n');
    writeRel(repo, 'proj,a/a.py');
    writeRel(repo, 'proj b/pyproject.toml', '[project]\nname = "b"\n');
    writeRel(repo, 'proj b/b.py');
    stage(repo, ['proj,a/pyproject.toml', 'proj,a/a.py', 'proj b/pyproject.toml', 'proj b/b.py']);
    const res = runPyHook(repo, {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: '',
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const checks = callsNamed(readLog(logPath), 'check');
    assert.deepStrictEqual(checks.map((call) => ({
      cwd: call.cwd,
      argv: call.argv,
    })).sort((a, b) => a.cwd.localeCompare(b.cwd)), [
      { cwd: path.join(repo, 'proj b'), argv: ['check', path.join(repo, 'proj b/b.py')] },
      { cwd: path.join(repo, 'proj,a'), argv: ['check', path.join(repo, 'proj,a/a.py')] },
    ]);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('a supported runner is prepended as words and a missing runner falls back to PATH', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-runner-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  try {
    writeStub(binDir, 'rec-run');
    writeStub(binDir, 'ruff');
    writeRel(repo, 'pyproject.toml', '[project]\nname = "demo"\n');
    writeRel(repo, 'app.py');
    stage(repo, ['pyproject.toml', 'app.py']);
    const base = {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    };
    const withRunner = runPyHook(repo, {
      ...base,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: 'rec-run --frozen',
    });
    assert.strictEqual(withRunner.status, 0, withRunner.stderr);
    const runnerCheck = readLog(logPath).find((record) => record.argv[0] === '--frozen' && record.argv[2] === 'check');
    assert.deepStrictEqual(runnerCheck.argv, ['--frozen', 'ruff', 'check', path.join(repo, 'app.py')]);
    fs.writeFileSync(logPath, '');
    const bare = runPyHook(repo, {
      ...base,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: 'missing-runner --frozen',
    });
    assert.strictEqual(bare.status, 0, bare.stderr);
    const bareCheck = callsNamed(readLog(logPath), 'check');
    assert.deepStrictEqual(bareCheck, [{
      cwd: repo,
      argv: ['check', path.join(repo, 'app.py')],
    }]);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('a runner with shell syntax is rejected and not executed', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-bad-runner-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  try {
    writeStub(binDir, 'ruff');
    writeRel(repo, 'pyproject.toml', '[project]\nname = "demo"\n');
    writeRel(repo, 'app.py');
    stage(repo, ['pyproject.toml', 'app.py']);
    const res = runPyHook(repo, {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: 'ruff; touch side-effect',
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, /PYTHON_RUNNER/);
    assert.strictEqual(fs.existsSync(path.join(repo, 'side-effect')), false);
    assert.deepStrictEqual(callsNamed(readLog(logPath), 'check'), []);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('ruff findings block, internal errors warn, and a missing tool skips', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-policy-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  try {
    writeStub(binDir, 'ruff');
    writeRel(repo, 'pyproject.toml', '[project]\nname = "demo"\n');
    writeRel(repo, 'app.py');
    stage(repo, ['pyproject.toml', 'app.py']);
    const base = {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: '',
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    };
    const findings = runPyHook(repo, { ...base, STUB_EXIT: '1' });
    assert.strictEqual(findings.status, 2, findings.stderr);
    assert.match(findings.stderr, /FAIL: ruff check/);
    const internal = runPyHook(repo, { ...base, STUB_EXIT: '2' });
    assert.strictEqual(internal.status, 0, internal.stderr);
    assert.match(internal.stderr, /WARN: ruff check exited 2/);
    assert.doesNotMatch(internal.stderr, /FAIL: ruff check/);
    const missing = runPyHook(repo, {
      ...base,
      PATH: '/usr/bin:/bin',
      CLAUDE_PLUGIN_OPTION_RUFF_BIN: 'ruff-not-installed',
    });
    assert.strictEqual(missing.status, 0, missing.stderr);
    assert.match(missing.stderr, /ruff not invokable/);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('skip marker bypasses the tool without reading staged paths as code', () => {
  const repo = mkRepo({ prefix: 'dhpk-py-skip-', gitConfig: true });
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-py-bin-'));
  const logPath = path.join(repo, 'argv.log');
  try {
    writeStub(binDir, 'ruff');
    writeRel(repo, 'pyproject.toml', '[project]\nname = "demo"\n');
    writeRel(repo, '$(touch side-effect).py');
    stage(repo, ['pyproject.toml', '$(touch side-effect).py']);
    const res = runPyHook(repo, {
      ARGV_LOG: logPath,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PLUGIN_OPTION_PYTHON_RUNNER: '',
      CLAUDE_PLUGIN_OPTION_PYTHON_TYPECHECKER: 'none',
    }, 'git commit -m "[skip-python-lint] hotfix"');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stderr, /skip-python-lint/);
    assert.deepStrictEqual(readLog(logPath), []);
    assert.strictEqual(fs.existsSync(path.join(repo, 'side-effect')), false);
  } finally {
    rmRepo(repo);
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

run('pre-commit-python-validation');
