'use strict';

const { test, run, assert } = require('./_lib/tinytest');

{
  // Source suite: tests/project-agent-projection-publisher.test.js
  const crypto = require('node:crypto');
  const childProcess = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const publisher = require('../scripts/lib/project-agent-projection-publisher');
  const { parseFrontmatter } = require('../scripts/lib/agent-plugin-package');
  const { fingerprint } = require('../scripts/lib/distribution-projection-contract');

  function projectInventory() {
    return {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{
        id: 'sample',
        name: 'dhpk-sample',
        path: 'skills/dhpk-sample',
        lifecycle: 'promoted',
        surfaces: ['claude-core', 'codex-sync', 'cursor-plugin', 'agy-plugin'],
      }],
      surface_membership: {
        'claude-core': ['sample'],
        'codex-sync': ['sample'],
        'cursor-plugin': ['sample'],
        'agy-plugin': ['sample'],
      },
      project_agent_projection: {
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
          claude: {
            surface: 'claude-core',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'claude-project-skill', version: '1' },
          },
          codex: {
            surface: 'codex-sync',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'codex-project-skill', version: '1' },
          },
          cursor: {
            surface: 'cursor-plugin',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-directory',
            transform: { id: 'cursor-project-skill', version: '1' },
          },
          agy: {
            surface: 'agy-plugin',
            evidence_source: 'entry_surfaces',
            shape: 'project-skill-direct-file',
            transform: { id: 'agy-project-direct-file', version: '1' },
          },
        },
        dependencies: {},
      },
    };
  }

  function write(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  function withoutKey(value, key) {
    return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
  }

  function asLegacyV1Receipt(receipt, projectRoot) {
    const legacy = JSON.parse(JSON.stringify(receipt));
    legacy.schema = 'dhpk.project-agent-projection-receipt.v1';
    delete legacy.selectedIdentities;
    delete legacy.emittedIdentities;
    if (Array.isArray(legacy.entries)) legacy.entries.forEach((entry) => delete entry.entityKind);
    legacy.sourceFingerprints = Object.fromEntries(
      (legacy.entries || []).map((entry) => [entry.stableId, entry.sourceFingerprint]),
    );
    const legacyClaudeTarget = '../../.agents/skills/dhpk-sample';
    for (const binding of legacy.bindingPaths && legacy.bindingPaths.claude || []) {
      binding.target = legacyClaudeTarget;
    }
    const claudeBinding = legacy.hostBindings && legacy.hostBindings.claude;
    if (claudeBinding && claudeBinding.discovery) claudeBinding.discovery.sourceRoot = '.agents/skills';
    for (const binding of claudeBinding && claudeBinding.bindings || []) binding.target = legacyClaudeTarget;
    legacy.bindings = JSON.parse(JSON.stringify(legacy.hostBindings));
    const discoveryPath = path.join(projectRoot, '.claude/skills/dhpk-sample');
    if (fs.lstatSync(discoveryPath).isSymbolicLink()) {
      fs.rmSync(discoveryPath);
      fs.symlinkSync(legacyClaudeTarget, discoveryPath, 'dir');
    }
    delete legacy.receiptFingerprint;
    return legacy;
  }

  function asV2Receipt(receipt, { preserveClaude = false } = {}) {
    const fields = [
      'schema', 'generatorVersion', 'scope', 'managedRoot', 'receiptPath', 'projectionOwner',
      'profileId', 'profile', 'profileFingerprint', 'selectionFingerprint',
      'surfaceSelectionFingerprint', 'capabilityEvidenceFingerprint', 'planFingerprint',
      'artifactFingerprint', 'declaredSelection', 'selectedIds', 'emittedIds',
      'selectedIdentities', 'emittedIdentities', 'dependencyClosure', 'hostBindings',
      'bindings', 'bindingPaths', 'entries', 'managedPaths', 'generatedFingerprints',
      'sourceFingerprints', 'rollback',
    ];
    const v2 = Object.fromEntries(fields
      .filter((field) => Object.prototype.hasOwnProperty.call(receipt, field))
      .map((field) => [field, JSON.parse(JSON.stringify(receipt[field]))]));
    v2.schema = 'dhpk.project-agent-projection-receipt.v2';
    if (!preserveClaude) {
      v2.hostBindings = withoutKey(v2.hostBindings, 'claude');
      v2.bindings = withoutKey(v2.bindings, 'claude');
      v2.bindingPaths = withoutKey(v2.bindingPaths, 'claude');
    }
    delete v2.receiptFingerprint;
    v2.receiptFingerprint = fingerprint(v2);
    return v2;
  }

  test('publisher emits a skill namespace and typed receipt when a module shares its ID', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-identity-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-identity-project-'));
    const inventory = projectInventory();
    inventory.modules = [{ ...inventory.skills[0], path: 'modules/sample' }];
    inventory.project_agent_projection.profiles['portable-core'].stable_ids = ['skill:sample'];
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory });
      assert.strictEqual(installed.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.deepStrictEqual(installed.receipt.selectedIdentities, [{ entityKind: 'skill', stableId: 'sample' }]);
      assert.deepStrictEqual(installed.receipt.emittedIdentities, [{ entityKind: 'skill', stableId: 'sample' }]);
      assert.strictEqual(installed.receipt.entries[0].entityKind, 'skill');
      assert.ok(installed.receipt.sourceFingerprints['skill:sample']);
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory }).ok, true);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // Task 2.1 characterization of the publisher's path-safety errors.  These
  // codes and messages are a public contract; the shared predicates must keep
  // them byte-for-byte (task 2.2).
  test('publisher rejects unsafe managed_root values with UNSAFE_PATH and its exact message', () => {
    for (const bad of ['C:', 'C:foo', '.', '..', 'a//b', 'a/../b', 'a\\b', '/abs', '', 'a/']) {
      const inventory = projectInventory();
      inventory.project_agent_projection.managed_root = bad;
      let error = null;
      try {
        publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot: path.join(os.tmpdir(), 'dhpk-no-such-source'), projectRoot: path.join(os.tmpdir(), 'dhpk-no-such-project'), inventory });
      } catch (caught) { error = caught; }
      assert.ok(error, `expected a rejection for ${JSON.stringify(bad)}`);
      assert.strictEqual(error.projectionCode, 'UNSAFE_PATH', JSON.stringify(bad));
      assert.strictEqual(error.message, 'project projection managed_root must be a normalized relative path', JSON.stringify(bad));
    }
  });

  test('publisher rejects unsafe receipt binding paths and targets with its exact codes and messages', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pathsafe-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pathsafe-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['claude'] };
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    try {
      write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      publisher.materializeRelocatableAgentsSkillsProjection(options);
      const original = fs.readFileSync(receiptPath, 'utf8');
      const attempt = (field, value) => {
        const receipt = JSON.parse(original);
        receipt.bindingPaths.claude[0][field] = value;
        delete receipt.receiptFingerprint;
        receipt.receiptFingerprint = fingerprint(receipt);
        write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        try { publisher.materializeRelocatableAgentsSkillsProjection(options); } catch (caught) { return caught; }
        return null;
      };
      const targetMessage = "project projection binding paths 'claude' target must be a normalized relative symlink target";
      for (const bad of ['C:', 'C:foo', '.', 'a//b', '../a/./b', 'x/../y', 'a\\b', '/abs', '', 'a/']) {
        const error = attempt('target', bad);
        assert.ok(error, `target ${JSON.stringify(bad)} must be rejected`);
        assert.strictEqual(error.projectionCode, 'UNSAFE_PATH', `target ${JSON.stringify(bad)}`);
        assert.strictEqual(error.message, targetMessage, `target ${JSON.stringify(bad)}`);
      }
      // '..' is a well-formed relative target; it is refused by the containment rule instead.
      const escape = attempt('target', '..');
      assert.strictEqual(escape.projectionCode, 'PATH_ESCAPE');
      assert.strictEqual(escape.message, "project projection binding paths 'claude' target must resolve inside a receipt-owned project artifact: ..");
      const pathMessage = "project projection binding paths 'claude' path must be a normalized relative path";
      for (const bad of ['C:', 'C:foo', '.', '..', 'a//b', '../a/./b', 'x/../y', 'a\\b', '/abs', '', 'a/']) {
        const error = attempt('path', bad);
        assert.ok(error, `path ${JSON.stringify(bad)} must be rejected`);
        assert.strictEqual(error.projectionCode, 'UNSAFE_PATH', `path ${JSON.stringify(bad)}`);
        assert.strictEqual(error.message, pathMessage, `path ${JSON.stringify(bad)}`);
      }
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('project publisher projects inventory standalone dependencies into each skill and receipt', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dependency-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dependency-project-'));
    const inventory = projectInventory();
    inventory.standalone_dependencies = { 'dhpk-sample': { files: [{ source: 'rules/policy.md', destination: 'rules/execution-policy.md' }] } };
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      write(path.join(sourceRoot, 'skills/dhpk-sample/scripts/collect-changes.js'), fs.readFileSync(path.join(__dirname, '../skills/git-smart-commit/scripts/collect-changes.js')));
      write(path.join(sourceRoot, 'rules/policy.md'), '# consumer policy\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory });
      const projected = path.join(projectRoot, '.agents/skills/dhpk-sample/references/_dependencies/rules/execution-policy.md');
      assert.strictEqual(fs.readFileSync(projected, 'utf8'), '# consumer policy\n');
      assert.ok(installed.receipt.entries[0].generatedPaths.includes('dhpk-sample/references/_dependencies/rules/execution-policy.md'));
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory }).ok, true);
      write(path.join(sourceRoot, 'rules/policy.md'), '# updated consumer policy\n');
      assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory }), /source changed.*explicit update authority/i);
      publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory, update: true });
      assert.strictEqual(fs.readFileSync(projected, 'utf8'), '# updated consumer policy\n');
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory }).ok, true);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('project publisher rejects unsafe standalone dependency paths before publication', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dependency-unsafe-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dependency-unsafe-project-'));
    const inventory = projectInventory();
    inventory.standalone_dependencies = { 'dhpk-sample': { files: [{ source: '../outside.md', destination: 'rules/policy.md' }] } };
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory }), /safe relative path/);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents/.dhpk-installed.json')), false);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  for (const selectedOnly of ['none', 'retired', 'unique', 'ambiguous']) {
    test(`v1 receipt migration uses historical source proof and handles ${selectedOnly} selected-only identity safely`, () => {
      const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v1-source-'));
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v1-project-'));
      const inventory = projectInventory();
      const options = { sourceRoot, projectRoot, inventory };
      const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
      try {
        write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Historical skill\n');
        const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
        const legacy = asLegacyV1Receipt(installed.receipt, projectRoot);
        inventory.modules = [{ ...inventory.skills[0], path: 'modules/sample' }];
        inventory.project_agent_projection.profiles['portable-core'].stable_ids = ['skill:sample'];
        if (selectedOnly === 'retired') {
          legacy.selectedIds.push('retired-support');
        } else if (selectedOnly !== 'none') {
          legacy.selectedIds.push('support');
          inventory.modules.push({ id: 'support', name: 'support', path: 'modules/support' });
          if (selectedOnly === 'ambiguous') inventory.skills.push({ id: 'support', name: 'support', path: 'skills/support' });
        }
        legacy.receiptFingerprint = fingerprint(legacy);
        write(receiptPath, JSON.stringify(legacy));
        const foreignPath = path.join(projectRoot, '.agents/skills/foreign/keep.txt');
        write(foreignPath, 'foreign content');
        const previousReceipt = fs.readFileSync(receiptPath);
        const previousManaged = fs.readFileSync(path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md'));
        if (selectedOnly === 'ambiguous') {
          assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection({ ...options, selectedStableIds: ['skill:sample'], declaredSelection: true }), /historical evidence/);
          const removed = publisher.uninstallAgentsSkillsProjection({ projectRoot, inventory });
          assert.strictEqual(removed.ok, false);
          assert.strictEqual(removed.state, 'BLOCKED');
          assert.deepStrictEqual(fs.readFileSync(receiptPath), previousReceipt);
          assert.deepStrictEqual(fs.readFileSync(path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md')), previousManaged);
        } else {
          const updated = publisher.materializeRelocatableAgentsSkillsProjection(options);
          assert.strictEqual(updated.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
          assert.deepStrictEqual(updated.receipt.entries.map((entry) => entry.entityKind), ['skill']);
          if (selectedOnly === 'retired') {
            assert.deepStrictEqual(updated.receipt.selectedIdentities, [{ entityKind: 'skill', stableId: 'sample' }]);
            assert.deepStrictEqual(updated.receipt.emittedIdentities, [{ entityKind: 'skill', stableId: 'sample' }]);
            assert.deepStrictEqual(updated.receipt.selectedIds, ['sample']);
          }
          const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot, inventory });
          assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
          assert.strictEqual(rolledBack.receipt.schema, 'dhpk.project-agent-projection-receipt.v1');
        }
        assert.strictEqual(fs.readFileSync(foreignPath, 'utf8'), 'foreign content');
      } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }

  test('v2 receipt rejects a bare fingerprint-map identity before publication', () => {
    const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory };
    const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      const receipt = JSON.parse(JSON.stringify(installed.receipt));
      receipt.sourceFingerprints.sample = receipt.sourceFingerprints['skill:sample'];
      delete receipt.receiptFingerprint;
      receipt.receiptFingerprint = fingerprint(receipt);
      write(receiptPath, JSON.stringify(receipt));
      assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection(options), /invalid source fingerprint entry/);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('v1 emitted identity requires a normalized canonical skill source proof', () => {
    const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-proof-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-proof-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory };
    const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      for (const invalid of ['traversal', 'missing-proof']) {
        const receipt = asLegacyV1Receipt(installed.receipt, projectRoot);
        if (invalid === 'traversal') receipt.entries[0].source = 'skills/../modules/sample';
        else {
          receipt.emittedIds.push('unproved');
          inventory.modules = [{ id: 'unproved', path: 'modules/unproved' }];
        }
        receipt.receiptFingerprint = fingerprint(receipt);
        write(receiptPath, JSON.stringify(receipt));
        assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection(options), /receipt source|emitted.*proof/);
      }
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('project publisher fails closed when materialization inputs are incomplete', () => {
    assert.throws(
      () => publisher.materializeRelocatableAgentsSkillsProjection({}),
      /sourceRoot and inventory are required/,
    );
  });

  test('publisher writes portable metadata as JSON strings and keeps structured Claude metadata in a sibling', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-metadata-projection-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-metadata-projection-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['claude', 'codex', 'cursor'] };
    const source = [
      '---',
      'name: dhpk-sample',
      'description: Fixture',
      'metadata:',
      '  dhpk-next:',
      '    PASS: $repo-verify',
      '  dhpk-modes:',
      '    - code',
      '    - docs',
      '  retained: keep-me',
      '---',
      '# Portable body.',
      '',
    ].join('\n');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), source);
      publisher.materializeRelocatableAgentsSkillsProjection(options);

      const portablePath = path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md');
      const claudePath = path.join(projectRoot, '.agents/claude-skills/dhpk-sample/SKILL.md');
      assert.strictEqual(fs.existsSync(portablePath), true, 'portable skill output exists');
      const portable = parseFrontmatter(fs.readFileSync(portablePath, 'utf8'));
      assert.strictEqual(portable.metadata['dhpk-next'], JSON.stringify({ PASS: '$repo-verify' }));
      assert.strictEqual(portable.metadata['dhpk-modes'], JSON.stringify(['code', 'docs']));
      assert.strictEqual(portable.metadata.retained, 'keep-me');
      assert.strictEqual(fs.existsSync(claudePath), true, 'Claude structured sibling exists');
      const claude = fs.readFileSync(claudePath, 'utf8');
      assert.match(claude, /  dhpk-next:\n    PASS: \$repo-verify/);
      assert.match(claude, /  dhpk-modes:\n    - code\n    - docs/);
      assert.strictEqual(portable.body, '# Portable body.\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('publisher transforms and validates structured metadata in nested SKILL.md files', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-nested-metadata-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-nested-metadata-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['codex'] };
    const relative = 'dhpk-sample/references/child/SKILL.md';
    const source = [
      '---',
      'name: child-guide',
      'description: Nested fixture',
      'metadata:',
      '  dhpk-next:',
      '    PASS: $repo-verify',
      '---',
      '# Nested child',
      'Body stays exact.',
      '',
    ].join('\n');
    const portablePath = path.join(projectRoot, '.agents/skills', relative);
    const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Parent\n');
      write(path.join(sourceRoot, 'skills/dhpk-sample/references/child/SKILL.md'), source);
      publisher.materializeRelocatableAgentsSkillsProjection(options);

      assert.strictEqual(fs.existsSync(portablePath), true, 'nested skill is included in the portable projection');
      const portable = parseFrontmatter(fs.readFileSync(portablePath, 'utf8'));
      assert.strictEqual(portable.metadata['dhpk-next'], JSON.stringify({ PASS: '$repo-verify' }));
      assert.strictEqual(portable.body, '# Nested child\nBody stays exact.\n');
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);

      // Re-seal the receipt around raw bytes so validation reaches the semantic
      // portable-metadata check instead of stopping at ordinary fingerprint drift.
      fs.writeFileSync(portablePath, source);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.generatedFingerprints[relative] = crypto.createHash('sha256').update(source).digest('hex');
      delete receipt.receiptFingerprint;
      receipt.receiptFingerprint = fingerprint(receipt);
      write(receiptPath, `${JSON.stringify(receipt)}\n`);
      const validation = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(validation.ok, false, 'raw structured metadata in a nested skill must be rejected');
      assert.ok(validation.errors.some((error) => error.includes(relative) && /metadata/i.test(error)), validation.errors.join('\n'));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('publisher binds Claude to its structured sibling and Codex/Cursor to the portable root', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-roots-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-host-roots-project-'));
    const inventory = projectInventory();
    const options = {
      sourceRoot,
      projectRoot,
      inventory,
      requestedHosts: ['claude', 'codex', 'cursor'],
      selectedStableIds: ['sample'],
      declaredSelection: true,
      hostSelections: { claude: ['sample'], codex: ['sample'], cursor: ['sample'] },
    };
    const sourceSkill = path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md');
    const portableDirectory = path.join(projectRoot, '.agents/skills/dhpk-sample');
    const claudeDirectory = path.join(projectRoot, '.agents/claude-skills/dhpk-sample');
    const links = {
      claude: path.join(projectRoot, '.claude/skills/dhpk-sample'),
      codex: path.join(projectRoot, '.codex/skills/dhpk-sample'),
      cursor: path.join(projectRoot, '.cursor/skills/dhpk-sample'),
    };
    try {
      write(sourceSkill, '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Body\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      for (const [host, link] of Object.entries(links)) {
        assert.strictEqual(fs.existsSync(link), true, `${host} project binding exists`);
      }
      const resolvedLink = (link) => path.resolve(path.dirname(link), fs.readlinkSync(link));
      assert.strictEqual(resolvedLink(links.claude), claudeDirectory);
      assert.strictEqual(resolvedLink(links.codex), portableDirectory);
      assert.strictEqual(resolvedLink(links.cursor), portableDirectory);
      assert.strictEqual(installed.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  for (const host of ['cursor', 'codex']) {
    test(`native ${host} update migrates preserved v2 Claude discovery`, () => {
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-preserved-src-'));
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-preserved-project-'));
      const inventory = projectInventory();
      const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['claude', host], selectedStableIds: ['sample'], declaredSelection: true };
      const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
      const link = path.join(projectRoot, '.claude/skills/dhpk-sample');
      try {
        write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Body\n');
        const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
        const v2 = asV2Receipt(installed.receipt, { preserveClaude: true });
        v2.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
        v2.bindings = JSON.parse(JSON.stringify(v2.hostBindings));
        v2.bindingPaths.claude = [{ path: '.claude/skills/dhpk-sample', target: '../../.agents/skills/dhpk-sample' }];
        delete v2.receiptFingerprint;
        v2.receiptFingerprint = fingerprint(v2);
        write(receiptPath, JSON.stringify(v2));
        fs.unlinkSync(link);
        fs.symlinkSync('../../.agents/skills/dhpk-sample', link);
        fs.rmSync(path.join(projectRoot, '.agents/claude-skills'), { recursive: true, force: true });
        const update = () => require('../scripts/lib/native-shared-skill-install').installNativeSharedSkills({ sourceRoot, projectRoot, inventory, host, selectedStableIds: ['sample'], update: true });
        const migrated = update();
        assert.strictEqual(migrated.receipt.hostBindings.claude.discovery.sourceRoot, '.agents/claude-skills');
        assert.strictEqual(fs.readlinkSync(link), '../../.agents/claude-skills/dhpk-sample');
        assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);
        assert.deepStrictEqual(migrated.receipt.hostBindings.claude.selectedStableIds, v2.hostBindings.claude.selectedStableIds);
        const restored = publisher.rollbackAgentsSkillsProjection({ projectRoot, inventory });
        assert.strictEqual(restored.ok, true, restored.error && restored.error.message);
        assert.strictEqual(restored.receipt.schema, 'dhpk.project-agent-projection-receipt.v2');
        assert.strictEqual(fs.readlinkSync(link), '../../.agents/skills/dhpk-sample');
        assert.strictEqual(update().receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
        fs.unlinkSync(link);
        fs.symlinkSync('../../.agents/skills/dhpk-sample', link);
        const beforeConflict = fs.readFileSync(receiptPath);
        assert.throws(update);
        assert.strictEqual(fs.readFileSync(receiptPath).equals(beforeConflict), true);
        assert.strictEqual(fs.readlinkSync(link), '../../.agents/skills/dhpk-sample');
      } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }

  test('publisher migrates an unchanged v2 receipt to v3 without changing portable identity or content', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-migration-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-v2-migration-project-'));
    const inventory = projectInventory();
    const options = {
      sourceRoot,
      projectRoot,
      inventory,
      requestedHosts: ['claude', 'codex', 'cursor'],
      selectedStableIds: ['sample'],
      declaredSelection: true,
      hostSelections: { claude: ['sample'], codex: ['sample'], cursor: ['sample'] },
    };
    const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
    const portablePath = path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Body\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      const previous = installed.receipt;
      const portableBefore = fs.readFileSync(portablePath);

      // Re-seal the current portable receipt as the prior v2 contract.
      const v2 = asV2Receipt(previous);
      write(receiptPath, `${JSON.stringify(v2)}\n`);
      const claudeBinding = path.join(projectRoot, '.claude/skills/dhpk-sample');
      if (fs.lstatSync(claudeBinding).isSymbolicLink()) fs.unlinkSync(claudeBinding);
      fs.rmSync(path.join(projectRoot, '.agents/claude-skills'), { recursive: true, force: true });

      const migrated = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(migrated.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.strictEqual(migrated.receipt.rollback.schema, 'dhpk.project-agent-projection-rollback.v2');
      assert.deepStrictEqual(migrated.receipt.selectedIds, previous.selectedIds);
      assert.deepStrictEqual(migrated.receipt.emittedIds, previous.emittedIds);
      assert.strictEqual(fs.readFileSync(portablePath).equals(portableBefore), true);

      const firstRollback = publisher.rollbackAgentsSkillsProjection({ projectRoot, inventory });
      assert.strictEqual(firstRollback.ok, true, firstRollback.error && firstRollback.error.message);
      assert.strictEqual(firstRollback.receipt.schema, 'dhpk.project-agent-projection-receipt.v2');
      assert.strictEqual(firstRollback.receipt.rollback.schema, 'dhpk.project-agent-projection-rollback.v1');
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents/claude-skills/dhpk-sample/SKILL.md')), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(firstRollback.receipt.hostBindings, 'claude'), false);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.claude/skills/dhpk-sample')), false);

      const secondRollback = publisher.rollbackAgentsSkillsProjection({ projectRoot, inventory });
      assert.strictEqual(secondRollback.ok, true, secondRollback.error && secondRollback.error.message);
      assert.strictEqual(secondRollback.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents/claude-skills/dhpk-sample/SKILL.md')), true);
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);
      assert.strictEqual(publisher.materializeRelocatableAgentsSkillsProjection(options).receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('publisher migrates structured legacy v2 metadata through rollback and re-upgrade', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-structured-v2-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-structured-v2-project-'));
    const inventory = projectInventory();
    const options = {
      sourceRoot,
      projectRoot,
      inventory,
      requestedHosts: ['claude', 'codex', 'cursor'],
      selectedStableIds: ['sample'],
      declaredSelection: true,
      hostSelections: { claude: ['sample'], codex: ['sample'], cursor: ['sample'] },
    };
    const source = [
      '---',
      'name: dhpk-sample',
      'description: Fixture',
      'metadata:',
      '  dhpk-next:',
      '    PASS: $repo-verify',
      '---',
      '# Body',
      '',
    ].join('\n');
    const relative = 'dhpk-sample/SKILL.md';
    const portablePath = path.join(projectRoot, '.agents/skills', relative);
    const receiptPath = path.join(projectRoot, '.agents/.dhpk-installed.json');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), source);
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(installed.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');

      // Recreate the legacy v2 representation: canonical structured metadata
      // remained in its managed SKILL.md instead of being portable-serialized.
      const v2 = asV2Receipt(installed.receipt);
      fs.writeFileSync(portablePath, source);
      v2.generatedFingerprints[relative] = crypto.createHash('sha256').update(source).digest('hex');
      delete v2.receiptFingerprint;
      v2.receiptFingerprint = fingerprint(v2);
      write(receiptPath, `${JSON.stringify(v2)}\n`);
      const claudeBinding = path.join(projectRoot, '.claude/skills/dhpk-sample');
      if (fs.lstatSync(claudeBinding).isSymbolicLink()) fs.unlinkSync(claudeBinding);
      fs.rmSync(path.join(projectRoot, '.agents/claude-skills'), { recursive: true, force: true });

      const legacyValidation = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(legacyValidation.ok, true, legacyValidation.errors.join('\n'));

      const migrated = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(migrated.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.strictEqual(parseFrontmatter(fs.readFileSync(portablePath, 'utf8')).metadata['dhpk-next'], JSON.stringify({ PASS: '$repo-verify' }));
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);

      const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot, inventory });
      assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
      assert.strictEqual(rolledBack.receipt.schema, 'dhpk.project-agent-projection-receipt.v2');
      assert.strictEqual(fs.readFileSync(portablePath, 'utf8'), source);
      const rolledBackValidation = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(rolledBackValidation.ok, true, rolledBackValidation.errors.join('\n'));

      const reupgraded = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(reupgraded.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.strictEqual(parseFrontmatter(fs.readFileSync(portablePath, 'utf8')).metadata['dhpk-next'], JSON.stringify({ PASS: '$repo-verify' }));
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection(options).ok, true);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('publisher refuses a foreign Claude sibling before changing the portable projection or receipt', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-conflict-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-claude-conflict-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['claude', 'codex'] };
    const foreignPath = path.join(projectRoot, '.agents/claude-skills/dhpk-sample/SKILL.md');
    try {
      write(path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Canonical\n');
      write(foreignPath, '# User-owned Claude skill\n');
      assert.throws(
        () => publisher.materializeRelocatableAgentsSkillsProjection(options),
        /conflict|foreign|managed|collision/i,
      );
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md')), false);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents/.dhpk-installed.json')), false);
      assert.strictEqual(fs.readFileSync(foreignPath, 'utf8'), '# User-owned Claude skill\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('rollback restores both portable and Claude representations with their host bindings', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dual-rollback-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-dual-rollback-project-'));
    const inventory = projectInventory();
    const options = {
      sourceRoot,
      projectRoot,
      inventory,
      requestedHosts: ['claude', 'codex', 'cursor'],
      selectedStableIds: ['sample'],
      declaredSelection: true,
      hostSelections: { claude: ['sample'], codex: ['sample'], cursor: ['sample'] },
    };
    const sourceSkill = path.join(sourceRoot, 'skills/dhpk-sample/SKILL.md');
    const original = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Original\n';
    const updated = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Updated\n';
    const portablePath = path.join(projectRoot, '.agents/skills/dhpk-sample/SKILL.md');
    const claudePath = path.join(projectRoot, '.agents/claude-skills/dhpk-sample/SKILL.md');
    try {
      write(sourceSkill, original);
      publisher.materializeRelocatableAgentsSkillsProjection(options);
      write(sourceSkill, updated);
      publisher.materializeRelocatableAgentsSkillsProjection({ ...options, allowCanonicalChanges: true });
      const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
      assert.strictEqual(fs.existsSync(portablePath), true, 'portable representation remains after rollback');
      assert.strictEqual(fs.existsSync(claudePath), true, 'Claude representation remains after rollback');
      assert.strictEqual(fs.readFileSync(portablePath, 'utf8'), original);
      assert.strictEqual(fs.readFileSync(claudePath, 'utf8'), original);
      assert.strictEqual(fs.realpathSync(path.join(projectRoot, '.claude/skills/dhpk-sample')), fs.realpathSync(path.dirname(claudePath)));
      assert.strictEqual(fs.realpathSync(path.join(projectRoot, '.codex/skills/dhpk-sample')), fs.realpathSync(path.dirname(portablePath)));
      assert.strictEqual(fs.realpathSync(path.join(projectRoot, '.cursor/skills/dhpk-sample')), fs.realpathSync(path.dirname(portablePath)));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('mixed Host selections keep Claude discovery isolated through update, rollback, and uninstall', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-mixed-publisher-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-mixed-publisher-project-'));
    const base = projectInventory();
    const inventory = {
      ...base,
      skills: [...base.skills, {
        id: 'other', name: 'dhpk-other', path: 'skills/dhpk-other',
        lifecycle: 'promoted', surfaces: ['codex-sync'],
      }],
      surface_membership: { ...base.surface_membership, 'codex-sync': ['sample', 'other'] },
    };
    const options = {
      sourceRoot, projectRoot, inventory, profileId: 'portable-core',
      requestedHosts: ['claude', 'codex'], selectedStableIds: ['sample', 'other'], declaredSelection: true,
      hostSelections: { claude: ['sample'], codex: ['other'] },
    };
    const sourceSkill = path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md');
    const original = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Original\n';
    const updated = '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Updated\n';
    const managedSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
    const claudeLink = path.join(projectRoot, '.claude', 'skills', 'dhpk-sample');
    const codexLink = path.join(projectRoot, '.codex', 'skills', 'dhpk-other');
    const foreignFile = path.join(projectRoot, '.claude', 'skills', 'foreign', 'keep.md');
    try {
      write(sourceSkill, original);
      write(path.join(sourceRoot, 'skills', 'dhpk-other', 'SKILL.md'),
        '---\nname: dhpk-other\ndescription: Codex fixture\n---\n# Other\n');
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.deepStrictEqual(installed.receipt.bindingPaths.claude.map((entry) => entry.path), ['.claude/skills/dhpk-sample']);
      assert.deepStrictEqual(installed.receipt.bindingPaths.codex.map((entry) => entry.path), ['.codex/skills/dhpk-other']);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'dhpk-other')), false);
      assert.strictEqual(fs.existsSync(claudeLink), true);
      assert.strictEqual(fs.existsSync(codexLink), true);
      const checked = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(checked.ok, true, checked.errors.join('; '));
      write(foreignFile, '# User-owned\n');
      write(sourceSkill, updated);
      publisher.materializeRelocatableAgentsSkillsProjection({ ...options, allowCanonicalChanges: true });
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), updated);
      const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
      assert.deepStrictEqual(rolledBack.receipt.bindingPaths.claude.map((entry) => entry.path), ['.claude/skills/dhpk-sample']);
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), original);
      const removed = publisher.uninstallAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
      assert.strictEqual(fs.existsSync(claudeLink), false);
      assert.strictEqual(fs.existsSync(codexLink), false);
      assert.strictEqual(fs.readFileSync(foreignFile, 'utf8'), '# User-owned\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('project publisher installs, validates, rolls back an authorized update, and uninstalls only owned paths', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-publisher-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-publisher-project-'));
    const inventory = projectInventory();
    const sourceSkill = path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md');
    const options = { sourceRoot, projectRoot, inventory, profileId: 'portable-core', requestedHosts: ['claude'] };
    const originalSkill = '---\nname: dhpk-sample\ndescription: "A fixture skill."\n---\n# Original\n';
    const updatedSkill = '---\nname: dhpk-sample\ndescription: "A fixture skill."\n---\n# Updated\n';
    const managedSkill = path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md');
    const foreignFile = path.join(projectRoot, '.agents', 'skills', 'foreign', 'keep.md');

    try {
      write(sourceSkill, originalSkill);
      const installed = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(installed.state, 'INSTALLED');
      assert.strictEqual(installed.receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.deepStrictEqual(installed.receipt.managedPaths, ['.dhpk-projection.json', 'dhpk-sample/SKILL.md']);
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), originalSkill);

      const validated = publisher.validateRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(validated.ok, true, validated.errors.join('; '));

      write(foreignFile, '# User-owned content\n');
      write(sourceSkill, updatedSkill);
      const updated = publisher.materializeRelocatableAgentsSkillsProjection({ ...options, allowCanonicalChanges: true });
      assert.strictEqual(updated.state, 'UPDATED');
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), updatedSkill);

      const rolledBack = publisher.rollbackAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(rolledBack.ok, true, rolledBack.error && rolledBack.error.message);
      assert.strictEqual(fs.readFileSync(managedSkill, 'utf8'), originalSkill);

      const removed = publisher.uninstallAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
      assert.strictEqual(removed.state, 'REMOVED');
      assert.strictEqual(fs.existsSync(managedSkill), false);
      assert.strictEqual(fs.readFileSync(foreignFile, 'utf8'), '# User-owned content\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('v3 Claude discovery repairs the exact portable-root receipt defect only during publication', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-repair-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-repair-project-'));
    const inventory = projectInventory();
    const options = { sourceRoot, projectRoot, inventory, profileId: 'portable-core', requestedHosts: ['claude'] };
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    const claudeLink = path.join(projectRoot, '.claude', 'skills', 'dhpk-sample');
    const legacyTarget = '../../.agents/skills/dhpk-sample';

    try {
      write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      publisher.materializeRelocatableAgentsSkillsProjection(options);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
      receipt.bindings = JSON.parse(JSON.stringify(receipt.hostBindings));
      receipt.bindingPaths.claude = receipt.bindingPaths.claude.map((binding) => ({ ...binding, target: legacyTarget }));
      delete receipt.receiptFingerprint;
      receipt.receiptFingerprint = fingerprint(receipt);
      write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      fs.unlinkSync(claudeLink);
      fs.symlinkSync(legacyTarget, claudeLink, 'dir');

      assert.strictEqual(receipt.receiptFingerprint, fingerprint(withoutKey(receipt, 'receiptFingerprint')));
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection({ projectRoot }).ok, false);

      const repaired = publisher.materializeRelocatableAgentsSkillsProjection(options);
      assert.strictEqual(repaired.receipt.hostBindings.claude.discovery.sourceRoot, '.agents/claude-skills');
      assert.deepStrictEqual(repaired.receipt.bindingPaths.claude, [{
        path: '.claude/skills/dhpk-sample',
        target: '../../.agents/claude-skills/dhpk-sample',
      }]);
      assert.strictEqual(fs.readlinkSync(claudeLink), '../../.agents/claude-skills/dhpk-sample');
      assert.strictEqual(repaired.receipt.receiptFingerprint, fingerprint(withoutKey(repaired.receipt, 'receiptFingerprint')));
      assert.strictEqual(publisher.validateRelocatableAgentsSkillsProjection({ projectRoot }).ok, true);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('v3 Claude lifecycle read rejects a mismatched legacy target and a changed fingerprint', () => {
    for (const corruption of ['mismatched target', 'changed fingerprint']) {
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-reject-source-'));
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-reject-project-'));
      const inventory = projectInventory();
      const options = { sourceRoot, projectRoot, inventory, requestedHosts: ['claude'] };
      const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
      try {
        write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
        publisher.materializeRelocatableAgentsSkillsProjection(options);
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        receipt.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
        receipt.bindings = JSON.parse(JSON.stringify(receipt.hostBindings));
        receipt.bindingPaths.claude = receipt.bindingPaths.claude.map((binding) => ({ ...binding, target: '../../.agents/skills/dhpk-sample' }));
        delete receipt.receiptFingerprint;
        receipt.receiptFingerprint = fingerprint(receipt);
        if (corruption === 'mismatched target') {
          receipt.bindingPaths.claude[0].target = '../../.agents/claude-skills/wrong-name';
          delete receipt.receiptFingerprint;
          receipt.receiptFingerprint = fingerprint(receipt);
        } else {
          receipt.receiptFingerprint = '0'.repeat(64);
        }
        write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

        assert.throws(() => publisher.materializeRelocatableAgentsSkillsProjection(options), /invalid receipt|fingerprint|binding|target/i, corruption);
        assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), `${JSON.stringify(receipt, null, 2)}\n`);
      } finally {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });

  test('direct uninstall removes a fingerprint-valid v3 Claude receipt with the old portable discovery root', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-uninstall-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-uninstall-project-'));
    const inventory = projectInventory();
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    const claudeLink = path.join(projectRoot, '.claude', 'skills', 'dhpk-sample');
    const legacyTarget = '../../.agents/skills/dhpk-sample';
    try {
      write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory, requestedHosts: ['claude'] });
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
      receipt.bindings = JSON.parse(JSON.stringify(receipt.hostBindings));
      receipt.bindingPaths.claude = receipt.bindingPaths.claude.map((binding) => ({ ...binding, target: legacyTarget }));
      delete receipt.receiptFingerprint;
      receipt.receiptFingerprint = fingerprint(receipt);
      write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      fs.unlinkSync(claudeLink);
      fs.symlinkSync(legacyTarget, claudeLink, 'dir');

      const removed = publisher.uninstallAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(removed.ok, true, removed.error && removed.error.message);
      assert.strictEqual(removed.state, 'REMOVED');
      assert.strictEqual(fs.existsSync(receiptPath), false);
      assert.strictEqual(fs.existsSync(claudeLink), false);
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'dhpk-sample', 'SKILL.md')), false);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('gen-agents-skills CLI --update repairs the v3 Claude portable-root discovery receipt', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-cli-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-claude-cli-project-'));
    const inventory = projectInventory();
    const receiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
    const claudeLink = path.join(projectRoot, '.claude', 'skills', 'dhpk-sample');
    const legacyTarget = '../../.agents/skills/dhpk-sample';
    const cli = path.join(__dirname, '..', 'scripts', 'ci', 'gen-agents-skills.js');
    try {
      write(path.join(sourceRoot, 'skills', 'dhpk-sample', 'SKILL.md'), '---\nname: dhpk-sample\ndescription: Fixture\n---\n# Skill\n');
      write(path.join(sourceRoot, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
      publisher.materializeRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory, requestedHosts: ['claude'] });
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      receipt.hostBindings.claude.discovery.sourceRoot = '.agents/skills';
      receipt.bindings = JSON.parse(JSON.stringify(receipt.hostBindings));
      receipt.bindingPaths.claude = receipt.bindingPaths.claude.map((binding) => ({ ...binding, target: legacyTarget }));
      delete receipt.receiptFingerprint;
      receipt.receiptFingerprint = fingerprint(receipt);
      write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      fs.unlinkSync(claudeLink);
      fs.symlinkSync(legacyTarget, claudeLink, 'dir');

      const result = childProcess.spawnSync(process.execPath, [
        cli, '--source-root', sourceRoot, '--project-root', projectRoot, '--host', 'claude', '--update',
      ], { encoding: 'utf8', timeout: 20000 });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const repaired = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(repaired.hostBindings.claude.discovery.sourceRoot, '.agents/claude-skills');
      assert.deepStrictEqual(repaired.bindingPaths.claude, [{
        path: '.claude/skills/dhpk-sample',
        target: '../../.agents/claude-skills/dhpk-sample',
      }]);
      assert.strictEqual(fs.readlinkSync(claudeLink), '../../.agents/claude-skills/dhpk-sample');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

{
  // Source suite: tests/project-agent-runtime-assets.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const {
    materializeRelocatableAgentsSkillsProjection,
    validateRelocatableAgentsSkillsProjection,
  } = require('../scripts/lib/project-agent-projection-publisher');

  function write(root, relative, content, mode = 0o644) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode });
    return target;
  }

  function inventory(runtimeAssets = undefined) {
    return {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{
        id: 'check',
        name: 'repo-check',
        path: 'skills/repo-check',
        lifecycle: 'promoted',
        surfaces: ['claude-core'],
      }],
      surface_membership: { 'claude-core': ['check'] },
      project_agent_projection: {
        schema: 'dhpk.project-agent-projection.v1',
        scope: 'project',
        owner: 'dhpk.project-agent-projection',
        managed_root: '.agents/skills',
        receipt: '.agents/.dhpk-installed.json',
        profiles: {
          'portable-core': {
            version: 'portable-core-v1',
            compatibility_mode: 'portable-core',
            stable_ids: ['check'],
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
      },
      ...(runtimeAssets === undefined ? {} : { runtimeAssets }),
    };
  }

  function makeFixture(staleRuntimeAssets) {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-project-'));
    write(sourceRoot, 'skills/repo-check/SKILL.md', '---\nname: repo-check\ndescription: "Run the packaged check."\n---\nRun scripts/check.js.\n');
    write(sourceRoot, 'skills/repo-check/scripts/check.js', "process.stdout.write(require('./lib/value'));\n", 0o755);
    write(sourceRoot, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'modern runtime passed';\n");
    if (staleRuntimeAssets) {
      // A stale retired descriptor is inert: it cannot inject or escape.
      write(sourceRoot, 'skills/repo-check/skill-package.json', JSON.stringify({
        schema: 'dhpk.skill-package.v1', id: 'check', version: '1.0.0', entry: 'SKILL.md',
        resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
        runtimeAssets: staleRuntimeAssets,
      }));
      write(sourceRoot, 'scripts/overlay-only.js', "module.exports = 'overlay';\n");
    }
    return { sourceRoot, projectRoot };
  }

  function publish(sourceRoot, projectRoot, sourceInventory = inventory()) {
    return materializeRelocatableAgentsSkillsProjection({
      sourceRoot,
      projectRoot,
      inventory: sourceInventory,
      profileId: 'portable-core',
      requestedHosts: ['claude'],
    });
  }

  function renamedInventory(name) {
    const value = inventory();
    value.skills = [{ ...value.skills[0], name, path: `skills/${name}` }];
    value.renamed_skill_names = [{
      id: 'check',
      oldName: 'repo-check-old',
      oldPath: 'skills/repo-check-old',
      newName: 'repo-check-new',
      newPath: 'skills/repo-check-new',
      rollback: { release: '1.0.0' },
    }];
    return value;
  }

  test('relocatable project projection ships the Skill-local runner after source removal', () => {
    const { sourceRoot, projectRoot } = makeFixture();
    try {
      publish(sourceRoot, projectRoot);
      const outputRoot = path.join(projectRoot, '.agents', 'skills');
      const runner = path.join(outputRoot, 'repo-check', 'scripts', 'check.js');
      assert.ok(fs.existsSync(runner), 'Skill-local runner was not published into the project artifact');
      assert.strictEqual(fs.statSync(runner).mode & 0o111, 0o111);
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      const execution = spawnSync(process.execPath, [runner], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
      });
      assert.strictEqual(execution.status, 0, execution.stderr);
      assert.strictEqual(execution.stdout, 'modern runtime passed');
      const checked = validateRelocatableAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(checked.ok, true, checked.errors.join('; '));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('relocatable project projection detects runtime output tamper and source drift', () => {
    const { sourceRoot, projectRoot } = makeFixture();
    try {
      publish(sourceRoot, projectRoot);
      const runner = path.join(projectRoot, '.agents', 'skills', 'repo-check', 'scripts', 'check.js');
      assert.ok(fs.existsSync(runner), 'Skill-local runner was not published into the project artifact');
      fs.appendFileSync(runner, '\n// local tamper\n');
      const tampered = validateRelocatableAgentsSkillsProjection({ projectRoot });
      assert.strictEqual(tampered.ok, false);
      assert.match(tampered.errors.join('\n'), /fingerprint|managed|modified/i);

      fs.writeFileSync(runner, "process.stdout.write(require('./lib/value'));\n", { mode: 0o755 });
      write(sourceRoot, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'changed source runtime';\n");
      assert.throws(
        () => publish(sourceRoot, projectRoot),
        /source|drift|fingerprint/i,
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('a stale descriptor cannot inject or escape, and a symlinked Skill script is rejected', () => {
    const stale = makeFixture([
      { source: 'scripts/overlay-only.js', destination: 'SKILL.md', required: true },
      { source: '../outside.js', destination: 'scripts/outside.js', required: true },
    ]);
    try {
      publish(stale.sourceRoot, stale.projectRoot);
      const skill = path.join(stale.projectRoot, '.agents', 'skills', 'repo-check');
      assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /Run the packaged check/);
      assert.strictEqual(fs.existsSync(path.join(skill, 'scripts', 'outside.js')), false);
    } finally {
      fs.rmSync(stale.sourceRoot, { recursive: true, force: true });
      fs.rmSync(stale.projectRoot, { recursive: true, force: true });
    }

    const linked = makeFixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-runtime-outside-'));
    try {
      const runner = path.join(linked.sourceRoot, 'skills', 'repo-check', 'scripts', 'check.js');
      write(outside, 'check.js', 'outside\n');
      fs.rmSync(runner);
      fs.symlinkSync(path.join(outside, 'check.js'), runner);
      assert.throws(() => publish(linked.sourceRoot, linked.projectRoot), /symlink|unsafe/i);
      assert.strictEqual(fs.existsSync(path.join(linked.projectRoot, '.agents', '.dhpk-installed.json')), false);
    } finally {
      fs.rmSync(linked.sourceRoot, { recursive: true, force: true });
      fs.rmSync(linked.projectRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('relocatable project projection migrates an approved stable-ID rename by identity', () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-rename-source-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-project-rename-project-'));
    const oldInventory = renamedInventory('repo-check-old');
    const newInventory = renamedInventory('repo-check-new');
    delete oldInventory.renamed_skill_names;
    try {
      write(sourceRoot, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
      materializeRelocatableAgentsSkillsProjection({
        sourceRoot,
        projectRoot,
        inventory: oldInventory,
        profileId: 'portable-core',
        requestedHosts: ['claude'],
      });
      write(sourceRoot, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

      materializeRelocatableAgentsSkillsProjection({
        sourceRoot,
        projectRoot,
        inventory: newInventory,
        profileId: 'portable-core',
        requestedHosts: ['claude'],
      });

      const outputRoot = path.join(projectRoot, '.agents', 'skills');
      const receipt = JSON.parse(fs.readFileSync(path.join(projectRoot, '.agents', '.dhpk-installed.json'), 'utf8'));
      assert.deepStrictEqual(receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name })), [{ stableId: 'check', name: 'repo-check-new' }]);
      assert.strictEqual(fs.existsSync(path.join(outputRoot, 'repo-check-old', 'SKILL.md')), false);
      assert.strictEqual(fs.existsSync(path.join(outputRoot, 'repo-check-new', 'SKILL.md')), true);
      const checked = validateRelocatableAgentsSkillsProjection({ sourceRoot, projectRoot, inventory: newInventory, requestedHosts: ['claude'] });
      assert.strictEqual(checked.ok, true, checked.errors.join('; '));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
}

{
  // Source suite: tests/project-workflow-resources.test.js
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { materializeAgentsSkillsProjection, validateAgentsSkillsProjection } = require('../scripts/lib/agents-skills-package');

  function write(root, file, content) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  test('project skill projection ships its physical runner closure without an ambient source checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-workflow-resource-'));
    try {
      const inventory = {
        schema: 'dhpk.distribution-inventory.v2',
        skills: [{ id: 'check', name: 'repo-check', path: 'skills/repo-check', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
        surface_membership: { 'agent-plugin': ['check'] },
      };
      write(root, 'manifests/distribution-inventory.json', JSON.stringify(inventory));
      write(root, 'skills/repo-check/SKILL.md', '---\nname: repo-check\ndescription: "Run the packaged check."\n---\nRun scripts/check.js.\n');
      write(root, 'skills/repo-check/scripts/check.js', "process.stdout.write(require('./lib/value'));\n");
      write(root, 'skills/repo-check/scripts/lib/value.js', "module.exports = 'independent package check passed';\n");
      // A stale retired descriptor naming a repository overlay must be inert.
      write(root, 'skills/repo-check/skill-package.json', JSON.stringify({
        schema: 'dhpk.skill-package.v1', id: 'check', version: '1.0.0', entry: 'SKILL.md',
        resources: [{ path: 'SKILL.md', kind: 'entry', required: true }],
        runtimeAssets: [{ source: 'scripts/overlay-only.js', destination: 'scripts/overlay-only.js', required: true }],
      }));
      write(root, 'scripts/overlay-only.js', "module.exports = 'overlay';\n");
      const outDir = path.join(root, '.agents', 'skills');
      materializeAgentsSkillsProjection({ root, inventory, outDir });
      const validation = validateAgentsSkillsProjection({ root, inventory, outDir });
      assert.strictEqual(validation.ok, true, JSON.stringify(validation.errors));
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check', 'scripts', 'overlay-only.js')), false,
        'a repository overlay must never be injected into the projection');
      // Removing only the disposable fixture's source proves the runner cannot
      // fall back to a parent checkout or unprojected source library.
      fs.rmSync(path.join(root, 'scripts'), { recursive: true });
      fs.rmSync(path.join(root, 'skills'), { recursive: true });
      const execution = spawnSync(process.execPath, [path.join(outDir, 'repo-check/scripts/check.js')], {
        cwd: os.tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH },
      });
      assert.strictEqual(execution.status, 0, execution.stderr);
      assert.strictEqual(execution.stdout, 'independent package check passed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('legacy projection migrates an approved stable-ID public-name rename without duplicate ownership', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-rename-migration-'));
    const oldInventory = {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'rename-check', name: 'repo-check-old', path: 'skills/repo-check-old', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      surface_membership: { 'agent-plugin': ['rename-check'] },
    };
    const newInventory = {
      ...oldInventory,
      skills: [{ ...oldInventory.skills[0], name: 'repo-check-new', path: 'skills/repo-check-new' }],
      renamed_skill_names: [{
        id: 'rename-check',
        oldName: 'repo-check-old',
        oldPath: 'skills/repo-check-old',
        newName: 'repo-check-new',
        newPath: 'skills/repo-check-new',
        rollback: { release: '1.0.0' },
      }],
    };
    const outDir = path.join(root, '.agents', 'skills');
    try {
      write(root, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
      materializeAgentsSkillsProjection({ root, inventory: oldInventory, outDir });
      write(root, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

      // Unmanaged content inside the tree blocks the whole-tree replace (REQ-9) and leaves it unchanged.
      write(outDir, 'repo-check-old/foreign.txt', 'foreign skill content.\n');
      const receiptBefore = fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8');
      assert.throws(() => materializeAgentsSkillsProjection({ root, inventory: newInventory, outDir }), /OWNERSHIP_REFUSED/);
      assert.strictEqual(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'), receiptBefore);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old', 'SKILL.md')), true);
      fs.rmSync(path.join(outDir, 'repo-check-old', 'foreign.txt'));

      materializeAgentsSkillsProjection({ root, inventory: newInventory, outDir });

      const receipt = JSON.parse(fs.readFileSync(path.join(outDir, '.dhpk-projection.json'), 'utf8'));
      assert.deepStrictEqual(receipt.entries.map((entry) => ({ id: entry.id, name: entry.name })), [{ id: 'rename-check', name: 'repo-check-new' }]);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old', 'SKILL.md')), false);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old.md')), false);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-old')), false);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new', 'SKILL.md')), true);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new.md')), true);
      const validation = validateAgentsSkillsProjection({ root, inventory: newInventory, outDir });
      assert.strictEqual(validation.ok, true, validation.errors.join('; '));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('legacy rename migration preserves edited receipt-owned content as a conflict', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-rename-conflict-'));
    const inventory = {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [{ id: 'rename-check', name: 'repo-check-old', path: 'skills/repo-check-old', lifecycle: 'promoted', surfaces: ['agent-plugin'] }],
      surface_membership: { 'agent-plugin': ['rename-check'] },
    };
    const renamedInventory = {
      ...inventory,
      skills: [{ ...inventory.skills[0], name: 'repo-check-new', path: 'skills/repo-check-new' }],
      renamed_skill_names: [{
        id: 'rename-check',
        oldName: 'repo-check-old',
        oldPath: 'skills/repo-check-old',
        newName: 'repo-check-new',
        newPath: 'skills/repo-check-new',
        rollback: { release: '1.0.0' },
      }],
    };
    const outDir = path.join(root, '.agents', 'skills');
    try {
      write(root, 'skills/repo-check-old/SKILL.md', '---\nname: repo-check-old\ndescription: "Old check."\n---\nOld body.\n');
      materializeAgentsSkillsProjection({ root, inventory, outDir });
      fs.appendFileSync(path.join(outDir, 'repo-check-old', 'SKILL.md'), '\nuser edit.\n');
      write(root, 'skills/repo-check-new/SKILL.md', '---\nname: repo-check-new\ndescription: "New check."\n---\nNew body.\n');

      assert.throws(
        () => materializeAgentsSkillsProjection({ root, inventory: renamedInventory, outDir }),
        /receipt-owned renamed skill file.*(modified|foreign)|modified|foreign/i,
      );
      assert.match(fs.readFileSync(path.join(outDir, 'repo-check-old', 'SKILL.md'), 'utf8'), /user edit/);
      assert.strictEqual(fs.existsSync(path.join(outDir, 'repo-check-new', 'SKILL.md')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

run('project-agent-projection-publisher');
