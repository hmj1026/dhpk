'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');
const {
  resolveAgyInstallRoot,
  installAgyPlugin,
  inspectAgyPlugin,
  sourceFileDigests,
  compareSourceInventory,
  rollbackAgyPlugin,
} = require('../scripts/lib/agy-plugin-install');
const { createTraversalBudget } = require('../scripts/lib/bounded-filesystem');

const COMMIT = 'b'.repeat(40);

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agy-install-test-'));
}

function fixture(root, body = '# Agent\n') {
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'sample.md'), [
    '---', 'name: sample', 'description: Sample', 'tools: ["read_file"]', 'model: inherit', '---', '', body,
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'rules', 'sample.md'), '# Rule\n');
  fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Sample\n---\n# Skill\n');
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
    modules: [],
    surface_membership: { 'agy-plugin': ['sample'] },
    agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
  };
}

function packageFixture(root, body) {
  const source = path.join(root, 'source');
  const output = path.join(root, 'package');
  const inventory = fixture(source, body);
  materializeAgyPluginPackage({
    root: source,
    inventory,
    outDir: output,
    version: '0.39.0',
    sourceVersion: '0.39.0',
    sourceCommit: COMMIT,
  });
  return { source, output };
}

test('resolves the documented user AGY install location', () => {
  assert.strictEqual(resolveAgyInstallRoot('/tmp/demo-home'), '/tmp/demo-home/.gemini/config/plugins/dhpk');
});

test('installs, updates, and rolls back only receipt-owned files', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# First\n');
    const target = path.join(root, 'home/.gemini/config/plugins/dhpk');
    const installed = installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
    assert.ok(installed.installed.includes('provenance.json'));
    assert.ok(fs.existsSync(path.join(target, 'agents/sample.md')));
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep\n');

    const second = packageFixture(root, '# Second\n');
    const updated = installAgyPlugin({ sourceRoot: second.output, targetRoot: target, mode: 'update' });
    assert.ok(updated.previousReceipt);
    assert.ok(fs.readFileSync(path.join(target, 'agents/sample.md'), 'utf8').includes('# Second'));

    const rolledBack = rollbackAgyPlugin({ targetRoot: target });
    assert.ok(rolledBack.removed.includes('provenance.json'));
    assert.ok(fs.existsSync(path.join(target, 'user-owned.txt')));
    assert.ok(!fs.existsSync(path.join(target, 'agents/sample.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects foreign collisions and changed owned files', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# First\n');
    const foreign = path.join(root, 'foreign-target');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'plugin.json'), '{"name":"someone-else"}\n');
    assert.throws(() => installAgyPlugin({ sourceRoot: first.output, targetRoot: foreign, mode: 'install' }), /collision/);
    assert.strictEqual(fs.readFileSync(path.join(foreign, 'plugin.json'), 'utf8'), '{"name":"someone-else"}\n');

    const target = path.join(root, 'owned-target');
    installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
    fs.appendFileSync(path.join(target, 'agents/sample.md'), '\nuser edit\n');
    assert.throws(() => rollbackAgyPlugin({ targetRoot: target }), /collision/);
    assert.ok(fs.existsSync(path.join(target, 'provenance.json')));

    const metadataTarget = path.join(root, 'metadata-target');
    installAgyPlugin({ sourceRoot: first.output, targetRoot: metadataTarget, mode: 'install' });
    fs.appendFileSync(path.join(metadataTarget, 'fingerprints.json'), '\n');
    assert.throws(() => rollbackAgyPlugin({ targetRoot: metadataTarget }), /collision/);
    assert.ok(fs.existsSync(path.join(metadataTarget, 'plugin.json')));

    const symlinkTarget = path.join(root, 'symlink-target');
    installAgyPlugin({ sourceRoot: first.output, targetRoot: symlinkTarget, mode: 'install' });
    const outsideMetadata = path.join(root, 'outside-fingerprints.json');
    fs.copyFileSync(path.join(symlinkTarget, 'fingerprints.json'), outsideMetadata);
    fs.unlinkSync(path.join(symlinkTarget, 'fingerprints.json'));
    fs.symlinkSync(outsideMetadata, path.join(symlinkTarget, 'fingerprints.json'));
    assert.throws(() => rollbackAgyPlugin({ targetRoot: symlinkTarget }), /collision|symlink|regular file/);
    assert.ok(fs.existsSync(path.join(symlinkTarget, 'plugin.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps the live installation unchanged when staging fails', () => {
  const root = tmp();
  const originalCopyFileSync = fs.copyFileSync;
  try {
    const first = packageFixture(root, '# First\n');
    const target = path.join(root, 'atomic-target');
    installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep\n');
    const beforeReceipt = fs.readFileSync(path.join(target, 'provenance.json'), 'utf8');

    const second = packageFixture(root, '# Second\n');
    fs.copyFileSync = (...args) => {
      if (String(args[1]).endsWith(path.join('rules', 'sample.md'))) throw new Error('injected AGY staging failure');
      return originalCopyFileSync(...args);
    };
    assert.throws(
      () => installAgyPlugin({ sourceRoot: second.output, targetRoot: target, mode: 'update' }),
      /injected AGY staging failure/,
    );
    assert.strictEqual(fs.readFileSync(path.join(target, 'provenance.json'), 'utf8'), beforeReceipt);
    assert.ok(fs.readFileSync(path.join(target, 'agents/sample.md'), 'utf8').includes('# First'));
    assert.strictEqual(fs.readFileSync(path.join(target, 'user-owned.txt'), 'utf8'), 'keep\n');
    assert.deepStrictEqual(
      fs.readdirSync(path.dirname(target)).filter((name) => name.includes('.agy-plugin-stage-') || name.includes('.agy-plugin-backup-')),
      [],
    );
  } finally {
    fs.copyFileSync = originalCopyFileSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only inspection classifies a foreign Git checkout with bounded evidence', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# Source\n');
    const target = path.join(root, 'foreign-target');
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugin.json'), JSON.stringify({
      name: 'dhpk',
      version: '0.38.0',
    }) + '\n');
    const beforeManifest = fs.readFileSync(path.join(target, 'plugin.json'), 'utf8');
    const report = inspectAgyPlugin({ sourceRoot: first.output, targetRoot: target });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.state, 'BLOCKED');
    assert.strictEqual(report.classification, 'FOREIGN_CHECKOUT');
    assert.strictEqual(report.target.git_marker.present, true);
    assert.strictEqual(report.target.manifest.version, '0.38.0');
    assert.strictEqual(report.target.receipt.present, false);
    assert.ok(report.diff.counts.changed >= 1, JSON.stringify(report));
    assert.ok(report.diff.counts.missing >= 1, JSON.stringify(report));
    assert.ok(report.diff.changed_preview.length <= report.diff.preview_limit);
    assert.ok(report.diff.missing_preview.length <= report.diff.preview_limit);
    assert.match(report.next_action, /back up|move|retire/i);
    assert.strictEqual(report.mutation.performed, false);
    assert.strictEqual(fs.readFileSync(path.join(target, 'plugin.json'), 'utf8'), beforeManifest);
    assert.deepStrictEqual(fs.readdirSync(target).sort(), ['.git', 'plugin.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only inspection reports an owned current target without mutation', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# Current\n');
    const target = path.join(root, 'owned-target');
    installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
    const beforeReceipt = fs.readFileSync(path.join(target, 'provenance.json'), 'utf8');
    const report = inspectAgyPlugin({ sourceRoot: first.output, targetRoot: target });
    assert.strictEqual(report.status, 'PASS');
    assert.strictEqual(report.state, 'CURRENT');
    assert.strictEqual(report.classification, 'AGY_OWNED');
    assert.strictEqual(report.diff.counts.changed, 0);
    assert.strictEqual(report.diff.counts.missing, 0);
    assert.strictEqual(report.diff.counts.same, report.source.file_count);
    assert.strictEqual(report.mutation.performed, false);
    assert.strictEqual(fs.readFileSync(path.join(target, 'provenance.json'), 'utf8'), beforeReceipt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inspection does not follow a symlinked target ancestor', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# Source\n');
    const target = path.join(root, 'unsafe-target');
    const outside = path.join(root, 'outside-agy');
    fs.mkdirSync(path.join(outside, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(target), { recursive: true });
    fs.symlinkSync(path.join(outside, 'agents'), path.join(target, 'agents'));
    const report = inspectAgyPlugin({ sourceRoot: first.output, targetRoot: target });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.ok(report.diff.unsafe_preview.includes('agents/sample.md'), JSON.stringify(report));
    assert.strictEqual(fs.readdirSync(outside, { withFileTypes: true }).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('read-only inspection classifies an invalid receipt as foreign', () => {
  const root = tmp();
  try {
    const first = packageFixture(root, '# Source\n');
    const target = path.join(root, 'invalid-receipt-target');
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.writeFileSync(path.join(target, 'plugin.json'), '{"name":"dhpk","version":"0.38.0"}\n');
    fs.writeFileSync(path.join(target, 'provenance.json'), '{not-json}\n');
    const report = inspectAgyPlugin({ sourceRoot: first.output, targetRoot: target });
    assert.strictEqual(report.status, 'BLOCKED');
    assert.strictEqual(report.classification, 'FOREIGN_CHECKOUT');
    assert.strictEqual(report.target.receipt.present, true);
    assert.strictEqual(report.target.receipt.valid, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inventory reads enforce one aggregate byte budget across files', () => {
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, 'one.txt'), '12345');
    fs.writeFileSync(path.join(root, 'two.txt'), '67890');
    assert.throws(
      () => sourceFileDigests(root, ['one.txt', 'two.txt'], createTraversalBudget({ maxBytes: 9 })),
      /maximum fingerprint byte budget/,
    );
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    fs.copyFileSync(path.join(root, 'one.txt'), path.join(target, 'one.txt'));
    fs.copyFileSync(path.join(root, 'two.txt'), path.join(target, 'two.txt'));
    assert.throws(
      () => compareSourceInventory(root, target, ['one.txt', 'two.txt'], {}, createTraversalBudget({ maxBytes: 9 })),
      /maximum fingerprint byte budget/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('agy-plugin-install');
