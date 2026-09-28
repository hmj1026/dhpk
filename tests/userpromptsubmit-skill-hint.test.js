'use strict';

// Coverage for userpromptsubmit-skill-hint.sh (UserPromptSubmit hook,
// advisory only). Uses a custom DHPK_ROUTE_TABLE (test override, honoured by
// skills/dhpk-do/scripts/pre-route.sh) rather than the real route-table.json,
// so this suite is decoupled from real route-table content changes.
//
//   - A prompt matching the test route pattern → additionalContext hint.
//   - A prompt starting with "/" → no hint (already a command).
//   - A prompt shorter than 8 chars → no hint (noise floor).
//   - DHPK_DISABLE_SKILL_HINT=1 → no hint (one-shot opt-out).
//   - CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED=false → no hint.
//   - A Playwright agent route → explicit UNAVAILABLE-aware dispatch hint.
//   - Unknown agent targets → no hint (fail closed).
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
    schema: 'dhpk.route-table.v2',
    rules: [
      {
        pattern: 'deploy.{0,20}(prod|production)',
        label: 'production deploy',
        target: { kind: 'skill', id: 'dhpk-deploy-list' },
      },
    ],
  }));
  return { dir, file };
}

function mkUnknownRouteTable() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-uph-unknown-')));
  const file = path.join(dir, 'route-table.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'dhpk.route-table.v2',
    rules: [
      {
        pattern: 'deploy.{0,20}(prod|production)',
        label: 'production deploy',
        target: { kind: 'skill', id: 'deploy-prod' },
      },
    ],
  }));
  return { dir, file };
}

function mkUnknownAgentRouteTable() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-uph-unknown-agent-')));
  const file = path.join(dir, 'route-table.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'dhpk.route-table.v2',
    rules: [
      {
        pattern: 'playwright',
        label: 'missing Playwright agent',
        target: { kind: 'agent', id: 'missing-role' },
      },
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

function assertHintOutput(result, expectedAdditionalContext, label) {
  assert.strictEqual(result.status, 0, `${label} expected exit 0: ${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.deepStrictEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: expectedAdditionalContext,
    },
  }, `${label} emitted an unexpected hook payload`);
  return output.hookSpecificOutput.additionalContext;
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
  assertHintOutput(
    res,
    '[skill-hint] This prompt looks like a production deploy task — the /dhpk:dhpk-deploy-list workflow may fit. Suggest it (or run it) if appropriate.',
    'production deploy hint'
  );
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
  assertHintOutput(
    res,
    '[skill-hint] This prompt looks like a production deploy task — the /dhpk:dhpk-deploy-list workflow may fit. Suggest it (or run it) if appropriate.',
    'production deploy hint after notification filter'
  );
});

test('minimal hook_profile suppresses the hint even for a matching prompt', () => {
  const res = runHook('please deploy to production now', { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `expected no hint under minimal profile, got: ${res.stdout}`);
});

test('real explicit-only routes emit exact commands without Skill-tool advice', () => {
  const cases = [
    [
      'please run an unattended OpenSpec goal session',
      'dhpk-opsx-apply-goal',
      '[skill-hint] This prompt looks like a unattended OpenSpec goal session task — run /dhpk:dhpk-opsx-apply-goal directly; do not call the generic Skill tool.',
    ],
    [
      'please create a PR for this branch',
      'create-pr',
      '[skill-hint] This prompt looks like a create PR task — run /dhpk:create-pr directly; do not call the generic Skill tool.',
    ],
    [
      'please create a release',
      'release-creator',
      '[skill-hint] This prompt looks like a create release task — run /dhpk:release-creator directly; do not call the generic Skill tool.',
    ],
    [
      'please commit these changes',
      'smart-commit',
      '[skill-hint] This prompt looks like a smart commit task — run /dhpk:smart-commit directly; do not call the generic Skill tool.',
    ],
  ];
  for (const [prompt, name, expectedAdditionalContext] of cases) {
    assert.strictEqual(resolveInvocationClass(name), 'explicit-only', `${name} must be explicit-only in canonical metadata`);
    const res = runHookAgainstRealRoutes(prompt);
    const context = assertHintOutput(res, expectedAdditionalContext, name);
    assert.ok(context.includes(`/dhpk:${name}`), `${name} must show exact command: ${context}`);
    assert.match(context, /do not call the generic Skill tool/i, `${name} must forbid Skill-tool invocation: ${context}`);
    assert.ok(!context.includes('/dhpk:dhpk:'), `${name} must not duplicate route namespace: ${context}`);
    assert.ok(!context.includes('Suggest it (or run it)'), `${name} must not use generic implicit wording: ${context}`);
  }
});

test('real implicit-eligible route retains generic advisory wording', () => {
  assert.strictEqual(resolveInvocationClass('review-pending'), 'implicit-eligible');
  const res = runHookAgainstRealRoutes('please review this diff');
  const context = assertHintOutput(
    res,
    '[skill-hint] This prompt looks like a manual code review task — the /dhpk:review-pending workflow may fit. Suggest it (or run it) if appropriate.',
    'implicit route hint'
  );
  assert.ok(context.includes('/dhpk:review-pending'), `expected implicit route command: ${context}`);
  assert.ok(context.includes('Suggest it (or run it)'), `expected generic wording: ${context}`);
  assert.ok(!/do not call the generic Skill tool/i.test(context), `implicit route must not get explicit-only restriction: ${context}`);
});

test('real Playwright route emits an explicit unavailable agent dispatch hint without remapping', () => {
  const res = runHookAgainstRealRoutes('please author a Playwright journey for checkout');
  const context = assertHintOutput(
    res,
    '[skill-hint] This prompt looks like a Playwright E2E journey (→ e2e-runner; UNAVAILABLE if the Playwright agent capability is unavailable) task — dispatch agent:e2e-runner when available; if that capability is unavailable, report UNAVAILABLE and do not remap it to another workflow.',
    'Playwright agent hint'
  );
  assert.ok(context.includes('agent:e2e-runner'), `expected agent target in hint: ${context}`);
  assert.match(context, /UNAVAILABLE/);
  assert.match(context, /dispatch|agent/i, `expected an agent dispatch hint: ${context}`);
  assert.ok(!context.includes('dhpk-post-dev-test'), `retired route must not be suggested: ${context}`);
  assert.ok(!context.includes('tdd'), `Playwright route must not remap to TDD: ${context}`);
  assert.ok(!/generic Skill tool/i.test(context), `agent route must not suggest Skill-tool invocation: ${context}`);
});

test('matching a route with missing canonical metadata fails closed', () => {
  const rt = mkUnknownRouteTable();
  const res = runHookWithRoute('please deploy to production now', rt.file);
  assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `missing target metadata must suppress hint: ${res.stdout}`);
});

test('matching an unknown agent route fails closed without an unavailable fallback target', () => {
  const rt = mkUnknownAgentRouteTable();
  const res = runHookWithRoute('please use Playwright now', rt.file);
  assert.strictEqual(res.status, 0, `unknown agent expected exit 0: ${res.stderr}`);
  assert.strictEqual(res.stdout.trim(), '', `unknown agent target must suppress hint: ${res.stdout}`);
});

run('userpromptsubmit-skill-hint');
