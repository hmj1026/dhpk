'use strict';

// Coverage for scripts/ci/verify-codex-native-package.js — the deterministic
// generation gate (task 2.3): a fresh regeneration must match the tracked
// plugins/dhpk/ artifact's fingerprints, membership, manifest skills field,
// inventory digest, and generator version.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeNativePackage } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-codex-native-package.js');

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-drift-repo-'));
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'dhpk-tdd-workflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'dhpk-tdd-workflow', 'SKILL.md'), '---\nname: tdd\n---\n');
  const inventory = {
    skills: [{ id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
  };
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify(inventory));
  return { root, inventory };
}

test('passes when the tracked package matches a fresh generation from the same sources', () => {
  const { root, inventory } = fixtureRepo();
  try {
    materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'abc' });
    const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails and names the extra skill when the tracked package has drifted membership', () => {
  const { root, inventory } = fixtureRepo();
  try {
    materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'abc' });
    // Simulate drift: inventory gains a new codex-native skill after the tracked package was generated.
    fs.mkdirSync(path.join(root, 'skills', 'extra-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'extra-skill', 'SKILL.md'), '---\nname: extra-skill\n---\n');
    const driftedInventory = {
      skills: [
        ...inventory.skills,
        { id: 'extra-skill', path: 'skills/extra-skill', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      ],
    };
    fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), JSON.stringify(driftedInventory));

    const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /membership drifted/);
    assert.match(res.stderr, /extra-skill/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a canonical skill file changes content after the tracked package was generated', () => {
  const { root, inventory } = fixtureRepo();
  try {
    materializeNativePackage({ inventory, root, outDir: path.join(root, 'plugins', 'dhpk'), name: 'dhpk', version: '1.0.0', sourceCommit: 'abc' });
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-tdd-workflow', 'SKILL.md'), '---\nname: tdd\n---\nchanged content\n');

    const res = spawnSync('node', [CLI, '--repo-root', root], { encoding: 'utf8' });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /fingerprint drifted/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('against the real repo, the tracked plugins/dhpk/ package matches a fresh generation', () => {
  const res = spawnSync('node', [CLI], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});

run('verify-codex-native-package');
