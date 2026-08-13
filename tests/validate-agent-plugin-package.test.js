'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('Agent Plugin validator emits structural PASS and provenance PASS', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-agent-plugin-package.js'),
    path.join(ROOT, 'plugins', 'dhpk-agent'),
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.structural, 'PASS');
  assert.strictEqual(report.provenance, 'PASS');
});

test('Agent Plugin validator preserves the --package-root compatibility alias', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-agent-plugin-package.js'),
    '--package-root', path.join(ROOT, 'plugins', 'dhpk-agent'),
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.surface, 'agent-plugin');
  assert.strictEqual(report.structural, 'PASS');
  assert.strictEqual(report.provenance, 'PASS');
});

test('Agent Plugin validator keeps malformed provenance as a failing report', () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-validator-'));
  try {
    fs.writeFileSync(path.join(packageRoot, 'plugin.json'), JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'dhpk',
      version: '1.0.0',
      description: 'fixture',
    }));
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'validate-agent-plugin-package.js'), packageRoot,
    ], { encoding: 'utf8' });
    assert.strictEqual(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.structural, 'PASS');
    assert.strictEqual(report.provenance, 'FAIL');
    assert.ok(report.errors.some((error) => /provenance\.json is missing/.test(error)));
  } finally { fs.rmSync(packageRoot, { recursive: true, force: true }); }
});

run('validate-agent-plugin-package');
