'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  resolveSkillIdentity,
  formatSkillIdentityDiagnostic,
  validateSkillRetirements,
  preserveProjectionContract,
  compileClaudeProjection,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = require('../manifests/distribution-inventory.json');
const RETIRED_NAMES = [
  'dhpk-bug-fix',
  'dhpk-feature-dev',
  'dhpk-post-dev-test',
  'dhpk-codex-brainstorm',
  'dhpk-de-ai-flavor',
  'dhpk-codex-architect',
  'dhpk-codex-implement',
];
const RETIREMENTS = [
  {
    id: 'bug-fix', name: 'dhpk-bug-fix', canonicalPath: 'skills/dhpk-bug-fix', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'flow-guide', mode: 'classify' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'feature-dev', name: 'dhpk-feature-dev', canonicalPath: 'skills/dhpk-feature-dev', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'flow-guide', mode: 'classify' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'post-dev-test', name: 'dhpk-post-dev-test', canonicalPath: 'skills/dhpk-post-dev-test', retiredIn: '0.47.0',
    reasonCode: 'split-by-test-level', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'tdd', mode: 'unit-integration' }, { kind: 'agent', id: 'e2e-runner', mode: 'playwright-journey' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'codex-brainstorm', name: 'dhpk-codex-brainstorm', canonicalPath: 'skills/dhpk-codex-brainstorm', retiredIn: '0.47.0',
    reasonCode: 'merged-into-architect-mode', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'software-architecture', mode: 'adversarial' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'de-ai-flavor', name: 'dhpk-de-ai-flavor', canonicalPath: 'skills/dhpk-de-ai-flavor', retiredIn: '0.47.0',
    reasonCode: 'model-default-capability-removal', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'model-default' }], rollback: { release: '0.46.1' },
  },
  {
    id: 'codex-architect', name: 'dhpk-codex-architect', canonicalPath: 'skills/dhpk-codex-architect', retiredIn: '0.52.0',
    reasonCode: 'migrated-to-module-design', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'software-architecture', mode: 'design' }], rollback: { release: '0.51.0' },
  },
  {
    id: 'codex-implement', name: 'dhpk-codex-implement', canonicalPath: 'skills/dhpk-codex-implement', retiredIn: '0.52.0',
    reasonCode: 'migrated-to-backend-neutral-implement', priorSurfaces: ['claude-core', 'cursor-sync'],
    replacements: [{ kind: 'skill', id: 'flow-drive', mode: 'implement' }], rollback: { release: '0.51.0' },
  },
];

function fixtureInventory() {
  return {
    ...INVENTORY,
    skills: INVENTORY.skills.filter((entry) => !RETIRED_NAMES.includes(entry.name)),
    retired_skills: INVENTORY.retired_skills,
    surface_membership: Object.fromEntries(Object.entries(INVENTORY.surface_membership || {}).map(([surface, ids]) => [
      surface,
      ids.filter((id) => !RETIREMENTS.some((entry) => entry.id === id)),
    ])),
  };
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function walkTextFiles(relative) {
  const absolute = path.join(ROOT, relative);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walkTextFiles(child) : [child];
  });
}

test('checked-in inventory owns historical and capability-family alias-free retirement records', () => {
  assert.ok(Array.isArray(INVENTORY.retired_skills), 'checked-in inventory must declare retired_skills');
  assert.deepStrictEqual(validateSkillRetirements({ inventory: INVENTORY }).errors, []);
  for (const expected of RETIREMENTS) {
    const actual = INVENTORY.retired_skills.find((entry) => entry.id === expected.id);
    assert.ok(actual, `checked-in inventory is missing retirement ${expected.id}`);
    assert.deepStrictEqual(actual, expected, `checked-in retirement record drifted: ${expected.id}`);
  }
  assert.deepStrictEqual(
    INVENTORY.retired_skills.filter((entry) => entry.retiredIn === '0.47.0').map((entry) => entry.name).sort(),
    [...RETIRED_NAMES.slice(0, 5)].sort(),
  );
  assert.strictEqual(INVENTORY.retired_skills.filter((entry) => entry.retiredIn === '0.52.0').length, 2);
  assert.strictEqual(INVENTORY.retired_skills.filter((entry) => entry.retiredIn === '0.53.0').length, 22);
  assert.ok(RETIRED_NAMES.every((name) => !INVENTORY.skills.some((entry) => entry.name === name)));
  assert.ok(RETIRED_NAMES.every((name) => !fs.existsSync(path.join(ROOT, 'skills', name))));
});

test('retirement validation rejects a skill replacement that is not active', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 0
    ? { ...entry, replacements: [{ kind: 'skill', id: 'missing-successor', mode: 'bug' }] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /must reference an active skill.*missing-successor/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects agent replacements outside the inventory-owned roster', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 2
    ? { ...entry, replacements: [{ kind: 'agent', id: 'not-an-agent', mode: 'playwright-journey' }] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /inventory-owned active agent.*not-an-agent/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects surfaces outside the canonical surface enum', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = inventory.retired_skills.map((entry, index) => index === 0
    ? { ...entry, priorSurfaces: ['claude-core', 'made-up-surface'] }
    : entry);
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /invalid surface.*made-up-surface/.test(error)), result.errors.join('\n'));
});

test('retirement validation rejects unsafe stable ids before diagnostics', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = [{
    ...inventory.retired_skills[0],
    id: '../retired-helper',
  }, ...inventory.retired_skills.slice(1)];
  const result = validateSkillRetirements({ inventory });
  assert.ok(result.errors.some((error) => /id.*safe|id.*format|id.*identifier/i.test(error)), result.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: '../retired-helper' }), {
    state: 'unknown', identifier: '../retired-helper',
  });
});

test('retirement rows reject compatibility aliases and active identity wins on collision', () => {
  const aliased = fixtureInventory();
  aliased.retired_skills = [{ ...aliased.retired_skills[0], legacy_names: ['old-bug-fix'] }, ...aliased.retired_skills.slice(1)];
  const validation = validateSkillRetirements({ inventory: aliased });
  assert.ok(validation.errors.some((error) => /legacy_names.*alias-free/.test(error)), validation.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory: aliased, identifier: 'old-bug-fix' }), {
    state: 'unknown', identifier: 'old-bug-fix',
  });

  const collision = fixtureInventory();
  collision.retired_skills = [{
    ...collision.retired_skills[0], id: 'tdd', name: 'dhpk-tdd-workflow', legacy_names: ['tdd'],
  }, ...collision.retired_skills.slice(1)];
  assert.deepStrictEqual(resolveSkillIdentity({ inventory: collision, identifier: 'tdd' }), {
    state: 'active', stableId: 'tdd', publicName: 'tdd-workflow',
  });
});

test('inventory regeneration and normalized projection evidence preserve retirement identity', () => {
  const inventory = fixtureInventory();
  const generated = { schema: inventory.schema, skills: inventory.skills, modules: inventory.modules };
  const preserved = preserveProjectionContract(generated, inventory);
  assert.deepStrictEqual(preserved.retired_skills, inventory.retired_skills);
  const compiled = compileClaudeProjection({ inventory });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.deepStrictEqual(
    compiled.inventoryView.retiredSkills.map((entry) => entry.id).sort(),
    inventory.retired_skills.map((entry) => entry.id).sort(),
  );
  assert.ok(compiled.generated.generatedSkillIds.every((id) => !inventory.retired_skills.some((entry) => entry.id === id)));
});

test('migration documentation mirrors all seven retirement rows and host limits', () => {
  const documents = [read('docs/skill-platform-migration.md'), read('docs/skill-platform-migration.zh-TW.md')];
  const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const text of documents) {
    assert.match(text, /retired_skills/);
    assert.match(text, /0\.46\.1/);
    assert.match(text, /unknown-skill/);
    assert.match(text, /(?:direct invocation|直接呼叫)/i);
    assert.match(text, /(?:bypass|繞過)/i);
    assert.match(text, /(?:discovery alias|discovery 或 compatibility alias)/i);
    for (const entry of RETIREMENTS) {
      assert.match(text, new RegExp(escaped(entry.id)));
      assert.match(text, new RegExp(escaped(entry.name)));
      assert.match(text, new RegExp(escaped(entry.reasonCode)));
      assert.match(text, new RegExp(escaped(entry.rollback.release)));
      for (const replacement of entry.replacements) {
        assert.match(text, new RegExp(escaped(replacement.kind)));
        if (replacement.id) assert.match(text, new RegExp(escaped(replacement.id)));
        if (replacement.mode) assert.match(text, new RegExp(escaped(replacement.mode)));
      }
    }
  }
});

test('identity resolution distinguishes active, retired skill, retired model-default, and unknown', () => {
  const inventory = fixtureInventory();
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'tdd' }), {
    state: 'active', stableId: 'tdd', publicName: 'tdd-workflow',
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'dhpk-bug-fix' }), {
    state: 'retired', stableId: 'bug-fix', publicName: 'dhpk-bug-fix', retiredIn: '0.47.0',
    reasonCode: 'merged-into-adaptive-workflow',
    replacements: [{ kind: 'skill', id: 'flow-guide', mode: 'classify' }],
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'de-ai-flavor' }), {
    state: 'retired', stableId: 'de-ai-flavor', publicName: 'dhpk-de-ai-flavor', retiredIn: '0.47.0',
    reasonCode: 'model-default-capability-removal',
    replacements: [{ kind: 'model-default' }],
  });
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'missing-skill' }), {
    state: 'unknown', identifier: 'missing-skill',
  });
});

// RED contract for issue #534 P2: active public renames are diagnostics, not
// compatibility aliases.  The stable ID remains the only selectable identity.
test('identity resolution reports renamed active names without aliasing or successor invocation', () => {
  const inventory = fixtureInventory();
  const resolution = resolveSkillIdentity({ inventory, identifier: 'dhpk-laravel' });
  assert.strictEqual(resolution.state, 'renamed');
  assert.strictEqual(resolution.stableId, 'laravel');
  assert.strictEqual(resolution.publicName, 'laravel');
  assert.strictEqual(resolution.oldName, 'dhpk-laravel');
  assert.strictEqual(resolution.alias, undefined);
  assert.strictEqual(resolution.successor, undefined);

  const diagnostic = formatSkillIdentityDiagnostic({ inventory, resolution });
  assert.match(diagnostic, /renamed/i);
  assert.match(diagnostic, /dhpk-laravel/);
  assert.match(diagnostic, /laravel/);
});

test('malformed retirement rows fail closed before identity diagnostics', () => {
  const inventory = fixtureInventory();
  inventory.retired_skills = [{
    id: 'retired-helper',
    name: 'dhpk-retired-helper',
    canonicalPath: 'skills/dhpk-retired-helper',
    retiredIn: '0.47.0',
    reasonCode: 'test',
    priorSurfaces: ['claude-core'],
    replacements: [{ kind: 'skill', id: 'missing-successor' }, { kind: 'model-default', id: 'forbidden' }],
    rollback: { release: '0.46.1' },
  }];
  const validation = validateSkillRetirements({ inventory });
  assert.ok(validation.errors.some((error) => /must reference an active skill.*missing-successor/.test(error)), validation.errors.join('\n'));
  assert.ok(validation.errors.some((error) => /model-default replacement must not declare id/.test(error)), validation.errors.join('\n'));
  assert.deepStrictEqual(resolveSkillIdentity({ inventory, identifier: 'dhpk-retired-helper' }), {
    state: 'unknown', identifier: 'dhpk-retired-helper',
  });
  assert.strictEqual(formatSkillIdentityDiagnostic({
    inventory,
    resolution: { state: 'retired', stableId: 'retired-helper', publicName: 'dhpk-retired-helper' },
  }), '');
});

test('run-skill reports retired guidance separately from unknown scripts', () => {
  const script = path.join(ROOT, 'scripts', 'run-skill.sh');
  const inventory = fixtureInventory();
  const retired = spawnSync('bash', [script, 'dhpk-bug-fix', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(retired.status, 2);
  assert.match(retired.stderr, /retired in 0\.47\.0/i);
  assert.match(retired.stderr, /reason:\s*merged-into-adaptive-workflow/i);
  assert.match(retired.stderr, /flow-guide.*classify/i);

  const modelDefault = spawnSync('bash', [script, 'dhpk-de-ai-flavor', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(modelDefault.status, 2);
  assert.match(modelDefault.stderr, /reason:\s*model-default-capability-removal/i);
  assert.match(modelDefault.stderr, /model-default/i);

  const diagnostic = formatSkillIdentityDiagnostic({
    inventory,
    resolution: resolveSkillIdentity({ inventory, identifier: 'dhpk-bug-fix' }),
  });
  assert.match(diagnostic, /retired in 0\.47\.0/);
  assert.match(diagnostic, /reason:\s*merged-into-adaptive-workflow/);

  const unknown = spawnSync('bash', [script, 'not-in-inventory', 'anything.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /script not found/i);
  assert.doesNotMatch(unknown.stderr, /retired/i);
});

test('flow guide owns complete bug and feature delivery behavior', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'skills/flow-guide/references/delivery-loop-gate.md')), 'delivery-loop-gate successor reference must exist');
  const guide = read('skills/flow-guide/SKILL.md');
  const bug = read('skills/flow-guide/references/workflow-bugfix.md');
  const feature = read('skills/flow-guide/references/workflow-feature-delivery.md');
  const gate = read('skills/flow-guide/references/delivery-loop-gate.md');
  assert.match(guide, /route/);
  assert.match(bug, /root cause[\s\S]*regression test/i);
  assert.match(feature, /requirements[\s\S]*design[\s\S]*implement/i);
  assert.match(bug, /(?<!dhpk-)tdd-workflow/);
  assert.match(gate, /change-verdict/);
  assert.match(gate, /test adequacy/i);
  assert.match(gate, /freshness/i);
  assert.doesNotMatch(guide, /dhpk-(bug-fix|feature-dev)/);
});

test('post-development testing routes unit/integration to TDD and Playwright journeys to e2e-runner', () => {
  const routeTable = JSON.parse(read('skills/flow-guide/references/route-table.json'));
  const e2eRoute = routeTable.rules.find((entry) => /playwright/i.test(entry.pattern));
  assert.strictEqual(e2eRoute.target.kind, 'agent');
  assert.strictEqual(e2eRoute.target.id, 'e2e-runner');
  assert.match(e2eRoute.label, /UNAVAILABLE/);
  const gate = read('skills/flow-guide/references/delivery-loop-gate.md');
  assert.match(gate, /unit|integration/i);
  assert.match(gate, /(?<!dhpk-)tdd-workflow/);
  assert.match(gate, /e2e-runner/);
  assert.match(gate, /UNAVAILABLE/);
});

test('architect adversarial mode now belongs to module design without a retired source', () => {
  const architect = read('skills/dhpk-module-design/SKILL.md');
  assert.match(architect, /--mode design\|review\|compare\|adversarial/);
  assert.match(architect, /adversarial/i);
  assert.match(architect, /independent proposal/i);
  assert.match(architect, /critique round/i);
  assert.match(architect, /decision criteria/i);
  assert.doesNotMatch(architect, /dhpk-codex-(architect|brainstorm)/);
  assert.strictEqual(fs.existsSync(path.join(ROOT, 'skills/dhpk-codex-architect')), false);
});

test('canonical source has no live delegation to retiring identities', () => {
  const roots = [
    'skills', 'commands', 'agents', 'rules', 'scripts/lib', 'tests', 'docs',
    'README.md', 'AGENTS.md',
  ];
  const historicalOnly = new Map([
    ['docs/agent-guidance/skill-disposition.md', 'historical disposition snapshot'],
    ['docs/skill-platform-migration.md', 'retirement migration guidance'],
    ['docs/skill-platform-migration.zh-TW.md', 'retirement migration guidance'],
    ['tests/skill-retirement-migration.test.js', 'retirement contract test'],
    ['tests/codex-mcp-retirement.test.js', 'retirement contract test'],
    ['tests/invocation-precedence.test.js', 'negative route guard'],
    ['tests/task4-consolidation.test.js', 'retirement inventory contract test'],
    ['tests/validate-invocation-policy.test.js', 'negative MCP grant guard'],
    ['tests/opsx-apply-goal-guardrails.test.js', 'negative route guard'],
    ['tests/userpromptsubmit-skill-hint.test.js', 'negative route guard'],
    ['tests/fixtures/invocation-inventory-baseline.json', 'historical fixture'],
    ['tests/fixtures/distribution-surface-baseline.json', 'historical fixture'],
    ['scripts/ci/skill-size-allowlist.json', 'size baseline'],
    ['skills/flow-guide/references/codex-usage-catalog.json', 'generated retirement diagnostics (legacy name -> target)'],
    ['tests/_lib/skill-flow-family-fixtures.js', 'negative retired-name help fixture'],
  ]);
  const retiringPackageRoots = RETIRED_NAMES.map((name) => `skills/${name}/`);
  const findings = [];
  for (const relative of roots.flatMap(walkTextFiles)) {
    if (retiringPackageRoots.some((prefix) => relative.startsWith(prefix))) continue;
    if (historicalOnly.has(relative)) continue;
    const source = (() => {
      const text = read(relative);
      if (relative !== 'tests/opsx-goal-analyze.test.js') return text;
      const lines = text.split(/\r?\n/);
      const beginMarker = '// BEGIN historical source: tests/opsx-apply-goal-guardrails.test.js';
      const endMarker = '// END historical source: tests/opsx-apply-goal-guardrails.test.js';
      const beginIndices = lines.flatMap((line, index) => line === beginMarker ? [index] : []);
      const endIndices = lines.flatMap((line, index) => line === endMarker ? [index] : []);
      assert.strictEqual(beginIndices.length, 1, 'historical guard block needs exactly one begin marker');
      assert.strictEqual(endIndices.length, 1, 'historical guard block needs exactly one end marker');
      assert.ok(beginIndices[0] < endIndices[0], 'historical guard block markers must be ordered');
      return [...lines.slice(0, beginIndices[0]), ...lines.slice(endIndices[0] + 1)].join('\n');
    })();
    for (const name of RETIRED_NAMES) {
      if (source.includes(name)) findings.push(`${relative}: ${name}`);
    }
  }
  assert.deepStrictEqual(findings, [], `live retiring delegations remain:\n${findings.join('\n')}`);
});


// Former suite: skill-migration
{

// Task 2 real-tree contract. This intentionally runs against the checked-in
// repository rather than a disposable fixture: the migration must leave one
// flat canonical package per inventory entry and relative projections only.

const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventoryV2,
  validateSkillTopology,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

function projectionTarget(linkPath) {
  assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), `${linkPath} must be a symlink`);
  return fs.readlinkSync(linkPath);
}

// Keep this mapping literal: it is the real-tree canary for the 11 version
// modules that now consume the two public family skills. Do not derive the
// expected family from module.yaml or the inventory under test.
const EXPECTED_VERSION_FAMILY_PROJECTIONS = [
  { moduleId: 'laravel-5.4', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-6', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-7', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-8', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-9', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-10', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-11', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'laravel-mix', familySkill: 'laravel', symlinkTarget: '../../../skills/laravel' },
  { moduleId: 'phpunit-9', familySkill: 'phpunit', symlinkTarget: '../../../skills/phpunit' },
  { moduleId: 'phpunit-10', familySkill: 'phpunit', symlinkTarget: '../../../skills/phpunit' },
  { moduleId: 'phpunit-11', familySkill: 'phpunit', symlinkTarget: '../../../skills/phpunit' },
];

function moduleProvidedSkills(moduleId) {
  const yamlPath = path.join(ROOT, 'modules', moduleId, 'module.yaml');
  const source = fs.readFileSync(yamlPath, 'utf8');
  const match = source.match(/^provides:\s*\n\s+skills:\s*\[([^\]]*)\]/m);
  assert.ok(match, `${yamlPath} has no provides.skills mapping`);
  return match[1].split(',').map((skill) => skill.trim()).filter(Boolean);
}

test('real tree version modules select only their canonical public family projection', () => {
  const actual = EXPECTED_VERSION_FAMILY_PROJECTIONS.map((expected) => {
    const projectionRoot = path.join(ROOT, 'modules', expected.moduleId, 'skills');
    assert.ok(fs.existsSync(projectionRoot), `${expected.moduleId} is missing its skills projection root`);
    const projectionEntries = fs.readdirSync(projectionRoot).sort();
    assert.deepStrictEqual(projectionEntries, [expected.familySkill], expected.moduleId);

    const familyEntry = INVENTORY.skills.find((entry) => entry.name === expected.familySkill);
    assert.ok(familyEntry, `missing canonical family inventory entry: ${expected.familySkill}`);

    return {
      moduleId: expected.moduleId,
      providesSkills: moduleProvidedSkills(expected.moduleId),
      projectionEntries,
      symlinkTarget: projectionTarget(path.join(projectionRoot, expected.familySkill)),
      profileIncludesModule: familyEntry.profiles.includes(expected.moduleId),
    };
  });

  assert.deepStrictEqual(actual, EXPECTED_VERSION_FAMILY_PROJECTIONS.map((expected) => ({
    moduleId: expected.moduleId,
    providesSkills: [expected.familySkill],
    projectionEntries: [expected.familySkill],
    symlinkTarget: expected.symlinkTarget,
    profileIncludesModule: true,
  })));
});

test('real tree has no nested canonical SKILL.md and module projections are relative symlinks', () => {
  const canonicalNames = new Set(INVENTORY.skills.map((entry) => entry.name));
  let moduleCount = 0;
  for (const moduleEntry of fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })) {
    if (!moduleEntry.isDirectory()) continue;
    const projectionRoot = path.join(ROOT, 'modules', moduleEntry.name, 'skills');
    if (!fs.existsSync(projectionRoot)) continue;
    for (const skillEntry of fs.readdirSync(projectionRoot, { withFileTypes: true })) {
      const linkPath = path.join(projectionRoot, skillEntry.name);
      moduleCount += 1;
      assert.ok(canonicalNames.has(skillEntry.name), `${linkPath} has no canonical inventory entry`);
      assert.strictEqual(projectionTarget(linkPath), `../../../skills/${skillEntry.name}`);
      assert.ok(INVENTORY.skills.some((entry) => entry.name === skillEntry.name && entry.profiles.includes(moduleEntry.name)));
    }
  }
  assert.strictEqual(moduleCount, 37);

  const topology = validateSkillTopology({ root: ROOT, inventory: INVENTORY, nativeRoots: ['plugins/dhpk'] });
  assert.deepStrictEqual(topology.errors, []);
});

test('real tree has relative Codex projections for every codex-sync skill', () => {
  const expected = INVENTORY.skills.filter((entry) => entry.surfaces.includes('codex-sync')).map((entry) => entry.name).sort();
  const actual = fs.readdirSync(path.join(ROOT, 'codex', 'skills')).sort();
  assert.deepStrictEqual(actual, expected);
  for (const name of actual) {
    assert.strictEqual(projectionTarget(path.join(ROOT, 'codex', 'skills', name)), `../../skills/${name}`);
  }
});
}

// Former suite: skill-capability-families
{

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, assert } = require('./_lib/tinytest');
const inventoryApi = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INVENTORY = JSON.parse(read('manifests/distribution-inventory.json'));

// The first family wave remains a closed 0.53.0 ledger.  The 0.54.0
// remaining-wave rows are covered by consolidate-remaining-dhpk-skill-families
// and must not be silently folded into this historical wave assertion.
const FAMILY_MODES = Object.freeze({
  'skill-scope': Object.freeze({
    'skill-health-check': 'health',
    'skill-judge': 'judge',
    'skill-stocktake': 'stocktake',
    'skill-scout': 'scout',
  }),
  'skill-forge': Object.freeze({
    'create-skill': 'create',
    'rules-distill': 'distill-rules',
  }),
  'flow-guide': Object.freeze({
    'adaptive-dev-workflow': 'route',
    'dhpk-execution-policy': 'rules',
    'next-step': 'next',
    'execution-checklist': 'close',
    do: 'route',
  }),
  'flow-drive': Object.freeze({
    implement: undefined,
  }),
  'change-verdict': Object.freeze({
    'codex-code-review': 'code',
    'pr-review': 'pr',
    'security-review': 'security',
    'test-review': 'tests',
    'doc-review': 'docs',
    'risk-assess': 'risk',
  }),
  'code-trace': Object.freeze({
    'code-explore': 'explore',
    'bug-investigation': 'diagnose',
    'git-investigate': 'history',
    'tool-routing': 'select-tool',
  }),
});

const GITNEXUS_IDS = Object.freeze([
  'gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring',
  'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring',
]);

const GITNEXUS_BASELINE = Object.freeze({
  'gitnexus-cli': '0669acbc46c0bd35d4b8bb14990df859ca9db40eb3ef2497d33b1eadde8426dc',
  'gitnexus-debugging': 'ab9ddf9e646b76e14347e6ceb0ce93db2dc350672d14d0295555bf9c4eeb93c3',
  'gitnexus-exploring': '1dc65f86c91c17a341a345cf8b7e53a8de1a44078d1cc1e2cc954b5cd05d720c',
  'gitnexus-guide': 'f922e0f0873fbf89940da9fb72b9dd7b374b6f0b7b6ec8bac06e57d568f23f40',
  'gitnexus-impact-analysis': 'c3869106e3a4a8b4a1561019a4bcb748bff9b3642b40537f389a13daab5b01de',
  'gitnexus-refactoring': 'd656b378beae97c5d4c9c4a86ccb773078f5d9b61e38be8fb09c0c41f2797c9a',
});

function sha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
}

test('capability-family retirement is closed and rejects missing, duplicate, or remapped predecessors', () => {
  const expected = Object.entries(FAMILY_MODES).flatMap(([family, predecessors]) => (
    Object.entries(predecessors).map(([id, mode]) => ({ id, family, mode }))
  ));
  const actual = INVENTORY.retired_skills
    .filter((entry) => entry.retiredIn === '0.53.0')
    .map((entry) => {
      const replacement = entry.replacements && entry.replacements[0];
      return { id: entry.id, family: replacement && replacement.id, mode: replacement && replacement.mode };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepStrictEqual(actual, expected.sort((left, right) => left.id.localeCompare(right.id)));

  const missing = JSON.parse(JSON.stringify(INVENTORY));
  missing.retired_skills = missing.retired_skills.filter((entry) => entry.id !== 'tool-routing');
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: missing }).errors.join('\n'),
    /tool-routing.*capability-family|capability-family.*tool-routing/i,
  );

  const duplicate = JSON.parse(JSON.stringify(INVENTORY));
  duplicate.retired_skills.push(JSON.parse(JSON.stringify(
    duplicate.retired_skills.find((entry) => entry.id === 'tool-routing'),
  )));
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: duplicate }).errors.join('\n'),
    /duplicate retired stable id.*tool-routing/i,
  );

  const remapped = JSON.parse(JSON.stringify(INVENTORY));
  remapped.retired_skills.find((entry) => entry.id === 'tool-routing').replacements = [
    { kind: 'skill', id: 'code-trace', mode: 'explore' },
  ];
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: remapped }).errors.join('\n'),
    /tool-routing.*select-tool|select-tool.*tool-routing/i,
  );

  const externalPredecessor = JSON.parse(JSON.stringify(INVENTORY));
  externalPredecessor.retired_skills.push({
    id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', canonicalPath: 'skills/dhpk-gitnexus-cli',
    priorSurfaces: ['claude-core'], retiredIn: '0.53.0', reasonCode: 'capability-family-consolidation',
    replacements: [{ kind: 'skill', id: 'code-trace', mode: 'select-tool' }], rollback: { release: '0.52.0' },
  });
  assert.match(
    inventoryApi.validateSkillRetirements({ inventory: externalPredecessor }).errors.join('\n'),
    /gitnexus-cli.*external-package|external-package.*gitnexus-cli/i,
  );
});

test('external package ledger is preserved and rejects protected retirement', () => {
  assert.strictEqual(typeof inventoryApi.validateExternalSkillPackages, 'function');
  assert.deepStrictEqual(inventoryApi.validateExternalSkillPackages({ inventory: INVENTORY }).errors, []);
  const generated = { schema: INVENTORY.schema, skills: INVENTORY.skills, modules: INVENTORY.modules };
  const preserved = inventoryApi.preserveProjectionContract(generated, INVENTORY);
  assert.deepStrictEqual(preserved.external_skill_packages, INVENTORY.external_skill_packages);

  const invalid = JSON.parse(JSON.stringify(INVENTORY));
  invalid.retired_skills.push({
    id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', canonicalPath: 'skills/dhpk-gitnexus-cli',
    priorSurfaces: ['claude-core'], retiredIn: '0.53.0', reasonCode: 'invalid-external-retirement',
    replacements: [{ kind: 'skill', id: 'code-trace', mode: 'select-tool' }], rollback: { release: '0.52.0' },
  });
  assert.match(inventoryApi.validateExternalSkillPackages({ inventory: invalid }).errors.join('\n'), /gitnexus-cli.*retired|retired.*gitnexus-cli/i);
});

test('GitNexus packages remain byte-identical and active', () => {
  for (const id of GITNEXUS_IDS) {
    const entry = INVENTORY.skills.find((skill) => skill.id === id);
    assert.ok(entry, `missing protected ${id}`);
    assert.ok(!INVENTORY.retired_skills.some((retired) => retired.id === id));
    assert.strictEqual(sha256(`${entry.path}/SKILL.md`), GITNEXUS_BASELINE[id], id);
  }
});

test('reborn skills expose exact modes and invocation metadata', () => {
  for (const [family, predecessors] of Object.entries(FAMILY_MODES)) {
    const body = read(`skills/${family}/SKILL.md`);
    const metadata = read(`skills/${family}/agents/openai.yaml`);
    for (const mode of Object.values(predecessors)) {
      if (mode !== undefined) assert.match(body, new RegExp(`\\b${mode}\\b`), `${family}:${mode}`);
    }
    assert.match(metadata, new RegExp(`\\$${family}\\b`));
    const explicit = family === 'skill-forge' || family === 'flow-drive';
    if (explicit) assert.match(metadata, /allow_implicit_invocation:\s*false/);
    else assert.doesNotMatch(metadata, /allow_implicit_invocation:\s*false/);
  }
  assert.match(read('skills/change-verdict/SKILL.md'), /read-only|read only/i);
});

test('harness-govern retains the five consolidated governance modes', () => {
  const body = read('skills/harness-govern/SKILL.md');
  const metadata = read('skills/harness-govern/agents/openai.yaml');
  const procedures = {
    health: 'references/health-workflow.md',
    budget: 'references/budget-workflow.md',
    fill: 'references/fill-workflow.md',
    revise: 'references/revise-workflow.md',
    sync: 'references/sync-workflow.md',
  };
  const modeSectionStart = body.indexOf('## Mode selection');
  assert.notStrictEqual(modeSectionStart, -1, 'missing the mode-selection section');
  const modeSectionEnd = body.indexOf('\n## ', modeSectionStart + '## Mode selection'.length);
  const modeSection = body.slice(modeSectionStart, modeSectionEnd === -1 ? undefined : modeSectionEnd);
  const modeRows = modeSection.split(/\r?\n/).filter((line) => /^\| `[^`]+` \|/.test(line));
  assert.deepStrictEqual(modeRows.map((line) => line.split('|')[1].trim().replaceAll('`', '')), Object.keys(procedures));
  for (const [mode, procedure] of Object.entries(procedures)) {
    const row = modeRows.find((line) => line.startsWith(`| \`${mode}\` |`));
    assert.ok(row, `missing harness-govern mode row: ${mode}`);
    assert.strictEqual(row.split('|')[3].trim(), `\`${procedure}\``, `wrong procedure for harness-govern:${mode}`);
  }
  assert.match(metadata, /^  default_prompt: "Use \$harness-govern\b[^\"]*"$/m);
  assert.match(metadata, /allow_implicit_invocation:\s*false/);
});
}

// Former suite: consolidate-remaining-dhpk-skill-families
{

// RED contract for consolidate-remaining-dhpk-skill-families task 1.1.
//
// These assertions intentionally describe the 0.54.0 inventory before the
// implementation wave updates the checked-in inventory and its validators.
// Keep the expected IDs and mappings literal: deriving them from the
// inventory under test would make a missing, duplicated, or remapped row
// invisible to the canary.

const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const inventoryApi = require('../scripts/lib/distribution-inventory');
const profileApi = require('../scripts/lib/capability-bundle-selection');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const PROFILES = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));

const EXPECTED_MINIMAL_PROFILE = Object.freeze([
  'change-verdict',
  'code-trace',
  'flow-drive',
  'flow-guide',
]);

const SHARED_SURFACES = Object.freeze([
  'agent-plugin',
  'cursor-plugin',
  'agy-plugin',
  'cursor-sync',
]);

const EXPECTED_SHARED_SURFACE_IDS = Object.freeze([
  'agent-architecture-audit',
  'agy-fast-worker',
  'change-verdict',
  'cli-dispatch-context',
  'cli-transport',
  'code-trace',
  'codex-bridge',
  'composer-package-hygiene',
  'deploy-list',
  'feature-verify',
  'flow-drive',
  'flow-guide',
  'git-smart-commit',
  'gitnexus-cli',
  'gitnexus-debugging',
  'gitnexus-exploring',
  'gitnexus-guide',
  'gitnexus-impact-analysis',
  'gitnexus-refactoring',
  'harness-govern',
  'issue-analyze',
  'laravel-package-author',
  'laravel-testbench-matrix',
  'opsx-apply-goal',
  'opsx-load-context',
  'opsx-post-obs',
  'polyfill-version-matrix-audit',
  'project-audit',
  'project-setup',
  'prompt-optimize',
  'release-creator',
  'repo-intake',
  'session-usage-audit',
  'skill-forge',
  'skill-scope',
  'software-architecture',
  'tdd',
]);

function replacement(kind, id, mode) {
  const row = { kind, id };
  if (mode !== undefined) row.mode = mode;
  return row;
}

function retirement(id, name, priorSurfaces, reasonCode, successor) {
  return {
    id,
    name,
    canonicalPath: `skills/${name}`,
    priorSurfaces,
    retiredIn: '0.54.0',
    reasonCode,
    replacements: [successor],
    rollback: { release: '0.53.0' },
  };
}

// This is the complete second-wave set. The former public name for the
// Laravel 5.4 package intentionally uses the repository's safe `5-4` form.
const EXPECTED_CURRENT_WAVE = Object.freeze([
  retirement('laravel-5.4-notes', 'dhpk-laravel-5-4-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '5.4')),
  retirement('laravel-6-notes', 'dhpk-laravel-6-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '6')),
  retirement('laravel-7-notes', 'dhpk-laravel-7-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '7')),
  retirement('laravel-8-notes', 'dhpk-laravel-8-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '8')),
  retirement('laravel-9-notes', 'dhpk-laravel-9-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '9')),
  retirement('laravel-10-notes', 'dhpk-laravel-10-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '10')),
  retirement('laravel-11-notes', 'dhpk-laravel-11-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '11')),
  retirement('laravel-mix-notes', 'dhpk-laravel-mix-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', 'mix')),
  retirement('phpunit-9-modern', 'dhpk-phpunit-9-modern', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '9')),
  retirement('phpunit-10-notes', 'dhpk-phpunit-10-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '10')),
  retirement('phpunit-11-notes', 'dhpk-phpunit-11-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '11')),
  retirement('claude-health', 'dhpk-claude-health', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'health')),
  retirement('harness-budget', 'dhpk-harness-budget', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'budget')),
  retirement('harness-fill', 'dhpk-harness-fill', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'fill')),
  retirement('harness-revise', 'dhpk-harness-revise', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'revise')),
  retirement('multi-ai-sync', 'dhpk-cross-agent-sync', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'sync')),
  retirement('agy-commit', 'dhpk-agy-commit', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'git-smart-commit')),
  retirement('feasibility-study', 'dhpk-feasibility-study', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'software-architecture', 'compare')),
  retirement('tech-spec', 'dhpk-tech-spec', ['claude-core', 'cursor-sync'], 'openspec-authoring-consolidation', replacement('external-skill', 'openspec-propose', 'propose')),
  retirement('create-request', 'dhpk-create-request', ['claude-core', 'cursor-sync'], 'openspec-authoring-consolidation', replacement('external-skill', 'openspec-propose', 'propose')),
  retirement('op-session', 'dhpk-onepassword-session', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'operator-action-capability-removal', replacement('operator-action', 'onepassword-cli', 'signin')),
]);

const EXPECTED_RENAMES = Object.freeze([
  {
    id: 'laravel',
    oldName: 'dhpk-laravel',
    oldPath: 'skills/dhpk-laravel',
    newName: 'laravel',
    newPath: 'skills/laravel',
    rollback: { release: '0.53.0' },
  },
  {
    id: 'phpunit',
    oldName: 'dhpk-phpunit',
    oldPath: 'skills/dhpk-phpunit',
    newName: 'phpunit',
    newPath: 'skills/phpunit',
    rollback: { release: '0.53.0' },
  },
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortById(rows) {
  return rows.slice().sort((left, right) => left.id.localeCompare(right.id));
}

function expectedRetirementShape(row) {
  return {
    id: row.id,
    name: row.name,
    canonicalPath: row.canonicalPath,
    priorSurfaces: row.priorSurfaces,
    retiredIn: row.retiredIn,
    reasonCode: row.reasonCode,
    replacements: row.replacements,
    rollback: row.rollback,
  };
}

function futureProfiles() {
  const result = clone(PROFILES);
  const currentWaveIds = new Set(EXPECTED_CURRENT_WAVE.map((row) => row.id));
  for (const profileId of ['minimal', 'full', 'compat-v1']) {
    const profile = result.profiles[profileId];
    if (!Array.isArray(profile.skillIds)) continue;
    profile.skillIds = profile.skillIds.filter((id) => !currentWaveIds.has(id));
    if (profileId !== 'minimal' && !profile.skillIds.includes('harness-govern')) {
      profile.skillIds.push('harness-govern');
    }
  }
  return result;
}

// Make a disposable, future-shaped inventory for mutation canaries. The live
// checkout is deliberately not modified, and the fixture keeps historical
// rows so the second-wave closed set is tested independently of prior waves.
function futureInventoryFixture() {
  const result = clone(INVENTORY);
  const currentWaveIds = new Set(EXPECTED_CURRENT_WAVE.map((row) => row.id));
  result.skills = result.skills
    .filter((entry) => !currentWaveIds.has(entry.id))
    .map((entry) => {
      const rename = EXPECTED_RENAMES.find((row) => row.id === entry.id);
      if (!rename) return entry;
      const renamed = { ...entry, name: rename.newName, path: rename.newPath };
      delete renamed.legacy_names;
      return renamed;
    });

  if (!result.skills.some((entry) => entry.id === 'harness-govern')) {
    const guide = result.skills.find((entry) => entry.id === 'flow-guide');
    result.skills.push({
      ...guide,
      id: 'harness-govern',
      name: 'harness-govern',
      path: 'skills/harness-govern',
      capability_id: 'dhpk.skill.harness-govern',
      name_style: 'portable-family',
      invocation_class: 'explicit-only',
    });
  }
  result.profile_policy.required_core_ids = EXPECTED_MINIMAL_PROFILE.slice();
  result.surface_membership = Object.fromEntries(SHARED_SURFACES.map((surface) => [surface, EXPECTED_SHARED_SURFACE_IDS.slice()]));
  result.retired_skills = result.retired_skills
    .filter((entry) => !currentWaveIds.has(entry.id))
    .concat(clone(EXPECTED_CURRENT_WAVE));
  result.renamed_skill_names = clone(EXPECTED_RENAMES);
  return result;
}

function assertDiagnostic(result, pattern, label) {
  assert.ok(result && Array.isArray(result.errors), `${label}: validator must return errors[]`);
  assert.ok(result.errors.some((error) => pattern.test(error)), `${label}: expected ${pattern}, got:\n${result.errors.join('\n')}`);
}

test('0.54.0 retirement ledger is the exact closed set of 21 approved rows', () => {
  const actual = INVENTORY.retired_skills
    .filter((entry) => entry.retiredIn === '0.54.0')
    .map(expectedRetirementShape);
  assert.strictEqual(actual.length, 21, 'the current migration wave must contain exactly 21 retirement rows');
  assert.deepStrictEqual(sortById(actual), sortById(EXPECTED_CURRENT_WAVE));

  for (const row of EXPECTED_CURRENT_WAVE) {
    assert.ok(!INVENTORY.skills.some((entry) => entry.id === row.id), `${row.id} must not remain active`);
    assert.ok(!INVENTORY.skills.some((entry) => entry.name === row.name), `${row.name} must not remain active`);
    assert.ok(!fs.existsSync(path.join(ROOT, row.canonicalPath)), `${row.canonicalPath} must not remain canonical`);
  }
});

test('active public-name rename ledger mutation canaries fail closed', () => {
  const cases = [
    ['missing ledger', (inventory) => { delete inventory.renamed_skill_names; }, /renamed_skill_names.*required|required.*renamed_skill_names/i],
    ['unexpected row', (inventory) => { inventory.renamed_skill_names.push({ ...inventory.renamed_skill_names[0], id: 'extra' }); }, /unexpected.*extra|extra.*unexpected|exactly.*2/i],
    ['duplicate row', (inventory) => { inventory.renamed_skill_names.push(clone(inventory.renamed_skill_names[0])); }, /duplicate.*laravel|laravel.*duplicate/i],
    ['wrong public name', (inventory) => { inventory.renamed_skill_names[0].newName = 'wrong'; }, /laravel.*newName|newName.*laravel/i],
    ['wrong canonical path', (inventory) => { inventory.renamed_skill_names[0].newPath = 'skills/wrong'; }, /laravel.*newPath|newPath.*laravel/i],
    ['wrong rollback', (inventory) => { inventory.renamed_skill_names[0].rollback.release = '0.52.0'; }, /laravel.*0\.53\.0|0\.53\.0.*laravel/i],
    ['unknown field', (inventory) => { inventory.renamed_skill_names[0].alias = true; }, /laravel.*unknown.*alias|alias.*unknown/i],
    ['old name alias', (inventory) => { inventory.skills.find((entry) => entry.id === 'laravel').legacy_names = ['dhpk-laravel']; }, /dhpk-laravel.*alias|alias.*dhpk-laravel/i],
    ['old canonical path', (inventory) => { inventory.skills.find((entry) => entry.id === 'laravel').path = 'skills/dhpk-laravel'; }, /dhpk-laravel.*old path|old path.*dhpk-laravel|laravel.*newPath/i],
  ];
  for (const [label, mutate, expected] of cases) {
    const inventory = futureInventoryFixture();
    mutate(inventory);
    const result = inventoryApi.validateRenamedSkillNames({ inventory });
    assertDiagnostic(result, expected, label);
  }

  const integrated = futureInventoryFixture();
  delete integrated.renamed_skill_names;
  assertDiagnostic(
    inventoryApi.validateDistributionInventoryV2({ inventory: integrated, root: ROOT }),
    /renamed_skill_names.*required|required.*renamed_skill_names/i,
    'v2 integration',
  );
});

test('retirement mutation canaries fail closed for omission, duplicate, remap, release, rollback, and kind drift', () => {
  const missing = futureInventoryFixture();
  missing.retired_skills = missing.retired_skills.filter((entry) => entry.id !== 'agy-commit');
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: missing }),
    /missing.*agy-commit|agy-commit.*missing|0\.54\.0.*agy-commit/i,
    'missing 0.54.0 row',
  );

  const duplicate = futureInventoryFixture();
  duplicate.retired_skills.push(clone(EXPECTED_CURRENT_WAVE.find((entry) => entry.id === 'agy-commit')));
  assertDiagnostic(inventoryApi.validateSkillRetirements({ inventory: duplicate }), /duplicate.*agy-commit/i, 'duplicate row');

  const unexpected = futureInventoryFixture();
  unexpected.retired_skills.push(retirement(
    'retirement-canary',
    'dhpk-retirement-canary',
    ['claude-core'],
    'test-only-mutation',
    replacement('skill', 'flow-guide', 'route'),
  ));
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: unexpected }),
    /unexpected.*retirement-canary|retirement-canary.*unexpected|0\.54\.0.*retirement-canary/i,
    'unexpected current-wave row',
  );

  const remapped = futureInventoryFixture();
  remapped.retired_skills.find((entry) => entry.id === 'agy-commit').replacements = [replacement('skill', 'flow-guide', 'route')];
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: remapped }),
    /agy-commit.*git-smart-commit|git-smart-commit.*agy-commit/i,
    'remapped agy-commit successor',
  );

  const wrongRelease = futureInventoryFixture();
  wrongRelease.retired_skills.find((entry) => entry.id === 'agy-commit').retiredIn = '0.53.0';
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongRelease }),
    /agy-commit.*0\.54\.0|0\.54\.0.*agy-commit/i,
    'wrong retirement release',
  );

  const wrongRollback = futureInventoryFixture();
  wrongRollback.retired_skills.find((entry) => entry.id === 'agy-commit').rollback.release = '0.52.0';
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongRollback }),
    /agy-commit.*0\.53\.0|0\.53\.0.*agy-commit/i,
    'wrong rollback release',
  );

  const wrongKind = futureInventoryFixture();
  wrongKind.retired_skills.find((entry) => entry.id === 'tech-spec').replacements = [replacement('skill', 'flow-drive', 'implement')];
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongKind }),
    /tech-spec.*openspec-propose|openspec-propose.*tech-spec/i,
    'wrong replacement kind or identity',
  );
});

test('profile duplicate and protected-identity mutation canaries fail closed', () => {
  const inventory = futureInventoryFixture();
  const profiles = futureProfiles();

  const duplicateProfile = clone(profiles);
  duplicateProfile.profiles.minimal.skillIds.push('flow-guide');
  const duplicateResult = profileApi.validateProfileDefinitions({
    inventory,
    profiles: duplicateProfile,
    moduleCatalog: require('../manifests/module-catalog.json'),
  });
  assert.ok(duplicateResult.errors.some((error) => /duplicate.*flow-guide|flow-guide.*duplicate|profile.*duplicate/i.test(error)), duplicateResult.errors.join('\n'));

  const protectedOmission = clone(profiles);
  protectedOmission.profiles.full.skillIds = protectedOmission.profiles.full.skillIds.filter((id) => id !== 'gitnexus-cli');
  const protectedResult = profileApi.validateProfileDefinitions({
    inventory,
    profiles: protectedOmission,
    moduleCatalog: require('../manifests/module-catalog.json'),
  });
  assert.ok(protectedResult.errors.some((error) => /gitnexus-cli.*protected|protected.*gitnexus-cli/i.test(error)), protectedResult.errors.join('\n'));
});
}

// Former suite: portable-skill-names
{

// RED contract for the portable command-skill migration.  The fixtures below
// are deliberately literal: expected public names, stable IDs, and rename
// paths must remain visible in this test instead of being derived from the
// inventory under test.

const fs = require('node:fs');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventoryV2,
  validateRenamedSkillNames,
  resolveSkillIdentity,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'manifests', 'distribution-inventory.json'),
  'utf8',
));

const EXPECTED_GENERIC_NAMES = Object.freeze([
  'create-pr',
  'git-worktree',
  'merge-prep',
  'pr-summary',
  'proposal-analyze',
  'project-brief',
  'doc-refactor',
  'update-docs',
  'update-codemaps',
  'precommit',
  'dep-audit',
  'repo-verify',
  'code-simplify',
  'harness-audit',
  'review-pending',
  'spec-mine',
]);

const EXPECTED_ACTIVE_RENAMES = Object.freeze({
  'git-smart-commit': {
    oldName: 'dhpk-git-smart-commit',
    oldPath: 'skills/dhpk-git-smart-commit',
    newName: 'git-smart-commit',
    newPath: 'skills/git-smart-commit',
  },
  'release-creator': {
    oldName: 'dhpk-release-creator',
    oldPath: 'skills/dhpk-release-creator',
    newName: 'release-creator',
    newPath: 'skills/release-creator',
  },
  'matrix-cell-onboard': {
    oldName: 'dhpk-matrix-cell-onboard',
    oldPath: 'skills/dhpk-matrix-cell-onboard',
    newName: 'matrix-cell-onboard',
    newPath: 'skills/matrix-cell-onboard',
  },
  tdd: {
    oldName: 'dhpk-tdd-workflow',
    oldPath: 'skills/dhpk-tdd-workflow',
    newName: 'tdd-workflow',
    newPath: 'skills/tdd-workflow',
  },
  'js-static-check-strategy': {
    oldName: 'dhpk-js-static-check-strategy',
    oldPath: 'skills/dhpk-js-static-check-strategy',
    newName: 'js-static-check-strategy',
    newPath: 'skills/js-static-check-strategy',
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function minimalSkill(overrides = {}) {
  return {
    id: 'tdd',
    name: 'tdd-workflow',
    name_style: 'portable-skill',
    path: 'skills/tdd-workflow',
    capability_id: 'dhpk.tdd',
    invocation_class: 'implicit-eligible',
    lifecycle: 'promoted',
    tier: 'core',
    profiles: ['default'],
    surfaces: ['claude-core'],
    ...overrides,
  };
}

function portableInventory(skills = [minimalSkill()]) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills,
  };
}

function renameRow(id, oldName, oldPath, newName, newPath, release = '0.62.4') {
  return {
    id,
    oldName,
    oldPath,
    newName,
    newPath,
    rollback: { release },
  };
}

function renameInventory() {
  const entries = [
    minimalSkill(),
    minimalSkill({ id: 'laravel', name: 'laravel', name_style: 'portable-family', path: 'skills/laravel', capability_id: 'dhpk.laravel' }),
    minimalSkill({ id: 'phpunit', name: 'phpunit', name_style: 'portable-family', path: 'skills/phpunit', capability_id: 'dhpk.phpunit' }),
    minimalSkill({ id: 'git-smart-commit', name: 'git-smart-commit', path: 'skills/git-smart-commit', capability_id: 'dhpk.git-smart-commit', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'release-creator', name: 'release-creator', path: 'skills/release-creator', capability_id: 'dhpk.release-creator', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'matrix-cell-onboard', name: 'matrix-cell-onboard', path: 'skills/matrix-cell-onboard', capability_id: 'dhpk.matrix-cell-onboard', invocation_class: 'explicit-only' }),
    minimalSkill({ id: 'js-static-check-strategy', name: 'js-static-check-strategy', path: 'skills/js-static-check-strategy', capability_id: 'dhpk.js-static-check-strategy' }),
  ];
  return portableInventory(entries);
}

function activeRenameRows() {
  return [
    renameRow('laravel', 'dhpk-laravel', 'skills/dhpk-laravel', 'laravel', 'skills/laravel', '0.53.0'),
    renameRow('phpunit', 'dhpk-phpunit', 'skills/dhpk-phpunit', 'phpunit', 'skills/phpunit', '0.53.0'),
    renameRow('git-smart-commit', 'dhpk-git-smart-commit', 'skills/dhpk-git-smart-commit', 'git-smart-commit', 'skills/git-smart-commit'),
    renameRow('release-creator', 'dhpk-release-creator', 'skills/dhpk-release-creator', 'release-creator', 'skills/release-creator'),
    renameRow('matrix-cell-onboard', 'dhpk-matrix-cell-onboard', 'skills/dhpk-matrix-cell-onboard', 'matrix-cell-onboard', 'skills/matrix-cell-onboard'),
    renameRow('tdd', 'dhpk-tdd-workflow', 'skills/dhpk-tdd-workflow', 'tdd-workflow', 'skills/tdd-workflow'),
    renameRow('js-static-check-strategy', 'dhpk-js-static-check-strategy', 'skills/dhpk-js-static-check-strategy', 'js-static-check-strategy', 'skills/js-static-check-strategy'),
  ];
}

test('portable-skill naming accepts an unprefixed public name whose stable ID differs', () => {
  const result = validateDistributionInventoryV2({ inventory: portableInventory() });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
});

test('public names collide across portable-skill and portable-family styles', () => {
  const candidate = portableInventory([
    minimalSkill({ name: 'skill-scope', path: 'skills/skill-scope' }),
    minimalSkill({
      id: 'skill-scope',
      name: 'skill-scope',
      name_style: 'portable-family',
      path: 'skills/skill-scope',
      capability_id: 'dhpk.skill-scope',
    }),
  ]);
  const result = validateDistributionInventoryV2({ inventory: candidate });
  assert.ok(result.errors.some((error) => /duplicate.*public.*name|public.*name.*duplicate/i.test(error)), result.errors.join('\n'));
});

test('the checked-in migration publishes the approved generic names as flat canonical skills', () => {
  const rows = INVENTORY.skills.filter((entry) => EXPECTED_GENERIC_NAMES.includes(entry.name));
  assert.deepStrictEqual(
    rows.map((entry) => entry.name).sort(),
    [...EXPECTED_GENERIC_NAMES].sort(),
  );
  for (const name of EXPECTED_GENERIC_NAMES) {
    const entry = INVENTORY.skills.find((candidate) => candidate.name === name);
    assert.strictEqual(entry.path, `skills/${name}`, `${name} must use its public name as canonical path`);
  }
});

test('the five active renames preserve stable IDs and reject active legacy aliases', () => {
  for (const [id, expected] of Object.entries(EXPECTED_ACTIVE_RENAMES)) {
    const entry = INVENTORY.skills.find((candidate) => candidate.id === id);
    assert.ok(entry, `stable ID ${id} must remain active`);
    assert.strictEqual(entry.name, expected.newName);
    assert.strictEqual(entry.path, expected.newPath);
    assert.ok(!Array.isArray(entry.legacy_names) || !entry.legacy_names.includes(expected.oldName));
  }
});

test('rename validation accepts explicit active ID rows alongside historical Laravel/PHPUnit rows', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  const result = validateRenamedSkillNames({ inventory });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));

  const resolution = resolveSkillIdentity({ inventory, identifier: 'dhpk-tdd-workflow' });
  assert.deepStrictEqual(resolution, {
    state: 'renamed',
    stableId: 'tdd',
    publicName: 'tdd-workflow',
    oldName: 'dhpk-tdd-workflow',
  });
});

test('rename validation rejects unsafe or non-matching canonical paths', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  inventory.renamed_skill_names[5].newPath = 'skills/../outside';
  inventory.renamed_skill_names[6].oldPath = 'skills/not-the-old-name';
  const result = validateRenamedSkillNames({ inventory });
  assert.ok(result.errors.some((error) => /tdd.*newPath|newPath.*tdd|canonical|safe|outside/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /js-static-check-strategy.*oldPath|oldPath.*js-static-check-strategy|canonical|safe/i.test(error)), result.errors.join('\n'));
});

test('rename validation rejects duplicate IDs and conflicting old/new identities', () => {
  const duplicate = renameInventory();
  duplicate.renamed_skill_names = activeRenameRows();
  duplicate.renamed_skill_names.push(clone(duplicate.renamed_skill_names[2]));
  const duplicateResult = validateRenamedSkillNames({ inventory: duplicate });
  assert.ok(duplicateResult.errors.some((error) => /duplicate.*git-smart-commit|git-smart-commit.*duplicate/i.test(error)), duplicateResult.errors.join('\n'));

  const conflict = renameInventory();
  conflict.renamed_skill_names = activeRenameRows();
  conflict.renamed_skill_names[3].oldName = conflict.renamed_skill_names[2].oldName;
  conflict.renamed_skill_names[3].oldPath = conflict.renamed_skill_names[2].oldPath;
  const conflictResult = validateRenamedSkillNames({ inventory: conflict });
  assert.ok(conflictResult.errors.some((error) => /conflict|duplicate.*old|old.*duplicate|collision/i.test(error)), conflictResult.errors.join('\n'));
});

test('historical Laravel and PHPUnit rename rows keep their original rollback pins', () => {
  const inventory = renameInventory();
  inventory.renamed_skill_names = activeRenameRows();
  inventory.renamed_skill_names[0].rollback.release = '0.52.0';
  inventory.renamed_skill_names[1].newPath = 'skills/phpunit-old';
  const result = validateRenamedSkillNames({ inventory });
  assert.ok(result.errors.some((error) => /laravel.*0\.53\.0|0\.53\.0.*laravel/i.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /phpunit.*newPath|newPath.*phpunit/i.test(error)), result.errors.join('\n'));
});
}

run('skill-retirement-migration');
