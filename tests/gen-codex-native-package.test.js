'use strict';

// Coverage for scripts/ci/gen-codex-native-package.js and materializeNativePackage()
// (task 3.2). Verifies the generated candidate is entirely physical files, scoped
// to promoted skills only, deterministic across two runs, and carries a per-skill
// source fingerprint.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeNativePackage, validateNativeCandidate, fingerprintDir } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('materialized candidate contains only promoted skills, as real files', () => {
  const inventory = {
    skills: [
      { id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core'] },
      { id: 'vue-2-notes', path: 'skills/tdd', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
  const out = tmpDir('dhpk-native-materialize-');
  try {
    const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'tdd', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'vue-2-notes')));
    const validation = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: out });
    assert.deepStrictEqual(validation.errors, []);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('generation is deterministic: two materializations of the same inventory produce identical fingerprints', () => {
  const inventory = {
    skills: [{ id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core'] }],
  };
  const outA = tmpDir('dhpk-native-a-');
  const outB = tmpDir('dhpk-native-b-');
  try {
    const a = materializeNativePackage({ inventory, root: ROOT, outDir: outA });
    const b = materializeNativePackage({ inventory, root: ROOT, outDir: outB });
    assert.deepStrictEqual(a.fingerprints, b.fingerprints);
    assert.strictEqual(fingerprintDir(path.join(outA, 'skills', 'tdd')), fingerprintDir(path.join(outB, 'skills', 'tdd')));
  } finally {
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
});

test('CLI generates the real repo promoted set with zero symlinks', () => {
  const out = tmpDir('dhpk-native-cli-');
  try {
    const res = spawnSync('node', [path.join(ROOT, 'scripts', 'ci', 'gen-codex-native-package.js'), out], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);

    function findSymlinks(dir) {
      const found = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) found.push(fp);
        else if (entry.isDirectory()) found.push(...findSymlinks(fp));
      }
      return found;
    }
    assert.deepStrictEqual(findSymlinks(out), []);

    const manifest = JSON.parse(fs.readFileSync(path.join(out, '.codex-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.skills, './skills/');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

run('gen-codex-native-package');
