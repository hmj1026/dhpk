'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'validate-agy-plugin-package.js');
const PACKAGE = path.join(ROOT, 'plugins', 'dhpk-agy');

test('CLI reports structural and provenance PASS for the checked-in AGY package', () => {
  const result = spawnSync(process.execPath, [SCRIPT, PACKAGE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"structural": "PASS"/);
  assert.match(result.stdout, /"provenance": "PASS"/);
});

run('validate-agy-plugin-package');
