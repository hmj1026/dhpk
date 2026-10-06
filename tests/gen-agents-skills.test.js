'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { selectPortableSkills } = require('../scripts/lib/agent-plugin-package');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');

function expectedAgentPluginSkillIds() {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  return selectPortableSkills(inventory, 'agent-plugin').map((skill) => skill.id).sort();
}

test('gen-agents-skills CLI materializes a project-local compatibility tree', () => {
  const outDir = fs.mkdtempSync(path.join(ROOT, '.agents-skills-cli-'));
  try {
    const result = spawnSync(process.execPath, [GENERATOR, '--repo-root', ROOT, '--out-dir', outDir], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
    const selectedIds = expectedAgentPluginSkillIds();
    assert.deepStrictEqual(receipt.selectedIds, selectedIds,
      'projection receipt must match the current Agent Plugin selection');
    assert.match(result.stdout, new RegExp(`wrote ${selectedIds.length} selected skills`));
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

function projectWithClaudeSkillsAlias(target) {
  const projectRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-agents-skills-cli-alias-'));
  fs.mkdirSync(path.join(projectRoot, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'elsewhere'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.symlinkSync(target, path.join(projectRoot, '.claude', 'skills'), 'dir');
  return projectRoot;
}

function projectProjection(projectRoot, hosts) {
  return spawnSync(process.execPath, [
    GENERATOR,
    '--source-root', ROOT,
    '--project-root', projectRoot,
    '--profile', 'portable-core',
    ...hosts.flatMap((host) => ['--host', host]),
    '--update',
  ], { cwd: ROOT, encoding: 'utf8' });
}

test('gen-agents-skills CLI explains a .claude/skills directory alias of the managed root', () => {
  const projectRoot = projectWithClaudeSkillsAlias('../.agents/skills');
  try {
    const result = projectProjection(projectRoot, ['claude', 'codex', 'cursor', 'agy']);
    assert.strictEqual(result.status, 1, result.stdout);
    assert.match(result.stderr, /directory symlink to the managed skill root/);
    assert.match(result.stderr, /omit --host claude/);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')), false,
      'a refused projection must not write the lifecycle receipt');
    assert.deepStrictEqual(fs.readdirSync(path.join(projectRoot, '.agents', 'skills')), [],
      'a refused projection must not publish managed skills through the alias');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI keeps refusing a .claude/skills symlink to an unmanaged directory', () => {
  const projectRoot = projectWithClaudeSkillsAlias('../elsewhere');
  try {
    const result = projectProjection(projectRoot, ['claude', 'codex']);
    assert.strictEqual(result.status, 1, result.stdout);
    assert.match(result.stderr, /is a symlink at candidate path/);
    assert.doesNotMatch(result.stderr, /managed skill root/);
    assert.deepStrictEqual(fs.readdirSync(path.join(projectRoot, 'elsewhere')), []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI projects non-Claude hosts beside a .claude/skills directory alias', () => {
  const projectRoot = projectWithClaudeSkillsAlias('../.agents/skills');
  try {
    const result = projectProjection(projectRoot, ['codex', 'cursor', 'agy']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.lstatSync(path.join(projectRoot, '.claude', 'skills')).isSymbolicLink(),
      'the consumer-owned alias must be left in place');
    assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'flow-guide', 'SKILL.md')),
      'the alias exposes the shared artifact to Claude without per-skill bindings');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('gen-agents-skills');
