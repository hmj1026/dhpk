'use strict';

// RED contract for the command disposition v3 cutover.  This suite stays at
// the public disposition validator: it does not inspect private compiler data
// or derive expected rows from the manifest under test.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  removedCommandSourceRevision,
  validateCommandSkillDispositions,
} = require('../scripts/lib/command-skill-disposition');

const ROOT = path.join(__dirname, '..');
const CURRENT_MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'command-skill-dispositions.json'),
  'utf8',
));

const ROOT_COMMAND_IDS = Object.freeze([
  'check-coverage',
  'codex-test-gen',
  'create-pr',
  'create-release',
  'deep-analyze',
  'dep-audit',
  'doc-refactor',
  'flow-drive',
  'flow-guide',
  'git-worktree',
  'harness-audit',
  'harness-govern',
  'install-hooks',
  'install-rules',
  'install-scripts',
  'matrix-cell-onboard',
  'merge-prep',
  'opsx-apply-resume',
  'pr-summary',
  'precommit-fast',
  'precommit',
  'project-brief',
  'review-pending',
  'setup',
  'simplify',
  'smart-commit',
  'spec-mine',
  'ui-ux-verify',
  'update-codemaps',
  'update-docs',
  'verify',
]);

const REMOVED_COMMAND_IDS = Object.freeze([
  'check-skill',
  'create-dev',
  'do',
  'codex-review',
  'codex-review-fast',
  'codex-review-branch',
  'codex-review-doc',
  'codex-security',
  'codex-test-review',
  'review-spec',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function evidence() {
  return { structural: 'PASS', host_smoke: 'NOT_RUN', consumer: 'NOT_RUN' };
}

function removedRows() {
  return REMOVED_COMMAND_IDS.map((id) => ({
    id,
    path: `commands/${id}.md`,
    public_name: `/dhpk:${id}`,
    outcome: 'remove',
    disposition: 'removed',
    successor: { kind: 'command', id: 'migration-note' },
    reason: 'retained only as migration evidence',
    callers: ['commands/create-pr.md'],
    evidence: evidence(),
  }));
}

function commandRow(id, overrides = {}) {
  return {
    id,
    path: `commands/${id}.md`,
    host_surface: 'claude-command',
    public_name: `/dhpk:${id}`,
    argument_contract: '',
    authority: 'read-only',
    skill_owner: null,
    outcome: 'retain',
    disposition: 'host-only',
    reason: 'Host-specific command boundary',
    callers: [`commands/${id}.md`],
    evidence: evidence(),
    ...overrides,
  };
}

function ownerSkill() {
  return {
    id: 'shared-owner',
    name: 'shared-owner',
    path: 'skills/shared-owner',
    usage: {
      display_name: 'Shared command owner',
      summary: 'Expose one owner contract to several Host commands',
      syntax: '$shared-owner <task>',
      input_kind: 'free-text',
      invocation_class: 'explicit-only',
      effect_authority: 'external-write',
      inputs: [{ id: 'task', syntax: '<task>', value_kind: 'string', required: true, summary: 'Task to execute' }],
      actions: [
        {
          id: 'inspect',
          summary: 'Inspect the requested task without changing it',
          syntax: '$shared-owner inspect',
          input_kind: 'none',
          effect_authority: 'read-only',
        },
        {
          id: 'publish',
          summary: 'Publish the requested task through the owner',
          syntax: '$shared-owner publish',
          input_kind: 'none',
          effect_authority: 'external-write',
        },
      ],
      options: [],
      examples: [{ prompt: '$shared-owner inspect', summary: 'Inspect a task' }],
    },
  };
}

function v3Manifest() {
  const commands = ROOT_COMMAND_IDS.map((id) => commandRow(id));
  commands[2] = commandRow('create-pr', {
    authority: 'external-write',
    skill_owner: 'shared-owner',
    disposition: 'thin-front-door',
    resource: 'skills/shared-owner/SKILL.md',
    forwarding: { action: 'publish', prepend_args: ['--draft'] },
  });
  commands[3] = commandRow('create-release', {
    authority: 'external-write',
    skill_owner: 'shared-owner',
    disposition: 'existing-skill-owner',
    resource: 'skills/shared-owner/SKILL.md',
  });
  commands[18] = commandRow('pr-summary', {
    authority: 'read-only',
    skill_owner: 'shared-owner',
    disposition: 'thin-front-door',
    resource: 'skills/shared-owner/SKILL.md',
    forwarding: { action: 'inspect', prepend_args: ['--summary'] },
  });
  commands.push(commandRow('ts-check-status', {
    path: 'modules/js/commands/ts-check-status.md',
    public_name: '/dhpk:ts-check-status',
    authority: 'read-only',
    skill_owner: 'shared-owner',
    disposition: 'thin-front-door',
    resource: 'skills/shared-owner/SKILL.md',
    forwarding: { action: 'inspect', prepend_args: ['--path', 'js/'] },
    callers: ['modules/js/commands/ts-check-status.md'],
  }));
  const removed = removedRows();
  return {
    schema: 'dhpk.command-skill-disposition.v3',
    commands,
    removed_commands: removed,
    removed_source_revision: removedCommandSourceRevision(removed),
  };
}

function validate(manifest) {
  return validateCommandSkillDispositions({
    manifest,
    root: ROOT,
    skillIds: ['shared-owner'],
    skills: [ownerSkill()],
  });
}

test('v3 enumerates all 31 root commands plus the module ts-check-status command', () => {
  const manifest = v3Manifest();
  assert.strictEqual(manifest.commands.length, 32);
  assert.deepStrictEqual(manifest.commands.slice(0, 31).map((row) => row.id), [...ROOT_COMMAND_IDS]);
  assert.deepStrictEqual(manifest.commands[31], {
    ...manifest.commands[31],
    id: 'ts-check-status',
    path: 'modules/js/commands/ts-check-status.md',
    public_name: '/dhpk:ts-check-status',
  });
  const result = validate(manifest);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.canonicalPaths.length, 32);
});

test('v3 allows several command rows to share one Skill owner', () => {
  const manifest = v3Manifest();
  const shared = manifest.commands.filter((row) => row.skill_owner === 'shared-owner');
  assert.deepStrictEqual(shared.map((row) => row.id), ['create-pr', 'create-release', 'pr-summary', 'ts-check-status']);
  assert.deepStrictEqual(validate(manifest).errors, []);
});

test('forwarding action authority cannot be broader than the selected owner action', () => {
  const manifest = v3Manifest();
  const row = manifest.commands.find((candidate) => candidate.id === 'pr-summary');
  row.forwarding.action = 'publish';
  const result = validate(manifest);
  assert.ok(result.errors.some((error) => /selected action|action.*authority|authority.*action/i.test(error)), result.errors.join('\n'));
});

test('forwarding rows require an owner and a readable Skill resource', () => {
  const manifest = v3Manifest();
  const row = manifest.commands.find((candidate) => candidate.id === 'create-pr');
  row.skill_owner = null;
  row.resource = '';
  const result = validate(manifest);
  assert.ok(result.errors.some((error) => /skill_owner|owner/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /resource.*(required|non-empty|path|readable|missing)/i.test(error)), result.errors.join('\n'));
});

test('legacy v2 command dispositions remain readable during the v3 migration', () => {
  const legacy = clone(CURRENT_MANIFEST);
  legacy.schema = 'dhpk.command-skill-disposition.v2';
  delete legacy.source_revision;
  legacy.commands = legacy.commands
    .filter((row) => /^commands\//.test(row.path))
    .map((row) => {
      const copy = { ...row };
      delete copy.resource;
      delete copy.forwarding;
      return copy;
    });
  const result = validateCommandSkillDispositions({
    manifest: legacy,
    root: ROOT,
    skillIds: INVENTORY_SKILL_IDS,
    skills: INVENTORY_SKILLS,
  });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));
const INVENTORY_SKILLS = INVENTORY.skills;
const INVENTORY_SKILL_IDS = INVENTORY_SKILLS.map((skill) => skill.id);

run('command-skill-portability');
