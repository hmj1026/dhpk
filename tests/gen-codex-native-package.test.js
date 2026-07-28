'use strict';

// Coverage for scripts/ci/gen-codex-native-package.js and materializeNativePackage().
// Verifies the generated candidate is entirely physical files, scoped to the
// explicit codex-native inventory surface (not lifecycle=promoted), deterministic
// across two runs, and carries a per-skill source fingerprint plus provenance.

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

test('materialized candidate contains only the explicit codex-native surface, as real files — not every promoted skill', () => {
  const inventory = {
    skills: [
      { id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', path: 'skills/skill-judge', lifecycle: 'promoted', surfaces: ['claude-core'] },
      { id: 'vue-2-notes', path: 'skills/tdd', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
  const out = tmpDir('dhpk-native-materialize-');
  try {
    const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'tdd', 'SKILL.md')));
    // skill-judge is promoted but NOT codex-native — must be excluded.
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'skill-judge')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'vue-2-notes')));
    const validation = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: out });
    assert.deepStrictEqual(validation.errors, []);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('an approved optional-lifecycle native exception is included alongside promoted native skills', () => {
  const inventory = {
    skills: [
      { id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'php-pro', path: 'modules/php-5.6/skills/php-pro', lifecycle: 'optional', surfaces: ['claude-module', 'codex-native'] },
    ],
  };
  const out = tmpDir('dhpk-native-optional-exception-');
  try {
    const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['php-pro', 'tdd']);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('regenerating into an existing outDir removes a skill directory dropped from the codex-native surface', () => {
  const firstInventory = {
    skills: [
      { id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', path: 'skills/skill-judge', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
    ],
  };
  const out = tmpDir('dhpk-native-regenerate-drop-');
  try {
    materializeNativePackage({ inventory: firstInventory, root: ROOT, outDir: out });
    assert.ok(fs.existsSync(path.join(out, 'skills', 'skill-judge')));

    // skill-judge is de-listed from codex-native between releases.
    const secondInventory = {
      skills: [{ id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
    };
    const result = materializeNativePackage({ inventory: secondInventory, root: ROOT, outDir: out });

    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'tdd')), 'tdd must remain');
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'skill-judge')), 'stale skill-judge directory must be removed on regeneration');
    assert.deepStrictEqual(Object.keys(result.fingerprints), ['tdd']);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('generation is deterministic: two materializations of the same inventory produce identical fingerprints and provenance', () => {
  const inventory = {
    skills: [{ id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
  };
  const outA = tmpDir('dhpk-native-a-');
  const outB = tmpDir('dhpk-native-b-');
  try {
    const a = materializeNativePackage({ inventory, root: ROOT, outDir: outA, version: '1.2.3', sourceCommit: 'abc123' });
    const b = materializeNativePackage({ inventory, root: ROOT, outDir: outB, version: '1.2.3', sourceCommit: 'abc123' });
    assert.deepStrictEqual(a.fingerprints, b.fingerprints);
    assert.deepStrictEqual(a.provenance, b.provenance);
    assert.strictEqual(fingerprintDir(path.join(outA, 'skills', 'tdd')), fingerprintDir(path.join(outB, 'skills', 'tdd')));
  } finally {
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
});

test('CLI generates the real repo codex-native set with zero symlinks and provenance', () => {
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

    const provenance = JSON.parse(fs.readFileSync(path.join(out, 'provenance.json'), 'utf8'));
    assert.strictEqual(provenance.selectedSkillIds.length, 15);
    assert.ok(provenance.sourceCommit && provenance.sourceCommit !== 'unknown');
    assert.ok(provenance.inventoryDigest);
    assert.ok(provenance.generatorVersion);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

run('gen-codex-native-package');
