'use strict';

// Behavioral coverage for the precommit runner. Each invocation uses a scratch
// git repository and a redirected cache, with both removed in finally blocks.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'precommit', 'scripts', 'precommit-runner.js');

function mkScratchRepo(pkgScripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-runner-'));
  let ready = false;
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'a@b.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: pkgScripts }, null, 2));
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    ready = true;
    return dir;
  } finally {
    if (!ready) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withScratchArtifacts(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-artifacts-'));
  try {
    return callback({
      dir,
      cacheDir: path.join(dir, 'cache'),
      marker: path.join(dir, 'steps.txt'),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runScript(cwd, args, cacheDir, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir, ...extraEnv };
  return spawnSync('node', [SCRIPT, ...(args || [])], { cwd, env, encoding: 'utf8', timeout: 20000 });
}

function cleanupRepo(repo) {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
}

function findFile(root, name) {
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

function readSummary(cacheDir) {
  const summaryPath = findFile(cacheDir, 'summary.json');
  assert.ok(summaryPath, `summary.json not found under redirected cache ${cacheDir}`);
  return { summaryPath, summary: JSON.parse(fs.readFileSync(summaryPath, 'utf8')) };
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function markerCommand(label, extra = '') {
  const script = `require('node:fs').appendFileSync(process.env.ORDER_MARKER, '${label}\\n');${extra}`;
  return `node -e ${shellQuote(script)}`;
}

test('outside a git repo: prints "Not inside a git repo" and exits 0', () => withScratchArtifacts(({ dir, cacheDir }) => {
  const res = runScript(dir, [], cacheDir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('Not inside a git repo'), res.stdout);
  assert.ok(!fs.existsSync(cacheDir), 'runner must not create its cache before discovering a git repo');
}));

test('fast mode executes lint then test and writes structured PASS output only to the redirected cache', () => withScratchArtifacts(({ dir, cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({
      'lint:fix': markerCommand('lint', "require('node:fs').appendFileSync('package.json', '\\n');"),
      test: markerCommand('test'),
    });
    const res = runScript(repo, ['--mode', 'fast'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['lint', 'test']);
    assert.ok(res.stdout.includes('# Precommit (fast)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);

    const { summaryPath, summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => [step.name, step.code]), [['lint_fix', 0], ['test_unit', 0]]);
    assert.strictEqual(summary.mode, 'fast');
    assert.strictEqual(summary.overallPass, true);
    assert.ok(!Object.hasOwn(summary, 'error'));
    assert.ok(summary.statusBefore && !summary.statusBefore.includes('package.json'));
    assert.ok(summary.statusAfter.includes('package.json'));
    assert.deepStrictEqual(summary.changedAfterLintFix, ['package.json']);
    assert.ok(fs.existsSync(path.join(path.dirname(summaryPath), 'runner.log')));
    assert.ok(fs.existsSync(path.join(path.dirname(summaryPath), 'summary.md')));
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'cache', 'precommit')), 'logs must use the redirected cache');
  } finally {
    cleanupRepo(repo);
  }
}));

test('full mode runs build before test and reports an absent lint script as skipped', () => withScratchArtifacts(({ dir, cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({ build: markerCommand('build'), test: markerCommand('test') });
    const res = runScript(repo, ['--mode', 'full'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['build', 'test']);
    assert.ok(res.stdout.includes('# Precommit (full)'), res.stdout);
    assert.ok(res.stdout.includes('skip lint_fix'), res.stdout);
    assert.ok(res.stdout.includes('**build**'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => [step.name, step.code]), [['build', 0], ['test_unit', 0]]);
    assert.strictEqual(summary.overallPass, true);
  } finally {
    cleanupRepo(repo);
  }
}));

test('no matching scripts: all steps are skipped and structured overall status is FAIL', () => withScratchArtifacts(({ dir, cacheDir }) => {
  let repo;
  try {
    repo = mkScratchRepo({});
    const res = runScript(repo, ['--mode', 'fast'], cacheDir);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('skip lint_fix'), res.stdout);
    assert.ok(res.stdout.includes('skip test_unit'), res.stdout);
    assert.ok(res.stdout.includes('(no steps executed)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps, []);
    assert.strictEqual(summary.overallPass, false);
  } finally {
    cleanupRepo(repo);
  }
}));

test('a failing test step is recorded as FAIL with its exit code and overall status', () => withScratchArtifacts(({ dir, cacheDir }) => {
  let repo;
  try {
    repo = mkScratchRepo({ test: 'node -e "process.exit(7)"' });
    const res = runScript(repo, ['--mode', 'fast'], cacheDir);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('FAIL(7)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => [step.name, step.code]), [['test_unit', 7]]);
    assert.strictEqual(summary.overallPass, false);
  } finally {
    cleanupRepo(repo);
  }
}));

{
  // Collected cases from tests/verify-runner.test.js.
  // Coverage for skills/repo-verify/scripts/verify-runner.js — verification loop runner
  // (lint -> [typecheck] -> test_unit -> [integration/e2e in full mode]).
  // Every test builds its own scratch git repo under a temp dir (never the
  // real repo) and redirects the log cache via CLAUDE_VERIFY_CACHE_DIR to a
  // temp dir, so nothing is ever written into a real working tree.

  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { spawnSync, execFileSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'skills', 'repo-verify', 'scripts', 'verify-runner.js');

  // `npm run <script> -- <extra args>` appends extra args to the script's argv.
  // `node -e "..." --some-flag` (no `--` separator) makes node itself choke on
  // the unrecognized flag, so fixture scripts point at a stub .js file that
  // ignores argv entirely instead of an inline `node -e` string.
  function mkScratchRepo(scriptExitCodes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-runner-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'a@b.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });

    const scripts = {};
    for (const [name, exitCode] of Object.entries(scriptExitCodes)) {
      const stub = `${name.replace(/[^a-z0-9]+/gi, '_')}_stub.js`;
      fs.writeFileSync(
        path.join(dir, stub),
        `console.log('${name} ran');\nprocess.exit(${exitCode});\n`
      );
      scripts[name] = `node ${stub}`;
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts }, null, 2));
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    return dir;
  }

  function runScript(cwd, args) {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cache-'));
    const env = { ...process.env, CLAUDE_VERIFY_CACHE_DIR: cacheDir };
    const res = spawnSync('node', [SCRIPT, ...(args || [])], { cwd, env, encoding: 'utf8', timeout: 20000 });
    res.cacheDir = cacheDir;
    return res;
  }

  function cleanup(...dirs) {
    for (const d of dirs) if (d) fs.rmSync(d, { recursive: true, force: true });
  }

  test('outside a git repo: prints "Not inside a git repo" and exits 0', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-nongit-'));
    const res = runScript(tmp);
    try {
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('Not inside a git repo'), res.stdout);
    } finally {
      cleanup(tmp, res.cacheDir);
    }
  });

  test('fast mode with lint + test scripts: skips typecheck/integration/e2e entirely', () => {
    const repo = mkScratchRepo({ lint: 0, test: 0 });
    let cacheDir;
    try {
      const res = runScript(repo, ['--mode', 'fast']);
      cacheDir = res.cacheDir;
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('# Verify (fast)'), res.stdout);
      assert.ok(res.stdout.includes('**lint**') && res.stdout.includes('**test_unit**'), res.stdout);
      assert.ok(!res.stdout.includes('typecheck'), res.stdout);
      assert.ok(!res.stdout.includes('test_integration'), res.stdout);
      assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);

      const inRepoCache = path.join(repo, '.claude', 'cache', 'verify');
      assert.ok(!fs.existsSync(inRepoCache), 'expected no .claude/cache dir inside the scratch repo itself');
    } finally {
      cleanup(repo, cacheDir);
    }
  });

  test('full mode with no scripts at all: everything skipped (vacuously PASS, no steps actually ran)', () => {
    const repo = mkScratchRepo({});
    let cacheDir;
    try {
      const res = runScript(repo, ['--mode', 'full']);
      cacheDir = res.cacheDir;
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('SKIP: script missing'), res.stdout);
      assert.ok(res.stdout.includes('tsconfig missing'), res.stdout);
      assert.ok(res.stdout.includes('- (none)'), res.stdout);
      assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);
    } finally {
      cleanup(repo, cacheDir);
    }
  });

  test('full mode: typecheck fallback uses a local compiler without network install', () => {
    const repo = mkScratchRepo({ test: 0 });
    let cacheDir;
    try {
      fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{}');
      const tsc = path.join(repo, 'node_modules', '.bin', 'tsc');
      fs.mkdirSync(path.dirname(tsc), { recursive: true });
      fs.writeFileSync(tsc, '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o755 });
      const res = runScript(repo, ['--mode', 'full']);
      cacheDir = res.cacheDir;
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('npx --no-install tsc --noEmit'), res.stdout);
      assert.ok(res.stdout.includes('**typecheck**'), res.stdout);
    } finally {
      cleanup(repo, cacheDir);
    }
  });

  test('full mode: test:integration present but --integration not given is skipped with a clear reason', () => {
    const repo = mkScratchRepo({ 'test:integration': 0 });
    let cacheDir;
    try {
      const res = runScript(repo, ['--mode', 'full']);
      cacheDir = res.cacheDir;
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('file not specified (use --integration <path>)'), res.stdout);
    } finally {
      cleanup(repo, cacheDir);
    }
  });

  test('a failing lint script is reported as FAIL with a non-zero step code', () => {
    const repo = mkScratchRepo({ lint: 2 });
    let cacheDir;
    try {
      const res = runScript(repo, ['--mode', 'fast']);
      cacheDir = res.cacheDir;
      assert.strictEqual(res.status, 0, res.stderr);
      assert.ok(res.stdout.includes('FAIL(2)'), res.stdout);
      assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    } finally {
      cleanup(repo, cacheDir);
    }
  });
}

run('precommit-runner');
