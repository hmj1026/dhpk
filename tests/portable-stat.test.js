'use strict';

// Coverage for scripts/hooks/_lib/portable-stat.sh: file_mtime_epoch().

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-stat.sh');
const FIXED_EPOCH = 1580702706;
const FIXED_DATE = new Date('2020-02-03T04:05:06Z');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-stat-'));
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function setFixedMtime(file) {
  fs.writeFileSync(file, 'fixed timestamp\n');
  fs.utimesSync(file, FIXED_DATE, FIXED_DATE);
}

function runStat(file, env = process.env, command) {
  return spawnSync('bash', [
    '-c',
    command || 'source "$PORTABLE_STAT_LIB"; file_mtime_epoch "$STAT_FILE"',
  ], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...env, PORTABLE_STAT_LIB: LIB, STAT_FILE: file },
  });
}

function probeDialect(dir, unameValue, file) {
  const bin = path.join(dir, 'bin');
  const argvFile = path.join(dir, 'stat-argv.json');
  fs.mkdirSync(bin);
  writeExecutable(path.join(bin, 'uname'), '#!/bin/sh\nprintf "%s\\n" "$STAT_FAKE_UNAME"\n');
  const fakeStat = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'const expected = process.env.STAT_FAKE_UNAME === "Darwin"',
    '  ? ["-f", "%m", process.env.STAT_FILE]',
    '  : ["-c", "%Y", process.env.STAT_FILE];',
    'fs.writeFileSync(process.env.STAT_ARGV_FILE, JSON.stringify(args));',
    'if (JSON.stringify(args) !== JSON.stringify(expected)) {',
    '  console.error("unexpected stat arguments: " + JSON.stringify(args));',
    '  process.exit(92);',
    '}',
    'console.log(Math.floor(fs.statSync(process.env.STAT_FILE).mtimeMs / 1000));',
  ].join('\n');
  writeExecutable(path.join(bin, 'stat'), fakeStat);

  const res = runStat(file, {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    STAT_FAKE_UNAME: unameValue,
    STAT_ARGV_FILE: argvFile,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), String(FIXED_EPOCH));
  assert.strictEqual(fs.readFileSync(argvFile, 'utf8'), JSON.stringify(
    unameValue === 'Darwin'
      ? ['-f', '%m', file]
      : ['-c', '%Y', file],
  ));
}

test('file_mtime_epoch returns the exact fixed epoch from the host stat dialect', () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'fixed.txt');
    setFixedMtime(file);
    const res = runStat(file);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), String(FIXED_EPOCH));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file_mtime_epoch selects GNU stat arguments and returns the exact fixed epoch', () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'fixed.txt');
    setFixedMtime(file);
    probeDialect(dir, 'Linux', file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file_mtime_epoch selects BSD stat arguments and returns the exact fixed epoch', () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'fixed.txt');
    setFixedMtime(file);
    probeDialect(dir, 'Darwin', file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file_mtime_epoch returns empty output successfully for a missing file without calling stat', () => {
  const dir = makeTempDir();
  try {
    const bin = path.join(dir, 'bin');
    const missing = path.join(dir, 'missing.txt');
    const called = path.join(dir, 'stat-called');
    fs.mkdirSync(bin);
    writeExecutable(path.join(bin, 'uname'), '#!/bin/sh\nprintf "Darwin\\n"\n');
    const fakeStat = [
      '#!/usr/bin/env node',
      'require("node:fs").writeFileSync(process.env.STAT_CALLED_FILE, "called");',
      'console.log("incorrectly called");',
    ].join('\n');
    writeExecutable(path.join(bin, 'stat'), fakeStat);
    const res = runStat(missing, {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      STAT_CALLED_FILE: called,
    }, 'source "$PORTABLE_STAT_LIB"; file_mtime_epoch "$STAT_FILE"; printf "EXIT:%s\\n" "$?"');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, 'EXIT:0\n');
    assert.ok(!fs.existsSync(called), 'stat must not run when the file is absent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('portable-stat');
