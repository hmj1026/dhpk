'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');

test('gen-agents-skills CLI materializes a project-local compatibility tree', () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, '.agents-skills-cli-'));
  try {
    const result = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote 55 selected skills/);
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
    const skillPath = 'flow-guide/SKILL.md';
    const skillFile = path.join(outDir, skillPath);
    assert.strictEqual(receipt.schema, 'dhpk.agents-skills-projection.v1');
    assert.strictEqual(receipt.selectionSurface, 'agent-plugin');
    assert.ok(receipt.selectedIds.includes('flow-guide'), 'receipt must bind the selected skill identity');
    assert.ok(receipt.managedPaths.includes(skillPath), 'receipt must own the representative generated path');
    assert.match(receipt.generatedFingerprints[skillPath], /^[a-f0-9]{64}$/,
      'receipt must fingerprint the generated skill file');
    assert.ok(fs.existsSync(skillFile));
    assert.match(fs.readFileSync(skillFile, 'utf8'), /^name: flow-guide$/m);
    assert.ok(fs.existsSync(path.join(outDir, 'flow-guide.md')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI can materialize outside the canonical source checkout', () => {
  const projectRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-agents-skills-cli-project-'));
  try {
    const result = spawnSync(process.execPath, [
      GENERATOR,
      '--source-root', ROOT,
      '--project-root', projectRoot,
      '--profile', 'portable-core',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const agentRoot = path.join(projectRoot, '.agents');
    const receipt = JSON.parse(fs.readFileSync(path.join(agentRoot, '.dhpk-installed.json'), 'utf8'));
    const skillPath = 'flow-guide/SKILL.md';
    const skillFile = path.join(agentRoot, 'skills', skillPath);
    assert.strictEqual(receipt.schema, 'dhpk.project-agent-projection-receipt.v1');
    assert.strictEqual(receipt.profileId, 'portable-core');
    assert.match(receipt.profileFingerprint, /^[a-f0-9]{64}$/);
    assert.match(receipt.selectionFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(receipt.selectedIds.includes('flow-guide'));
    assert.ok(receipt.emittedIds.includes('flow-guide'));
    assert.ok(receipt.managedPaths.includes(skillPath));
    assert.match(receipt.generatedFingerprints[skillPath], /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(skillFile));
    assert.match(fs.readFileSync(skillFile, 'utf8'), /^name: flow-guide$/m);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('gen-agents-skills');
