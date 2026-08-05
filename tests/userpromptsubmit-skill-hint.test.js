'use strict';

// Coverage for userpromptsubmit-skill-hint.sh (UserPromptSubmit hook,
// advisory only). Uses a custom DHPK_ROUTE_TABLE (test override, honoured by
// scripts/lib/pre-route.sh) rather than the real route-table.json, so this
// suite is decoupled from real route-table content changes.
//
//   - A prompt matching the test route pattern → additionalContext hint.
//   - A prompt starting with "/" → no hint (already a command).
//   - A prompt shorter than 8 chars → no hint (noise floor).
//   - DHPK_DISABLE_SKILL_HINT=1 → no hint (one-shot opt-out).
//   - CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED=false → no hint.
//   - Always exits 0.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'userpromptsubmit-skill-hint.sh');

function mkRouteTable() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-uph-')));
  const file = path.join(dir, 'route-table.json');
  fs.writeFileSync(file, JSON.stringify({
    rules: [
      { pattern: 'deploy.{0,20}(prod|production)', skill: 'dhpk:dhpk-deploy-list', label: 'production deploy' },
    ],
  }));
  return { dir, file };
}

function mkUnknownRouteTable() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-uph-unknown-')));
  const file = path.join(dir, 'route-table.json');
  fs.writeFileSync(file, JSON.stringify({
    rules: [
      { pattern: 'deploy.{0,20}(prod|production)', skill: 'dhpk:deploy-prod', label: 'production deploy' },
    ],
  }));
  return { dir, file };
}

function runHookWithRoute(prompt, routeFile, extraEnv = {}) {
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, DHPK_ROUTE_TABLE: routeFile, ...extraEnv };
    delete env.DHPK_DISABLE_SKILL_HINT;
    delete env.CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED;
    delete env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE;
    Object.assign(env, extraEnv);
    const payload = JSON.stringify({ prompt });
    return spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', HOOK], {
      env: { ...env, P: payload },
      encoding: 'utf8',
      timeout: 10000,
    });
  } finally {
    if (routeFile) fs.rmSync(path.dirname(routeFile), { recursive: true, force: true });
  }
}

function runHook(prompt, extraEnv = {}) {
  const rt = mkRouteTable();
  return runHookWithRoute(prompt, rt.file, extraEnv);
}

function runHookAgainstRealRoutes(prompt, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...extraEnv };
  delete env.DHPK_ROUTE_TABLE;
  delete env.DHPK_DISABLE_SKILL_HINT;
  delete env.CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED;
  delete env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE;
  Object.assign(env, extraEnv);
  const payload = JSON.stringify({ prompt });
  return spawnSync('bash', ['-c', 'printf %s "$P" | bash "$1"', '_', HOOK], {
    env: { ...env, P: payload },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function resolveInvocationClass(name) {
  const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
  const cmdFile = path.join(ROOT, 'commands', `${name}.md`);
  const file = fs.existsSync(skillFile) ? skillFile : fs.existsSync(cmdFile) ? cmdFile : null;
  if (!file) return null;
  const m = fs.readFileSync(file, 'utf8').match(/^metadata:\s*\n\s+dhpk-invocation-class:\s*(\S+)/m);
  return m ? m[1] : null;
}

test('prompt matching the route pattern emits an additionalContext hint', () => {
  const res = runHook('please deploy to production now');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.ok(res.stdout.includes('additionalContext'), `expected additionalContext JSON, got: ${res.stdout}`);
  assert.ok(res.stdout.includes('production deploy'), `expected label in hint, got: ${res.stdout}`);
});

test('prompt with no match → no hint emitted', () => {
  const res = runHook('what is the weather like today');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint, got: ${res.stdout}`);
});

test('slash-prefixed prompt (already a command) → no hint', () => {
  const res = runHook('/deploy to production please');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint for slash-prefixed prompt, got: ${res.stdout}`);
});

test('short prompt (<8 chars) → no hint (noise floor)', () => {
  const res = runHook('deploy');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint for short prompt, got: ${res.stdout}`);
});

test('DHPK_DISABLE_SKILL_HINT=1 suppresses the hint even for a matching prompt', () => {
  const res = runHook('please deploy to production now', { DHPK_DISABLE_SKILL_HINT: '1' });
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint when disabled, got: ${res.stdout}`);
});

test('CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED=false suppresses the hint', () => {
  const res = runHook('please deploy to production now', { CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED: 'false' });
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint when option disabled, got: ${res.stdout}`);
});

test('[SYSTEM NOTIFICATION] input → no hint (system-generated turn)', () => {
  const res = runHook('[SYSTEM NOTIFICATION] background task done: please deploy to production now');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint for system notification, got: ${res.stdout}`);
});

test('<task-notification> input → no hint (system-generated turn)', () => {
  const res = runHook('<task-notification>agent finished</task-notification> deploy to production now');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint for task notification, got: ${res.stdout}`);
});

test('normal matching prompt still hints after notification filter added', () => {
  const res = runHook('please deploy to production now');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.ok(res.stdout.includes('additionalContext'), `expected hint preserved, got: ${res.stdout}`);
});

test('minimal hook_profile suppresses the hint even for a matching prompt', () => {
  const res = runHook('please deploy to production now', { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint under minimal profile, got: ${res.stdout}`);
});

test('real explicit-only routes emit exact commands without Skill-tool advice', () => {
  const cases = [
    ['please run an unattended OpenSpec goal session', 'opsx-apply-goal'],
    ['please create a PR for this branch', 'create-pr'],
    ['please create a release', 'release-creator'],
    ['please commit these changes', 'smart-commit'],
  ];
  for (const [prompt, name] of cases) {
    assert.strictEqual(resolveInvocationClass(name), 'explicit-only', `${name} must be explicit-only in canonical metadata`);
    const res = runHookAgainstRealRoutes(prompt);
    assert.strictEqual(res.status, 0, `${name} expected exit 0: ${res.stderr}`);
    assert.ok(res.stdout.includes(`/dhpk:${name}`), `${name} must show exact command: ${res.stdout}`);
    assert.match(res.stdout, /do not call the generic Skill tool/i, `${name} must forbid Skill-tool invocation: ${res.stdout}`);
    assert.ok(!res.stdout.includes('/dhpk:dhpk:'), `${name} must not duplicate route namespace: ${res.stdout}`);
    assert.ok(!res.stdout.includes('Suggest it (or run it)'), `${name} must not use generic implicit wording: ${res.stdout}`);
  }
});

test('real implicit-eligible route retains generic advisory wording', () => {
  assert.strictEqual(resolveInvocationClass('review-pending'), 'implicit-eligible');
  const res = runHookAgainstRealRoutes('please review this diff');
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.ok(res.stdout.includes('/dhpk:review-pending'), `expected implicit route command: ${res.stdout}`);
  assert.ok(res.stdout.includes('Suggest it (or run it)'), `expected generic wording: ${res.stdout}`);
  assert.ok(!/do not call the generic Skill tool/i.test(res.stdout), `implicit route must not get explicit-only restriction: ${res.stdout}`);
});

test('matching a route with missing canonical metadata fails closed', () => {
  const rt = mkUnknownRouteTable();
  const res = runHookWithRoute('please deploy to production now', rt.file);
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `missing target metadata must suppress hint: ${res.stdout}`);
});

run('userpromptsubmit-skill-hint');
