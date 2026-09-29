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

run('precommit-runner');
