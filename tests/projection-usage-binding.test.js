'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  compileDistribution,
  materializeDistribution,
} = require('../scripts/lib/distribution-compiler');
const {
  compareDistributionProjections,
} = require('../scripts/lib/distribution-projection-parity');
const {
  normalizeSkillUsage,
  usageFingerprint,
  USAGE_SCHEMA,
} = require('../scripts/lib/skill-usage');

function usage(summary = 'Trace the selected task with bounded evidence') {
  return {
    display_name: 'Fixture Skill',
    summary,
    syntax: '$fixture-skill <task>',
    input_kind: 'free-text',
    invocation_class: 'implicit-eligible',
    effect_authority: 'read-only',
    actions: [{
      id: 'trace',
      summary: 'Trace the selected task',
      syntax: '$fixture-skill <task>',
      input_kind: 'free-text',
      effect_authority: 'read-only',
    }],
    options: [],
    examples: [{
      prompt: '$fixture-skill OrderService',
      summary: 'Trace a fixture symbol',
    }],
  };
}

function inventory(summary) {
  const skill = {
    id: 'fixture',
    name: 'fixture-skill',
    path: 'skills/fixture-skill',
    surfaces: ['codex-native', 'agent-plugin'],
    invocation_class: 'implicit-eligible',
    lifecycle: 'promoted',
    owner: 'dhpk',
    source_fingerprint: 'source-fixture',
    usage: usage(summary),
  };
  return {
    skills: [skill],
    modules: [],
    surface_membership: { 'codex-native': ['fixture'], 'agent-plugin': ['fixture'] },
    projection_contract: {
      schema: 'dhpk.distribution-projection-contract.v1',
      compiler: { id: 'distribution-compiler', version: '1' },
      symlink_policies: ['forbid'],
      surfaces: {
        'codex-native': {
          adapter: 'codex-native',
          owner: 'codex-native',
          symlink_policy: 'forbid',
          verification_stages: ['structural'],
          selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
        },
        'agent-plugin': {
          adapter: 'agent-plugin',
          owner: 'agent-plugin',
          symlink_policy: 'forbid',
          verification_stages: ['structural'],
          selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
        },
      },
    },
    external_skill_packages: [],
  };
}

function outputPlan(summary) {
  const sourceSkill = {
    id: 'fixture',
    name: 'fixture-skill',
    invocation_class: 'implicit-eligible',
    lifecycle: 'promoted',
    owner: 'dhpk',
    path: 'skills/fixture-skill',
  };
  const normalized = normalizeSkillUsage({ skill: sourceSkill, usage: usage(summary) });
  return compileDistribution({
    surface: 'agent-plugin',
    inventory: inventory(summary),
    entries: [{
      id: 'skill:fixture:SKILL.md',
      skillId: 'fixture',
      publicName: 'fixture-skill',
      source: 'skills/fixture-skill/SKILL.md',
      destination: 'skills/fixture-skill/SKILL.md',
      owner: 'plugins/dhpk-agent',
      transform: { id: 'fixture', version: '1' },
      content: 'fixture',
      expectedFingerprint: 'fixture-output',
      usage: normalized,
      usageFingerprint: usageFingerprint({ skill: sourceSkill, usage: usage(summary) }),
      provenance: {
        inventoryRevision: 'revision-fixture',
        canonicalSource: 'skills/fixture-skill',
        sourceFingerprint: 'source-fixture',
        owner: 'dhpk',
        transform: { id: 'fixture', version: '1' },
        lifecycle: 'promoted',
        publicName: 'fixture-skill',
        invocationClass: 'implicit-eligible',
      },
    }],
    selectionEntries: [{
      id: 'fixture',
      name: 'fixture-skill',
      skillId: 'fixture',
      source: 'skills/fixture-skill',
      destination: 'skills/fixture-skill',
      usage: normalized,
      usageFingerprint: usageFingerprint({ skill: sourceSkill, usage: usage(summary) }),
    }],
    selectedStableIds: ['fixture'],
    selectionPolicy: { source: 'surface_membership', precedence: ['surface_membership'] },
    inventoryFingerprint: 'inventory-fixture',
    inventoryRevision: 'revision-fixture',
    externalSkillPackagesFingerprint: 'external-fixture',
  });
}

test('distribution plans carry normalized usage and usage fingerprint for emitted skills', () => {
  const result = compileDistribution({ inventory: inventory() , surface: 'codex-native' });
  assert.strictEqual(result.ok, true, result.error && result.error.message);
  const entry = result.value.entries[0];
  assert.strictEqual(entry.usage.schema, undefined);
  assert.strictEqual(entry.usageFingerprint.length, 64);
  assert.strictEqual(entry.usage.invocation_class, 'implicit-eligible');
  assert.strictEqual(entry.provenance.inventoryRevision, 'sha256:' + require('../scripts/lib/skill-usage').fingerprint(inventory()));
  assert.strictEqual(result.value.usageSchema, USAGE_SCHEMA);
  assert.strictEqual(result.value.usageFingerprints.fixture, entry.usageFingerprint);
});

test('usage mutation changes the compiler selection and plan identities', () => {
  const first = compileDistribution({ inventory: inventory(), surface: 'codex-native' });
  const second = compileDistribution({ inventory: inventory('Trace the changed task with bounded evidence'), surface: 'codex-native' });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.notStrictEqual(first.value.entries[0].usageFingerprint, second.value.entries[0].usageFingerprint);
  assert.notStrictEqual(first.value.planFingerprint, second.value.planFingerprint);
  assert.notStrictEqual(first.value.selectionFingerprint, second.value.selectionFingerprint);
});

test('materialization rejects adapter usage metadata that differs from the accepted plan', () => {
  const compiled = outputPlan();
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  const artifact = materializeDistribution(compiled.value, {
    identity: { id: 'fixture', version: '1' },
    render: () => ({
      outputs: [{
        stableId: 'skill:fixture:SKILL.md',
        destination: 'skills/fixture-skill/SKILL.md',
        content: 'fixture',
        usage: { ...compiled.value.entries[0].usage, summary: 'Trace a different task with bounded evidence' },
        usageFingerprint: 'b'.repeat(64),
        provenance: compiled.value.entries[0].provenance,
      }],
    }),
  }, {
    begin: () => ({
      write: () => {},
      stage: () => ({ outputs: [], links: [], artifactFingerprint: 'artifact-fixture' }),
      abort: () => {},
    }),
  });
  assert.strictEqual(artifact.ok, false);
  assert.match(artifact.error.message, /metadata/i);
});

test('projection parity reports usage independently from provenance', () => {
  const compiled = outputPlan();
  assert.strictEqual(compiled.ok, true, compiled.error && compiled.error.message);
  const plan = compiled.value;
  const artifact = {
    planFingerprint: plan.planFingerprint,
    artifactFingerprint: 'artifact-fixture',
    outputs: plan.entries.map((entry) => ({
      stableId: entry.stableId,
      destination: entry.destination,
      usage: entry.usage,
      usageFingerprint: entry.usageFingerprint,
      provenance: entry.provenance,
      expectedFingerprint: entry.expectedFingerprint,
    })),
  };
  const actual = {
    surface: 'agent-plugin',
    plan: {
      ...plan,
      entries: plan.entries.map((entry) => ({ ...entry, usageFingerprint: 'c'.repeat(64) })),
      selectionEntries: plan.selectionEntries.map((entry) => ({ ...entry, usageFingerprint: 'c'.repeat(64) })),
    },
    artifact,
  };
  const result = compareDistributionProjections({
    expected: { surface: 'agent-plugin', plan, artifact },
    actual,
    stage: 'structural',
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.checkedFieldGroups.usage);
  assert.ok(result.checkedFieldGroups.provenance);
  assert.ok(result.mismatches.some((mismatch) => mismatch.field === 'usageFingerprint'));
  assert.ok(result.mismatches.some((mismatch) => mismatch.type === 'usage'));
});

run('projection-usage-binding');
