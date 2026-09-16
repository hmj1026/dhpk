'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const closure = require('../scripts/lib/retirement-closure');

test('library exports the single strict retirement closure validator', () => {
  assert.strictEqual(typeof closure.validateRetirementClosure, 'function');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(closure, 'CURRENT_WAVE_IDS'), true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(closure, 'REMOVED_COMMAND_IDS'), true);
});

run('retirement-closure');
