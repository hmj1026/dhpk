'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const publisher = require('../scripts/lib/project-agent-projection-publisher');

test('project publisher exposes receipt-owned lifecycle operations', () => {
  assert.strictEqual(publisher.PROJECT_RECEIPT_SCHEMA, 'dhpk.project-agent-projection-receipt.v1');
  assert.strictEqual(typeof publisher.materializeRelocatableAgentsSkillsProjection, 'function');
  assert.strictEqual(typeof publisher.validateRelocatableAgentsSkillsProjection, 'function');
  assert.strictEqual(typeof publisher.uninstallAgentsSkillsProjection, 'function');
  assert.strictEqual(typeof publisher.rollbackAgentsSkillsProjection, 'function');
});

test('project publisher fails closed when materialization inputs are incomplete', () => {
  assert.throws(
    () => publisher.materializeRelocatableAgentsSkillsProjection({}),
    /sourceRoot and inventory are required/,
  );
});

run('project-agent-projection-publisher');
