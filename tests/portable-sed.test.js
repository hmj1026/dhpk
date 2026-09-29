'use strict';

// Coverage for scripts/hooks/_lib/portable-sed.sh: sed_inplace().

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-sed.sh');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-sed-'));
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function runSed(file, env = process.env) {
  return spawnSync('bash', [
    '-c',
    'source "$PORTABLE_SED_LIB"; sed_inplace "$SED_EXPRESSION" "$SED_FILE"',
  ], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...env, PORTABLE_SED_LIB: LIB, SED_FILE: file, SED_EXPRESSION: 's/foo/baz/' },
  });
}

function probeDialect(dir, unameValue) {
  const bin = path.join(dir, 'bin');
  const file = path.join(dir, 'target.txt');
  const argvFile = path.join(dir, 'sed-argv.json');
  fs.mkdirSync(bin);
  fs.writeFileSync(file, 'foo bar\n');
  writeExecutable(path.join(bin, 'uname'), '#!/bin/sh\nprintf "%s\\n" "$SED_FAKE_UNAME"\n');
  const fakeSed = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'const expected = process.env.SED_FAKE_UNAME === "Darwin"',
    '  ? ["-i", "", "s/foo/baz/", process.env.SED_FILE]',
    '  : ["-i", "s/foo/baz/", process.env.SED_FILE];',
    'fs.writeFileSync(process.env.SED_ARGV_FILE, JSON.stringify(args));',
    'if (JSON.stringify(args) !== JSON.stringify(expected)) {',
    '  console.error("unexpected sed arguments: " + JSON.stringify(args));',
    '  process.exit(91);',
    '}',
    'const content = fs.readFileSync(process.env.SED_FILE, "utf8");',
    'fs.writeFileSync(process.env.SED_FILE, content.replace(/foo/g, "baz"));',
  ].join('\n');
  writeExecutable(path.join(bin, 'sed'), fakeSed);

  const res = runSed(file, {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    SED_FAKE_UNAME: unameValue,
    SED_ARGV_FILE: argvFile,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(fs.readFileSync(argvFile, 'utf8'), JSON.stringify(
    unameValue === 'Darwin'
      ? ['-i', '', 's/foo/baz/', file]
      : ['-i', 's/foo/baz/', file],
  ));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'baz bar\n');
}

test('sed_inplace replaces text and leaves a no-match file unchanged on the host sed', () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'target.txt');
    fs.writeFileSync(file, 'foo bar\n');
    const replaced = runSed(file);
    assert.strictEqual(replaced.status, 0, replaced.stderr);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'baz bar\n');

    fs.writeFileSync(file, 'nothing to see\n');
    const unchanged = spawnSync('bash', [
      '-c',
      'source "$PORTABLE_SED_LIB"; sed_inplace "$SED_EXPRESSION" "$SED_FILE"',
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PORTABLE_SED_LIB: LIB, SED_FILE: file, SED_EXPRESSION: 's/xyz/abc/' },
    });
    assert.strictEqual(unchanged.status, 0, unchanged.stderr);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'nothing to see\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sed_inplace selects GNU sed arguments when uname reports Linux', () => {
  const dir = makeTempDir();
  try {
    probeDialect(dir, 'Linux');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sed_inplace selects BSD sed arguments when uname reports Darwin', () => {
  const dir = makeTempDir();
  try {
    probeDialect(dir, 'Darwin');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('portable-sed');
