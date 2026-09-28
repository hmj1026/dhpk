'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');
const { registerFlowEntryFixtures, flowEntryFixtureIds } = require('./_lib/skill-flow-entry-fixtures');
const fixtures = registerFlowEntryFixtures();

const EXPECTED_ENTRIES = [
  ['flow-guide-usage-local-card', 'flow-guide', 'scripts/usage-card.js'],
  ['flow-guide-analyze-consumer', 'flow-guide', 'scripts/analyze.js'],
  ['flow-guide-prepare-consumer-profile', 'flow-guide', 'scripts/prepare_workflow_profile.py'],
  ['flow-guide-prepare-consumer-scope', 'flow-guide', 'scripts/prepare_dev_scope.py'],
  ['flow-guide-workflow-missing-evidence', 'flow-guide', 'scripts/workflow_gate_check.py'],
  ['flow-guide-openspec-ready-fixture', 'flow-guide', 'scripts/openspec_gate_check.py'],
  ['flow-guide-bundled-selector-native', 'flow-guide', 'references/execution-bundle/scripts/fast-worker-selector.js'],
  ['flow-drive-bundled-selector-native', 'flow-drive', 'references/execution-bundle/scripts/fast-worker-selector.js'],
];

test('flow entry registry pins every expected Skill-local entry before execution', () => {
  assert.deepStrictEqual(flowEntryFixtureIds, EXPECTED_ENTRIES.map(([id]) => id));
  for (const [id, skill, entry] of EXPECTED_ENTRIES) {
    assert.strictEqual(fixtures[id].skill, skill, `${id} must run from ${skill}`);
    assert.strictEqual(fixtures[id].entry, entry, `${id} must use its declared local entry`);
  }
  const repeated = registerFlowEntryFixtures();
  for (const [id] of EXPECTED_ENTRIES) {
    assert.strictEqual(repeated[id], fixtures[id], `${id} must remain the same registered fixture`);
  }
});

for (const id of flowEntryFixtureIds) {
  test(`isolated public entry ${id}`, () => {
    const fixture = fixtures[id];
    withIsolatedSkill({ source: path.join(__dirname, '../skills', fixture.skill), stubs: fixture.stubs }, context => {
      const result = context.run(fixture.entry, fixture.args || []);
      fixture.assert(result, context);
    });
  });
}

run('skill-flow-entry-isolation');
