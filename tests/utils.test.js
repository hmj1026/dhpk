'use strict';

// Unit coverage for scripts/lib/utils.js — the shared helper grab-bag used by
// precommit-runner.js / verify-runner.js. Focuses on the pure/sync helpers
// plus a couple of process-spawning ones (runCapture, gitRepoRoot) exercised
// against real, harmless commands.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const utils = require('../scripts/lib/utils');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'utils-test-'));
}

test('safeSlug normalizes whitespace/specials and truncates to 80 chars', () => {
  assert.strictEqual(utils.safeSlug('Hello  World!!'), 'Hello-World');
  assert.strictEqual(utils.safeSlug('  --leading-- '), 'leading');
  assert.strictEqual(utils.safeSlug('').length, 0);
  const long = utils.safeSlug('a'.repeat(200));
  assert.ok(long.length <= 80);
});

test('sha1 is deterministic and matches known digest', () => {
  const h = utils.sha1('hello');
  assert.strictEqual(h, 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  assert.strictEqual(utils.sha1('hello'), h);
});

test('nowISO returns a valid ISO-8601 timestamp', () => {
  const s = utils.nowISO();
  assert.ok(!Number.isNaN(Date.parse(s)), `not parseable: ${s}`);
});

test('ensureDir/writeText/writeJson/appendLog round-trip through the filesystem', () => {
  const tmp = mkTmp();
  try {
    const jsonPath = path.join(tmp, 'nested', 'data.json');
    utils.writeJson(jsonPath, { a: 1 });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), { a: 1 });

    const logPath = path.join(tmp, 'log.txt');
    utils.appendLog(logPath, 'line1\n');
    utils.appendLog(logPath, 'line2\n');
    assert.strictEqual(fs.readFileSync(logPath, 'utf8'), 'line1\nline2\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('appendLog swallows write failures to an unwritable path (no throw)', () => {
  assert.doesNotThrow(() => utils.appendLog('/no/such/dir/log.txt', 'x'));
});

test('tailLinesFromFile returns the last N lines only', () => {
  const tmp = mkTmp();
  try {
    const p = path.join(tmp, 'big.log');
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    fs.writeFileSync(p, lines.join('\n'));
    const tail = utils.tailLinesFromFile(p, 3);
    assert.strictEqual(tail, 'line7\nline8\nline9');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('tailLinesFromFile returns empty string for a missing file', () => {
  assert.strictEqual(utils.tailLinesFromFile('/no/such/file.log'), '');
});

test('stripAnsi removes color escape codes', () => {
  assert.strictEqual(utils.stripAnsi('[32mPASS[0m'), 'PASS');
});

test('testStdoutFilter keeps FAIL/summary lines, drops individual PASS lines', () => {
  assert.strictEqual(utils.testStdoutFilter('  PASS src/foo.test.js'), false);
  assert.strictEqual(utils.testStdoutFilter('  FAIL src/foo.test.js'), true);
  assert.strictEqual(utils.testStdoutFilter('Tests:  1 passed'), true);
  assert.strictEqual(utils.testStdoutFilter('some other line'), true);
});

test('detectPackageManager picks pnpm/yarn/npm based on lockfile presence', () => {
  const tmp = mkTmp();
  try {
    assert.strictEqual(utils.detectPackageManager(tmp), 'npm');
    fs.writeFileSync(path.join(tmp, 'yarn.lock'), '');
    assert.strictEqual(utils.detectPackageManager(tmp), 'yarn');
    fs.writeFileSync(path.join(tmp, 'pnpm-lock.yaml'), '');
    assert.strictEqual(utils.detectPackageManager(tmp), 'pnpm');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readPackageJson/hasScript read scripts and return null/false on missing file', () => {
  const tmp = mkTmp();
  try {
    assert.strictEqual(utils.readPackageJson(tmp), null);
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    const pkg = utils.readPackageJson(tmp);
    assert.ok(utils.hasScript(pkg, 'test'));
    assert.ok(!utils.hasScript(pkg, 'lint'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pmCommand builds the right argv per package manager', () => {
  assert.deepStrictEqual(utils.pmCommand('yarn', 'test'), ['yarn', ['test']]);
  assert.deepStrictEqual(utils.pmCommand('pnpm', 'test'), ['pnpm', ['test']]);
  assert.deepStrictEqual(utils.pmCommand('npm', 'test', ['--foo']), ['npm', ['run', 'test', '--', '--foo']]);
});

test('qualifyCommand prefixes a slash-command with the plugin name once', () => {
  const q1 = utils.qualifyCommand('/do');
  assert.ok(q1.startsWith('/'));
  assert.strictEqual(utils.qualifyCommand(q1), q1, 'already-qualified command must be idempotent');
  assert.strictEqual(utils.qualifyCommand('not-a-command'), 'not-a-command');
});

test('runCapture resolves stdout/code for a real command', async () => {
  const r = await utils.runCapture('node', ['-e', 'console.log("hi")']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), 'hi');
});

test('runCapture resolves code=127 for a nonexistent binary (no throw)', async () => {
  const r = await utils.runCapture('no-such-binary-xyz', []);
  assert.strictEqual(r.code, 127);
});

test('gitRepoRoot resolves to the real repo root when run inside it', async () => {
  const root = await utils.gitRepoRoot();
  assert.ok(root && fs.existsSync(path.join(root, '.git')), `unexpected root: ${root}`);
});

run('utils');
