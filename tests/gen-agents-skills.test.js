'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { selectPortableSkills } = require('../scripts/lib/agent-plugin-package');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
} = require('../scripts/lib/agents-skills-package');
const { fingerprint } = require('../scripts/lib/distribution-projection-contract');

const ROOT = path.join(__dirname, '..');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js');
const VALIDATOR = path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js');

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
    assert.strictEqual(receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
    assert.ok(receipt.selectedIdentities.some((entry) => entry.entityKind === 'skill' && entry.stableId === 'library-author'));
    assert.ok(receipt.emittedIdentities.every((entry) => entry.entityKind === 'skill'));
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

test('gen-agents-skills CLI updates a v1 receipt with a retired selected-only identity', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-skills-retired-v1-'));
  const args = ['--source-root', ROOT, '--project-root', projectRoot, '--profile', 'portable-core', '--host', 'codex'];
  try {
    const seeded = spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(seeded.status, 0, seeded.stderr);
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    const legacy = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    legacy.schema = 'dhpk.project-agent-projection-receipt.v1';
    delete legacy.selectedIdentities;
    delete legacy.emittedIdentities;
    legacy.entries = legacy.entries.map(({ entityKind, ...entry }) => entry);
    legacy.sourceFingerprints = Object.fromEntries(legacy.entries.map((entry) => [entry.stableId, entry.sourceFingerprint]));
    legacy.selectedIds.push('retired-selected-only-fixture');
    delete legacy.receiptFingerprint;
    legacy.receiptFingerprint = fingerprint(legacy);
    fs.writeFileSync(receiptPath, JSON.stringify(legacy));

    const updated = spawnSync(process.execPath, [GENERATOR, ...args, '--update'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(updated.status, 0, updated.stderr);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
    assert.ok(!receipt.selectedIds.includes('retired-selected-only-fixture'));
    assert.ok(!receipt.selectedIdentities.some((entry) => entry.stableId === 'retired-selected-only-fixture'));
    assert.ok(receipt.emittedIdentities.some((entry) => entry.entityKind === 'skill' && entry.stableId === 'flow-guide'));
    const checked = spawnSync(process.execPath, [VALIDATOR, '--source-root', ROOT, '--project-root', projectRoot], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(checked.status, 0, checked.stderr);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI updates a v2 receipt with preserved legacy Claude bindings', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-skills-preserved-claude-v2-'));
  const args = [
    '--source-root', ROOT,
    '--project-root', projectRoot,
    '--profile', 'portable-core',
    '--host', 'claude',
    '--host', 'codex',
  ];
  const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
  try {
    const seeded = spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(seeded.status, 0, seeded.stderr);
    const legacy = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    legacy.schema = 'dhpk.project-agent-projection-receipt.v2';
    legacy.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
    legacy.hostBindings.claude.discovery.paths.forEach((entry, index) => {
      legacy.bindingPaths.claude[index].target = legacy.bindingPaths.claude[index].target
        .replace('../../.agents/claude-skills/', '../../.agents/skills/');
      const bindingPath = path.join(projectRoot, entry);
      fs.unlinkSync(bindingPath);
      fs.symlinkSync(legacy.bindingPaths.claude[index].target, bindingPath);
    });
    legacy.bindings.claude = JSON.parse(JSON.stringify(legacy.hostBindings.claude));
    delete legacy.receiptFingerprint;
    legacy.receiptFingerprint = fingerprint(legacy);
    fs.writeFileSync(receiptPath, JSON.stringify(legacy));

    const updated = spawnSync(process.execPath, [GENERATOR, ...args.slice(0, -2), '--host', 'codex', '--update'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(updated.status, 0, `${updated.stdout || ''}\n${updated.stderr || ''}`);
    const migrated = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(migrated.schema, 'dhpk.project-agent-projection-receipt.v3');
    assert.strictEqual(migrated.hostBindings.claude.discovery.sourceRoot, '.agents/claude-skills');
    assert.ok(migrated.bindingPaths.claude.every(({ target }) => target.startsWith('../../.agents/claude-skills/')));
    const checked = spawnSync(process.execPath, [
      VALIDATOR, '--source-root', ROOT, '--project-root', projectRoot,
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(checked.status, 0, `${checked.stdout || ''}\n${checked.stderr || ''}`);
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
    assert.match(result.stderr, /directory symlink to a managed skill root/);
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

function cliHelpFixture(prefix) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), prefix));
  const sourceRoot = path.join(root, 'source-without-inventory');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'keep.txt'), 'preserve this project content\n');
  return { root, sourceRoot, projectRoot };
}

function cliHelpFixtureSnapshot(fixture) {
  return {
    sourceEntries: fs.readdirSync(fixture.sourceRoot).sort(),
    inventoryExists: fs.existsSync(path.join(fixture.sourceRoot, 'manifests', 'distribution-inventory.json')),
    projectEntries: fs.readdirSync(fixture.projectRoot).sort(),
    marker: fs.readFileSync(path.join(fixture.projectRoot, 'keep.txt'), 'utf8'),
  };
}

function invokeCli(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

function assertCliHelpListsOptions(results, flags) {
  for (const { flag, result } of results) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.match(output, /usage:/i, `${flag} should print usage`);
    for (const supportedFlag of flags) {
      assert.ok(output.includes(supportedFlag), `${flag} help should list ${supportedFlag}`);
    }
    assert.ok(!output.includes('--target-dir'), `${flag} help should not list the stale --target-dir option`);
  }
}

test('gen-agents-skills CLI help aliases succeed without inventory or lifecycle side effects', () => {
  const fixture = cliHelpFixture('dhpk-gen-agents-skills-help-');
  const before = cliHelpFixtureSnapshot(fixture);
  try {
    const results = ['--help', '-h'].map((flag) => ({
      flag,
      result: invokeCli(GENERATOR, [
        '--source-root', fixture.sourceRoot,
        '--project-root', fixture.projectRoot,
        flag,
      ], fixture.root),
    }));
    assert.deepStrictEqual(cliHelpFixtureSnapshot(fixture), before,
      'help must leave the source and project trees unchanged');
    assert.deepStrictEqual(results.map(({ result }) => result.status), [0, 0],
      results.map(({ flag, result }) => `${flag}: ${result.stderr || result.stdout}`).join('\n'));
    assertCliHelpListsOptions(results, [
      '-h', '--help', '--repo-root', '--source-root', '--project-root', '--out-dir', '--profile', '--host',
      '--update', '--adopt', '--repair', '--uninstall', '--rollback',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('validate-agents-skills CLI help aliases succeed without inventory or lifecycle side effects', () => {
  const fixture = cliHelpFixture('dhpk-validate-agents-skills-help-');
  const before = cliHelpFixtureSnapshot(fixture);
  try {
    const results = ['--help', '-h'].map((flag) => ({
      flag,
      result: invokeCli(VALIDATOR, [
        '--source-root', fixture.sourceRoot,
        '--project-root', fixture.projectRoot,
        flag,
      ], fixture.root),
    }));
    assert.deepStrictEqual(cliHelpFixtureSnapshot(fixture), before,
      'help must leave the source and project trees unchanged');
    assert.deepStrictEqual(results.map(({ result }) => result.status), [0, 0],
      results.map(({ flag, result }) => `${flag}: ${result.stderr || result.stdout}`).join('\n'));
    assertCliHelpListsOptions(results, [
      '-h', '--help', '--repo-root', '--source-root', '--project-root', '--out-dir',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('gen-agents-skills CLI still exits nonzero for unknown options', () => {
  const projectRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-gen-agents-skills-unknown-'));
  try {
    const result = invokeCli(GENERATOR, [
      '--source-root', ROOT,
      '--project-root', projectRoot,
      '--profile', 'portable-core',
      '--unknown-option',
    ], ROOT);
    assert.notStrictEqual(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('validate-agents-skills CLI still exits nonzero for unknown options', () => {
  const tempRoot = fs.mkdtempSync(path.join(ROOT, '.agents-skills-validator-unknown-'));
  const outDir = path.join(tempRoot, 'projection');
  try {
    const generated = invokeCli(GENERATOR, ['--repo-root', ROOT, '--out-dir', outDir], ROOT);
    assert.strictEqual(generated.status, 0, `${generated.stdout || ''}\n${generated.stderr || ''}`);
    const result = invokeCli(VALIDATOR, [
      '--repo-root', ROOT,
      '--out-dir', outDir,
      '--unknown-option',
    ], ROOT);
    assert.notStrictEqual(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

const RETIREMENT_ACTIVE = {
  id: 'active',
  name: 'dhpk-active-skill',
  path: 'skills/dhpk-active-skill',
  lifecycle: 'promoted',
  surfaces: ['agent-plugin'],
};

const RETIREMENT_RETIRED = {
  id: 'retired',
  name: 'dhpk-retired-skill',
  path: 'skills/dhpk-retired-skill',
  lifecycle: 'promoted',
  surfaces: ['agent-plugin'],
};

function retirementTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-skills-retirement-'));
}

function retirementWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function retirementRecord(overrides = {}) {
  return {
    id: RETIREMENT_RETIRED.id,
    name: RETIREMENT_RETIRED.name,
    canonicalPath: RETIREMENT_RETIRED.path,
    priorSurfaces: ['agent-plugin'],
    retiredIn: '0.54.0',
    reasonCode: 'test-retirement',
    replacements: [{ kind: 'skill', id: RETIREMENT_ACTIVE.id, mode: 'fixture-successor' }],
    rollback: { release: '0.53.0' },
    ...overrides,
  };
}

function retirementInventory(skills, retiredSkills = []) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills,
    surface_membership: {
      'agent-plugin': skills.filter((skill) => skill.surfaces.includes('agent-plugin')).map((skill) => skill.id),
    },
    retired_skills: retiredSkills,
  };
}

function retirementReadReceipt(outDir) {
  return JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
}

function retirementSnapshotTree(directory) {
  const entries = [];
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const child = path.posix.join(relative, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        entries.push([child, `symlink:${fs.readlinkSync(absolute)}`]);
      } else if (stat.isDirectory()) {
        walk(absolute, child);
      } else {
        entries.push([child, fs.readFileSync(absolute, 'utf8')]);
      }
    }
  };
  walk(directory, '');
  return entries;
}

function retirementMakeFixture({ previouslySelected = true } = {}) {
  const root = retirementTmpDir();
  const outDir = path.join(root, '.agents', 'skills');
  const priorInventory = retirementInventory(previouslySelected ? [RETIREMENT_ACTIVE, RETIREMENT_RETIRED] : [RETIREMENT_ACTIVE]);
  const currentInventory = retirementInventory([RETIREMENT_ACTIVE], [retirementRecord()]);

  retirementWrite(path.join(root, RETIREMENT_ACTIVE.path, 'SKILL.md'), [
    '---',
    `name: ${RETIREMENT_ACTIVE.name}`,
    "description: 'Active fixture skill.'",
    '---',
    '# Active skill',
    '',
  ].join('\n'));
  retirementWrite(path.join(root, RETIREMENT_ACTIVE.path, 'references', 'guide.md'), '# Active guide\n');
  retirementWrite(path.join(root, RETIREMENT_RETIRED.path, 'SKILL.md'), [
    '---',
    `name: ${RETIREMENT_RETIRED.name}`,
    "description: 'Retired fixture skill.'",
    '---',
    '# Retired skill',
    '',
  ].join('\n'));
  retirementWrite(path.join(root, RETIREMENT_RETIRED.path, 'references', 'guide.md'), '# Retired guide\n');
  retirementWrite(path.join(root, RETIREMENT_RETIRED.path, 'scripts', 'check.sh'), '#!/bin/sh\n');

  materializeAgentsSkillsProjection({ root, inventory: priorInventory, outDir });

  if (previouslySelected) {
    const receipt = retirementReadReceipt(outDir);
    receipt.selectedIds = receipt.selectedIds.filter((id) => id !== RETIREMENT_RETIRED.id);
    fs.writeFileSync(path.join(outDir, '.dhpk-projection.json'), `${JSON.stringify(receipt)}\n`);
  }

  fs.rmSync(path.join(root, RETIREMENT_RETIRED.path), { recursive: true, force: true });
  return { root, outDir, currentInventory };
}

function retirementMaterializeCurrent(fixture, options = {}) {
  return materializeAgentsSkillsProjection({
    root: fixture.root,
    inventory: fixture.currentInventory,
    outDir: fixture.outDir,
    allowCanonicalChanges: true,
    ...options,
  });
}

function assertRejectedWithoutPublication(fixture, diagnostic) {
  const before = retirementSnapshotTree(fixture.outDir);
  const receiptPath = path.join(fixture.outDir, '.dhpk-projection.json');
  const receiptBefore = fs.readFileSync(receiptPath, 'utf8');

  assert.throws(() => retirementMaterializeCurrent(fixture), diagnostic);

  assert.deepStrictEqual(retirementSnapshotTree(fixture.outDir), before, 'a rejected retirement must preserve all installed bytes and paths');
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'a rejected retirement must preserve the receipt');
}

test('owned unchanged retired output is removed from the package and receipt', () => {
  const fixture = retirementMakeFixture();
  const retiredDir = path.join(fixture.outDir, RETIREMENT_RETIRED.name);
  const retiredShim = path.join(fixture.outDir, `${RETIREMENT_RETIRED.name}.md`);
  try {
    const oldReceipt = retirementReadReceipt(fixture.outDir);
    const oldEntry = oldReceipt.entries.find((entry) => entry.id === RETIREMENT_RETIRED.id);
    assert.ok(oldEntry, 'the carried retired identity must have a receipt entry');
    assert.ok(Array.isArray(oldEntry.sourceFiles), 'the receipt must retain its source manifest');
    assert.ok(oldReceipt.managedPaths.includes(`${RETIREMENT_RETIRED.name}/SKILL.md`));
    assert.ok(oldReceipt.generatedFingerprints[`${RETIREMENT_RETIRED.name}/SKILL.md`]);
    assert.ok(!oldReceipt.selectedIds.includes(RETIREMENT_RETIRED.id), 'the carried retired identity is absent from current selection');

    retirementWrite(path.join(fixture.root, RETIREMENT_ACTIVE.path, 'references', 'guide.md'), '# Updated active guide\n');
    retirementWrite(path.join(fixture.outDir, 'unmanaged', 'keep.md'), '# User-owned\n');

    const result = retirementMaterializeCurrent(fixture);

    assert.deepStrictEqual(result.selectedIds, [RETIREMENT_ACTIVE.id]);
    assert.strictEqual(fs.existsSync(retiredDir), false);
    assert.strictEqual(fs.existsSync(retiredShim), false);
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.outDir, RETIREMENT_ACTIVE.name, 'references', 'guide.md'), 'utf8'),
      '# Updated active guide\n',
    );
    assert.strictEqual(fs.readFileSync(path.join(fixture.outDir, 'unmanaged', 'keep.md'), 'utf8'), '# User-owned\n');

    const receipt = retirementReadReceipt(fixture.outDir);
    assert.deepStrictEqual(receipt.selectedIds, [RETIREMENT_ACTIVE.id]);
    assert.ok(!receipt.entries.some((entry) => entry.id === RETIREMENT_RETIRED.id));
    assert.ok(!receipt.managedPaths.some((managedPath) => (
      managedPath === `${RETIREMENT_RETIRED.name}.md` || managedPath.startsWith(`${RETIREMENT_RETIRED.name}/`)
    )));
    assert.ok(!Object.keys(receipt.generatedFingerprints).some((managedPath) => (
      managedPath === `${RETIREMENT_RETIRED.name}.md` || managedPath.startsWith(`${RETIREMENT_RETIRED.name}/`)
    )));
    assert.strictEqual(validateAgentsSkillsProjection({ root: fixture.root, inventory: fixture.currentInventory, outDir: fixture.outDir }).ok, true);

    const firstUpdate = retirementSnapshotTree(fixture.outDir);
    retirementMaterializeCurrent(fixture);
    assert.deepStrictEqual(retirementSnapshotTree(fixture.outDir), firstUpdate, 'reconciliation remains deterministic on repeat');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('modified retired output is reported and preserved without publication', () => {
  const fixture = retirementMakeFixture();
  const changedPath = path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'references', 'guide.md');
  try {
    retirementWrite(changedPath, '# Local modification\n');
    assertRejectedWithoutPublication(fixture, /modified|fingerprint|conflict|orphan/i);
    assert.strictEqual(fs.readFileSync(changedPath, 'utf8'), '# Local modification\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retargeted retired output is reported and preserved without publication', () => {
  const fixture = retirementMakeFixture();
  const outside = retirementTmpDir();
  const target = path.join(outside, 'keep.md');
  const retiredGuide = path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'references', 'guide.md');
  try {
    retirementWrite(target, '# Outside user content\n');
    fs.rmSync(retiredGuide);
    fs.symlinkSync(target, retiredGuide);
    assertRejectedWithoutPublication(fixture, /symlink|retarget|conflict|orphan/i);
    assert.strictEqual(fs.lstatSync(retiredGuide).isSymbolicLink(), true);
    assert.strictEqual(fs.readlinkSync(retiredGuide), target);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '# Outside user content\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('missing receipt-owned retired output is reported without publication', () => {
  const fixture = retirementMakeFixture();
  const missingPath = path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'references', 'guide.md');
  try {
    fs.rmSync(missingPath);
    assertRejectedWithoutPublication(fixture, /missing|conflict|orphan/i);
    assert.strictEqual(fs.existsSync(missingPath), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unrecorded content inside a retired directory is reported and preserved', () => {
  const fixture = retirementMakeFixture();
  const unrecorded = path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'local-notes.md');
  try {
    retirementWrite(unrecorded, '# Keep this local file\n');
    assertRejectedWithoutPublication(fixture, /unrecorded|unowned|orphan|conflict/i);
    assert.strictEqual(fs.readFileSync(unrecorded, 'utf8'), '# Keep this local file\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retired ledger identity mismatches cannot authorize deleting installed output', () => {
  for (const [field, value] of [
    ['id', 'other-id'],
    ['name', 'dhpk-other-skill'],
    ['canonicalPath', 'skills/dhpk-other-skill'],
  ]) {
    const fixture = retirementMakeFixture();
    try {
      fixture.currentInventory.retired_skills[0] = {
        ...fixture.currentInventory.retired_skills[0],
        [field]: value,
      };
      assertRejectedWithoutPublication(fixture, /ledger|mismatch|conflict|orphan/i);
      assert.strictEqual(fs.existsSync(path.join(fixture.outDir, `${RETIREMENT_RETIRED.name}.md`)), true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('never-selected retired paths remain unowned and are preserved', () => {
  const fixture = retirementMakeFixture({ previouslySelected: false });
  const retiredSkill = path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'SKILL.md');
  const retiredShim = path.join(fixture.outDir, `${RETIREMENT_RETIRED.name}.md`);
  try {
    retirementWrite(retiredSkill, '# User-owned skill file\n');
    retirementWrite(retiredShim, '# User-owned shim\n');
    assertRejectedWithoutPublication(fixture, /unowned|ownership|orphan|conflict/i);
    assert.strictEqual(fs.readFileSync(retiredSkill, 'utf8'), '# User-owned skill file\n');
    assert.strictEqual(fs.readFileSync(retiredShim, 'utf8'), '# User-owned shim\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('partial retirement publication failure restores retired paths and receipt', () => {
  const fixture = retirementMakeFixture();
  const before = retirementSnapshotTree(fixture.outDir);
  const originalRenameSync = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = function renameWithRetirementFailure(from, to) {
      const source = path.resolve(String(from));
      const retiredRoot = path.resolve(fixture.outDir, RETIREMENT_RETIRED.name);
      const movingRetiredOutput = source === retiredRoot || source.startsWith(`${retiredRoot}${path.sep}`);
      const moved = originalRenameSync.call(this, from, to);
      if (movingRetiredOutput && !injected) {
        injected = true;
        throw new Error('injected retirement publish failure');
      }
      return moved;
    };

    assert.throws(() => retirementMaterializeCurrent(fixture), /injected retirement publish failure/);
    assert.ok(injected, 'failure injection must occur after a retired path has moved');
    fs.renameSync = originalRenameSync;
    assert.deepStrictEqual(retirementSnapshotTree(fixture.outDir), before);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('Claude and Cursor prior surfaces do not block receipt-owned cleanup', () => {
  const fixture = retirementMakeFixture();
  fixture.currentInventory.retired_skills[0] = retirementRecord({
    priorSurfaces: ['claude-core', 'cursor-sync'],
  });
  try {
    const result = retirementMaterializeCurrent(fixture);
    const receipt = retirementReadReceipt(fixture.outDir);
    const checked = validateAgentsSkillsProjection({
      root: fixture.root,
      inventory: fixture.currentInventory,
      outDir: fixture.outDir,
    });

    assert.deepStrictEqual(result.selectedIds, [RETIREMENT_ACTIVE.id]);
    assert.strictEqual(fs.existsSync(path.join(fixture.outDir, RETIREMENT_RETIRED.name)), false);
    assert.strictEqual(fs.existsSync(path.join(fixture.outDir, `${RETIREMENT_RETIRED.name}.md`)), false);
    assert.ok(!receipt.entries.some((entry) => entry.id === RETIREMENT_RETIRED.id));
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('malformed retired receipt proofs are rejected before publication', () => {
  const corruptions = [
    ['missing sourceFiles', (entry) => { delete entry.sourceFiles; }],
    ['null sourceFiles', (entry) => { entry.sourceFiles = null; }],
    ['null sourceFiles item', (entry) => { entry.sourceFiles[0] = null; }],
    ['bad digest', (entry) => { entry.sourceFiles[0].digest = 'bad'; }],
    ['duplicate path', (entry) => { entry.sourceFiles.push({ ...entry.sourceFiles[0] }); }],
    ['unsafe path', (entry) => { entry.sourceFiles.push({ path: '../escape', digest: '0'.repeat(64) }); }],
    ['missing SKILL.md', (entry) => { entry.sourceFiles = entry.sourceFiles.filter((file) => file.path !== 'SKILL.md'); }],
    ['managed set mismatch', (entry, receipt) => { receipt.managedPaths = receipt.managedPaths.filter((file) => file !== `${RETIREMENT_RETIRED.name}/SKILL.md`); }],
    ['source fingerprint mismatch', (entry) => { entry.sourceFingerprint = '0'.repeat(64); }],
  ];
  const failures = [];
  for (const [label, corrupt] of corruptions) {
    const fixture = retirementMakeFixture();
    try {
      const receipt = retirementReadReceipt(fixture.outDir);
      corrupt(receipt.entries.find((entry) => entry.id === RETIREMENT_RETIRED.id), receipt);
      fs.writeFileSync(path.join(fixture.outDir, '.dhpk-projection.json'), `${JSON.stringify(receipt)}\n`);
      try {
        assertRejectedWithoutPublication(fixture, /manifest|receipt|source|fingerprint|path|conflict|orphan|escapes/i);
      } catch (error) {
        failures.push(`${label}: ${error.message}`);
      }
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
  assert.deepStrictEqual(failures, []);
});

test('modified, missing, and symlinked retired shims are preserved', () => {
  for (const kind of ['modified', 'missing', 'symlink']) {
    const fixture = retirementMakeFixture();
    const outside = retirementTmpDir();
    const shim = path.join(fixture.outDir, `${RETIREMENT_RETIRED.name}.md`);
    const target = path.join(outside, 'keep.md');
    try {
      if (kind === 'modified') retirementWrite(shim, '# Local shim edit\n');
      if (kind === 'missing') fs.rmSync(shim);
      if (kind === 'symlink') { retirementWrite(target, '# Keep target\n'); fs.rmSync(shim); fs.symlinkSync(target, shim); }
      assertRejectedWithoutPublication(fixture, /shim|modified|missing|symlink|fingerprint|conflict|orphan|receipt/i);
      if (kind === 'modified') assert.strictEqual(fs.readFileSync(shim, 'utf8'), '# Local shim edit\n');
      if (kind === 'missing') assert.strictEqual(fs.existsSync(shim), false);
      if (kind === 'symlink') assert.strictEqual(fs.readFileSync(target, 'utf8'), '# Keep target\n');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('foreign Python cache artifacts inside retired output are preserved', () => {
  const fixture = retirementMakeFixture();
  const cacheFiles = [
    [path.join(fixture.outDir, RETIREMENT_RETIRED.name, '__pycache__', 'local.cpython-312.pyc'), 'local pycache bytes'],
    [path.join(fixture.outDir, RETIREMENT_RETIRED.name, 'local.pyc'), 'local pyc bytes'],
  ];
  try {
    for (const [file, bytes] of cacheFiles) retirementWrite(file, bytes);
    assertRejectedWithoutPublication(fixture, /unrecorded|unowned|orphan|conflict/i);
    for (const [file, bytes] of cacheFiles) assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// Historical identities and paths from the parent of removal commit 096cba21.
const HISTORICAL_GITNEXUS = [
  { id: 'gitnexus-cli', name: 'dhpk-gitnexus-cli', path: 'skills/dhpk-gitnexus-cli' },
  { id: 'gitnexus-debugging', name: 'dhpk-gitnexus-debugging', path: 'skills/dhpk-gitnexus-debugging' },
  { id: 'gitnexus-exploring', name: 'dhpk-gitnexus-exploring', path: 'skills/dhpk-gitnexus-exploring' },
  { id: 'gitnexus-guide', name: 'dhpk-gitnexus-guide', path: 'skills/dhpk-gitnexus-guide' },
  { id: 'gitnexus-impact-analysis', name: 'dhpk-gitnexus-impact-analysis', path: 'skills/dhpk-gitnexus-impact-analysis' },
  { id: 'gitnexus-refactoring', name: 'dhpk-gitnexus-refactoring', path: 'skills/dhpk-gitnexus-refactoring' },
];
const GITNEXUS_IDS = HISTORICAL_GITNEXUS.map((entry) => entry.id);

function gitnexusUpgradeFixture() {
  const root = retirementTmpDir();
  const outDir = path.join(root, '.agents', 'skills');
  const historicSkills = HISTORICAL_GITNEXUS.map((entry) => ({
    ...entry, lifecycle: 'promoted',
    surfaces: ['agent-plugin'],
  }));
  for (const skill of [RETIREMENT_ACTIVE, ...historicSkills]) {
    retirementWrite(path.join(root, skill.path, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: Upgrade fixture\n---\n# ${skill.name}\n`);
    retirementWrite(path.join(root, skill.path, 'references', 'guide.md'), '# Fixture resource\n');
  }
  materializeAgentsSkillsProjection({ root, outDir, inventory: retirementInventory([RETIREMENT_ACTIVE, ...historicSkills]) });
  const historicalReceipt = retirementReadReceipt(outDir);
  for (const skill of historicSkills) fs.rmSync(path.join(root, skill.path), { recursive: true });
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifests', 'distribution-inventory.json'), 'utf8'));
  const currentInventory = retirementInventory([RETIREMENT_ACTIVE], current.retired_skills.filter((entry) => GITNEXUS_IDS.includes(entry.id)));
  return { root, outDir, currentInventory, historicalReceipt };
}

test('historical GitNexus projection upgrades through the current retirement ledger', () => {
  const fixture = gitnexusUpgradeFixture();
  try {
    retirementMaterializeCurrent(fixture);
    const validation = validateAgentsSkillsProjection({ root: fixture.root, outDir: fixture.outDir, inventory: fixture.currentInventory });
    assert.deepStrictEqual(validation.errors, [], 'upgraded projection must validate without stale ownership');
    const receipt = retirementReadReceipt(fixture.outDir);
    const retiredPaths = fixture.historicalReceipt.entries
      .filter((entry) => GITNEXUS_IDS.includes(entry.id))
      .flatMap((entry) => fixture.historicalReceipt.managedPaths.filter((relative) => (
        relative === `${entry.name}.md` || relative.startsWith(`${entry.name}/`)
      )));
    assert.ok(retiredPaths.length > 0, 'historical receipt must contain retired paths');
    for (const relative of retiredPaths) {
      assert.ok(!fs.existsSync(path.join(fixture.outDir, relative)), relative);
      assert.ok(!receipt.managedPaths.includes(relative), relative);
      assert.ok(!Object.hasOwn(receipt.generatedFingerprints, relative), relative);
    }
    assert.ok(!receipt.entries.some((entry) => GITNEXUS_IDS.includes(entry.id)));
    retirementMaterializeCurrent(fixture);
    assert.deepStrictEqual(validateAgentsSkillsProjection({ root: fixture.root, outDir: fixture.outDir, inventory: fixture.currentInventory }).errors, []);
    const freshOut = path.join(fixture.root, 'fresh', 'skills');
    materializeAgentsSkillsProjection({ root: fixture.root, outDir: freshOut, inventory: fixture.currentInventory });
    assert.deepStrictEqual(validateAgentsSkillsProjection({ root: fixture.root, outDir: freshOut, inventory: fixture.currentInventory }).errors, []);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('GitNexus retirement preserves edited historical output without publication', () => {
  const fixture = gitnexusUpgradeFixture();
  try {
    const edited = path.join(fixture.outDir, 'dhpk-gitnexus-cli', 'SKILL.md');
    fs.appendFileSync(edited, '\nUser changes\n');
    assertRejectedWithoutPublication(fixture, /modified|fingerprint|conflict|orphan/i);
    assert.match(fs.readFileSync(edited, 'utf8'), /User changes/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// Public identities from 586aad13^ manifests/distribution-inventory.json.
// The receipt directory is the public name, which is not always the stable id.
const CONSOLIDATED_0660 = [
  { id: 'dep-audit', name: 'dep-audit', path: 'skills/dep-audit' },
  { id: 'review-pending', name: 'review-pending', path: 'skills/review-pending' },
  { id: 'opsx-load-context', name: 'dhpk-opsx-load-context', path: 'skills/dhpk-opsx-load-context' },
  { id: 'opsx-post-obs', name: 'dhpk-opsx-post-observation', path: 'skills/dhpk-opsx-post-observation' },
  { id: 'js-static-check-strategy', name: 'js-static-check-strategy', path: 'skills/js-static-check-strategy' },
];

test('gen-agents-skills --update prunes 0.66.0 consolidated skills and validation passes', () => {
  const historicalRoot = retirementTmpDir();
  const historicalOut = path.join(historicalRoot, '.agents', 'skills');
  const skills = CONSOLIDATED_0660.map((entry) => ({
    ...entry,
    lifecycle: 'promoted',
    surfaces: ['agent-plugin'],
  }));
  for (const skill of skills) {
    retirementWrite(path.join(historicalRoot, skill.path, 'SKILL.md'), [
      '---',
      `name: ${skill.name}`,
      "description: 'Consolidated fixture skill.'",
      '---',
      `# ${skill.name}`,
      '',
    ].join('\n'));
  }
  materializeAgentsSkillsProjection({
    root: historicalRoot,
    outDir: historicalOut,
    inventory: retirementInventory(skills),
  });
  // Canonical --update only plans retirements when the output stays inside the
  // source checkout. This scratch directory is not the developer .agents tree.
  const scratch = fs.mkdtempSync(path.join(ROOT, '.agents-skills-0660-'));
  const outDir = path.join(scratch, 'skills');
  fs.cpSync(historicalOut, outDir, { recursive: true });
  try {
    const before = retirementReadReceipt(outDir);
    for (const skill of CONSOLIDATED_0660) {
      const entry = before.entries.find((candidate) => candidate.id === skill.id);
      assert.ok(entry, `${skill.id} must start in the fixture receipt`);
      assert.strictEqual(entry.name, skill.name);
      assert.strictEqual(entry.source, skill.path);
      assert.ok(before.managedPaths.includes(`${skill.name}.md`));
      assert.ok(before.managedPaths.includes(`${skill.name}/SKILL.md`));
      assert.ok(fs.existsSync(path.join(outDir, skill.name, 'SKILL.md')));
    }

    const updated = invokeCli(GENERATOR, ['--repo-root', ROOT, '--out-dir', outDir, '--update'], ROOT);
    assert.strictEqual(updated.status, 0, `${updated.stdout || ''}\n${updated.stderr || ''}`);
    const receipt = retirementReadReceipt(outDir);
    for (const skill of CONSOLIDATED_0660) {
      assert.ok(!receipt.entries.some((entry) => entry.id === skill.id), skill.id);
      assert.ok(!receipt.selectedIds.includes(skill.id), skill.id);
      assert.ok(!receipt.managedPaths.includes(`${skill.name}.md`), `${skill.name}.md`);
      assert.ok(!receipt.managedPaths.includes(`${skill.name}/SKILL.md`), `${skill.name}/SKILL.md`);
      assert.strictEqual(fs.existsSync(path.join(outDir, `${skill.name}.md`)), false, `${skill.name}.md`);
      assert.strictEqual(fs.existsSync(path.join(outDir, skill.name)), false, skill.name);
    }

    const checked = invokeCli(VALIDATOR, ['--repo-root', ROOT, '--out-dir', outDir], ROOT);
    assert.strictEqual(checked.status, 0, checked.stderr || checked.stdout);
    assert.match(checked.stdout, /^PASS \[agents-skills\]:/);
    assert.doesNotMatch(`${checked.stdout || ''}\n${checked.stderr || ''}`, /unverified ownership/);
  } finally {
    fs.rmSync(historicalRoot, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('gen-agents-skills');
