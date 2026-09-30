'use strict';

const { test, run, assert } = require('./_lib/tinytest');

{
  // Source suite: tests/agy-plugin-install.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');
  const {
    resolveAgyInstallRoot,
    inspectAgyInstallTargets,
    observeAgyInstallCandidate,
    resolveAgyInstallTarget,
    installAgyPlugin,
    migrateAgyPlugin,
    inspectAgyPlugin,
    sourceFileDigests,
    compareSourceInventory,
    rollbackAgyPlugin,
  } = require('../scripts/lib/agy-plugin-install');
  const { createTraversalBudget } = require('../scripts/lib/bounded-filesystem');

  const COMMIT = 'b'.repeat(40);

  function tmp() {
    return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-install-test-'));
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

  function packageVariantFixture(root, name, options = {}) {
    const source = path.join(root, `${name}-source`);
    const output = path.join(root, `${name}-package`);
    const inventory = fixture(source, options.body || '# Agent\n');
    if (options.includeRule === false) inventory.agy_plugin.rules = [];
    if (options.extraRule) {
      const relative = options.extraRule.path || 'rules/added.md';
      fs.writeFileSync(path.join(source, relative), options.extraRule.body || '# Added\n');
      inventory.agy_plugin.rules = [...inventory.agy_plugin.rules, relative];
    }
    materializeAgyPluginPackage({
      root: source,
      inventory,
      outDir: output,
      version: options.version || '0.39.0',
      sourceVersion: options.version || '0.39.0',
      sourceCommit: COMMIT,
    });
    return { source, output };
  }

  function inspectVariantDrift(root, oldOptions, newOptions) {
    const oldPackage = packageVariantFixture(root, 'old', oldOptions);
    const target = path.join(root, 'owned-target');
    installAgyPlugin({ sourceRoot: oldPackage.output, targetRoot: target, mode: 'install' });
    const newPackage = packageVariantFixture(root, 'new', newOptions);
    return inspectAgyPlugin({ sourceRoot: newPackage.output, targetRoot: target });
  }

  function installedVariant(root, options = {}) {
    const installed = packageVariantFixture(root, 'installed', options);
    const target = path.join(root, 'owned-target');
    installAgyPlugin({ sourceRoot: installed.output, targetRoot: target, mode: 'install' });
    return { ...installed, target };
  }

  test('resolves the documented user AGY install location', () => {
    assert.strictEqual(resolveAgyInstallRoot('/tmp/demo-home'), '/tmp/demo-home/.gemini/antigravity-cli/plugins/dhpk');
  });

  test('classifies an absent target as canonical and a legacy target without mutating it', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const absent = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(absent.status, 'PASS');
      assert.strictEqual(absent.target_role, 'canonical');
      assert.strictEqual(absent.state, 'READY');

      const legacy = path.join(root, '.gemini/config/plugins/dhpk');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: legacy, mode: 'install' });
      const before = fs.readFileSync(path.join(legacy, 'provenance.json'), 'utf8');
      const report = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.classification, 'LEGACY_OWNED');
      assert.strictEqual(report.state, 'LEGACY');
      assert.match(report.next_action, /migrate/);
      assert.strictEqual(fs.readFileSync(path.join(legacy, 'provenance.json'), 'utf8'), before);
      assert.throws(() => resolveAgyInstallTarget({ homeDirectory: root }), /legacy installation/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('blocks ambiguous canonical and legacy targets and migrates only with explicit intent', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const canonical = path.join(root, '.gemini/antigravity-cli/plugins/dhpk');
      const legacy = path.join(root, '.gemini/config/plugins/dhpk');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: canonical, mode: 'install' });
      installAgyPlugin({ sourceRoot: first.output, targetRoot: legacy, mode: 'install' });
      const ambiguous = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(ambiguous.status, 'BLOCKED');
      assert.strictEqual(ambiguous.classification, 'AMBIGUOUS_TARGETS');
      assert.throws(() => resolveAgyInstallTarget({ homeDirectory: root }), /ambiguous/);

      fs.rmSync(canonical, { recursive: true, force: true });
      const migrated = migrateAgyPlugin({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(migrated.status, 'PASS');
      assert.strictEqual(migrated.classification, 'MIGRATED_LEGACY');
      assert.ok(fs.existsSync(path.join(canonical, 'provenance.json')));
      assert.ok(!fs.existsSync(path.join(legacy, 'provenance.json')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('ignores empty and incidental legacy directories after migration', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const canonical = path.join(root, '.gemini/antigravity-cli/plugins/dhpk');
      const legacy = path.join(root, '.gemini/config/plugins/dhpk');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: legacy, mode: 'install' });
      migrateAgyPlugin({ sourceRoot: first.output, homeDirectory: root });

      const empty = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(empty.status, 'PASS', JSON.stringify(empty));
      assert.strictEqual(empty.target_role, 'canonical');

      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, '.DS_Store'), 'incidental\n');
      const incidental = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(incidental.status, 'PASS', JSON.stringify(incidental));
      assert.strictEqual(incidental.target_role, 'canonical');
      assert.ok(fs.existsSync(path.join(canonical, 'provenance.json')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps a foreign legacy checkout visible beside the canonical target', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const canonical = path.join(root, '.gemini/antigravity-cli/plugins/dhpk');
      const legacy = path.join(root, '.gemini/config/plugins/dhpk');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: canonical, mode: 'install' });
      fs.mkdirSync(path.join(legacy, '.git'), { recursive: true });
      fs.writeFileSync(path.join(legacy, 'plugin.json'), '{"name":"foreign"}\n');

      const report = inspectAgyInstallTargets({ sourceRoot: first.output, homeDirectory: root });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.classification, 'AMBIGUOUS_TARGETS');
      assert.ok(report.candidates.some((candidate) => candidate.role === 'legacy-1' && candidate.exists));
      assert.match(report.next_action, /target|ambiguity/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('lifecycle observation distinguishes invalid receipts and modified managed content', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const target = path.join(root, '.gemini/antigravity-cli/plugins/dhpk');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
      fs.appendFileSync(path.join(target, 'agents/sample.md'), '\n# local edit\n');
      const modified = observeAgyInstallCandidate({ role: 'canonical', root: target });
      assert.strictEqual(modified.installed, true);
      assert.strictEqual(modified.classification, 'MODIFIED_MANAGED');

      fs.writeFileSync(path.join(target, 'provenance.json'), '{not-json}\n');
      const invalid = observeAgyInstallCandidate({ role: 'canonical', root: target });
      assert.strictEqual(invalid.installed, true);
      assert.strictEqual(invalid.classification, 'INVALID_RECEIPT');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  test('read-only inspection treats intact same-version source drift as stale', () => {
    const root = tmp();
    try {
      const first = packageFixture(root, '# First\n');
      const target = path.join(root, 'owned-target');
      installAgyPlugin({ sourceRoot: first.output, targetRoot: target, mode: 'install' });
      const beforeTargetReceipt = fs.readFileSync(path.join(target, 'provenance.json'), 'utf8');

      const second = packageFixture(root, '# Second\n');
      const beforeSource = fs.readFileSync(path.join(second.output, 'agents/sample.md'), 'utf8');
      const report = inspectAgyPlugin({ sourceRoot: second.output, targetRoot: target });

      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.ok(report.diff.counts.changed >= 1, JSON.stringify(report));
      assert.match(report.next_action, /update/i);
      assert.strictEqual(fs.readFileSync(path.join(second.output, 'agents/sample.md'), 'utf8'), beforeSource);
      assert.strictEqual(fs.readFileSync(path.join(target, 'provenance.json'), 'utf8'), beforeTargetReceipt);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection reports changed source as stale across versions', () => {
    const root = tmp();
    try {
      const report = inspectVariantDrift(root,
        { version: '0.39.0', body: '# First\n' },
        { version: '0.40.0', body: '# Second\n' });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.ok(report.diff.counts.changed >= 1, JSON.stringify(report));
      assert.match(report.next_action, /update/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection reports added source as stale across versions', () => {
    const root = tmp();
    try {
      const report = inspectVariantDrift(root,
        { version: '0.39.0', includeRule: false },
        { version: '0.40.0', extraRule: { path: 'rules/added.md', body: '# Added\n' } });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.ok(report.diff.missing_preview.includes('rules/added.md'), JSON.stringify(report));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection reports removed source as stale across versions', () => {
    const root = tmp();
    try {
      const report = inspectVariantDrift(root,
        { version: '0.39.0' },
        { version: '0.40.0', includeRule: false });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.strictEqual(report.source.version, '0.40.0');
      assert.strictEqual(report.source.file_count, 5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection reports added source as stale at the same version', () => {
    const root = tmp();
    try {
      const report = inspectVariantDrift(root,
        { version: '0.39.0', includeRule: false },
        { version: '0.39.0', extraRule: { path: 'rules/added.md', body: '# Added\n' } });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.ok(report.diff.missing_preview.includes('rules/added.md'), JSON.stringify(report));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection reports removed source as stale at the same version', () => {
    const root = tmp();
    try {
      const report = inspectVariantDrift(root,
        { version: '0.39.0' },
        { version: '0.39.0', includeRule: false });
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.state, 'STALE');
      assert.strictEqual(report.classification, 'AGY_OWNED');
      assert.strictEqual(report.source.version, '0.39.0');
      assert.strictEqual(report.source.file_count, 5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks a changed receipt-owned file', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      fs.appendFileSync(path.join(installed.target, 'agents/sample.md'), '\nuser edit\n');
      const report = inspectAgyPlugin({ sourceRoot: installed.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks a missing receipt-owned file after source removal', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      fs.unlinkSync(path.join(installed.target, 'rules/sample.md'));
      const next = packageVariantFixture(root, 'next', { version: '0.40.0', includeRule: false });
      const report = inspectAgyPlugin({ sourceRoot: next.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks missing receipt fingerprint metadata', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      fs.unlinkSync(path.join(installed.target, 'fingerprints.json'));
      const report = inspectAgyPlugin({ sourceRoot: installed.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks tampered receipt metadata', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      fs.appendFileSync(path.join(installed.target, 'provenance.json'), ' ');
      const report = inspectAgyPlugin({ sourceRoot: installed.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks tampered fingerprint metadata', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      fs.appendFileSync(path.join(installed.target, 'fingerprints.json'), ' ');
      const report = inspectAgyPlugin({ sourceRoot: installed.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks an unsafe removed receipt-owned path', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root);
      const outside = path.join(root, 'outside-rule.md');
      fs.writeFileSync(outside, '# outside\n');
      fs.unlinkSync(path.join(installed.target, 'rules/sample.md'));
      fs.symlinkSync(outside, path.join(installed.target, 'rules/sample.md'));
      const next = packageVariantFixture(root, 'next', { version: '0.40.0', includeRule: false });
      const report = inspectAgyPlugin({ sourceRoot: next.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'UNSAFE_TARGET');
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), '# outside\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only inspection blocks an unowned file colliding with a new source path', () => {
    const root = tmp();
    try {
      const installed = installedVariant(root, { includeRule: false });
      fs.mkdirSync(path.join(installed.target, 'rules'), { recursive: true });
      fs.writeFileSync(path.join(installed.target, 'rules/new-rule.md'), '# New\n');
      const next = packageVariantFixture(root, 'next', {
        version: '0.40.0',
        includeRule: false,
        extraRule: { path: 'rules/new-rule.md', body: '# New\n' },
      });
      const report = inspectAgyPlugin({ sourceRoot: next.output, targetRoot: installed.target });
      assert.strictEqual(report.status, 'BLOCKED');
      assert.strictEqual(report.state, 'BLOCKED');
      assert.strictEqual(report.classification, 'OWNED_CHANGED');
      assert.ok(report.diff.counts.same >= 1, JSON.stringify(report));
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
}

{
  // Source suite: tests/agy-plugin-package.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    materializeAgyPluginPackage,
    validateAgyPluginPackage,
  } = require('../scripts/lib/agy-plugin-package');

  const COMMIT = 'a'.repeat(40);

  function tempRoot() {
    return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-package-test-'));
  }

  function writeFixture(root, { includeHarnessReference = false, withProjectionContract = false, omitSelectionPolicy = false } = {}) {
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'references'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', 'sample.md'), [
      '---',
      'name: sample',
      'description: Sample agent',
      'tools: Read, Bash',
      'model: sonnet',
      'color: blue',
      '---',
      '',
      '# Sample',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'rules', 'sample.md'), '# Rule\n');
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'references', 'guide.md'), '# Guide\n');
    const skillLines = [
      '---',
      'name: dhpk-sample',
      'description: Sample skill',
      '---',
      '',
      '# Skill',
      '',
    ];
    if (includeHarnessReference) {
      fs.mkdirSync(path.join(root, 'skills', 'harness-govern'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'harness-govern', 'SKILL.md'), [
        '---',
        'name: harness-govern',
        'description: Harness governance skill',
        '---',
        '',
        '# Harness Revise',
        '',
      ].join('\n'));
      skillLines.push('Use @skills/harness-govern/references/harness-directory-contract.md when resolving a harness.');
    }
    fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), `${skillLines.join('\n')}\n`);
    const inventory = {
      schema: 'dhpk.distribution-inventory.v2',
      surfaces: ['agy-plugin'],
      skills: [
        { id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] },
        ...(includeHarnessReference
          ? [{ id: 'harness-govern', path: 'skills/harness-govern', surfaces: ['agy-plugin'] }]
          : []),
      ],
      modules: [],
      surface_membership: { 'agy-plugin': ['sample', ...(includeHarnessReference ? ['harness-govern'] : [])] },
      agy_plugin: {
        agents: ['sample.md'],
        rules: ['rules/sample.md'],
      },
    };
    if (withProjectionContract) {
      inventory.projection_contract = {
        schema: 'dhpk.distribution-projection-contract.v1',
        compiler: { id: 'distribution-compiler', version: '1' },
        symlink_policies: ['forbid'],
        surfaces: {
          'agy-plugin': {
            adapter: 'agy-plugin',
            owner: 'agy-plugin',
            symlink_policy: 'forbid',
            verification_stages: ['structural'],
            ...(omitSelectionPolicy ? {} : {
              selection_policy: { source: 'surface_membership', precedence: ['surface_membership'] },
            }),
          },
        },
      };
    }
    return inventory;
  }

  function materializeFixture(root, outDir, options) {
    return materializeAgyPluginPackage({
      root,
      inventory: writeFixture(root, options),
      outDir,
      version: '0.39.0',
      sourceVersion: '0.39.0',
      sourceCommit: COMMIT,
    });
  }

  function brokenRelativeMarkdownLinks(packageRoot) {
    const broken = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;
        const relative = path.relative(packageRoot, absolute).split(path.sep).join('/');
        const content = fs.readFileSync(absolute, 'utf8');
        for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = match[1].trim();
          if (!target || target.startsWith('#') || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) continue;
          const pathPart = target.split('#', 1)[0].trim();
          if (pathPart && !fs.existsSync(path.resolve(path.dirname(absolute), pathPart))) {
            broken.push(`${relative} -> ${target}`);
          }
        }
      }
    };
    walk(packageRoot);
    return broken;
  }

  test('materializes and validates a contained AGY package', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const result = materializeFixture(root, outDir);
      const checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root), expectedVersion: '0.39.0' });
      assert.strictEqual(checked.ok, true, checked.errors.join('; '));
      assert.ok(result.files.includes('agents/sample.md'));
      assert.ok(result.files.includes('skills/dhpk-sample/SKILL.md'));
      assert.ok(!fs.readFileSync(path.join(root, 'agents', 'sample.md'), 'utf8').includes('model: pro'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AGY generation requires the inventory-owned selection policy', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      assert.throws(
        () => materializeFixture(root, outDir, { withProjectionContract: true, omitSelectionPolicy: true }),
        /selection policy/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AGY selection policy can use entry surfaces without a duplicate membership map', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root, { withProjectionContract: true });
      delete inventory.surface_membership['agy-plugin'];
      inventory.projection_contract.surfaces['agy-plugin'].selection_policy = {
        source: 'entry_surfaces',
        precedence: ['entry_surfaces'],
      };
      const result = materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      });
      assert.deepStrictEqual(result.receipt.selection.selectedStableIds, ['sample']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rewrites source-tree harness references to an AGY skill target', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      materializeFixture(root, outDir, { includeHarnessReference: true });
      const projected = fs.readFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'SKILL.md'), 'utf8');
      assert.ok(projected.includes('harness-govern'));
      assert.ok(!projected.includes('@skills/harness-govern/references/harness-directory-contract.md'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('copies selected skill reference assets so relative links stay reachable', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const result = materializeFixture(root, outDir);
      assert.ok(result.files.includes('skills/dhpk-sample/references/guide.md'));
      assert.strictEqual(
        fs.readFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'references', 'guide.md'), 'utf8'),
        '# Guide\n',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AGY projection rewrites canonical documentation links instead of emitting broken relative paths', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    const canonicalUrl = 'https://github.com/hmj1026/dhpk/blob/main/docs/contracts/reviewer-contract.md';
    try {
      const inventory = writeFixture(root);
      fs.mkdirSync(path.join(root, 'docs', 'contracts'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'contracts', 'reviewer-contract.md'), '# Reviewer contract\n');
      fs.writeFileSync(path.join(root, 'agents', 'sample.md'), [
        '---',
        'name: sample',
        'description: Sample agent',
        'tools: Read, Bash',
        'model: sonnet',
        '---',
        '',
        '# Sample',
        '',
        '[Reviewer contract](../docs/contracts/reviewer-contract.md)',
        '',
      ].join('\n'));

      materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      });

      const projected = fs.readFileSync(path.join(outDir, 'agents', 'sample.md'), 'utf8');
      assert.match(projected, new RegExp(`\\(${canonicalUrl.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\)`));
      assert.doesNotMatch(projected, /\]\(\.\.\/docs\//);
      assert.deepStrictEqual(brokenRelativeMarkdownLinks(outDir), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AGY projection preserves the complete execution-policy mechanics reference', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root);
      fs.writeFileSync(path.join(root, 'rules', 'sample.md'), [
        '# Execution policy fixture',
        '',
        'Full checkpoint mechanics and envelope rules live in `${CLAUDE_PLUGIN_ROOT}/skills/flow-guide/references/review-gate-mechanics.md`.',
        '',
      ].join('\n'));
      materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      });
      const policy = fs.readFileSync(path.join(outDir, 'rules', 'sample.md'), 'utf8');
      assert.match(policy, /Full checkpoint mechanics\s+and envelope rules live in `?\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/flow-guide\/references\/review-gate-mechanics\.md`?\./);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('minimal AGY profile carries declared transport runtime support without widening receipt selection', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root, { withProjectionContract: true });
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-runtime'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-runtime', 'SKILL.md'), [
        '---',
        'name: dhpk-runtime',
        'description: Runtime support',
        '---',
        '',
        '# Runtime',
        '',
      ].join('\n'));
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-runtime', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-runtime', 'scripts', 'run-runtime.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-runtime', 'scripts', 'report-schema.json'), '{"type":"object"}\n');
      inventory.skills.push({ id: 'runtime', path: 'skills/dhpk-runtime', surfaces: ['agy-plugin'] });
      inventory.surface_membership['agy-plugin'].push('runtime');
      inventory.internal_runtime_skills = { 'agy-plugin': ['runtime'] };
      const result = materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
        profileSelection: {
          profileId: 'minimal',
          selectedStableIds: ['sample'],
          selectionFingerprint: 'a'.repeat(64),
          compatibilityMode: 'profile',
          selectionPolicyVersion: 'fixture-v1',
        },
      });
      assert.deepStrictEqual(result.receipt.selectedStableIds, ['sample']);
      assert.deepStrictEqual(result.receipt.selectedIds.skills, ['sample', 'runtime']);
      assert.deepStrictEqual(result.receipt.selection.selectedStableIds, ['sample']);
      assert.strictEqual(result.receipt.selection.selectionPolicy.source, 'surface_membership');
      assert.ok(fs.existsSync(path.join(outDir, 'skills', 'dhpk-runtime', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(outDir, 'skills', 'dhpk-runtime', 'scripts', 'run-runtime.sh')));
      assert.ok(fs.existsSync(path.join(outDir, 'skills', 'dhpk-runtime', 'scripts', 'report-schema.json')));
      assert.strictEqual(fs.statSync(path.join(outDir, 'skills', 'dhpk-runtime', 'scripts', 'run-runtime.sh')).mode & 0o777, 0o755);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a rewritten reference when its target skill is not selected', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root);
      fs.appendFileSync(
        path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'),
        '\nUse @skills/harness-govern/references/harness-directory-contract.md when resolving a harness.\n',
      );
      assert.throws(() => materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      }), /AGY skill reference target is not selected: harness-govern/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('equivalent inputs produce byte-identical package files', () => {
    const root = tempRoot();
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    try {
      const firstResult = materializeFixture(root, first);
      const secondResult = materializeFixture(root, second);
      for (const file of firstResult.files.concat(['provenance.json', 'fingerprints.json']).sort()) {
        assert.strictEqual(
          fs.readFileSync(path.join(first, file), 'utf8'),
          fs.readFileSync(path.join(second, file), 'utf8'),
          `output drift: ${file}`,
        );
      }
      assert.strictEqual(
        fs.readFileSync(path.join(first, 'agents', 'sample.md'), 'utf8'),
        fs.readFileSync(path.join(second, 'agents', 'sample.md'), 'utf8'),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects foreign receipt, undeclared files, and secrets', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      materializeFixture(root, outDir);
      const provenancePath = path.join(outDir, 'provenance.json');
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      provenance.owner = 'plugins/dhpk-cursor';
      provenance.surface = 'cursor-plugin';
      fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
      fs.writeFileSync(path.join(outDir, 'foreign.txt'), 'foreign\n');
      fs.writeFileSync(path.join(outDir, 'agents', 'foreign.txt'), 'foreign agent payload\n');
      fs.appendFileSync(path.join(outDir, 'skills', 'dhpk-sample', 'SKILL.md'), '\napi_key=sk_12345678901234567890\n');
      const checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root) });
      assert.strictEqual(checked.ok, false);
      assert.ok(checked.errors.some((error) => error.includes('foreign.txt')));
      assert.ok(checked.errors.some((error) => error.includes('undeclared AGY package file: agents/foreign.txt')));
      assert.ok(checked.errors.some((error) => error.includes('surface')));
      assert.ok(checked.errors.some((error) => error.includes('secret')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed on traversal and source symlinks', () => {
    const root = tempRoot();
    try {
      const inventory = writeFixture(root);
      inventory.agy_plugin.agents = ['../outside.md'];
      assert.throws(() => materializeAgyPluginPackage({
        root,
        inventory,
        outDir: path.join(root, 'package'),
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      }), /AGY agent selection|escapes/);

      const symlinkRoot = tempRoot();
      try {
        writeFixture(symlinkRoot);
        fs.symlinkSync(path.join(symlinkRoot, 'rules', 'sample.md'), path.join(symlinkRoot, 'rules', 'link.md'));
        const symlinkInventory = writeFixture(symlinkRoot);
        symlinkInventory.agy_plugin.rules = ['rules/link.md'];
        assert.throws(() => materializeAgyPluginPackage({
          root: symlinkRoot,
          inventory: symlinkInventory,
          outDir: path.join(symlinkRoot, 'package'),
          version: '0.39.0',
          sourceVersion: '0.39.0',
          sourceCommit: COMMIT,
        }), /symlink/);
      } finally {
        fs.rmSync(symlinkRoot, { recursive: true, force: true });
      }

      const symlinkAgentRoot = tempRoot();
      try {
        writeFixture(symlinkAgentRoot);
        const outside = path.join(symlinkAgentRoot, 'outside.md');
        fs.writeFileSync(outside, [
          '---', 'name: outside', 'description: Outside', 'tools: ["read_file"]', 'model: inherit', '---', '',
        ].join('\n'));
        fs.unlinkSync(path.join(symlinkAgentRoot, 'agents', 'sample.md'));
        fs.symlinkSync(outside, path.join(symlinkAgentRoot, 'agents', 'sample.md'));
        const symlinkAgentInventory = writeFixture(symlinkAgentRoot);
        assert.throws(() => materializeAgyPluginPackage({
          root: symlinkAgentRoot,
          inventory: symlinkAgentInventory,
          outDir: path.join(symlinkAgentRoot, 'package'),
          version: '0.39.0',
          sourceVersion: '0.39.0',
          sourceCommit: COMMIT,
        }), /symlink/);
      } finally {
        fs.rmSync(symlinkAgentRoot, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('invalid generation never removes an existing output root', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'user-owned.txt'), 'keep\n');
      assert.throws(() => materializeAgyPluginPackage({
        root,
        inventory: { schema: 'dhpk.distribution-inventory.v2' },
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      }), /inventory\.agy_plugin/);
      assert.strictEqual(fs.readFileSync(path.join(outDir, 'user-owned.txt'), 'utf8'), 'keep\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects manifest escapes and provenance fingerprint drift', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      materializeFixture(root, outDir);
      const manifestPath = path.join(outDir, 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.agents = ['../../outside/'];
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      let checked = validateAgyPluginPackage(outDir, { inventory: writeFixture(root) });
      assert.strictEqual(checked.ok, false);
      assert.ok(checked.errors.some((error) => error.includes('plugin.json agents')));

      const secondOutDir = path.join(root, 'second-package');
      materializeFixture(root, secondOutDir);
      const provenancePath = path.join(secondOutDir, 'provenance.json');
      const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
      provenance.fingerprints = {};
      fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
      checked = validateAgyPluginPackage(secondOutDir, { inventory: writeFixture(root) });
      assert.strictEqual(checked.ok, false);
      assert.ok(checked.errors.some((error) => error.includes('provenance fingerprints')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('publishes the complete physical Skill directory without descriptor selection', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root);
      inventory.skills[0].id = 'dhpk-sample';
      inventory.surface_membership['agy-plugin'] = ['dhpk-sample'];
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'scripts', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'scripts', 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'scripts', 'lib', 'helper.js'), 'module.exports = 1;\n');
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'scripts', '__pycache__'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'scripts', '__pycache__', 'x.pyc'), 'bytecode');
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'templates'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'templates', 'report.md'), '# Report\n');
      fs.mkdirSync(path.join(root, 'skills', 'dhpk-sample', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'agents', 'openai.yaml'), 'interface: {}\n');

      const result = materializeAgyPluginPackage({
        root,
        inventory,
        outDir,
        version: '0.39.0',
        sourceVersion: '0.39.0',
        sourceCommit: COMMIT,
      });

      for (const relative of ['references/guide.md', 'scripts/run.sh', 'scripts/lib/helper.js', 'templates/report.md']) {
        assert.ok(result.files.includes(`skills/dhpk-sample/${relative}`), `missing ${relative}`);
      }
      assert.ok(!result.files.some((file) => /__pycache__|\.pyc$/.test(file)), 'ignored bytecode must not be published');
      assert.ok(!result.files.includes('skills/dhpk-sample/agents/openai.yaml'), 'Codex-only interface metadata is not an AGY file');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('validation rejects files of an unselected Skill whose name extends a selected one', () => {
    const root = tempRoot();
    const outDir = path.join(root, 'package');
    try {
      const inventory = writeFixture(root);
      inventory.skills[0].id = 'dhpk-sample';
      inventory.surface_membership['agy-plugin'] = ['dhpk-sample'];
      materializeAgyPluginPackage({
        root, inventory, outDir, version: '0.39.0', sourceVersion: '0.39.0', sourceCommit: COMMIT,
      });
      fs.mkdirSync(path.join(outDir, 'skills', 'dhpk-sample-extra'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'skills', 'dhpk-sample-extra', 'SKILL.md'), '# injected\n');
      const validation = validateAgyPluginPackage(outDir, { inventory });
      assert.strictEqual(validation.ok, false);
      assert.match(validation.errors.join('\n'), /undeclared AGY package file: skills\/dhpk-sample-extra\/SKILL\.md/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

{
  // Source suite: tests/agy-path-contract.test.js
  const {
    DEFAULT_PATH_CONTRACT,
    loadAgyPathContract,
    resolveAgyConsumerPath,
    resolveAgyInstallPaths,
    validateAgyPathContract,
  } = require('../scripts/lib/agy-path-contract');

  test('loads the inventory-owned canonical and legacy AGY paths', () => {
    const contract = loadAgyPathContract();
    assert.strictEqual(contract.canonical_relative, '.gemini/antigravity-cli/plugins/dhpk');
    assert.deepStrictEqual(contract.legacy_relatives, ['.gemini/config/plugins/dhpk']);
    assert.strictEqual(resolveAgyConsumerPath(contract), '/home/agy/.gemini/antigravity-cli/plugins/dhpk');
  });

  test('resolves canonical and legacy paths under an isolated home', () => {
    const paths = resolveAgyInstallPaths('/tmp/agy-home', DEFAULT_PATH_CONTRACT);
    assert.strictEqual(paths.canonical, '/tmp/agy-home/.gemini/antigravity-cli/plugins/dhpk');
    assert.deepStrictEqual(paths.legacy, ['/tmp/agy-home/.gemini/config/plugins/dhpk']);
  });

  test('rejects unsafe, duplicate, and incomplete path contracts', () => {
    const cases = [
      { ...DEFAULT_PATH_CONTRACT, canonical_relative: '/outside/dhpk' },
      { ...DEFAULT_PATH_CONTRACT, canonical_relative: '../outside/dhpk' },
      { ...DEFAULT_PATH_CONTRACT, legacy_relatives: ['.gemini/config/plugins/dhpk', '.gemini/config/plugins/dhpk'] },
      { ...DEFAULT_PATH_CONTRACT, legacy_relatives: ['.gemini/antigravity-cli/plugins/dhpk'] },
      { ...DEFAULT_PATH_CONTRACT, legacy_relatives: [] },
    ];
    for (const candidate of cases) assert.strictEqual(validateAgyPathContract(candidate).ok, false);
  });

  test('rejects a non-absolute home and malformed sandbox home', () => {
    assert.throws(() => resolveAgyInstallPaths('relative-home', DEFAULT_PATH_CONTRACT), /absolute/);
    assert.strictEqual(validateAgyPathContract({ ...DEFAULT_PATH_CONTRACT, sandbox_home: 'home/agy' }).ok, false);
  });
}

{
  // Source suite: tests/install-agy-plugin.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { materializeAgyPluginPackage } = require('../scripts/lib/agy-plugin-package');

  const ROOT = path.join(__dirname, '..');
  const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'install-agy-plugin.js');
  const SOURCE = path.join(ROOT, 'plugins', 'dhpk-agy');
  const SCRATCH_COMMIT = 'c'.repeat(40);

  function invoke(action, target) {
    return spawnSync(process.execPath, [SCRIPT, action, '--source', SOURCE, '--target', target, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  function invokeReport(action, target) {
    const result = invoke(action, target);
    return { result, report: JSON.parse(result.stdout) };
  }

  function invokeForSource(action, source, target) {
    return spawnSync(process.execPath, [SCRIPT, action, '--source', source, '--target', target, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    });
  }

  function invokeWithHome(action, source, home) {
    return spawnSync(process.execPath, [SCRIPT, action, '--source', source, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
    });
  }

  function invokeReportForSource(action, source, target) {
    const result = invokeForSource(action, source, target);
    return { result, report: JSON.parse(result.stdout) };
  }

  function scratchPackage(root, name, version, body) {
    const canonical = path.join(root, `${name}-canonical`);
    const output = path.join(root, `${name}-package`);
    fs.mkdirSync(path.join(canonical, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(canonical, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(canonical, 'skills', 'dhpk-sample'), { recursive: true });
    fs.writeFileSync(path.join(canonical, 'agents', 'sample.md'), [
      '---',
      'name: sample',
      'description: Sample',
      'tools: ["read_file"]',
      'model: inherit',
      '---',
      '',
      body,
    ].join('\n'));
    fs.writeFileSync(path.join(canonical, 'rules', 'sample.md'), '# Rule\n');
    fs.writeFileSync(path.join(canonical, 'skills', 'dhpk-sample', 'SKILL.md'), [
      '---',
      'name: dhpk-sample',
      'description: Sample',
      '---',
      '# Skill',
      '',
    ].join('\n'));
    materializeAgyPluginPackage({
      root: canonical,
      inventory: {
        schema: 'dhpk.distribution-inventory.v2',
        skills: [{ id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] }],
        modules: [],
        surface_membership: { 'agy-plugin': ['sample'] },
        agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
      },
      outDir: output,
      version,
      sourceVersion: version,
      sourceCommit: SCRATCH_COMMIT,
    });
    return output;
  }

  function snapshotFiles(root) {
    const files = {};
    const walk = (directory, prefix = '') => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute, relative);
        else if (entry.isFile()) files[relative] = fs.readFileSync(absolute);
        else files[relative] = `non-regular:${entry.name}`;
      }
    };
    walk(root);
    return files;
  }

  test('CLI installs and rolls back the receipt-owned AGY package', () => {
    const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-cli-install-'));
    const target = path.join(temp, 'target');
    try {
      const installed = invokeReport('install', target);
      assert.strictEqual(installed.result.status, 0, `${installed.result.stdout}\n${installed.result.stderr}`);
      assert.ok(installed.report.installed.length > 0, 'install report must identify receipt-owned package files');
      const targetRoot = path.resolve(target);
      for (const relative of installed.report.installed) {
        const installedPath = path.resolve(targetRoot, relative);
        const targetRelative = path.relative(targetRoot, installedPath);
        assert.ok(targetRelative && !targetRelative.startsWith(`..${path.sep}`)
          && targetRelative !== '..' && !path.isAbsolute(targetRelative),
        `install report path escapes target: ${relative}`);
        assert.ok(fs.existsSync(installedPath), `install report path was not created: ${relative}`);
      }
      assert.ok(fs.existsSync(path.join(target, 'provenance.json')));

      const rolledBack = invokeReport('rollback', target);
      assert.strictEqual(rolledBack.result.status, 0, `${rolledBack.result.stdout}\n${rolledBack.result.stderr}`);
      assert.deepStrictEqual(rolledBack.report.removed, installed.report.installed);
      for (const relative of installed.report.installed) {
        assert.strictEqual(fs.existsSync(path.join(target, relative)), false, `rollback retained owned path ${relative}`);
      }
      assert.strictEqual(fs.existsSync(path.join(target, 'provenance.json')), false);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test('CLI plan and status report a foreign checkout without mutation', () => {
    const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-cli-plan-'));
    const target = path.join(temp, 'target');
    try {
      fs.mkdirSync(path.join(target, '.git'), { recursive: true });
      fs.writeFileSync(path.join(target, 'plugin.json'), '{"name":"dhpk","version":"0.38.0"}\n');
      for (const action of ['plan', 'status']) {
        const { result, report } = invokeReport(action, target);
        assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
        assert.strictEqual(report.status, 'BLOCKED');
        assert.strictEqual(report.classification, 'FOREIGN_CHECKOUT');
        assert.strictEqual(report.mutation.performed, false);
      }
      assert.ok(!fs.existsSync(path.join(target, 'provenance.json')));
      assert.deepStrictEqual(fs.readdirSync(target).sort(), ['.git', 'plugin.json']);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test('CLI plan and status pass equivalently without mutating source or target', () => {
    const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-cli-current-'));
    const target = path.join(temp, 'target');
    try {
      const installed = invoke('install', target);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
      const sourceBefore = snapshotFiles(SOURCE);
      const targetBefore = snapshotFiles(target);
      assert.deepStrictEqual(targetBefore, sourceBefore);

      const plan = invokeReport('plan', target);
      const status = invokeReport('status', target);
      assert.strictEqual(plan.result.status, 0, `${plan.result.stdout}\n${plan.result.stderr}`);
      assert.strictEqual(status.result.status, 0, `${status.result.stdout}\n${status.result.stderr}`);
      assert.deepStrictEqual({ ...plan.report, action: undefined }, { ...status.report, action: undefined });
      assert.strictEqual(plan.report.status, 'PASS');
      assert.strictEqual(plan.report.state, 'CURRENT');
      assert.strictEqual(plan.report.classification, 'AGY_OWNED');
      assert.deepStrictEqual(snapshotFiles(SOURCE), sourceBefore);
      assert.deepStrictEqual(snapshotFiles(target), targetBefore);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test('CLI plan and status pass for a stale owned upgrade without mutation', () => {
    const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-cli-stale-'));
    const target = path.join(temp, 'target');
    try {
      const sourceN = scratchPackage(temp, 'version-n', '0.39.0', '# Version N\n');
      const sourceNext = scratchPackage(temp, 'version-next', '0.40.0', '# Version N+1\n');
      const installed = invokeForSource('install', sourceN, target);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
      const sourceBefore = snapshotFiles(sourceNext);
      const targetBefore = snapshotFiles(target);

      const plan = invokeReportForSource('plan', sourceNext, target);
      const status = invokeReportForSource('status', sourceNext, target);
      assert.strictEqual(plan.result.status, 0, `${plan.result.stdout}\n${plan.result.stderr}`);
      assert.strictEqual(status.result.status, 0, `${status.result.stdout}\n${status.result.stderr}`);
      assert.deepStrictEqual({ ...plan.report, action: undefined }, { ...status.report, action: undefined });
      assert.strictEqual(plan.report.status, 'PASS');
      assert.strictEqual(plan.report.state, 'STALE');
      assert.strictEqual(plan.report.classification, 'AGY_OWNED');
      assert.match(plan.report.next_action, /update/i);
      assert.deepStrictEqual(snapshotFiles(sourceNext), sourceBefore);
      assert.deepStrictEqual(snapshotFiles(target), targetBefore);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test('CLI migration moves an explicit legacy installation to the canonical home path', () => {
    const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agy-cli-migrate-'));
    const legacy = path.join(temp, '.gemini/config/plugins/dhpk');
    const canonical = path.join(temp, '.gemini/antigravity-cli/plugins/dhpk');
    try {
      const installed = invoke('install', legacy);
      assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
      const migrated = invokeWithHome('migrate', SOURCE, temp);
      assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
      const report = JSON.parse(migrated.stdout);
      assert.strictEqual(report.classification, 'MIGRATED_LEGACY');
      assert.ok(fs.existsSync(path.join(canonical, 'provenance.json')));
      assert.ok(!fs.existsSync(path.join(legacy, 'provenance.json')));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}

run('agy-plugin-install');
