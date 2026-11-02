'use strict';

// Receipts and transaction journals name their fingerprint recipe
// (OpenSpec unify-tree-fingerprint-algorithm, installer section). The frozen
// pre-change receipt and journal under tests/fixtures/tree-fingerprint/installer
// stand for a project installed by the previous installer; every scenario here
// runs the real installer in a temp project against a minimal plugin whose
// codex/ tree equals that frozen destination.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');

const { ROOT, runInstaller, projectRoot, completeTreeFingerprint, legacyCompleteTreeFingerprint } = fixtures;
const FIXTURE = path.join(__dirname, 'fixtures', 'tree-fingerprint', 'installer');
const ALGORITHM = 'tree-merkle-v1';

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

// A project the previous installer left behind: the frozen destination and the
// frozen receipt (no fingerprint_algorithm).
function legacyProject() {
  const project = projectRoot();
  const codex = path.join(project, '.codex');
  fs.cpSync(path.join(FIXTURE, 'destination'), codex, { recursive: true });
  const receiptPath = path.join(codex, '.dhpk-installed.json');
  fs.copyFileSync(path.join(FIXTURE, 'legacy-receipt.json'), receiptPath);
  return { project, codex, receiptPath, plugin: minimalPlugin() };
}

const UPDATE = ['--copy', '--update', '--force'];
const output = (result) => `${result.stdout}\n${result.stderr}`;
const skillTarget = (codex) => path.join(codex, 'skills', 'sample-skill');
// Managed content only: the project lock file is not part of the projection.
const projectionOf = (codex) => ['agents', 'skills'].map((name) => legacyCompleteTreeFingerprint(path.join(codex, name))).join(':');

test('a fresh install writes fingerprint_algorithm in the receipt and the oracle recipe in every entry', () => {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const result = runInstaller(project, ['--copy', '--force'], plugin);
  assert.strictEqual(result.status, 0, output(result));
  const receipt = readJson(path.join(project, '.codex', '.dhpk-installed.json'));
  assert.strictEqual(receipt.fingerprint_algorithm, ALGORITHM);
  const skill = receipt.managed_entries.skills['sample-skill'];
  assert.strictEqual(skill.destination_fingerprint, completeTreeFingerprint(skillTarget(path.join(project, '.codex'))));
  assert.strictEqual(skill.source_fingerprint, completeTreeFingerprint(path.join(plugin, 'codex', 'skills', 'sample-skill')));
  assert.notStrictEqual(skill.destination_fingerprint, readJson(path.join(FIXTURE, 'legacy-receipt.json')).managed_entries.skills['sample-skill'].destination_fingerprint);
});

test('a transaction journal written by the installer names the algorithm', () => {
  const project = projectRoot();
  const result = runInstaller(project, ['--copy', '--force'], minimalPlugin());
  assert.strictEqual(result.status, 0, output(result));
  const journals = fs.readdirSync(path.join(project, '.codex')).filter((name) => /^\.dhpk-transaction-.*\.json$/.test(name));
  assert.ok(journals.length > 0, 'the installer keeps its committed journal');
  for (const name of journals) assert.strictEqual(readJson(path.join(project, '.codex', name)).fingerprint_algorithm, ALGORITHM);
});

test('legacy receipt proves ownership, then the update rewrites every entry and the next run is a no-op', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const updated = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(updated.status, 0, output(updated));
  assert.match(output(updated), /skipped_collision=0, collided=0/);
  assert.match(output(updated), /preserved=0/);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt.fingerprint_algorithm, ALGORITHM);
  assert.strictEqual(receipt.state, 'current');
  for (const [kind, name, target] of [['skills', 'sample-skill', skillTarget(codex)], ['agents', 'sample.toml', path.join(codex, 'agents', 'sample.toml')]]) {
    assert.strictEqual(receipt.managed_entries[kind][name].destination_fingerprint, completeTreeFingerprint(target), `${kind}/${name}`);
    assert.strictEqual(receipt.managed_entries[kind][name].fingerprint, completeTreeFingerprint(target), `${kind}/${name}`);
  }
  const again = runInstaller(project, ['--copy', '--force'], plugin);
  assert.strictEqual(again.status, 0, output(again));
  assert.match(output(again), /already up-to-date/);
});

test('a plain run over a legacy receipt upgrades it without reporting an edit', () => {
  const { project, receiptPath, plugin } = legacyProject();
  const result = runInstaller(project, ['--copy', '--force'], plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.match(output(result), /skipped_collision=0, collided=0/);
  assert.strictEqual(readJson(receiptPath).fingerprint_algorithm, ALGORITHM);
});

test('a real edit under a legacy receipt is still detected as a modified collision', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  fs.appendFileSync(notes, 'edited by the user\n');
  const result = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(result.status, 1, output(result));
  assert.match(output(result), /collision/i);
  assert.match(fs.readFileSync(notes, 'utf8'), /edited by the user/);
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt.state, 'partial');
  assert.ok(receipt.reconciliation.skipped_collision >= 1);
});

test('an unproven legacy entry kept in a tree-merkle-v1 receipt is marked legacy and proven again once the edit is reverted', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  const original = fs.readFileSync(notes, 'utf8');
  const legacySkill = readJson(receiptPath).managed_entries.skills['sample-skill'];
  fs.appendFileSync(notes, 'edited by the user\n');
  const blocked = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(blocked.status, 1, output(blocked));
  const held = readJson(receiptPath);
  assert.strictEqual(held.fingerprint_algorithm, ALGORITHM);
  const carried = held.managed_entries.skills['sample-skill'];
  assert.strictEqual(carried.destination_fingerprint, legacySkill.destination_fingerprint);
  assert.strictEqual(carried.fingerprint_algorithm, 'legacy', 'a legacy value is never presented as tree-merkle-v1');
  assert.ok(!('fingerprint_algorithm' in held.managed_entries.agents['sample.toml']), 'rewritten entries follow the receipt');
  fs.writeFileSync(notes, original);
  const migrated = runInstaller(project, UPDATE, plugin);
  assert.strictEqual(migrated.status, 0, output(migrated));
  assert.match(output(migrated), /skipped_collision=0, collided=0/);
  const receipt = readJson(receiptPath);
  const rewritten = receipt.managed_entries.skills['sample-skill'];
  assert.strictEqual(rewritten.destination_fingerprint, completeTreeFingerprint(skillTarget(codex)));
  assert.ok(!('fingerprint_algorithm' in rewritten));
});

test('a legacy receipt is not rewritten by a read-only plan', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  const planned = runInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
  assert.strictEqual(planned.status, 1, output(planned));
  assert.match(JSON.parse(planned.stdout).reasons.join('\n'), /no fingerprint_algorithm/);
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  assert.strictEqual(projectionOf(codex), projection);
  assert.doesNotMatch(JSON.stringify(JSON.parse(planned.stdout).collisions || []), /sample/);
});

test('an in-flight legacy journal recovers by the legacy recipe with no spurious mismatch', () => {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const codex = path.join(project, '.codex');
  fs.cpSync(path.join(FIXTURE, 'destination'), codex, { recursive: true });
  const journal = readJson(path.join(FIXTURE, 'legacy-journal.json'));
  const runId = '20261102T000000Z-4194300';
  Object.assign(journal, { phase: 'active', pid: 2 ** 22 - 3, run: runId, relative: `.dhpk-transaction-${runId}.json` });
  assert.strictEqual(journal.fingerprint_algorithm, undefined);
  writeJson(path.join(codex, journal.relative), journal);
  const result = runInstaller(project, ['--copy', '--force'], plugin);
  assert.strictEqual(result.status, 0, output(result));
  assert.doesNotMatch(output(result), /rollback preserved changed destination|recovery failed/);
  const receipt = readJson(path.join(codex, '.dhpk-installed.json'));
  assert.strictEqual(receipt.fingerprint_algorithm, ALGORITHM);
  assert.strictEqual(readJson(path.join(codex, journal.relative)).phase, 'rolled_back');
});

test('an in-flight legacy journal whose destination was edited preserves the edit', () => {
  const project = projectRoot();
  const plugin = minimalPlugin();
  const codex = path.join(project, '.codex');
  fs.cpSync(path.join(FIXTURE, 'destination'), codex, { recursive: true });
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  fs.appendFileSync(notes, 'edited after the interrupted run\n');
  const journal = readJson(path.join(FIXTURE, 'legacy-journal.json'));
  const runId = '20261102T000000Z-4194301';
  Object.assign(journal, { phase: 'active', pid: 2 ** 22 - 3, run: runId, relative: `.dhpk-transaction-${runId}.json` });
  writeJson(path.join(codex, journal.relative), journal);
  const result = runInstaller(project, ['--copy', '--force'], plugin);
  assert.notStrictEqual(result.status, 0, output(result));
  assert.match(output(result), /rollback preserved changed destination/);
  assert.match(fs.readFileSync(notes, 'utf8'), /edited after the interrupted run/);
});

test('an unknown algorithm in a receipt blocks every mode and mutates nothing', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const receipt = readJson(receiptPath);
  receipt.fingerprint_algorithm = 'tree-merkle-v9';
  writeJson(receiptPath, receipt);
  const before = fs.readFileSync(receiptPath, 'utf8');
  const projection = projectionOf(codex);
  const names = fs.readdirSync(codex).sort();
  for (const args of [UPDATE, ['--copy', '--force'], ['--copy', '--update', '--plan', '--json', '--force'], ['--uninstall', '--force']]) {
    const result = runInstaller(project, args, plugin);
    assert.notStrictEqual(result.status, 0, `${args.join(' ')}\n${output(result)}`);
    assert.match(result.stderr, /fingerprint_algorithm 'tree-merkle-v9' is not supported/, args.join(' '));
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before, args.join(' '));
    assert.strictEqual(projectionOf(codex), projection, args.join(' '));
    assert.deepStrictEqual(fs.readdirSync(codex).sort(), names, args.join(' '));
  }
});

test('an unknown algorithm in an interrupted journal blocks recovery and the plan', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  fs.rmSync(receiptPath);
  const journal = readJson(path.join(FIXTURE, 'legacy-journal.json'));
  const runId = '20261102T000000Z-4194302';
  Object.assign(journal, { phase: 'active', pid: 2 ** 22 - 3, run: runId, relative: `.dhpk-transaction-${runId}.json`, fingerprint_algorithm: 'other-v2' });
  writeJson(path.join(codex, journal.relative), journal);
  const projection = projectionOf(codex);
  const installed = runInstaller(project, ['--copy', '--force'], plugin);
  assert.notStrictEqual(installed.status, 0, output(installed));
  assert.match(installed.stderr, /fingerprint_algorithm 'other-v2' is not supported/);
  const planned = runInstaller(project, ['--copy', '--plan', '--json', '--force'], plugin);
  assert.strictEqual(planned.status, 2, output(planned));
  assert.match(planned.stdout, /fingerprint_algorithm 'other-v2' is not supported/);
  assert.strictEqual(projectionOf(codex), projection);
});

test('a destination holding a symlink never matches the source and is a collision', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const notes = path.join(skillTarget(codex), 'references', 'notes.md');
  const content = fs.readFileSync(notes);
  const real = path.join(project, 'notes-real.md');
  fs.writeFileSync(real, content);
  fs.rmSync(notes);
  fs.symlinkSync(real, notes);
  const before = fs.readFileSync(receiptPath, 'utf8');
  const planned = runInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
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
  const { project, codex, receiptPath, plugin } = legacyProject();
  const target = skillTarget(codex);
  fs.appendFileSync(path.join(target, 'references', 'notes.md'), 'edited\n');
  const legacyDestination = legacyCompleteTreeFingerprint(target);
  const legacySource = legacyCompleteTreeFingerprint(path.join(plugin, 'codex', 'skills', 'sample-skill'));
  const before = fs.readFileSync(receiptPath, 'utf8');
  const result = runInstaller(project, [...UPDATE, `--adopt=skills/sample-skill@${legacyDestination}@${legacySource}`], plugin);
  assert.strictEqual(result.status, 2, output(result));
  assert.match(result.stderr, /adoption preflight changed: skills\/sample-skill; run a fresh plan/);
  assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before);
  assert.match(fs.readFileSync(path.join(target, 'references', 'notes.md'), 'utf8'), /edited/);
});

test('an --adopt request taken from a fresh plan of this installer succeeds', () => {
  const { project, codex, receiptPath, plugin } = legacyProject();
  const target = skillTarget(codex);
  fs.appendFileSync(path.join(target, 'references', 'notes.md'), 'edited\n');
  const planned = runInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
  const item = JSON.parse(planned.stdout).collisions.find((collision) => collision.path === 'skills/sample-skill');
  assert.ok(item, planned.stdout);
  assert.strictEqual(item.destination_fingerprint, completeTreeFingerprint(target));
  const result = runInstaller(project, [...UPDATE, `--adopt=skills/sample-skill@${item.destination_fingerprint}@${item.source_fingerprint}`], plugin);
  assert.strictEqual(result.status, 0, output(result));
  const receipt = readJson(receiptPath);
  assert.strictEqual(receipt.fingerprint_algorithm, ALGORITHM);
  assert.strictEqual(receipt.managed_entries.skills['sample-skill'].destination_fingerprint, completeTreeFingerprint(target));
  assert.strictEqual(receipt.managed_entries.agents['sample.toml'].destination_fingerprint, completeTreeFingerprint(path.join(codex, 'agents', 'sample.toml')));
});

run('install-codex-fingerprint-algorithm');
