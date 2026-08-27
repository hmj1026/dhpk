'use strict';

// Task 1 contract tests. These fixtures describe the post-migration topology
// without asserting that the current 105-package tree has already migrated.
// The real-tree migration assertions belong to the later tasks.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventoryV2,
  validateInventoryV2,
  validateSkillTopology,
  validateTopology,
  generateClaudeSkillRoots,
} = require('../scripts/lib/distribution-inventory');

function skill(overrides = {}) {
  return {
    id: 'tdd',
    name: 'dhpk-tdd',
    path: 'skills/dhpk-tdd',
    capability_id: 'dhpk.tdd',
    lifecycle: 'promoted',
    tier: 'core',
    profiles: ['default'],
    surfaces: ['claude-core', 'codex-sync'],
    ...overrides,
  };
}

function inventory(skills = [skill()]) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills,
  };
}

function writeSkill(root, relDir, name, contentName = name) {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${contentName}\n---\n\n# ${name}\n`
  );
}

function makeTopologyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-topology-'));
  writeSkill(root, 'skills/dhpk-tdd', 'dhpk-tdd');
  fs.mkdirSync(path.join(root, 'modules', 'js', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'codex', 'skills'), { recursive: true });
  fs.symlinkSync(
    '../../../skills/dhpk-tdd',
    path.join(root, 'modules', 'js', 'skills', 'dhpk-tdd')
  );
  fs.symlinkSync(
    '../../skills/dhpk-tdd',
    path.join(root, 'codex', 'skills', 'dhpk-tdd')
  );
  writeSkill(root, 'plugins/dhpk/skills/dhpk-tdd', 'dhpk-tdd');
  return root;
}

function topologyResult(root, inv = inventory()) {
  const validator = validateSkillTopology || validateTopology;
  assert.strictEqual(typeof validator, 'function', 'Task 1 topology validator is not implemented');
  return validator({ root, inventory: inv, nativeRoots: ['plugins/dhpk'] });
}

function errorsFor(root, inv = inventory()) {
  return topologyResult(root, inv).errors;
}

test('v2 inventory accepts the required naming, identity, lifecycle, tier, profile, and surface fields', () => {
  const validator = validateDistributionInventoryV2 || validateInventoryV2;
  assert.strictEqual(typeof validator, 'function', 'Task 1 inventory v2 validator is not implemented');
  assert.deepStrictEqual(validator({ inventory: inventory() }).errors, []);
});

test('v2 inventory rejects schema drift, invalid public names, duplicate names/capabilities, and flat-path violations', () => {
  const validator = validateDistributionInventoryV2 || validateInventoryV2;
  assert.strictEqual(typeof validator, 'function', 'Task 1 inventory v2 validator is not implemented');

  const bad = inventory([
    skill({
      name: 'dhpk-tdd',
      path: 'modules/js/skills/dhpk-tdd-workflow',
      capability_id: 'dhpk.tdd',
      profiles: ['default', 'default'],
      legacy_names: ['old-tdd', 'old-tdd'],
    }),
    skill({ id: 'other', name: 'dhpk-tdd', path: 'skills/dhpk-tdd', capability_id: 'dhpk.tdd' }),
  ]);
  bad.schema = 'dhpk.distribution-inventory.v1';
  const result = validator({ inventory: bad });
  assert.ok(result.errors.some((error) => /schema/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /name/i.test(error) && /dhpk/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /duplicate.*name/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /capability/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /flat|canonical.*path|skills\//i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /profile/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /legacy/i.test(error)), result.errors.join('\n'));
});

test('v2 inventory rejects missing required fields and invalid tier/capability/profile values', () => {
  const validator = validateDistributionInventoryV2 || validateInventoryV2;
  assert.strictEqual(typeof validator, 'function', 'Task 1 inventory v2 validator is not implemented');
  const malformed = inventory([
    skill({
      id: '',
      name: 'dhpk-Bad',
      capability_id: 'capability',
      tier: 'experimental',
      profiles: [],
      surfaces: 'claude-core',
    }),
  ]);
  const result = validator({ inventory: malformed });
  assert.ok(result.errors.some((error) => /required|id/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /name/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /capability/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /tier/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /profile/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /surface/i.test(error)), result.errors.join('\n'));
});

test('Claude generator publishes one flat skill root and all live ids for v2 inventories', () => {
  assert.deepStrictEqual(generateClaudeSkillRoots(inventory([
    skill(),
    skill({ id: 'old', name: 'dhpk-old', path: 'skills/dhpk-old', capability_id: 'dhpk.old', lifecycle: 'deprecated' }),
    skill({ id: 'optional', name: 'dhpk-optional', path: 'skills/dhpk-optional', capability_id: 'dhpk.optional', tier: 'optional', lifecycle: 'optional' }),
  ])), {
    roots: ['./skills/'],
    registeredSkillIds: ['optional', 'tdd'],
    generatedSkillIds: ['optional', 'tdd'],
  });
  assert.deepStrictEqual(generateClaudeSkillRoots(inventory([
    skill({ lifecycle: 'deprecated' }),
  ])), { roots: [], registeredSkillIds: [], generatedSkillIds: [] });
});

test('topology accepts one physical canonical package with relative module and Codex projections and a physical native package', () => {
  const root = makeTopologyFixture();
  try {
    assert.deepStrictEqual(errorsFor(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('topology rejects non-flat canonical paths and folder/frontmatter/name mismatches', () => {
  const root = makeTopologyFixture();
  try {
    const inv = inventory([skill({ path: 'skills/nested/dhpk-tdd' })]);
    writeSkill(root, 'skills/dhpk-tdd', 'dhpk-tdd', 'wrong-name');
    const errors = errorsFor(root, inv);
    assert.ok(errors.some((error) => /flat|canonical.*path/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /frontmatter|folder|name|mismatch/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('topology rejects fewer or more than one physical canonical SKILL.md per live capability', () => {
  const missingRoot = makeTopologyFixture();
  try {
    fs.rmSync(path.join(missingRoot, 'skills', 'dhpk-tdd', 'SKILL.md'));
    const errors = errorsFor(missingRoot);
    assert.ok(errors.some((error) => /one|physical|canonical|missing|live/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(missingRoot, { recursive: true, force: true });
  }

  const duplicateRoot = makeTopologyFixture();
  try {
    writeSkill(duplicateRoot, 'skills/dhpk-extra', 'dhpk-extra', 'dhpk-tdd');
    const errors = errorsFor(duplicateRoot);
    assert.ok(errors.some((error) => /one|physical|canonical|duplicate|capability/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(duplicateRoot, { recursive: true, force: true });
  }
});

test('topology rejects duplicate live capability identities even when public names differ', () => {
  const root = makeTopologyFixture();
  try {
    writeSkill(root, 'skills/dhpk-other', 'dhpk-other');
    const inv = inventory([
      skill(),
      skill({
        id: 'other',
        name: 'dhpk-other',
        path: 'skills/dhpk-other',
        capability_id: 'dhpk.tdd',
      }),
    ]);
    const errors = errorsFor(root, inv);
    assert.ok(errors.some((error) => /duplicate.*capability|capability.*duplicate/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('topology rejects physical module/Codex projections, absolute/dangling/outside/wrong symlinks, and native-package symlinks', () => {
  const root = makeTopologyFixture();
  try {
    fs.rmSync(path.join(root, 'modules', 'js', 'skills', 'dhpk-tdd'));
    writeSkill(root, 'modules/js/skills/dhpk-tdd', 'dhpk-tdd');
    fs.rmSync(path.join(root, 'codex', 'skills', 'dhpk-tdd'));
    fs.symlinkSync('/tmp/dhpk-outside', path.join(root, 'codex', 'skills', 'dhpk-tdd'));
    fs.symlinkSync('../../skills/dhpk-tdd', path.join(root, 'plugins', 'dhpk', 'skills', 'dhpk-symlink'));
    const errors = errorsFor(root);
    assert.ok(errors.some((error) => /module/i.test(error) && /symlink|projection|physical/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /absolute|outside|repository|target/i.test(error)), errors.join('\n'));
    assert.ok(errors.some((error) => /native|symlink/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const danglingRoot = makeTopologyFixture();
  try {
    fs.rmSync(path.join(danglingRoot, 'codex', 'skills', 'dhpk-tdd'));
    fs.symlinkSync('../../skills/missing', path.join(danglingRoot, 'codex', 'skills', 'dhpk-tdd'));
    const errors = errorsFor(danglingRoot);
    assert.ok(errors.some((error) => /dangling|missing|target/i.test(error)), errors.join('\n'));
  } finally {
    fs.rmSync(danglingRoot, { recursive: true, force: true });
  }
});

run('skill-platform-topology');
