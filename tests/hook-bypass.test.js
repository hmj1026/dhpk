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
// TESTS ONLY. Every case below is green against the CURRENT hooks. Cases that
// exposed a real bypass are registered through knownBypass(): they are NOT
// executed, they print a SKIP line carrying the finding, and each one states
// the assertion that must pass once the hook is fixed. Un-skip by switching
// knownBypass(...) to test(...) when the hook closes the gap.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, rmRepo, runHook } = require('./_lib/hookharness');

const BLOCK = 2;
const ALLOW = 0;

// Register a documented-but-unfixed bypass. The body is kept for the fix
// author but never run, so the suite stays green on the current hooks.
function knownBypass(name, finding, _pendingAssertion) {
  test(`SKIP (known bypass) ${name}`, () => {
    console.log(`    SKIP known bypass: ${finding}`);
  });
}

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

knownBypass(
  'pre-bash-guard --no-verify via $\'git\' command word',
  "`$'git' commit --no-verify` exits 0 (ANSI-C quoted command name is not recognised as git; command-inspect.sh does not decode $'...')",
  { command: "$'git' commit --no-verify -m x", status: BLOCK }
);

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

knownBypass(
  'pre-bash-guard .env write via split quoting',
  '`echo x > ".e"nv` and `echo x > .e""nv` exit 0 (quote concatenation is not normalised before the .env regex)',
  { command: 'echo x > ".e"nv', status: BLOCK }
);
knownBypass(
  'pre-bash-guard .env write via $\'.env\'',
  "`echo x > $'.env'` exits 0 (ANSI-C quoted redirect target is not decoded)",
  { command: "echo x > $'.env'", status: BLOCK }
);
knownBypass(
  'pre-bash-guard .env write to quoted path containing a space',
  '`printf x > "dir with space/.env"` exits 0 (target regex stops at whitespace inside quotes)',
  { command: 'printf x > "dir with space/.env"', status: BLOCK }
);
knownBypass(
  'pre-bash-guard rm -rf with quote-split rm',
  '`r"m" -rf /etc` exits 0 (rm pattern matches raw text, not the unquoted command word)',
  { command: 'r"m" -rf /etc', status: BLOCK }
);
knownBypass(
  'pre-bash-guard rm -rf with $\'...\' or quoted-root target',
  "`rm -rf $'/etc'` and `rm -rf \"/\"` exit 0 (quote before the slash defeats the root-path regex)",
  { command: "rm -rf $'/etc'", status: BLOCK }
);

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

knownBypass(
  'pretool-git-gate commit via $\'git\' command word on a protected branch',
  "`$'git' commit -m x` exits 0 in block mode (ANSI-C quoted command name is not recognised as git)",
  { command: "$'git' commit -m x", status: BLOCK }
);

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

knownBypass(
  'pre-bash-dispatch commit via $\'git\' command word',
  "`$'git' commit --no-verify -m x` exits 0 through the whole dispatch chain (guard and gate both miss it)",
  { command: "$'git' commit --no-verify -m x", status: BLOCK }
);

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

knownBypass(
  'pre-edit-guard scratchpad allowlist with parent traversal',
  '`/tmp/claude-x/../../home/u/proj/.env` and `/tmp/claude-x/../etc/.git/config` exit 0 (scratchpad prefix regex is applied before the path is normalised, so ".." escapes it)',
  { filePath: '/tmp/claude-x/../../home/u/proj/.env', status: BLOCK }
);
knownBypass(
  'pre-edit-guard case-insensitive .env / .git',
  '`.ENV` and `.Git/config` exit 0 (matching is case-sensitive; bypass on case-insensitive filesystems such as default macOS/Windows)',
  { filePath: '.Git/config', status: BLOCK }
);
knownBypass(
  'pre-edit-guard bare .git file (worktree/submodule gitlink)',
  '`.git` with no trailing slash exits 0 (rule needs `.git/`); in a linked worktree `.git` is a file that redirects git internals',
  { filePath: '.git', status: BLOCK }
);

run('hook-bypass');
