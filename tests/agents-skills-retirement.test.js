'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
} = require('../scripts/lib/agents-skills-package');

const ACTIVE = {
  id: 'active',
  name: 'dhpk-active-skill',
  path: 'skills/dhpk-active-skill',
  lifecycle: 'promoted',
  surfaces: ['agent-plugin'],
};

const RETIRED = {
  id: 'retired',
  name: 'dhpk-retired-skill',
  path: 'skills/dhpk-retired-skill',
  lifecycle: 'promoted',
  surfaces: ['agent-plugin'],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-skills-retirement-'));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function retirementRecord(overrides = {}) {
  return {
    id: RETIRED.id,
    name: RETIRED.name,
    canonicalPath: RETIRED.path,
    priorSurfaces: ['agent-plugin'],
    retiredIn: '0.54.0',
    reasonCode: 'test-retirement',
    replacements: [{ kind: 'skill', id: ACTIVE.id, mode: 'fixture-successor' }],
    rollback: { release: '0.53.0' },
    ...overrides,
  };
}

function inventory(skills, retiredSkills = []) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills,
    surface_membership: {
      'agent-plugin': skills.filter((skill) => skill.surfaces.includes('agent-plugin')).map((skill) => skill.id),
    },
    retired_skills: retiredSkills,
  };
}

function readReceipt(outDir) {
  return JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
}

function snapshotTree(directory) {
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

function makeFixture({ previouslySelected = true } = {}) {
  const root = tmpDir();
  const outDir = path.join(root, '.agents', 'skills');
  const priorInventory = inventory(previouslySelected ? [ACTIVE, RETIRED] : [ACTIVE]);
  const currentInventory = inventory([ACTIVE], [retirementRecord()]);

  write(path.join(root, ACTIVE.path, 'SKILL.md'), [
    '---',
    `name: ${ACTIVE.name}`,
    "description: 'Active fixture skill.'",
    '---',
    '# Active skill',
    '',
  ].join('\n'));
  write(path.join(root, ACTIVE.path, 'references', 'guide.md'), '# Active guide\n');
  write(path.join(root, RETIRED.path, 'SKILL.md'), [
    '---',
    `name: ${RETIRED.name}`,
    "description: 'Retired fixture skill.'",
    '---',
    '# Retired skill',
    '',
  ].join('\n'));
  write(path.join(root, RETIRED.path, 'references', 'guide.md'), '# Retired guide\n');
  write(path.join(root, RETIRED.path, 'scripts', 'check.sh'), '#!/bin/sh\n');

  materializeAgentsSkillsProjection({ root, inventory: priorInventory, outDir });

  if (previouslySelected) {
    const receipt = readReceipt(outDir);
    receipt.selectedIds = receipt.selectedIds.filter((id) => id !== RETIRED.id);
    fs.writeFileSync(path.join(outDir, '.dhpk-projection.json'), `${JSON.stringify(receipt)}\n`);
  }

  fs.rmSync(path.join(root, RETIRED.path), { recursive: true, force: true });
  return { root, outDir, currentInventory };
}

function materializeCurrent(fixture, options = {}) {
  return materializeAgentsSkillsProjection({
    root: fixture.root,
    inventory: fixture.currentInventory,
    outDir: fixture.outDir,
    allowCanonicalChanges: true,
    ...options,
  });
}

function assertRejectedWithoutPublication(fixture, diagnostic) {
  const before = snapshotTree(fixture.outDir);
  const receiptPath = path.join(fixture.outDir, '.dhpk-projection.json');
  const receiptBefore = fs.readFileSync(receiptPath, 'utf8');

  assert.throws(() => materializeCurrent(fixture), diagnostic);

  assert.deepStrictEqual(snapshotTree(fixture.outDir), before, 'a rejected retirement must preserve all installed bytes and paths');
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'a rejected retirement must preserve the receipt');
}

test('owned unchanged retired output is removed from the package and receipt', () => {
  const fixture = makeFixture();
  const retiredDir = path.join(fixture.outDir, RETIRED.name);
  const retiredShim = path.join(fixture.outDir, `${RETIRED.name}.md`);
  try {
    const oldReceipt = readReceipt(fixture.outDir);
    const oldEntry = oldReceipt.entries.find((entry) => entry.id === RETIRED.id);
    assert.ok(oldEntry, 'the carried retired identity must have a receipt entry');
    assert.ok(Array.isArray(oldEntry.sourceFiles), 'the receipt must retain its source manifest');
    assert.ok(oldReceipt.managedPaths.includes(`${RETIRED.name}/SKILL.md`));
    assert.ok(oldReceipt.generatedFingerprints[`${RETIRED.name}/SKILL.md`]);
    assert.ok(!oldReceipt.selectedIds.includes(RETIRED.id), 'the carried retired identity is absent from current selection');

    write(path.join(fixture.root, ACTIVE.path, 'references', 'guide.md'), '# Updated active guide\n');
    write(path.join(fixture.outDir, 'unmanaged', 'keep.md'), '# User-owned\n');

    const result = materializeCurrent(fixture);

    assert.deepStrictEqual(result.selectedIds, [ACTIVE.id]);
    assert.strictEqual(fs.existsSync(retiredDir), false);
    assert.strictEqual(fs.existsSync(retiredShim), false);
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.outDir, ACTIVE.name, 'references', 'guide.md'), 'utf8'),
      '# Updated active guide\n',
    );
    assert.strictEqual(fs.readFileSync(path.join(fixture.outDir, 'unmanaged', 'keep.md'), 'utf8'), '# User-owned\n');

    const receipt = readReceipt(fixture.outDir);
    assert.deepStrictEqual(receipt.selectedIds, [ACTIVE.id]);
    assert.ok(!receipt.entries.some((entry) => entry.id === RETIRED.id));
    assert.ok(!receipt.managedPaths.some((managedPath) => (
      managedPath === `${RETIRED.name}.md` || managedPath.startsWith(`${RETIRED.name}/`)
    )));
    assert.ok(!Object.keys(receipt.generatedFingerprints).some((managedPath) => (
      managedPath === `${RETIRED.name}.md` || managedPath.startsWith(`${RETIRED.name}/`)
    )));
    assert.strictEqual(validateAgentsSkillsProjection({ root: fixture.root, inventory: fixture.currentInventory, outDir: fixture.outDir }).ok, true);

    const firstUpdate = snapshotTree(fixture.outDir);
    materializeCurrent(fixture);
    assert.deepStrictEqual(snapshotTree(fixture.outDir), firstUpdate, 'reconciliation remains deterministic on repeat');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('modified retired output is reported and preserved without publication', () => {
  const fixture = makeFixture();
  const changedPath = path.join(fixture.outDir, RETIRED.name, 'references', 'guide.md');
  try {
    write(changedPath, '# Local modification\n');
    assertRejectedWithoutPublication(fixture, /modified|fingerprint|conflict|orphan/i);
    assert.strictEqual(fs.readFileSync(changedPath, 'utf8'), '# Local modification\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retargeted retired output is reported and preserved without publication', () => {
  const fixture = makeFixture();
  const outside = tmpDir();
  const target = path.join(outside, 'keep.md');
  const retiredGuide = path.join(fixture.outDir, RETIRED.name, 'references', 'guide.md');
  try {
    write(target, '# Outside user content\n');
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
  const fixture = makeFixture();
  const missingPath = path.join(fixture.outDir, RETIRED.name, 'references', 'guide.md');
  try {
    fs.rmSync(missingPath);
    assertRejectedWithoutPublication(fixture, /missing|conflict|orphan/i);
    assert.strictEqual(fs.existsSync(missingPath), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unrecorded content inside a retired directory is reported and preserved', () => {
  const fixture = makeFixture();
  const unrecorded = path.join(fixture.outDir, RETIRED.name, 'local-notes.md');
  try {
    write(unrecorded, '# Keep this local file\n');
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
    const fixture = makeFixture();
    try {
      fixture.currentInventory.retired_skills[0] = {
        ...fixture.currentInventory.retired_skills[0],
        [field]: value,
      };
      assertRejectedWithoutPublication(fixture, /ledger|mismatch|conflict|orphan/i);
      assert.strictEqual(fs.existsSync(path.join(fixture.outDir, `${RETIRED.name}.md`)), true);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('never-selected retired paths remain unowned and are preserved', () => {
  const fixture = makeFixture({ previouslySelected: false });
  const retiredSkill = path.join(fixture.outDir, RETIRED.name, 'SKILL.md');
  const retiredShim = path.join(fixture.outDir, `${RETIRED.name}.md`);
  try {
    write(retiredSkill, '# User-owned skill file\n');
    write(retiredShim, '# User-owned shim\n');
    assertRejectedWithoutPublication(fixture, /unowned|ownership|orphan|conflict/i);
    assert.strictEqual(fs.readFileSync(retiredSkill, 'utf8'), '# User-owned skill file\n');
    assert.strictEqual(fs.readFileSync(retiredShim, 'utf8'), '# User-owned shim\n');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('partial retirement publication failure restores retired paths and receipt', () => {
  const fixture = makeFixture();
  const before = snapshotTree(fixture.outDir);
  const originalRenameSync = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = function renameWithRetirementFailure(from, to) {
      const source = path.resolve(String(from));
      const retiredRoot = path.resolve(fixture.outDir, RETIRED.name);
      const movingRetiredOutput = source === retiredRoot || source.startsWith(`${retiredRoot}${path.sep}`);
      const moved = originalRenameSync.call(this, from, to);
      if (movingRetiredOutput && !injected) {
        injected = true;
        throw new Error('injected retirement publish failure');
      }
      return moved;
    };

    assert.throws(() => materializeCurrent(fixture), /injected retirement publish failure/);
    assert.ok(injected, 'failure injection must occur after a retired path has moved');
    fs.renameSync = originalRenameSync;
    assert.deepStrictEqual(snapshotTree(fixture.outDir), before);
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('Claude and Cursor prior surfaces do not block receipt-owned cleanup', () => {
  const fixture = makeFixture();
  fixture.currentInventory.retired_skills[0] = retirementRecord({
    priorSurfaces: ['claude-core', 'cursor-sync'],
  });
  try {
    const result = materializeCurrent(fixture);
    const receipt = readReceipt(fixture.outDir);
    const checked = validateAgentsSkillsProjection({
      root: fixture.root,
      inventory: fixture.currentInventory,
      outDir: fixture.outDir,
    });

    assert.deepStrictEqual(result.selectedIds, [ACTIVE.id]);
    assert.strictEqual(fs.existsSync(path.join(fixture.outDir, RETIRED.name)), false);
    assert.strictEqual(fs.existsSync(path.join(fixture.outDir, `${RETIRED.name}.md`)), false);
    assert.ok(!receipt.entries.some((entry) => entry.id === RETIRED.id));
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
    ['managed set mismatch', (entry, receipt) => { receipt.managedPaths = receipt.managedPaths.filter((file) => file !== `${RETIRED.name}/SKILL.md`); }],
    ['source fingerprint mismatch', (entry) => { entry.sourceFingerprint = '0'.repeat(64); }],
  ];
  const failures = [];
  for (const [label, corrupt] of corruptions) {
    const fixture = makeFixture();
    try {
      const receipt = readReceipt(fixture.outDir);
      corrupt(receipt.entries.find((entry) => entry.id === RETIRED.id), receipt);
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
    const fixture = makeFixture();
    const outside = tmpDir();
    const shim = path.join(fixture.outDir, `${RETIRED.name}.md`);
    const target = path.join(outside, 'keep.md');
    try {
      if (kind === 'modified') write(shim, '# Local shim edit\n');
      if (kind === 'missing') fs.rmSync(shim);
      if (kind === 'symlink') { write(target, '# Keep target\n'); fs.rmSync(shim); fs.symlinkSync(target, shim); }
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
  const fixture = makeFixture();
  const cacheFiles = [
    [path.join(fixture.outDir, RETIRED.name, '__pycache__', 'local.cpython-312.pyc'), 'local pycache bytes'],
    [path.join(fixture.outDir, RETIRED.name, 'local.pyc'), 'local pyc bytes'],
  ];
  try {
    for (const [file, bytes] of cacheFiles) write(file, bytes);
    assertRejectedWithoutPublication(fixture, /unrecorded|unowned|orphan|conflict/i);
    for (const [file, bytes] of cacheFiles) assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

// Historical identities and paths from the parent of removal commit 096cba21.
const GITNEXUS_IDS = [
  'gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring',
  'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring',
];

function gitnexusUpgradeFixture() {
  const root = tmpDir();
  const outDir = path.join(root, '.agents', 'skills');
  const historicSkills = GITNEXUS_IDS.map((id) => ({
    id, name: `dhpk-${id}`, path: `skills/dhpk-${id}`, lifecycle: 'promoted',
    surfaces: ['agent-plugin'],
  }));
  for (const skill of [ACTIVE, ...historicSkills]) {
    write(path.join(root, skill.path, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: Upgrade fixture\n---\n# ${skill.name}\n`);
    write(path.join(root, skill.path, 'references', 'guide.md'), '# Fixture resource\n');
  }
  materializeAgentsSkillsProjection({ root, outDir, inventory: inventory([ACTIVE, ...historicSkills]) });
  const historicalReceipt = readReceipt(outDir);
  for (const skill of historicSkills) fs.rmSync(path.join(root, skill.path), { recursive: true });
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifests', 'distribution-inventory.json'), 'utf8'));
  const currentInventory = inventory([ACTIVE], current.retired_skills.filter((entry) => GITNEXUS_IDS.includes(entry.id)));
  return { root, outDir, currentInventory, historicalReceipt };
}

test('historical GitNexus projection upgrades through the current retirement ledger', () => {
  const fixture = gitnexusUpgradeFixture();
  try {
    materializeCurrent(fixture);
    const validation = validateAgentsSkillsProjection({ root: fixture.root, outDir: fixture.outDir, inventory: fixture.currentInventory });
    assert.deepStrictEqual(validation.errors, [], 'upgraded projection must validate without stale ownership');
    const receipt = readReceipt(fixture.outDir);
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
    materializeCurrent(fixture);
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

run('agents-skills-retirement');
