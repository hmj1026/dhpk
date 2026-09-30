'use strict';

// Dedicated coverage for scripts/hooks/pre-edit-guard.sh (PreToolUse
// Edit|Write|MultiEdit hook). tests/pre-bash-guard.test.js covers the sibling
// Bash-command guard only incidentally overlaps in spirit (env write
// symmetry) — this file exercises pre-edit-guard.sh directly via its own
// stdin-JSON tool_input.file_path contract.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'pre-edit-guard.sh');

function runHook(filePath, env) {
  const payload = JSON.stringify({ tool_input: { file_path: filePath } });
  return spawnSync('bash', ['-c', `printf '%s' "$DHPK_PAYLOAD" | bash "$DHPK_HOOK"`], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, DHPK_PAYLOAD: payload, DHPK_HOOK: HOOK, ...env },
  });
}

test('Write/Edit to .env is blocked', () => {
  const res = runHook('.env');
  assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
  assert.ok(res.stderr.includes('blocked sensitive file'));
});

test('Write/Edit to .env.production (dotted suffix) is blocked', () => {
  const res = runHook('config/.env.production');
  assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
});

test('.env.example is allowlisted (template, no secrets)', () => {
  const res = runHook('.env.example');
  assert.strictEqual(res.status, 0, `expected allowed: ${res.stderr}`);
});

test('.env.sample / .env.dist / .env.template are also allowlisted', () => {
  for (const name of ['.env.sample', '.env.dist', '.env.template']) {
    const res = runHook(name);
    assert.strictEqual(res.status, 0, `${name} expected allowed: ${res.stderr}`);
  }
});

test('env path matching is basename-anchored and scratchpad env files are allowed', () => {
  const cases = [
    ['verify.env', 0],
    ['/tmp/claude-session/.env', 0],
    ['/private/tmp/claude-session/.env.local', 0],
    ['config/.env', 2],
  ];
  for (const [filePath, expected] of cases) {
    const res = runHook(filePath);
    assert.strictEqual(res.status, expected, `${filePath}: ${res.stderr}`);
  }
});

test('active OpenSpec task listing allows an existing lint config by basename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-edit-guard-'));
  try {
    const config = path.join(root, 'eslint.config.mjs');
    const change = path.join(root, 'openspec', 'changes', 'lint-policy');
    fs.mkdirSync(change, { recursive: true });
    fs.writeFileSync(config, 'export default [];\n');
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] Intentionally update `eslint.config.mjs`\n');
    const res = runHook(config, { CLAUDE_PROJECT_DIR: root });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stderr.includes('[edit-guard] lint config allowed: listed in lint-policy/tasks.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unlisted existing lint config remains blocked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-edit-guard-'));
  try {
    const config = path.join(root, 'eslint.config.mjs');
    fs.writeFileSync(config, 'export default [];\n');
    const res = runHook(config, { CLAUDE_PROJECT_DIR: root });
    assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
    assert.ok(res.stderr.includes('blocked lint/formatter config edit'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('.git/ internals are blocked', () => {
  const res = runHook('.git/config');
  assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
});

test('lock files are blocked (regenerate via package manager)', () => {
  const res = runHook('package-lock.json');
  assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
  assert.ok(res.stderr.includes('blocked lock file'));
});

test('a normal source file passes through cleanly', () => {
  const res = runHook('src/Foo.php');
  assert.strictEqual(res.status, 0, `expected allowed: ${res.stderr}`);
  assert.strictEqual(res.stderr.trim(), '');
});

test('a file path with shell metacharacters is rejected', () => {
  const res = runHook('foo;rm -rf /');
  assert.strictEqual(res.status, 2, `expected blocked: ${res.stderr}`);
  assert.ok(res.stderr.includes('shell metacharacters'));
});

test('empty file_path is a silent no-op (exit 0)', () => {
  const res = runHook('');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stderr.trim(), '');
});

// Consolidated source suite: pre-edit-batch-gate.
{

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { mkRepo, rmRepo, sessionsDir, runHook } = require('./_lib/hookharness');

  const HOOK = 'pre-edit-batch-gate.sh';

  function edit(repo, filePath, { session = 'batch', env = {}, payload = {} } = {}) {
    return runHook(HOOK, {
      cwd: repo,
      projectDir: repo,
      payload: { session_id: session, tool_input: { file_path: filePath }, ...payload },
      env,
    });
  }

  test('warns on third distinct file, ignores duplicates, and blocks fourth only in dispatch mode', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
      assert.strictEqual(edit(repo, 'src/a.js', { env }).status, 0);
      assert.strictEqual(edit(repo, 'src/a.js', { env }).status, 0);
      assert.strictEqual(edit(repo, 'src/b.js', { env }).status, 0);
      const third = edit(repo, 'src/c.js', { env });
      assert.strictEqual(third.status, 0, third.stderr);
      assert.ok(third.stderr.includes('WARN') && third.stderr.includes('3-file'), third.stderr);
      const fourth = edit(repo, 'src/d.js', { env });
      assert.strictEqual(fourth.status, 2, fourth.stderr);
      assert.ok(fourth.stderr.includes('fast-worker'), fourth.stderr);
    } finally { rmRepo(repo); }
  });

  test('fourth distinct file remains advisory outside dispatch mode', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      for (const name of ['a', 'b', 'c', 'd']) {
        assert.strictEqual(edit(repo, `src/${name}.js`, { session: 'plain' }).status, 0);
      }
    } finally { rmRepo(repo); }
  });

  test('a live fast-worker marker bypasses the gate WITHOUT counting', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
      const counter = path.join(sessionsDir(repo), '.edit-batch-batch.files');
      fs.mkdirSync(sessionsDir(repo), { recursive: true });
      const active = path.join(sessionsDir(repo), '.active-fast-worker');
      fs.writeFileSync(active, `${Math.floor(Date.now() / 1000)} fast-worker pid=1\n`);
      assert.strictEqual(edit(repo, 'src/worker.js', { env }).status, 0);
      fs.rmSync(active);
      assert.ok(!fs.existsSync(counter) || !fs.readFileSync(counter, 'utf8').includes('src/worker.js'),
        'an edit made while a fast-worker is live must not enter the distinct-file counter');
    } finally { rmRepo(repo); }
  });

  // Issue #80 regression (warm-review MUST-FIX): DHPK_INLINE_BATCH_OK suppresses
  // the WARN/block but the file MUST still be recorded, or the Stop-time dispatch
  // audit stays silent for exactly the session-wide-override case it targets.
  test('explicit acceptance suppresses the block but STILL counts for the dispatch audit', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      const env = { DHPK_ORCHESTRATION_DISPATCH: 'on', DHPK_INLINE_BATCH_OK: '1' };
      const counter = path.join(sessionsDir(repo), '.edit-batch-batch.files');
      for (const name of ['a', 'b', 'c', 'd']) {
        assert.strictEqual(edit(repo, `src/${name}.js`, { env }).status, 0,
          'override must never block, regardless of count');
      }
      const files = fs.readFileSync(counter, 'utf8');
      for (const name of ['a', 'b', 'c', 'd']) {
        assert.ok(files.includes(`src/${name}.js`),
          `override-edited src/${name}.js must still be counted so the #80 audit can flag it`);
      }
    } finally { rmRepo(repo); }
  });

  test('bookkeeping and out-of-project paths do not count', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      const env = { DHPK_ORCHESTRATION_DISPATCH: 'on' };
      for (const file of ['openspec/changes/x/proposal.md', '.claude/artifacts/a.md', 'tasks.md', '/tmp/outside.js']) {
        assert.strictEqual(edit(repo, file, { env }).status, 0);
      }
      for (const name of ['a', 'b', 'c']) assert.strictEqual(edit(repo, `src/${name}.js`, { env }).status, 0);
      assert.strictEqual(edit(repo, 'src/d.js', { env }).status, 2);
    } finally { rmRepo(repo); }
  });

  test('malformed payload and unwritable sidecar location fail open', () => {
    const repo = mkRepo({ prefix: 'dhpk-edit-batch-' });
    try {
      const malformed = runHook(HOOK, { cwd: repo, projectDir: repo, payload: '{bad' });
      assert.strictEqual(malformed.status, 0, malformed.stderr);
      fs.mkdirSync(path.join(repo, '.claude', 'artifacts'), { recursive: true });
      fs.writeFileSync(sessionsDir(repo), 'not a directory');
      const failedState = edit(repo, 'src/a.js', { env: { DHPK_ORCHESTRATION_DISPATCH: 'on' } });
      assert.strictEqual(failedState.status, 0, failedState.stderr);
    } finally { rmRepo(repo); }
  });
}


run('pre-edit-guard');
