'use strict';

// Bypass-resistance suite for the PreToolUse hooks (#1380, spec #1367 T11).
//
// Drives pre-bash-guard.sh, pretool-git-gate.sh, pre-bash-dispatch.sh and
// pre-edit-guard.sh with JSON payloads and asserts block (exit 2) and allow
// (exit 0) behaviour for the shell-obfuscation families an agent could use to
// slip past a pattern gate: quote-split words ("g"it), backslash-split words,
// $'...' ANSI-C quoting, newlines in commands and paths, and the .env / .git/
// path blacklists.
//
// The eight bypasses this suite first recorded as skipped cases (#1389) are
// closed: every case below runs and must pass against the current hooks.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');

const BLOCK = 2;
const ALLOW = 0;

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}

// A repo with one commit on the given branch (initial branch forced via -M).
function mkBranchRepo(branch, { prefix = 'dhpk-bypass-' } = {}) {
  const dir = mkRepo({ prefix, gitConfig: true });
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  git(dir, ['branch', '-M', branch]);
  return dir;
}

function withRepos(fn) {
  const protectedRepo = mkBranchRepo('main');
  const featureRepo = mkBranchRepo('feature/x');
  try {
    return fn({ protectedRepo, featureRepo });
  } finally {
    rmRepo(protectedRepo);
    rmRepo(featureRepo);
  }
}

function bashHook(hook, command, { cwd, env = {} } = {}) {
  return runHook(hook, {
    cwd,
    payload: { tool_input: { command } },
    env,
    deleteEnv: ['DHPK_ALLOW_NO_VERIFY', 'DHPK_BRANCH_SAFETY'],
  });
}

function editHook(filePath, env = {}) {
  return runHook('pre-edit-guard.sh', {
    payload: { tool_input: { file_path: filePath } },
    env,
    deleteEnv: ['GUARD_EXTRA_PATTERNS'],
  });
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected exit ${status}, got ${res.status}; stderr=${res.stderr}`);
}

// ---------------------------------------------------------------------------
// pre-bash-guard.sh — --no-verify gate under shell obfuscation
// ---------------------------------------------------------------------------

const NO_VERIFY_BLOCKED = [
  ['quote-split command word', '"g"it commit -m x --no-verify'],
  ['quote-split inside word', 'g"it" commit -m x --no-verify'],
  ['single-quote-split command word', "'g'it push origin main --no-verify"],
  ['backslash before command word', '\\git commit --no-verify -m x'],
  ['backslash inside command word', 'g\\it commit --no-verify -m x'],
  ['quoted subcommand', 'git "commit" --no-verify'],
  ['quote-split subcommand', 'git comm"it" -m x --no-verify'],
  ['second command on a new line', 'echo hi\ngit commit --no-verify'],
  ['$\'...\' message then real flag', "git commit -m $'a\\nb' --no-verify"],
  ['commit -n short form', 'git commit -n -m x'],
];

for (const [label, command] of NO_VERIFY_BLOCKED) {
  test(`pre-bash-guard blocks --no-verify: ${label}`, () => {
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, command);
    assert.match(res.stderr, /--no-verify/);
  });
}

const NO_VERIFY_ALLOWED = [
  ['flag text inside single quotes', "git commit -m '--no-verify'"],
  ['flag text inside $\'...\'', "git commit -m $'--no-verify'"],
  ['flag on the next line is a separate command', 'git commit -m x\n--no-verify'],
  ['quote-split git without the flag', '"g"it status'],
  ['push dry-run short form', 'git push -n origin main'],
];

for (const [label, command] of NO_VERIFY_ALLOWED) {
  test(`pre-bash-guard allows: ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  });
}

test('pre-bash-guard decodes JSON \\u escapes before matching (quote-split via \\u0022)', () => {
  const res = runHook('pre-bash-guard.sh', {
    payload: '{"tool_input":{"command":"\\u0022g\\u0022it commit -m x --no-verify"}}',
    deleteEnv: ['DHPK_ALLOW_NO_VERIFY'],
  });
  expectStatus(res, BLOCK, 'escaped quote payload');
});

test('pre-bash-guard honours the explicit DHPK_ALLOW_NO_VERIFY=1 opt-out', () => {
  const res = runHook('pre-bash-guard.sh', {
    payload: { tool_input: { command: '"g"it commit -m x --no-verify' } },
    env: { DHPK_ALLOW_NO_VERIFY: '1' },
  });
  expectStatus(res, ALLOW, 'opt-out');
});

test("pre-bash-guard blocks --no-verify via $'...' ANSI-C quoted command word", () => {
  for (const command of ["$'git' commit --no-verify -m x", "$'\\x67it' commit --no-verify -m x", "$'g'it push --no-verify"]) {
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, command);
    assert.match(res.stderr, /--no-verify/);
  }
});

// ---------------------------------------------------------------------------
// pre-bash-guard.sh — .env writes and rm -rf under shell obfuscation
// ---------------------------------------------------------------------------

const ENV_WRITE_BLOCKED = [
  ['double-quoted target', 'echo x > ".env"'],
  ['single-quoted target', "echo x > '.env'"],
  ['backslash-escaped target', 'echo x > \\.env'],
  ['append to nested path', 'echo x >> config/.env'],
  ['tee with quoted target', 'tee ".env" <<< x'],
  ['.env.local variant', 'echo x > .env.local'],
  ['.env on a later line', 'echo x > ok.txt\necho y > .env'],
  ['.env after an allowlisted template on a prior line', 'echo x > .env.example\necho y > .env'],
  ['newline inside $\'...\' directory then .env', "echo x >> $'dir\\n/.env'"],
  ['redirect text inside double quotes is conservatively blocked', 'echo "a > .env"'],
];

for (const [label, command] of ENV_WRITE_BLOCKED) {
  test(`pre-bash-guard blocks .env write: ${label}`, () => {
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, command);
    assert.match(res.stderr, /\.env/);
  });
}

const ENV_WRITE_ALLOWED = [
  ['.env.example template', 'echo x > .env.example'],
  ['.env.template template', 'echo x > config/.env.template'],
  ['.env.sample after another write', 'echo x > ok.txt\necho y > .env.sample'],
  ['unrelated file with env in the name', 'echo x > env.txt'],
  ['multi-line commands with no .env target', 'echo x > a.txt\necho y > b.txt'],
];

for (const [label, command] of ENV_WRITE_ALLOWED) {
  test(`pre-bash-guard allows .env look-alike: ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  });
}

test('pre-bash-guard blocks rm -rf on a system root through backslash and quotes', () => {
  for (const command of ['\\rm -rf /etc', 'rm -rf "/etc"', "rm -rf '/etc/nginx'"]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

test('pre-bash-guard allows rm -rf on a scratch path', () => {
  expectStatus(bashHook('pre-bash-guard.sh', 'rm -rf /tmp/dhpk-scratch-dir'), ALLOW, 'rm tmp');
});

const ENV_WRITE_DECODED_BLOCKED = [
  ['quote concatenation in the target', 'echo x > ".e"nv'],
  ['empty quotes inside the target', 'echo x > .e""nv'],
  ['ANSI-C quoted target', "echo x > $'.env'"],
  ['ANSI-C hex-escaped target', "echo x > $'\\x2eenv'"],
  ['quoted path containing a space', 'printf x > "dir with space/.env"'],
  ['redirect glued to the quoted target', 'echo x >".e"nv'],
  ['fd-numbered redirect', "echo x 2>$'.env'"],
  ['&> redirect', 'echo x &> ".e"nv'],
  ['tee with a split-quoted target', "echo x | tee -a '.e'nv"],
  ['tee with a quoted command word', 'echo x | t"ee" .env'],
];

for (const [label, command] of ENV_WRITE_DECODED_BLOCKED) {
  test(`pre-bash-guard blocks .env write after decoding quotes: ${label}`, () => {
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, command);
    assert.match(res.stderr, /\.env/);
  });
}

const ENV_WRITE_DECODED_ALLOWED = [
  ['split-quoted template target', 'echo x > ".env".example'],
  ['ANSI-C quoted template target', "echo x > $'.env.template'"],
  ['quoted path with a space to a template', 'printf x > "dir with space/.env.sample"'],
  ['quoted non-env file with a space', 'printf x > "dir with space/notes.txt"'],
  ['fd duplication', 'echo x >&2'],
];

for (const [label, command] of ENV_WRITE_DECODED_ALLOWED) {
  test(`pre-bash-guard allows decoded non-secret target: ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  });
}

const RM_DECODED_BLOCKED = [
  ['quote-split rm', 'r"m" -rf /etc'],
  ['ANSI-C quoted rm', "$'rm' -rf /usr"],
  ['ANSI-C quoted target', "rm -rf $'/etc'"],
  ['double-quoted root', 'rm -rf "/"'],
  ['single-quoted root', "rm -rf '/'"],
  ['split-quoted system dir', 'rm -rf /"et"c'],
  ['quoted shallow home', 'rm -rf "/home/u"'],
  ['dangerous path as a later argument', 'rm -rf /tmp/x "/etc"'],
  ['.. traversal into a system dir', 'rm -rf /tmp/../etc'],
  ['quoted .. traversal to the root', 'rm -rf "/tmp/x/../.."'],
  ['dot segment before home', 'rm -rf /./home/u'],
];

for (const [label, command] of RM_DECODED_BLOCKED) {
  test(`pre-bash-guard blocks rm -rf after decoding quotes: ${label}`, () => {
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, command);
    assert.match(res.stderr, /rm -rf/);
  });
}

test('pre-bash-guard allows decoded rm -rf on workspace and scratch paths', () => {
  for (const command of ['rm -rf "/tmp/dhpk scratch"', "rm -rf $'/home/u/projects/repo/dist'", 'r"m" -rf ./build', 'echo "rm -rf /etc" > notes.txt', 'rm -rf /tmp/x/../y']) {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  }
});

// ---------------------------------------------------------------------------
// pretool-git-gate.sh — protected-branch gate (block mode) under obfuscation
// ---------------------------------------------------------------------------

const BLOCK_MODE = { DHPK_BRANCH_SAFETY: 'block' };

const GATE_BLOCKED = [
  ['plain commit', 'git commit -m x'],
  ['quote-split command word', '"g"it commit -m x'],
  ['quote-split inside word', 'g"it" push origin main'],
  ['single-quote-split command word', "'g'it commit -m x"],
  ['backslash before command word', '\\git commit -m x'],
  ['backslash inside command word', 'g\\it reset --hard HEAD'],
  ['quoted subcommand', 'git "commit" -m x'],
  ['quote-split subcommand', 'git comm"it" -m x'],
  ['mutating git after a newline', 'echo hi\ngit commit -m x'],
  ['mutating git after a harmless git', 'git status && git commit -m x'],
  ['dry-run does not exempt a later commit', 'git commit --dry-run -m a && git commit -m b'],
];

for (const [label, command] of GATE_BLOCKED) {
  test(`pretool-git-gate (block mode) blocks on main: ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      const res = bashHook('pretool-git-gate.sh', command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, command);
      assert.match(res.stderr, /branch-safety/);
    });
  });
}

const GATE_ALLOWED_ON_MAIN = [
  ['read-only git', 'git status'],
  ['quote-split read-only git', '"g"it log --oneline'],
  ['commit dry-run', 'git commit --dry-run -m x'],
  ['git text inside echo string', 'echo "git commit -m x"'],
  ['git text inside a comment', 'echo hi # git commit -m x'],
  ['help flag', 'git commit --help'],
  ['non-git command', 'ls -la'],
];

for (const [label, command] of GATE_ALLOWED_ON_MAIN) {
  test(`pretool-git-gate (block mode) allows on main: ${label}`, () => {
    withRepos(({ protectedRepo }) => {
      expectStatus(bashHook('pretool-git-gate.sh', command, { cwd: protectedRepo, env: BLOCK_MODE }), ALLOW, command);
    });
  });
}

test('pretool-git-gate allows quote-split and backslash commits on a feature branch', () => {
  withRepos(({ featureRepo }) => {
    for (const command of ['"g"it commit -m x', '\\git commit -m x', 'git "commit" -m x']) {
      expectStatus(bashHook('pretool-git-gate.sh', command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, command);
    }
  });
});

test('pretool-git-gate resolves git -C against the targeted repo, not the session checkout', () => {
  withRepos(({ protectedRepo, featureRepo }) => {
    expectStatus(
      bashHook('pretool-git-gate.sh', `git -C "${protectedRepo}" commit -m x`, { cwd: featureRepo, env: BLOCK_MODE }),
      BLOCK,
      '-C protected from feature cwd'
    );
    expectStatus(
      bashHook('pretool-git-gate.sh', `git -C "${featureRepo}" commit -m x`, { cwd: protectedRepo, env: BLOCK_MODE }),
      ALLOW,
      '-C feature from protected cwd'
    );
  });
});

test('pretool-git-gate treats a newline inside a quoted -C path as part of the path', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-bypass-nl-')));
  const nlRepo = path.join(base, 're\npo');
  const featureRepo = mkBranchRepo('feature/x');
  try {
    fs.mkdirSync(nlRepo);
    git(nlRepo, ['init', '-q']);
    git(nlRepo, ['-c', 'user.email=t@t.test', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    git(nlRepo, ['branch', '-M', 'main']);
    for (const quoted of [`"${nlRepo}"`, `'${nlRepo}'`]) {
      const res = bashHook('pretool-git-gate.sh', `git -C ${quoted} commit -m x`, {
        cwd: featureRepo,
        env: BLOCK_MODE,
      });
      expectStatus(res, BLOCK, `quoted newline path ${quoted}`);
    }
    // read-only verb against the same newline path is still allowed
    expectStatus(
      bashHook('pretool-git-gate.sh', `git -C "${nlRepo}" status`, { cwd: featureRepo, env: BLOCK_MODE }),
      ALLOW,
      'status on newline path'
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    rmRepo(featureRepo);
  }
});

test('pretool-git-gate fails closed when the -C path uses $\'...\' (not a literal path)', () => {
  withRepos(({ featureRepo }) => {
    const res = bashHook('pretool-git-gate.sh', "git -C $'/tmp/a\\nb' commit -m x", {
      cwd: featureRepo,
      env: BLOCK_MODE,
    });
    expectStatus(res, BLOCK, '-C $-quoted path');
    assert.match(res.stderr, /not a literal path/);
  });
});

test('pretool-git-gate warn mode (default) reminds but does not block an obfuscated commit', () => {
  withRepos(({ protectedRepo }) => {
    const res = bashHook('pretool-git-gate.sh', '"g"it commit -m x', { cwd: protectedRepo });
    expectStatus(res, ALLOW, 'warn mode');
    assert.match(res.stdout, /branch-safety/);
  });
});

test('pretool-git-gate off mode stays silent even for an obfuscated commit on main', () => {
  withRepos(({ protectedRepo }) => {
    const res = bashHook('pretool-git-gate.sh', '"g"it commit -m x', {
      cwd: protectedRepo,
      env: { DHPK_BRANCH_SAFETY: 'off' },
    });
    expectStatus(res, ALLOW, 'off mode');
    assert.strictEqual(res.stdout, '');
  });
});

test("pretool-git-gate (block mode) blocks a $'git' commit on a protected branch", () => {
  withRepos(({ protectedRepo }) => {
    for (const command of ["$'git' commit -m x", "$'\\147it' commit -m x"]) {
      const res = bashHook('pretool-git-gate.sh', command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, command);
      assert.match(res.stderr, /branch-safety/);
    }
  });
});

test("pretool-git-gate allows a $'git' commit on a feature branch", () => {
  withRepos(({ featureRepo }) => {
    expectStatus(bashHook('pretool-git-gate.sh', "$'git' commit -m x", { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, 'feature');
  });
});

// ---------------------------------------------------------------------------
// pre-bash-dispatch.sh — composed Bash entry (guard first, then git gate)
// ---------------------------------------------------------------------------

test('pre-bash-dispatch propagates the guard block for quote-split --no-verify', () => {
  withRepos(({ featureRepo }) => {
    const res = bashHook('pre-bash-dispatch.sh', '"g"it commit -m x --no-verify', { cwd: featureRepo });
    expectStatus(res, BLOCK, 'dispatch guard');
    assert.match(res.stderr, /bash-guard/);
  });
});

test('pre-bash-dispatch propagates the git-gate block for backslash and quote-split commits on main', () => {
  withRepos(({ protectedRepo }) => {
    for (const command of ['\\git commit -m x', '"g"it commit -m x', 'echo hi\ngit commit -m x']) {
      const res = bashHook('pre-bash-dispatch.sh', command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, command);
      assert.match(res.stderr, /branch-safety/);
    }
  });
});

test('pre-bash-dispatch propagates the guard block for quoted .env redirects', () => {
  withRepos(({ featureRepo }) => {
    for (const command of ['echo x > ".env"', 'tee ".env" <<< x', 'echo x > ok.txt\necho y > .env']) {
      const res = bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo });
      expectStatus(res, BLOCK, command);
      assert.match(res.stderr, /\.env/);
    }
  });
});

test('pre-bash-dispatch allows benign look-alikes on a protected branch', () => {
  withRepos(({ protectedRepo }) => {
    for (const command of [
      'git status',
      "git commit --dry-run -m '--no-verify'",
      'echo x > .env.example',
      'echo "git commit"',
    ]) {
      expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: protectedRepo, env: BLOCK_MODE }), ALLOW, command);
    }
  });
});

test('pre-bash-dispatch allows a quoted flag message on a feature branch', () => {
  withRepos(({ featureRepo }) => {
    expectStatus(
      bashHook('pre-bash-dispatch.sh', "git commit -m '--no-verify' --dry-run", { cwd: featureRepo, env: BLOCK_MODE }),
      ALLOW,
      'quoted flag text'
    );
  });
});

test("pre-bash-dispatch blocks a $'git' --no-verify commit through the whole chain", () => {
  withRepos(({ featureRepo }) => {
    const res = bashHook('pre-bash-dispatch.sh', "$'git' commit --no-verify -m x", { cwd: featureRepo });
    expectStatus(res, BLOCK, 'dispatch ansi-c git');
    assert.match(res.stderr, /bash-guard/);
  });
});

test("pre-bash-dispatch propagates the git-gate block for a $'git' commit on main", () => {
  withRepos(({ protectedRepo }) => {
    const res = bashHook('pre-bash-dispatch.sh', "$'git' commit -m x", { cwd: protectedRepo, env: BLOCK_MODE });
    expectStatus(res, BLOCK, 'dispatch ansi-c gate');
    assert.match(res.stderr, /branch-safety/);
  });
});

// ---------------------------------------------------------------------------
// pre-edit-guard.sh — .env / .git/ blacklist, newline and metacharacter paths
// ---------------------------------------------------------------------------

const EDIT_BLOCKED = [
  ['.env at repo root', '.env'],
  ['.env nested', 'a/b/.env'],
  ['.env.production suffix', 'config/.env.production'],
  ['.env.local suffix', '.env.local'],
  ['.git/config', '.git/config'],
  ['nested .git hook', 'a/.git/hooks/pre-commit'],
  ['trailing-slash .git directory', 'a/.git/'],
  ['parent traversal into .git', '../.git/config'],
  ['dot segment before .git', 'a/./.git/config'],
  ['doubled slash before .git', 'a//.git/config'],
  ['newline then .env', 'x\n.env'],
  ['.env then trailing newline', '.env\n'],
  ['newline then .git/config', 'foo\n.git/config'],
  ['lock file', 'package-lock.json'],
  ['semicolon metacharacter', '.env;x'],
  ['command substitution', 'a/$(touch pwn)'],
  ['backtick metacharacter', 'a/`id`'],
  ['pipe metacharacter', 'a|b'],
  ['ampersand metacharacter', 'a&b'],
];

for (const [label, filePath] of EDIT_BLOCKED) {
  test(`pre-edit-guard blocks: ${label}`, () => {
    expectStatus(editHook(filePath), BLOCK, JSON.stringify(filePath));
  });
}

const EDIT_ALLOWED = [
  ['.env.example template', '.env.example'],
  ['nested .env.template', 'x/.env.template'],
  ['.gitignore is not .git/', '.gitignore'],
  ['.github workflow', '.github/workflows/ci.yml'],
  ['.gitmodules', 'a/.gitmodules'],
  ['.envrc is not .env', 'a/.envrc'],
  ['.environment is not .env', 'a/.environment'],
  ['env-suffixed basename', 'a.env.bak'],
  ['plain path containing a newline', 'notes\nplain.txt'],
  ['claude session scratchpad .env', '/tmp/claude-session/.env'],
  ['empty file_path', ''],
];

for (const [label, filePath] of EDIT_ALLOWED) {
  test(`pre-edit-guard allows: ${label}`, () => {
    expectStatus(editHook(filePath), ALLOW, JSON.stringify(filePath));
  });
}

test('pre-edit-guard decodes JSON \\u escapes before matching (\\u002eenv)', () => {
  const res = runHook('pre-edit-guard.sh', {
    payload: '{"tool_input":{"file_path":"config/\\u002eenv"}}',
  });
  expectStatus(res, BLOCK, 'escaped dot payload');
  assert.match(res.stderr, /blocked sensitive file/);
});

test('pre-edit-guard decodes a JSON \\n escape into a real newline before matching', () => {
  const res = runHook('pre-edit-guard.sh', {
    payload: '{"tool_input":{"file_path":"x\\n.git/config"}}',
  });
  expectStatus(res, BLOCK, 'escaped newline payload');
});

test('pre-edit-guard honours GUARD_EXTRA_PATTERNS and fails closed on a broken regex', () => {
  expectStatus(editHook('src/gen/out.js', { GUARD_EXTRA_PATTERNS: 'gen/' }), BLOCK, 'extra pattern');
  expectStatus(editHook('src/app/out.js', { GUARD_EXTRA_PATTERNS: 'gen/' }), ALLOW, 'extra pattern miss');
  expectStatus(editHook('src/app/out.js', { GUARD_EXTRA_PATTERNS: '(' }), BLOCK, 'broken regex');
});

const EDIT_NORMALISED_BLOCKED = [
  ['scratchpad prefix escaped by ..', '/tmp/claude-x/../../home/u/proj/.env'],
  ['scratchpad prefix escaped into .git', '/tmp/claude-x/../etc/.git/config'],
  ['private scratchpad escaped by ..', '/private/tmp/claude-x/../../Users/u/.env'],
  ['scratchpad dir itself then ..', '/tmp/claude-x/sub/../../x/.env'],
  ['dot segment hides the scratchpad prefix', '/tmp/./claude-x/../../repo/.git/HEAD'],
  ['uppercase .ENV', '.ENV'],
  ['mixed-case nested .Env.local', 'a/.Env.local'],
  ['mixed-case .Git/config', '.Git/config'],
  ['uppercase nested .GIT hook', 'a/.GIT/hooks/pre-commit'],
  ['bare .git gitlink file', '.git'],
  ['nested bare .git gitlink file', 'sub/module/.git'],
  ['bare .git with a trailing dot segment', 'a/.git/.'],
];

for (const [label, filePath] of EDIT_NORMALISED_BLOCKED) {
  test(`pre-edit-guard blocks after normalising the path: ${label}`, () => {
    const res = editHook(filePath);
    expectStatus(res, BLOCK, JSON.stringify(filePath));
    assert.match(res.stderr, /blocked sensitive file/);
  });
}

const EDIT_NORMALISED_ALLOWED = [
  ['scratchpad path with an internal ..', '/tmp/claude-x/a/../.env'],
  ['scratchpad path with a doubled slash', '/tmp//claude-x//.env'],
  ['private scratchpad .git', '/private/tmp/claude-x/repo/.git/config'],
  ['mixed-case template', 'a/.ENV.Example'],
  ['uppercase .GITIGNORE is not .git', '.GITIGNORE'],
  ['.git-blame-ignore-revs', '.git-blame-ignore-revs'],
  ['directory named git', 'a/git/config'],
];

for (const [label, filePath] of EDIT_NORMALISED_ALLOWED) {
  test(`pre-edit-guard allows after normalising the path: ${label}`, () => {
    expectStatus(editHook(filePath), ALLOW, JSON.stringify(filePath));
  });
}

test('pre-edit-guard does not let a scratchpad symlink lead out of the scratchpad', () => {
  const scratch = fs.mkdtempSync('/tmp/claude-dhpk-bypass-');
  const outside = fs.mkdtempSync('/tmp/dhpk-bypass-outside-');
  try {
    fs.mkdirSync(path.join(scratch, 'real'));
    fs.symlinkSync(outside, path.join(scratch, 'out'));
    fs.symlinkSync(path.join(outside, '.env'), path.join(scratch, '.env'));
    expectStatus(editHook(path.join(scratch, 'out', '.env')), BLOCK, 'symlinked directory');
    expectStatus(editHook(path.join(scratch, 'out', 'new', '.git', 'config')), BLOCK, 'symlinked ancestor');
    expectStatus(editHook(path.join(scratch, '.env')), BLOCK, 'symlink as the final segment');
    expectStatus(editHook(path.join(scratch, 'real', '.env')), ALLOW, 'real scratchpad directory');
    expectStatus(editHook(path.join(scratch, 'not-yet', 'made', '.env')), ALLOW, 'missing scratchpad subdirectory');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Review round (#1389): NUL truncation in $'...', backslash-newline inside
// double quotes, and rm globs / traversal to a glob.
// ---------------------------------------------------------------------------

const NUL_TRUNCATED_GIT = [
  "$'git\\x00q' commit --no-verify -m x",
  "$'git\\0q' commit --no-verify -m x",
  "$'git\\c@q' commit --no-verify -m x",
  "$'git\\u0000q' commit --no-verify -m x",
  "$'git\\400q' commit --no-verify -m x",
];

for (const hook of ['pre-bash-guard.sh', 'pre-bash-dispatch.sh']) {
  test(`${hook} blocks --no-verify when $'...' truncates at a decoded NUL`, () => {
    withRepos(({ featureRepo }) => {
      for (const command of NUL_TRUNCATED_GIT) {
        const res = bashHook(hook, command, { cwd: featureRepo });
        expectStatus(res, BLOCK, command);
        assert.match(res.stderr, /--no-verify/);
      }
    });
  });
}

test("pretool-git-gate (block mode) blocks a NUL-truncated $'git' commit on main", () => {
  withRepos(({ protectedRepo }) => {
    for (const command of ["$'git\\x00q' commit -m x", "$'gi\\x74\\0' commit -m x"]) {
      const res = bashHook('pretool-git-gate.sh', command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, command);
      assert.match(res.stderr, /branch-safety/);
    }
  });
});

const REVIEW_GUARD_BLOCKED = [
  ['rm target truncated by \\x00', "rm -rf $'/etc\\x00junk'"],
  ['rm target truncated by \\0', "rm -rf $'/etc\\0junk'"],
  ['rm target truncated by \\c@', "rm -rf $'/etc\\c@junk'"],
  ['shallow home truncated by NUL', "rm -rf $'/home/u\\x00/projects/x'"],
  ['NUL skip honours an escaped quote', "rm -rf $'/etc\\x00a\\'b'"],
  ['.env redirect truncated by NUL', "echo x > $'.env\\x00q'"],
  ['tee .env truncated before a template suffix', "echo x | tee $'.env\\0.example'"],
  ['backslash-newline inside a double-quoted rm target', 'rm -rf "/et\\\nc"'],
  ['backslash-newline inside a double-quoted .env target', 'echo x > ".en\\\nv"'],
  ['rm with a glob in the first segment', 'rm -rf /[e]tc'],
  ['rm with a ? glob in the first segment', 'rm -rf /et?'],
  ['rm with a glob under a shallow root', 'rm -rf /home/*'],
  ['rm traversal to a root glob', 'rm -rf /tmp/../*'],
  ['rm traversal to the root', 'rm -rf /tmp/..'],
];

for (const [label, command] of REVIEW_GUARD_BLOCKED) {
  test(`pre-bash-guard blocks (review round): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  });
}

test('backslash-newline inside a double-quoted git word is a continuation for all Bash hooks', () => {
  withRepos(({ protectedRepo, featureRepo }) => {
    const command = '"gi\\\nt" commit --no-verify -m x';
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, `guard ${command}`);
    expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo }), BLOCK, `dispatch ${command}`);
    const gate = bashHook('pretool-git-gate.sh', '"gi\\\nt" commit -m x', { cwd: protectedRepo, env: BLOCK_MODE });
    expectStatus(gate, BLOCK, 'gate continuation');
  });
});

// Review round 2 (#1389): a $'\c' right before the closing quote must not
// swallow it, and a brace expansion in the first segment can reach /etc.
const CTRL_C_PREFIX = "echo $'\\c' ; ";

test("pre-bash-guard blocks commands that follow a $'\\c' string", () => {
  for (const command of [
    `${CTRL_C_PREFIX}git commit --no-verify -m x #'`,
    `${CTRL_C_PREFIX}r"m" -rf /etc #'`,
    `${CTRL_C_PREFIX}echo x > ".e"nv #'`,
    "echo $'\\c\\\\' ; git commit --no-verify -m x #'",
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

test("pretool-git-gate and dispatch (block mode) block a commit that follows a $'\\c' string on main", () => {
  withRepos(({ protectedRepo }) => {
    const command = `${CTRL_C_PREFIX}git commit -m x #'`;
    for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
      const res = bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, `${hook} ${command}`);
      assert.match(res.stderr, /branch-safety/);
    }
  });
});

test('pre-bash-dispatch blocks --no-verify that follows a $\'\\c\' string', () => {
  withRepos(({ featureRepo }) => {
    const command = `${CTRL_C_PREFIX}git commit --no-verify -m x #'`;
    expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo }), BLOCK, command);
  });
});

test('pre-bash-guard blocks rm -rf with an expansion character in the first path segment', () => {
  for (const command of [
    'rm -rf /{etc,nonexist}',
    'rm -rf /tmp/../{etc,x}',
    'rm -rf "/"{etc,x}',
    'rm -rf /e`echo t`c',
    'rm -rf /$D',
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

// Review round 3 (#1389): $$ is the PID parameter, so $$'\' is PID plus an
// ordinary '...' string that closes at the next quote.
const PID_PREFIX = "echo $$'\\' ; ";

test("pre-bash-guard blocks commands that follow $$'...'", () => {
  for (const command of [
    `${PID_PREFIX}git commit --no-verify -m x #'`,
    `${PID_PREFIX}r"m" -rf /etc #'`,
    `${PID_PREFIX}echo x > ".e"nv #'`,
    "echo $?'\\' ; git commit --no-verify -m x #'",
    "echo ${x}'\\' ; git commit --no-verify -m x #'",
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

test("pretool-git-gate and dispatch (block mode) block a commit that follows $$'...' on main", () => {
  withRepos(({ protectedRepo }) => {
    const command = `${PID_PREFIX}git commit -m x #'`;
    for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
      const res = bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, `${hook} ${command}`);
      assert.match(res.stderr, /branch-safety/);
    }
  });
});

test("pre-bash-guard decodes $'...' after $$ ($$$'\\x67it' is still git)", () => {
  const res = bashHook('pre-bash-guard.sh', "x=$$$'\\x67it' $'\\x67it' commit --no-verify -m x");
  expectStatus(res, BLOCK, 'ansi-c after pid');
  expectStatus(bashHook('pre-bash-guard.sh', "rm -rf $$$'/etc'"), ALLOW, 'pid-prefixed relative operand');
});

// Review round 4 (#1389): '#' starts a comment only at the start of a word.
// A quote construct, even an empty one or one cut short by a NUL, has already
// started the word (bash 5.2: `echo $''# ; echo RAN` prints # and RAN), and a
// carriage return is an ordinary character, not a word separator.
const OPEN_WORD_HASH = ["$''#", "$'\\x00'#", "$'\\c@'#", "''#", '""#', 'x\r#'];

test('pre-bash-guard does not read a # after an open word as a comment', () => {
  for (const prefix of OPEN_WORD_HASH) {
    const command = `echo ${prefix} ; git commit --no-verify -m x`;
    const res = bashHook('pre-bash-guard.sh', command);
    expectStatus(res, BLOCK, JSON.stringify(command));
    assert.match(res.stderr, /--no-verify/);
  }
});

test('pre-bash-dispatch blocks --no-verify after a # inside an open word', () => {
  withRepos(({ featureRepo }) => {
    for (const prefix of OPEN_WORD_HASH) {
      const command = `echo ${prefix} ; git commit --no-verify -m x`;
      expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo }), BLOCK, JSON.stringify(command));
    }
  });
});

test('pretool-git-gate and dispatch (block mode) block a commit after a # inside an open word on main', () => {
  withRepos(({ protectedRepo }) => {
    for (const prefix of OPEN_WORD_HASH) {
      const command = `echo ${prefix} ; git commit -m x`;
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        const res = bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook} ${JSON.stringify(command)}`);
        assert.match(res.stderr, /branch-safety/);
      }
    }
  });
});

test('pre-bash-guard still treats a # at the start of a word as a comment', () => {
  for (const command of ['echo hi # git commit --no-verify -m x', "echo '' # git commit --no-verify -m x"]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  }
});

test('pre-bash-guard keeps allowing benign NUL, escape and glob forms', () => {
  for (const command of [
    "echo x > $'notes\\x00.env'",
    "echo x > $'.env.example\\x00'",
    'rm -rf /tmp/dhpk-*',
    'rm -rf "/tmp/a\\b"',
    "rm -rf $'/tmp/x\\c@/etc'",
    'echo "a\\b" > notes.txt',
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  }
});

// #1392: pre-existing desyncs. Heredoc bodies are data, ${...}, $(...),
// backticks and subshells are modelled, and syntax the decoder cannot place
// is blocked instead of guessed.
const DESYNC_NO_VERIFY = [
  ['heredoc body with an apostrophe', "cat <<EOF\nit's\nEOF\ngit commit --no-verify -m x\n"],
  ['tab-stripped heredoc', "cat <<-'EOF'\n\tit's\n\tEOF\ngit commit --no-verify -m x"],
  ['nested double quote inside ${...}', 'echo "${x:-"\'"}" ; git commit --no-verify -m x #\''],
  ['command substitution', 'echo $(git commit --no-verify -m x)'],
  ['backtick substitution', 'echo `git commit --no-verify -m x`'],
  ['( followed by #', "(#'\ngit commit --no-verify -m x\n) #'"],
  ['brace group', '{ git commit --no-verify -m x; }'],
  ['if body', 'if true; then git commit --no-verify -m x; fi'],
];

for (const [label, command] of DESYNC_NO_VERIFY) {
  test(`pre-bash-guard and dispatch block --no-verify after a desync: ${label}`, () => {
    withRepos(({ featureRepo }) => {
      expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, `guard ${JSON.stringify(command)}`);
      expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo }), BLOCK, `dispatch ${JSON.stringify(command)}`);
    });
  });
}

test('pretool-git-gate and dispatch (block mode) block a commit on main after a heredoc body', () => {
  withRepos(({ protectedRepo }) => {
    for (const command of ["cat <<EOF\nit's\nEOF\ngit commit -m x", "(#'\ngit commit -m x\n) #'", 'echo $(git commit -m x)']) {
      for (const hook of ['pretool-git-gate.sh', 'pre-bash-dispatch.sh']) {
        const res = bashHook(hook, command, { cwd: protectedRepo, env: BLOCK_MODE });
        expectStatus(res, BLOCK, `${hook} ${JSON.stringify(command)}`);
        assert.match(res.stderr, /branch-safety/);
      }
    }
  });
});

test('pretool-git-gate allows a heredoc commit message with quotes on a feature branch', () => {
  withRepos(({ featureRepo }) => {
    const command = "git commit -m \"$(cat <<'EOF'\nfix: it's done\n\nNever run `git commit --no-verify`.\nEOF\n)\"";
    expectStatus(bashHook('pretool-git-gate.sh', command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, command);
  });
});

test('pre-bash-guard and dispatch allow a heredoc commit message that mentions blocked commands', () => {
  withRepos(({ featureRepo }) => {
    const command = "git commit -m \"$(cat <<'EOF'\nfix: block `git commit --no-verify`\n\nAlso `echo x > .env` and (cd /tmp).\nEOF\n)\"";
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, `guard ${command}`);
    expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo }), ALLOW, `dispatch ${command}`);
  });
});

test('pre-bash-guard blocks rm in a subshell and a relative rm that climbs to a system directory', () => {
  for (const command of ['(rm -rf /etc)', 'cd /tmp && rm -rf ../etc', 'cd /etc && rm -rf nginx', 'echo $(rm -rf /etc)']) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

test('pre-bash-guard allows relative rm under a scratch directory and plain substitutions', () => {
  for (const command of [
    'cd /tmp/x && rm -rf ../y',
    'rm -rf ./node_modules dist',
    'x=$(git rev-parse HEAD) && echo "$x"',
    'diff <(ls a) <(ls b)',
    'echo "${HOME:-/tmp}"',
    "cat <<< \"it's\"",
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, command);
  }
});

test('pre-bash-guard blocks syntax the decoder cannot place', () => {
  const res = bashHook('pre-bash-guard.sh', 'x=$(case a in a) echo ;; esac)');
  expectStatus(res, BLOCK, 'case inside $(...)');
  assert.match(res.stderr, /unsupported shell syntax/);
});

test('pre-bash-dispatch blocks deeply nested substitutions with exit 2, not a crash', () => {
  const tail = ' ; git commit --no-verify -m x';
  for (const command of [
    `echo ${'$('.repeat(2000)}true${')'.repeat(2000)}${tail}`,
    `echo ${'${x:-'.repeat(2000)}a${'}'.repeat(2000)}${tail}`,
    `echo ${'${x:-"'.repeat(2000)}a${'"}'.repeat(2000)}${tail}`,
    `cat ${'<('.repeat(2000)}true${')'.repeat(2000)}${tail}`,
  ]) {
    const res = runHook('pre-bash-dispatch.sh', {
      payload: { tool_input: { command } }, deleteEnv: ['DHPK_ALLOW_NO_VERIFY', 'DHPK_BRANCH_SAFETY'], timeout: 60000,
    });
    expectStatus(res, BLOCK, command.slice(0, 20));
  }
});

// A child hook that crashes (any status other than 0 or 2) must still block:
// Claude Code treats only exit 2 as a block.
function withCrashingRoot(fn) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-crash-root-'));
  try {
    fs.cpSync(path.join(__dirname, '..', 'scripts'), path.join(root, 'scripts'), { recursive: true });
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('pre-bash-dispatch maps a crashed or failing child hook to exit 2', () => {
  for (const [child, body] of [
    ['pre-bash-guard.sh', 'cat >/dev/null; kill -SEGV $$'],
    ['pre-bash-guard.sh', 'cat >/dev/null; exit 1'],
    ['pretool-git-gate.sh', 'cat >/dev/null; exit 3'],
  ]) {
    withCrashingRoot((root) => {
      fs.writeFileSync(path.join(root, 'scripts', 'hooks', child), `#!/usr/bin/env bash\n${body}\n`);
      const res = runHook(path.join(root, 'scripts', 'hooks', 'pre-bash-dispatch.sh'), {
        payload: { tool_input: { command: 'ls' } }, pluginRoot: root,
      });
      expectStatus(res, BLOCK, `${child}: ${body}`);
    });
  }
});

test('pre-bash-dispatch keeps a cd inside a subshell from moving a later commit (block mode)', () => {
  withRepos(({ featureRepo }) => {
    fs.mkdirSync(path.join(featureRepo, 'sub'));
    const command = '(cd sub && ls) && git commit --allow-empty -m x';
    expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: featureRepo, env: BLOCK_MODE }), ALLOW, command);
  });
});

test('pre-bash-guard blocks substitutions inside single quotes of a double-quoted ${...}', () => {
  for (const command of [
    'echo "${x:-\'$(git commit --no-verify -m x)\'}"',
    'echo "${x:-\'`git commit --no-verify -m x`\'}"',
    "cat <<EOF\n${x:-'$(git commit --no-verify -m x)'}\nEOF",
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, JSON.stringify(command));
  }
});

test("pre-bash-guard blocks commands after '\\' inside a double-quoted ${...}", () => {
  for (const command of [
    'echo "${x:-\'\\\'}" ; git commit --no-verify -m x #\'"',
    'echo "${x#\'\\\'}" ; git commit --no-verify -m x #\'"',
  ]) {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, command);
  }
});

test('pre-bash-dispatch (block mode) does not trust a cd that may not run', () => {
  withRepos(({ protectedRepo, featureRepo }) => {
    for (const command of [
      `if false; then cd ${featureRepo}; fi; git commit -m x`,
      `while false; do cd ${featureRepo}; done; git commit -m x`,
      `case a in b) cd ${featureRepo};; esac; git commit -m x`,
      `f() { cd ${featureRepo}; }; git commit -m x`,
      `false && cd ${featureRepo}; git commit -m x`,
    ]) {
      const res = bashHook('pre-bash-dispatch.sh', command, { cwd: protectedRepo, env: BLOCK_MODE });
      expectStatus(res, BLOCK, command);
    }
    for (const command of [
      `coproc cd ${featureRepo}; git commit -m x`,
      `if false; then "fi"; cd ${featureRepo}; fi; git commit -m x`,
      `pushd ${featureRepo} && git commit -m x`,
    ]) {
      expectStatus(bashHook('pre-bash-dispatch.sh', command, { cwd: protectedRepo, env: BLOCK_MODE }), BLOCK, command);
    }
    expectStatus(
      bashHook('pre-bash-dispatch.sh', `command cd ${protectedRepo} && git commit -m x`, { cwd: featureRepo, env: BLOCK_MODE }),
      BLOCK,
      'command cd into a protected repo',
    );
    const chained = `cd ${featureRepo} && git commit --allow-empty -m x`;
    expectStatus(bashHook('pre-bash-dispatch.sh', chained, { cwd: protectedRepo, env: BLOCK_MODE }), ALLOW, chained);
  });
});

test('pre-edit-guard blocks Windows-equivalent .env and .git names', () => {
  for (const filePath of ['.env ', '.env.', '.env::$DATA', '.git::$INDEX_ALLOCATION/config', 'a/.git /config']) {
    expectStatus(editHook(filePath), BLOCK, JSON.stringify(filePath));
  }
  for (const filePath of ['.envrc', 'src/.env.example', 'docs/environment.md']) {
    expectStatus(editHook(filePath), ALLOW, JSON.stringify(filePath));
  }
});

// ---------------------------------------------------------------------------
// Credential Guard text-scope bypasses (#1411, ADR 0037)
//
// Each row states the secret read in the command text, so it is inside the
// Text Guard Scope: the guard must block it, never read it as data.
// ---------------------------------------------------------------------------

const SHL = '<' + '<'; // keeps the heredoc operator out of grep-style scans of this file
const READ_ENV = 'cat .env';
const HEREDOC_READ = (opener) => `${opener}${SHL}'EOF'\n${READ_ENV}\nEOF\n`;

const CREDENTIAL_BYPASSES = [
  ['nesting: ${..$(echo })<< y } hides later lines', `echo \${x:-$(echo })${SHL} y }\n${READ_ENV}\ny`],
  ['nesting: $[ a[1] << y ] hides later lines', `echo $[ a[1] ${SHL} y ]\n${READ_ENV}\ny`],
  ['nesting: backtick closes ${..} early', `echo \${x:-\`echo }\`${SHL} y }\n${READ_ENV}\ny`],
  ['nesting: $(echo }) inside a substitution', `z=$(echo \${x:-$(echo })${SHL} y }\n${READ_ENV}\ny\n)`],
  ['nesting: $[ a[1] << y ] inside a substitution', `z=$(echo $[ a[1] ${SHL} y ]\n${READ_ENV}\ny\n)`],
  ['shell list: fish reads the heredoc', `fish ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['shell list: csh reads the heredoc', `csh ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['shell list: tcsh reads the heredoc', `tcsh ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['shell list: busybox ash reads the heredoc', `busybox ash ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['shell list: script -c runs a quoted substitution', `script -qc "$(${HEREDOC_READ('cat ')})" /dev/null`],
  ['dq output: substitution in command position', `"$(${HEREDOC_READ('cat ')})"`],
  ['dq output: assigned then run as $x', `x="$(${HEREDOC_READ('cat ')})"; $x`],
  ['dq output: assigned then eval', `x="$(${HEREDOC_READ('cat ')})"; eval "$x"`],
  ['dq output: assigned then run as "$x"', `x="$(${HEREDOC_READ('cat ')})"; "$x"`],
  ['dq output: piped to sh', `echo "$(${HEREDOC_READ('cat ')})" | sh`],
  ['dq output: fish -c', `fish -c "$(${HEREDOC_READ('cat ')})"`],
  ['dynamic filename: cat $(echo .env)', 'cat $(echo .env)'],
  ['dynamic filename: cat "$(echo .env)"', 'cat "$(echo .env)"'],
  ['dynamic filename: cat `echo .env`', 'cat `echo .env`'],
  ['dynamic filename: heredoc body piped to xargs cat', `cat ${SHL}EOF | xargs cat\n.env\nEOF`],
];

for (const [label, command] of CREDENTIAL_BYPASSES) {
  test(`pre-bash-guard blocks credential bypass (#1411): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, JSON.stringify(command));
  });
}

const CREDENTIAL_LOOKALIKES = [
  ['heredoc data inside an assignment substitution', `x=$(cat ${SHL}'EOF'\n${READ_ENV}\nEOF\n)`],
  ['plain heredoc with no reader', `cat ${SHL}EOF\nhello\nEOF`],
  ['echo with a substitution', 'echo $(date)'],
];

for (const [label, command] of CREDENTIAL_LOOKALIKES) {
  test(`pre-bash-guard allows credential look-alike (#1411): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, JSON.stringify(command));
  });
}

const HR = (opener) => HEREDOC_READ(opener);
const SUB = `$(${HR('cat ')})`;

const CREDENTIAL_BYPASSES_ROUND_2 = [
  ['xargs heredoc with an eval on the line', `cat ${SHL}EOF | xargs cat; eval :\n.env\nEOF`],
  ['xargs heredoc with bash -c on the line', `cat ${SHL}EOF | xargs cat; bash -c :\n.env\nEOF`],
  ['busybox xargs heredoc', `cat ${SHL}EOF | busybox xargs cat\n.env\nEOF`],
  ['xargs inside sh -c', `cat ${SHL}EOF | sh -c 'xargs cat'\n.env\nEOF`],
  ['parallel heredoc', `cat ${SHL}EOF | parallel cat\n.env\nEOF`],
  ['reserved word: brace group runs $x', `x="${SUB}"; { $x; }`],
  ['reserved word: if runs $x', `x="${SUB}"; if $x; then :; fi`],
  ['reserved word: ! runs $x', `x="${SUB}"; ! $x`],
  ['reserved word: do runs $x', `x="${SUB}"; for i in 1; do $x; done`],
  ['reserved word: function body runs $x', `x="${SUB}"; f() { $x; }; f`],
  ['reserved word: coproc runs $x', `x="${SUB}"; coproc $x`],
  ['wrapper outside the list runs $x', `x="${SUB}"; fakeroot $x`],
  ['wrapper outside the list runs $x (prlimit)', `x="${SUB}"; prlimit $x`],
  ['trap runs the output', `x="${SUB}"; trap "$x" EXIT`],
  ['dynamic shell reads a heredoc', `$SHELL ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['rbash reads the heredoc', `rbash ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['yash reads the heredoc', `yash ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['posh reads the heredoc', `posh ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['script reads the heredoc', `script -q /dev/null ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['at reads the heredoc', `at now ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['su reads the heredoc', `su paul ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['heredoc piped to a dynamic shell', `cat ${SHL}'EOF' | $SHELL\n${READ_ENV}\nEOF`],
  ['heredoc piped to a braced dynamic shell', `cat ${SHL}'EOF' | "\${SHELL}"\n${READ_ENV}\nEOF`],
  ['read loop runs each heredoc line', `while read -r l; do $l; done ${SHL}'EOF'\n${READ_ENV}\nEOF`],
  ['heredoc piped to a read loop', `cat ${SHL}'EOF' | while read -r l; do $l; done\n${READ_ENV}\nEOF`],
  ['heredoc piped to a read loop reading $f', `cat ${SHL}EOF | while read -r f; do cat "$f"; done\n.env\nEOF`],
  ['xargs name held in a variable', `X=xargs; cat ${SHL}EOF | $X cat\n.env\nEOF`],
];

for (const [label, command] of CREDENTIAL_BYPASSES_ROUND_2) {
  test(`pre-bash-guard blocks credential bypass (#1411 review): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, JSON.stringify(command));
  });
}

const CREDENTIAL_LOOKALIKES_ROUND_2 = [
  ['heredoc after a closed ${..$(..)} frame', `echo \${x:-$(date)} ${SHL}EOF\nhello\nEOF`],
  ['heredoc after a closed $[ a[1] ] frame', `echo $[ a[1] ] ${SHL}EOF\nhello\nEOF`],
  ['heredoc after a closed backtick frame', `echo \`date\` ${SHL}EOF\nhello\nEOF`],
  ['cat $(pwd)/README.md', 'cat $(pwd)/README.md'],
  ['cat "$(pwd)/README.md"', 'cat "$(pwd)/README.md"'],
  ['cat "$(git rev-parse --show-toplevel)/README.md"', 'cat "$(git rev-parse --show-toplevel)/README.md"'],
];

for (const [label, command] of CREDENTIAL_LOOKALIKES_ROUND_2) {
  test(`pre-bash-guard allows credential look-alike (#1411 review): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, JSON.stringify(command));
  });
}

test('pre-bash-guard names the substitution it cannot resolve (#1411 review)', () => {
  const res = bashHook('pre-bash-guard.sh', 'cat $(echo .env)');
  expectStatus(res, BLOCK, 'named substitution');
  assert.match(res.stderr, /\$\(echo \.env\)/);
});

test('pre-bash-guard names the xargs heredoc reason (#1411 review)', () => {
  const res = bashHook('pre-bash-guard.sh', `cat ${SHL}EOF | xargs cat\n.env\nEOF`);
  expectStatus(res, BLOCK, 'xargs heredoc');
  assert.match(res.stderr, /xargs/);
});

// ---------------------------------------------------------------------------
// #1411 review round 2: resolvable suffixes, stored output, exec/fd heredocs
// ---------------------------------------------------------------------------

const STORED = `x="${SUB}"; `;
const KEEP = (opener) => `${opener}${SHL}'EOF'\nfix: don't\nEOF\n`;

const CREDENTIAL_BYPASSES_ROUND_3 = [
  ['resolvable suffix: $(pwd)/.env', 'cat $(pwd)/.env'],
  ['resolvable suffix: $(git rev-parse --show-toplevel)/.env', 'cat $(git rev-parse --show-toplevel)/.env'],
  ['resolvable suffix: $(pwd)/credentials.json', 'cat $(pwd)/credentials.json'],
  ['resolvable suffix: quoted "$(pwd)/.env"', 'cat "$(pwd)/.env"'],
  ['resolvable suffix: quoted toplevel', 'cat "$(git rev-parse --show-toplevel)/.env"'],
  ['expansion shape: ${x:-}', `${STORED}if \${x:-}; then :; fi`],
  ['expansion shape: ${x%%}', `${STORED}if \${x%%}; then :; fi`],
  ['expansion shape: $x$e', `${STORED}if $x$e; then :; fi`],
  ['expansion shape: ${x[0]}', `${STORED}if \${x[0]}; then :; fi`],
  ['expansion shape: ${x[@]}', `${STORED}if \${x[@]}; then :; fi`],
  ['expansion shape: ${!y}', `${STORED}y=x; if \${!y}; then :; fi`],
  ['expansion shape: set -- then $1', `set -- "${SUB}"; if $1; then :; fi`],
  ['expansion shape: set -- then $@', `set -- "${SUB}"; if $@; then :; fi`],
  ['expansion shape: function runs $1', `f() { $1; }; f "${SUB}"`],
  ['expansion shape: function runs "$@"', `f() { if $@; then :; fi; }; f "${SUB}"`],
  ['expansion shape: ${x@P}', `x="$(cat ${SHL}'EOF'\n$(${READ_ENV})\nEOF\n)"; echo "\${x@P}"`],
  ['expansion shape: time ${x:-}', `${STORED}time \${x:-}`],
  ['expansion shape: printf -v then ${y:-}', `printf -v y %s "${SUB}"; if \${y:-}; then :; fi`],
  ['expansion shape: read into y then ${y:-}', `IFS= read -r y ${SHL}< "${SUB}"; if \${y:-}; then :; fi`],
  ['unquoted assignment then function body', `x=${SUB}; f() { $x; }; f`],
  ['non-listed wrapper with a direct argument', `fakeroot "${SUB}"`],
  ['exec heredoc then sh', `exec ${SHL}'EOF'\n${READ_ENV}\nEOF\nsh`],
  ['exec heredoc then xargs', `exec ${SHL}'EOF'\n.env\nEOF\nxargs cat`],
  ['exec heredoc then source /dev/stdin', `exec ${SHL}'EOF'\n${READ_ENV}\nEOF\nsource /dev/stdin`],
  ['fd heredoc then xargs <&3', `exec 3${SHL}'EOF'\n.env\nEOF\nxargs cat <&3`],
  ['fd heredoc then read loop', `exec 3${SHL}'EOF'\n${READ_ENV}\nEOF\nwhile read -r l; do $l; done <&3`],
  ['fd heredoc then bash <&3', `exec 3${SHL}'EOF'\n${READ_ENV}\nEOF\nbash <&3`],
  ['quoted xargs word on the heredoc line', `cat ${SHL}'EOF' | env 'xargs' cat\n.env\nEOF`],
];

for (const [label, command] of CREDENTIAL_BYPASSES_ROUND_3) {
  test(`pre-bash-guard blocks credential bypass (#1411 review 2): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), BLOCK, JSON.stringify(command));
  });
}

const CREDENTIAL_LOOKALIKES_ROUND_3 = [
  ['commit message with an apostrophe after cd "$HOME"', `cd "$HOME" && git commit --dry-run -m "$(${KEEP('cat ')})"`],
  ['commit message with an apostrophe before push "$BRANCH"', `git commit --dry-run -m "$(${KEEP('cat ')})" && git push origin "$BRANCH"`],
  ['commit message with an apostrophe then echo $?', `git commit --dry-run -m "$(${KEEP('cat ')})"; echo $?`],
  ['gh pr create body with an apostrophe', `gh pr create --title t --body "$(${KEEP('cat ')})"`],
  ['message variable with an apostrophe then commit', `body="$(${KEEP('cat ')})"; gh pr create --title t --body "$body"`],
  ['message variable mentioning the file name as prose', `msg="$(cat ${SHL}'EOF'\nfix: ignore .env in docs\nEOF\n)"; git commit -m "$msg"`],
  ['$(pwd) alone', 'cat $(pwd)'],
  ['$(pwd)/README.md', 'cat $(pwd)/README.md'],
];

for (const [label, command] of CREDENTIAL_LOOKALIKES_ROUND_3) {
  test(`pre-bash-guard allows credential look-alike (#1411 review 2): ${label}`, () => {
    expectStatus(bashHook('pre-bash-guard.sh', command), ALLOW, JSON.stringify(command));
  });
}

run('hook-bypass');
