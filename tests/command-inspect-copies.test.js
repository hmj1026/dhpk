'use strict';

// Separate file by design (CODING_STANDARDS.md, Tests): the owner suite
// tests/command-inspect.test.js is already past 1100 lines, over the 800-line
// ceiling. These cases run the hook entrypoints in block mode.
//
// Copy propagation in the command inspector (#1515). Text that states a risky
// git value stays risky through a copy into another variable, a loop variable,
// the positional parameters, or a case-folding attribute. A value that only
// exists at run time is out of scope (ADR 0037).

const { test, run, assert } = require('./_lib/tinytest');
const { withRepos, bashHook, expectStatus, BLOCK, BLOCK_MODE, GUARD_AND_DISPATCH } = require('./_lib/hookbypass');

const C = 'git commit --no-verify -q -m x';
const U = 'GİT COMMIT --NO-VERIFY -Q -M X';

const BLOCKED = [
  // Class 1: copies. The ASCII form runs as is; the non-ASCII form folds to git.
  ['plain copy', `a='${C}'; b=$a; $b`],
  ['plain copy, non-ASCII', `a='${U}'; b=$a; \${b,,}`],
  ['quoted copy', `a='${C}'; b="$a"; $b`],
  ['quoted copy, non-ASCII', `a='${U}'; b="$a"; \${b,,}`],
  ['braced copy', `a='${C}'; b=\${a}; $b`],
  ['braced copy, non-ASCII', `a='${U}'; b=\${a}; \${b,,}`],
  ['copy chain assigned in reverse order', `f() { c=$b; $c; }; b=$a; a='${C}'; b=$a; f`],
  ['copy chain, non-ASCII', `a='${U}'; b=$a; c=$b; \${c,,}`],
  ['local copy', `f() { local b="$a"; $b; }; a='${C}'; f`],
  ['array copy', `a='${C}'; b=($a); "\${b[@]}"`],
  ['array copy, non-ASCII', `a='${U}'; b=("$a"); \${b[0],,}`],
  ['for loop variable', `a='${C}'; for b in "$a"; do $b; done`],
  ['for loop literal', `for b in '${C}'; do $b; done`],
  ['for loop variable, non-ASCII', `a='${U}'; for b in "$a"; do \${b,,}; done`],
  ['for loop literal, non-ASCII', `for b in '${U}'; do \${b,,}; done`],
  ['set -- expansion', `a='${C}'; set -- $a; "$@"`],
  ['set -- words', `set -- ${C}; "$@"`],
  ['set -- expansion, non-ASCII', `a='${U}'; set -- "$a"; \${1,,}`],
  ['set -- then copy', `a='${C}'; set -- "$a"; b=$1; $b`],
  ['for over the positional parameters', `a='${C}'; set -- "$a"; for b in "$@"; do $b; done`],
  ['for without a list', `a='${C}'; set -- "$a"; for b; do $b; done`],
  ['function argument', `f() { $1; }; f '${C}'`],
  ['function argument expansion', `a='${C}'; f() { $1; }; f "$a"`],
  ['function argument, non-ASCII', `f() { \${1,,}; }; f '${U}'`],
  ['second function argument', `f() { $2; }; f x '${C}'`],
  ['function argument after shift', `f() { shift; $1; }; f x '${C}'`],
  ['function argument copied', `f() { local b=$1; $b; }; f '${C}'`],
  ['function argument to a shell', `f() { bash -c "$1"; }; f '${C}'`],
  ['copy to a shell', `a='${C}'; b=$a; bash -c "$b"`],
  // Class 2: case-folding attributes.
  ['declare -l command', `declare -l g='GIT COMMIT --NO-VERIFY -M X'; $g`],
  ['declare -l command, non-ASCII', `declare -l g='${U}'; $g`],
  ['declare -l copy, non-ASCII', `a='${U}'; declare -l g=$a; $g`],
  ['typeset -l later value, non-ASCII', `typeset -l g; g='${U}'; $g`],
  ['local -x -l, non-ASCII', `f() { local -x -l g='${U}'; $g; }; f`],
  ['declare -l flag', `declare -l f='--NO-VERIFY'; git commit "$f" -m x`],
  ['declare -l flag, non-ASCII', `declare -l f='--NO-VERİFY'; git commit "$f" -m x`],
  ['declare -l later flag', `declare -l f; f='--NO-VERIFY'; git commit $f -m x`],
  ['declare -l flag copy', `x='--NO-VERIFY'; declare -l f=$x; git commit $f -m x`],
  // Class 3: case folding reached through an indirect form.
  ['printf -v', "printf -v l 'GIT COMMIT --NO-VERIFY -M X'; ${l,,}"],
  ['printf -v, non-ASCII', `printf -v l '${U}'; \${l,,}`],
  ['nameref', "l='GIT COMMIT --NO-VERIFY -M X'; declare -n r=l; ${r,,}"],
  ['nameref, non-ASCII', `l='${U}'; declare -n r=l; \${r,,}`],
  ['indirect', "l='GIT COMMIT --NO-VERIFY -M X'; p=l; ${!p,,}"],
  ['indirect, non-ASCII', `l='${U}'; p=l; \${!p,,}`],
  ['indirect copy', `l='${C}'; p=l; b=\${!p}; $b`],
  ['concatenated quoting', "l='GI'\"T COMMIT\"' --NO-VERIFY -M X'; ${l,,}"],
  ['concatenated quoting, non-ASCII', "l='G'\"İT COMMIT\"' --NO-VERIFY -M X'; ${l,,}"],
  ['command substitution copy', `a='${C}'; b=$(echo "$a"); $b`],
  ['quoted command substitution copy', `a='${C}'; b="$(printf %s "$a")"; $b`],
  ['backtick copy', `a='${C}'; b=\`echo $a\`; $b`],
  ['command substitution, non-ASCII', `l=$(echo '${U}'); \${l,,}`],
];

const ALLOWED = [
  ['non-ASCII commit message', "msg='café'; git commit -q --allow-empty -m \"$msg\""],
  ['copied commit message', "msg='fix: drop git commit --no-verify docs'; body=$msg; git commit -q --allow-empty -m \"$body\""],
  ['case-converted commit message', "msg='ÉCLAIR'; low=${msg,,}; git commit -q --allow-empty -m \"$low\""],
  ['declare -l message', "declare -l msg='Fix Bug'; git commit -q --allow-empty -m \"$msg\""],
  ['declare -l name', "declare -l name='Report'; echo \"$name\"; git status"],
  ['copied tool path', 'bin=/bin/ls; tool=$bin; "$tool" .; git status'],
  ['tool path inside a git checkout', 'root=$(git rev-parse --show-toplevel); bin=$root/bin; "$bin/run" --help'],
  ['for over files', 'for f in a b; do echo "$f"; done; git status'],
  ['for over tool names', 'for t in git node; do command -v "$t"; done'],
  ['for over read-only git commands', "for c in 'git status' 'git log -1'; do $c; done"],
  ['read-only git copy', "a='git status --short'; b=$a; $b"],
  ['wrapper function', 'run() { echo "+ $*"; "$@"; }; run echo "then git commit it"; git status'],
  ['label argument with shift', 'check() { label=$1; shift; "$@" && echo "$label"; }; check \'git commit stays blocked\' true'],
  ['label arguments with shift 2', 'check() { want=$1; label=$2; shift 2; "$@"; echo "$want $label"; }; check 0 "git commit stays blocked" true'],
  ['risky text only printed', `a='${C}'; b=$a; echo "$b"`],
  ['risky argument only printed', `log() { echo "$1"; }; log '${C}'`],
  ['set -- without git', 'set -- ls -l; "$@"; git status'],
];

for (const hook of GUARD_AND_DISPATCH) {
  for (const [label, command] of BLOCKED) {
    test(`${hook} blocks ${label}`, () => {
      withRepos(({ protectedRepo }) => {
        expectStatus(bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, command);
      });
    });
  }
  for (const [label, command] of ALLOWED) {
    test(`${hook} allows ${label}`, () => {
      withRepos(({ featureRepo }) => {
        const res = bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE });
        assert.notStrictEqual(res.status, BLOCK, `${command}\n${res.stderr}`);
      });
    });
  }
}

run('command-inspect-copies');
