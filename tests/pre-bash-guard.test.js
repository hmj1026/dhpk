'use strict';

// Regression coverage for pre-bash-guard.sh:
//   - D4 (harvest-advice-20260711): DANGEROUS_ROOT depth split — system roots
//     (etc, usr, ...) stay blocked at any depth; user-data roots (home, opt,
//     srv) are only blocked at depth <=2, so deep workspace paths pass.
//   - D6 (harvest-advice-20260711): .env write-symmetry via Bash redirection
//     / tee, mirroring the pre-edit-guard.sh Write/Edit block and allowlist.

const { test, run, assert } = require('./_lib/tinytest');
const { runHook: runHookRaw } = require('./_lib/hookharness');

function runHook(command) {
  return runHookRaw('pre-bash-guard.sh', { payload: { tool_input: { command } } });
}

test('deep workspace path under /home passes (D4, observed command)', () => {
  const res = runHook('rm -rf /home/paul/projects/zdpos-217/openspec/changes/graduate-foo');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

test('rm -rf /home is blocked (whole-home deletion)', () => {
  const res = runHook('rm -rf /home');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf /home/paul is blocked (whole-home deletion, depth 2)', () => {
  const res = runHook('rm -rf /home/paul');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf /home/paul/ is blocked (trailing slash, depth 2)', () => {
  const res = runHook('rm -rf /home/paul/');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf /etc/nginx/conf.d is blocked (system root, any depth)', () => {
  const res = runHook('rm -rf /etc/nginx/conf.d');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('heredoc write to .env via cat > is blocked (D6 bypass closed)', () => {
  const res = runHook("cat > .env <<'EOF'");
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('append redirection to .env is blocked', () => {
  const res = runHook('echo secret >> .env.production');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('tee into .env is blocked', () => {
  const res = runHook('tee -a .env <<< "x"');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to .env.example is allowed (template allowlist)', () => {
  const res = runHook('echo x > .env.example');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

test('whole-command .env.example mention no longer bypasses a real .env write (fix round)', () => {
  const res = runHook('echo SECRET=x > .env ; cat .env.example');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirect FROM .env.example INTO .env is still blocked (target-scoped allowlist)', () => {
  const res = runHook('cat .env.example > .env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf /home//paul (repeated slash) is blocked (D4/D6 fix round)', () => {
  const res = runHook('rm -rf /home//paul');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf /home/paul// (repeated trailing slash) is blocked (D4/D6 fix round)', () => {
  const res = runHook('rm -rf /home/paul//');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('deep workspace path under /home still passes after slash-tolerant fix', () => {
  const res = runHook('rm -rf /home/paul/projects/x');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

test('redirection to .env with path prefix (api/.env) is blocked (path-prefix bypass fix)', () => {
  const res = runHook('echo SECRET=x > api/.env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to ./.env is blocked (path-prefix bypass fix)', () => {
  const res = runHook('echo SECRET=x > ./.env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to /tmp/foo/.env is blocked (path-prefix bypass fix)', () => {
  const res = runHook('echo SECRET=x > /tmp/foo/.env');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to config/.env.example is allowed (path-prefix allowlist tolerance)', () => {
  const res = runHook('echo x > config/.env.example');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

test('tee into backend/.env is blocked (path-prefix bypass fix)', () => {
  const res = runHook('tee backend/.env <<< "x"');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf //home (doubled leading slash) is blocked (Pattern 1 slash-plus fix)', () => {
  const res = runHook('rm -rf //home');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to ".env" (double-quoted) is blocked (quoted-target bypass fix)', () => {
  const res = runHook('echo SECRET=x > ".env"');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test("redirection to 'config/.env' (single-quoted) is blocked (quoted-target bypass fix)", () => {
  const res = runHook("echo SECRET=x > 'config/.env'");
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('tee into "api/.env" (double-quoted) is blocked (quoted-target bypass fix)', () => {
  const res = runHook('tee "api/.env"');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('redirection to "config/.env.example" (quoted) is allowed (quoted allowlist tolerance)', () => {
  const res = runHook('echo x > "config/.env.example"');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

test('rm -rf "/home" (double-quoted) is blocked (quoted-target bypass fix)', () => {
  const res = runHook('rm -rf "/home"');
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test("rm -rf '/home/paul' (single-quoted) is blocked (quoted-target bypass fix)", () => {
  const res = runHook("rm -rf '/home/paul'");
  assert.strictEqual(res.status, 2, `expected blocked, got: ${res.status} / ${res.stderr}`);
});

test('rm -rf "/home/paul/projects/x/y" (quoted deep path) still passes (quoted-target bypass fix)', () => {
  const res = runHook('rm -rf "/home/paul/projects/x/y"');
  assert.strictEqual(res.status, 0, `expected allowed, got blocked: ${res.stderr}`);
});

// --- Pattern 4: the git-push review gate must only speak for its own repo ---

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkRepo, rmRepo, sessionsDir } = require('./_lib/hookharness');

// A repo with one uncommitted file that a sentinel also lists — the state that
// legitimately blocks a push.
function repoWithPendingReview() {
  const repo = mkRepo({ prefix: 'dhpk-push-gate-', gitConfig: true });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '-qm', 'seed'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'edited\n');
  fs.mkdirSync(sessionsDir(repo), { recursive: true });
  fs.writeFileSync(path.join(sessionsDir(repo), '.pending-review'),
    '2026-07-07 12:00 seed.txt\n');
  return repo;
}

function runPush(command, projectDir) {
  return runHookRaw('pre-bash-guard.sh', {
    payload: { tool_input: { command } },
    projectDir,
    cwd: projectDir,
  });
}

test('push in the session project with a matching pending sentinel is blocked', () => {
  const repo = repoWithPendingReview();
  try {
    const res = runPush('git push -u origin feature/x', repo);
    assert.strictEqual(res.status, 2, `expected the gate to fire:\n${res.stderr}`);
    assert.ok(res.stderr.includes('.pending-review'), res.stderr);
  } finally { rmRepo(repo); }
});

test('push targeting a different repo via `cd <path> &&` is not gated by this project', () => {
  const repo = repoWithPendingReview();
  const other = mkRepo({ prefix: 'dhpk-push-other-' });
  try {
    const res = runPush(`cd ${other} && git push -u origin feature/x`, repo);
    assert.strictEqual(res.status, 0,
      `another repo's push was blocked by this project's review debt:\n${res.stderr}`);
  } finally { rmRepo(repo); rmRepo(other); }
});

test('push targeting a different repo via `git -C <path>` is not gated by this project', () => {
  const repo = repoWithPendingReview();
  const other = mkRepo({ prefix: 'dhpk-push-other-' });
  try {
    const res = runPush(`git -C ${other} push -u origin feature/x`, repo);
    assert.strictEqual(res.status, 0,
      `another repo's push was blocked by this project's review debt:\n${res.stderr}`);
  } finally { rmRepo(repo); rmRepo(other); }
});

test('cd into a subdirectory of the session project still gates the push', () => {
  const repo = repoWithPendingReview();
  try {
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    const res = runPush(`cd ${sub} && git push`, repo);
    assert.strictEqual(res.status, 2,
      `same repo via a subdirectory must stay gated:\n${res.stderr}`);
  } finally { rmRepo(repo); }
});

test('a cd to a nonexistent path falls back to gating the session project', () => {
  const repo = repoWithPendingReview();
  try {
    const res = runPush('cd /nonexistent-xyzzy && git push', repo);
    assert.strictEqual(res.status, 2,
      `unresolvable target must not open the gate:\n${res.stderr}`);
  } finally { rmRepo(repo); }
});

// --- Pattern 4 detection: git global options must not slip the gate ---
//
// The gate only matched `git` immediately followed by `push`, so any global
// option in between meant it never evaluated at all — `git -C . push` walked
// past a fully-armed sentinel set. Only tokens starting with `-` are skipped,
// so a real subcommand still stops the match.

const SLIPS = [
  ['git -C . push', 'detached -C value'],
  ['git -C. push', 'attached -C value'],
  ['git --no-pager push', 'long global option'],
  ['git -c user.name=x push', 'detached -c value'],
  ['git --git-dir=.git --work-tree=. push', 'several long options'],
  ['git -c a=b -C . push --force', 'mixed, with a push flag after'],
];

for (const [command, label] of SLIPS) {
  test(`in-project \`${command}\` is gated (${label})`, () => {
    const repo = repoWithPendingReview();
    try {
      const res = runPush(command, repo);
      assert.strictEqual(res.status, 2,
        `global option slipped the review gate:\n${res.stderr}`);
    } finally { rmRepo(repo); }
  });
}

// Widening detection must not start gating commands that merely contain the
// word "push" after a genuine subcommand.
const NOT_PUSHES = [
  ['git log --grep push', 'push as a grep argument'],
  ['git config --global alias.p push', 'push as a config value'],
  ['git --no-pager log --grep=push', 'global option then a non-push subcommand'],
  ['git status', 'unrelated subcommand'],
];

for (const [command, label] of NOT_PUSHES) {
  test(`\`${command}\` is not treated as a push (${label})`, () => {
    const repo = repoWithPendingReview();
    try {
      const res = runPush(command, repo);
      assert.strictEqual(res.status, 0,
        `false positive — this is not a push:\n${res.stderr}`);
    } finally { rmRepo(repo); }
  });
}

test('--dry-run stays exempt even with global options present', () => {
  const repo = repoWithPendingReview();
  try {
    const res = runPush('git -C . push --dry-run', repo);
    assert.strictEqual(res.status, 0, `--dry-run must stay exempt:\n${res.stderr}`);
  } finally { rmRepo(repo); }
});

run('pre-bash-guard');
