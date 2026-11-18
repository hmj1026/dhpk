'use strict';

// userConfig keys whose only consumers are hook scripts that the default
// lifecycle (hooks/hooks.json) does not register must say so in their
// plugin.json description. Setting such a key does nothing until the consumer
// registers the hook itself (docs/hook-extension.md "Optional extensions").
//
// INACTIVE_KEYS is an explicit, hand-verified map: key -> consuming script
// (null when no shipped script reads the key at all). Keys read by the default
// entry points (session-start, pre-bash-dispatch incl. pretool-git-gate and
// module pre-commit gates, pre-edit-guard, subagent-stop-verify) are NOT here.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const userConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
).userConfig;
const hooksJson = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');

const REQUIRED_PREFIX = 'Requires explicit consumer hook registration';
const INACTIVE_KEYS = {
  agent_warmstart_enabled: 'scripts/hooks/pre-agent-warmstart.sh',
  completion_evidence_enabled: 'scripts/hooks/stop-advisory-dispatch.sh',
  graduation_scan_enabled: 'scripts/hooks/stop-advisory-dispatch.sh',
  skill_hint_enabled: 'scripts/hooks/userpromptsubmit-skill-hint.sh',
  learning_db_enabled: 'scripts/hooks/_lib/learning-db.sh',
  reap_stale_mcp_processes: 'scripts/hooks/session-end.sh',
  lockfile_sync_commands: 'scripts/hooks/post-edit-advisory.sh',
  php_bin: 'modules/php-5.6/hooks/post-edit-php-syntax.sh',
  swiftlint_bin: 'modules/xcode-tooling/hooks/post-edit-swiftlint.sh',
  subagent_quality_gate: 'scripts/hooks/subagent-stop-quality.sh',
  docker_containers: null,
  harness_restore_hint: null,
};

// "When true, a Stop hook ..." / "When enabled, SessionStart kills ..." read as
// if the key itself activates a hook event.
const ACTIVATION_CLAIM =
  /^When (?:true|enabled)\b[^.]*\b(?:PreToolUse|PostToolUse|Stop|SessionStart|SessionEnd|UserPromptSubmit)\b/;

test('the inactive-key map only names keys present in plugin.json', () => {
  for (const key of Object.keys(INACTIVE_KEYS)) {
    assert.ok(userConfig[key], `userConfig.${key} missing from plugin.json`);
  }
});

test('mapped consumer scripts exist and are not default-wired', () => {
  for (const [key, script] of Object.entries(INACTIVE_KEYS)) {
    if (!script) continue;
    assert.ok(fs.existsSync(path.join(ROOT, script)), `${key}: ${script} does not exist`);
    assert.ok(
      !hooksJson.includes(script),
      `${key}: ${script} is referenced by hooks/hooks.json; it is default-wired, remove it from the map`
    );
  }
});

test('inactive keys state that explicit consumer hook registration is required', () => {
  for (const key of Object.keys(INACTIVE_KEYS)) {
    const description = userConfig[key].description;
    assert.ok(
      description.includes(REQUIRED_PREFIX),
      `userConfig.${key} description must contain "${REQUIRED_PREFIX}"`
    );
  }
});

test('inactive keys do not read as if setting the key activates a hook event', () => {
  for (const key of Object.keys(INACTIVE_KEYS)) {
    const description = userConfig[key].description;
    assert.ok(
      !ACTIVATION_CLAIM.test(description),
      `userConfig.${key} description opens with an activation claim: ${description.slice(0, 80)}`
    );
  }
});

run('userconfig-hook-activation');
