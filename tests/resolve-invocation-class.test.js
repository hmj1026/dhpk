'use strict';

// Coverage for scripts/lib/resolve-invocation-class.js. The helper is a
// fail-closed boundary for shell hooks, so assertions exercise the exported
// resolver directly while hook tests cover the CLI boundary.

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lib', 'resolve-invocation-class.js');
const { resolveInvocationClass } = require(SCRIPT);

test('resolves a paired explicit-only command from a namespaced route target', () => {
  assert.strictEqual(resolveInvocationClass(ROOT, 'dhpk:smart-commit'), 'explicit-only');
});

test('resolves an implicit-eligible skill from a namespaced route target', () => {
  assert.strictEqual(resolveInvocationClass(ROOT, 'dhpk:review-pending'), 'implicit-eligible');
});

test('missing or malformed targets fail closed with no class output', () => {
  for (const target of ['dhpk:deploy-prod', 'dhpk:../commands', '']) {
    assert.strictEqual(resolveInvocationClass(ROOT, target), null, `${target}: expected null class`);
  }
});

run('resolve-invocation-class');
