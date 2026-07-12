'use strict';

// Coverage for scripts/verify-runner.js — verification loop runner
// (lint -> [typecheck] -> test_unit -> [integration/e2e in full mode]).
// Every test builds its own scratch git repo under a temp dir (never the
// real repo) and redirects the log cache via CLAUDE_VERIFY_CACHE_DIR to a
// temp dir, so nothing is ever written into a real working tree.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-runner.js');

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
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
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
  try {
    const res = runScript(repo, ['--mode', 'fast']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('# Verify (fast)'), res.stdout);
    assert.ok(res.stdout.includes('**lint**') && res.stdout.includes('**test_unit**'), res.stdout);
    assert.ok(!res.stdout.includes('typecheck'), res.stdout);
    assert.ok(!res.stdout.includes('test_integration'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);

    const inRepoCache = path.join(repo, '.claude', 'cache', 'verify');
    assert.ok(!fs.existsSync(inRepoCache), 'expected no .claude/cache dir inside the scratch repo itself');
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('full mode with no scripts at all: everything skipped (vacuously PASS, no steps actually ran)', () => {
  const repo = mkScratchRepo({});
  try {
    const res = runScript(repo, ['--mode', 'full']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('SKIP: script missing'), res.stdout);
    assert.ok(res.stdout.includes('tsconfig missing'), res.stdout);
    assert.ok(res.stdout.includes('- (none)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('full mode: typecheck runs via tsconfig.json fallback when no "typecheck" script exists', () => {
  const repo = mkScratchRepo({ test: 0 });
  try {
    fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{}');
    const res = runScript(repo, ['--mode', 'full']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('**typecheck**'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('full mode: test:integration present but --integration not given is skipped with a clear reason', () => {
  const repo = mkScratchRepo({ 'test:integration': 0 });
  try {
    const res = runScript(repo, ['--mode', 'full']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('file not specified (use --integration <path>)'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

test('a failing lint script is reported as FAIL with a non-zero step code', () => {
  const repo = mkScratchRepo({ lint: 2 });
  try {
    const res = runScript(repo, ['--mode', 'fast']);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('FAIL(2)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    cleanup(res.cacheDir);
  } finally {
    cleanup(repo);
  }
});

run('verify-runner');
