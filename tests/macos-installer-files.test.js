'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { MACOS_INSTALLER_FILES, runMacosInstallerSubset } = require('./_lib/macos-installer-files');

const ROOT = path.join(__dirname, '..');

test('Darwin installer subset lists existing files and private-tmp env for installer smoke', () => {
  const files = MACOS_INSTALLER_FILES.map((entry) => entry.file);
  assert.deepStrictEqual(files, [
    'tests/physical-tmpdir.test.js',
    'tests/macos-installer-darwin.test.js',
    'tests/install-codex-skills.test.js',
    'tests/cli-dispatch-launcher.test.js',
    'tests/run-bounded-node-test.test.js',
    'tests/install-cursor-harness.test.js',
  ]);
  for (const entry of MACOS_INSTALLER_FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, entry.file)), entry.file);
  }
  const tmpdirFiles = MACOS_INSTALLER_FILES
    .filter((entry) => entry.env && entry.env.TMPDIR === '/private/tmp')
    .map((entry) => entry.file);
  assert.deepStrictEqual(tmpdirFiles, [
    'tests/macos-installer-darwin.test.js',
  ]);
});

test('macos-installer job runs the shared installer subset list', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflow.split(/\n  macos-installer:\n/)[1];
  assert.ok(job, 'ci.yml must define macos-installer');
  const untilLint = job.split(/\n  lint:\n/)[0];
  assert.match(untilLint, /run: node tests\/_lib\/macos-installer-files\.js/);
  assert.doesNotMatch(untilLint, /run: node tests\/install-codex-skills\.test\.js/);
});

test('macOS runner preserves order and environment overrides and stops on failure', () => {
  const calls = [];
  const privateTmp = MACOS_INSTALLER_FILES.find((entry) => entry.env && entry.env.TMPDIR === '/private/tmp');
  assert.ok(privateTmp, 'Darwin subset must pin /private/tmp for installer smoke');
  const result = runMacosInstallerSubset({
    execPath: '/node',
    cwd: '/checkout',
    env: { PATH: '/safe/bin', TMPDIR: '/parent/tmp', TEST_MARKER: 'keep' },
    spawn(execPath, args, options) {
      calls.push({ execPath, args, options });
      return { status: args[0] === privateTmp.file ? 7 : 0 };
    },
  });

  assert.strictEqual(result, 7);
  const stopAt = MACOS_INSTALLER_FILES.findIndex((entry) => entry.file === privateTmp.file);
  assert.deepStrictEqual(
    calls.map((call) => call.args[0]),
    MACOS_INSTALLER_FILES.slice(0, stopAt + 1).map((entry) => entry.file),
  );
  for (const call of calls) {
    assert.strictEqual(call.execPath, '/node');
    assert.strictEqual(call.args.length, 1);
    assert.deepStrictEqual(call.options.stdio, 'inherit');
    assert.strictEqual(call.options.cwd, '/checkout');
    assert.strictEqual(call.options.env.PATH, '/safe/bin');
    assert.strictEqual(call.options.env.TEST_MARKER, 'keep');
  }
  assert.strictEqual(calls[0].options.env.TMPDIR, '/parent/tmp');
  assert.strictEqual(calls[stopAt].options.env.TMPDIR, '/private/tmp');
});

run('macos-installer-files');
