'use strict';

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateCursorPackage } = require('../scripts/lib/cursor-plugin-package');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));

test('tracked Cursor package exposes physical native components and no symlinks', () => {
  const result = validateCursorPackage({ packageRoot: path.join(ROOT, 'plugins/dhpk-cursor'), inventory: INVENTORY });
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

test('Cursor validator rejects .md rules and leftover plugin-root interpolation', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-package-native-docs-'));
  const token = '${' + 'CLAUDE_PLUGIN_ROOT}';
  try {
    fs.mkdirSync(path.join(root, '.cursor-plugin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.cursor-plugin', 'plugin.json'), JSON.stringify({
      name: 'dhpk-cursor',
      version: '1.0.0',
      description: 'fixture',
      rules: './rules/',
      agents: './agents/',
      variables: { type: 'object', properties: {} },
    }));
    fs.writeFileSync(path.join(root, '.cursor-plugin', 'marketplace.json'), JSON.stringify({
      name: 'test',
      owner: { name: 'test' },
      plugins: [{ name: 'dhpk-cursor', source: '.' }],
    }));
    fs.writeFileSync(path.join(root, 'rules', 'legacy.md'), '---\nname: legacy\ndescription: leftover markdown rule\nalwaysApply: false\n---\n# leftover\n');
    fs.writeFileSync(path.join(root, 'agents', 'dirty.md'), `---\nname: dirty\ndescription: leftover plugin root\nmodel: inherit\nreadonly: true\n---\nLoad ${token}/docs/contracts/x.md\n`);
    const result = validateCursorPackage({ packageRoot: root, expectedManifestName: 'dhpk-cursor' });
    assert.strictEqual(result.ok, false);
    const joined = result.errors.join('\n');
    assert.match(joined, /\.mdc extension/);
    assert.match(joined, /plugin-root interpolation/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('cursor-plugin-package');
