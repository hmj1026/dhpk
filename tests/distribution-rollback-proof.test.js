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
const { generateClaudeSkillRoots } = require('../scripts/lib/distribution-inventory');
const { materializeAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
const { ProjectionArtifactStore } = require('../scripts/lib/projection-artifact-store');

const ROOT = path.join(__dirname, '..');

const priorInventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const priorGenerated = generateClaudeSkillRoots(priorInventory);

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

run('distribution-rollback-proof');
