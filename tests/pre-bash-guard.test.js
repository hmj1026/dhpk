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

run('pre-bash-guard');
