'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  buildSkillRoutingProjection,
  compareSkillRoutingProjections,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

// The live 0.54 inventory is intentionally alias-free.  Keep the historical
// projection comparator canary on a disposable router fixture so it continues
// to test ordering, source/budget drift, and duplicate detection without
// requiring retired version packages to remain active.
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

const ROUTING_ROWS = [
  ['laravel', 'laravel-5.4-notes', '5.4', 'skills/laravel/references/5-4.md'],
  ['laravel', 'laravel-6-notes', '6', 'skills/laravel/references/6.md'],
  ['laravel', 'laravel-7-notes', '7', 'skills/laravel/references/7.md'],
  ['laravel', 'laravel-8-notes', '8', 'skills/laravel/references/8.md'],
  ['laravel', 'laravel-9-notes', '9', 'skills/laravel/references/9.md'],
  ['laravel', 'laravel-10-notes', '10', 'skills/laravel/references/10.md'],
  ['laravel', 'laravel-11-notes', '11', 'skills/laravel/references/11.md'],
  ['laravel', 'laravel-mix-notes', 'mix', 'skills/laravel/references/mix.md'],
  ['phpunit', 'phpunit-9-modern', '9', 'skills/phpunit/references/9.md'],
  ['phpunit', 'phpunit-10-notes', '10', 'skills/phpunit/references/10.md'],
  ['phpunit', 'phpunit-11-notes', '11', 'skills/phpunit/references/11.md'],
];

function projectionInventory() {
  const inventory = JSON.parse(JSON.stringify(INVENTORY));
  const aliasesByFamily = new Map();
  for (const [familyId, id, selector] of ROUTING_ROWS) {
    const aliases = aliasesByFamily.get(familyId) || [];
    aliases.push({
      id,
      selector,
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
    });
    aliasesByFamily.set(familyId, aliases);
    inventory.skills.push({
      id,
      name: `dhpk-${id}`,
      path: `skills/dhpk-${id}`,
      capability_id: `dhpk.${id}`,
      invocation_class: 'implicit-eligible',
      lifecycle: 'deprecated',
      discoveryVisible: false,
      legacy_names: [id],
      deprecation: {
        since: '2026-09-02',
        compatibilityWindowEnds: '2026-12-02',
        migrationNote: 'Historical projection comparator fixture only.',
      },
      tier: 'optional',
      profiles: ['compat-v1'],
      surfaces: ['claude-module'],
    });
  }
  inventory.skill_routing_families = inventory.skill_routing_families.map((family) => ({
    ...family,
    ...(aliasesByFamily.has(family.id) ? { aliases: aliasesByFamily.get(family.id) } : {}),
  }));
  return inventory;
}

const PROJECTION_INVENTORY = projectionInventory();

function discoveryEntries() {
  return ROUTING_IDS.map((id, index) => ({
    id,
    stableId: id,
    surface: 'claude-module',
    words: 20 + index,
    tokens: 30 + index,
    wordBudget: 100,
    tokenBudget: 200,
  }));
}

function sourceFingerprints(prefix = 'source') {
  return Object.fromEntries(ROUTING_IDS.map((id) => [id, `${prefix}:${id}`]));
}

function projection(overrides = {}) {
  return buildSkillRoutingProjection({
    inventory: PROJECTION_INVENTORY,
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
    ...ROUTING_ROWS,
  ].map(([familyId, stableId, selector, target]) => ({
    stableId,
    name: PROJECTION_INVENTORY.skills.find((skill) => skill.id === stableId).name,
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
  const reversedInventory = JSON.parse(JSON.stringify(PROJECTION_INVENTORY));
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

test('live 0.54 family routing is alias-free and uses renamed canonical paths', () => {
  for (const family of INVENTORY.skill_routing_families || []) {
    assert.ok(!Array.isArray(family.aliases) || family.aliases.length === 0,
      `${family.id} must not publish retired routing aliases`);
    for (const reference of Object.values(family.selectors || {})) {
      assert.match(reference, new RegExp(`^skills/${family.id}/references/`));
      assert.ok(fs.existsSync(path.join(ROOT, reference)), `missing live family reference: ${reference}`);
    }
  }
  const live = buildSkillRoutingProjection({
    inventory: INVENTORY,
    surface: 'claude-module',
  });
  assert.ok(live.entries.every((entry) => !ROUTING_IDS.includes(entry.stableId)));
  assert.ok(live.entries.every((entry) => !/skills\/dhpk-(?:laravel|phpunit)\//.test(entry.target || '')));
});

{
  // Named source-suite block consolidated from skill-routing-contract.test.js.

  // RED contract for the inventory-owned Laravel/PHPUnit family router. The
  // implementation follows in the production routing module; this suite only
  // fixes the observable normalized view and selector-resolution boundary.

  const { test, assert } = require('./_lib/tinytest');
  const {
    normalizeSkillRoutingFamilies,
    resolveSkillRoutingReference,
  } = require('../scripts/lib/distribution-inventory');

  const INVENTORY = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [
      { id: 'php-runtime-router', path: 'skills/dhpk-php-runtime-router', surfaces: ['claude-module'] },
      {
        id: 'laravel', path: 'skills/dhpk-laravel', lifecycle: 'promoted',
        invocation_class: 'implicit-eligible', surfaces: ['claude-core'],
      },
      {
        id: 'laravel-9-notes', path: 'skills/dhpk-laravel-9-notes', lifecycle: 'deprecated',
        invocation_class: 'implicit-eligible', legacy_names: ['laravel-9-notes'], discoveryVisible: false,
        surfaces: ['claude-module'],
        deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the Laravel family selector.' },
      },
      {
        id: 'laravel-10-notes', path: 'skills/dhpk-laravel-10-notes', lifecycle: 'deprecated',
        invocation_class: 'implicit-eligible', legacy_names: ['laravel-10-notes'], discoveryVisible: false,
        surfaces: ['claude-module'],
        deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the Laravel family selector.' },
      },
      {
        id: 'phpunit', path: 'skills/dhpk-phpunit', lifecycle: 'promoted',
        invocation_class: 'implicit-eligible', surfaces: ['claude-core'],
      },
      {
        id: 'phpunit-9-modern', path: 'skills/dhpk-phpunit-9-modern', lifecycle: 'deprecated',
        invocation_class: 'implicit-eligible', legacy_names: ['phpunit-9-modern'], discoveryVisible: false,
        surfaces: ['claude-module'],
        deprecation: { since: '2026-09-02', compatibilityWindowEnds: '2026-12-02', migrationNote: 'Use the PHPUnit family selector.' },
      },
    ],
    skill_routing_families: [
      {
        id: 'laravel',
        router_id: 'php-runtime-router',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-module'],
        selectors: {
          '10': 'skills/dhpk-laravel/references/10.md',
          '9': 'skills/dhpk-laravel/references/9.md',
        },
        aliases: [
          { id: 'laravel-10-notes', selector: '10', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
          { id: 'laravel-9-notes', selector: '9', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
        ],
      },
      {
        id: 'phpunit',
        router_id: 'php-runtime-router',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-module'],
        selectors: { '9': 'skills/dhpk-phpunit/references/9.md' },
        aliases: [
          { id: 'phpunit-9-modern', selector: '9', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
        ],
      },
    ],
  };

  function assertFrozenTree(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozenTree(child);
  }

  test('normalizes family records into a deterministic immutable public view', () => {
    const before = JSON.stringify(INVENTORY.skill_routing_families);
    const first = normalizeSkillRoutingFamilies({ inventory: INVENTORY });
    const second = normalizeSkillRoutingFamilies({ inventory: INVENTORY });

    assert.deepStrictEqual(first, [
      {
        id: 'laravel',
        routerId: 'php-runtime-router',
        invocationClass: 'implicit-eligible',
        surfaces: ['claude-module'],
        selectors: {
          '10': 'skills/dhpk-laravel/references/10.md',
          '9': 'skills/dhpk-laravel/references/9.md',
        },
        aliases: [
          { id: 'laravel-10-notes', selector: '10', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
          { id: 'laravel-9-notes', selector: '9', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
        ],
      },
      {
        id: 'phpunit',
        routerId: 'php-runtime-router',
        invocationClass: 'implicit-eligible',
        surfaces: ['claude-module'],
        selectors: { '9': 'skills/dhpk-phpunit/references/9.md' },
        aliases: [
          { id: 'phpunit-9-modern', selector: '9', invocationClass: 'implicit-eligible', surfaces: ['claude-module'] },
        ],
      },
    ]);
    assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
    assertFrozenTree(first);
    assert.strictEqual(JSON.stringify(INVENTORY.skill_routing_families), before);
  });

  test('resolves exactly one selector or stable alias and rejects ambiguous requests', () => {
    const families = normalizeSkillRoutingFamilies({ inventory: INVENTORY });

    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'laravel', selector: '10' }),
      'skills/dhpk-laravel/references/10.md',
    );
    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, id: 'laravel-9-notes' }),
      'skills/dhpk-laravel/references/9.md',
    );
    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'phpunit', selector: '9' }),
      'skills/dhpk-phpunit/references/9.md',
    );
    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, id: 'laravel-9-notes', selector: '10' }),
      null,
    );
    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'laravel', selector: '9.0' }),
      null,
    );
    assert.strictEqual(
      resolveSkillRoutingReference({ inventory: INVENTORY, families, familyId: 'missing', selector: '10' }),
      null,
    );
  });
}

{
  // Named source-suite block consolidated from skill-routing-frontend-regression.test.js.

  // Regression guard for the frontend identity contract. React 18/19 and
  // Next.js 15.5/16 are intentionally separate module/skill pairs; changing an
  // ID, source path, profile mapping, or module-provided skill must fail closed.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));

  // Keep these values literal: this test is the canary against accidental
  // consolidation or source remapping in the inventory itself.
  const EXPECTED_FRONTEND_MAPPINGS = [
    {
      moduleId: 'react-18',
      modulePath: 'modules/react-18',
      moduleSkill: 'dhpk-react-18-notes',
      skillId: 'react-18-notes',
      skillName: 'dhpk-react-18-notes',
      skillPath: 'skills/dhpk-react-18-notes',
      capabilityId: 'dhpk.skill.react-18-notes',
      profile: 'react-18',
    },
    {
      moduleId: 'react-19',
      modulePath: 'modules/react-19',
      moduleSkill: 'dhpk-react-19-notes',
      skillId: 'react-19-notes',
      skillName: 'dhpk-react-19-notes',
      skillPath: 'skills/dhpk-react-19-notes',
      capabilityId: 'dhpk.skill.react-19-notes',
      profile: 'react-19',
    },
    {
      moduleId: 'nextjs-15.5',
      modulePath: 'modules/nextjs-15.5',
      moduleSkill: 'dhpk-nextjs-15-5-notes',
      skillId: 'nextjs-15-5-notes',
      skillName: 'dhpk-nextjs-15-5-notes',
      skillPath: 'skills/dhpk-nextjs-15-5-notes',
      capabilityId: 'dhpk.skill.nextjs-15-5-notes',
      profile: 'nextjs-15.5',
    },
    {
      moduleId: 'nextjs-16',
      modulePath: 'modules/nextjs-16',
      moduleSkill: 'dhpk-nextjs-16-notes',
      skillId: 'nextjs-16-notes',
      skillName: 'dhpk-nextjs-16-notes',
      skillPath: 'skills/dhpk-nextjs-16-notes',
      capabilityId: 'dhpk.skill.nextjs-16-notes',
      profile: 'nextjs-16',
    },
  ];

  function providedSkills(moduleId) {
    const module = inventory.modules.find((entry) => entry.id === moduleId);
    assert.ok(module, `missing module inventory entry: ${moduleId}`);
    const source = fs.readFileSync(path.join(ROOT, module.path, 'module.yaml'), 'utf8');
    const match = source.match(/^provides:\s*\n\s+skills:\s+\[([^\]]*)\]/m);
    assert.ok(match, `${moduleId}/module.yaml has no provides.skills mapping`);
    return match[1].split(',').map((skill) => skill.trim()).filter(Boolean);
  }

  function skillFrontmatterName(skillPath) {
    const source = fs.readFileSync(path.join(ROOT, skillPath, 'SKILL.md'), 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(match, `${skillPath}/SKILL.md has no frontmatter`);
    const name = match[1].match(/^name:\s*(\S+)\s*$/m);
    assert.ok(name, `${skillPath}/SKILL.md has no name field`);
    return name[1];
  }

  test('React and Next frontend IDs remain separate with literal inventory mappings', () => {
    const actual = EXPECTED_FRONTEND_MAPPINGS.map((expected) => {
      const skill = inventory.skills.find((entry) => entry.id === expected.skillId);
      assert.ok(skill, `missing skill inventory entry: ${expected.skillId}`);
      const module = inventory.modules.find((entry) => entry.id === expected.moduleId);
      assert.ok(module, `missing module inventory entry: ${expected.moduleId}`);

      return {
        moduleId: module.id,
        modulePath: module.path,
        moduleSkill: providedSkills(module.id)[0],
        skillId: skill.id,
        skillName: skill.name,
        skillPath: skill.path,
        capabilityId: skill.capability_id,
        profile: skill.profiles[0],
      };
    });

    assert.deepStrictEqual(actual, EXPECTED_FRONTEND_MAPPINGS);
    assert.deepStrictEqual(
      actual.map((entry) => entry.moduleId),
      ['react-18', 'react-19', 'nextjs-15.5', 'nextjs-16'],
    );
    assert.deepStrictEqual(
      actual.map((entry) => entry.skillId),
      ['react-18-notes', 'react-19-notes', 'nextjs-15-5-notes', 'nextjs-16-notes'],
    );
    assert.strictEqual(new Set(actual.map((entry) => entry.moduleId)).size, 4);
    assert.strictEqual(new Set(actual.map((entry) => entry.skillId)).size, 4);
  });

  test('frontend inventory mappings point to the declared source skills and claude module surface', () => {
    for (const expected of EXPECTED_FRONTEND_MAPPINGS) {
      const skill = inventory.skills.find((entry) => entry.id === expected.skillId);
      const module = inventory.modules.find((entry) => entry.id === expected.moduleId);
      assert.deepStrictEqual(skill.surfaces, ['claude-module'], expected.skillId);
      assert.strictEqual(skill.lifecycle, 'optional', expected.skillId);
      assert.strictEqual(skill.tier, 'optional', expected.skillId);
      assert.deepStrictEqual(skill.profiles, [expected.profile], `${expected.skillId} must own exactly its expected profile`);
      assert.strictEqual(skillFrontmatterName(skill.path), expected.skillName);
      assert.deepStrictEqual(providedSkills(module.id), [expected.moduleSkill], expected.moduleId);
    }
  });
}

{
  // Named source-suite block consolidated from skill-routing-progressive-loading.test.js.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');
  const { inspectDiscoveryContext } = require('../scripts/ci/context-budget');

  const ROUTING_INVENTORY = {
    skill_routing_families: [{
      id: 'laravel',
      router_id: 'php-runtime-router',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: {
        '9': 'skills/dhpk-laravel/references/9.md',
        '10': 'skills/dhpk-laravel/references/10.md',
      },
      aliases: [
        {
          id: 'laravel-9-notes',
          selector: '9',
          invocation_class: 'implicit-eligible',
          surfaces: ['claude-module'],
        },
        {
          id: 'laravel-10-notes',
          selector: '10',
          invocation_class: 'implicit-eligible',
          surfaces: ['claude-module'],
        },
      ],
    }],
    skills: [
      {
        id: 'php-runtime-router',
        name: 'dhpk-php-runtime-router',
        path: 'skills/dhpk-php-runtime-router',
        lifecycle: 'promoted',
        surfaces: ['claude-module'],
      },
      {
        id: 'laravel',
        name: 'dhpk-laravel',
        path: 'skills/dhpk-laravel',
        lifecycle: 'promoted',
        invocation_class: 'implicit-eligible',
        discoveryVisible: true,
        surfaces: ['claude-module'],
      },
      {
        id: 'laravel-9-notes',
        name: 'dhpk-laravel-9-notes',
        path: 'skills/dhpk-laravel-9-notes',
        lifecycle: 'deprecated',
        invocation_class: 'implicit-eligible',
        discoveryVisible: false,
        legacy_names: ['laravel-9-notes'],
        surfaces: ['claude-module'],
        deprecation: {
          since: '2026-09-02',
          compatibilityWindowEnds: '2026-12-02',
          migrationNote: 'Use the Laravel family selector.',
        },
      },
      {
        id: 'laravel-10-notes',
        name: 'dhpk-laravel-10-notes',
        path: 'skills/dhpk-laravel-10-notes',
        lifecycle: 'deprecated',
        invocation_class: 'implicit-eligible',
        discoveryVisible: false,
        legacy_names: ['laravel-10-notes'],
        surfaces: ['claude-module'],
        deprecation: {
          since: '2026-09-02',
          compatibilityWindowEnds: '2026-12-02',
          migrationNote: 'Use the Laravel family selector.',
        },
      },
    ],
  };

  test('canonical family descriptions stay discovery-visible while legacy aliases remain hidden', () => {
    const report = inspectDiscoveryContext({
      root: process.cwd(),
      inventory: ROUTING_INVENTORY,
      readDescription: (entry) => entry.lifecycle === 'optional'
        ? 'Use for Laravel 10 compatibility decisions.'
        : 'Route PHP runtime work to the matching family reference.',
      budgets: {
        promoted: { 'claude-module': { words: 12, tokens: 48 } },
        optional: { 'claude-module': { words: 8, tokens: 32 } },
      },
    });

    const family = report.entries.find((entry) => entry.id === 'laravel');
    const legacy = report.entries.find((entry) => entry.id === 'laravel-10-notes');
    assert.strictEqual(family.discoveryVisible, true);
    assert.strictEqual(legacy.discoveryVisible, false);
    assert.match(legacy.visibilityReason, /host-invisible/);
  });

  test('initial discovery budget counts frontmatter description, not conditional reference bodies', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-progressive-loading-'));
    try {
      const skillDir = path.join(root, 'skills', 'dhpk-laravel');
      fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: dhpk-laravel',
          'description: Use for Laravel 10 compatibility decisions.',
          '---',
          '',
          'Load references/10.md only after selecting Laravel 10.',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(skillDir, 'references', '10.md'),
        `${'migration detail '.repeat(500)}\n`,
      );

      const report = inspectDiscoveryContext({
        root,
        inventory: {
          skills: [{
            id: 'laravel',
            name: 'dhpk-laravel',
            path: 'skills/dhpk-laravel',
            lifecycle: 'promoted',
            discoveryVisible: true,
            surfaces: ['claude-module'],
          }],
        },
        budgets: { promoted: { 'claude-module': { words: 8, tokens: 32 } } },
      });

      assert.strictEqual(report.entries[0].words, 6);
      assert.strictEqual(report.entries[0].tokens, 11);
      assert.deepStrictEqual(report.violations, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

{
  // Named source-suite block consolidated from skill-public-name-routing.test.js.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));

  // These legacy IDs are also ordinary domain vocabulary in descriptions. Their
  // occurrences are not reliable routing signals; canonical handoffs that use
  // them are covered by the exact-name integrity checks elsewhere.
  const AMBIGUOUS_TERMS = new Set(['deploy-list', 'tdd']);
  const AGENT_ROLE_TERMS = new Set(['agy-fast-worker']);

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function legacyNamesToPublic(skills) {
    const legacyToPublic = new Map();
    for (const skill of skills) {
      for (const legacy of skill.legacy_names || []) {
        if (legacy !== skill.name && !AMBIGUOUS_TERMS.has(legacy)) {
          legacyToPublic.set(legacy, skill.name);
        }
      }
    }
    return legacyToPublic;
  }

  function skillDescription(source, label) {
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontmatter, `${label} must have YAML frontmatter`);
    const lines = frontmatter[1].split(/\r?\n/);
    const descriptionIndex = lines.findIndex((line) => /^description:\s*/.test(line));
    assert.notStrictEqual(descriptionIndex, -1, `${label} must declare a description`);

    const rawValue = lines[descriptionIndex].replace(/^description:\s*/, '').trim();
    let description = rawValue;
    if (/^[>|][+-]?$/.test(rawValue)) {
      const content = [];
      for (const line of lines.slice(descriptionIndex + 1)) {
        if (line.trim() && !/^\s+/.test(line)) break;
        if (line.trim()) content.push(line.trim());
      }
      description = content.join(' ');
    } else if ((rawValue.startsWith('"') && rawValue.endsWith('"'))
      || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      description = rawValue.slice(1, -1).trim();
    }

    assert.ok(description, `${label} must have a nonempty parsed description`);
    return description;
  }

  function legacyRouteFindings(description, legacyToPublic) {
    const findings = [];
    for (const [legacy, publicName] of legacyToPublic) {
      const routingDescription = AGENT_ROLE_TERMS.has(legacy)
        ? description.replace(new RegExp(`${escapeRegExp(legacy)}\\s+subagent`, 'ig'), '')
        : description;
      const bareLegacy = new RegExp(
        `(?<![a-z0-9-])${escapeRegExp(legacy)}(?![a-z0-9-])`,
        'i',
      );
      if (bareLegacy.test(routingDescription)) {
        findings.push(`${legacy} -> ${publicName}`);
      }
    }
    return findings;
  }

  test('legacy-name detector catches aliases and preserves documented exemptions', () => {
    const legacyToPublic = legacyNamesToPublic([{
      name: 'flow-guide',
      legacy_names: ['old-flow-guide', 'deploy-list', 'tdd', 'agy-fast-worker'],
    }]);

    assert.deepStrictEqual(
      legacyRouteFindings('Route through old-flow-guide for this task.', legacyToPublic),
      ['old-flow-guide -> flow-guide'],
    );
    assert.deepStrictEqual(
      legacyRouteFindings('deploy-list and tdd are ordinary terms; use the agy-fast-worker subagent.', legacyToPublic),
      [],
    );
    assert.deepStrictEqual(
      legacyRouteFindings('Invoke agy-fast-worker directly.', legacyToPublic),
      ['agy-fast-worker -> flow-guide'],
    );
    assert.throws(() => skillDescription('---\nname: empty\n---\n', 'empty fixture'), /description/);
    assert.throws(() => skillDescription(
      '---\nname: empty-block\ndescription: >\n---\n',
      'empty block fixture',
    ), /nonempty parsed description/);
  });

  test('skill routing descriptions use public dhpk names, never legacy aliases', () => {
    const findings = [];
    const legacyToPublic = legacyNamesToPublic(inventory.skills);

    for (const skill of inventory.skills) {
      const skillFile = path.join(ROOT, skill.path, 'SKILL.md');
      const source = fs.readFileSync(skillFile, 'utf8');
      const description = skillDescription(source, path.relative(ROOT, skillFile));
      for (const finding of legacyRouteFindings(description, legacyToPublic)) {
        findings.push(`${path.relative(ROOT, skillFile)}: ${finding}`);
      }
    }

    assert.deepStrictEqual(findings, [], `legacy routing names remain:\n${findings.join('\n')}`);
  });
}

{
  // Named source-suite block consolidated from version-family-skills.test.js.

  // Contract for the consolidated Laravel and PHPUnit family skills.  These
  // tests were authored against the pre-consolidation tree as the RED baseline;
  // the family implementation is now present, so the focused run should be
  // GREEN.
  //
  // The family-local resolver is deliberately exercised through its public
  // module and JSON CLI.  These tests do not parse SKILL.md to infer behavior:
  // the resolver must select one reference, load its guidance, and report an
  // actionable ask when selection is impossible.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');
  const {
    generateClaudeSkillRoots,
    resolveSkillRoutingAlias,
    resolveSkillRoutingReference,
    validateSkillRoutingFamilies,
  } = require('../scripts/lib/distribution-inventory');

  const ROOT = path.join(__dirname, '..');
  const INVENTORY_FILE = path.join(ROOT, 'manifests', 'distribution-inventory.json');

  const FAMILY_CONTRACTS = Object.freeze({
    laravel: Object.freeze({
      directory: 'laravel',
      selectors: Object.freeze(['5.4', '6', '7', '8', '9', '10', '11', 'mix']),
      references: Object.freeze({
        '5.4': 'references/5-4.md',
        '6': 'references/6.md',
        '7': 'references/7.md',
        '8': 'references/8.md',
        '9': 'references/9.md',
        '10': 'references/10.md',
        '11': 'references/11.md',
        mix: 'references/mix.md',
      }),
      legacyIds: Object.freeze({
        '5.4': 'laravel-5.4-notes',
        '6': 'laravel-6-notes',
        '7': 'laravel-7-notes',
        '8': 'laravel-8-notes',
        '9': 'laravel-9-notes',
        '10': 'laravel-10-notes',
        '11': 'laravel-11-notes',
        mix: 'laravel-mix-notes',
      }),
      composerJson: { require: { 'laravel/framework': '^9.0' } },
    }),
    phpunit: Object.freeze({
      directory: 'phpunit',
      selectors: Object.freeze(['9', '10', '11']),
      references: Object.freeze({
        '9': 'references/9.md',
        '10': 'references/10.md',
        '11': 'references/11.md',
      }),
      legacyIds: Object.freeze({
        '9': 'phpunit-9-modern',
        '10': 'phpunit-10-notes',
        '11': 'phpunit-11-notes',
      }),
      composerJson: { require: { 'phpunit/phpunit': '^9.6' } },
    }),
  });

  function readInventory() {
    return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
  }

  function familyRoot(family) {
    return path.join(ROOT, 'skills', FAMILY_CONTRACTS[family].directory);
  }

  function apiPath(family) {
    return path.join(familyRoot(family), 'scripts', 'version-resolver.js');
  }

  function cliPath(family) {
    return path.join(familyRoot(family), 'scripts', 'resolve-version.js');
  }

  function loadResolver(family) {
    try {
      return require(apiPath(family));
    } catch (error) {
      return { __loadError: error };
    }
  }

  function resolveViaApi(family, options) {
    const resolver = loadResolver(family);
    assert.ifError(resolver.__loadError);
    assert.strictEqual(
      typeof resolver.resolveVersion,
      'function',
      `${family} family resolver must export resolveVersion(options)`,
    );
    return resolver.resolveVersion(options);
  }

  function runFamilyCli(family, args, cwd) {
    return spawnSync(process.execPath, [cliPath(family), '--json', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
      timeout: 10000,
    });
  }

  function writeFiles(root, files) {
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  function withProject(files, callback) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-project-'));
    try {
      writeFiles(project, files);
      return callback(project);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }

  function expectedReference(family, selector) {
    return FAMILY_CONTRACTS[family].references[selector];
  }

  function assertResolved(result, family, selector, source) {
    const reference = expectedReference(family, selector);
    assert.strictEqual(result.status, 'resolved');
    assert.strictEqual(result.family, family);
    assert.strictEqual(result.selector, selector);
    assert.strictEqual(result.source, source);
    assert.strictEqual(result.reference, reference);
    assert.deepStrictEqual(result.loadedReferences, [reference]);
    assert.strictEqual(typeof result.guidance, 'string');
    assert.strictEqual(
      result.guidance,
      fs.readFileSync(path.join(familyRoot(family), reference), 'utf8'),
      `${family} resolver must return the selected reference guidance`,
    );
    assert.ok(
      result.loadedReferences.every((loaded) => loaded === reference),
      `${family} resolver must not load sibling-version references`,
    );
  }

  test('Laravel API resolves every explicit selector and loads exactly one version reference', () => {
    withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
      for (const selector of FAMILY_CONTRACTS.laravel.selectors) {
        const result = resolveViaApi('laravel', { version: selector, cwd });
        assertResolved(result, 'laravel', selector, 'explicit');
      }
    });
  });

  test('PHPUnit API resolves every explicit selector and loads exactly one version reference', () => {
    withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
      for (const selector of FAMILY_CONTRACTS.phpunit.selectors) {
        const result = resolveViaApi('phpunit', { version: selector, cwd });
        assertResolved(result, 'phpunit', selector, 'explicit');
      }
    });
  });

  test('Laravel API auto-detects its version from composer.json without a dhpk manifest', () => {
    withProject({ 'composer.json': JSON.stringify(FAMILY_CONTRACTS.laravel.composerJson) }, (cwd) => {
      const result = resolveViaApi('laravel', { cwd });
      assertResolved(result, 'laravel', '9', 'composer.json');
    });
  });

  test('PHPUnit API auto-detects its version from composer.lock without a dhpk manifest', () => {
    withProject({
      'composer.lock': JSON.stringify({
        packages: [{ name: 'phpunit/phpunit', version: '10.5.20' }],
        'packages-dev': [],
      }),
    }, (cwd) => {
      const result = resolveViaApi('phpunit', { cwd });
      assertResolved(result, 'phpunit', '10', 'composer.lock');
    });
  });

  test('Laravel API fails closed with an actionable ask when no version can be detected', () => {
    withProject({}, (cwd) => {
      const result = resolveViaApi('laravel', { cwd });
      assert.strictEqual(result.status, 'ask');
      assert.strictEqual(result.selector, null);
      assert.strictEqual(result.reference, null);
      assert.deepStrictEqual(result.loadedReferences, []);
      assert.strictEqual(typeof result.question, 'string');
      assert.match(result.question, /Laravel/i);
      assert.match(result.question, /version/i);
    });
  });

  test('PHPUnit API fails closed with an actionable ask for an unsupported version', () => {
    withProject({}, (cwd) => {
      const result = resolveViaApi('phpunit', { version: '12', cwd });
      assert.strictEqual(result.status, 'ask');
      assert.strictEqual(result.selector, null);
      assert.strictEqual(result.reference, null);
      assert.deepStrictEqual(result.loadedReferences, []);
      assert.strictEqual(typeof result.question, 'string');
      assert.match(result.question, /PHPUnit/i);
      assert.match(result.question, /version/i);
    });
  });

  test('Laravel resolver CLI returns the explicit selector contract as JSON', () => {
    withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
      const result = runFamilyCli('laravel', ['--version', '8'], cwd);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assertResolved(payload, 'laravel', '8', 'explicit');
    });
  });

  test('Laravel resolver CLI returns an ask contract and nonzero exit for an unsupported selector', () => {
    withProject({}, (cwd) => {
      const result = runFamilyCli('laravel', ['--version', '12'], cwd);
      assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'ask');
      assert.strictEqual(payload.family, undefined);
      assert.strictEqual(payload.selector, null);
      assert.strictEqual(payload.reference, null);
      assert.deepStrictEqual(payload.loadedReferences, []);
      assert.match(payload.question, /Laravel/i);
      assert.match(payload.question, /version/i);
    });
  });

  test('Laravel resolver CLI returns an ask contract and nonzero exit when no version is available', () => {
    withProject({}, (cwd) => {
      const result = runFamilyCli('laravel', [], cwd);
      assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'ask');
      assert.strictEqual(payload.family, undefined);
      assert.strictEqual(payload.selector, null);
      assert.strictEqual(payload.reference, null);
      assert.deepStrictEqual(payload.loadedReferences, []);
      assert.match(payload.question, /Laravel/i);
      assert.match(payload.question, /version/i);
    });
  });

  test('PHPUnit resolver CLI returns the auto-detected selector contract as JSON', () => {
    withProject({
      'composer.json': JSON.stringify({ require: { 'phpunit/phpunit': '^11.0' } }),
    }, (cwd) => {
      const result = runFamilyCli('phpunit', [], cwd);
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assertResolved(payload, 'phpunit', '11', 'composer.json');
    });
  });

  test('a copied Laravel family directory resolves explicitly with no repository dependencies', () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-copy-'));
    try {
      const copiedFamily = path.join(stage, 'laravel');
      const emptyProject = path.join(stage, 'empty-project');
      fs.cpSync(familyRoot('laravel'), copiedFamily, { recursive: true });
      fs.mkdirSync(emptyProject);

      const result = spawnSync(process.execPath, [
        path.join(copiedFamily, 'scripts', 'resolve-version.js'),
        '--json', '--version', '6',
      ], {
        cwd: emptyProject,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assertResolved(payload, 'laravel', '6', 'explicit');
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });

  test('a copied PHPUnit family directory resolves explicitly with no repository dependencies', () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-copy-'));
    try {
      const copiedFamily = path.join(stage, 'phpunit');
      const emptyProject = path.join(stage, 'empty-project');
      fs.cpSync(familyRoot('phpunit'), copiedFamily, { recursive: true });
      fs.mkdirSync(emptyProject);

      const result = spawnSync(process.execPath, [
        path.join(copiedFamily, 'scripts', 'resolve-version.js'),
        '--json', '--version', '9',
      ], {
        cwd: emptyProject,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: '' },
        timeout: 10000,
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assertResolved(payload, 'phpunit', '9', 'explicit');
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });

  test('checked-in family IDs resolve selectors while retired version IDs remain alias-free', () => {
    const inventory = readInventory();
    const families = inventory.skill_routing_families || [];
    const familyById = new Map(families.map((family) => [family.id, family]));

    for (const [familyId, contract] of Object.entries(FAMILY_CONTRACTS)) {
      const family = familyById.get(familyId);
      assert.ok(family, `${familyId} routing family must exist`);
      assert.strictEqual(family.router_id, 'php-pro');
      assert.strictEqual(family.invocation_class, 'implicit-eligible');
      const familyEntry = inventory.skills.find((skill) => skill.id === familyId);
      assert.ok(familyEntry, `${familyId} family skill must have a canonical inventory entry`);
      assert.strictEqual(familyEntry.path, `skills/${contract.directory}`);
      assert.strictEqual(familyEntry.lifecycle, 'promoted');
      assert.strictEqual(familyEntry.invocation_class, family.invocation_class);
      assert.ok(familyEntry.surfaces.includes('claude-core'));

      assert.deepStrictEqual(family.aliases || [], [], `${familyId} must not publish compatibility aliases`);
      for (const selector of contract.selectors) {
        const legacyId = contract.legacyIds[selector];
        const reference = `skills/${contract.directory}/${contract.references[selector]}`;

        assert.strictEqual(family.selectors[selector], reference);
        assert.strictEqual(
          resolveSkillRoutingReference({ inventory, families, familyId, selector }),
          reference,
        );
        assert.strictEqual(resolveSkillRoutingAlias({ families, id: legacyId }), null);
        assert.strictEqual(resolveSkillRoutingReference({ inventory, families, id: legacyId }), null);
        const retired = inventory.retired_skills.find((entry) => entry.id === legacyId);
        assert.ok(retired, `${legacyId} must remain in the retirement ledger`);
        assert.deepStrictEqual(retired.replacements, [{
          kind: 'skill',
          id: familyId,
          mode: selector,
        }]);
      }
    }
  });

  test('retired family IDs are absent from discovery-generated IDs and active inventory', () => {
    const inventory = readInventory();
    const generated = generateClaudeSkillRoots(inventory).generatedSkillIds;

    for (const contract of Object.values(FAMILY_CONTRACTS)) {
      for (const legacyId of Object.values(contract.legacyIds)) {
        const entry = inventory.retired_skills.find((skill) => skill.id === legacyId);
        assert.ok(entry, `${legacyId} must remain in the retirement ledger`);
        assert.strictEqual(entry.retiredIn, '0.54.0');
        assert.ok(!inventory.skills.some((skill) => skill.id === legacyId));
        assert.ok(!generated.includes(legacyId), `${legacyId} must not be discovery-generated`);
      }
    }
  });

  function routingFixture() {
    return {
      id: 'laravel',
      router_id: 'php-pro',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
      selectors: { '8': 'skills/laravel/references/8.md' },
      aliases: [{
        id: 'laravel-8-notes',
        selector: '8',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-module'],
      }],
    };
  }

  function validateRoutingFixture(families) {
    return validateSkillRoutingFamilies({
      families,
      skillIds: new Set(['php-pro']),
      skills: [],
    });
  }

  test('routing validator rejects an alias that names no selector', () => {
    const family = routingFixture();
    family.aliases[0].selector = 'missing';
    const result = validateRoutingFixture([family]);
    assert.ok(result.errors.some((error) => /ambiguous\/missing selector/.test(error)), result.errors.join('\n'));
    assert.strictEqual(resolveSkillRoutingReference({ families: [family], familyId: 'laravel', selector: 'missing' }), null);
  });

  test('routing validator rejects invocation-class and surface drift on an alias', () => {
    const family = routingFixture();
    family.aliases[0].invocation_class = 'explicit-only';
    family.aliases[0].surfaces = ['claude-core'];
    const result = validateRoutingFixture([family]);
    assert.ok(result.errors.some((error) => /conflicting invocation class/.test(error)), result.errors.join('\n'));
    assert.ok(result.errors.some((error) => /unsupported surface membership/.test(error)), result.errors.join('\n'));
    assert.strictEqual(resolveSkillRoutingReference({ families: [family], id: 'laravel-8-notes' }), null);
  });

  test('routing resolver rejects unsafe references and duplicate alias identities', () => {
    const unsafe = routingFixture();
    unsafe.selectors['8'] = '../outside/SKILL.md';
    const duplicate = routingFixture();
    duplicate.id = 'phpunit';
    duplicate.aliases[0].id = 'laravel-8-notes';
    const families = [unsafe, duplicate];
    const result = validateRoutingFixture(families);
    assert.ok(result.errors.some((error) => /safe relative path/.test(error)), result.errors.join('\n'));
    assert.ok(result.errors.some((error) => /duplicate alias/.test(error)), result.errors.join('\n'));
    assert.strictEqual(resolveSkillRoutingReference({ families, id: 'laravel-8-notes' }), null);
  });
}

run('skill-routing-projection-parity');
