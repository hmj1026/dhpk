'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { inspectDiscoveryContext } = require('../scripts/ci/context-budget');
const {
  buildSkillRoutingProjection,
  compareSkillRoutingProjections,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

const ROUTING_IDS = [
  'laravel-5.4-notes',
  'laravel-6-notes',
  'laravel-7-notes',
  'laravel-8-notes',
  'laravel-9-notes',
  'laravel-10-notes',
  'laravel-11-notes',
  'laravel-mix-notes',
  'phpunit-9-modern',
  'phpunit-10-notes',
  'phpunit-11-notes',
];

function discoveryEntries() {
  const report = inspectDiscoveryContext({ root: ROOT, inventory: INVENTORY });
  return report.entries.filter((entry) => entry.surface === 'claude-module' && ROUTING_IDS.includes(entry.id));
}

function sourceFingerprints(prefix = 'source') {
  return Object.fromEntries(ROUTING_IDS.map((id) => [id, `${prefix}:${id}`]));
}

function projection(overrides = {}) {
  return buildSkillRoutingProjection({
    inventory: INVENTORY,
    surface: 'claude-module',
    discoveryEntries: discoveryEntries(),
    sourceFingerprints: sourceFingerprints(),
    ...overrides,
  });
}

function assertFrozenTree(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozenTree(child);
}

test('builds every Laravel and PHPUnit alias from the normalized router on claude-module', () => {
  const result = projection();
  assert.strictEqual(result.schema, 'dhpk.skill-routing-projection.v1');
  assert.strictEqual(result.surface, 'claude-module');
  assert.deepStrictEqual(result.entries.map((entry) => entry.stableId), [...ROUTING_IDS].sort());
  assert.deepStrictEqual(result.entries.map((entry) => ({
    stableId: entry.stableId,
    name: entry.name,
    familyId: entry.familyId,
    routerId: entry.routerId,
    selector: entry.selector,
    target: entry.target,
    invocationClass: entry.invocationClass,
    surfaces: entry.surfaces,
  })), [
    ['laravel', 'laravel-5.4-notes', '5.4', 'skills/dhpk-laravel-5-4-notes/SKILL.md'],
    ['laravel', 'laravel-6-notes', '6', 'skills/dhpk-laravel-6-notes/SKILL.md'],
    ['laravel', 'laravel-7-notes', '7', 'skills/dhpk-laravel-7-notes/SKILL.md'],
    ['laravel', 'laravel-8-notes', '8', 'skills/dhpk-laravel-8-notes/SKILL.md'],
    ['laravel', 'laravel-9-notes', '9', 'skills/dhpk-laravel-9-notes/SKILL.md'],
    ['laravel', 'laravel-10-notes', '10', 'skills/dhpk-laravel-10-notes/SKILL.md'],
    ['laravel', 'laravel-11-notes', '11', 'skills/dhpk-laravel-11-notes/SKILL.md'],
    ['laravel', 'laravel-mix-notes', 'mix', 'skills/dhpk-laravel-mix-notes/SKILL.md'],
    ['phpunit', 'phpunit-9-modern', '9', 'skills/dhpk-phpunit-9-modern/SKILL.md'],
    ['phpunit', 'phpunit-10-notes', '10', 'skills/dhpk-phpunit-10-notes/SKILL.md'],
    ['phpunit', 'phpunit-11-notes', '11', 'skills/dhpk-phpunit-11-notes/SKILL.md'],
  ].map(([familyId, stableId, selector, target]) => ({
    stableId,
    name: INVENTORY.skills.find((skill) => skill.id === stableId).name,
    familyId,
    routerId: 'php-pro',
    selector,
    target,
    invocationClass: 'implicit-eligible',
    surfaces: ['claude-module'],
  })).sort((left, right) => left.stableId.localeCompare(right.stableId)));
  for (const entry of result.entries) {
    assert.ok(fs.existsSync(path.join(ROOT, entry.target)), `${entry.stableId} target reference is missing: ${entry.target}`);
    assert.strictEqual(entry.sourceFingerprint, `source:${entry.stableId}`);
    assert.strictEqual(entry.words, discoveryEntries().find((item) => item.id === entry.stableId).words);
    assert.strictEqual(entry.tokens, discoveryEntries().find((item) => item.id === entry.stableId).tokens);
    assert.strictEqual(entry.wordBudget, discoveryEntries().find((item) => item.id === entry.stableId).wordBudget);
    assert.strictEqual(entry.tokenBudget, discoveryEntries().find((item) => item.id === entry.stableId).tokenBudget);
  }
  assertFrozenTree(result);
});

test('projection generation is sorted, repeatable, and byte-identical without mutating input', () => {
  const reversedInventory = JSON.parse(JSON.stringify(INVENTORY));
  reversedInventory.skill_routing_families.reverse();
  for (const family of reversedInventory.skill_routing_families) family.aliases.reverse();
  const reversedEntries = discoveryEntries().reverse();
  const reversedFingerprints = Object.fromEntries(Object.entries(sourceFingerprints()).reverse());
  const before = JSON.stringify(reversedInventory);

  const first = buildSkillRoutingProjection({
    inventory: reversedInventory,
    surface: 'claude-module',
    discoveryEntries: reversedEntries,
    sourceFingerprints: reversedFingerprints,
  });
  const second = buildSkillRoutingProjection({
    inventory: reversedInventory,
    surface: 'claude-module',
    discoveryEntries: reversedEntries,
    sourceFingerprints: reversedFingerprints,
  });

  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assert.strictEqual(JSON.stringify(first.entries.map((entry) => entry.stableId)), JSON.stringify([...ROUTING_IDS].sort()));
  assert.strictEqual(JSON.stringify(reversedInventory), before);
});

test('comparison reports missing, extra, and field drift with stable id and surface', () => {
  const expected = projection();
  const actual = JSON.parse(JSON.stringify(expected));
  const missingId = actual.entries.shift().stableId;
  const drifted = actual.entries[0];
  drifted.name = `${drifted.name}-drift`;
  const extraId = 'unexpected-routing-alias';
  actual.entries.push({
    ...drifted,
    stableId: extraId,
    name: 'dhpk-unexpected-routing-alias',
  });

  const expectedBefore = JSON.stringify(expected);
  const actualBefore = JSON.stringify(actual);
  const result = compareSkillRoutingProjections({ expected, actual });
  const diagnostics = result.diagnostics.join('\n');

  assert.strictEqual(result.ok, false);
  assert.match(diagnostics, new RegExp(`${missingId}.*claude-module.*missing`));
  assert.match(diagnostics, new RegExp(`${extraId}.*claude-module.*extra`));
  assert.match(diagnostics, new RegExp(`${drifted.stableId}.*claude-module.*name`));
  assert.ok(result.mismatches.some((mismatch) => mismatch.stableId === missingId));
  assert.ok(result.mismatches.some((mismatch) => mismatch.stableId === extraId));
  assert.ok(result.mismatches.some((mismatch) => mismatch.stableId === drifted.stableId));
  assert.strictEqual(JSON.stringify(expected), expectedBefore);
  assert.strictEqual(JSON.stringify(actual), actualBefore);
});

test('source and discovery budget drift are reported against the affected alias', () => {
  const expected = projection();
  const actual = projection({
    sourceFingerprints: { ...sourceFingerprints(), 'laravel-10-notes': 'source:changed' },
    discoveryEntries: discoveryEntries().map((entry) => entry.id === 'laravel-10-notes'
      ? { ...entry, wordBudget: entry.wordBudget + 1 }
      : entry),
  });
  const result = compareSkillRoutingProjections({ expected, actual });
  const diagnostics = result.diagnostics.join('\n');

  assert.strictEqual(result.ok, false);
  assert.match(diagnostics, /laravel-10-notes.*claude-module.*sourceFingerprint/);
  assert.match(diagnostics, /laravel-10-notes.*claude-module.*wordBudget/);
});

test('comparison does not mask duplicate stable IDs', () => {
  const expected = projection();
  const actual = JSON.parse(JSON.stringify(expected));
  const duplicateId = actual.entries[0].stableId;
  actual.entries.push({ ...actual.entries[0] });

  const result = compareSkillRoutingProjections({ expected, actual });

  assert.strictEqual(result.ok, false);
  assert.match(result.diagnostics.join('\n'), new RegExp(`${duplicateId}.*claude-module.*duplicated.*actual`));
  assert.ok(result.mismatches.some((item) => item.type === 'duplicate' && item.stableId === duplicateId));
});

test('React and Next version entries remain separate and are not folded into family routing', () => {
  const result = projection();
  const frontend = INVENTORY.skills
    .filter((skill) => ['react-18-notes', 'react-19-notes', 'nextjs-15-5-notes', 'nextjs-16-notes'].includes(skill.id))
    .map((skill) => ({ id: skill.id, path: skill.path }))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepStrictEqual(frontend, [
    { id: 'nextjs-15-5-notes', path: 'skills/dhpk-nextjs-15-5-notes' },
    { id: 'nextjs-16-notes', path: 'skills/dhpk-nextjs-16-notes' },
    { id: 'react-18-notes', path: 'skills/dhpk-react-18-notes' },
    { id: 'react-19-notes', path: 'skills/dhpk-react-19-notes' },
  ]);
  assert.deepStrictEqual(
    result.entries.filter((entry) => /^(react|nextjs)-/.test(entry.stableId)),
    [],
  );
});

run('skill-routing-projection-parity');
