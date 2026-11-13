'use strict';

// Fast path of scripts/hooks/_lib/command-inspect.sh (#1381). A command that
// cannot contain anything the decoder treats specially skips the
// per-character scan. These tests pin which commands take that path and that
// the state it leaves is identical to the full decoder's.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const LIB = path.join(__dirname, '..', 'scripts', 'hooks', '_lib', 'command-inspect.sh');

const STATE_VARS = [
  'DHPK_GIT_COUNT', 'DHPK_GIT_SUB', 'DHPK_GIT_REPO', 'DHPK_GIT_REPO_STATE',
  'DHPK_GIT_NO_VERIFY', 'DHPK_GIT_EXEMPT', 'DHPK_GIT_SEGMENT', 'DHPK_STRIPPED',
  'DHPK_WORDS', 'DHPK_CMD_START', 'DHPK_CMD_LEN', 'DHPK_CMD_CWD',
  'DHPK_START_CWD', 'DHPK_REDIRECT_TARGETS', 'DHPK_UNSUPPORTED', 'DHPK_HD_FORCE_EXEC',
];

// Runs the decoder and prints `declare -p` of its public state. forceFull
// replaces the fast-path predicate inside this test shell only, so the same
// command can be decoded by the full per-character scan for comparison.
function decode(command, { forceFull = false } = {}) {
  const res = spawnSync('bash', ['-c', `
    set -u
    # shellcheck disable=SC1090
    . "$DHPK_CI_LIB"
    if [ "$DHPK_CI_FORCE_FULL" = 1 ]; then
      dhpk_command_is_trivial() { return 1; }
    fi
    dhpk_inspect_command "$DHPK_CI_CMD" /session
    printf 'fast=%s\\n' "\${DHPK_INSPECT_FAST:-unset}"
    declare -p ${STATE_VARS.join(' ')}
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DHPK_CI_LIB: LIB,
      DHPK_CI_CMD: command,
      DHPK_CI_FORCE_FULL: forceFull ? '1' : '0',
    },
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const [first, ...rest] = res.stdout.split('\n');
  return { fast: first.slice('fast='.length), state: rest.join('\n') };
}

const TRIVIAL = [
  'ls -la',
  'npm test',
  'node x.js',
  'node scripts/build.js --mode production --out dist/bundle --verbose',
  '  npm   run\tlint  ',
  'A=1 B=2 node x.js',
  'npx eslint src/app.ts --max-warnings=0',
  'python3 -m pytest tests/unit -k parser',
  'mkfifo pipe',
  'echo 中文 ok',
  '! ls',
  'time -p ls',
  'function f',
  'command ls',
  'x=cd y=rm ls',
  'ls rmdir cdrom teetotal',
];

test('trivially safe commands take the fast path', () => {
  for (const command of ['ls -la', 'npm test', 'node x.js']) {
    assert.strictEqual(decode(command).fast, '1', command);
  }
});

test('the fast path leaves the same state as the full decoder', () => {
  for (const command of TRIVIAL) {
    const fast = decode(command);
    const full = decode(command, { forceFull: true });
    assert.strictEqual(fast.fast, '1', `fast path not taken: ${JSON.stringify(command)}`);
    assert.strictEqual(full.fast, '0', `full path not forced: ${JSON.stringify(command)}`);
    assert.strictEqual(fast.state, full.state, JSON.stringify(command));
  }
});

test('each special character forces the full decoder', () => {
  const chars = [
    "'", '"', '\\', '`', '$', '(', ')', '{', '}', '<', '>', ';', '&', '|',
    '\n', '\r', '#', '*', '?', '[', ']', '~',
  ];
  for (const ch of chars) {
    for (const command of [`ls ${ch}`, `ls a${ch}b`, `${ch}ls`, `ls -la${ch}`]) {
      assert.strictEqual(decode(command).fast, '0', JSON.stringify(command));
    }
  }
});

test('the substring git in any letter case forces the full decoder', () => {
  for (const command of [
    'git status', 'GIT status', 'Git log', 'gIt diff', '/usr/bin/git log',
    'ls legit', 'ls digital', 'echo GITHUB', 'ls .gitignore',
  ]) {
    assert.strictEqual(decode(command).fast, '0', command);
  }
});

test('the words cd, pushd, popd, rm, tee, coproc, eval and source force the full decoder', () => {
  for (const word of ['cd', 'pushd', 'popd', 'rm', 'tee', 'coproc', 'eval', 'source']) {
    const upper = word.toUpperCase();
    for (const command of [
      `${word} x`, `ls && ${word}`.replace(' && ', ' '), `${word}`, `A=1 ${word} x`,
      `/bin/${word} x`, `./${word}`, `${upper} x`, `nice ${word} -x`,
    ]) {
      assert.strictEqual(decode(command).fast, '0', command);
    }
  }
});

test('.env and .git anywhere force the full decoder', () => {
  for (const command of [
    'cat .env', 'cp x .env.local', 'ls a/.ENV', 'node .env.js', 'ls .Git', 'ls x.gitkeep',
  ]) {
    assert.strictEqual(decode(command).fast, '0', command);
  }
});

test('an empty or blank command takes the full decoder', () => {
  for (const command of ['', ' ', '\t']) {
    const got = decode(command);
    assert.strictEqual(got.fast, '0', JSON.stringify(command));
    assert.strictEqual(got.state, decode(command, { forceFull: true }).state);
  }
});

run('command-inspect-fastpath');
