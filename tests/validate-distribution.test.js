'use strict';

// Coverage for scripts/ci/validate-distribution.js's reconciliation layer
// (task 1.4): reconcileDistribution() checks module-catalog membership,
// codex/skills/ mirror presence, and agents/openai.yaml presence for any
// skill declaring a Codex surface. Complements
// distribution-inventory-validate.test.js, which covers the structural
// checks (missing/invalid/duplicate/deprecated-leak).

const { test, run, assert } = require('./_lib/tinytest');
const { reconcileDistribution } = require('../scripts/lib/distribution-inventory');
const { verifyClaudeProjection } = require('../scripts/lib/claude-projection-adapter');

function baseInventory() {
  return {
    skills: [
      { id: 'tdd', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
    ],
    modules: [
      { id: 'vue-2', path: 'modules/vue-2', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
}

test('passes when every module is catalog-selectable and every codex surface is backed', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => true,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('fails when an optional module has no module-catalog entry', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: [],
    hasOpenaiMetadata: () => true,
  });
  assert.ok(result.errors.some((e) => /vue-2/.test(e) && /catalog/i.test(e)), result.errors.join('\n'));
});

test('fails when a codex-sync skill has no codex/skills/ mirror', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: [],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => true,
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /mirror/i.test(e)), result.errors.join('\n'));
});

test('fails when a cursor-sync skill has no cursor/skills/ mirror', () => {
  const result = reconcileDistribution({
    inventory: {
      skills: [
        { id: 'tdd', name: 'tdd-workflow', path: 'skills/tdd-workflow', lifecycle: 'promoted', surfaces: ['cursor-sync'] },
      ],
      surface_membership: { 'cursor-sync': ['tdd'] },
      modules: [],
    },
    cursorMirrorNames: [],
    moduleCatalogIds: [],
    hasOpenaiMetadata: () => true,
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /cursor\/skills/.test(e)), result.errors.join('\n'));
});

test('fails when a codex-sync skill has no agents/openai.yaml', () => {
  const result = reconcileDistribution({
    inventory: baseInventory(),
    codexMirrorNames: ['tdd'],
    moduleCatalogIds: ['vue-2'],
    hasOpenaiMetadata: () => false,
  });
  assert.ok(result.errors.some((e) => /tdd/.test(e) && /openai\.yaml/i.test(e)), result.errors.join('\n'));
});

test('a skill with no codex surface never triggers codex reconciliation errors', () => {
  const inv = {
    skills: [{ id: 'harness-govern', path: 'skills/harness-govern', lifecycle: 'promoted', surfaces: ['claude-core'] }],
    modules: [],
  };
  const result = reconcileDistribution({
    inventory: inv,
    codexMirrorNames: [],
    moduleCatalogIds: [],
    hasOpenaiMetadata: () => false,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('Claude verification returns plan-bound PASS evidence and isolates root drift', () => {
  const inventory = {
    schema: 'dhpk.distribution-inventory.v1',
    skills: [{ id: 'core', path: 'skills/dhpk-core', lifecycle: 'promoted', surfaces: ['claude-core'] }],
    modules: [],
  };
  const passing = verifyClaudeProjection({ inventory, pluginSkills: ['./skills/'] });
  assert.strictEqual(passing.ok, true, passing.evidence && passing.evidence.diagnostics.join('\n'));
  assert.strictEqual(passing.evidence.verdict, 'PASS');
  assert.strictEqual(passing.evidence.planFingerprint, passing.plan.planFingerprint);
  const failing = verifyClaudeProjection({ inventory, pluginSkills: ['./unexpected/'] });
  assert.strictEqual(failing.ok, false);
  assert.strictEqual(failing.evidence.verdict, 'FAIL');
  assert.ok(failing.evidence.diagnostics.some((message) => /unexpected/.test(message)));
});

test('reconcileDistribution fails when Directory Plugin ships a skill absent from main marketplace selection', () => {
  const result = reconcileDistribution({
    inventory: { skills: [], modules: [] },
    directoryPluginSkillNames: ['tdd-workflow', 'extra-skill'],
    directoryPluginAgentNames: ['code-reviewer'],
    mainMarketplaceSkillNames: ['tdd-workflow'],
    mainMarketplaceAgentNames: ['code-reviewer'],
  });
  assert.ok(result.errors.some((e) => /Directory Plugin/i.test(e) && /extra-skill/.test(e)), result.errors.join('\n'));
});

test('reconcileDistribution fails when Directory Plugin ships an agent absent from main marketplace or omitted capability', () => {
  const { OMITTED_SKILLS, OMITTED_AGENTS } = require('../scripts/lib/claude-directory-reduction');
  const extraAgent = reconcileDistribution({
    inventory: { skills: [], modules: [] },
    directoryPluginSkillNames: ['tdd-workflow'],
    directoryPluginAgentNames: ['extra-agent'],
    mainMarketplaceSkillNames: ['tdd-workflow'],
    mainMarketplaceAgentNames: ['code-reviewer'],
    omittedSkillNames: OMITTED_SKILLS,
    omittedAgentNames: OMITTED_AGENTS,
  });
  assert.ok(extraAgent.errors.some((e) => /Directory Plugin/i.test(e) && /extra-agent/.test(e)), extraAgent.errors.join('\n'));

  const omittedSkill = reconcileDistribution({
    inventory: { skills: [], modules: [] },
    directoryPluginSkillNames: ['flow-guide'],
    directoryPluginAgentNames: [],
    mainMarketplaceSkillNames: ['flow-guide', 'tdd-workflow'],
    mainMarketplaceAgentNames: [],
    omittedSkillNames: OMITTED_SKILLS,
    omittedAgentNames: OMITTED_AGENTS,
  });
  assert.ok(omittedSkill.errors.some((e) => /Directory Plugin/i.test(e) && /flow-guide/.test(e)), omittedSkill.errors.join('\n'));

  const valid = reconcileDistribution({
    inventory: { skills: [], modules: [] },
    directoryPluginSkillNames: ['tdd-workflow'],
    directoryPluginAgentNames: ['code-reviewer'],
    mainMarketplaceSkillNames: ['tdd-workflow', 'flow-guide'],
    mainMarketplaceAgentNames: ['code-reviewer', 'codex-worker'],
    omittedSkillNames: OMITTED_SKILLS,
    omittedAgentNames: OMITTED_AGENTS,
  });
  assert.deepStrictEqual(valid.errors, []);
});

run('validate-distribution');
