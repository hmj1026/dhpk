'use strict';

// Task 5.4: prove rollback. design.md's Migration Plan step 7: "Roll back by
// restoring the previous generated manifest from the same inventory revision;
// canonical skill sources remain untouched." generateClaudeSkillRoots() is a
// PURE function of an inventory object (no fs access — see
// scripts/lib/distribution-inventory.js), so "the prior inventory revision" is
// just an older JSON blob (in practice `git show <rev>:manifests/distribution-inventory.json`);
// regenerating from it reproduces the old manifest without touching, deleting,
// or restoring any canonical skill source file on disk.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { generateClaudeSkillRoots, compileClaudeProjection } = require('../scripts/lib/distribution-inventory');
const { materializeDistribution } = require('../scripts/lib/distribution-compiler');
const { materializeAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
const { materializeNativePackage } = require('../scripts/lib/codex-native-package');
const { materializeCursorPackage } = require('../scripts/lib/cursor-plugin-package');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');

const ROOT = path.join(__dirname, '..');

const priorInventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const priorGenerated = generateClaudeSkillRoots(priorInventory);

function snapshotTree(root, relative = '') {
  const snapshot = {};
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative, entry.name);
    const absolute = path.join(root, child);
    if (entry.isDirectory()) Object.assign(snapshot, snapshotTree(root, child));
    else if (entry.isFile()) snapshot[child] = { mode: fs.statSync(absolute).mode & 0o7777, content: fs.readFileSync(absolute) };
    else snapshot[child] = { type: entry.isSymbolicLink() ? 'symlink' : 'other' };
  }
  return snapshot;
}

test('the prior inventory revision regenerates exactly the currently-committed plugin.json roots', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.deepStrictEqual([...priorGenerated.roots].sort(), [...plugin.skills].sort());
});

// Simulate a later change: deprecate fastapi's only skill. The v2 topology
// registers one flat Claude root, so the root remains while the generated
// promoted skill-id set drops the deprecated entry.
const laterInventory = JSON.parse(JSON.stringify(priorInventory));
const fastapiSkill = laterInventory.skills.find((s) => s.id === 'fastapi-pro');
fastapiSkill.lifecycle = 'deprecated';
fastapiSkill.deprecation = {
  since: '2026-07-27',
  compatibilityWindowEnds: '2026-10-27',
  migrationNote: 'Rollback-proof fixture only — not a real deprecation.',
};
const laterGenerated = generateClaudeSkillRoots(laterInventory);

test('the later (deprecated) inventory revision drops the skill from promotion without removing the flat root', () => {
  assert.ok(priorGenerated.roots.includes('./skills/'));
  assert.ok(laterGenerated.roots.includes('./skills/'));
  assert.ok(!laterGenerated.generatedSkillIds.includes('fastapi-pro'));
});

test('rollback: regenerating from the prior revision again reproduces the original root set, without any canonical source having been touched', () => {
  const canonicalSourcePath = path.join(ROOT, 'skills', 'dhpk-fastapi-pro', 'SKILL.md');
  // The canonical source was never deleted by generation in either direction —
  // only the (in-memory, test-local) inventory copy's lifecycle metadata
  // changed. Rollback never needs a restore step because nothing was removed.
  assert.ok(fs.existsSync(canonicalSourcePath), 'canonical fastapi-pro/SKILL.md must remain on disk throughout');

  const rolledBackGenerated = generateClaudeSkillRoots(priorInventory);
  assert.deepStrictEqual(rolledBackGenerated, priorGenerated);
  assert.ok(rolledBackGenerated.roots.includes('./skills/'));
});

test('failed Claude inventory reconciliation retains the previously accepted generated view', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-rollback-source-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-rollback-output-'));
  const output = path.join(outputParent, 'claude');
  try {
    const inventory = {
      schema: 'dhpk.distribution-inventory.v1',
      skills: [{ id: 'stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['claude-core'] }],
      modules: [],
    };
    const projection = compileClaudeProjection({ inventory });
    assert.strictEqual(projection.ok, true, projection.error && projection.error.message);
    const store = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
    const first = materializeDistribution(projection.plan, projection.adapter, store);
    assert.strictEqual(first.ok, true, first.error && first.error.message);
    const before = snapshotTree(output);

    const failingStore = {
      begin(plan) {
        const session = store.begin(plan);
        const write = session.write;
        let writes = 0;
        session.write = (entry) => {
          writes += 1;
          if (writes === 2) throw new Error('synthetic Claude inventory staging failure');
          return write(entry);
        };
        return session;
      },
    };
    const failed = materializeDistribution(projection.plan, projection.adapter, failingStore);
    assert.strictEqual(failed.ok, false);
    assert.match(failed.error.message, /synthetic Claude inventory staging failure/);
    assert.deepStrictEqual(snapshotTree(output), before);
    assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test('failed Agent Plugin staging retains the previously accepted package tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-rollback-source-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-rollback-output-'));
  const output = path.join(outputParent, 'agent');
  try {
    const skillRoot = path.join(root, 'skills', 'dhpk-stable');
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\ndescription: Stable\n---\n\nStable body.\n');
    const inventory = {
      skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
    };
    materializeAgentPluginPackage({ inventory, root, outDir: output, sourceCommit: '1111111111111111111111111111111111111111' });
    const beforeManifest = fs.readFileSync(path.join(output, 'plugin.json'));
    const beforeSkill = fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md'));

    const realStore = new ProjectionArtifactStore({
      root: outputParent,
      sourceRoot: root,
      publishRoot: output,
    });
    const failingStore = {
      begin(plan) {
        const session = realStore.begin(plan);
        const write = session.write;
        let writes = 0;
        session.write = (entry) => {
          writes += 1;
          if (writes === 2) throw new Error('synthetic Agent Plugin staging failure');
          return write(entry);
        };
        return session;
      },
    };
    assert.throws(
      () => materializeAgentPluginPackage({ inventory, root, outDir: output, artifactStore: failingStore }),
      /synthetic Agent Plugin staging failure/,
    );
    assert.deepStrictEqual(fs.readFileSync(path.join(output, 'plugin.json')), beforeManifest);
    assert.deepStrictEqual(fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md')), beforeSkill);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test('failed Codex native staging retains the previously accepted package tree and diagnostic cause', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-rollback-source-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-rollback-output-'));
  const output = path.join(outputParent, 'dhpk');
  try {
    const skillRoot = path.join(root, 'skills', 'dhpk-stable');
    fs.mkdirSync(path.join(skillRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\n---\n\nStable body.\n');
    const script = path.join(skillRoot, 'bin', 'run.sh');
    fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.chmodSync(script, 0o755);
    const inventory = {
      skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['codex-native'] }],
    };
    materializeNativePackage({ inventory, root, outDir: output, name: 'dhpk', version: '1.0.0', sourceCommit: '1'.repeat(40) });
    const beforeManifest = fs.readFileSync(path.join(output, '.codex-plugin', 'plugin.json'));
    const beforeSkill = fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md'));
    const beforeTree = snapshotTree(output);
    const beforeMode = fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777;

    const realStore = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
    const failingStore = {
      begin(plan) {
        const session = realStore.begin(plan);
        const write = session.write;
        let writes = 0;
        session.write = (entry) => {
          writes += 1;
          if (writes === 2) {
            const error = new Error('synthetic Codex native staging failure');
            error.projectionCode = 'CODEX_NATIVE_STAGE_FAILED';
            throw error;
          }
          return write(entry);
        };
        return session;
      },
    };
    assert.throws(
      () => materializeNativePackage({ inventory, root, outDir: output, artifactStore: failingStore }),
      /synthetic Codex native staging failure/,
    );
    assert.deepStrictEqual(fs.readFileSync(path.join(output, '.codex-plugin', 'plugin.json')), beforeManifest);
    assert.deepStrictEqual(fs.readFileSync(path.join(output, 'skills', 'dhpk-stable', 'SKILL.md')), beforeSkill);
    assert.deepStrictEqual(snapshotTree(output), beforeTree);
    assert.strictEqual(fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777, beforeMode);
    assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

test('failed Cursor staging retains the previously accepted package tree and executable modes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-rollback-source-'));
  const outputParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-cursor-rollback-output-'));
  const output = path.join(outputParent, 'dhpk-cursor');
  try {
    const skillRoot = path.join(root, 'skills', 'dhpk-stable');
    fs.mkdirSync(path.join(skillRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: dhpk-stable\ndescription: Stable\n---\n\nStable body.\n');
    const script = path.join(skillRoot, 'bin', 'run.sh');
    fs.writeFileSync(script, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.chmodSync(script, 0o755);
    const inventory = {
      skills: [{ id: 'stable', name: 'dhpk-stable', path: 'skills/dhpk-stable', lifecycle: 'promoted', surfaces: ['cursor-plugin'] }],
    };
    materializeCursorPackage({ inventory, root, outDir: output, sourceCommit: '1'.repeat(40) });
    const beforeTree = snapshotTree(output);
    const beforeMode = fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777;

    const realStore = new ProjectionArtifactStore({ root: outputParent, sourceRoot: root, publishRoot: output });
    const failingStore = {
      begin(plan) {
        const session = realStore.begin(plan);
        const write = session.write;
        let writes = 0;
        session.write = (entry) => {
          writes += 1;
          if (writes === 2) throw new Error('synthetic Cursor staging failure');
          return write(entry);
        };
        return session;
      },
    };
    assert.throws(
      () => materializeCursorPackage({ inventory, root, outDir: output, artifactStore: failingStore }),
      /synthetic Cursor staging failure/,
    );
    assert.deepStrictEqual(snapshotTree(output), beforeTree);
    assert.strictEqual(fs.statSync(path.join(output, 'skills', 'dhpk-stable', 'bin', 'run.sh')).mode & 0o7777, beforeMode);
    assert.deepStrictEqual(fs.readdirSync(outputParent).filter((entry) => entry.startsWith('.projection-stage-')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outputParent, { recursive: true, force: true });
  }
});

run('distribution-rollback-proof');
