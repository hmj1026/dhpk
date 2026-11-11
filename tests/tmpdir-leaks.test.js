'use strict';

// Issue #1322: tests must not leave dhpk-* directories in the shared temp root.
// The runner gives every test file its own TMPDIR and reports what remains.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { leakPrefix, scanLeaks, formatLeakReport } = require('./run-all');
const { makeTempDir } = require('./_lib/temp-dir');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-leakcheck-'));
}

test('leakPrefix strips the six-character mkdtemp suffix', () => {
  assert.strictEqual(leakPrefix('dhpk-ldb-aB3xYz'), 'dhpk-ldb-');
  assert.strictEqual(leakPrefix('.dhpk-lock-Q1w2E3'), '.dhpk-lock-');
});

test('leakPrefix keeps names without a random suffix intact', () => {
  assert.strictEqual(leakPrefix('dhpk-fixed'), 'dhpk-fixed');
});

test('scanLeaks groups leftovers by prefix with counts', () => {
  const root = scratch();
  try {
    for (const name of ['dhpk-a-111111', 'dhpk-a-222222', 'dhpk-b-333333', 'unrelated']) {
      fs.mkdirSync(path.join(root, name));
    }
    assert.deepStrictEqual(scanLeaks(root), { 'dhpk-a-': 2, 'dhpk-b-': 1, unrelated: 1 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanLeaks ignores the Node runtime compile cache', () => {
  const root = scratch();
  try {
    fs.mkdirSync(path.join(root, 'node-compile-cache'));
    assert.deepStrictEqual(scanLeaks(root), {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanLeaks reports an empty or missing root as clean', () => {
  const root = scratch();
  try {
    assert.deepStrictEqual(scanLeaks(root), {});
    assert.deepStrictEqual(scanLeaks(path.join(root, 'missing')), {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formatLeakReport names the file and each prefix, or is empty when clean', () => {
  assert.strictEqual(formatLeakReport('x.test.js', {}), '');
  const text = formatLeakReport('x.test.js', { 'dhpk-a-': 2 });
  assert.ok(text.includes('x.test.js'));
  assert.ok(text.includes('dhpk-a- x2'));
});

test('makeTempDir creates a dir under os.tmpdir() and removes it on exit', () => {
  const { spawnSync } = require('node:child_process');
  const root = scratch();
  try {
    const code = `
      const { makeTempDir } = require(${JSON.stringify(path.join(__dirname, '_lib', 'temp-dir'))});
      const dir = makeTempDir('dhpk-helper-');
      require('node:fs').writeFileSync(require('node:path').join(dir, 'f'), 'x');
      console.log(dir);`;
    const result = spawnSync(process.execPath, ['-e', code], {
      env: { ...process.env, TMPDIR: root }, encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const printed = result.stdout.trim();
    assert.ok(printed.startsWith(root), `created under TMPDIR: ${printed}`);
    assert.deepStrictEqual(fs.readdirSync(root), [], 'directory removed at process exit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('makeTempDir returns a real directory with the requested prefix', () => {
  const dir = makeTempDir('dhpk-prefix-check-');
  assert.ok(fs.statSync(dir).isDirectory());
  assert.ok(path.basename(dir).startsWith('dhpk-prefix-check-'));
});

test('sweepOnExit removes product-created dirs with the prefix but keeps older and unrelated ones', () => {
  const { spawnSync } = require('node:child_process');
  const root = scratch();
  try {
    const old = path.join(root, 'dhpk-sweep-old111');
    fs.mkdirSync(old);
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(old, past, past);
    // birthtime cannot be back-dated portably, so the older dir is created by a
    // sibling process that exits before the sweeping process starts.
    const code = `
      const fs = require('node:fs'); const path = require('node:path');
      const { sweepOnExit } = require(${JSON.stringify(path.join(__dirname, '_lib', 'temp-dir'))});
      sweepOnExit(['dhpk-sweep-']);
      fs.mkdirSync(path.join(process.env.TMPDIR, 'dhpk-sweep-new111'));
      fs.mkdirSync(path.join(process.env.TMPDIR, 'other-new111'));`;
    const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TMPDIR: root }, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(fs.readdirSync(root).sort(), ['dhpk-sweep-old111', 'other-new111']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runner isolation hands each file a private TMPDIR and reports its leftovers', () => {
  const { beginFileTmpdir, endFileTmpdir } = require('./run-all');
  const root = scratch();
  try {
    const bare = beginFileTmpdir({}, 0);
    assert.strictEqual(bare.dir, null, 'no DHPK_TEST_TMP_ROOT means no isolation');
    const first = beginFileTmpdir({ DHPK_TEST_TMP_ROOT: root }, 0);
    const second = beginFileTmpdir({ DHPK_TEST_TMP_ROOT: root }, 1);
    assert.notStrictEqual(first.env.TMPDIR, second.env.TMPDIR);
    fs.mkdirSync(path.join(first.env.TMPDIR, 'dhpk-leaky-abc123'));
    assert.deepStrictEqual(endFileTmpdir(first), { 'dhpk-leaky-': 1 });
    assert.deepStrictEqual(endFileTmpdir(second), {});
    assert.deepStrictEqual(fs.readdirSync(root), [], 'per-file dirs are removed afterwards');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('tmpdir-leaks');
