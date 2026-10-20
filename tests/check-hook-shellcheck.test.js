'use strict';

// Bounded hook ShellCheck gate: required CI fails closed when the pinned
// binary is missing, mismatched, or reports warning-or-higher; local optional
// mode SKIPs instead of claiming PASS.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  SHELLCHECK_VERSION,
  SHELLCHECK_LINUX_SHA256,
  main,
} = require('../scripts/ci/check-hook-shellcheck');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'check-hook-shellcheck.js');

function scratch(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeHookTree(root, files) {
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

function writeFakeShellcheck(dir, { version = SHELLCHECK_VERSION, checkExit = 0, checkOutput = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'shellcheck');
  fs.writeFileSync(bin, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    `const version = ${JSON.stringify(version)};`,
    `const checkExit = ${JSON.stringify(checkExit)};`,
    `const checkOutput = ${JSON.stringify(checkOutput)};`,
    "if (args[0] === '--version') {",
    "  process.stdout.write('ShellCheck - shell script analysis tool\\nversion: ' + version + '\\n');",
    '  process.exit(0);',
    '}',
    'process.stderr.write(checkOutput);',
    'process.exit(checkExit);',
    '',
  ].join('\n'), { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  return bin;
}

function envWithPath(binDir) {
  return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` };
}

function emptyPathEnv() {
  return { ...process.env, PATH: '/dev/null/dhpk-no-shellcheck' };
}

function hookFixture() {
  const root = scratch('dhpk-hook-shellcheck-');
  writeHookTree(root, {
    'scripts/hooks/ok.sh': '#!/bin/bash\ntrue\n',
    'scripts/hooks/_lib/lib.sh': '#!/bin/bash\ntrue\n',
    'scripts/install.sh': '#!/bin/bash\necho $UNQUOTED\n',
    'modules/python/hooks/py.sh': '#!/bin/bash\necho $UNQUOTED\n',
  });
  return root;
}

test('required mode fails when shellcheck is missing and does not SKIP', () => {
  const root = hookFixture();
  try {
    const result = main({ root, mode: 'required', env: emptyPathEnv() });
    assert.strictEqual(result.status, 'FAIL', JSON.stringify(result));
    assert.ok(result.errors.some((error) => /shellcheck/i.test(error) && /PATH/i.test(error)), result.errors.join('\n'));
    assert.ok(result.errors.some((error) => error.includes(SHELLCHECK_VERSION)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('optional mode SKIPs when shellcheck is missing and does not claim PASS', () => {
  const root = hookFixture();
  try {
    const result = main({ root, mode: 'optional', env: emptyPathEnv() });
    assert.strictEqual(result.status, 'SKIP', JSON.stringify(result));
    assert.match(result.skipReason, /shellcheck/i);
    assert.match(result.skipReason, new RegExp(SHELLCHECK_VERSION));
    assert.match(result.skipReason, /sha256:/i);
    assert.deepStrictEqual(result.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('required mode fails on a version mismatch', () => {
  const root = hookFixture();
  const binDir = scratch('dhpk-shellcheck-bin-');
  try {
    writeFakeShellcheck(binDir, { version: '0.10.0' });
    const result = main({ root, mode: 'required', env: envWithPath(binDir) });
    assert.strictEqual(result.status, 'FAIL', JSON.stringify(result));
    assert.ok(result.errors.some((error) => /0\.10\.0/.test(error) && error.includes(SHELLCHECK_VERSION)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('optional mode SKIPs on a version mismatch', () => {
  const root = hookFixture();
  const binDir = scratch('dhpk-shellcheck-bin-');
  try {
    writeFakeShellcheck(binDir, { version: '0.10.0' });
    const result = main({ root, mode: 'optional', env: envWithPath(binDir) });
    assert.strictEqual(result.status, 'SKIP', JSON.stringify(result));
    assert.match(result.skipReason, /0\.10\.0/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('required mode fails on a warning-or-higher finding', () => {
  const root = hookFixture();
  const binDir = scratch('dhpk-shellcheck-bin-');
  try {
    writeFakeShellcheck(binDir, {
      checkExit: 1,
      checkOutput: 'scripts/hooks/ok.sh:1:1: warning: example SC2086\n',
    });
    const result = main({ root, mode: 'required', env: envWithPath(binDir) });
    assert.strictEqual(result.status, 'FAIL', JSON.stringify(result));
    assert.ok(result.errors.some((error) => /SC2086/.test(error)), result.errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('required mode PASSes a matching clean ShellCheck run', () => {
  const root = hookFixture();
  const binDir = scratch('dhpk-shellcheck-bin-');
  try {
    writeFakeShellcheck(binDir, { checkExit: 0, checkOutput: '' });
    const result = main({ root, mode: 'required', env: envWithPath(binDir) });
    assert.strictEqual(result.status, 'PASS', JSON.stringify(result));
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.version, SHELLCHECK_VERSION);
    const relative = result.files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
    assert.deepStrictEqual(relative, ['scripts/hooks/_lib/lib.sh', 'scripts/hooks/ok.sh']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('the optional CLI SKIPs with exit 0 when the tool is missing', () => {
  const root = hookFixture();
  try {
    const result = spawnSync(process.execPath, [SCRIPT, '--mode', 'optional', '--root', root], {
      encoding: 'utf8',
      env: emptyPathEnv(),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /^SKIP:/m);
    assert.doesNotMatch(result.stdout, /^PASS:/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the required CLI fails with exit 1 when the tool is missing', () => {
  const root = hookFixture();
  try {
    const result = spawnSync(process.execPath, [SCRIPT, '--mode', 'required', '--root', root], {
      encoding: 'utf8',
      env: emptyPathEnv(),
    });
    assert.notStrictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /^PASS:/m);
    assert.doesNotMatch(result.stdout, /^SKIP:/m);
    assert.match(result.stderr, /shellcheck/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CI installs the pinned ShellCheck and runs it required on non-light plans', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(workflow, /^  shellcheck:/m);
  assert.match(workflow, /if:\s*needs\.plan\.outputs\.mode\s*!=\s*'light'/);
  assert.match(workflow, new RegExp(SHELLCHECK_LINUX_SHA256));
  assert.match(workflow, /node scripts\/ci\/check-hook-shellcheck\.js --mode required --expect-version "\$SHELLCHECK_VERSION"/);
  assert.match(workflow, /sha256sum -c -/);
  const harness = workflow.slice(workflow.indexOf('name: Harness structure'));
  assert.doesNotMatch(harness.slice(0, 400), /check-hook-shellcheck/);
});

test('the live hook tree is in the bounded ShellCheck scope', () => {
  const result = main({ root: ROOT, mode: 'optional', env: emptyPathEnv() });
  const relative = result.files.map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
  assert.ok(relative.includes('scripts/hooks/check-plugin-version.sh'), relative.join('\n'));
  assert.ok(relative.includes('scripts/hooks/_lib/session-env.sh'), relative.join('\n'));
  assert.ok(!relative.some((file) => file.startsWith('scripts/install') || file.startsWith('modules/')), relative.join('\n'));
});

run('check-hook-shellcheck');
