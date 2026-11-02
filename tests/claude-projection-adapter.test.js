'use strict';

// Claude Host Adapter module boundary: the Claude root derivation, projection
// compiler and verifier live in claude-projection-adapter.js, while the
// inventory module keeps validation/reconciliation and does not re-export them.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const adapter = require('../scripts/lib/claude-projection-adapter');
const inventoryApi = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const V2 = 'dhpk.distribution-inventory.v2';

test('claude adapter exposes exactly the three Claude projection functions', () => {
  assert.deepStrictEqual(Object.keys(adapter).sort(), [
    'compileClaudeProjection',
    'generateClaudeSkillRoots',
    'verifyClaudeProjection',
  ]);
});

test('inventory module no longer re-exports the Claude projection functions', () => {
  for (const name of Object.keys(adapter)) {
    assert.strictEqual(inventoryApi[name], undefined, `${name} must live only in the adapter`);
  }
  assert.strictEqual(typeof inventoryApi.reconcileDistribution, 'function');
  assert.strictEqual(typeof inventoryApi.computeScopedCounts, 'function');
});

test('v2 inventory registers one skills root and drops deprecated skills from generated ids', () => {
  const generated = adapter.generateClaudeSkillRoots({
    schema: V2,
    skills: [
      { id: 'b', path: 'skills/dhpk-b', lifecycle: 'promoted' },
      { id: 'a', path: 'skills/dhpk-a', lifecycle: 'optional' },
      { id: 'old', path: 'skills/dhpk-old', lifecycle: 'deprecated' },
    ],
  });
  assert.deepStrictEqual(generated, {
    roots: ['./skills/'],
    registeredSkillIds: ['a', 'b'],
    generatedSkillIds: ['a', 'b'],
  });
});

test('computeScopedCounts keeps working through the adapter without a load-order cycle', () => {
  const counts = inventoryApi.computeScopedCounts({
    schema: V2,
    skills: [{ id: 'a', path: 'skills/dhpk-a', lifecycle: 'promoted' }],
    modules: [],
  });
  assert.strictEqual(counts.claudePublished, 1);
});

for (const order of [
  ['distribution-inventory', 'claude-projection-adapter'],
  ['claude-projection-adapter', 'distribution-inventory'],
]) {
  test(`modules load in either order without circular-require breakage (${order[0]} first)`, () => {
    const code = order.map((name) => `require('./scripts/lib/${name}')`).join(';')
      + ";const a=require('./scripts/lib/claude-projection-adapter');"
      + "if (typeof a.generateClaudeSkillRoots!=='function') process.exit(3);"
      + "a.generateClaudeSkillRoots({schema:'" + V2 + "',skills:[]});";
    const result = spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
  });
}

run('claude-projection-adapter');
