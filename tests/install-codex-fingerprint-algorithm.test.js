'use strict';

// Receipts and transaction journals name their fingerprint recipe, and the
// installer reads only `tree-merkle-v1` records (OpenSpec
// remove-legacy-tree-fingerprints, installer section). Every scenario runs the
// real installer in a temp project against a minimal plugin whose codex/ tree
// equals the frozen destination under tests/fixtures/tree-fingerprint/installer.
// A project is either installed by this installer (a current record) or derived
// from one by editing the record into the shape 0.69.x or an older installer
// left behind.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');
const { versionBoundaryMessage } = require('../scripts/lib/content-fingerprint');

const { ROOT, runInstaller, projectRoot, completeTreeFingerprint, LEGACY_RECIPE_DIGESTS, snapshotTree } = fixtures;
const FIXTURE = path.join(__dirname, 'fixtures', 'tree-fingerprint', 'installer');
const ALGORITHM = 'tree-merkle-v1';
const FIELD = 'fingerprint_algorithm';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const tempDir = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-fpalg-${label}-`)));

function minimalPlugin() {
  const plugin = tempDir('plugin');
  fs.cpSync(path.join(FIXTURE, 'destination'), path.join(plugin, 'codex'), { recursive: true });
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
  fs.mkdirSync(path.join(plugin, 'manifests'), { recursive: true });
  writeJson(path.join(plugin, 'manifests', 'distribution-inventory.json'), {
    skills: [{
      id: 'sample', name: 'sample-skill', path: 'skills/sample-skill', legacy_names: [],
      lifecycle: 'promoted', surfaces: ['codex-sync'],
    }],
    supporting_assets: [],
  });
  return plugin;
}

const UPDATE = ['--copy', '--update', '--force'];
const PLAN = ['--copy', '--update', '--plan', '--json', '--force'];
const output = (result) => `${result.stdout}\n${result.stderr}`;
const skillTarget = (codex) => path.join(codex, 'skills', 'sample-skill');
// Managed content only: the project lock file is not part of the projection.
const projectionOf = (codex) => ['agents', 'skills'].map((name) => snapshotTree(path.join(codex, name))).join('\n--\n');

// A project this installer installed: current receipt, copy mode.
function installedProject({ extraArgs = ['--copy', '--force'] } = {}) {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const result = runInstaller(project, extraArgs, plugin);
  assert.strictEqual(result.status, 0, output(result));
  const codex = path.join(project, '.codex');
  return { project, codex, receiptPath: path.join(codex, '.dhpk-installed.json'), plugin };
}

// Rewrites the receipt as an older installer left it: edit(receipt) mutates a
// parsed copy that is written back.
function editReceipt(receiptPath, edit) {
  const receipt = readJson(receiptPath);
  edit(receipt);
  writeJson(receiptPath, receipt);
}

// A copy-mode entry for a skill the plugin no longer ships, marked legacy as
// 0.69.x writes an entry it could not prove owned. Its files exist on disk.
function addLegacyCopyEntry(project, codex, receiptPath, { orphaned = false } = {}) {
  const relative = 'skills/retired-skill';
  fs.cpSync(skillTarget(codex), path.join(codex, relative), { recursive: true });
  editReceipt(receiptPath, (receipt) => {
    receipt.managed_entries.skills['retired-skill'] = {
      ...receipt.managed_entries.skills['sample-skill'],
      source: relative,
      destination: relative,
      ownership_marker: `copy:${relative}`,
      destination_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      source_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint_algorithm: 'legacy',
      ...(orphaned ? { orphaned: true } : {}),
    };
  });
  return relative;
}

function assertNoEntryMarker(receipt) {
  for (const [kind, values] of Object.entries(receipt.managed_entries)) {
    for (const [name, entry] of Object.entries(values)) {
      assert.ok(!(FIELD in entry), `${kind}/${name} carries an entry-level ${FIELD}`);
    }
  }
}

function assertBlocked(result, message, label) {
  assert.strictEqual(result.status, 2, `${label}\n${output(result)}`);
  // A blocked plan reports through JSON, which escapes the quotes in the text.
  let reported = '';
  try { reported = (JSON.parse(result.stdout).blocking_recovery || []).join('\n'); } catch (error) { reported = ''; }
  assert.ok(`${output(result)}\n${reported}`.includes(message), `${label}: expected\n${message}\nin\n${output(result)}`);
}

test('a fresh install writes fingerprint_algorithm in the receipt and the oracle recipe in every entry', () => {
  const { codex, receiptPath, plugin } = installedProject();
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt[FIELD], ALGORITHM);
  assertNoEntryMarker(receipt);
  const skill = receipt.managed_entries.skills['sample-skill'];
  assert.strictEqual(skill.destination_fingerprint, completeTreeFingerprint(skillTarget(codex)));
  assert.strictEqual(skill.source_fingerprint, completeTreeFingerprint(path.join(plugin, 'codex', 'skills', 'sample-skill')));
  assert.notStrictEqual(skill.destination_fingerprint, LEGACY_RECIPE_DIGESTS.skillSource);
});

test('a transaction journal written by the installer names the algorithm', () => {
  const { codex } = installedProject();
  const journals = fs.readdirSync(codex).filter((name) => /^\.dhpk-transaction-.*\.json$/.test(name));
  assert.ok(journals.length > 0, 'the installer keeps its committed journal');
  for (const name of journals) assert.strictEqual(readJson(path.join(codex, name))[FIELD], ALGORITHM);
});

test('a receipt without fingerprint_algorithm blocks install, update and plan and mutates nothing', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  editReceipt(receiptPath, (receipt) => { delete receipt[FIELD]; });
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  const names = fs.readdirSync(codex).sort();
  const message = versionBoundaryMessage(FIELD, undefined);
  for (const args of [UPDATE, ['--copy', '--force'], PLAN]) {
    assertBlocked(runInstaller(project, args, plugin), message, args.join(' '));
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before, args.join(' '));
    assert.strictEqual(projectionOf(codex), projection, args.join(' '));
    assert.deepStrictEqual(fs.readdirSync(codex).sort(), names, args.join(' '));
  }
});

// --uninstall over a record the installer cannot interpret must stay reachable:
// it deletes no destination file, removes the receipt and lists every entry.
function assertUninstallReleasesEverything(label, edit) {
  const { project, codex, receiptPath, plugin } = installedProject();
  const listed = ['skills/sample-skill', 'agents/sample.toml'];
  editReceipt(receiptPath, (receipt) => {
    edit(receipt);
    receipt.orphaned_entries = { 'skills/ghost-skill': { destination: 'skills/ghost-skill', source: 'skills/ghost-skill' } };
  });
  const projection = projectionOf(codex);
  const result = runInstaller(project, ['--uninstall', '--force'], plugin);
  assert.strictEqual(result.status, 0, `${label}\n${output(result)}`);
  for (const relative of [...listed, 'skills/ghost-skill']) {
    assert.ok(result.stdout.includes(`released: ${relative}`), `${label}: ${relative} not listed\n${output(result)}`);
  }
  assert.ok(!fs.existsSync(receiptPath), `${label}: the receipt is removed`);
  assert.strictEqual(projectionOf(codex), projection, `${label}: no destination file is deleted`);
}

test('--uninstall over a receipt without fingerprint_algorithm releases every entry and deletes no file', () => {
  assertUninstallReleasesEverything('missing', (receipt) => { delete receipt[FIELD]; });
});

test('--uninstall over a receipt naming another algorithm releases every entry and deletes no file', () => {
  assertUninstallReleasesEverything('unknown', (receipt) => { receipt[FIELD] = 'tree-merkle-v9'; });
});

test('the frozen receipt of the previous installer (no fingerprint_algorithm) blocks', () => {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const codex = path.join(project, '.codex');
  fs.cpSync(path.join(FIXTURE, 'destination'), codex, { recursive: true });
  const receiptPath = path.join(codex, '.dhpk-installed.json');
  fs.copyFileSync(path.join(FIXTURE, 'legacy-receipt.json'), receiptPath);
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  assertBlocked(runInstaller(project, UPDATE, plugin), versionBoundaryMessage(FIELD, undefined), 'update');
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  assert.strictEqual(projectionOf(codex), projection);
});

test('an unknown algorithm in a receipt blocks install, update and plan and mutates nothing', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  editReceipt(receiptPath, (receipt) => { receipt[FIELD] = 'tree-merkle-v9'; });
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  const names = fs.readdirSync(codex).sort();
  const message = versionBoundaryMessage(FIELD, 'tree-merkle-v9');
  for (const args of [UPDATE, ['--copy', '--force'], PLAN]) {
    assertBlocked(runInstaller(project, args, plugin), message, args.join(' '));
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before, args.join(' '));
    assert.strictEqual(projectionOf(codex), projection, args.join(' '));
    assert.deepStrictEqual(fs.readdirSync(codex).sort(), names, args.join(' '));
  }
});

// A journal stands for a run that 0.69.x or an older installer interrupted.
function projectWithJournal(edit) {
  const { project, codex, receiptPath, plugin } = installedProject();
  fs.rmSync(receiptPath);
  for (const name of fs.readdirSync(codex).filter((entry) => /^\.dhpk-transaction-/.test(entry))) fs.rmSync(path.join(codex, name));
  const journal = readJson(path.join(FIXTURE, 'legacy-journal.json'));
  const runId = '20261102T000000Z-4194302';
  Object.assign(journal, { phase: 'active', pid: 2 ** 22 - 3, run: runId, relative: `.dhpk-transaction-${runId}.json` });
  edit(journal);
  const journalPath = path.join(codex, journal.relative);
  writeJson(journalPath, journal);
  return { project, codex, plugin, journalPath };
}

test('a transaction journal without fingerprint_algorithm blocks recovery, the install and the plan', () => {
  const { project, codex, plugin, journalPath } = projectWithJournal((journal) => { delete journal[FIELD]; });
  assert.strictEqual(readJson(journalPath)[FIELD], undefined);
  const before = fs.readFileSync(journalPath, 'utf8');
  const projection = projectionOf(codex);
  const message = versionBoundaryMessage(FIELD, undefined);
  assertBlocked(runInstaller(project, ['--copy', '--force'], plugin), message, 'install');
  assertBlocked(runInstaller(project, UPDATE, plugin), message, 'update');
  assertBlocked(runInstaller(project, ['--copy', '--plan', '--json', '--force'], plugin), message, 'plan');
  assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), before, 'the journal is neither recovered nor rewritten');
  assert.strictEqual(projectionOf(codex), projection);
});

test('a transaction journal without fingerprint_algorithm still blocks --uninstall', () => {
  const { project, codex, plugin, journalPath } = projectWithJournal((journal) => { delete journal[FIELD]; });
  const before = fs.readFileSync(journalPath, 'utf8');
  const projection = projectionOf(codex);
  assertBlocked(runInstaller(project, ['--uninstall', '--force'], plugin), versionBoundaryMessage(FIELD, undefined), 'uninstall');
  assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), before);
  assert.strictEqual(projectionOf(codex), projection);
});

test('an unknown algorithm in an interrupted journal blocks recovery and the plan', () => {
  const { project, codex, plugin, journalPath } = projectWithJournal((journal) => { journal[FIELD] = 'other-v2'; });
  const before = fs.readFileSync(journalPath, 'utf8');
  const projection = projectionOf(codex);
  const message = versionBoundaryMessage(FIELD, 'other-v2');
  assertBlocked(runInstaller(project, ['--copy', '--force'], plugin), message, 'install');
  assertBlocked(runInstaller(project, ['--copy', '--plan', '--json', '--force'], plugin), message, 'plan');
  assert.strictEqual(fs.readFileSync(journalPath, 'utf8'), before);
  assert.strictEqual(projectionOf(codex), projection);
});

test('a legacy-marked copy entry is released: absent from the receipt, files untouched, listed in the output', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const relative = addLegacyCopyEntry(project, codex, receiptPath);
  const files = snapshotTree(path.join(codex, relative));
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.match(result.stdout, /released: skills\/retired-skill/);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt[FIELD], ALGORITHM);
  assert.ok(!('retired-skill' in receipt.managed_entries.skills), 'the released entry leaves the receipt');
  assert.ok(!JSON.stringify(receipt.orphaned_entries || {}).includes('retired-skill'), 'and is not parked as an orphan');
  assertNoEntryMarker(receipt);
  assert.strictEqual(snapshotTree(path.join(codex, relative)), files, 'the released files stay in place');
  const again = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(again.status, 0, output(again));
  assert.doesNotMatch(again.stdout, /released:/, 'a released entry is released once');
});

test('a legacy-marked orphaned entry is released and never blocks', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const relative = addLegacyCopyEntry(project, codex, receiptPath, { orphaned: true });
  const files = snapshotTree(path.join(codex, relative));
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.match(result.stdout, /released: skills\/retired-skill/);
  const receipt = readJson(receiptPath);
  assert.ok(!('retired-skill' in receipt.managed_entries.skills));
  assertNoEntryMarker(receipt);
  assert.strictEqual(snapshotTree(path.join(codex, relative)), files);
});

test('a released entry whose skill the plugin still ships is preserved as an unowned path and can be adopted', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  editReceipt(receiptPath, (receipt) => {
    Object.assign(receipt.managed_entries.skills['sample-skill'], {
      destination_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      source_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint_algorithm: 'legacy',
    });
  });
  const files = snapshotTree(skillTarget(codex));
  const result = runInstaller(project, UPDATE, plugin);
  assert.match(result.stdout, /released: skills\/sample-skill/);
  assert.match(result.stdout, /collision preserved: skills\/sample-skill/, 'the path is unowned now and follows the collision rules');
  assert.strictEqual(snapshotTree(skillTarget(codex)), files);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt[FIELD], ALGORITHM);
  assert.ok(!('sample-skill' in receipt.managed_entries.skills));
  assertNoEntryMarker(receipt);
  const planned = JSON.parse(runInstaller(project, PLAN, plugin).stdout);
  const item = planned.collisions.find((collision) => collision.path === 'skills/sample-skill');
  const adopted = runInstaller(project, [...UPDATE, `--adopt=skills/sample-skill@${item.destination_fingerprint}@${item.source_fingerprint}`], plugin);
  assert.strictEqual(adopted.status, 0, output(adopted));
  assert.ok(readJson(receiptPath).managed_entries.skills['sample-skill']);
});

test('a legacy-marked symlink entry with a matching link target is kept without the entry marker', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  // Skills are copy mode now; recreate the historical symlink representation.
  const target = skillTarget(codex);
  const source = path.join(plugin, 'codex', 'skills', 'sample-skill');
  const link = path.relative(path.dirname(target), source);
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(link, target, 'dir');
  editReceipt(receiptPath, (receipt) => {
    Object.assign(receipt.managed_entries.skills['sample-skill'], {
      mode: 'symlink',
      destination_target: link,
      ownership_marker: 'symlink:skills/sample-skill',
      destination_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      source_fingerprint: LEGACY_RECIPE_DIGESTS.skillSource,
      fingerprint_algorithm: 'legacy',
    });
  });
  const before = fs.readFileSync(receiptPath, 'utf8');
  const planned = runInstaller(project, PLAN, plugin);
  assert.deepStrictEqual(JSON.parse(planned.stdout).released || [], [], 'a proven symlink entry is not released');
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.doesNotMatch(result.stdout, /released:/);
  assert.match(result.stdout, /skipped_collision=0, collided=0/);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt[FIELD], ALGORITHM);
  assert.ok(receipt.managed_entries.skills['sample-skill'], 'the entry stays in the receipt');
  assertNoEntryMarker(receipt);
  assert.strictEqual(receipt.managed_entries.skills['sample-skill'].destination_fingerprint, completeTreeFingerprint(target));
});

test('a legacy-marked symlink entry whose link target differs from destination_target is released', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const target = skillTarget(codex);
  const source = path.join(plugin, 'codex', 'skills', 'sample-skill');
  const link = path.relative(path.dirname(target), source);
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(link, target, 'dir');
  editReceipt(receiptPath, (receipt) => {
    Object.assign(receipt.managed_entries.skills['sample-skill'], {
      mode: 'symlink',
      destination_target: '../elsewhere/sample-skill',
      ownership_marker: 'symlink:skills/sample-skill',
      fingerprint_algorithm: 'legacy',
    });
    receipt.orphaned_entries = { 'skills/sample-skill': { ...receipt.managed_entries.skills['sample-skill'], reason: 'stale' } };
  });
  const result = runInstaller(project, UPDATE, plugin);
  assert.ok([0, 1].includes(result.status), output(result));
  assert.match(result.stdout, /released: skills\/sample-skill/);
  assert.strictEqual(fs.readlinkSync(target), link, 'the link is untouched');
  const receipt = readJson(receiptPath);
  const entry = receipt.managed_entries.skills['sample-skill'];
  assert.ok(!entry || entry.destination_target !== '../elsewhere/sample-skill', 'the mismatched record is gone');
  assert.doesNotMatch(JSON.stringify(receipt), /"fingerprint_algorithm":\s*"legacy"/);
});

test('releasing a managed entry also drops its orphaned_entries record, and legacy-only orphan records are released', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const relative = addLegacyCopyEntry(project, codex, receiptPath);
  fs.cpSync(skillTarget(codex), path.join(codex, 'skills', 'ghost-skill'), { recursive: true });
  editReceipt(receiptPath, (receipt) => {
    const legacy = receipt.managed_entries.skills['retired-skill'];
    receipt.orphaned_entries = {
      [relative]: { ...legacy, reason: 'modified-before-uninstall' },
      'skills/ghost-skill': {
        ...legacy, source: 'skills/ghost-skill', destination: 'skills/ghost-skill', ownership_marker: 'copy:skills/ghost-skill',
      },
    };
  });
  const files = snapshotTree(path.join(codex, relative));
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.match(result.stdout, /released: skills\/retired-skill/);
  assert.match(result.stdout, /released: skills\/ghost-skill/);
  const receipt = readJson(receiptPath);
  assert.deepStrictEqual(Object.keys(receipt.orphaned_entries || {}), [], JSON.stringify(receipt.orphaned_entries));
  assert.doesNotMatch(JSON.stringify(receipt), /"fingerprint_algorithm":\s*"legacy"/);
  assert.strictEqual(snapshotTree(path.join(codex, relative)), files);
  assert.ok(fs.existsSync(path.join(codex, 'skills', 'ghost-skill')), 'orphan files stay in place');
});

test('a plan lists the entries an update would release and writes nothing', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const relative = addLegacyCopyEntry(project, codex, receiptPath);
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  const names = fs.readdirSync(codex).sort();
  const planned = runInstaller(project, PLAN, plugin);
  assert.strictEqual(planned.status, 1, output(planned));
  assert.deepStrictEqual(JSON.parse(planned.stdout).released.map((item) => item.path), [relative]);
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  assert.strictEqual(projectionOf(codex), projection);
  assert.deepStrictEqual(fs.readdirSync(codex).sort(), names);
  const text = runInstaller(project, ['--copy', '--update', '--plan', '--force'], plugin);
  assert.match(text.stdout, /released: skills\/retired-skill/);
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
});

test('a real edit under a tree-merkle-v1 receipt is still detected as a modified collision', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  fs.appendFileSync(notes, 'edited by the user\n');
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 1, output(result));
  assert.match(output(result), /collision/i);
  assert.doesNotMatch(result.stdout, /released:/);
  assert.match(fs.readFileSync(notes, 'utf8'), /edited by the user/);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt.state, 'partial');
  assert.ok(receipt.reconciliation.skipped_collision >= 1);
});

test('a destination holding a symlink never matches the source and is a collision', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  const content = fs.readFileSync(notes);
  const real = path.join(project, 'notes-real.md');
  fs.writeFileSync(real, content);
  fs.rmSync(notes);
  fs.symlinkSync(real, notes);
  const before = fs.readFileSync(receiptPath, 'utf8');
  const planned = runInstaller(project, PLAN, plugin);
  assert.strictEqual(planned.status, 1, output(planned));
  const item = JSON.parse(planned.stdout).collisions.find((collision) => collision.path === 'skills/sample-skill');
  assert.ok(item, planned.stdout);
  assert.notStrictEqual(item.destination_fingerprint, item.source_fingerprint);
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 1, output(result));
  assert.ok(fs.lstatSync(notes).isSymbolicLink(), 'the symlink is preserved');
  assert.strictEqual(readJson(receiptPath).state, 'partial');
  assert.notStrictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
});

test('an --adopt request carrying previous-installer fingerprints requires a fresh plan', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const target = skillTarget(codex);
  fs.appendFileSync(path.join(target, 'references', 'notes.md'), 'edited\n');
  const before = fs.readFileSync(receiptPath, 'utf8');
  const stale = `skills/sample-skill@${LEGACY_RECIPE_DIGESTS.skillAfterNotesEdit}@${LEGACY_RECIPE_DIGESTS.skillSource}`;
  const result = runInstaller(project, [...UPDATE, `--adopt=${stale}`], plugin);
  assert.strictEqual(result.status, 2, output(result));
  assert.match(result.stderr, /adoption preflight changed: skills\/sample-skill; run a fresh plan/);
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  assert.match(fs.readFileSync(path.join(target, 'references', 'notes.md'), 'utf8'), /edited/);
});

test('an --adopt request taken from a fresh plan of this installer succeeds', () => {
  const { project, codex, receiptPath, plugin } = installedProject();
  const target = skillTarget(codex);
  fs.appendFileSync(path.join(target, 'references', 'notes.md'), 'edited\n');
  const planned = runInstaller(project, PLAN, plugin);
  const item = JSON.parse(planned.stdout).collisions.find((collision) => collision.path === 'skills/sample-skill');
  assert.ok(item, planned.stdout);
  assert.strictEqual(item.destination_fingerprint, completeTreeFingerprint(target));
  const result = runInstaller(project, [...UPDATE, `--adopt=skills/sample-skill@${item.destination_fingerprint}@${item.source_fingerprint}`], plugin);
  assert.strictEqual(result.status, 0, output(result));
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt[FIELD], ALGORITHM);
  assert.strictEqual(receipt.managed_entries.skills['sample-skill'].destination_fingerprint, completeTreeFingerprint(target));
  assert.strictEqual(receipt.managed_entries.agents['sample.toml'].destination_fingerprint, completeTreeFingerprint(path.join(codex, 'agents', 'sample.toml')));
});

run('install-codex-fingerprint-algorithm');
