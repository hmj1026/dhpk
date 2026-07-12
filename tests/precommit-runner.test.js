'use strict';

// Coverage for scripts/precommit-runner.js — package-manager-agnostic
// precommit runner (lint:fix -> [build] -> test:unit). Every test builds its
// own scratch git repo under a temp dir (never the real repo) and redirects
// the log cache via CLAUDE_PRECOMMIT_CACHE_DIR to a temp dir too, so nothing
// is ever written into a real working tree.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'precommit-runner.js');

function mkScratchRepo(pkgScripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-runner-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'a@b.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: pkgScripts }, null, 2));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function runScript(cwd, args) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-cache-'));
  const env = { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir };
  const res = spawnSync('node', [SCRIPT, ...(args || [])], { cwd, env, encoding: 'utf8', timeout: 20000 });
  res.cacheDir = cacheDir;
  return res;
}

function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

test('outside a git repo: prints "Not inside a git repo" and exits 0', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-nongit-'));
  const res = runScript(tmp);
  try {
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('Not inside a git repo'), res.stdout);
  } finally {
    cleanup(tmp, res.cacheDir);
  }
});

test('fast mode with lint:fix + test scripts: runs both steps and reports overall PASS', () => {
  const repo = mkScratchRepo({
    'lint:fix': "node -e \"console.log('linted')\"",
    test: "node -e \"console.log('tested')\"",
  });
  try {
    const res = runScript(repo, ['--mode', 'fast']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('# Precommit (fast)'), res.stdout);
    assert.ok(res.stdout.includes('lint_fix') && res.stdout.includes('test_unit'), res.stdout);
    assert.ok(!res.stdout.includes('**build**'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);

    const summaryPath = path.join(repo, '.claude', 'cache', 'precommit');
    // logs should NOT land in the real repo tree; they should be under the
    // redirected CLAUDE_PRECOMMIT_CACHE_DIR instead.
    assert.ok(!fs.existsSync(summaryPath), 'expected no .claude/cache dir inside the scratch repo itself');
    assert.ok(fs.existsSync(res.cacheDir), 'expected logs under the redirected cache dir');
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('full mode adds the build step when a "build" script exists', () => {
  const repo = mkScratchRepo({
    build: "node -e \"console.log('built')\"",
    test: "node -e \"console.log('tested')\"",
  });
  try {
    const res = runScript(repo, ['--mode', 'full']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('# Precommit (full)'), res.stdout);
    assert.ok(res.stdout.includes('**build**'), res.stdout);
    assert.ok(res.stdout.includes('skip lint_fix'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('no matching scripts at all: all steps skipped, no steps executed, overall FAIL', () => {
  const repo = mkScratchRepo({});
  try {
    const res = runScript(repo, ['--mode', 'fast']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('skip lint_fix'), res.stdout);
    assert.ok(res.stdout.includes('skip test_unit'), res.stdout);
    assert.ok(res.stdout.includes('(no steps executed)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('a failing test script is reported as FAIL with a non-zero step code', () => {
  const repo = mkScratchRepo({ test: 'node -e "process.exit(1)"' });
  try {
    const res = runScript(repo, ['--mode', 'fast']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('FAIL(1)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

run('precommit-runner');
