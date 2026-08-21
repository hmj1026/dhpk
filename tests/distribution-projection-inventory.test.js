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

run('distribution-projection-inventory');
