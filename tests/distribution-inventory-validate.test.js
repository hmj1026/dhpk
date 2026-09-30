'use strict';

// These tests pin the inventory validator and routing contract: missing lifecycle
// entries, invalid lifecycle values, duplicate surface membership, deprecated
// leakage, and malformed family routing all fail closed.

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const {
  REQUIRED_SURFACES,
  computeScopedCounts,
  generateClaudeSkillRoots,
  validateProjectionContract,
  validateRequiredSurfacePlan,
  validateDistributionInventory,
  validateDistributionInventoryV2,
  validateExternalSkillPackages,
  normalizeExternalSkillPackages,
  externalSkillPackagesFingerprint,
  validateSupportingAssets,
  validatePlatformCapabilityMatrix,
  validateInstallationLifecycleContract,
  validatePortableFrontmatterContract,
  preserveProjectionContract,
  LIFECYCLES,
  compileClaudeProjection,
  verifyClaudeProjection,
  validateSkillRoutingFamilies,
  resolveSkillRoutingAlias,
  resolveSkillRoutingReference,
} = require('../scripts/lib/distribution-inventory');
const {
  INTERNAL_RUNTIME_SURFACES,
  runtimeSupportSkillIds,
  validateInternalRuntimeSkills,
} = require('../scripts/lib/internal-runtime-skills');

function baseInventory() {
  return {
    schema: 'dhpk.distribution-inventory.v1',
    lifecycles: ['promoted', 'optional', 'experimental', 'deprecated'],
    surfaces: ['claude-core', 'claude-module', 'codex-sync', 'codex-native'],
    skills: [
      { id: 'tdd', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
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

test('checked-in families resolve selectors directly while retired version IDs remain alias-free', () => {
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
    assert.strictEqual(resolveSkillRoutingAlias({ families: inventory.skill_routing_families, id }), null, id);
    const familyId = id.startsWith('laravel-') ? 'laravel' : 'phpunit';
    const resolved = resolveSkillRoutingReference({ inventory, familyId, selector });
    assert.match(resolved, /^skills\/(?:laravel|phpunit)\/references\/[^/]+\.md$/);
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes', 'skills/new-skill'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /skills\/new-skill/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails when a canonical module has no lifecycle entry', () => {
  const inv = baseInventory();
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2', 'modules/new-module'],
  });
  assert.ok(result.errors.some((e) => /modules\/new-module/.test(e) && /missing/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid lifecycle value', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'bogus';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid lifecycle/i.test(e)), result.errors.join('\n'));
});

test('fails on an invalid surface value', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-cor'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /invalid surface/i.test(e)), result.errors.join('\n'));
});

test('fails on duplicate surface membership within one entry', () => {
  const inv = baseInventory();
  inv.skills[0].surfaces = ['claude-core', 'claude-core'];
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate surface/i.test(e)), result.errors.join('\n'));
});

test('fails on a duplicate skill id across entries', () => {
  const inv = baseInventory();
  inv.skills.push({ id: 'tdd', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core'] });
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
    canonicalModulePaths: ['modules/vue-2'],
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /duplicate/i.test(e)), result.errors.join('\n'));
});

test('fails when a deprecated skill leaks into generated promoted output', () => {
  const inv = baseInventory();
  inv.skills[0].lifecycle = 'deprecated';
  const result = validateDistributionInventory({
    inventory: inv,
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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
    canonicalSkillPaths: ['skills/tdd-workflow', 'modules/vue-2/skills/dhpk-vue-2-notes'],
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

test('v2 validation requires a closed usage contract for Codex-selected skills', () => {
  const usage = {
    display_name: 'Demo Skill',
    summary: 'Inspect a demo task with bounded read-only evidence',
    syntax: '$dhpk-demo <task>',
    input_kind: 'free-text',
    inputs: [{ id: 'task', syntax: '<task>', value_kind: 'string', required: true, summary: 'Task to inspect' }],
    invocation_class: 'implicit-eligible',
    effect_authority: 'read-only',
    actions: [],
    options: [],
    examples: [{ prompt: '$dhpk-demo inspect this task', summary: 'Inspect a demo task' }],
  };
  const inventory = {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'demo',
      name: 'dhpk-demo',
      path: 'skills/dhpk-demo',
      capability_id: 'dhpk.skill.demo',
      invocation_class: 'implicit-eligible',
      lifecycle: 'promoted',
      tier: 'core',
      profiles: ['core'],
      surfaces: ['codex-native'],
      usage,
    }],
  };
  assert.deepStrictEqual(validateDistributionInventoryV2({ inventory }).errors, []);

  delete inventory.skills[0].usage;
  const missing = validateDistributionInventoryV2({ inventory });
  assert.ok(missing.errors.some((error) => /usage-contract\[demo\].*missing usage contract/i.test(error)), missing.errors.join('\n'));
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
    installation_contract: {
      schema: 'dhpk.installation-lifecycle.v1',
      operations: ['plan', 'install', 'verify', 'update', 'uninstall', 'rollback', 'status'],
      surfaces: { 'codex-sync': { adapter: 'scripts/hooks/install-codex-skills.sh', support_tier: 'supported', operations: { plan: 'READ_ONLY', install: 'ADAPTER', verify: 'READ_ONLY', update: 'ADAPTER', uninstall: 'ADAPTER', rollback: 'ADAPTER', status: 'READ_ONLY' } } },
    },
  };
  const merged = preserveProjectionContract(generated, existing);
  assert.deepStrictEqual(merged.surfaces, existing.surfaces);
  assert.deepStrictEqual(merged.surface_membership, existing.surface_membership);
  assert.deepStrictEqual(merged.platform_matrix, existing.platform_matrix);
  assert.deepStrictEqual(merged.portable_frontmatter, existing.portable_frontmatter);
  assert.deepStrictEqual(merged.projection_contract, existing.projection_contract);
  assert.deepStrictEqual(merged.installation_contract, existing.installation_contract);
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

test('installation lifecycle contract requires the exact surface and operation matrix', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  assert.deepStrictEqual(validateInstallationLifecycleContract(inventory.installation_contract).errors, []);

  const missing = JSON.parse(JSON.stringify(inventory.installation_contract));
  delete missing.surfaces.cursor;
  assert.ok(validateInstallationLifecycleContract(missing).errors.some((error) => /missing 'cursor'/i));

  const extra = JSON.parse(JSON.stringify(inventory.installation_contract));
  extra.surfaces.claude.operations.typo = 'BLOCKED';
  assert.ok(validateInstallationLifecycleContract(extra).errors.some((error) => /unsupported operation 'typo'/i));
});


// Merged from tests/distribution-scoped-counts.test.js. The fixture and
// literal outcomes keep each published count tied to its intended scope.
function fixtureInventory() {
  return {
    skills: [
      { id: 'a', path: 'skills/a', lifecycle: 'promoted', surfaces: ['claude-core'] },
      { id: 'b', path: 'skills/b', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
      { id: 'c', path: 'modules/x/skills/c', lifecycle: 'optional', surfaces: ['claude-module'] },
      { id: 'd', path: 'modules/x/skills/d', lifecycle: 'experimental', surfaces: ['claude-module'] },
      { id: 'e', path: 'skills/e', lifecycle: 'deprecated', surfaces: ['claude-core'] },
    ],
    modules: [{ id: 'x', path: 'modules/x', lifecycle: 'optional', surfaces: ['claude-module'] }],
  };
}

test('computes independent canonical/promoted-core/optional/experimental/deprecated counts', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.canonical, 5);
  assert.strictEqual(counts.promotedCore, 2);
  assert.strictEqual(counts.optional, 1);
  assert.strictEqual(counts.experimental, 1);
  assert.strictEqual(counts.deprecated, 1);
});

test('Claude-published count excludes deprecated (host still lists the root, but the count is the inventory-derived intent)', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.claudePublished, 4);
});

test('Claude-published count is the same inventory-derived set used by structural verification', () => {
  const inventory = fixtureInventory();
  const counts = computeScopedCounts(inventory);
  const generated = verifyClaudeProjection({ inventory, pluginSkills: ['./skills/', './modules/x/skills/'] });
  assert.strictEqual(generated.ok, true, generated.evidence && generated.evidence.diagnostics.join('\n'));
  assert.deepStrictEqual(generated.generated.generatedSkillIds, ['a', 'b', 'c', 'd']);
  assert.strictEqual(counts.claudePublished, 4);
  assert.strictEqual(generated.generated.generatedSkillIds.length, counts.claudePublished);
});

test('Codex-published count is the codex-sync/codex-native surface count, distinct from promoted-core', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.codexPublished, 1);
});


test('module lifecycle counts are computed with the same rigor as skill lifecycle counts', () => {
  const inv = fixtureInventory();
  inv.modules.push(
    { id: 'y', path: 'modules/y', lifecycle: 'experimental', surfaces: ['claude-module'] },
    {
      id: 'z',
      path: 'modules/z',
      lifecycle: 'deprecated',
      surfaces: ['claude-module'],
      deprecation: { since: '2026-01-01', compatibilityWindowEnds: '2026-04-01', migrationNote: 'retired' },
    }
  );
  const counts = computeScopedCounts(inv);
  assert.strictEqual(counts.optionalModules, 1);
  assert.strictEqual(counts.experimentalModules, 1);
  assert.strictEqual(counts.deprecatedModules, 1);
});

test('against the real checked-in inventory, canonical and scoped counts remain independently derived', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const counts = computeScopedCounts(inventory);
  assert.strictEqual(counts.canonical, inventory.skills.length);
  assert.strictEqual(counts.promotedCore + counts.optional + counts.experimental + counts.deprecated, counts.canonical);
});

test('neither bilingual README claims the canonical skill total as a default-install count (task 4.2 regression guard)', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const canonicalSkillCount = inventory.skills.length;
  for (const rel of ['README.md', 'README.zh-TW.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A leak looks like "<canonical total> skill(s)" / "<canonical total> 個 skill" —
    // i.e. the raw canonical count phrased as though it were the (narrower)
    // default-install surface. Scoped counts (promotedCore/claudePublished/
    // codexPublished) are unaffected since this only flags the canonical figure.
    const leakPattern = new RegExp(`${canonicalSkillCount}\\s*(?:skills?|個\\s*skill)`, 'i');
    assert.ok(!leakPattern.test(text), `${rel} appears to claim the canonical skill total (${canonicalSkillCount}) as a default-install count`);
  }
});

// Merged from tests/distribution-projection-inventory.test.js.


test('checked-in inventory declares a complete projection contract', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const result = validateDistributionInventory({ inventory });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(inventory.projection_contract.schema, 'dhpk.distribution-projection-contract.v1');
  for (const surface of ['agent-plugin', 'cursor-plugin', 'codex-native']) {
    const policy = inventory.projection_contract.surfaces[surface].selection_policy;
    assert.ok(policy && typeof policy === 'object', `${surface} selection policy is required`);
    assert.ok(typeof policy.source === 'string' && policy.source.length > 0);
    assert.ok(Array.isArray(policy.precedence) && policy.precedence.length > 0);
  }
});

test('projection contract rejects missing surfaces, unsupported links, and invalid stages', () => {
  const result = validateProjectionContract({
    schema: 'dhpk.distribution-projection-contract.v1',
    compiler: { id: 'distribution-compiler', version: '1' },
    symlink_policies: ['absolute'],
    surfaces: {
      'agent-plugin': { adapter: 'agent-plugin', owner: 'agent-plugin', symlink_policy: 'absolute', verification_stages: ['runtime'] },
    },
  });
  assert.ok(result.errors.some((error) => /unsupported policy/.test(error)));
  assert.ok(result.errors.some((error) => /missing.*codex-sync/.test(error)));
  assert.ok(result.errors.some((error) => /unsupported stage/.test(error)));
});

test('projection contract rejects missing, unknown, conflicting, and broadened selection policies', () => {
  const base = {
    schema: 'dhpk.distribution-projection-contract.v1',
    compiler: { id: 'distribution-compiler', version: '1' },
    symlink_policies: ['forbid'],
    surfaces: {},
  };
  for (const surface of ['claude-core', 'claude-module', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor-plugin', 'cursor-sync', 'agy-plugin']) {
    base.surfaces[surface] = {
      adapter: surface,
      owner: surface,
      symlink_policy: 'forbid',
      verification_stages: ['structural'],
    };
  }
  const missing = validateProjectionContract(base);
  assert.ok(missing.errors.some((error) => /selection_policy/.test(error)));

  const unknown = JSON.parse(JSON.stringify(base));
  unknown.surfaces['agent-plugin'].selection_policy = { source: 'ambient-directory', precedence: ['ambient-directory'] };
  const unknownResult = validateProjectionContract(unknown);
  assert.ok(unknownResult.errors.some((error) => /unsupported selection policy source/.test(error)));

  const conflicting = JSON.parse(JSON.stringify(base));
  conflicting.surfaces['agent-plugin'].selection_policy = {
    source: 'surface_membership',
    precedence: ['surface_membership', 'surface_membership'],
  };
  const conflictingResult = validateProjectionContract(conflicting);
  assert.ok(conflictingResult.errors.some((error) => /duplicate|conflicting.*precedence/.test(error)));

  const broadened = JSON.parse(JSON.stringify(base));
  broadened.surfaces['codex-native'].selection_policy = {
    source: 'entry_surfaces',
    precedence: ['surface_membership', 'entry_surfaces'],
  };
  const broadenedResult = validateProjectionContract(broadened);
  assert.ok(broadenedResult.errors.some((error) => /entry_surfaces.*precedence|broaden/.test(error)));
});

// Merged from tests/internal-cli-transport-inventory.test.js.

test('internal transport is registered everywhere but excluded from invokable generation', () => {
  const inventory = JSON.parse(JSON.stringify(require('../manifests/distribution-inventory.json')));
  const entry = inventory.skills.find((skill) => skill.id === 'cli-transport');
  assert.ok(entry, 'internal transport inventory entry is required');
  assert.strictEqual(entry.invokable, false);
  assert.deepStrictEqual([...entry.surfaces].sort(), [...inventory.surfaces].sort());
  const validation = validateDistributionInventory({ inventory });
  assert.deepStrictEqual(validation.errors, [], validation.errors.join('\n'));
  const generated = generateClaudeSkillRoots(inventory);
  assert.ok(generated.registeredSkillIds.includes('cli-transport'));
  assert.ok(!generated.generatedSkillIds.includes('cli-transport'));

  const expectedRuntimeSupport = ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge'];
  for (const surface of ['agent-plugin', 'cursor-plugin']) {
    assert.deepStrictEqual(
      inventory.internal_runtime_skills[surface],
      expectedRuntimeSupport,
      `${surface} must explicitly carry the non-invokable transport runtime`,
    );
  }
  assert.deepStrictEqual(inventory.internal_runtime_skills['agy-plugin'], [...expectedRuntimeSupport, 'flow-guide'],
    'AGY must explicitly carry the flow-guide runtime closure');
  assert.deepStrictEqual(inventory.internal_runtime_skills['codex-native'], ['cli-dispatch-context', 'cli-transport'],
    'Codex sync must materialize its transport runtime outside capability selection');

  const unknownSupport = JSON.parse(JSON.stringify(inventory));
  unknownSupport.internal_runtime_skills['agent-plugin'] = ['missing-runtime'];
  const invalid = validateDistributionInventory({ inventory: unknownSupport });
  assert.ok(invalid.errors.some((error) => error.includes("internal_runtime_skills.agent-plugin references unknown stable id 'missing-runtime'")));
});

// Merged from tests/internal-runtime-skills.test.js.

function inventory() {
  return JSON.parse(JSON.stringify(require('../manifests/distribution-inventory.json')));
}

test('resolves declared runtime support without making it an invokable selection', () => {
  const source = inventory();
  const expected = ['agy-fast-worker', 'cli-dispatch-context', 'cli-transport', 'codex-bridge'];
  const entry = source.skills.find((skill) => skill.id === 'cli-dispatch-context');
  assert.ok(entry, 'dispatch context inventory entry is required');
  assert.strictEqual(entry.invokable, false);
  assert.strictEqual(entry.discoveryVisible, false);
  assert.deepStrictEqual([...entry.surfaces].sort(), [...source.surfaces].sort());
  assert.deepStrictEqual(INTERNAL_RUNTIME_SURFACES, ['agent-plugin', 'cursor-plugin', 'agy-plugin', 'codex-native']);
  assert.deepStrictEqual(runtimeSupportSkillIds(source, 'agent-plugin'), expected);
  assert.deepStrictEqual(runtimeSupportSkillIds(source, 'cursor-plugin'), expected);
  assert.deepStrictEqual(runtimeSupportSkillIds(source, 'agy-plugin'), [...expected, 'flow-guide']);
  assert.deepStrictEqual(runtimeSupportSkillIds(source, 'codex-native'), ['cli-dispatch-context', 'cli-transport']);
});

test('rejects malformed and unsupported runtime-support declarations', () => {
  const duplicate = inventory();
  duplicate.internal_runtime_skills['agent-plugin'] = ['cli-transport', 'cli-transport'];
  assert.throws(() => runtimeSupportSkillIds(duplicate, 'agent-plugin'), /duplicate stable id/);

  const unsupported = inventory();
  unsupported.internal_runtime_skills['unsupported-surface'] = ['cli-transport'];
  const validation = validateInternalRuntimeSkills({ inventory: unsupported });
  assert.ok(validation.errors.some((error) => error.includes("unsupported surface 'unsupported-surface'")));
});

// Merged from tests/harness-platform-matrix.test.js.
// RED-first contract tests for harness-facade-receipt-contract task 3.3.
// The inventory platform matrix is the required-surface SSOT; projection
// contracts and consumer evidence remain separate boundaries.


const REQUIRED = [
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
];
const REQUIRED_RUNTIME = [
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
];

function matrix(overrides = {}) {
  return {
    schema: 'dhpk.platform-capability-matrix.v1',
    required_surfaces: [...REQUIRED],
    required_runtime_surfaces: [...REQUIRED_RUNTIME],
    entries: [],
    ...overrides,
  };
}

function projectionContract(overrides = {}) {
  const surfaces = Object.fromEntries(REQUIRED.map((surface) => [surface, {
    adapter: surface,
    owner: surface,
    symlink_policy: 'forbid',
    verification_stages: ['structural', 'package', 'consumer-runtime'],
  }]));
  return {
    schema: 'dhpk.distribution-projection-contract.v1',
    compiler: { id: 'distribution-compiler', version: '1' },
    symlink_policies: ['forbid'],
    surfaces,
    ...overrides,
  };
}

test('checked-in inventory owns the seven canonical required surfaces and projection contracts', () => {
  assert.deepStrictEqual(REQUIRED_SURFACES, REQUIRED);
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  assert.deepStrictEqual(inventory.platform_matrix.required_surfaces, REQUIRED);
  assert.deepStrictEqual(inventory.platform_matrix.required_runtime_surfaces, REQUIRED_RUNTIME);
  const result = validateRequiredSurfacePlan({ inventory, fullRelease: true });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.deepStrictEqual(result.requiredRuntimeSurfaces, REQUIRED_RUNTIME);
});

test('platform matrix rejects missing, duplicate, unknown, and reordered required lists', () => {
  for (const required_surfaces of [
    undefined,
    [...REQUIRED.slice(0, -1), 'agy-plugin', 'agy-plugin'],
    [...REQUIRED.slice(0, -1), 'unknown-surface'],
    [...REQUIRED].reverse(),
  ]) {
    const result = validatePlatformCapabilityMatrix(matrix({ required_surfaces }), {
      requireRequiredSurfaces: true,
    });
    assert.ok(result.errors.length > 0, JSON.stringify(required_surfaces));
    assert.match(result.errors.join('\n'), /required_surfaces|duplicate|unknown|canonical|order/i);
  }
});

test('required surface plan rejects incomplete or foreign full-release lists and allows declared subsets only as scoped', () => {
  const inventory = {
    platform_matrix: matrix(),
    projection_contract: projectionContract(),
  };
  const incomplete = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: REQUIRED.slice(0, -1),
    fullRelease: true,
  });
  assert.ok(incomplete.errors.length > 0);

  const foreign = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: [...REQUIRED.slice(0, -1), 'foreign-surface'],
    fullRelease: true,
  });
  assert.ok(foreign.errors.length > 0);
  assert.match(foreign.errors.join('\n'), /unknown|canonical|required/i);

  const scoped = validateRequiredSurfacePlan({
    inventory,
    requiredSurfaces: ['agent-plugin', 'cursor-plugin'],
    fullRelease: false,
  });
  assert.deepStrictEqual(scoped.errors, []);
});

test('required surfaces must have matching projection contracts', () => {
  const contract = projectionContract();
  delete contract.surfaces['agy-plugin'];
  const result = validateRequiredSurfacePlan({
    inventory: {
      platform_matrix: matrix(),
      projection_contract: contract,
    },
    fullRelease: true,
  });
  assert.ok(result.errors.some((error) => /agy-plugin.*projection|projection.*agy-plugin/i.test(error)), result.errors.join('\n'));
});

test('required runtime surfaces are an ordered subset and exclude cursor-sync', () => {
  for (const required_runtime_surfaces of [
    undefined,
    [...REQUIRED_RUNTIME.slice(0, -1), 'agy-plugin', 'agy-plugin'],
    ['cursor-sync', ...REQUIRED_RUNTIME.slice(1)],
    ['agent-plugin', 'codex-native', 'codex-sync', 'claude-core', 'cursor-plugin', 'agy-plugin'],
    [...REQUIRED_RUNTIME.slice(0, -1)],
  ]) {
    const result = validatePlatformCapabilityMatrix(matrix({ required_runtime_surfaces }), {
      requireRequiredSurfaces: true,
    });
    assert.ok(result.errors.length > 0, JSON.stringify(required_runtime_surfaces));
    assert.match(result.errors.join('\n'), /required_runtime_surfaces|duplicate|cursor-sync|canonical|order|include/i);
  }
});

run('distribution-inventory-validate');
