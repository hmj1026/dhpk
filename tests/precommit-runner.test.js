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

function mkScratchRepo(pkgScripts, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-runner-'));
  let ready = false;
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'a@b.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
    if (pkgScripts !== null) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: pkgScripts }, null, 2));
    }
    for (const [relativePath, contents] of Object.entries(files)) {
      const fullPath = path.join(dir, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, contents);
    }
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

test('outside a git repo: reports UNSUPPORTED and exits nonzero without writing cache', () => withScratchArtifacts(({ dir, cacheDir }) => {
  const res = runScript(dir, [], cacheDir);
  assert.strictEqual(res.status, 2, res.stderr);
  assert.ok(res.stdout.includes('UNSUPPORTED'), res.stdout);
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
    assert.ok(!res.stdout.includes('yourchain.test.ts'), res.stdout);

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

test('--dry-run previews package scripts for the selected mode without executing or writing artifacts', () => withScratchArtifacts(({ cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({
      'lint:fix': markerCommand('lint'),
      build: markerCommand('build'),
      test: markerCommand('test'),
    });

    const fast = runScript(repo, ['--mode', 'fast', '--dry-run', '--tail', '80'], cacheDir, { ORDER_MARKER: marker });
    const fastOutput = fast.stdout + '\n' + fast.stderr;
    assert.strictEqual(fast.status, 0, fastOutput);
    assert.match(fastOutput, /DRY.?RUN/i);
    assert.ok(fastOutput.includes('lint_fix'), fastOutput);
    assert.match(fastOutput, /npm\s+run\s+test/i);
    assert.ok(!fastOutput.includes('build'), 'fast preview must omit the build stage');
    assert.ok(!/\bPASS\b/.test(fastOutput), 'a plan must not claim checks passed');
    assert.ok(!fs.existsSync(marker), 'dry-run must not execute configured package scripts');
    assert.ok(!fs.existsSync(cacheDir), 'dry-run must not create its redirected cache');
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'cache')), 'dry-run must not create repository cache directories');

    const full = runScript(repo, ['--mode', 'full', '--dry-run'], cacheDir, { ORDER_MARKER: marker });
    const fullOutput = full.stdout + '\n' + full.stderr;
    assert.strictEqual(full.status, 0, fullOutput);
    assert.match(fullOutput, /DRY.?RUN/i);
    assert.ok(fullOutput.includes('build'), fullOutput);
    assert.match(fullOutput, /npm\s+run\s+test/i);
    assert.ok(!/\bPASS\b/.test(fullOutput), 'a plan must not claim checks passed');
    assert.ok(!fs.existsSync(marker), 'dry-run must not execute scripts in either mode');
    assert.ok(!fs.existsSync(cacheDir));
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'cache')));
  } finally {
    cleanupRepo(repo);
  }
}));

test('--dry-run previews configured stages and resolved working directories without executing them', () => withScratchArtifacts(({ cacheDir, marker }) => {
  let repo;
  try {
    const stages = {
      lint_fix: [{ name: 'backend', cwd: 'backend', command: 'node', args: ['run.js', 'lint_fix:backend'] }],
      build: [{ name: 'frontend', cwd: 'frontend', command: 'node', args: ['run.js', 'build:frontend'] }],
      test_unit: [{ name: 'frontend', cwd: 'frontend', command: 'node', args: ['run.js', 'test_unit:frontend'] }],
    };
    const recordStep = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.env.ORDER_MARKER, process.argv[2] + ':' + process.cwd() + '\\n');",
    ].join('\n');
    repo = mkScratchRepo(null, {
      'precommit.config.json': JSON.stringify({ stages }, null, 2),
      'backend/run.js': recordStep,
      'frontend/run.js': recordStep,
    });

    const res = runScript(repo, ['--mode', 'full', '--dry-run'], cacheDir, { ORDER_MARKER: marker });
    const output = res.stdout + '\n' + res.stderr;
    assert.strictEqual(res.status, 0, output);
    assert.match(output, /DRY.?RUN/i);
    assert.ok(output.includes('lint_fix:backend'), output);
    assert.ok(output.includes('build:frontend'), output);
    assert.ok(output.includes('test_unit:frontend'), output);
    assert.ok(output.includes('node'), output);
    assert.ok(output.includes(path.join(repo, 'backend')), output);
    assert.ok(output.includes(path.join(repo, 'frontend')), output);
    assert.ok(!/\bPASS\b/.test(output), 'a plan must not claim checks passed');
    assert.ok(!fs.existsSync(marker), 'dry-run must not execute explicit configured commands');
    assert.ok(!fs.existsSync(cacheDir));
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'cache')));
  } finally {
    cleanupRepo(repo);
  }
}));

test('no supported checks: reports UNSUPPORTED and exits nonzero', () => withScratchArtifacts(({ dir, cacheDir }) => {
  let repo;
  try {
    repo = mkScratchRepo({});
    const res = runScript(repo, ['--mode', 'fast'], cacheDir);
    assert.strictEqual(res.status, 2, res.stderr);
    assert.ok(res.stdout.includes('skip lint_fix'), res.stdout);
    assert.ok(res.stdout.includes('skip test_unit'), res.stdout);
    assert.ok(res.stdout.includes('no supported commands configured'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ⛔ UNSUPPORTED'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps, []);
    assert.strictEqual(summary.overallPass, false);
    assert.strictEqual(summary.overallStatus, 'UNSUPPORTED');
  } finally {
    cleanupRepo(repo);
  }
}));

test('explicit config runs mixed subproject commands in stage order and from each configured cwd', () => withScratchArtifacts(({ cacheDir, marker }) => {
  let repo;
  try {
    const stages = {
      lint_fix: [
        { name: 'backend', cwd: 'backend', command: 'node', args: ['run.js', 'lint_fix:backend'] },
        { name: 'frontend', cwd: 'frontend', command: 'node', args: ['run.js', 'lint_fix:frontend'] },
      ],
      build: [
        { name: 'frontend', cwd: 'frontend', command: 'node', args: ['run.js', 'build:frontend'] },
      ],
      test_unit: [
        { name: 'backend', cwd: 'backend', command: 'node', args: ['run.js', 'test_unit:backend'] },
        { name: 'frontend', cwd: 'frontend', command: 'node', args: ['run.js', 'test_unit:frontend'] },
      ],
    };
    const recordStep = [
      "const fs = require('node:fs');",
      "fs.appendFileSync(process.env.ORDER_MARKER, process.argv[2] + ':' + process.cwd() + '\\n');",
    ].join('\n');
    repo = mkScratchRepo(null, {
      'precommit.config.json': JSON.stringify({ stages }, null, 2),
      'backend/pyproject.toml': '[project]\nname = "backend-fixture"\n',
      'backend/run.js': recordStep,
      'frontend/package.json': JSON.stringify({ name: 'frontend-fixture', scripts: { build: 'true' } }),
      'frontend/run.js': recordStep,
    });

    const res = runScript(repo, ['--mode', 'full'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('config: precommit.config.json'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ✅ PASS'), res.stdout);
    assert.deepStrictEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), [
      `lint_fix:backend:${path.join(repo, 'backend')}`,
      `lint_fix:frontend:${path.join(repo, 'frontend')}`,
      `build:frontend:${path.join(repo, 'frontend')}`,
      `test_unit:backend:${path.join(repo, 'backend')}`,
      `test_unit:frontend:${path.join(repo, 'frontend')}`,
    ]);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => step.name), [
      'lint_fix:backend', 'lint_fix:frontend', 'build:frontend', 'test_unit:backend', 'test_unit:frontend',
    ]);
    assert.strictEqual(summary.overallStatus, 'PASS');
  } finally {
    cleanupRepo(repo);
  }
}));

test('invalid explicit config fails instead of falling through to package scripts', () => withScratchArtifacts(({ dir, cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({ test: markerCommand('must-not-run') }, {
      'precommit.config.json': '{ invalid json',
    });
    const res = runScript(repo, ['--mode', 'fast'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(res.status, 1, res.stderr);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    assert.ok(!fs.existsSync(marker), 'invalid config must not fall through to package scripts');
    const { summary } = readSummary(cacheDir);
    assert.strictEqual(summary.overallStatus, 'FAIL');
    assert.match(summary.error, /precommit\.config\.json/);
    assert.ok(!res.stdout.includes('runner verdict is UNSUPPORTED'), res.stdout);
  } finally {
    cleanupRepo(repo);
  }
}));

test('--dry-run rejects invalid explicit config without creating a cache or running fallback scripts', () => withScratchArtifacts(({ cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({ test: markerCommand('must-not-run') }, {
      'precommit.config.json': '{ invalid json',
    });
    const res = runScript(repo, ['--mode', 'fast', '--dry-run'], cacheDir, { ORDER_MARKER: marker });
    const output = res.stdout + '\n' + res.stderr;
    assert.notStrictEqual(res.status, 0, output);
    assert.match(output, /precommit\.config\.json/i, output);
    assert.ok(!fs.existsSync(marker), 'invalid config must not fall through to package scripts');
    assert.ok(!fs.existsSync(cacheDir), 'invalid dry-run must not create its redirected cache');
    assert.ok(!fs.existsSync(path.join(repo, '.claude', 'cache')));
  } finally {
    cleanupRepo(repo);
  }
}));

test('a missing configured executable is a failed check, not a pass', () => withScratchArtifacts(({ cacheDir }) => {
  let repo;
  try {
    repo = mkScratchRepo(null, {
      'precommit.config.json': JSON.stringify({
        stages: {
          test_unit: [{ name: 'missing', command: 'dhpk-command-that-does-not-exist', args: [] }],
        },
      }, null, 2),
    });
    const res = runScript(repo, ['--mode', 'fast'], cacheDir);
    assert.strictEqual(res.status, 1, res.stderr);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => [step.name, step.code]), [['test_unit:missing', 127]]);
    assert.strictEqual(summary.overallStatus, 'FAIL');
  } finally {
    cleanupRepo(repo);
  }
}));

test('--help prints usage without running steps, including outside a git repo', () => withScratchArtifacts(({ dir, cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({
      'lint:fix': markerCommand('lint'),
      test: markerCommand('test'),
    });
    const helped = runScript(repo, ['--help'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(helped.status, 0, helped.stderr);
    assert.match(helped.stdout, /Usage: precommit-runner\.js/);
    assert.ok(!fs.existsSync(marker), 'help must not run lint or tests');
    assert.ok(!fs.existsSync(cacheDir), 'help must not create a cache');

    const outside = runScript(dir, ['-h'], cacheDir);
    assert.strictEqual(outside.status, 0, outside.stderr);
    assert.match(outside.stdout, /Usage: precommit-runner\.js/);
    assert.ok(!outside.stdout.includes('Not inside a git repo'));
    assert.ok(!fs.existsSync(cacheDir));
  } finally {
    cleanupRepo(repo);
  }
}));

test('unknown, missing, and invalid arguments exit before any step or cache write', () => withScratchArtifacts(({ dir, cacheDir, marker }) => {
  let repo;
  try {
    repo = mkScratchRepo({
      'lint:fix': markerCommand('lint'),
      test: markerCommand('test'),
    });
    for (const args of [['--bogus'], ['--mode'], ['--mode', 'nope'], ['--tail', 'nope'], ['--tail']]) {
      const res = runScript(repo, args, cacheDir, { ORDER_MARKER: marker });
      assert.notStrictEqual(res.status, 0, `${args.join(' ')} should fail`);
      assert.match(res.stderr, /Usage: precommit-runner\.js/);
      assert.ok(!fs.existsSync(marker), `${args.join(' ')} ran a step`);
      assert.ok(!fs.existsSync(cacheDir), `${args.join(' ')} wrote a cache`);
    }
    const kept = runScript(repo, ['--mode', 'fast'], cacheDir, { ORDER_MARKER: marker });
    assert.strictEqual(kept.status, 0, kept.stderr);
    assert.deepStrictEqual(fs.readFileSync(marker, 'utf8').trim().split('\n'), ['lint', 'test']);
  } finally {
    cleanupRepo(repo);
  }
}));

test('a failing test step is recorded as FAIL with its exit code and overall status', () => withScratchArtifacts(({ dir, cacheDir }) => {
  let repo;
  try {
    repo = mkScratchRepo({ test: 'node -e "process.exit(7)"' });
    const res = runScript(repo, ['--mode', 'fast'], cacheDir);
    assert.strictEqual(res.status, 1, res.stderr);
    assert.ok(res.stdout.includes('FAIL(7)'), res.stdout);
    assert.ok(res.stdout.includes('## Overall: ❌ FAIL'), res.stdout);
    const { summary } = readSummary(cacheDir);
    assert.deepStrictEqual(summary.steps.map((step) => [step.name, step.code]), [['test_unit', 7]]);
    assert.strictEqual(summary.overallPass, false);
    assert.strictEqual(summary.overallStatus, 'FAIL');
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

  test('--help prints usage without scheduling steps, including outside a git repo', () => {
    const repo = mkScratchRepo({ lint: 0, test: 0 });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-help-'));
    let helped;
    let bare;
    try {
      helped = runScript(repo, ['--help']);
      assert.strictEqual(helped.status, 0, helped.stderr);
      assert.match(helped.stdout, /Usage: verify-runner\.js/);
      assert.ok(!helped.stdout.includes('lint ran'));
      assert.deepStrictEqual(fs.readdirSync(helped.cacheDir), []);
      bare = runScript(outside, ['-h']);
      assert.strictEqual(bare.status, 0, bare.stderr);
      assert.match(bare.stdout, /Usage: verify-runner\.js/);
      assert.ok(!bare.stdout.includes('Not inside a git repo'));
      assert.deepStrictEqual(fs.readdirSync(bare.cacheDir), []);
    } finally {
      cleanup(repo, outside, helped && helped.cacheDir, bare && bare.cacheDir);
    }
  });

  test('unknown, missing, and invalid arguments do not start verification', () => {
    const repo = mkScratchRepo({ lint: 0, test: 0 });
    const caches = [];
    try {
      for (const args of [['--bogus'], ['--mode'], ['--mode', 'sideways'], ['--tail', 'lots'], ['--e2e']]) {
        const res = runScript(repo, args);
        caches.push(res.cacheDir);
        assert.notStrictEqual(res.status, 0, args.join(' '));
        assert.match(res.stderr, /Usage: verify-runner\.js/);
        assert.ok(!res.stdout.includes('lint ran'), args.join(' '));
        assert.deepStrictEqual(fs.readdirSync(res.cacheDir), [], args.join(' '));
      }
      const kept = runScript(repo, ['fast']);
      caches.push(kept.cacheDir);
      assert.strictEqual(kept.status, 0, kept.stderr);
      assert.ok(kept.stdout.includes('# Verify (fast)'), kept.stdout);
    } finally {
      cleanup(repo, ...caches);
    }
  });

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
