'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
const { validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');

test('legacy Codex package is not counted as standard Agent Plugin conformance', () => {
  const result = validateAgentPluginPackage(path.join(ROOT, 'plugins/dhpk'));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /plugin\.json/i.test(error)));
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
  assert.ok(!inventory.surfaces.includes('legacy-agent-plugin'));
  assert.ok(inventory.surfaces.includes('codex-native'));
});

test('Cursor native package is not accepted as a portable Agent Plugin package', () => {
  const result = validateAgentPluginPackage(path.join(ROOT, 'plugins/dhpk-cursor'));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((error) => /plugin\.json|skills/i.test(error)));
  const cursor = validateCursorPackage({ packageRoot: path.join(ROOT, 'plugins/dhpk-cursor') });
  assert.strictEqual(cursor.ok, true, cursor.errors.join('\n'));
});

test('surface outputs have separate physical roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-surface-boundary-'));
  try {
    assert.notStrictEqual(path.resolve(root, 'agent'), path.resolve(root, 'cursor'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('platform-boundary');
