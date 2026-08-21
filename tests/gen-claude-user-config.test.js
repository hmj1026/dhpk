'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('candidate generator validates the authoritative source without activating it', () => {
  const result = spawnSync('node', [path.join(ROOT, 'scripts/ci/gen-claude-user-config.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /gen-claude-user-config/);
});

run('gen-claude-user-config');
