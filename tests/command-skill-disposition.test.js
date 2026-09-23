'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  commandSourceRevision,
  validateCommandSkillDispositions,
} = require('../scripts/lib/command-skill-disposition');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/command-skill-dispositions.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

const REMOVED_COMMAND_IDS = Object.freeze([
  'check-skill', 'create-dev', 'do', 'codex-review', 'codex-review-fast',
  'codex-review-branch', 'codex-review-doc', 'codex-security',
  'codex-test-review', 'review-spec',
]);

function copyManifest() {
  return JSON.parse(JSON.stringify(manifest));
}

function legacyManifest() {
  const candidate = copyManifest();
  candidate.schema = 'dhpk.command-skill-disposition.v2';
  candidate.commands = candidate.commands
    .filter((row) => /^commands\//.test(row.path))
    .map((row) => {
      const copy = { ...row };
      delete copy.resource;
      delete copy.forwarding;
      return copy;
    });
  candidate.source_revision = commandSourceRevision(ROOT, candidate.commands.map((row) => row.path));
  return candidate;
}

function validate(candidate) {
  return validateCommandSkillDispositions({
    manifest: candidate,
    root: ROOT,
    skillIds: inventory.skills.map((skill) => skill.id),
    skills: inventory.skills,
  });
}

test('all canonical commands have exactly one validated disposition', () => {
  const result = validate(manifest);
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(result.canonicalPaths.length, manifest.schema === 'dhpk.command-skill-disposition.v3' ? 32 : 31);
});

test('disposition validation rejects a missing canonical command', () => {
  const candidate = copyManifest();
  candidate.commands.pop();
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /missing command disposition/i.test(error)));
});

test('disposition validation rejects duplicate public names and conflicting owners', () => {
  const candidate = legacyManifest();
  candidate.commands[1].public_name = candidate.commands[0].public_name;
  candidate.commands[1].skill_owner = 'git-smart-commit';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /public_name/i.test(error)) || result.errors.some((error) => /public name/i.test(error)));
  assert.ok(result.errors.some((error) => /conflicts/i.test(error)));
});

test('disposition validation rejects fabricated Consumer Evidence', () => {
  const candidate = copyManifest();
  candidate.commands[0].evidence.consumer = 'PASS';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /consumer PASS|fabricated/i.test(error)));
});

test('disposition validation rejects a front door authority above its Skill owner', () => {
  const candidate = copyManifest();
  const row = candidate.commands.find((entry) => entry.skill_owner === 'git-smart-commit');
  row.authority = 'external-write';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /authority exceeds Skill owner git-smart-commit maximum git-write/i.test(error)));
});

test('thin front doors preserve owner, authority, and argument contract parity', () => {
  const candidate = copyManifest();
  const guide = candidate.commands.find((entry) => entry.id === 'flow-guide');
  guide.argument_contract = '<route>';
  guide.authority = 'workspace-write';
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /argument_contract must match/i.test(error)));
  assert.ok(result.errors.some((error) => /authority must match Skill owner flow-guide/i.test(error)));
});

test('thin front doors identify one real Skill owner and Host-only rows explain themselves', () => {
  for (const row of manifest.commands.filter((entry) => entry.disposition === 'thin-front-door')) {
    assert.ok(row.skill_owner);
  }
  for (const row of manifest.commands.filter((entry) => entry.disposition === 'host-only' || entry.disposition === 'retired')) {
    assert.ok(row.reason);
  }
});

// RED contract for issue #534 P2.  The physical command inventory and the
// removed-name ledger are separate sets: historical command records remain
// useful for diagnostics but can never become executable discovery entries.
test('v2 command disposition keeps 31 active commands disjoint from the exact removed wave', () => {
  const legacy = legacyManifest();
  assert.strictEqual(legacy.schema, 'dhpk.command-skill-disposition.v2');
  assert.ok(Array.isArray(legacy.commands));
  assert.strictEqual(legacy.commands.length, 31);
  assert.ok(legacy.commands.every((row) => row.disposition !== 'retired' && row.outcome !== 'remove'));

  assert.ok(Array.isArray(legacy.removed_commands));
  assert.deepStrictEqual(legacy.removed_commands.map((row) => row.id).sort(), [...REMOVED_COMMAND_IDS].sort());
  assert.ok(legacy.removed_commands.every((row) => row.outcome === 'remove' || row.disposition === 'removed'));
  assert.ok(legacy.removed_commands.every((row) => Array.isArray(row.callers) && row.callers.length > 0));
  assert.ok(legacy.removed_commands.every((row) => row.evidence && typeof row.evidence === 'object'));
  assert.ok(typeof legacy.source_revision === 'string' && legacy.source_revision.startsWith('sha256:'));
  assert.ok(typeof legacy.removed_source_revision === 'string' && legacy.removed_source_revision.startsWith('sha256:'));

  const activeIds = new Set(legacy.commands.map((row) => row.id));
  assert.ok(legacy.removed_commands.every((row) => !activeIds.has(row.id)));
});

test('v2 command validation rejects an omitted removal and a present removed path', () => {
  const missing = legacyManifest();
  missing.removed_commands = (Array.isArray(missing.removed_commands)
    ? missing.removed_commands
    : REMOVED_COMMAND_IDS.map((id) => ({ id }))).slice(1);
  const missingResult = validate(missing);
  assert.ok(missingResult.errors.some((error) => /missing.*removed.*check-skill|check-skill.*missing/i.test(error)),
    `expected missing removed-command diagnostic, got:\n${missingResult.errors.join('\n')}`);

  const present = legacyManifest();
  present.commands.push({
    id: 'check-skill',
    path: 'commands/check-skill.md',
    host_surface: 'claude-command',
    public_name: '/dhpk:check-skill',
    argument_contract: '',
    authority: 'read-only',
    skill_owner: null,
    disposition: 'host-only',
    reason: 'test-only removed command resurrection',
    evidence: { structural: 'PASS', host_smoke: 'NOT_RUN', consumer: 'NOT_RUN' },
  });
  const presentResult = validate(present);
  assert.ok(presentResult.errors.some((error) => /check-skill.*removed|removed.*check-skill|retired.*path/i.test(error)),
    `expected removed-command resurrection diagnostic, got:\n${presentResult.errors.join('\n')}`);
});

run('command-skill-disposition');
