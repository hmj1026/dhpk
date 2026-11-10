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
    'tests/content-fingerprint.test.js',
    'tests/content-fingerprint-characterization.test.js',
    'tests/content-fingerprint-tree-merkle.test.js',
    'tests/receipt-primitives.test.js',
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

test('macos-installer job reruns the subset under Apple system python3 after the default run', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflow.split(/\n  macos-installer:\n/)[1].split(/\n  [a-z][a-z0-9-]*:\n/)[0];
  const plain = job.indexOf('run: node tests/_lib/macos-installer-files.js\n');
  const apple = job.indexOf('run: node tests/_lib/macos-installer-files.js --apple-python');
  assert.ok(plain >= 0, 'the default-interpreter subset step must remain');
  assert.ok(apple > plain, 'the Apple python3 rerun must follow the default subset');
});

test('Apple python3 PATH puts a python3 shim to the system interpreter first and cleans up', () => {
  const os = require('node:os');
  const { prepareApplePythonPath } = require('./_lib/macos-installer-files');
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-apple-python-fake-'));
  const fakePython = path.join(fakeDir, 'python3');
  fs.writeFileSync(fakePython, '#!/bin/sh\necho "Python 3.9.6"\n', { mode: 0o755 });
  try {
    const prepared = prepareApplePythonPath({ env: { PATH: '/safe/bin', KEEP: '1' }, pythonPath: fakePython, probeTools: () => true });
    const [first, rest] = [prepared.env.PATH.split(path.delimiter)[0], prepared.env.PATH.split(path.delimiter).slice(1)];
    assert.strictEqual(fs.readlinkSync(path.join(first, 'python3')), fakePython);
    assert.deepStrictEqual(rest, ['/safe/bin']);
    assert.strictEqual(prepared.env.KEEP, '1');
    prepared.cleanup();
    assert.strictEqual(fs.existsSync(first), false, 'cleanup must remove the shim directory');
  } finally {
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('Apple python3 mode fails loudly instead of skipping when the interpreter is unusable', () => {
  const { prepareApplePythonPath } = require('./_lib/macos-installer-files');
  assert.throws(
    () => prepareApplePythonPath({ env: { PATH: '/safe/bin' }, pythonPath: '/nonexistent/python3', probeTools: () => true }),
    /\/nonexistent\/python3 is missing/,
  );
  assert.throws(
    () => prepareApplePythonPath({ env: { PATH: '/safe/bin' }, pythonPath: process.execPath, probeTools: () => false }),
    /Command Line Tools/,
  );
});

test('the Apple python3 rerun passes the shimmed env to the subset and cleans up even on failure', () => {
  const { runUnderApplePython } = require('./_lib/macos-installer-files');
  const events = [];
  const status = runUnderApplePython({
    prepare: () => ({ env: { PATH: '/shim:/safe/bin' }, cleanup: () => events.push('cleanup') }),
    verify: (env) => { events.push(`verify ${env.PATH}`); return 'Python 3.9.6'; },
    runSubset: ({ env }) => { events.push(`subset ${env.PATH}`); return 5; },
    log: (line) => events.push(line),
    logError: (line) => events.push(`error ${line}`),
  });
  assert.strictEqual(status, 5);
  assert.deepStrictEqual(events, [
    'verify /shim:/safe/bin',
    'apple-python: python3 -> /usr/bin/python3 (Python 3.9.6)',
    'subset /shim:/safe/bin',
    'cleanup',
  ]);
});

test('the Apple python3 rerun fails instead of running the subset when resolution is wrong', () => {
  const { runUnderApplePython } = require('./_lib/macos-installer-files');
  const events = [];
  const status = runUnderApplePython({
    prepare: () => ({ env: { PATH: '/shim' }, cleanup: () => events.push('cleanup') }),
    verify: () => { throw new Error("apple-python: python3 resolves to '/opt/other/python3', not /usr/bin/python3"); },
    runSubset: () => { events.push('subset'); return 0; },
    log: (line) => events.push(line),
    logError: (line) => events.push(`error ${line}`),
  });
  assert.strictEqual(status, 1);
  assert.deepStrictEqual(events, ["error apple-python: python3 resolves to '/opt/other/python3', not /usr/bin/python3", 'cleanup']);
});

test('an unknown CLI argument is rejected instead of rerunning the default subset', () => {
  const { main } = require('./_lib/macos-installer-files');
  const events = [];
  const status = main(['--apple-pythn'], {
    runSubset: () => { events.push('subset'); return 0; },
    logError: (line) => events.push(line),
  });
  assert.strictEqual(status, 2);
  assert.deepStrictEqual(events, ['macos-installer-files: unknown argument(s): --apple-pythn']);
});

run('macos-installer-files');
