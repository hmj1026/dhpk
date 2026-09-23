'use strict';

// Unit contract for the Skill-local command namespace helper. Keep loading
// inside the test boundary so a missing authoring module is reported as RED
// assertions rather than aborting the whole test process during require().

const { test, run, assert } = require('./_lib/tinytest');
const currentUtils = require('../scripts/lib/utils');

let namespace;
let loadError;
try {
  namespace = require('../scripts/lib/command-namespace');
} catch (error) {
  loadError = error;
}

function moduleUnderTest() {
  assert.ifError(loadError);
  return namespace;
}

test('command namespace exports the approved dhpk constant and qualifier', () => {
  const helper = moduleUnderTest();
  assert.strictEqual(helper.COMMAND_NAMESPACE, 'dhpk');
  assert.strictEqual(typeof helper.qualifyCommand, 'function');
});

test('qualifyCommand prefixes an unqualified slash command exactly once', () => {
  assert.strictEqual(moduleUnderTest().qualifyCommand('/update-docs'), '/dhpk:update-docs');
});

test('qualifyCommand leaves an already dhpk-qualified command unchanged', () => {
  const command = '/dhpk:update-docs';
  assert.strictEqual(moduleUnderTest().qualifyCommand(command), command);
});

test('qualifyCommand leaves dollar, non-command, and empty values unchanged', () => {
  const qualify = moduleUnderTest().qualifyCommand;
  assert.strictEqual(qualify('$change-verdict --mode code'), '$change-verdict --mode code');
  assert.strictEqual(qualify('update-docs'), 'update-docs');
  assert.strictEqual(qualify(''), '');
});

test('other slash namespaces retain the current utils prefix behavior', () => {
  const command = '/other:update-docs';
  const expected = currentUtils.qualifyCommand(command);
  assert.strictEqual(expected, '/dhpk:other:update-docs');
  assert.strictEqual(moduleUnderTest().qualifyCommand(command), expected);
});

run('command-namespace');
