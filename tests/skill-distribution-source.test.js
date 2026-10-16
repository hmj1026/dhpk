'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { readSkillDirectory, readSkillDirectories, parseDistribution, DISTRIBUTION_SCHEMA } = require('../scripts/lib/skill-distribution-source');

function fixture(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-directory-source-'));
  const dir = path.join(root, 'skills', 'fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: fixture\ndescription: Fixture task\nmetadata:\n  dhpk-invocation-class: implicit-eligible\n---\n');
  if (body != null) fs.writeFileSync(path.join(dir, 'distribution.yaml'), body);
  return { root, dir };
}

test('missing authoring file supplies empty maps without a runtime dependency', () => {
  const { root, dir } = fixture();
  try {
    const skill = readSkillDirectory(root, dir);
    assert.strictEqual(skill.id, 'fixture');
    assert.strictEqual(skill.capability_id, 'dhpk.skill.fixture');
    assert.deepStrictEqual(skill.distribution, {});
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('versioned YAML supports comments and nested bulk data', () => {
  const parsed = parseDistribution('schema: dhpk.skill-distribution.v1\n# authoring comment\ncoverage:\n  references:\n    - references/task.md\ncommands:\n  - id: fixture\n    public_name: fixture\n', 'skills/fixture/distribution.yaml');
  assert.strictEqual(DISTRIBUTION_SCHEMA, 'dhpk.skill-distribution.v1');
  assert.deepStrictEqual(parsed.coverage.references, ['references/task.md']);
  assert.strictEqual(parsed.commands[0].id, 'fixture');
});

test('unknown version or bulk keys fail with authoring file identity', () => {
  for (const source of ['schema: other\n', 'schema: dhpk.skill-distribution.v1\nunknown: true\n']) {
    assert.throws(() => parseDistribution(source, 'skills/fixture/distribution.yaml'), /skills\/fixture\/distribution.yaml/);
  }
});

test('usage invocation class cannot disagree with compact frontmatter', () => {
  const { root, dir } = fixture('schema: dhpk.skill-distribution.v1\nusage:\n  invocation_class: explicit-only\n');
  try { assert.throws(() => readSkillDirectory(root, dir), /fixture.*invocation_class/); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stable identity survives a different public directory name', () => {
  for (const [directory, id] of [['tdd-workflow', 'tdd'], ['dhpk-openspec-artifact-guard', 'openspec-artifact-guard']]) {
    const root = path.join(__dirname, '..');
    const skill = readSkillDirectory(root, path.join(root, 'skills', directory));
    assert.strictEqual(skill.id, id);
    assert.strictEqual(skill.capability_id, `dhpk.skill.${id}`);
  }
});

test('duplicate authoring keys and unsupported YAML constructs fail closed', () => {
  for (const source of [
    'schema: dhpk.skill-distribution.v1\ncoverage: {}\ncoverage: {}\n',
    '{"schema":"dhpk.skill-distribution.v1","coverage":{},"coverage":{}}',
    'schema: dhpk.skill-distribution.v1\ncoverage: &anchor {}\n',
    'schema: dhpk.skill-distribution.v1\nusage: |\n  procedure\n',
  ]) assert.throws(() => parseDistribution(source, 'fixture/distribution.yaml'), /fixture\/distribution.yaml/);
});

run('skill-distribution-source');
