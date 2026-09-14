'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
} = require('../scripts/lib/agents-skills-package');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixtureInventory() {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{
      id: 'sample',
      name: 'dhpk-sample',
      path: 'skills/dhpk-sample',
      lifecycle: 'promoted',
      surfaces: ['agent-plugin'],
    }],
    surface_membership: { 'agent-plugin': ['sample'] },
  };
}

function makeFixture() {
  const root = tmpDir('dhpk-agents-skills-src-');
  write(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), [
    '---',
    'name: dhpk-sample',
    "description: 'A portable sample skill.'",
    '---',
    '# Sample skill',
    '',
    'Use the reference at [guide](references/guide.md).',
    '',
  ].join('\n'));
  write(path.join(root, 'skills', 'dhpk-sample', 'references', 'guide.md'), '# Guide\n');
  write(path.join(root, 'skills', 'dhpk-sample', 'scripts', 'check.sh'), '#!/bin/sh\n');
  return root;
}

function projectInventory() {
  const inventory = fixtureInventory();
  inventory.skills[0] = {
    ...inventory.skills[0],
    lifecycle: 'promoted',
    surfaces: ['agent-plugin', 'claude-core', 'codex-sync', 'cursor-plugin', 'agy-plugin'],
  };
  inventory.project_agent_projection = {
    schema: 'dhpk.project-agent-projection.v1',
    scope: 'project',
    owner: 'dhpk.project-agent-projection',
    managed_root: '.agents/skills',
    receipt: '.agents/.dhpk-installed.json',
    profiles: {
      'portable-core': {
        version: 'portable-core-v1',
        compatibility_mode: 'portable-core',
        stable_ids: ['sample'],
        hosts: ['agy', 'claude', 'codex', 'cursor'],
      },
    },
    hosts: {
      claude: { surface: 'claude-core', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'claude-project-skill', version: '1' } },
      codex: { surface: 'codex-sync', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'codex-project-skill', version: '1' } },
      cursor: { surface: 'cursor-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-directory', transform: { id: 'cursor-project-skill', version: '1' } },
      agy: { surface: 'agy-plugin', evidence_source: 'entry_surfaces', shape: 'project-skill-direct-file', transform: { id: 'agy-project-direct-file', version: '1' } },
    },
    dependencies: {},
  };
  return inventory;
}

function snapshot(directory) {
  const files = [];
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(child, childRelative);
      else files.push([childRelative, fs.readFileSync(child, 'utf8')]);
    }
  };
  walk(directory, '');
  return files;
}

test('materializes Cursor and AGY skill shapes from one canonical package', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    const result = materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.deepStrictEqual(result.selectedIds, ['sample']);
    assert.ok(fs.statSync(path.join(outDir, 'dhpk-sample', 'SKILL.md')).isFile());
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'dhpk-sample', 'references', 'guide.md'), 'utf8'), '# Guide\n');
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'dhpk-sample', 'scripts', 'check.sh'), 'utf8'), '#!/bin/sh\n');

    const agyShim = fs.readFileSync(path.join(outDir, 'dhpk-sample.md'), 'utf8');
    assert.match(agyShim, /^name: dhpk-sample$/m);
    assert.match(agyShim, /^description: /m);
    assert.match(agyShim, /skills\/dhpk-sample\/SKILL\.md/);
    assert.ok(fs.statSync(path.join(outDir, '.dhpk-projection.json')).isFile());

    const checked = validateAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('regeneration is deterministic and preserves unmanaged entries', () => {
  const root = makeFixture();
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  try {
    write(path.join(first, 'unmanaged.md'), '# Keep me\n');
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir: first });
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir: second });
    assert.deepStrictEqual(snapshot(first).filter(([name]) => name !== 'unmanaged.md'), snapshot(second));
    assert.strictEqual(fs.readFileSync(path.join(first, 'unmanaged.md'), 'utf8'), '# Keep me\n');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir: first }).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('regeneration refuses to overwrite changed managed content', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    fs.appendFileSync(path.join(outDir, 'dhpk-sample.md'), '\n# Local edit\n');
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }),
      /managed.*modified|fingerprint|collision/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonical source changes require explicit update authority', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    write(path.join(root, 'skills', 'dhpk-sample', 'references', 'guide.md'), '# Updated guide\n');
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }),
      /stale or foreign/i,
    );
    materializeAgentsSkillsProjection({
      root,
      inventory: fixtureInventory(),
      outDir,
      allowCanonicalChanges: true,
    });
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'dhpk-sample', 'references', 'guide.md'), 'utf8'), '# Updated guide\n');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy receipts migrate their source manifests before enforcing update authority', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const legacyReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    for (const entry of legacyReceipt.entries) delete entry.sourceFiles;
    fs.writeFileSync(receiptPath, `${JSON.stringify(legacyReceipt)}\n`);

    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const migrated = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(migrated.entries.every((entry) => Array.isArray(entry.sourceFiles)));

    write(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), [
      '---',
      'name: dhpk-sample',
      "description: 'A migrated sample.'",
      '---',
      '# Migrated sample\n',
    ].join('\n'));
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }),
      /stale or foreign/i,
    );
    materializeAgentsSkillsProjection({
      root,
      inventory: fixtureInventory(),
      outDir,
      allowCanonicalChanges: true,
    });
    assert.match(fs.readFileSync(path.join(outDir, 'dhpk-sample', 'SKILL.md'), 'utf8'), /# Migrated sample/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validator rejects missing managed files without claiming runtime support', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    fs.rmSync(path.join(outDir, 'dhpk-sample.md'));
    const checked = validateAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => /dhpk-sample\.md/.test(error)));
    assert.strictEqual(checked.runtime, 'NOT_RUN');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publishing rejects a nested symlink before it can escape the output root', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  const outside = tmpDir('dhpk-agents-skills-outside-');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    fs.symlinkSync(outside, path.join(outDir, 'dhpk-sample', 'extras'));
    write(path.join(root, 'skills', 'dhpk-sample', 'extras', 'new.md'), '# New\n');
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }),
      /symlinked ancestor|projection path/i,
    );
    assert.strictEqual(fs.existsSync(path.join(outside, 'new.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('recovery journal restores a transaction interrupted after an old file move', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  const parent = path.dirname(outDir);
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const backup = path.join(parent, '.dhpk-agents-skills-backup-fixture');
    const stage = path.join(parent, '.dhpk-agents-skills-build-fixture');
    fs.mkdirSync(backup, { recursive: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.renameSync(path.join(outDir, '.dhpk-projection.json'), path.join(backup, '.dhpk-projection.json'));
    const journalName = `.dhpk-agents-skills-${crypto.createHash('sha256').update(path.resolve(outDir)).digest('hex').slice(0, 16)}.transaction.json`;
    fs.writeFileSync(path.join(parent, journalName), JSON.stringify({
      schema: 'dhpk.agents-skills-transaction.v1',
      outputName: path.basename(outDir),
      backupName: path.basename(backup),
      stageName: path.basename(stage),
      phase: 'publishing',
      oldPaths: ['.dhpk-projection.json'],
      newPaths: ['.dhpk-projection.json'],
    }));
    const result = materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.strictEqual(result.selectedIds[0], 'sample');
    assert.ok(fs.existsSync(path.join(outDir, '.dhpk-projection.json')));
    assert.strictEqual(fs.existsSync(path.join(parent, journalName)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt paths outside the current canonical tree remain unmanaged', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const unmanaged = path.join(outDir, 'dhpk-sample', 'unmanaged.md');
    write(unmanaged, '# Keep me\n');
    receipt.managedPaths.push('dhpk-sample/unmanaged.md');
    receipt.generatedFingerprints['dhpk-sample/unmanaged.md'] = crypto.createHash('sha256').update('# Keep me\n').digest('hex');
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.strictEqual(fs.readFileSync(unmanaged, 'utf8'), '# Keep me\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt cannot claim a user file at a newly added canonical path', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    write(path.join(root, 'skills', 'dhpk-sample', 'new.md'), '# Canonical later\n');
    const unmanaged = path.join(outDir, 'dhpk-sample', 'new.md');
    write(unmanaged, '# Keep me\n');
    receipt.managedPaths.push('dhpk-sample/new.md');
    receipt.generatedFingerprints['dhpk-sample/new.md'] = crypto.createHash('sha256').update('# Keep me\n').digest('hex');
    receipt.entries[0].sourceFiles.push({
      path: 'new.md',
      digest: crypto.createHash('sha256').update('# Keep me\n').digest('hex'),
    });
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir }),
      /source manifest|stale or foreign|collides with unmanaged content/i,
    );
    assert.strictEqual(fs.readFileSync(unmanaged, 'utf8'), '# Keep me\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt entries outside the current inventory selection cannot own files', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const foreign = path.join(outDir, 'foreign-skill', 'SKILL.md');
    write(foreign, '# Foreign\n');
    receipt.entries.push({
      id: 'foreign',
      name: 'foreign-skill',
      source: 'skills/foreign-skill',
      sourceFingerprint: crypto.createHash('sha256').update('foreign').digest('hex'),
      sourceFiles: [{ path: 'SKILL.md', digest: crypto.createHash('sha256').update('# Foreign\n').digest('hex') }],
      cursorPath: 'foreign-skill/SKILL.md',
      agyPath: 'foreign-skill.md',
    });
    receipt.managedPaths.push('foreign-skill/SKILL.md');
    receipt.generatedFingerprints['foreign-skill/SKILL.md'] = crypto.createHash('sha256').update('# Foreign\n').digest('hex');
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '# Foreign\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deselected inventory skills remain explicit stale content instead of being deleted', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  const retiredInventory = fixtureInventory();
  retiredInventory.skills[0] = { ...retiredInventory.skills[0], lifecycle: 'deprecated', surfaces: [] };
  retiredInventory.surface_membership = { 'agent-plugin': [] };
  try {
    materializeAgentsSkillsProjection({ root, inventory: fixtureInventory(), outDir });
    materializeAgentsSkillsProjection({ root, inventory: retiredInventory, outDir });
    assert.strictEqual(fs.existsSync(path.join(outDir, 'dhpk-sample', 'SKILL.md')), true);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'dhpk-sample.md')), true);
    const checked = validateAgentsSkillsProjection({ root, inventory: retiredInventory, outDir });
    assert.strictEqual(checked.ok, false);
    assert.ok(checked.errors.some((error) => /unverified ownership|unmanaged/i.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('known but never-selected inventory skills cannot gain receipt ownership', () => {
  const root = makeFixture();
  const outDir = path.join(root, '.agents', 'skills');
  const inventory = fixtureInventory();
  write(path.join(root, 'skills', 'dhpk-unused', 'SKILL.md'), [
    '---',
    'name: dhpk-unused',
    "description: 'Unused.'",
    '---',
    '# Unused\n',
  ].join('\n'));
  inventory.skills.push({
    id: 'unused',
    name: 'dhpk-unused',
    path: 'skills/dhpk-unused',
    lifecycle: 'promoted',
    surfaces: [],
  });
  try {
    materializeAgentsSkillsProjection({ root, inventory, outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const foreign = path.join(outDir, 'dhpk-unused', 'SKILL.md');
    write(foreign, '# User file\n');
    receipt.entries.push({
      id: 'unused',
      name: 'dhpk-unused',
      source: 'skills/dhpk-unused',
      sourceFingerprint: crypto.createHash('sha256').update('unused').digest('hex'),
      sourceFiles: [{ path: 'SKILL.md', digest: crypto.createHash('sha256').update('# User file\n').digest('hex') }],
      cursorPath: 'dhpk-unused/SKILL.md',
      agyPath: 'dhpk-unused.md',
    });
    receipt.managedPaths.push('dhpk-unused/SKILL.md');
    receipt.generatedFingerprints['dhpk-unused/SKILL.md'] = crypto.createHash('sha256').update('# User file\n').digest('hex');
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    materializeAgentsSkillsProjection({ root, inventory, outDir });
    assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '# User file\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('relocatable projection uses an external project root and the project receipt', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-project-');
  try {
    const result = materializeAgentsSkillsProjection({
      root: sourceRoot,
      sourceRoot,
      projectRoot,
      inventory: projectInventory(),
      profileId: 'portable-core',
      requestedHosts: ['agy', 'claude', 'codex', 'cursor'],
    });
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    assert.strictEqual(result.projectRoot, projectRoot);
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')));
    assert.strictEqual(fs.existsSync(path.join(outputRoot, '.dhpk-projection.json')), true);
    assert.strictEqual(fs.existsSync(path.join(outputRoot, 'dhpk-sample', 'references', 'guide.md')), true);
    assert.strictEqual(fs.existsSync(path.join(sourceRoot, '.agents')), false);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable projection permits a symlinked ancestor above the project root', () => {
  const sourceRoot = makeFixture();
  const hostRoot = tmpDir('dhpk-agents-skills-symlink-parent-');
  const projectRoot = path.join(hostRoot, 'alias', 'consumer');
  fs.symlinkSync(hostRoot, path.join(hostRoot, 'alias'), 'dir');
  try {
    materializeAgentsSkillsProjection({ root: sourceRoot, projectRoot, inventory: projectInventory(), profileId: 'portable-core' });
    assert.ok(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  }
});

test('relocatable AGY entries stay self-contained after the canonical source is removed', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-relocation-');
  try {
    materializeAgentsSkillsProjection({ root: sourceRoot, projectRoot, inventory: projectInventory(), profileId: 'portable-core' });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    const directFile = fs.readFileSync(path.join(outputRoot, 'dhpk-sample.md'), 'utf8');
    assert.match(directFile, /# Sample skill/);
    assert.doesNotMatch(directFile, /skills\/dhpk-sample\/SKILL\.md/);
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'dhpk-sample', 'references', 'guide.md'), 'utf8'), '# Guide\n');
    const checked = validateAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(checked.ok, true, checked.errors.join('; '));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('requested Host bindings select only their provider-shaped outputs', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-agy-only-');
  try {
    const result = materializeAgentsSkillsProjection({
      root: sourceRoot,
      sourceRoot,
      projectRoot,
      inventory: projectInventory(),
      profileId: 'portable-core',
      requestedHosts: ['agy'],
    });
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    assert.ok(fs.existsSync(path.join(outputRoot, 'dhpk-sample.md')));
    assert.strictEqual(fs.existsSync(path.join(outputRoot, 'dhpk-sample', 'SKILL.md')), false);
    assert.deepStrictEqual(Object.keys(result.receipt.hostBindings), ['agy']);
    assert.strictEqual(result.receipt.hostBindings.agy.shape, 'project-skill-direct-file');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('provider-shaped projection rejects an AGY directory binding before publication', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-invalid-agy-binding-');
  const inventory = projectInventory();
  inventory.project_agent_projection.hosts.agy.shape = 'project-skill-directory';
  try {
    assert.throws(
      () => materializeAgentsSkillsProjection({
        root: sourceRoot,
        sourceRoot,
        projectRoot,
        inventory,
        profileId: 'portable-core',
        requestedHosts: ['agy'],
      }),
      /AGY.*direct-file|provider.*shape|incompatible/i,
    );
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')), false);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable projection materializes declared supporting assets into the owned artifact', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-assets-');
  const inventory = projectInventory();
  write(path.join(sourceRoot, 'shared', 'policy.md'), '# Supporting policy\n');
  inventory.supporting_assets = [{ id: 'policy', canonical_source: 'shared/policy.md', destination: 'support/policy.md' }];
  inventory.project_agent_projection.dependencies.sample = { supporting_asset_ids: ['policy'] };
  try {
    materializeAgentsSkillsProjection({ root: sourceRoot, projectRoot, inventory, profileId: 'portable-core' });
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'support', 'policy.md'), 'utf8'), '# Supporting policy\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable projection rejects secrets in supporting assets before publication', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-asset-secret-');
  const inventory = projectInventory();
  write(path.join(sourceRoot, 'shared', 'policy.md'), 'api_key=0123456789abcdef\n');
  inventory.supporting_assets = [{ id: 'policy', canonical_source: 'shared/policy.md', destination: 'support/policy.md' }];
  inventory.project_agent_projection.dependencies.sample = { supporting_asset_ids: ['policy'] };
  try {
    assert.throws(
      () => materializeAgentsSkillsProjection({ root: sourceRoot, projectRoot, inventory, profileId: 'portable-core' }),
      /secret/i,
    );
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')), false);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'support', 'policy.md')), false);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable projection keeps its lifecycle receipt outside the managed root', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-receipt-path-');
  const inventory = projectInventory();
  inventory.project_agent_projection.receipt = '.agents/skills/.dhpk-installed.json';
  try {
    assert.throws(
      () => materializeAgentsSkillsProjection({ root: sourceRoot, projectRoot, inventory, profileId: 'portable-core' }),
      /outside the managed root|receipt/i,
    );
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')), false);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable updates preserve foreign content and refuse changed managed files', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-ownership-');
  try {
    const options = { root: sourceRoot, projectRoot, inventory: projectInventory(), profileId: 'portable-core' };
    materializeAgentsSkillsProjection(options);
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    write(path.join(outputRoot, 'foreign', 'README.md'), '# User-owned\n');
    materializeAgentsSkillsProjection(options);
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'foreign', 'README.md'), 'utf8'), '# User-owned\n');

    fs.appendFileSync(path.join(outputRoot, 'dhpk-sample.md'), '\n# Local edit\n');
    assert.throws(() => materializeAgentsSkillsProjection(options), /modified|fingerprint|ownership/i);
    assert.match(fs.readFileSync(path.join(outputRoot, 'dhpk-sample.md'), 'utf8'), /# Local edit/);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('relocatable update keeps a durable rollback and uninstall removes only unchanged owned files', () => {
  const sourceRoot = makeFixture();
  const projectRoot = tmpDir('dhpk-agents-skills-rollback-');
  try {
    const options = { root: sourceRoot, projectRoot, inventory: projectInventory(), profileId: 'portable-core' };
    materializeAgentsSkillsProjection(options);
    const outputRoot = path.join(projectRoot, '.agents', 'skills');
    write(path.join(outputRoot, 'foreign', 'keep.md'), '# Keep me\n');
    write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'references', 'guide.md'), '# Updated guide\n');
    materializeAgentsSkillsProjection({ ...options, allowCanonicalChanges: true });
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'dhpk-sample', 'references', 'guide.md'), 'utf8'), '# Updated guide\n');

    const rolledBack = rollbackAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'dhpk-sample', 'references', 'guide.md'), 'utf8'), '# Guide\n');

    const removed = uninstallAgentsSkillsProjection({ projectRoot });
    assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', '.dhpk-installed.json')), false);
    assert.strictEqual(fs.existsSync(path.join(outputRoot, 'dhpk-sample', 'SKILL.md')), false);
    assert.strictEqual(fs.readFileSync(path.join(outputRoot, 'foreign', 'keep.md'), 'utf8'), '# Keep me\n');
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

run('agents-skills-compatibility');
