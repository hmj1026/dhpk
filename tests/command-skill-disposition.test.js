'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateCommandSkillDispositions } = require('../scripts/lib/command-skill-disposition');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/command-skill-dispositions.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

function copyManifest() {
  return JSON.parse(JSON.stringify(manifest));
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
  assert.strictEqual(result.canonicalPaths.length, 31);
});

test('disposition validation rejects a missing canonical command', () => {
  const candidate = copyManifest();
  candidate.commands.pop();
  const result = validate(candidate);
  assert.ok(result.errors.some((error) => /missing command disposition/i.test(error)));
});

test('disposition validation rejects duplicate public names and conflicting owners', () => {
  const candidate = copyManifest();
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

run('command-skill-disposition');
