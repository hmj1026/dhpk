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
const {
  compileNativePackage,
  materializeNativePackage,
  validateNativeCandidate,
  verifyNativePackage,
  fingerprintDir,
} = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function packageFiles(root, relative = '') {
  const files = {};
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const child = path.posix.join(relative, entry.name);
    const absolute = path.join(root, relative, entry.name);
    if (entry.isDirectory()) Object.assign(files, packageFiles(root, child));
    else if (entry.isFile()) files[child] = fs.readFileSync(absolute);
    else throw new Error(`unexpected package entry: ${child}`);
  }
  return files;
}

function assertPackageFilesEquivalent(actualFiles, expectedFiles) {
  assert.deepStrictEqual(Object.keys(actualFiles).sort(), Object.keys(expectedFiles).sort());
  for (const [key, content] of Object.entries(actualFiles)) {
    assert.ok(content.equals(expectedFiles[key]), `Content mismatch for package entry: ${key}`);
  }
}

test('native compiler plan preserves explicit selection, public identity, and generated output intent', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'not-native', name: 'dhpk-not-native', path: 'skills/dhpk-not-native', lifecycle: 'promoted', surfaces: ['claude-core'] },
    ],
  };
  const out = tmpDir('dhpk-native-compile-');
  try {
    const projection = compileNativePackage({ inventory, root: ROOT, outDir: out, version: '1.2.3', sourceCommit: 'abc123' });
    assert.strictEqual(projection.plan.surface, 'codex-native');
    assert.deepStrictEqual(projection.selectedSkillIds, ['tdd']);
    assert.deepStrictEqual(projection.selectedSkillNames, ['dhpk-tdd-workflow']);
    assert.deepStrictEqual(projection.provenance.routingProjection, projection.routingProjection);
    assert.strictEqual(projection.routingProjection.surface, 'codex-native');
    assert.ok(projection.plan.entries.some((entry) => entry.destination === 'skills/dhpk-tdd-workflow/SKILL.md'));
    assert.ok(projection.plan.entries.some((entry) => entry.destination === '.codex-plugin/plugin.json'));
    assert.ok(!projection.plan.entries.some((entry) => entry.destination.includes('dhpk-not-native')));
    assert.ok(Object.isFrozen(projection.plan));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('compiler-backed native generation preserves the accepted package bytes', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const tracked = path.join(ROOT, 'plugins', 'dhpk');
  const trackedManifest = JSON.parse(fs.readFileSync(path.join(tracked, '.codex-plugin', 'plugin.json'), 'utf8'));
  const trackedProvenance = JSON.parse(fs.readFileSync(path.join(tracked, 'provenance.json'), 'utf8'));
  const out = tmpDir('dhpk-native-byte-equivalence-');
  try {
    materializeNativePackage({
      inventory,
      root: ROOT,
      outDir: out,
      name: trackedManifest.name,
      version: trackedManifest.version,
      sourceCommit: trackedProvenance.sourceCommit,
    });
    assertPackageFilesEquivalent(packageFiles(out), packageFiles(tracked));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('native materialization preserves executable source modes through the artifact store', () => {
  const root = tmpDir('dhpk-native-mode-source-');
  const out = tmpDir('dhpk-native-mode-output-');
  try {
    const skill = path.join(root, 'skills', 'dhpk-mode-skill');
    fs.mkdirSync(path.join(skill, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: dhpk-mode-skill\n---\n');
    const executable = path.join(skill, 'bin', 'run.sh');
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.chmodSync(executable, 0o755);
    materializeNativePackage({
      inventory: { skills: [{ id: 'mode', name: 'dhpk-mode-skill', path: 'skills/dhpk-mode-skill', surfaces: ['codex-native'] }] },
      root,
      outDir: out,
    });
    assert.strictEqual(fs.statSync(path.join(out, 'skills', 'dhpk-mode-skill', 'bin', 'run.sh')).mode & 0o777, 0o755);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('materialized candidate contains only the explicit codex-native surface, as real files — not every promoted skill', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core'] },
      { id: 'vue-2-notes', name: 'dhpk-vue-2-notes', path: 'skills/dhpk-vue-2-notes', lifecycle: 'optional', surfaces: ['claude-module'] },
    ],
  };
  const out = tmpDir('dhpk-native-materialize-');
  try {
    const result = materializeNativePackage({ inventory, root: ROOT, outDir: out });
    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-tdd-workflow', 'SKILL.md')));
    // skill-judge is promoted but NOT codex-native — must be excluded.
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-skill-quality-judge')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-vue-2-notes')));
    const validation = validateNativeCandidate({ manifestSkillsField: result.manifestSkillsField, packageRoot: out });
    assert.deepStrictEqual(validation.errors, []);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('an approved optional-lifecycle native exception is included alongside promoted native skills', () => {
  const inventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'php-pro', name: 'dhpk-php-runtime-router', path: 'skills/dhpk-php-runtime-router', lifecycle: 'optional', surfaces: ['claude-module', 'codex-native'] },
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

test('materialized native packages use public names for directories, frontmatter, fingerprints, and provenance while retaining stable IDs', () => {
  const inventory = {
    skills: [{
      id: 'tdd',
      name: 'dhpk-tdd-workflow',
      path: 'skills/dhpk-tdd-workflow',
      lifecycle: 'promoted',
      surfaces: ['claude-core', 'codex-native'],
    }],
  };
  const out = tmpDir('dhpk-native-public-name-');
  try {
    const result = materializeNativePackage({ inventory, root: ROOT, outDir: out, version: '1.2.3', sourceCommit: 'abc123' });
    const publicDir = path.join(out, 'skills', 'dhpk-tdd-workflow');
    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.deepStrictEqual(result.skillNames, ['dhpk-tdd-workflow']);
    assert.ok(fs.existsSync(path.join(publicDir, 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'tdd')), 'stable IDs must not become native directory names');
    assert.match(fs.readFileSync(path.join(publicDir, 'SKILL.md'), 'utf8'), /^name:\s*dhpk-tdd-workflow/m);
    assert.deepStrictEqual(Object.keys(result.fingerprints), ['dhpk-tdd-workflow']);
    assert.deepStrictEqual(result.provenance.selectedSkillIds, ['tdd']);
    assert.deepStrictEqual(result.provenance.selectedSkillNames, ['dhpk-tdd-workflow']);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('native materialization rejects a skill whose frontmatter name differs from its public directory name', () => {
  const root = tmpDir('dhpk-native-frontmatter-mismatch-root-');
  const out = tmpDir('dhpk-native-frontmatter-mismatch-out-');
  try {
    fs.mkdirSync(path.join(root, 'skills', 'dhpk-example-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-example-skill', 'SKILL.md'), '---\nname: legacy-example\n---\n');
    const inventory = {
      skills: [{
        id: 'example-skill',
        name: 'dhpk-example-skill',
        path: 'skills/dhpk-example-skill',
        lifecycle: 'promoted',
        surfaces: ['codex-native'],
      }],
    };
    assert.throws(
      () => materializeNativePackage({ inventory, root, outDir: out }),
      /frontmatter.*dhpk-example-skill|public name.*dhpk-example-skill/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('regenerating into an existing outDir removes a skill directory dropped from the codex-native surface', () => {
  const firstInventory = {
    skills: [
      { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
      { id: 'skill-judge', name: 'dhpk-skill-quality-judge', path: 'skills/dhpk-skill-quality-judge', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
    ],
  };
  const out = tmpDir('dhpk-native-regenerate-drop-');
  try {
    materializeNativePackage({ inventory: firstInventory, root: ROOT, outDir: out });
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-skill-quality-judge')));

    // skill-judge is de-listed from codex-native between releases.
    const secondInventory = {
      skills: [{ id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
    };
    const result = materializeNativePackage({ inventory: secondInventory, root: ROOT, outDir: out });

    assert.deepStrictEqual(result.skillIds, ['tdd']);
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-tdd-workflow')), 'tdd must remain');
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-skill-quality-judge')), 'stale skill-judge directory must be removed on regeneration');
    assert.deepStrictEqual(Object.keys(result.fingerprints), ['dhpk-tdd-workflow']);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('rematerializing a selected skill removes files deleted from its canonical source', () => {
  const root = tmpDir('dhpk-native-regenerate-file-root-');
  const out = tmpDir('dhpk-native-regenerate-file-out-');
  const inventory = {
    skills: [{ id: 'example', name: 'dhpk-example-skill', path: 'skills/dhpk-example-skill', lifecycle: 'promoted', surfaces: ['codex-native'] }],
  };
  try {
    const source = path.join(root, 'skills', 'dhpk-example-skill');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: dhpk-example-skill\n---\n');
    fs.writeFileSync(path.join(source, 'retired.md'), 'remove me\n');
    materializeNativePackage({ inventory, root, outDir: out });
    assert.ok(fs.existsSync(path.join(out, 'skills', 'dhpk-example-skill', 'retired.md')));

    fs.rmSync(path.join(source, 'retired.md'));
    const result = materializeNativePackage({ inventory, root, outDir: out });
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'dhpk-example-skill', 'retired.md')),
      'a deleted canonical file must not survive in the selected destination');
    assert.deepStrictEqual(result.skillNames, ['dhpk-example-skill']);
    assert.ok(fs.existsSync(path.join(out, 'provenance.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('materialization rejects a symlinked output root instead of writing through it', () => {
  const parent = tmpDir('dhpk-native-symlink-root-');
  const actual = path.join(parent, 'actual');
  const linked = path.join(parent, 'linked');
  const inventory = {
    skills: [{ id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['codex-native'] }],
  };
  try {
    fs.mkdirSync(actual);
    fs.symlinkSync(actual, linked, 'dir');
    assert.throws(() => materializeNativePackage({ inventory, root: ROOT, outDir: linked }), /symlinked output root/i);
    assert.deepStrictEqual(fs.readdirSync(actual), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('materialization rejects a symlinked output ancestor before it can write outside the lexical root', () => {
  const parent = tmpDir('dhpk-native-symlink-ancestor-');
  const external = path.join(parent, 'external');
  const linkedParent = path.join(parent, 'plugins');
  const inventory = {
    skills: [{ id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['codex-native'] }],
  };
  try {
    fs.mkdirSync(external);
    fs.symlinkSync(external, linkedParent, 'dir');
    const outDir = path.join(linkedParent, 'dhpk');
    assert.throws(() => materializeNativePackage({ inventory, root: ROOT, outDir }), /symlinked output root|symlinked output ancestor/i);
    assert.deepStrictEqual(fs.readdirSync(external), []);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('generation is deterministic: two materializations of the same inventory produce identical fingerprints and provenance', () => {
  const inventory = {
    skills: [{ id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }],
  };
  const outA = tmpDir('dhpk-native-a-');
  const outB = tmpDir('dhpk-native-b-');
  try {
    const a = materializeNativePackage({ inventory, root: ROOT, outDir: outA, version: '1.2.3', sourceCommit: 'abc123' });
    const b = materializeNativePackage({ inventory, root: ROOT, outDir: outB, version: '1.2.3', sourceCommit: 'abc123' });
    assert.deepStrictEqual(a.fingerprints, b.fingerprints);
    assert.deepStrictEqual(a.provenance, b.provenance);
    assert.strictEqual(fingerprintDir(path.join(outA, 'skills', 'dhpk-tdd-workflow')), fingerprintDir(path.join(outB, 'skills', 'dhpk-tdd-workflow')));
  } finally {
    fs.rmSync(outA, { recursive: true, force: true });
    fs.rmSync(outB, { recursive: true, force: true });
  }
});

test('fingerprint traversal rejects excessive directory depth before unbounded recursion', () => {
  const root = tmpDir('dhpk-native-fingerprint-depth-');
  try {
    let current = root;
    for (let depth = 0; depth < 4; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'SKILL.md'), 'bounded\n');
    assert.throws(
      () => fingerprintDir(root, { maxDepth: 2 }),
      /maximum directory depth/i,
    );
    assert.throws(
      () => fingerprintDir(root, { maxBytes: 1 }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native projection uses one byte budget across all selected skills', () => {
  const root = tmpDir('dhpk-native-aggregate-budget-');
  const out = tmpDir('dhpk-native-aggregate-budget-out-');
  const body = 'x'.repeat(180);
  try {
    for (const [id, name] of [['one', 'dhpk-one'], ['two', 'dhpk-two']]) {
      const skill = path.join(root, 'skills', name);
      fs.mkdirSync(skill, { recursive: true });
      fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${name}\n---\n${body}\n`);
    }
    const inventory = {
      skills: [
        { id: 'one', name: 'dhpk-one', path: 'skills/dhpk-one', surfaces: ['codex-native'] },
        { id: 'two', name: 'dhpk-two', path: 'skills/dhpk-two', surfaces: ['codex-native'] },
      ],
    };
    assert.throws(
      () => compileNativePackage({ inventory, root, outDir: out, traversalOptions: { maxBytes: 700 } }),
      /byte budget/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('native fingerprinting rejects symlink entries before following external targets', () => {
  const root = tmpDir('dhpk-native-fingerprint-symlink-');
  const outside = tmpDir('dhpk-native-fingerprint-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'secret.md'), 'outside\n');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
    assert.throws(() => fingerprintDir(root), /symlink/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('native verifier rejects symlinked package roots and ancestors before reading the package', () => {
  const realParent = tmpDir('dhpk-native-verify-root-');
  const packageRoot = path.join(realParent, 'package');
  fs.mkdirSync(packageRoot);
  const linkParent = path.join(tmpDir('dhpk-native-verify-parent-'), 'linked-parent');
  const linkedRoot = path.join(linkParent, 'package');
  const rootLink = path.join(tmpDir('dhpk-native-verify-link-'), 'root-link');
  try {
    fs.symlinkSync(realParent, linkParent, 'dir');
    fs.symlinkSync(packageRoot, rootLink, 'dir');
    for (const candidate of [linkedRoot, rootLink]) {
      const result = verifyNativePackage({ packageRoot: candidate });
      assert.strictEqual(result.ok, false);
      assert.match(result.errors.join('\n'), /symlinked native package root ancestor|physical native package root/i);
    }
  } finally {
    fs.rmSync(realParent, { recursive: true, force: true });
    fs.rmSync(path.dirname(linkParent), { recursive: true, force: true });
    fs.rmSync(path.dirname(rootLink), { recursive: true, force: true });
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
    assert.strictEqual(provenance.selectedSkillNames.length, 15);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(out, 'skills')).sort(),
      provenance.selectedSkillNames,
      'native directory names must equal sorted public names from provenance'
    );
    assert.ok(provenance.sourceCommit && provenance.sourceCommit !== 'unknown');
    assert.ok(provenance.inventoryDigest);
    assert.ok(provenance.generatorVersion);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

run('gen-codex-native-package');
