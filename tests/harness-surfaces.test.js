'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { REQUIRED_SURFACES } = require('../scripts/lib/harness-surfaces');

test('full-release surface identity has one canonical ordered list', () => {
  assert.deepStrictEqual(REQUIRED_SURFACES, [
    'claude-core', 'codex-sync', 'codex-native', 'cursor-sync',
    'cursor-plugin', 'agent-plugin', 'agy-plugin',
  ]);
  assert.strictEqual(Object.isFrozen(REQUIRED_SURFACES), true);
});

run('harness-surfaces');
