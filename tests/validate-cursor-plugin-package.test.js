'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('Cursor package validator reports structural PASS and consumer NOT_RUN separately', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'ci', 'validate-cursor-plugin-package.js'),
    path.join(ROOT, 'plugins', 'dhpk-cursor'),
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.structural, 'PASS');
  assert.strictEqual(report.consumer.status, 'NOT_RUN');
});

run('validate-cursor-plugin-package');
