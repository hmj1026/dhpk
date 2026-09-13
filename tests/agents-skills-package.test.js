'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
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

run('agents-skills-compatibility');
