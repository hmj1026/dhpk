'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { validateAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');

const ROOT = path.join(__dirname, '..');

test('tracked Agent Plugin package has independent structural and provenance gates', () => {
  const packageRoot = path.join(ROOT, 'plugins', 'dhpk-agent');
  const result = validateAgentPluginPackage(packageRoot);
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  const cli = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-agent-plugin-package.js'),
    packageRoot,
  ], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
  assert.strictEqual(JSON.parse(cli.stdout).surface, 'agent-plugin');
});

test('missing Agent Plugin package fails closed rather than becoming static PASS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-package-missing-'));
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-agent-plugin-package.js'), root,
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 1);
  assert.strictEqual(JSON.parse(result.stdout).structural, 'FAIL');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Agent Plugin validator fails closed for an unloadable skill entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-package-invalid-skill-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'broken'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'dhpk', version: '1.0.0', description: 'fixture',
    }));
    const result = validateAgentPluginPackage(root);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((error) => /broken|SKILL\.md|invalid/i.test(error)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

run('agent-plugin-package');
