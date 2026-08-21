'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const bundle = require('../scripts/lib/claude-capability-bundle');

test('Claude capability bundle exposes the compiler and artifact boundaries', () => {
  assert.strictEqual(typeof bundle.resolveClaudeProfile, 'function');
  assert.strictEqual(typeof bundle.compileClaudeCapabilityBundle, 'function');
  assert.strictEqual(typeof bundle.materializeClaudeCapabilityBundle, 'function');
  assert.strictEqual(typeof bundle.verifyClaudeCapabilityBundle, 'function');
});

run('claude-capability-bundle');
