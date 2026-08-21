'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('profile bundle generator checks a declared finite alias', () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/ci/gen-claude-profile-bundles.js'), '--profile', 'minimal', '--check',
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"profile"/);
  assert.match(result.stdout, /"planFingerprint"/);
});

run('gen-claude-profile-bundles');
