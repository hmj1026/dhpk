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
      { pattern: 'deploy.{0,20}(prod|production)', skill: 'dhpk:deploy-prod', label: 'production deploy' },
    ],
  }));
  return { dir, file };
}

function runHook(prompt, extraEnv = {}) {
  const rt = mkRouteTable();
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, DHPK_ROUTE_TABLE: rt.file, ...extraEnv };
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
    fs.rmSync(rt.dir, { recursive: true, force: true });
  }
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

run('userpromptsubmit-skill-hint');
