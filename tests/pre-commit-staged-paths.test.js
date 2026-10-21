'use strict';

// JS, PHP, and Swift pre-commit hooks must read staged names as NUL records.
// core.quotePath quoting must not drop a non-ASCII path or split a newline.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');

const ROOT = path.join(__dirname, '..');
const HOOKS = {
  js: path.join(ROOT, 'modules/js/hooks/pre-commit-js-validation.sh'),
  php: path.join(ROOT, 'modules/php-7.4/hooks/pre-commit-php-validation.sh'),
  swift: path.join(ROOT, 'modules/xcode-tooling/hooks/pre-commit-swift-build.sh'),
};

function writeStub(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.ARGV_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(1);
`);
  fs.chmodSync(file, 0o755);
}

function writeRel(repo, rel, content = 'x\n') {
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
  if (res.status !== 0) throw new Error(`git add failed: ${res.stderr.toString()}`);
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function withRepo(fn) {
  const repo = mkRepo({ prefix: 'dhpk-staged-nul-', gitConfig: true });
  spawnSync('git', ['config', 'core.quotePath', 'true'], { cwd: repo });
  const logPath = path.join(repo, 'calls.log');
  try {
    return fn(repo, logPath);
  } finally {
    rmRepo(repo);
  }
}

function runModule(hook, repo, logPath, env) {
  return runHook(hook, {
    payload: { tool_name: 'Bash', tool_input: { command: 'git commit -m audit' } },
    cwd: repo,
    projectDir: repo,
    env: { ARGV_LOG: logPath, ...env },
    timeout: 15000,
  });
}

test('JS gate runs for ASCII and quoted non-ASCII frontend files', () => {
  withRepo((repo, logPath) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-js-bin-'));
    try {
      writeStub(path.join(bin, 'npm'));
      writeRel(repo, 'node_modules/.keep', '');
      for (const rel of ['src/app/plain.js', 'src/app/日本.js', 'src/app/say "hi".js', 'src/app/line\nbreak.js']) {
        writeRel(repo, rel, 'export const n = 1;\n');
        stage(repo, [rel]);
        const res = runModule(HOOKS.js, repo, logPath, { PATH: `${bin}:${process.env.PATH}` });
        assert.strictEqual(res.status, 2, `${JSON.stringify(rel)} ${res.status} ${res.stderr}`);
        spawnSync('git', ['rm', '-q', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], {
          cwd: repo,
          input: Buffer.concat([Buffer.from(rel, 'utf8'), Buffer.from([0])]),
        });
      }
      const calls = readLog(logPath);
      assert.strictEqual(calls.length, 4, JSON.stringify(calls));
      for (const argv of calls) assert.deepStrictEqual(argv.slice(0, 3), ['run', '--silent', 'lint']);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

test('JS gate stays skipped when no frontend file is staged', () => {
  withRepo((repo, logPath) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-js-bin-'));
    try {
      writeStub(path.join(bin, 'npm'));
      writeRel(repo, 'node_modules/.keep', '');
      writeRel(repo, 'README.md', 'notes\n');
      stage(repo, ['README.md']);
      const res = runModule(HOOKS.js, repo, logPath, { PATH: `${bin}:${process.env.PATH}` });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(readLog(logPath), []);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

test('PHP gate receives ASCII, non-ASCII, quote, and newline paths as whole argv', () => {
  withRepo((repo, logPath) => {
    writeStub(path.join(repo, 'vendor/bin/phpstan'));
    writeRel(repo, 'phpstan.neon', 'parameters:\n');
    const names = ['src/plain.php', 'src/日本.php', 'src/say "hi".php', 'src/line\nbreak.php'];
    for (const rel of names) writeRel(repo, rel, '<?php\n');
    writeRel(repo, 'vendor/hidden.php', '<?php\n');
    stage(repo, [...names, 'vendor/hidden.php']);
    const res = runModule(HOOKS.php, repo, logPath);
    assert.strictEqual(res.status, 2, res.stderr);
    const calls = readLog(logPath);
    assert.strictEqual(calls.length, 1, JSON.stringify(calls));
    for (const rel of names) assert.ok(calls[0].includes(rel), JSON.stringify(calls[0]));
    assert.ok(!calls[0].includes('vendor/hidden.php'));
    assert.strictEqual(calls[0].filter((arg) => arg.includes('\n')).length, 1);
  });
});

test('PHP gate stays skipped when only vendor PHP is staged', () => {
  withRepo((repo, logPath) => {
    writeStub(path.join(repo, 'vendor/bin/phpstan'));
    writeRel(repo, 'phpstan.neon', 'parameters:\n');
    writeRel(repo, 'vendor/hidden.php', '<?php\n');
    stage(repo, ['vendor/hidden.php']);
    const res = runModule(HOOKS.php, repo, logPath);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(readLog(logPath), []);
  });
});

test('Swift gate runs for ASCII, non-ASCII, and newline package files', () => {
  withRepo((repo, logPath) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-swift-bin-'));
    try {
      writeStub(path.join(bin, 'swift'));
      writeRel(repo, 'Package.swift', '// swift-tools-version:5.9\n');
      stage(repo, ['Package.swift']);
      spawnSync('git', ['commit', '-q', '-m', 'package'], { cwd: repo });
      for (const rel of ['Sources/plain.swift', 'Sources/日本.swift', 'Sources/line\nbreak.swift']) {
        writeRel(repo, rel, 'let n = 1\n');
        stage(repo, [rel]);
        const res = runModule(HOOKS.swift, repo, logPath, {
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_SKIP_TESTS: 'true',
        });
        assert.strictEqual(res.status, 2, `${JSON.stringify(rel)} ${res.status} ${res.stderr}`);
        spawnSync('git', ['rm', '-q', '--cached', '--pathspec-from-file=-', '--pathspec-file-nul'], {
          cwd: repo,
          input: Buffer.concat([Buffer.from(rel, 'utf8'), Buffer.from([0])]),
        });
      }
      const calls = readLog(logPath);
      assert.strictEqual(calls.length, 3, JSON.stringify(calls));
      for (const argv of calls) assert.deepStrictEqual(argv, ['build']);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

test('Swift gate stays skipped when no Swift file is staged', () => {
  withRepo((repo, logPath) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-swift-bin-'));
    try {
      writeStub(path.join(bin, 'swift'));
      writeRel(repo, 'Package.swift', '// swift-tools-version:5.9\n');
      writeRel(repo, 'README.md', 'notes\n');
      stage(repo, ['README.md']);
      const res = runModule(HOOKS.swift, repo, logPath, {
        PATH: `${bin}:${process.env.PATH}`,
        CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_SKIP_TESTS: 'true',
      });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.deepStrictEqual(readLog(logPath), []);
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });
});

run('pre-commit-staged-paths');
