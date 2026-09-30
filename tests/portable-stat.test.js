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

{
  // F46 source block: portable-sed.test.js
  'use strict';

  // Coverage for scripts/hooks/_lib/portable-sed.sh: sed_inplace().

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

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
}

{
  // F46 source block: portable-timeout.test.js
  'use strict';

  // Coverage for scripts/hooks/_lib/portable-timeout.sh: run_with_timeout().

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

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
}

run('portable-stat');
