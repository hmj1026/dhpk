'use strict';

// Git Gate bypass suite for the PreToolUse hooks (#1468, split from
// tests/hook-bypass.test.js; spec #1367 T11, #1422).
//
// Drives pre-bash-guard.sh, pretool-git-gate.sh and pre-bash-dispatch.sh with
// JSON payloads and asserts block (exit 2) and allow (exit 0) behaviour for the
// ways an agent could slip a commit, push, --no-verify or core.hooksPath past
// the git gate: read-only and opaque wrappers (#1435), execution entrances and
// startup files (#1448, #1449), dynamic command words (#1452), and flag
// sources, abbreviations and pinned reasons (#1460, #1462, #1468).
//
// Obfuscation, credential-read, edit-guard and crash families stay in
// tests/hook-bypass.test.js; shared helpers live in tests/_lib/hookbypass.js.
// The two files were one suite until the CI job budget (10 minutes) could no
// longer fit it.

const fs = require('node:fs');
const path = require('node:path');
const { rmRepo } = require('./_lib/hookharness');
const { run, assert } = require('./_lib/tinytest');
const { batchTest: test } = require('./_lib/hookreplay');
const {
  BLOCK,
  ALLOW,
  BLOCK_MODE,
  ALL_BASH_HOOKS,
  GUARD_AND_DISPATCH,
  withRepos,
  mkBranchRepo,
  bashHook,
  expectStatus,
} = require('./_lib/hookbypass');

// ---------------------------------------------------------------------------
// #1435: read-only wrappers (watch, su, unbuffer, flock, $SHELL -c, $EDITOR,
// find -exec data) are allowed when semantics prove read-only/data; dangerous
// counterparts, dynamic git subcommands, and source-before-git stay blocked.
// ---------------------------------------------------------------------------

const READ_ONLY_WRAPPER_ALLOWED_1435 = [
  ['watch -n1 git status', 'watch -n1 git status'],
  ['watch -n 1 git log', 'watch -n 1 git log --oneline'],
  ['watch -d git status', 'watch -d git status'],
  // git diff / rg under a wrapper stay blocked by the credential guard (recursive read, unknown cwd); not a #1435 concern.
  ['watch -x git status', 'watch -x git status'],
  ['su -c git status', "su -c 'git status'"],
  ['su -c git status as root', 'su -c "git status" root'],
  ['su login -c git status', 'su - -c "git status"'],
  ['unbuffer git log', 'unbuffer git log'],
  ['unbuffer -p git status', 'unbuffer -p git status'],
  ['flock git status', 'flock /tmp/l git status'],
  ['flock -n git log', 'flock -n /tmp/l git log'],
  ['$SHELL -c git status', '$SHELL -c "git status"'],
  ['$SHELL -lc git log', "$SHELL -lc 'git log -n 1'"],
  ['$EDITOR bare git filename', '$EDITOR git'],
  ['$EDITOR with flag and bare git filename', '$EDITOR -w git'],
  ['find -exec grep git', 'find . -exec grep -l git {} +'],
  ['find -exec grep -c git', 'find . -exec grep -c git {} +'],
  ['find -execdir grep git', 'find . -execdir grep -n git {} \\;'],
];

for (const [label, command] of READ_ONLY_WRAPPER_ALLOWED_1435) {
  test(`#1435 allows read-only/data wrapper form on main and feature: ${label}`, () => {
    withRepos(({ protectedRepo, featureRepo }) => {
      for (const cwd of [protectedRepo, featureRepo]) {
        for (const hook of ALL_BASH_HOOKS) {
          expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
        }
      }
    });
  });
}

const WRAPPER_MUTATION_ON_MAIN_1435 = [
  ['watch -n1 git commit', 'watch -n1 git commit -m x'],
  ['su -c git commit', 'su -c "git commit -m x" root'],
  ['unbuffer git commit', 'unbuffer git commit -m x'],
  ['flock git commit', 'flock /tmp/l git commit -m x'],
  ['$SHELL -c git commit', '$SHELL -c "git commit -m x"'],
];

for (const [label, command] of WRAPPER_MUTATION_ON_MAIN_1435) {
  test(`#1435 blocks mutating git on main behind unwrapped/inspected wrapper: ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

const WRAPPER_NO_VERIFY_1435 = [
  ['watch -n1 --no-verify', 'watch -n1 git commit --no-verify -m x'],
  ['su -c --no-verify', 'su -c "git commit --no-verify -m x"'],
  ['unbuffer --no-verify', 'unbuffer git commit --no-verify -m x'],
  ['flock --no-verify', 'flock /tmp/l git commit --no-verify -m x'],
  ['$SHELL -c --no-verify', '$SHELL -c "git commit --no-verify -m x"'],
  ['$EDITOR git commit --no-verify', '$EDITOR git commit --no-verify -m x'],
  ['find -exec git commit --no-verify', 'find . -exec git commit --no-verify -m x \\;'],
];

for (const [label, command] of WRAPPER_NO_VERIFY_1435) {
  test(`#1435 blocks --no-verify behind wrapper: ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

const WRAPPER_ALL_HOOKS_BLOCKED_1435 = [
  ['watch quoted command string', "watch -n1 'git commit -m x'", /unmodelled wrapper before git/],
  ['watch quoted shell command string', "watch -n1 'sh -c \"git commit -m x\"'", /unmodelled wrapper before git/],
  ['watch unknown option', 'watch --unknown git commit -m x', /wrapper with unmodelled options before git/],
  ['su -c with unknown option', 'su --unknown -c "git commit -m x"', /wrapper with unmodelled options before git|unmodelled wrapper before git/],
  ['unbuffer unknown option', 'unbuffer --unknown git commit -m x', /wrapper with unmodelled options before git/],
  ['flock -c command string', 'flock /tmp/l -c "git commit -m x"', /wrapper with unmodelled options before git|unmodelled wrapper before git/],
  ['$SHELL reassigned before -c', 'SHELL=eval; $SHELL -c "git commit -m x"', /dynamic command word|unmodelled wrapper/],
  ['$SHELL -c with dynamic payload and git', '$SHELL -c "$cmd" git commit', /dynamic command word/],
  ['$EDITOR followed by git commit', '$EDITOR git commit -m x', /dynamic command word/],
  ['dynamic head with quoted git commit', '$W "git commit -m x"', /dynamic command word/],
  ['find -exec git commit', 'find . -exec git commit -m x {} +', /find -exec with git/],
  ['find -exec sh -c git commit', "find . -exec sh -c 'git commit -m x' \\;", /find -exec with git/],
  ['find second -exec git commit after grep', 'find . -exec grep -l git {} + -exec git commit -m x \\;', /find -exec with git/],
  ['dynamic git subcommand', 'git $cmd', /dynamic git subcommand/],
  ['dynamic git subcommand with --no-verify', 'git "$sub" --no-verify', /dynamic git subcommand|--no-verify/],
];

for (const [label, command, reason] of WRAPPER_ALL_HOOKS_BLOCKED_1435) {
  test(`#1435 keeps blocking across all three hooks: ${label}`, () => {
    withRepos(({ protectedRepo, featureRepo }) => {
      for (const cwd of [protectedRepo, featureRepo]) {
        for (const hook of ALL_BASH_HOOKS) {
          const res = bashHook(hook, command, { cwd, env: BLOCK_MODE });
          expectStatus(res, BLOCK, `${hook}: ${command}`);
          assert.match(res.stderr, reason);
          assert.doesNotMatch(res.stderr, /DHPK_BRANCH_SAFETY=off/);
          assert.doesNotMatch(res.stderr, /disable the guard/);
        }
      }
    });
  });
}

// Review follow-up: SHELL reassigned by an untracked form, trailing words
// after the -c payload, and a dynamic or {} find -exec head stay blocked.
const WRAPPER_REVIEW_BLOCKED_1435 = [
  ['for SHELL in', 'for SHELL in git; do $SHELL -c a=b commit -m x; done'],
  ['printf -v SHELL', 'printf -v SHELL git; $SHELL -c a=b commit -m x'],
  ['${SHELL:=git}', ': ${SHELL:=git}; $SHELL -c a=b commit -m x'],
  ['getopts SHELL', 'getopts x SHELL -x; $SHELL -c a=b commit -m x'],
  ['mapfile SHELL', 'mapfile SHELL < /dev/null; $SHELL -c a=b commit -m x'],
  ['$SHELL -c with trailing words', '$SHELL -c a.b=c commit -m x'],
  ['find -exec dynamic head', 'find . -exec cat {} \\; -exec ${G:-git} commit \\;'],
  ['find -exec {} head', 'find . -exec cat {} \\; -exec {} commit \\;'],
];

for (const [label, command] of WRAPPER_REVIEW_BLOCKED_1435) {
  test(`#1435 blocks reassigned or unprovable wrapper heads on main: ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

test('#1435 keeps existing conservative source-before-git restriction unchanged', () => {
  withRepos(({ protectedRepo, featureRepo }) => {
    const command = 'source .venv/bin/activate && git status';
    for (const cwd of [protectedRepo, featureRepo]) {
      for (const hook of ALL_BASH_HOOKS) {
        const res = bashHook(hook, command, { cwd, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(res.stderr, /git with source/);
      }
    }
  });
});

test('#1435 su login -c blocks mutating git even from a feature branch (cwd changes)', () => {
  withRepos(({ featureRepo }) => {
    for (const command of ['su - -c "git commit -m x"', 'su -l -c "git commit -m x"']) {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        const res = bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(res.stderr, /target repository is not a literal path/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// #1449 (spec #1422, RC4): BASH_ENV=, ENV=, --rcfile and --init-file paired
// with a process substitution are shell input. The startup file named by a
// path is never read (ADR 0037); only text the command itself carries is judged.
// ---------------------------------------------------------------------------

const STARTUP_FILE_BLOCKED_1449 = [
  ['B01 BASH_ENV process substitution', "BASH_ENV=<(echo 'git commit -m x') bash -c :"],
  ['B10 env wrapper BASH_ENV', "env BASH_ENV=<(echo 'git commit -m x') bash -c :"],
  ['B11 BASH_ENV with a script-file child', "BASH_ENV=<(echo 'git commit -m x') bash ./ordinary"],
  ['B12 ENV for sh -i', "ENV=<(echo 'git commit -m x') sh -i -c : </dev/null"],
  ['B13 BASH_ENV with -i (conservative)', "BASH_ENV=<(echo 'git commit -m x') bash -i -c : </dev/null"],
  ['R01 --rcfile -i', "bash --rcfile <(echo 'git commit -m x') -i </dev/null"],
  ['R07 --rcfile without -i', "bash --rcfile <(echo 'git commit -m x') -c :"],
  ['--init-file process substitution', "bash --init-file <(echo 'git commit -m x') -i -c : </dev/null"],
  ['verify-skip text in BASH_ENV', "BASH_ENV=<(echo 'git commit --no-verify -m x') bash -c :"],
  ['quote-split git text in rcfile', "bash --rcfile <(echo 'g\"it\" commit -m x') -i </dev/null"],
  ['BASH_ENV procsub fed to a script-file child under env -i', "env -i BASH_ENV=<(echo 'git commit -m x') bash ./ordinary"],
  ['rcfile procsub with a dynamic body', 'bash --rcfile <(echo "$X") -i </dev/null'],
  ['BASH_ENV=/dev/stdin fed by a pipe', "echo 'git commit -m x' | BASH_ENV=/dev/stdin bash -c :"],
  ['rcfile /dev/stdin fed by a pipe', "echo 'git commit -m x' | bash --rcfile /dev/stdin -i"],
  ['BASH_ENV=/dev/stdin fed by a stdin process substitution', "BASH_ENV=/dev/stdin bash -c : < <(echo 'git commit -m x')"],
  ['B03 BASH_ENV=/dev/stdin here-string (already blocked)', "BASH_ENV=/dev/stdin bash -c : <<< 'git commit -m x'"],
  ['R08 rcfile /dev/stdin here-string (already blocked)', "bash --rcfile /dev/stdin -i <<< 'git commit -m x'"],
];

const STARTUP_FILE_ALLOWED_1449 = [
  ['B07 BASH_ENV file contents are not read', 'BASH_ENV=./hook.sh bash -c :'],
  ['B09 ordinary BASH_ENV file', 'BASH_ENV=./ordinary bash -c :'],
  ['R05 rcfile contents are not read', 'bash --rcfile ./hook.sh -i -c : </dev/null'],
  ['R06 ordinary rcfile', 'bash --rcfile ./ordinary -i -c : </dev/null'],
  ['R09 rcfile shell running read-only git', "bash --rcfile ./ordinary -i -c 'git status' </dev/null"],
  ['BASH_ENV procsub without git text', "BASH_ENV=<(echo 'export FOO=1') bash -c :"],
  ['rcfile procsub without git text', "bash --rcfile <(echo 'alias ll=ls') -i -c : </dev/null"],
  ['ENV procsub without git text', "ENV=<(echo 'PS1=x') sh -i -c : </dev/null"],
  ['procsub as a non-startup operand', 'diff <(echo a) <(echo b)'],
];

test('#1449 judges a heredoc fed to BASH_ENV=/dev/stdin as a script on main', () => {
  withRepos(({ protectedRepo, featureRepo }) => {
    const command = `BASH_ENV=/dev/stdin bash -c : ${'<' + '<'}EOF\ngit commit -m x\nEOF`;
    for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
      expectStatus(bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, `${hook} feature: ${command}`);
    }
  });
});

// The startup-file fixtures are written once, at load, so the rows that read
// them stay recordable for the batch (#1506); the rows only read them.
const SEEDED_REPOS = { protectedRepo: mkBranchRepo('main'), featureRepo: mkBranchRepo('feature/x') };
for (const repo of Object.values(SEEDED_REPOS)) {
  fs.writeFileSync(path.join(repo, 'hook.sh'), 'git commit -m x\n');
  fs.writeFileSync(path.join(repo, 'ordinary'), 'echo ordinary\n');
}
process.on('exit', () => Object.values(SEEDED_REPOS).forEach(rmRepo));

for (const [label, command] of STARTUP_FILE_BLOCKED_1449) {
  test(`#1449 blocks a startup-file shell input on main and a feature branch: ${label}`, () => {
    for (const cwd of Object.values(SEEDED_REPOS)) {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    }
  });
}

for (const [label, command] of STARTUP_FILE_ALLOWED_1449) {
  test(`#1449 allows a startup file that carries no visible git text: ${label}`, () => {
    for (const cwd of Object.values(SEEDED_REPOS)) {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// #1448: a trap action, an alias rebinding and an arithmetic consumer's
// subscript evaluation of quoted text or variable values run command text like
// eval does. Each form blocks on the protected fixture (all three hooks) and,
// through the shared unsupported-syntax verdict, on the feature fixture
// (guard + dispatcher). Legitimate neighbours stay allowed.
// ---------------------------------------------------------------------------

const EXEC_ENTRANCE_BLOCKED_1448 = [
  // RC1 trap
  ['trap DEBUG literal commit (T01)', "trap 'git commit -m x' DEBUG; :", /git with trap/],
  ['trap DEBUG verify-skip (T02)', "trap 'git commit --no-verify -m x' DEBUG; :", /git with trap/],
  ['trap EXIT literal commit (T04)', "trap 'git commit -m x' EXIT", /git with trap/],
  ['trap ERR literal commit (T06)', "trap 'git commit -m x' ERR; false", /git with trap/],
  ['trap action from a visible variable (T07)', "x='git commit -m x'; trap \"$x\" DEBUG; :", /unresolved trap action/],
  ['trap action with no visible source (T09, P1)', 'trap "$CMD" DEBUG; :', /unresolved trap action/],
  ['trap option terminator (T13)', "trap -- 'git commit -m x' DEBUG; :", /git with trap/],
  ['trap signal 0 (T14)', "trap 'git commit -m x' 0", /git with trap/],
  ['bash -c wrapping DEBUG trap (N01)', "bash -c \"trap 'git commit -m x' DEBUG; :\"", /git with trap/],
  ['bash -c wrapping DEBUG trap verify-skip (N05)', "bash -c \"trap 'git commit --no-verify -m x' DEBUG; :\"", /git with trap/],
  // RC2 alias
  ['alias echo to eval, later line (L01)', "shopt -s expand_aliases\nalias echo=eval\necho 'git commit -m x'", /alias/],
  ['alias name for git (L03)', 'shopt -s expand_aliases\nalias g=git\ng commit -m x', /alias/],
  ['alias echo to eval verify-skip (L08)', "shopt -s expand_aliases\nalias echo=eval\necho 'git commit --no-verify -m x'", /alias/],
  ['alias used in a function body (L10)', "shopt -s expand_aliases; alias e=eval\nf() { e 'git commit -m x'; }; f", /alias/],
  ['alias with full git subcommand (L11)', "shopt -s expand_aliases\nalias gc='git commit'\ngc -m x", /alias/],
  ['alias used in a brace group (L12)', "shopt -s expand_aliases; alias e=eval\n{ e 'git commit -m x'; }", /alias/],
  ['bash -O expand_aliases -c alias to eval (X14)', "bash -O expand_aliases -c 'alias e=eval\ne \"git commit -m x\"'", /alias/],
  ['sh -c alias to eval (X15)', "sh -c 'alias e=eval\ne \"git commit -m x\"'", /alias/],
  ['alias through BASH_ALIASES', 'BASH_ALIASES[e]=eval\ne \'git commit -m x\'', /alias/],
  ['alias to a wrapper hiding git', "alias w='env git'\nw commit -m x", /alias/],
  ['trap action from a command substitution', 'trap "$(echo git commit -m x)" EXIT', /git with trap|unresolved/],
  // RC3 arithmetic consumers
  ['declare value with a quoted subscript in (( ))', "declare x='a[$(git commit -m x)]'; (( x ))", /arithmetic/],
  ['$(( x )) with a quoted subscript value', "x='a[$(git commit -m x)]'; echo $(( x ))", /arithmetic/],
  ['(( x )) with a quoted subscript value (A01)', "x='a[$(git commit -m x)]'; (( x ))", /arithmetic/],
  ['[[ x -eq 0 ]] with a quoted subscript value (A03)', "x='a[$(git commit -m x)]'; [[ x -eq 0 ]]", /arithmetic/],
  ['let y=x with a quoted subscript value (A05)', "x='a[$(git commit -m x)]'; let y=x", /arithmetic/],
  ['let with a quoted literal (A07)', "let 'y=a[$(git commit -m x)]'", /arithmetic/],
  ['(( x )) verify-skip (A14)', "x='a[$(git commit --no-verify -m x)]'; (( x ))", /arithmetic/],
  ['bash -c wrapping (( x )) (N02)', "bash -c \"x='a[\\$(git commit -m x)]'; (( x ))\"", /arithmetic/],
];

for (const [label, command, reason] of EXEC_ENTRANCE_BLOCKED_1448) {
  test(`#1448 blocks on main across all hooks: ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ALL_BASH_HOOKS) {
        const res = bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(res.stderr, reason);
        assert.doesNotMatch(res.stderr, /DHPK_BRANCH_SAFETY=off/);
      }
    });
  });

  test(`#1448 blocks on the feature branch through guard and dispatcher: ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        const res = bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(res.stderr, reason);
      }
    });
  });
}

// Legitimate neighbours of each entrance stay allowed on both fixtures.
const EXEC_ENTRANCE_ALLOWED_1448 = [
  ['trap cleanup with a trailing variable', 'trap "rm -f $tmp" EXIT'],
  ['trap naming a function', 'trap cleanup EXIT'],
  ['trap ignoring a signal', "trap '' INT"],
  ['trap listing', 'trap -p EXIT'],
  ['read-only alias', "alias ll='ls -l'"],
  ['alias with a flag-only value', "alias gl='ls -la'"],
  ['arithmetic over a non-git subscript', "x='a[$(date)]'; (( x ))"],
  ['quoted git subscript with no arithmetic consumer', "x='a[$(git status)]'; echo \"$x\""],
  ['let over plain integers', "let 'j=1+2'; (( j++ )); [[ j -eq 4 ]]"],
];

for (const [label, command] of EXEC_ENTRANCE_ALLOWED_1448) {
  test(`#1448 allows on main and feature: ${label}`, () => {
    withRepos(({ protectedRepo, featureRepo }) => {
      for (const cwd of [protectedRepo, featureRepo]) {
        for (const hook of ALL_BASH_HOOKS) {
          expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
        }
      }
    });
  });
}

// #1452: a variable whose value is visibly assigned in the same command and
// then used as the command word (or as a shell -c payload) is command-word
// construction. A value that names git and is not provably read-only blocks
// with the stable "dynamic command word" reason.
const GIT_VAR_BLOCKED_1452 = [
  ['quoted value used as the word', "l='git commit --no-verify -m x'; $l"],
  ['value with trailing arguments', "c='git commit --no-verify'; $c -m x"],
  ['plain commit value', "l='git commit -m x'; $l"],
  ['value as shell -c payload', "l='git commit --no-verify -m x'; bash -c \"$l\""],
  ['value as sh -c payload', "l='git commit --no-verify -m x'; sh -c \"$l\""],
  ['export assignment', "export l='git commit --no-verify -m x'; $l"],
  ['declare assignment', "declare l='git commit --no-verify -m x'; $l"],
  ['local assignment in a function', "f() { local l='git commit --no-verify -m x'; $l; }; f"],
  ['braced expansion', "l='git commit --no-verify -m x'; ${l}"],
  ['double-quoted single word', "l='git commit --no-verify -m x'; \"$l\""],
  ['array expansion', 'a=(git commit --no-verify -m x); "${a[@]}"'],
  ['use after &&', "l='git commit --no-verify -m x'; true && $l"],
  ['use after several statements', "l='git commit --no-verify -m x'; echo hi; echo there; $l"],
  ['push value', "l='git push --force origin main'; $l"],
];

for (const [label, command] of GIT_VAR_BLOCKED_1452) {
  test(`#1452 blocks on main (gate and dispatcher): ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
  test(`#1452 blocks on feature (guard and dispatcher): ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

test('#1452 names the dynamic command word and a rewrite direction', () => {
  withRepos(({ featureRepo }) => {
    const res = bashHook('pre-bash-guard.sh', "l='git commit --no-verify -m x'; $l", { cwd: featureRepo, env: BLOCK_MODE });
    expectStatus(res, BLOCK, 'guard');
    assert.match(res.stderr, /dynamic command word/);
    assert.match(res.stderr, /rewrite/i);
  });
});

const GIT_VAR_ALLOWED_1452 = [
  ['value without git', 'p=ls; $p'],
  ['multi-word value without git', "p='ls -l'; $p"],
  ['read-only git status value', "l='git status'; $l"],
  ['read-only git log value', "l='git log --oneline'; $l"],
  ['single-word git value with read-only use', 'g=git; $g status'],
  ['value only echoed', "l='git commit -m x'; echo \"$l\""],
  ['assignment never used as a word', "l='git commit -m x'"],
  ['git text inside echo', "echo \"l='git commit'\""],
];

for (const [label, command] of GIT_VAR_ALLOWED_1452) {
  test(`#1452 allows on main and feature: ${label}`, () => {
    withRepos(({ protectedRepo, featureRepo }) => {
      for (const cwd of [protectedRepo, featureRepo]) {
        for (const hook of ALL_BASH_HOOKS) {
          expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
        }
      }
    });
  });
}

// #1452 round 2: taint is kept per variable over the whole command text, the
// --no-verify and mutation tests never skip on substitution or bracket text,
// and a read-only first subcommand is no proof when the value holds a
// separator or a second git. Each row: label, main command, feature command
// (the feature row carries --no-verify or -n, the only mutation the guard sees).
const GIT_VAR_ROUND2_1452 = [
  ['no-verify with bracket text', "l='git commit --no-verify -m a[b]'; $l", "l='git commit --no-verify -m a[b]'; $l"],
  ['-n with bracket text', "l='git commit -n -m a[b]'; $l", "l='git commit -n -m a[b]'; $l"],
  ['no-verify with substitution text', "l='git commit --no-verify -m $(x)'; $l", "l='git commit --no-verify -m $(x)'; $l"],
  ['read-only prefix then &&', "l='git status && git commit -m x'; bash -c \"$l\"", "l='git status && git commit --no-verify -m x'; bash -c \"$l\""],
  ['read-only prefix then ;', "l='git status ; git commit -m x'; bash -c \"$l\"", "l='git status ; git commit -n -m x'; bash -c \"$l\""],
  ['read-only prefix then newline', "l='git status\ngit commit -m x'; bash -c \"$l\"", "l='git status\ngit commit -n -m x'; bash -c \"$l\""],
  ['+= builds the value', "l=git; l+=' commit -m x'; $l", "l=git; l+=' commit --no-verify -m x'; $l"],
  ['printf -v builds the value', "printf -v l 'git commit -m x'; $l", "printf -v l 'git commit --no-verify -m x'; $l"],
  ['indexed assignments', 'a[0]=git; a[1]=commit; "${a[@]}" -m x', 'a[0]=git; a[1]=commit; a[2]=--no-verify; "${a[@]}" -m x'],
  ['use before textual assignment in a loop', "for i in 1 2; do $l; l='git commit -m x'; done", "for i in 1 2; do $l; l='git commit --no-verify -m x'; done"],
  ['function body uses a later assignment', "f(){ $l; }; l='git commit -m x'; f", "f(){ $l; }; l='git commit --no-verify -m x'; f"],
  ['custom IFS rebuilds the words', 'IFS=_; m=git_commit_-m_x; $m', 'IFS=_; m=git_commit_--no-verify_-m_x; $m'],
];

for (const [label, mainCmd, featureCmd] of GIT_VAR_ROUND2_1452) {
  test(`#1452 r2 blocks on main (gate and dispatcher): ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, mainCmd, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${mainCmd}`);
      }
    });
  });
  test(`#1452 r2 blocks on feature (guard and dispatcher): ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, featureCmd, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${featureCmd}`);
      }
    });
  });
}

// Taint follows the variable that holds git text, not the whole command; a
// provably read-only value stays usable as a command word.
const GIT_VAR_ROUND2_ALLOWED_1452 = [
  ['git text in a variable never run as a word', "msg='docs: explain git commit hooks'; cmd=ls; $cmd"],
  ['read-only value with -C', "g='git -C repo status'; $g"],
  ['read-only value with --no-pager', "g='git --no-pager log -1'; $g"],
  ['read-only branch --show-current', "g='git branch --show-current'; $g"],
  ['read-only stash list', "g='git stash list'; $g"],
  ['read-only worktree list', "g='git worktree list'; $g"],
];

for (const [label, command] of GIT_VAR_ROUND2_ALLOWED_1452) {
  test(`#1452 r2 allows on feature: ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
      }
    });
  });
}

// #1452 round 3: namerefs, indirect expansion, case-changing expansion and
// find -exec shells carry the taint of the variable they resolve to. Each row:
// label, main command, feature command (feature carries --no-verify).
const GIT_VAR_ROUND3_1452 = [
  ['declare -n nameref', "l='git commit -m x'; declare -n r=l; $r", "l='git commit --no-verify -m x'; declare -n r=l; $r"],
  ['typeset -n nameref', "l='git commit -m x'; typeset -n r=l; $r", "l='git commit --no-verify -m x'; typeset -n r=l; $r"],
  ['local -n nameref', "f(){ local -n r=l; $r; }; l='git commit -m x'; f", "f(){ local -n r=l; $r; }; l='git commit --no-verify -m x'; f"],
  ['nameref with unresolved target', "l='git commit -m x'; y=l; declare -n r=$y; $r", "l='git commit --no-verify -m x'; y=l; declare -n r=$y; $r"],
  ['indirect expansion', "y=l; l='git commit -m x'; ${!y}", "y=l; l='git commit --no-verify -m x'; ${!y}"],
  ['lower-case expansion', "l='GIT COMMIT -M X'; ${l,,}", "l='GIT COMMIT --NO-VERIFY -M X'; ${l,,}"],
  ['upper-case expansion', "l='git commit -m x'; ${l^^}", "l='git commit --no-verify -m x'; ${l^^}"],
  ['toggle-case expansion', "l='GIT COMMIT -M X'; ${l~~}", "l='GIT COMMIT --NO-VERIFY -M X'; ${l~~}"],
  ['@L transform', "l='GIT COMMIT -M X'; ${l@L}", "l='GIT COMMIT --NO-VERIFY -M X'; ${l@L}"],
  ['find -exec sh -c', "l='git commit -m x'; find . -exec sh -c \"$l\" \\;", "l='git commit --no-verify -m x'; find . -exec sh -c \"$l\" \\;"],
  ['find -execdir sh -c', "l='git commit -m x'; find . -execdir sh -c \"$l\" \\;", "l='git commit --no-verify -m x'; find . -execdir sh -c \"$l\" \\;"],
  ['find -ok sh -c', "l='git commit -m x'; find . -ok sh -c \"$l\" \\;", "l='git commit --no-verify -m x'; find . -ok sh -c \"$l\" \\;"],  // (#1456) a substitution operator rewrites a visible git value into another git command
  ['pattern substitution as command word', "l='git log'; ${l/log/push} origin main", "l='git log'; ${l/log/commit} --no-verify -m x"],
  // (#1456 review) the transformed value is assigned first and run in a second step
  ['pattern substitution assigned then run', "l='git log'; x=${l/log/push}; $x origin main", "l='git log'; x=${l/log/commit}; $x --no-verify -m x"],
  ['quoted pattern substitution assigned then run', "l='git log'; x=\"${l/log/push}\"; $x origin main", "l='git log'; x=\"${l/log/commit}\"; $x --no-verify -m x"],
  ['assigned transform copied to a third name', "l='git log'; x=${l/log/push}; y=$x; $y origin main", "l='git log'; x=${l/log/commit}; y=$x; $y --no-verify -m x"],
  ['suffix removal assigned then run', "l='git log'; x=${l%log}push; $x origin main", "l='git log'; x=${l%log}commit; $x --no-verify -m x"],
];

for (const [label, mainCmd, featureCmd] of GIT_VAR_ROUND3_1452) {
  test(`#1452 r3 blocks on main (gate and dispatcher): ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, mainCmd, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${mainCmd}`);
      }
    });
  });
  test(`#1452 r3 blocks on feature (guard and dispatcher): ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, featureCmd, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${featureCmd}`);
      }
    });
  });
}

const GIT_VAR_ROUND3_ALLOWED_1452 = [
  ['nameref to a plain variable', 'declare -n r=p; p=ls; $r'],
  ['nameref to an untainted target beside git text', "l='git commit -m x'; declare -n r=p; p=ls; $r"],
  ['lower-case expansion of a plain value', "l='LS'; ${l,,}"],
  ['indirect expansion of a plain value', 'y=p; p=ls; ${!y}'],
  ['find -exec sh -c with a plain variable', 'p=ls; find . -exec sh -c "$p" \\;'],
  ['find -exec echo of git text', "l='git commit -m x'; find . -exec echo \"$l\" \\;"],
  ['assigned substitution of a plain value', 'p=ls; x=${p/s/s}; $x'],
];

for (const [label, command] of GIT_VAR_ROUND3_ALLOWED_1452) {
  test(`#1452 r3 allows on main and feature: ${label}`, () => {
    withRepos(({ protectedRepo, featureRepo }) => {
      for (const cwd of [protectedRepo, featureRepo]) {
        for (const hook of ALL_BASH_HOOKS) {
          expectStatus(bashHook(hook, command, { cwd, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
        }
      }
    });
  });
}

// #1460: git rebuilt in the command word by an array transform or a default operator, and flag
// variables expanded in argument position. Plain (non-template) strings keep ${...} literal.
// Each row: label, main command (push), feature command (carries --no-verify).
const GIT_GATE_WORD_1460 = [
  ['array transform', 'a=(git log); ${a[@]/log/push} origin main', 'a=(git log); ${a[@]/log/commit} --no-verify -m x'],
  ['default operator', '${x:-git push} origin main', '${x:-git commit} --no-verify -m x'],
  ['assign-default operator', 'l=; ${l:=git push} origin main', 'l=; ${l:=git commit} --no-verify -m x'],
];

for (const [label, mainCmd, featureCmd] of GIT_GATE_WORD_1460) {
  test(`#1460 blocks on main (gate and dispatcher): ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        expectStatus(bashHook(hook, mainCmd, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${mainCmd}`);
      }
    });
  });
  test(`#1460 blocks on feature (guard and dispatcher): ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, featureCmd, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${featureCmd}`);
      }
    });
  });
}

const GIT_GATE_FLAG_1460 = [
  ['flag variable', 'o=--no-verify; git commit $o -m x'],
  ['transformed flag variable', 'o=--verify; git commit ${o/--/--no-} -m x'],
  ['flag array', 'opts=(--no-verify); git commit "${opts[@]}" -m x'],
  ['flag split across variables (#1460 review)', 'a=--no-; b=verify; git commit $a$b -m x'],
  ['flag with variable suffix (#1460 review)', 'v=verify; git commit --no-$v -m x'],
  ['flag copied into another variable (#1460 review)', 'p=--no-verify; o=$p; git commit $o -m x'],
];

for (const [label, command] of GIT_GATE_FLAG_1460) {
  test(`#1460 blocks on feature (guard and dispatcher): ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

const GIT_GATE_ALLOWED_1460 = [
  ['benign flag variable', 'o=--amend; git commit $o -m x'],
  ['flag variable consumed as a message', 'o=--no-verify; git commit -m "$o"'],
  ['default operator without git', '${EDITOR:-vi} notes.txt'],
  ['non-flag variable word (#1460 review)', 'f=notes.txt; git commit $f -m x'],
  ['option value with variable (#1460 review)', 'a=fix; git commit --author="$a" -m x'],
];

for (const [label, command] of GIT_GATE_ALLOWED_1460) {
  test(`#1460 allows on feature: ${label}`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
      }
    });
  });
}

// #1462: flag sources beyond NAME=value, and harmless default operators.
const GIT_GATE_FLAG_1462 = [
  ['G1', 'read -r o <<< --no-verify; git commit $o -m x'],
  ['G2', 'printf -v o %s --no-verify; git commit $o -m x'],
  ['G3', 'set -- --no-verify; git commit "$@" -m x'],
  ['G4', 'f() { git commit "$@"; }; f --no-verify -m x'],
  ['G5', 'o=p; p=--no-verify; git commit ${!o} -m x'],
  ['B1', 'git commit --no-verify -m x'],
  ['default-short', 'git commit ${x:--n} -m x'],
  ['opaque-read', 'o=--no-verify; read o; git commit $o -m x'],
  ['read-overrides-benign', 'o=--amend; read o <<< --no-verify; git commit $o -m x'],
  ["G1a", "read -pt o <<< --no-verify; git commit $o -m x"],
  ["G1b", "read <<< --no-verify o; git commit $o -m x"],
  ["G1c", "IFS= read -r o <<< --no-verify; git commit $o -m x"],
  ["G4a", "f() { git commit \"$@\"; }; x=1 f --no-verify -m x"],
  ["G4b", "f() { git commit \"$@\"; }; \"f\" --no-verify -m x"],
  ["G4c", "f() { git commit \"$@\"; }; \\f --no-verify -m x"],
  ["G4d", "f() { git commit \"$@\"; }; 2>/dev/null f --no-verify -m x"],
  ["G4e", "f() { git commit \"$@\"; }; case a in a) f --no-verify -m x;; esac"],
  ["G4f", "f() { git commit \"$@\"; }; x=$(f --no-verify -m x)"],
  ["G3a", "\"set\" -- --no-verify; git commit \"$@\" -m x"],
  ["G3b", "set -- -m --no-verify; git commit -m x $2"],
  ["G4g", "f() { git commit -m x \"$2\"; }; f -m --no-verify"],
  ["G6a", "git commit ${1:--n} -m x"],
  ["G6b", "git commit ${@:--n} -m x"],
  ["G6c", "set -- a; git commit ${1:+-n} -m x"],
  ["G7a", "read -r o <<< -\\-no-verify; git commit $o -m x"],
  ["G7b", "printf -v o %s -\\-no-verify; git commit $o -m x"],
  ["G7c", "git commit ${x:-'--no-'verify} -m x"],
  ["G7d", "read -r o <<< $'--no-verify'; git commit $o -m x"],
  ["G7e", "git commit ${x:--\\n} -m x"],
  ['G8a', `set -- ${Array.from({ length: 300 }, (_, k) => 'w' + k).join(' ')}; git commit "$@" -m x`],
  ["G9a", "o=-q; for o in --no-verify; do git push ${o:-} origin x; done"],
  ["G9b", "o=-q; for o in --no-veri\\fy; do git push ${o:-} origin x; done"],
  ["G9c", "o=-q; select o in --no-verify; do git push ${o:-} origin x; done"],
  ["G9d", "o=-q; o=${o/q/-no-veri}fy; git push ${o:-} origin x"],
  ["G9e", "o=-q; mapfile -t o <<< --no-verify; git push ${o:-} origin x"],
  ["G9f", "o=-q; declare -n o=p; p=--no-verify; git push ${o:-} origin x"],
  ["G10a", "o=--no-veri; git commit ${o:-x} -m x"],
  ["G10b", "o=--no-veri; git commit ${o:=x} -m x"],
  ["G10c", "o=--no-veri; git commit ${o-x} -m x"],
  ["G10d", "o=--no-veri; git commit ${o:?x} -m x"],
  ["G10e", "o=--no-veri; git push ${o:-x} origin x"],
  ["G11a", "nv=-q; declare n''v=--no-verify; git commit ${nv:-x} -m x"],
  ["G11b", "nv=-q; export n\"\"v=--no-verify; git commit ${nv:-x} -m x"],
  ["G11c", "nv=-q; readonly n\\v=--no-verify; git commit ${nv:-x} -m x"],
  ["G11d", "nv=-q; typeset n''v=--no-verify; git commit ${nv:-x} -m x"],
  ["G11e", "nv=-q; f() { local n''v=--no-verify; git commit ${nv:-x} -m x; }; f"],
  ["G11f", "nv=-q; declare n''v=--no-veri; git commit ${nv:-x} -m x"],
  ["G11g", "nv=-q; declare n''v=--no-verify; git push ${nv:-x} origin x"],
  ["G11h", "nv=-q; declare n''v=--no-verify; git commit ${nv-x} -m x"],
  ["G11i", "nv=-q; declare n''v=--no-verify; git commit ${nv:=x} -m x"],
  ["G11j", "nv=-q; declare n''v=--no-verify; git commit ${nv:?x} -m x"],
  ["G11k", "nv=-q; a=n; b=v; printf -v \"$a$b\" %s --no-verify; git commit ${nv:-x} -m x"],
  ["G11l", "nv=-q; a=n; b=v; read -r \"$a$b\" <<< --no-verify; git commit ${nv:-x} -m x"],
  ["G11m", "nv=-q; a=n; b=v; declare \"$a$b=--no-verify\"; git commit ${nv:-x} -m x"],
  ["G11n", "nv=-q; a=n; b=v; export \"$a$b\"=--no-verify; git commit ${nv:-x} -m x"],
  ["G11o", "nv=-q; a=n; b=v; readarray -t \"$a$b\" <<< --no-verify; git commit ${nv:-x} -m x"],
  ["G11p", "nv=-q; declare -n p=\"n\"\"v\"; p=--no-verify; git commit ${nv:-x} -m x"],
  ["G11q", "nv=-q; a=n; b=v; unset \"$a$b\"; : ${nv:=--no-verify}; git commit ${nv:-x} -m x"],
  ["G12a", "nv=-q; git commit ${nv:+$'\\x2d-no-verify'} -m x"],
  ["G12b", "nv=-q; git commit \"${nv:+$'\\x2d-no-verify'}\" -m x"],
  ["G12c", "nv=-q; git commit ${nv:-$'\\x2d-no-verify'} -m x"],
  ["G13a", "touch ./-n; nv='-?'; git commit ${nv:-x} -m x"],
  ["G13b", "nv='--no-v*'; git commit ${nv:-x} -m x"],
  ["G13c", "nv='--no-verif?'; git commit ${nv:-x} -m x"],
  ["G13d", "nv='--no-verif[y]'; git commit ${nv:-x} -m x"],
  ["G13e", "nv='--no-v*'; git push ${nv:-x} origin x"],
  ["G13f", "nv=--no-v*; git commit ${nv:-x} -m x"],
  ["G14a", "_=-q; echo --no-verif; git commit ${_:-x} -m y"],
  ["G14b", "_=-q; echo --no-verify; git commit ${_:-x} -m y"],
  ["G14c", "_=-q; echo -n; git commit ${_:-x} -m y"],
  ["G14d", "_=-q; echo --no-verify; git push ${_:-x} origin y"],
  ["G14e", "_=-q; touch --no-verify; git commit ${_:-x} -m y"],
  ["G14f", "_=-q; : --no-verify; git commit ${_:-x} -m y"],
  ["G14g", "_=-q; true --no-verify; git commit ${_:-x} -m y"],
  ["G14h", "BASH_REMATCH=-q; [[ --no-verif =~ .* ]]; git commit ${BASH_REMATCH:-x} -m y"],
  ["G15a", "IFS=Z; o=--no-verifyZ; git commit ${o:-} -m y"],
  ["G15b", "IFS=Z; o=--no-verifZ; git commit ${o:-} -m y"],
  ["G15c", "IFS=Z; o=-qZ-n; git commit ${o:-} -m y"],
  ["G15d", "IFS=Z; o=--no-verifyZ; git push ${o:-} origin y"],
  ["G15e", "o=-qZ-n; IFS=Z; git commit ${o:-} -m y"],
  ["G16a", "false && o=-q; : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16b", "false && o=-q; : ${o:=--no-verify}; git push ${o:-} origin x"],
  ["G16c", "false && o=-q; : ${o:=--no-verify}; git commit ${o:-} -m y"],
  ["G16d", "o=-q true; : ${o:=--no-verify}; git push ${o:-} origin x"],
  ["G16e", "false && o=-q; git commit -m ${o:=-n} ${o:-}"],
  ["G16f", "false && o=-q; : ${o:=--no-veri}; git commit ${o:-} -m y"],
  ["G16g", "o=-q | :; : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16h", "o=-q & : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16i", "true || o=-q; : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16j", "(o=-q); : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16k", "false &&\no=-q; : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16l", "f() { o=-q; }; : ${o:=-n}; git commit ${o:-} -m y"],
  ["G16m", "false && o=-q; echo ${o:=-n}; git commit ${o:-} -m y"],
  ["G16n", "false && o=-q; p=${o:=-n}; git commit ${o:-} -m y"],
  ["G16o", "if false; then\no=-q\nfi; : ${o:=-n}; git commit ${o:-} -m y"],
];

for (const [id, command] of GIT_GATE_FLAG_1462) {
  test(`#1462 ${id} blocks on feature (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

const GIT_GATE_ALLOWED_1462 = [
  ['F3', 'o=-q; git push ${o:-} origin main'],
  ['C1', 'git commit "$@"'],
  ['C2', 'b=main; git push origin $b'],
  ['C3', 'git push origin "$branch"'],
  ['C5', 'read -r o <<< --amend; git commit $o -m x'],
  ['C6', 'printf -v o %s --amend; git commit $o -m x'],
  ['C7', 'set -- --amend; git commit "$@" -m x'],
  ['C8', 'f() { git commit "$@"; }; f --amend -m x'],
  ['C9', 'o=p; p=--amend; git commit ${!o} -m x'],
  ['msg-arg', 'f(){ git commit "$@"; }; f -m "$msg"'],
  ['unknown-read', 'read b; git push origin $b'],
  ['unknown-read-file', 'read o < f; git commit $o -m x'],
  ["C10", "b=${1:-main}; git push origin $b"],
  ["C11", "git push origin ${b:-main}"],
  ["C12", "git commit -m \"${msg:-wip}\""],
];

for (const [id, command] of GIT_GATE_ALLOWED_1462) {
  test(`#1462 ${id} allows on feature`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
      }
    });
  });
}

// Pinned reasons: a flag from a visible source names --no-verify; an unreadable one reports the
// transformed flag with its rewrite hint.
const REASON_NO_VERIFY_1462 = /'--no-verify' bypasses the pre-commit\/pre-push gates/;
const REASON_TRANSFORMED_1462 = /unsupported shell syntax \(transformed git flag\); rewrite the command without it/;
const GIT_GATE_REASON_1462 = [
  ['G1', 'read -r o <<< --no-verify; git commit $o -m x', REASON_NO_VERIFY_1462],
  ['G3', 'set -- --no-verify; git commit "$@" -m x', REASON_NO_VERIFY_1462],
  ['opaque-read', 'o=--no-verify; read o; git commit $o -m x', REASON_TRANSFORMED_1462],
  ['G7c', "git commit ${x:-'--no-'verify} -m x", REASON_NO_VERIFY_1462],
  ['G9a', 'o=-q; for o in --no-verify; do git push ${o:-} origin x; done', REASON_TRANSFORMED_1462],
  ["G16a", "false && o=-q; : ${o:=-n}; git commit ${o:-} -m y", REASON_TRANSFORMED_1462],
  ["G14a", "_=-q; echo --no-verif; git commit ${_:-x} -m y", REASON_TRANSFORMED_1462],
  ["G15a", "IFS=Z; o=--no-verifyZ; git commit ${o:-} -m y", REASON_TRANSFORMED_1462],
  ["G11a", "nv=-q; declare n''v=--no-verify; git commit ${nv:-x} -m x", REASON_TRANSFORMED_1462],
  ["G12a", "nv=-q; git commit ${nv:+$'\\x2d-no-verify'} -m x", REASON_TRANSFORMED_1462],
  ["G13a", "touch ./-n; nv='-?'; git commit ${nv:-x} -m x", REASON_TRANSFORMED_1462],
];

for (const [id, command, reason] of GIT_GATE_REASON_1462) {
  test(`#1462 ${id} blocks with a stable reason (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        const res = bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(String(res.stderr), /\[bash-guard\] blocked:/, `${hook}: ${command}`);
        assert.match(String(res.stderr), reason, `${hook}: ${command}`);
      }
    });
  });
}

// On a protected branch commit and push stay blocked by branch safety (existing behavior).
for (const command of ['git commit "$@"', 'b=main; git push origin $b']) {
  test(`#1462 branch safety still blocks on main (dispatcher): ${command}`, () => {
    withRepos(({ protectedRepo }) => {
      expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, command);
    });
  });
}

// #1468 Package B (git gate): the flag judgment fails closed for abbreviations, escapes, globs,
// default assignments, quoted or dynamic names, slicing and other sources, indirect calls and
// core.hooksPath. Each row must block on a feature branch through the guard and the dispatcher.
const GIT_GATE_BLOCK_1468 = [
  ['abbrev-veri', 'git commit --no-veri -m x'],
  ['abbrev-verif', 'git push --no-verif origin x'],
  ['abbrev-positional', 'set -- --no-veri; git push ${1:-x} origin x'],
  ['escape-read-ansi', "read -r o <<< $'\\x2d-no-verify'; git commit $o -m x"],
  ['escape-printf-v', "printf -v o '\\x2d-no-verify'; git commit $o -m x"],
  ['escape-printf-b', "printf -v o %b '\\x2d-no-verify'; git commit $o -m x"],
  ['escape-octal-assign', "nv=$'\\055-no-verify'; git commit $nv -m x"],
  ['escape-default-ansi', "git commit ${zz:-$'\\x2d-no-verify'} -m x"],
  ['glob-literal', 'git commit --no-v* -m x'],
  ['glob-default-word', "git commit ${zz:-'--no-v'*} -m x"],
  ['glob-variable', "nv='--no-v*'; git commit $nv -m x"],
  ['default-escape-newline', 'git commit ${x:--\\n} -m x'],
  ['default-quoted-flag', "git commit ${x:-'--no-verify'} -m x"],
  ['default-backslash-short', 'git commit ${x:-\\-n} -m x'],
  ['default-abbrev-escape', 'git commit ${x:---no-verif\\y} -m x'],
  ['assign-default-colon', ': ${o:=--no-verify}; git commit $o -m x'],
  ['assign-default-argument', 'git commit -m ${o:=-n} ${o:-}'],
  ['assign-default-after-empty', 'o=; : ${o:=--no-verify}; git commit ${o:-x} -m x'],
  ['name-quoted-declare', "declare n''v=--no-verify; git commit $nv -m x"],
  ['name-dynamic-read', 'a=o; read -r "$a" <<< --no-verify; git commit $o -m x'],
  ['source-mapfile', 'mapfile -t o <<< --no-verify; git commit $o -m x'],
  ['source-readarray', 'readarray -t o <<< --no-verify; git commit $o -m x'],
  ['source-nameref', 'declare -n r=p; p=--no-verify; git commit $r -m x'],
  ['source-for-positional', 'set -- --no-verify; for a; do git commit $a -m x; done'],
  ['source-for-list', 'for o in --no-verify; do git push $o origin x; done'],
  ['source-read-substitution', 'read o <<< "$(echo --no-verify)"; git commit $o -m x'],
  ['source-read-process-substitution', 'read o < <(echo --no-verify); git commit $o -m x'],
  ['source-read-pipeline', 'echo --no-verify | { read o; git commit $o -m x; }'],
  ['indirect-trap-function', "f() { git commit \"$@\" -m x; }; trap 'f --no-verify' EXIT"],
  ['indirect-xargs-function', "f() { git commit \"$@\" -m x; }; export -f f; echo --no-verify | xargs bash -c 'f \"$@\"' _"],
  ['indirect-command-not-found', 'command_not_found_handle() { git commit "$@" -m x; }; --no-verify'],
  ['slice-offset', 'set -- ab--no-verify; git commit ${1:2} -m x'],
  ['slice-substitute', 'set -- X-no-verify; git commit ${1/X/-} -m x'],
  ['slice-suffix', 'set -- --no-verifyX; git commit ${1%X} -m x'],
  ['slice-at-offset', 'set -- a --no-verify; git commit ${@:2} -m x'],
  ['slice-star-offset', 'set -- a --no-verify; git commit ${*:2} -m x'],
  ['slice-lowercase', 'set -- --NO-VERIFY; git commit ${1,,} -m x'],
  ['slice-two-digit', 'set -- 1 2 3 4 5 6 7 8 9 --no-verify; git commit ${10} -m x'],
  ['slice-variable-offset', 'o=x--no-verify; git commit ${o:1} -m x'],
  ['slice-indirect-default', 'o=p; p=--no-verify; git commit ${!o:-x} -m x'],
  ['last-argument', 'echo --no-verify; git commit $_ -m x'],
  ['tilde-home', 'HOME=--no-verify; git commit ~ -m y'],
  ['dynamic-head-declare-commit', 'opt=-q; a=decl; b=are; p=op; q=t; $a$b x $p$q=--no-verify; git commit ${opt:-} -m x'],
  ['dynamic-head-declare-push', 'opt=-q; a=decl; b=are; p=op; q=t; $a$b x $p$q=--no-verify; git push ${opt:-} origin "$br"'],
  ['dynamic-head-eval', 'opt=-q; a=ev; b=al; p=op; q=t; $a$b : "&&" $p$q=--no-verify; git commit ${opt:-} -m x'],
  ['dynamic-head-read', 'c=read; $c -r o <<< --no-verify; git commit $o -m x'],
  ['source-compgen', 'compgen -V o -W "--no-verify" -- ""; git commit $o -m x'],
  ['source-compgen-default', 'o=-q; compgen -V o -W "--no-verify" -- ""; git push ${o:-} origin "$b"'],
  ['source-for-backtick', 'for o in `echo --no-verify`; do git push $o origin x; done'],
  ['source-for-substitution', 'for o in $(echo --no-verify); do git push $o origin x; done'],
  ['source-read-backtick', 'read o <<< "`echo --no-verify`"; git commit $o -m x'],
  ['positional-unquoted-suffix', 'set -- "x --no-verify"; git push origin HEAD:$1'],
  ['positional-quoted-dash', 'git commit "-${1}" -m x'],
  ['positional-quoted-eval', 'set -- "x --no-verify"; eval git push origin "HEAD:${1}"'],
  ['positional-quoted-heredoc', 'set -- \'x" --no-verify "\'; bash <<EOF\ngit push origin "HEAD:${1}"\nEOF'],
  ['positional-quoted-at', 'set -- x --no-verify; git push origin "HEAD:$@"'],
  ['positional-quoted-and-bare', 'set -- "x --no-verify"; git push origin "HEAD:${1}" HEAD:${1}'],
  ['dq-concat-unquoted-between', "set -- 'y --no-verify z'; git commit -m \"a \"x$1\" b\""],
  ['dq-concat-no-blank', "set -- 'y --no-verify z'; git commit -m \"a\"x$1\"b\""],
  ['dq-concat-blank-dollar', "set -- 'y --no-verify z'; git commit -m \"a \"$1\" b\""],
  ['dq-concat-single-quoted', "set -- 'y --no-verify z'; git commit -m 'a 'x$1' b'"],
  ['attached-value-split', 'git commit --message="a "$1'],
  ['attached-value-unquoted-positional', "set -- 'y --no-verify'; git commit --message=$1"],
  ['value-unquoted-prefix', 'git commit -m x$1'],
  ['dq-array-keys', 'declare -A a=([--no-verify]=1 [b]=2); git commit -m m "x${!a[@]}"'],
  ['array-keys-star-unquoted', 'declare -A a=([--no-verify]=1 [b]=2); git commit -m m ${!a[*]}'],
  ['dq-array-unbound-at', 'git commit -m m "x${a[@]}"'],
  ['dq-array-unbound-keys', 'git push origin "x${!a[@]}"'],
  ['source-here-string-backtick', 'read o <<< `echo --no-verify`; git commit -m m $o'],
  ['source-here-string-substitution', 'read o <<< $(echo --no-verify); git commit -m m $o'],
];

for (const [id, command] of GIT_GATE_BLOCK_1468) {
  test(`#1468 ${id} blocks on feature (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

// git -c core.hooksPath=... disables the repository hooks for one invocation, so commit and push with it
// are blocked like --no-verify. Without branch safety in block mode only the guard itself can block.
const REASON_HOOKSPATH_1468 = /core\.hooksPath' bypasses/;
const GIT_GATE_HOOKSPATH_1468 = [
  ['hookspath-commit', 'git -c core.hooksPath=/dev/null commit -m x'],
  ['hookspath-push-upper', 'git -c CORE.HOOKSPATH=x push origin x'],
];

for (const [id, command] of GIT_GATE_HOOKSPATH_1468) {
  test(`#1468 ${id} blocks on feature (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
  test(`#1468 ${id} is blocked by the guard itself without branch safety, with a stable reason`, () => {
    withRepos(({ featureRepo }) => {
      const res = bashHook('pre-bash-guard.sh', command, { cwd: featureRepo });
      expectStatus(res, BLOCK, command);
      assert.match(String(res.stderr), /\[bash-guard\] blocked:/, command);
      assert.match(String(res.stderr), REASON_HOOKSPATH_1468, command);
    });
  });
}

const GIT_GATE_REASON_1468 = [
  ['abbrev-veri', 'git commit --no-veri -m x', REASON_NO_VERIFY_1462],
  ['default-escape-newline', 'git commit ${x:--\\n} -m x', REASON_TRANSFORMED_1462],
  ['default-quoted-flag', "git commit ${x:-'--no-verify'} -m x", REASON_NO_VERIFY_1462],
  ['default-backslash-short', 'git commit ${x:-\\-n} -m x', REASON_NO_VERIFY_1462],
  ['default-abbrev-escape', 'git commit ${x:---no-verif\\y} -m x', REASON_TRANSFORMED_1462],
  ['source-for-list', 'for o in --no-verify; do git push $o origin x; done', REASON_NO_VERIFY_1462],
  ['assign-default-colon', ': ${o:=--no-verify}; git commit $o -m x', REASON_NO_VERIFY_1462],
  ['slice-offset', 'set -- ab--no-verify; git commit ${1:2} -m x', REASON_TRANSFORMED_1462],
  ['last-argument', 'echo --no-verify; git commit $_ -m x', REASON_TRANSFORMED_1462],
  ['tilde-home', 'HOME=--no-verify; git commit ~ -m y', REASON_TRANSFORMED_1462],
];

// A quoted argument must not fail the default-expansion trust proof on its own (the allow rows), yet
// every way to rebind the flag variable behind it must stay blocked (the adversarial rows).
const GIT_GATE_ADV_1468 = [
  ['adv-split-declare', 'o=-q; de""clare o=--no-verify; git push ${o:-} origin "$b"'],
  ['adv-quoted-read', 'o=-q; "read" o <<< --no-verify; git push ${o:-} origin "$b"'],
  ['adv-assign-in-string', 'o=-q; git push ${o:-} origin "a; o=--no-verify"'],
  ['adv-quoted-default-assign', 'o=-q; : "${o:=--no-verify}"; git push ${o:-} origin "$b"'],
  ['adv-ifs', 'o=-q; IFS=x; git push ${o:-} origin "$b"'],
  ['adv-ansi-quote', "o=-q; git push ${o:-} origin \"$b\" $'\\x2d'"],
  ['adv-function-rebind', 'o=-q; f(){ o=--no-verify; }; f; git push ${o:-} origin "$b"'],
  ['adv-other-variable', 'o=-q; b=--no-verify; git push ${o:-} origin "$b"'],
  ['adv-quoted-default-other', 'o=-q; git push ${o:-} origin "${b:=--no-verify}"'],
  ['adv-assign-after', 'o=-q; git push ${o:-} origin "$b"; o=--no-verify'],
];

for (const [id, command] of GIT_GATE_ADV_1468) {
  test(`#1468 ${id} stays blocked on feature (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), BLOCK, `${hook}: ${command}`);
      }
    });
  });
}

const GIT_GATE_ALLOW_1468 = [
  ['allow-empty-default', 'o=-q; git push ${o:-} origin "$b"'],
  ['allow-branch-default', 'b=main; git push origin HEAD:${b:-main}'],
  ['allow-hookspath-status', 'git -c core.hooksPath=/dev/null status'],
  ['allow-quoted-positional-refspec', 'git push origin "HEAD:${1}"'],
  ['allow-quoted-transform-refspec', 'b=x; git push origin "HEAD:${b#refs/}"'],
  ['allow-attached-value-quoted', 'git commit --message="$1"'],
  ['allow-attached-value-quoted-body', 'body=$(echo hi); git commit --message="$body"'],
  ['allow-dq-array-keys-star', 'declare -A a=([--no-verify]=1 [b]=2); git commit -m m "x${!a[*]}"'],
  ['allow-for-literal-list', 'for o in a b; do git push origin "$o"; done'],
  ['allow-read-unused-variable', 'read o <<< x; echo "$o"; git commit -m done'],
  ['allow-mapfile-unused-variable', 'mapfile -t l < notes.txt; git push origin main'],
];

for (const [id, command] of GIT_GATE_ALLOW_1468) {
  test(`#1468 ${id} allows on feature`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of ALL_BASH_HOOKS) {
        expectStatus(bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, `${hook}: ${command}`);
      }
    });
  });
}

for (const [id, command, reason] of GIT_GATE_REASON_1468) {
  test(`#1468 ${id} blocks with a stable reason (guard and dispatcher)`, () => {
    withRepos(({ featureRepo }) => {
      for (const hook of GUARD_AND_DISPATCH) {
        const res = bashHook(hook, command, { cwd: featureRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook}: ${command}`);
        assert.match(String(res.stderr), /\[bash-guard\] blocked:/, `${hook}: ${command}`);
        assert.match(String(res.stderr), reason, `${hook}: ${command}`);
      }
    });
  });
}

run('hook-bypass-git-gate');
