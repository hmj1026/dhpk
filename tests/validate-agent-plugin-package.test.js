'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

run('validate-agent-plugin-package');
