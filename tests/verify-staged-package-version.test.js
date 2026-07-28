'use strict';

// Coverage for scripts/ci/verify-staged-package-version.js — PACKAGE-gate
// version parity for the TRACKED codex-native artifact at plugins/dhpk/
// (task 3.2). Uses an isolated --repo-root fixture rather than the real repo
// tree so the test does not depend on (and does not spuriously fail against)
// the current release version.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-staged-package-version.js');

function fixtureRepo({ manifestVersion = '9.9.9', provenanceVersion = '9.9.9' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-verify-staged-version-'));
  const pkgDir = path.join(root, 'plugins', 'dhpk');
  fs.mkdirSync(path.join(pkgDir, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: manifestVersion, skills: './skills/' }));
  fs.writeFileSync(path.join(pkgDir, 'provenance.json'), JSON.stringify({ sourceVersion: provenanceVersion }));
  return root;
}

test('passes when the tracked manifest and provenance both match the target version', () => {
  const root = fixtureRepo({ manifestVersion: '9.9.9', provenanceVersion: '9.9.9' });
  try {
    const res = spawnSync('node', [CLI, '--version', '9.9.9', '--repo-root', root], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /9\.9\.9/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a non-semver target version', () => {
  const res = spawnSync('node', [CLI, '--version', 'not-semver'], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /semver/i);
});

test('fails when the tracked manifest version drifts from the target', () => {
  const root = fixtureRepo({ manifestVersion: '9.9.8', provenanceVersion: '9.9.9' });
  try {
    const res = spawnSync('node', [CLI, '--version', '9.9.9', '--repo-root', root], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /manifest version.*9\.9\.8/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when the tracked provenance sourceVersion drifts from the target', () => {
  const root = fixtureRepo({ manifestVersion: '9.9.9', provenanceVersion: '9.9.8' });
  try {
    const res = spawnSync('node', [CLI, '--version', '9.9.9', '--repo-root', root], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /provenance sourceVersion.*9\.9\.8/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('against the real tracked repo, the tracked package version matches the current release', () => {
  const claudePlugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const res = spawnSync('node', [CLI, '--version', claudePlugin.version], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});

run('verify-staged-package-version');
