'use strict';

// Coverage for scripts/hooks/_lib/portable-timeout.sh: run_with_timeout().

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'portable-timeout.sh');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-timeout-'));
}

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function runBash(script, env = process.env, timeout = 10000) {
  return spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8',
    timeout,
    env: { ...env, PORTABLE_TIMEOUT_LIB: LIB },
  });
}

test('command completion and non-zero exit status propagate through the host timeout command', () => {
  const completed = runBash('source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 5 true');
  assert.strictEqual(completed.status, 0, completed.stderr);

  const failed = runBash('source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 5 bash -c "exit 7"');
  assert.strictEqual(failed.status, 7, failed.stderr);
});

test('a command exceeding the deadline returns exit 124', () => {
  const res = runBash('source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 1 sleep 5', process.env, 10000);
  assert.strictEqual(res.status, 124, 'expected 124, got ' + res.status + ' / ' + res.stderr);
});

test('an empty command returns 0 without invoking a wrapped command', () => {
  const res = runBash('source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 5; printf "EXIT:%s\\n" "$?"');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, 'EXIT:0\n');
});

test('gtimeout fallback receives the timeout and command arguments when timeout is unavailable', () => {
  const dir = makeTempDir();
  try {
    const bin = path.join(dir, 'bin');
    const argvFile = path.join(dir, 'gtimeout-argv.json');
    fs.mkdirSync(bin);
    const fakeGtimeout = [
      '#!/bin/bash',
      'printf "%s\\0" "$@" > "$GTimeout_ARGV_FILE"',
      'if [ "$1" != "5" ]; then exit 93; fi',
      'shift',
      'exec "$@"',
    ].join('\n');
    writeExecutable(path.join(bin, 'gtimeout'), fakeGtimeout);
    const res = runBash(
      'source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 5 /bin/sh -c "exit 7"',
      {
        ...process.env,
        PATH: bin,
        GTimeout_ARGV_FILE: argvFile,
      },
    );
    assert.strictEqual(res.status, 7, res.stderr);
    assert.deepStrictEqual(
      fs.readFileSync(argvFile).toString().split('\0').filter(Boolean),
      ['5', '/bin/sh', '-c', 'exit 7'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Perl fallback propagates exit status and maps its alarm to 124 with constrained command lookup', () => {
  const dir = makeTempDir();
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const perlPath = process.env.PATH.split(path.delimiter)
      .map((entry) => path.join(entry, 'perl'))
      .find((candidate) => fs.existsSync(candidate));
    assert.ok(perlPath, 'a host Perl executable is required for the fallback probe');
    fs.symlinkSync(perlPath, path.join(bin, 'perl'));

    const env = { ...process.env, PATH: bin };
    const failed = runBash(
      'source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 5 /bin/sh -c "exit 7"',
      env,
    );
    assert.strictEqual(failed.status, 7, failed.stderr);

    const timedOut = runBash(
      'source "$PORTABLE_TIMEOUT_LIB"; run_with_timeout 1 /bin/sleep 2',
      env,
      10000,
    );
    assert.strictEqual(timedOut.status, 124, 'expected Perl fallback exit 124, got ' + timedOut.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('portable-timeout');
