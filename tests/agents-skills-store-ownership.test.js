'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const {
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
  agentsSkillsOwnership,
  planUnmanagedSkillEntries,
  reservedNamePredicate,
  RECEIPT_NAME,
} = require('../scripts/lib/agents-skills-package');

const INVENTORY = Object.freeze({
  schema: 'dhpk.distribution-inventory.v2',
  skills: [{ id: 'sample', name: 'dhpk-sample', path: 'skills/dhpk-sample', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
  surface_membership: { 'agent-plugin': ['sample'] },
});

// Observed from the in-checkout writer for the fixture below. Only the receipt row
// moved with the tree-merkle-v1 change: re-expressing it with generator 1.0.0, no
// fingerprint_algorithm and the legacy sourceFingerprint reproduces the pre-change
// digest e86fbf71...0acddc714 exactly.
const GOLDEN = Object.freeze([
  ['.dhpk-projection.json', '644', '252e1c2cee5a1244fb5cb416cfd74f16dc56de4727bee8cc323dacad14f56511'],
  ['dhpk-sample.md', '644', 'd2a4acb7b734746e69c41ddd52d0ada32ca4141459b933903255a30a4d9568b1'],
  ['dhpk-sample/SKILL.md', '644', 'e3468725b8222a9c841d9b9de8c5013b36da94b2f74fabd101d3978b37004e2b'],
  ['dhpk-sample/references/guide.md', '644', 'bc553ffe57e544498b12a9865dbf3abc2004c474e349c52c378eaa402287424b'],
  ['dhpk-sample/scripts/check.sh', '755', 'a8076d3d28d21e02012b20eaf7dbf75409a6277134439025f282e368e3305abf'],
]);

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode === undefined ? undefined : { mode });
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-store-'));
  write(path.join(root, 'skills/dhpk-sample/SKILL.md'), ['---', 'name: dhpk-sample', "description: 'A portable sample skill.'", '---', '# Sample skill', '', 'Use the reference at [guide](references/guide.md).', ''].join('\n'));
  write(path.join(root, 'skills/dhpk-sample/references/guide.md'), '# Guide\n');
  write(path.join(root, 'skills/dhpk-sample/scripts/check.sh'), '#!/bin/sh\n', 0o755);
  fs.chmodSync(path.join(root, 'skills/dhpk-sample/scripts/check.sh'), 0o755);
  return root;
}

function tree(directory) {
  const rows = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relative);
      else rows.push([relative, (fs.statSync(full).mode & 0o7777).toString(8), crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
    }
  };
  walk(directory, '');
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function materialize(root, outDir) {
  return materializeAgentsSkillsProjection({ root, inventory: INVENTORY, outDir });
}

test('in-checkout publication is byte- and mode-identical to the characterized output', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills'], 'no stage, backup, or journal may remain');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir }).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('republishing replaces the whole tree and stays identical', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unlisted file inside a managed skill directory is refused with OWNERSHIP_REFUSED and the tree is unchanged', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    write(path.join(outDir, 'dhpk-sample', 'user-notes.md'), '# mine\n');
    const before = tree(outDir);
    assert.throws(() => materialize(root, outDir), /OWNERSHIP_REFUSED/);
    assert.deepStrictEqual(tree(outDir), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// #1337: unmanaged top-level entries are carried through the staged tree.
// ---------------------------------------------------------------------------

function seedForeign(outDir) {
  write(path.join(outDir, 'gitnexus-cli', 'SKILL.md'), '# third-party skill\n');
  write(path.join(outDir, 'gitnexus-cli', 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n', 0o755);
  fs.chmodSync(path.join(outDir, 'gitnexus-cli', 'scripts', 'run.sh'), 0o755);
  write(path.join(outDir, 'notes.md'), '# my notes\n');
}

const FOREIGN_PATHS = ['gitnexus-cli/SKILL.md', 'gitnexus-cli/scripts/run.sh', 'notes.md'];

function rowsFor(outDir, paths) {
  const wanted = new Set(paths);
  return tree(outDir).filter((row) => wanted.has(row[0]));
}

function sortedRows(rows) {
  return rows.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function secondSkillInventory() {
  return {
    schema: INVENTORY.schema,
    skills: [...INVENTORY.skills, { id: 'extra', name: 'dhpk-extra', path: 'skills/dhpk-extra', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
    surface_membership: { 'agent-plugin': ['sample', 'extra'] },
  };
}

function addExtraSkill(root) {
  write(path.join(root, 'skills/dhpk-extra/SKILL.md'), ['---', 'name: dhpk-extra', "description: 'An extra skill.'", '---', '# Extra', ''].join('\n'));
}

test('unmanaged skill directories and files survive with identical bytes and modes, and the receipt is unchanged', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    seedForeign(outDir);
    const foreignBefore = rowsFor(outDir, FOREIGN_PATHS);
    assert.strictEqual(foreignBefore.length, 3);
    assert.strictEqual(foreignBefore.find((row) => row[0].endsWith('run.sh'))[1], '755');

    const result = materialize(root, outDir);
    assert.deepStrictEqual(result.preservedUnmanaged, ['gitnexus-cli', 'notes.md']);
    assert.deepStrictEqual(tree(outDir), sortedRows([...GOLDEN.map((row) => [...row]), ...foreignBefore]));
    assert.ok(!JSON.stringify(result.receipt).includes('gitnexus'));
    assert.ok(!fs.readFileSync(path.join(outDir, RECEIPT_NAME), 'utf8').includes('notes.md'));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills'], 'no stage or backup may remain');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir }).ok, true);

    const afterFirst = tree(outDir);
    const second = materialize(root, outDir);
    assert.deepStrictEqual(second.preservedUnmanaged, ['gitnexus-cli', 'notes.md']);
    assert.deepStrictEqual(tree(outDir), afterFirst, 'a second run is idempotent');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a run without unmanaged entries reports an empty preservedUnmanaged list', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    assert.deepStrictEqual(materialize(root, outDir).preservedUnmanaged, []);
    assert.deepStrictEqual(materialize(root, outDir).preservedUnmanaged, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('python cache files and dotfiles under unmanaged entries are preserved; empty unmanaged directories are dropped', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    write(path.join(outDir, 'third', '__pycache__', 'x.cpython-312.pyc'), Buffer.from([0, 1, 2, 3, 255]));
    write(path.join(outDir, 'third', 'tool.pyc'), 'raw');
    write(path.join(outDir, '.hidden-note'), 'dot\n');
    fs.mkdirSync(path.join(outDir, 'empty-dir', 'nested-empty'), { recursive: true });
    const keep = ['third/__pycache__/x.cpython-312.pyc', 'third/tool.pyc', '.hidden-note'];
    const before = rowsFor(outDir, keep);
    assert.strictEqual(before.length, 3);

    const result = materialize(root, outDir);
    assert.deepStrictEqual(rowsFor(outDir, keep), before);
    assert.deepStrictEqual(result.preservedUnmanaged, ['.hidden-note', 'third']);
    assert.strictEqual(fs.existsSync(path.join(outDir, 'empty-dir')), false, 'empty unmanaged directories are not carried');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a newly selected skill colliding with an unmanaged directory or file of the same name is refused and the tree is unchanged', () => {
  for (const collision of [['dhpk-extra', 'SKILL.md'], ['dhpk-extra.md']]) {
    const root = makeRoot();
    try {
      const outDir = path.join(root, '.agents', 'skills');
      materialize(root, outDir);
      addExtraSkill(root);
      write(path.join(outDir, ...collision), '# third-party\n');
      seedForeign(outDir);
      const before = tree(outDir);
      assert.throws(
        () => materializeAgentsSkillsProjection({ root, inventory: secondSkillInventory(), outDir }),
        /OWNERSHIP_REFUSED/,
        collision.join('/'),
      );
      assert.deepStrictEqual(tree(outDir), before);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('an unmanaged top-level symlink or nested symlink is refused and its target is untouched', () => {
  const cases = {
    'top-level directory symlink': (outDir, target) => fs.symlinkSync(path.dirname(target), path.join(outDir, 'linked-dir')),
    'top-level file symlink': (outDir, target) => fs.symlinkSync(target, path.join(outDir, 'linked.md')),
    'nested symlink': (outDir, target) => {
      write(path.join(outDir, 'third', 'ok.md'), '# ok\n');
      fs.symlinkSync(target, path.join(outDir, 'third', 'link.md'));
    },
  };
  for (const [label, seed] of Object.entries(cases)) {
    const root = makeRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-store-outside-'));
    try {
      const outDir = path.join(root, '.agents', 'skills');
      materialize(root, outDir);
      const target = path.join(outside, 'target.md');
      write(target, '# outside\n');
      seed(outDir, target);
      const linkRows = () => fs.readdirSync(outDir, { recursive: true }).sort();
      const before = linkRows();
      assert.throws(() => materialize(root, outDir), /symlink/i, label);
      assert.deepStrictEqual(linkRows(), before, label);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '# outside\n', label);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills'], label);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('an unmanaged entry with an unsafe name is refused before staging', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    write(path.join(outDir, 'C:evil.md'), 'x\n');
    const before = tree(outDir);
    assert.throws(() => materialize(root, outDir), /escapes the projection root|unmanaged/i);
    assert.deepStrictEqual(tree(outDir), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the activation verifier refuses when an unmanaged file is modified, added, removed, or re-moded after planning', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    write(path.join(outDir, 'third', 'a.txt'), 'a\n');
    write(path.join(outDir, 'third', 'b.txt'), 'b\n');
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, RECEIPT_NAME), 'utf8'));
    const owned = new Set([...receipt.managedPaths, RECEIPT_NAME]);
    const isReserved = reservedNamePredicate(['dhpk-sample']);
    const plan = planUnmanagedSkillEntries(outDir, isReserved);
    assert.deepStrictEqual([...plan.files.keys()].sort(), ['third/a.txt', 'third/b.txt']);
    const verify = () => agentsSkillsOwnership(owned, { isReserved, files: plan.files }).verify(outDir);
    assert.strictEqual(verify().ok, true);

    fs.writeFileSync(path.join(outDir, 'third', 'a.txt'), 'changed\n');
    assert.strictEqual(verify().ok, false, 'modified');
    fs.writeFileSync(path.join(outDir, 'third', 'a.txt'), 'a\n');
    assert.strictEqual(verify().ok, true);

    fs.chmodSync(path.join(outDir, 'third', 'a.txt'), 0o600);
    assert.strictEqual(verify().ok, false, 're-moded');
    fs.chmodSync(path.join(outDir, 'third', 'a.txt'), 0o644);
    assert.strictEqual(verify().ok, true);

    write(path.join(outDir, 'third', 'c.txt'), 'c\n');
    assert.strictEqual(verify().ok, false, 'added');
    fs.rmSync(path.join(outDir, 'third', 'c.txt'));
    write(path.join(outDir, 'brand-new.md'), 'new\n');
    assert.strictEqual(verify().ok, false, 'added at top level');
    fs.rmSync(path.join(outDir, 'brand-new.md'));
    assert.strictEqual(verify().ok, true);

    fs.rmSync(path.join(outDir, 'third', 'b.txt'));
    const removed = verify();
    assert.strictEqual(removed.ok, false, 'removed');
    assert.match(removed.message, /third\/b\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the activation verifier still refuses an unowned file at a reserved name and a missing receipt', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, RECEIPT_NAME), 'utf8'));
    const owned = new Set([...receipt.managedPaths, RECEIPT_NAME]);
    const isReserved = reservedNamePredicate(['dhpk-sample']);
    const unmanaged = { isReserved, files: new Map() };
    write(path.join(outDir, 'dhpk-sample', 'extra.md'), 'x\n');
    assert.strictEqual(agentsSkillsOwnership(owned, unmanaged).verify(outDir).ok, false);
    fs.rmSync(path.join(outDir, 'dhpk-sample', 'extra.md'));
    fs.rmSync(path.join(outDir, RECEIPT_NAME));
    assert.strictEqual(agentsSkillsOwnership(owned, unmanaged).verify(outDir).code, 'NO_OWNER_RECEIPT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unmanaged walk shares one traversal budget and refuses on overflow', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    for (let index = 0; index < 5; index += 1) write(path.join(outDir, `third-${index}`, 'f.txt'), `${index}\n`);
    assert.throws(
      () => planUnmanagedSkillEntries(outDir, reservedNamePredicate(['dhpk-sample']), { maxFiles: 3 }),
      /maximum fingerprint file count \(3\) exceeded/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a rename whose new name collides with an unmanaged entry is refused and the tree is unchanged', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    fs.renameSync(path.join(root, 'skills/dhpk-sample'), path.join(root, 'skills/sample-renamed'));
    const sourceSkill = path.join(root, 'skills/sample-renamed/SKILL.md');
    fs.writeFileSync(sourceSkill, fs.readFileSync(sourceSkill, 'utf8').replace('name: dhpk-sample', 'name: sample-renamed'));
    const renamedInventory = {
      schema: INVENTORY.schema,
      skills: [{ id: 'sample', name: 'sample-renamed', path: 'skills/sample-renamed', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      surface_membership: { 'agent-plugin': ['sample'] },
      renamed_skill_names: [{ id: 'sample', oldName: 'dhpk-sample', oldPath: 'skills/dhpk-sample', newName: 'sample-renamed', newPath: 'skills/sample-renamed' }],
    };
    write(path.join(outDir, 'sample-renamed', 'third.md'), '# third-party at the new name\n');
    const before = tree(outDir);
    assert.throws(
      () => materializeAgentsSkillsProjection({ root, inventory: renamedInventory, outDir, allowCanonicalChanges: true }),
      /OWNERSHIP_REFUSED/,
    );
    assert.deepStrictEqual(tree(outDir), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '.agents')), ['skills']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validation reports an unmanaged entry at a reserved name but tolerates other unmanaged entries', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    const inventory = { ...INVENTORY, retired_skills: [{ id: 'old', name: 'dhpk-old', canonicalPath: 'skills/dhpk-old' }] };
    materializeAgentsSkillsProjection({ root, inventory: INVENTORY, outDir });
    seedForeign(outDir);
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory, outDir }).ok, true);

    write(path.join(outDir, 'dhpk-old.md'), '# stray shim\n');
    const shim = validateAgentsSkillsProjection({ root, inventory, outDir });
    assert.strictEqual(shim.ok, false);
    assert.ok(shim.errors.some((error) => /dhpk-old\.md/.test(error)), shim.errors.join('; '));
    fs.rmSync(path.join(outDir, 'dhpk-old.md'));

    write(path.join(outDir, 'dhpk-old', 'SKILL.md'), '# stray dir\n');
    const dir = validateAgentsSkillsProjection({ root, inventory, outDir });
    assert.strictEqual(dir.ok, false);
    assert.ok(dir.errors.some((error) => /dhpk-old\/SKILL\.md/.test(error)), dir.errors.join('; '));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('after a rename, a user directory at the old name is tolerated by both the writer and the validator', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    fs.renameSync(path.join(root, 'skills/dhpk-sample'), path.join(root, 'skills/sample-renamed'));
    const sourceSkill = path.join(root, 'skills/sample-renamed/SKILL.md');
    fs.writeFileSync(sourceSkill, fs.readFileSync(sourceSkill, 'utf8').replace('name: dhpk-sample', 'name: sample-renamed'));
    const renamedInventory = {
      schema: INVENTORY.schema,
      skills: [{ id: 'sample', name: 'sample-renamed', path: 'skills/sample-renamed', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      surface_membership: { 'agent-plugin': ['sample'] },
      renamed_skill_names: [{ id: 'sample', oldName: 'dhpk-sample', oldPath: 'skills/dhpk-sample', newName: 'sample-renamed', newPath: 'skills/sample-renamed' }],
    };
    materializeAgentsSkillsProjection({ root, inventory: renamedInventory, outDir, allowCanonicalChanges: true });
    write(path.join(outDir, 'dhpk-sample', 'third.md'), '# user dir at the old name\n');
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: renamedInventory, outDir }).ok, true);
    const result = materializeAgentsSkillsProjection({ root, inventory: renamedInventory, outDir, allowCanonicalChanges: true });
    assert.deepStrictEqual(result.preservedUnmanaged, ['dhpk-sample']);
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'dhpk-sample', 'third.md'), 'utf8'), '# user dir at the old name\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validation tolerates a symlink inside a foreign skill and a foreign top-level symlink', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    seedForeign(outDir);
    const foreignDir = fs.readdirSync(outDir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name !== 'dhpk-sample');
    assert.ok(foreignDir, 'seedForeign must create a foreign skill directory');
    fs.symlinkSync(root, path.join(outDir, foreignDir.name, 'link-inside'));
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir }).ok, true);

    fs.symlinkSync(root, path.join(outDir, 'foreign-top-link'));
    const result = validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir });
    assert.strictEqual(result.ok, true, result.errors.join('; '));

    // A symlink at a reserved name is still an error.
    fs.rmSync(path.join(outDir, 'dhpk-sample.md'));
    fs.symlinkSync(root, path.join(outDir, 'dhpk-sample.md'));
    assert.strictEqual(validateAgentsSkillsProjection({ root, inventory: INVENTORY, outDir }).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a non-empty tree without a receipt is refused and left untouched', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    write(path.join(outDir, 'foreign.md'), '# foreign\n');
    assert.throws(() => materialize(root, outDir), /OWNERSHIP_REFUSED/);
    assert.deepStrictEqual(fs.readdirSync(outDir), ['foreign.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a pre-created empty output directory publishes normally', () => {
  const root = makeRoot();
  try {
    const outDir = path.join(root, '.agents', 'skills');
    fs.mkdirSync(outDir, { recursive: true });
    materialize(root, outDir);
    assert.deepStrictEqual(tree(outDir), GOLDEN.map((row) => [...row]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the writer carries no private journal, backup, or atomic-json helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'agents-skills-package.js'), 'utf8');
  for (const pattern of [/writeAtomicJson/, /transactionPathFor/, /recoverProjectionTransaction/, /agents-skills-backup-/, /agents-skills-build-/, /dhpk\.agents-skills-transaction/]) {
    assert.ok(!pattern.test(source), `legacy private transaction remnant: ${pattern}`);
  }
});

test('the activation verifier refuses preserved content that was modified, re-moded, removed, or replaced by a symlink after planning', () => {
  const root = makeRoot();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agents-store-outside-'));
  try {
    const outDir = path.join(root, '.agents', 'skills');
    materialize(root, outDir);
    const receipt = JSON.parse(fs.readFileSync(path.join(outDir, RECEIPT_NAME), 'utf8'));
    const owned = new Set([...receipt.managedPaths, RECEIPT_NAME]);
    const isReserved = reservedNamePredicate(['dhpk-sample']);
    const target = 'dhpk-sample/references/guide.md';
    const planned = new Map([[target, { digest: crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, target))).digest('hex'), mode: fs.statSync(path.join(outDir, target)).mode & 0o7777 }]]);
    const verify = () => agentsSkillsOwnership(owned, { isReserved, files: new Map() }, planned).verify(outDir);
    assert.strictEqual(verify().ok, true);

    fs.writeFileSync(path.join(outDir, target), 'changed\n');
    assert.strictEqual(verify().ok, false, 'modified');
    fs.writeFileSync(path.join(outDir, target), '# Guide\n');
    assert.strictEqual(verify().ok, true);

    fs.chmodSync(path.join(outDir, target), 0o600);
    assert.strictEqual(verify().ok, false, 're-moded');
    fs.chmodSync(path.join(outDir, target), 0o644);
    assert.strictEqual(verify().ok, true);

    const outsideFile = path.join(outside, 'target.md');
    fs.writeFileSync(outsideFile, '# Guide\n');
    fs.rmSync(path.join(outDir, target));
    fs.symlinkSync(outsideFile, path.join(outDir, target));
    assert.strictEqual(verify().ok, false, 'replaced by symlink');
    fs.rmSync(path.join(outDir, target));
    const removed = verify();
    assert.strictEqual(removed.ok, false, 'removed');
    assert.match(removed.message, /guide\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

run('agents-skills-store-ownership');
