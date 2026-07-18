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

run('pre-edit-guard');
