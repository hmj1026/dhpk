'use strict';

// These tests pin the inventory validator and routing contract: missing lifecycle
// entries, invalid lifecycle values, duplicate surface membership, deprecated
// leakage, and malformed family routing all fail closed.

const { test, run, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventory,
  validateDistributionInventoryV2,
  validateExternalSkillPackages,
  normalizeExternalSkillPackages,
  externalSkillPackagesFingerprint,
  validateSupportingAssets,
  validatePlatformCapabilityMatrix,
  validatePortableFrontmatterContract,
  preserveProjectionContract,
  LIFECYCLES,
  compileClaudeProjection,
  verifyClaudeProjection,
  validateSkillRoutingFamilies,
  resolveSkillRoutingAlias,
  resolveSkillRoutingReference,
} = require('../scripts/lib/distribution-inventory');

function baseInventory() {
  return {
    schema: 'dhpk.distribution-inventory.v1',
    lifecycles: ['promoted', 'optional', 'experimental', 'deprecated'],
    surfaces: ['claude-core', 'claude-module', 'codex-sync', 'codex-native'],
    skills: [
      { id: 'tdd', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
      { id: 'vue-2-notes', path: 'modules/vue-2/skills/dhpk-vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
    modules: [
      { id: 'vue-2', path: 'modules/vue-2', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
}

test('LIFECYCLES exports the four canonical states', () => {
  assert.deepStrictEqual([...LIFECYCLES].sort(), ['deprecated', 'experimental', 'optional', 'promoted']);
});

test('routing families preserve every Laravel and PHPUnit legacy identifier as one explicit router selector', () => {
  const families = [{
    id: 'laravel', router_id: 'php-runtime-router', invocation_class: 'implicit-eligible',
    surfaces: ['claude-module'],
    selectors: { '5.4': 'skills/dhpk-laravel/references/5-4.md', mix: 'skills/dhpk-laravel/references/mix.md' },
    aliases: [
      { id: 'laravel-5.4-notes', selector: '5.4', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
      { id: 'laravel-mix-notes', selector: 'mix', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
    ],
  }];
  assert.deepStrictEqual(validateSkillRoutingFamilies({ families, skillIds: new Set(['php-runtime-router']) }).errors, []);
  assert.deepStrictEqual(resolveSkillRoutingAlias({ families, id: 'laravel-mix-notes' }), {
    familyId: 'laravel', routerId: 'php-runtime-router', selector: 'mix', reference: 'skills/dhpk-laravel/references/mix.md',
  });
});

test('routing families reject duplicate aliases, missing router targets, ambiguous selectors, unsupported surfaces, unsafe references, and invocation drift', () => {
  const families = [{
    id: 'laravel', router_id: 'missing', invocation_class: 'implicit-eligible', surfaces: ['wrong'],
    selectors: { '11': '../unsafe.md', '10': 'skills/not-canonical/SKILL.md' },
    aliases: [
      { id: 'legacy', selector: '11', invocation_class: 'explicit-only', surfaces: ['wrong'] },
      { id: 'legacy', selector: '10', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
    ],
  }];
  const errors = validateSkillRoutingFamilies({
    families, skillIds: new Set(['php-runtime-router', 'legacy']),
  }).errors.join('\n');
  assert.match(errors, /missing router/);
  assert.match(errors, /unsupported surface/);
  assert.match(errors, /safe relative path/);
  assert.match(errors, /conflicting invocation/);
  assert.match(errors, /duplicate alias/);
});

test('checked-in family aliases resolve deterministically and retain Laravel/PHPUnit IDs on their declared surface', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  const expected = {
    'laravel-5.4-notes': '5.4', 'laravel-6-notes': '6', 'laravel-7-notes': '7', 'laravel-8-notes': '8',
    'laravel-9-notes': '9', 'laravel-10-notes': '10', 'laravel-11-notes': '11', 'laravel-mix-notes': 'mix',
    'phpunit-9-modern': '9', 'phpunit-10-notes': '10', 'phpunit-11-notes': '11',
  };
  assert.deepStrictEqual(validateSkillRoutingFamilies({
    families: inventory.skill_routing_families, skillIds: new Set(inventory.skills.map((skill) => skill.id)), skills: inventory.skills,
  }).errors, []);
  for (const [id, selector] of Object.entries(expected)) {
    const resolved = resolveSkillRoutingAlias({ families: inventory.skill_routing_families, id });
    assert.strictEqual(resolved.selector, selector, id);
    assert.match(resolved.reference, /^skills\/dhpk-(?:laravel|phpunit)\/references\/[^/]+\.md$/);
  }
});

test('routing resolution fails closed for unsafe conditional references and reports stable diagnostics', () => {
  const families = [{
    id: 'laravel',
    router_id: 'php-pro',
    invocation_class: 'implicit-eligible',
    surfaces: ['claude-module'],
    selectors: { '11': '../outside/SKILL.md', '10': 'skills/dhpk-laravel-10-notes/SKILL.md' },
    aliases: [
      { id: 'laravel-11-notes', selector: '11', invocation_class: 'implicit-eligible', surfaces: ['claude-module'] },
    ],
  }];
  const diagnostics = validateSkillRoutingFamilies({
    families,
    skillIds: new Set(['php-pro', 'laravel-11-notes']),
    skills: [{
      id: 'laravel',
      path: 'skills/dhpk-laravel',
      lifecycle: 'promoted',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-core'],
    }, {
      id: 'laravel-11-notes',
      legacy_names: ['laravel-11-notes'],
      path: 'skills/dhpk-laravel-11-notes',
      lifecycle: 'deprecated',
      discoveryVisible: false,
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
      deprecation: {
        since: '2026-09-02',
        compatibilityWindowEnds: '2026-12-02',
        migrationNote: 'Use the Laravel family selector.',
      },
    }],
  }).errors;

  assert.deepStrictEqual(diagnostics, [
    "skill_routing_families[0].selectors.10 must target a reference below the canonical skill path 'skills/dhpk-laravel/references/' (not an alias canonical skill path)",
    'skill_routing_families[0].selectors.11 must be a safe relative path',
  ]);
  const inventory = {
    skill_routing_families: families,
    skills: [{
      id: 'laravel-11-notes',
      legacy_names: ['laravel-11-notes'],
      path: 'skills/dhpk-laravel-11-notes',
      surfaces: ['claude-module'],
    }],
  };
  assert.strictEqual(resolveSkillRoutingReference({ inventory, families, familyId: 'laravel', selector: '11' }), null);
  assert.strictEqual(resolveSkillRoutingReference({ inventory, families, id: 'laravel-11-notes' }), null);
});

test('Claude projection compiler freezes roots and inventory-view intent without filesystem writes', () => {
  const inventory = baseInventory();
  const compiled = compileClaudeProjection({ inventory });
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  assert.ok(Object.isFrozen(compiled.plan));
  assert.strictEqual(compiled.plan.surface, 'claude-core');
  assert.ok(compiled.plan.entries.some((entry) => entry.stableId === 'claude:publication-roots'));
  assert.ok(compiled.plan.entries.some((entry) => entry.stableId === 'claude:inventory-view'));
  assert.deepStrictEqual(compiled.generated.roots, ['./skills/', './modules/vue-2/skills/']);
  assert.deepStrictEqual(compiled.generated.generatedSkillIds, ['tdd', 'vue-2-notes']);
});

test('Claude projection verification binds structural evidence to the compiled plan and reports root drift', () => {
  const inventory = baseInventory();
  const passing = verifyClaudeProjection({ inventory, pluginSkills: ['./skills/', './modules/vue-2/skills/'] });
  assert.strictEqual(passing.ok, true, passing.evidence && passing.evidence.diagnostics.join('\n'));
  assert.strictEqual(passing.evidence.verdict, 'PASS');
  assert.strictEqual(passing.evidence.planFingerprint, passing.plan.planFingerprint);

  const failing = verifyClaudeProjection({ inventory, pluginSkills: ['./skills/'] });
  assert.strictEqual(failing.ok, false);
  assert.strictEqual(failing.evidence.verdict, 'FAIL');
  assert.ok(failing.evidence.diagnostics.some((diagnostic) => /modules\/vue-2\/skills/.test(diagnostic)));
});

test('passes when every canonical skill/module has one valid entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.deepStrictEqual(result.errors, []);
});

test('validates receipt-managed supporting assets against safe repository paths', () => {
  const inv = baseInventory();
  inv.supporting_assets = [
    { id: 'prompt-defense', source: 'codex/supporting/prompt-defense.md', destination: 'dhpk/prompt-defense.md' },
  ];
  const result = validateSupportingAssets({
    inventory: inv,
    root: '/repo',
    exists: (candidate) => candidate === '/repo/codex/supporting/prompt-defense.md',
  });
  assert.deepStrictEqual(result.errors, []);
});

test('rejects duplicate, absolute, and traversal supporting asset mappings', () => {
  const inv = baseInventory();
  inv.supporting_assets = [
    { id: 'one', source: 'codex/a.md', destination: 'dhpk/a.md' },
    { id: 'one', source: 'codex/b.md', destination: 'dhpk/a.md' },
    { id: 'bad', source: '../outside.md', destination: '/tmp/outside.md' },
  ];
  const result = validateSupportingAssets({ inventory: inv, root: '/repo', exists: () => false });
  assert.ok(result.errors.some((e) => /duplicate .*id/i.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /duplicate .*destination/i.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /safe relative path|traversal|absolute/i.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /does not exist/i.test(e)), result.errors.join('\n'));
});

test('requires canonical and projection digests for transformed supporting assets', () => {
  const inv = baseInventory();
  inv.supporting_assets = [{
    id: 'transformed',
    source: 'codex/supporting/asset.md',
    canonical_source: 'agent-traps/asset.md',
    canonical_digest: 'not-a-digest',
    projection_digest: '',
    destination: 'dhpk/asset.md',
  }];
  const result = validateSupportingAssets({
    inventory: inv,
    root: '/repo',
    exists: (candidate) => candidate === '/repo/codex/supporting/asset.md' || candidate === '/repo/agent-traps/asset.md',
  });
  assert.strictEqual(result.errors.filter((e) => /SHA-256 hex digest/.test(e)).length, 2, result.errors.join('\n'));
});

test('fails when a canonical skill has no lifecycle entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes', 'skills/new-skill'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /skills\/new-skill/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails when a canonical module has no lifecycle entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2', 'modules/new-module'],
  });
  assert.ok(result.errors.some((e) => /modules\/new-module/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid lifecycle value', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'bogus';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid lifecycle/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid surface value', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-cor'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid surface/i.test(e)), result.errors.join('\n'));
});

test('fails on duplicate surface membership within one entry', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-core', 'claude-core'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate surface/i.test(e)), result.errors.join('\n'));
});

test('fails on a duplicate skill id across entries', () => {
  const inv = baseInventory();
  inv.skills.push({ id: 'tdd', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] });
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate/i.test(e)), result.errors.join('\n'));
});

test('fails when a deprecated skill leaks into generated promoted output', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
    generatedPromotedSkillIds: ['tdd'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecated/i.test(e) && /promoted/i.test(e)), result.errors.join('\n'));
});

test('passes when a deprecated skill is correctly absent from generated promoted output and carries deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = {
    since: '2026-07-27',
    compatibilityWindowEnds: '2026-10-27',
    migrationNote: 'Use vue-2-notes instead.',
  };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
    generatedPromotedSkillIds: ['vue-2-notes'],
  });
  assert.deepStrictEqual(result.errors, []);
});

test('fails when a deprecated skill has no deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation metadata/i.test(e)), result.errors.join('\n'));
});

test('fails when a deprecated skill has incomplete deprecation metadata', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = { since: '2026-07-27' };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /compatibilityWindowEnds/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /migrationNote/.test(e)), result.errors.join('\n'));
});

test('fails when deprecation metadata fields are whitespace-only strings, not just absent', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  inv.skills[0].deprecation = { since: '   ', compatibilityWindowEnds: '2026-10-27', migrationNote: '' };
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/dhpk-tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation\.since/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /deprecation\.migrationNote/.test(e)), result.errors.join('\n'));
  assert.ok(!result.errors.some((e) => /deprecation\.compatibilityWindowEnds/.test(e)), result.errors.join('\n'));
});

test('accepts explicit portable and Cursor surface membership with capability evidence', () => {
  const inv = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'one', name: 'dhpk-one', path: 'skills/dhpk-one', capability_id: 'dhpk.skill.one', lifecycle: 'promoted', tier: 'core', profiles: ['core'], surfaces: ['claude-core'] }],
    surface_membership: { 'agent-plugin': ['one'], 'cursor-plugin': ['one'], 'cursor-sync': ['one'] },
    portable_frontmatter: {
      allowlist: ['name', 'description', 'metadata'],
      client_owned: ['agents/openai.yaml', 'hooks'],
    },
    platform_matrix: {
      schema: 'dhpk.platform-capability-matrix.v1',
      required_surfaces: ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync', 'cursor-plugin', 'agent-plugin', 'agy-plugin'],
      required_runtime_surfaces: ['claude-core', 'codex-sync', 'codex-native', 'cursor-plugin', 'agent-plugin', 'agy-plugin'],
      entries: [{
        id: 'dhpk.platform.agent-plugin.skills',
        public_name: 'agent-plugin-portable-skills',
        surface: 'agent-plugin',
        source_paths: ['skills/'],
        destination: 'plugins/dhpk-agent/skills/',
        transform: 'agent-skills-frontmatter',
        fallback: 'codex-sync',
        evidence: 'NOT_RUN',
      }],
    },
  };
  assert.deepStrictEqual(validateDistributionInventory({ inventory: inv }).errors, []);
});

test('accepts only reviewed portable-family public names and keeps prefixed names for unmarked entries', () => {
  const portable = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'skill-scope', name: 'skill-scope', name_style: 'portable-family',
      path: 'skills/skill-scope', capability_id: 'dhpk.skill.skill-scope',
      invocation_class: 'implicit-eligible', lifecycle: 'promoted', tier: 'core',
      profiles: ['core'], surfaces: ['claude-core'],
    }],
  };
  assert.deepStrictEqual(validateDistributionInventoryV2({ inventory: portable }).errors, []);

  const unmarked = JSON.parse(JSON.stringify(portable));
  delete unmarked.skills[0].name_style;
  assert.ok(validateDistributionInventoryV2({ inventory: unmarked }).errors.some((error) => /name.*dhpk-|portable-family/i.test(error)));

  const prefixed = JSON.parse(JSON.stringify(portable));
  prefixed.skills[0].name = 'dhpk-skill-scope';
  prefixed.skills[0].path = 'skills/dhpk-skill-scope';
  assert.ok(validateDistributionInventoryV2({ inventory: prefixed }).errors.some((error) => /portable-family|unprefixed|reviewed/i.test(error)));

  const unreviewed = JSON.parse(JSON.stringify(portable));
  unreviewed.skills[0].id = 'unreviewed-family';
  unreviewed.skills[0].name = 'unreviewed-family';
  unreviewed.skills[0].path = 'skills/unreviewed-family';
  unreviewed.skills[0].capability_id = 'dhpk.skill.unreviewed-family';
  assert.ok(validateDistributionInventoryV2({ inventory: unreviewed }).errors.some((error) => /portable-family|reviewed|family/i.test(error)));
});

test('validates and normalizes the external skill package ledger', () => {
  const row = {
    id: 'gitnexus', owner: 'upstream',
    repository: 'https://github.com/abhigyanpatwari/GitNexus',
    policy: 'protect-existing', license_review: 'open',
    stable_ids: ['gitnexus-cli', 'gitnexus-refactoring'],
  };
  const inventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: row.stable_ids.map((id) => ({
      id, name: `dhpk-${id}`, path: `skills/dhpk-${id}`,
      capability_id: `dhpk.skill.${id}`, lifecycle: 'promoted', tier: 'core',
      profiles: ['core'], surfaces: ['agent-plugin'],
    })),
    external_skill_packages: [row],
  };
  assert.deepStrictEqual(validateExternalSkillPackages({ inventory }).errors, []);
  assert.deepStrictEqual(normalizeExternalSkillPackages({ inventory }), [{
    id: 'gitnexus', owner: 'upstream',
    repository: 'https://github.com/abhigyanpatwari/GitNexus',
    policy: 'protect-existing', license_review: 'open',
    stable_ids: ['gitnexus-cli', 'gitnexus-refactoring'],
  }]);
  const reversed = JSON.parse(JSON.stringify(inventory));
  reversed.external_skill_packages[0].stable_ids.reverse();
  assert.strictEqual(
    externalSkillPackagesFingerprint({ inventory }),
    externalSkillPackagesFingerprint({ inventory: reversed }),
  );
});

test('rejects malformed external package rows and lifecycle overlap', () => {
  const inventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', path: 'skills/dhpk-gitnexus-cli' }],
    retired_skills: [{ id: 'gitnexus-cli' }],
    external_skill_packages: [{
      id: 'GitNexus', owner: 'vendor', repository: 'http://example.com',
      policy: 'replace', license_review: 'unknown', stable_ids: ['gitnexus-cli', 'missing', 'missing'], extra: true,
    }],
  };
  const errors = validateExternalSkillPackages({ inventory }).errors.join('\n');
  assert.match(errors, /id.*kebab|lowercase/i);
  assert.match(errors, /owner.*upstream/i);
  assert.match(errors, /HTTPS|https/i);
  assert.match(errors, /policy.*protect-existing/i);
  assert.match(errors, /license_review/i);
  assert.match(errors, /stable_ids/i);
  assert.match(errors, /not allowed|unknown field|extra/i);
  assert.match(errors, /missing.*live|canonical|unknown stable id/i);
  assert.match(errors, /retired|overlap/i);
});

test('rejects unknown surface members, unsafe matrix paths, and non-portable frontmatter', () => {
  const inv = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'one', name: 'dhpk-one', path: 'skills/dhpk-one', capability_id: 'dhpk.skill.one', lifecycle: 'promoted', tier: 'core', profiles: ['core'], surfaces: ['claude-core'] }],
    surface_membership: { 'agent-plugin': ['missing'], 'cursor-plugin': ['one'] },
    portable_frontmatter: { allowlist: ['name', 'x-client-only'], client_owned: [] },
    platform_matrix: {
      schema: 'dhpk.platform-capability-matrix.v1',
      entries: [{
        id: 'dhpk.platform.agent-plugin.skills',
        public_name: 'skills',
        surface: 'agent-plugin',
        source_paths: ['../outside'],
        destination: 'plugins/dhpk-agent/skills/',
        transform: 'copy',
        fallback: 'none',
        evidence: 'UNKNOWN',
      }],
    },
  };
  const result = validateDistributionInventory({ inventory: inv });
  assert.ok(result.errors.some((e) => /unknown stable id/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /safe relative paths/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /non-portable field/.test(e)), result.errors.join('\n'));
  assert.ok(result.errors.some((e) => /evidence/.test(e)), result.errors.join('\n'));
  assert.ok(validatePlatformCapabilityMatrix(inv.platform_matrix).errors.length > 0);
  assert.ok(validatePortableFrontmatterContract(inv.portable_frontmatter).errors.length > 0);
});

test('inventory bootstrap preserves projection contracts on regeneration', () => {
  const generated = { schema: 'dhpk.distribution-inventory.v2', skills: [], modules: [], surfaces: ['codex-native'] };
  const existing = {
    surfaces: ['codex-native', 'agent-plugin', 'cursor-plugin'],
    surface_membership: { 'agent-plugin': ['stable'], 'cursor-plugin': ['stable'] },
    platform_matrix: { schema: 'dhpk.platform-capability-matrix.v1', entries: [] },
    portable_frontmatter: { allowlist: ['name'], client_owned: ['agents/openai.yaml'] },
    projection_contract: { schema: 'dhpk.distribution-projection-contract.v1' },
  };
  const merged = preserveProjectionContract(generated, existing);
  assert.deepStrictEqual(merged.surfaces, existing.surfaces);
  assert.deepStrictEqual(merged.surface_membership, existing.surface_membership);
  assert.deepStrictEqual(merged.platform_matrix, existing.platform_matrix);
  assert.deepStrictEqual(merged.portable_frontmatter, existing.portable_frontmatter);
  assert.deepStrictEqual(merged.projection_contract, existing.projection_contract);
});

test('inventory regeneration preserves the external package ledger', () => {
  const generated = { schema: 'dhpk.distribution-inventory.v2', skills: [], modules: [] };
  const existing = {
    external_skill_packages: [{
      id: 'gitnexus', owner: 'upstream',
      repository: 'https://github.com/abhigyanpatwari/GitNexus',
      policy: 'protect-existing', license_review: 'open',
      stable_ids: ['gitnexus-cli'],
    }],
  };
  const merged = preserveProjectionContract(generated, existing);
  assert.deepStrictEqual(merged.external_skill_packages, existing.external_skill_packages);
});

run('distribution-inventory-validate');
