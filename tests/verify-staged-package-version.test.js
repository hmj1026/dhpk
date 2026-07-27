'use strict';

// Coverage for scripts/ci/verify-staged-package-version.js — the
// staged-package-metadata parity dimension of task 2.1/3.3: materializes the
// physical Codex native package candidate into a temp dir at a target
// version and asserts its manifest carries that exact version.

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-staged-package-version.js');

test('passes when the materialized staged package manifest matches the target version', () => {
  const res = spawnSync('node', [CLI, '--version', '9.9.9'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /9\.9\.9/);
});

test('rejects a non-semver target version', () => {
  const res = spawnSync('node', [CLI, '--version', 'not-semver'], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /semver/i);
});

run('verify-staged-package-version');
