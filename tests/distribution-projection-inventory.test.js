'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  validateDistributionInventory,
  validateProjectionContract,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');

test('checked-in inventory declares a complete projection contract', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  const result = validateDistributionInventory({ inventory });
  assert.deepStrictEqual(result.errors, [], result.errors.join('\n'));
  assert.strictEqual(inventory.projection_contract.schema, 'dhpk.distribution-projection-contract.v1');
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

run('distribution-projection-inventory');
