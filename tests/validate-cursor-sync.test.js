'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-cursor-sync.js');

test('checked-in cursor/ tree passes the cursor-sync validator CLI', () => {
  const result = spawnSync(process.execPath, [CLI], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS \[cursor-sync\]/);
});

run('validate-cursor-sync');
