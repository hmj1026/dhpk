'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');

test('tracked Cursor package exposes physical native components and no symlinks', () => {
  const result = validateCursorPackage({ packageRoot: path.join(ROOT, 'plugins/dhpk-cursor') });
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  assert.strictEqual(result.skippedSkills.length, 0);
});

test('Cursor validator fails closed for an unloadable skill entry', () => {
  const root = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'dhpk-cursor-package-invalid-skill-'));
  try {
    const fs = require('node:fs');
    fs.mkdirSync(require('node:path').join(root, '.cursor-plugin'), { recursive: true });
    fs.mkdirSync(require('node:path').join(root, 'skills', 'broken'), { recursive: true });
    fs.writeFileSync(require('node:path').join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk-cursor', version: '1.0.0', description: 'fixture', skills: './skills/', variables: { type: 'object', properties: {} } }));
    fs.writeFileSync(require('node:path').join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({ name: 'test', owner: { name: 'test' }, plugins: [{ name: 'dhpk-cursor', source: '.' }] }));
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /broken|SKILL\.md|invalid/i.test(error)));
  } finally { require('node:fs').rmSync(root, { recursive: true, force: true }); }
});

run('cursor-plugin-package');
