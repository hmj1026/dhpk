'use strict';

// Case folding in the command inspector (#1491 security review). The fold is
// pure bash: no `tr`, so a BSD tr that aborts on an illegal byte, a failing or
// missing tr, or a fork failure can never turn a risky value into "" and allow.
// A value with a non-ASCII byte is never trusted to fold the ASCII way: a UTF-8
// bash folds U+0130 to ASCII i in ${l,,}.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { withRepos, bashHook, expectStatus, BLOCK, BLOCK_MODE } = require('./_lib/hookbypass');

const LIB = path.join(__dirname, '..', 'scripts', 'hooks', '_lib', 'command-inspect.sh');

// A tr that behaves like BSD tr in a UTF-8 locale on an illegal byte, and one
// that always fails. Each lives in a private directory placed first on PATH.
const BSD_LIKE_TR = [
  '#!/usr/bin/env python3',
  'import sys',
  'data = sys.stdin.buffer.read()',
  'try:',
  '    sys.stdout.write(data.decode("utf-8").lower())',
  'except UnicodeDecodeError as e:',
  '    sys.stdout.write(data[:e.start].decode("utf-8").lower())',
  '    sys.stderr.write("tr: Illegal byte sequence\\n")',
  '    sys.exit(1)',
  '',
].join('\n');
const FAILING_TR = '#!/bin/sh\nexit 1\n';

function shimDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-tr-shim-'));
  fs.writeFileSync(path.join(dir, 'tr'), body, { mode: 0o755 });
  return dir;
}

const NO_TR = [null, 'BSD-like tr', 'failing tr'];
const SHIMS = { 'BSD-like tr': BSD_LIKE_TR, 'failing tr': FAILING_TR };

function blockedOnMain(command, shim) {
  const dir = shim ? shimDir(SHIMS[shim]) : null;
  try {
    withRepos(({ protectedRepo }) => {
      const env = dir ? { ...BLOCK_MODE, PATH: `${dir}${path.delimiter}${process.env.PATH}` } : BLOCK_MODE;
      const res = bashHook('pre-bash-guard.sh', command, { cwd: protectedRepo, env });
      expectStatus(res, BLOCK, `${shim || 'no shim'}: ${command}`);
    });
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Commands whose block depends on lowering at one site (the site that names it).
// Making only that site skip the fold (identity) lets the command through.
const PER_SITE = [
  ['git_value_risky value fold', "l='GIT COMMIT --NO-VERIFY -M X'; $l"],
  ['scan early git check', "l='GIT status'; x=${l/status/commit}; $x -m x"],
  ['assignment value fold (indirect expansion)', "r=l; l='GIT COMMIT -M X'; ${!r}"],
  ['printf -v build fold', "printf -v l 'GIT COMMIT --NO-VERIFY -M X'; ${l,,}"],
  ['core.hooksPath key fold', 'git -c CORE.HOOKSPATH=x push origin x'],
];

const ALWAYS_BLOCKED = [
  ['alias value with an illegal byte', "shopt -s expand_aliases; alias x=$'\\xff\\nif true; then git commit --no-verify -q -m x; fi'; x"],
  ['hooksPath override', 'git -c core.hooksPath=/dev/null commit -m x'],
  ['upper-case hooksPath key', 'git -c CORE.HOOKSPATH=x push origin x'],
  ['upper-case value folded by ${l,,}', "l='GIT COMMIT --NO-VERIFY -M X'; ${l,,}"],
  ['U+0130 folded to ASCII i by ${l,,}', "l='GİT COMMIT --NO-VERIFY -Q -M X'; ${l,,}"],
  ['U+0130 folded by ${l^^}', "l='GİT COMMIT --NO-VERIFY -Q -M X'; ${l^^}"],
  ['ANSI-C escaped U+0130 folded by ${l,,}', "l=$'G\\xc4\\xb0T COMMIT --NO-VERIFY -Q -M X'; ${l,,}"],
];

for (const shim of NO_TR) {
  for (const [label, command] of ALWAYS_BLOCKED) {
    test(`blocks ${label} (${shim || 'system tr'})`, () => blockedOnMain(command, shim));
  }
}

for (const [label, command] of PER_SITE) {
  test(`blocks the ${label} case`, () => blockedOnMain(command, null));
}

test('a non-ASCII value that is never case-converted stays allowed', () => {
  withRepos(({ featureRepo }) => {
    const res = bashHook('pre-bash-guard.sh', "msg='café'; git commit -q --allow-empty -m \"$msg\"", { cwd: featureRepo, env: BLOCK_MODE });
    assert.notStrictEqual(res.status, BLOCK, res.stderr);
  });
});

function lowerWithNoProcesses(text) {
  const res = spawnSync('/bin/bash', ['-c', '. "$DHPK_CI_LIB"; PATH=/nonexistent; _dhpk_ci_lower "$DHPK_CI_TEXT"; printf %s "$_dhpk_ci_lc"'], {
    encoding: 'buffer',
    env: { PATH: process.env.PATH, DHPK_CI_LIB: LIB, DHPK_CI_TEXT: text, LANG: 'en_US.UTF-8' },
  });
  assert.strictEqual(res.status, 0, String(res.stderr));
  return res.stdout;
}

test('_dhpk_ci_lower folds ASCII upper case with no child process', () => {
  assert.strictEqual(lowerWithNoProcesses('GIT Commit --NO-VERIFY Z9_').toString('latin1'), 'git commit --no-verify z9_');
});

test('_dhpk_ci_lower keeps an illegal byte and a non-ASCII letter unchanged', () => {
  assert.deepStrictEqual([...lowerWithNoProcesses('AÿB')], [...Buffer.from('aÿb')]);
  assert.deepStrictEqual([...lowerWithNoProcesses('GİT')], [...Buffer.from('gİt')]);
});

run('command-inspect-case-fold');
