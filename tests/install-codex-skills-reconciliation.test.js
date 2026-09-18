'use strict';

// Behavioral coverage for install-codex-skills.sh (install-codex-skills-reconciliation).
// Every installer invocation remains a real child process so exit status,
// stdout JSON, process-group cleanup, and cwd restoration stay under test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/install-codex-skills-fixtures');

const {
  ROOT,
  HOOK,
  INSTALLER_CHILD_TIMEOUT_MS,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  descriptorPseudoPathBlocker,
  materializationFailureShim,
  parentReplacementGate,
  waitForFile,
  rewriteAgentAsHistoricalManagedSymlink,
  materializeFixtureSkill,
  collisionFixture,
  transactionMetadataSnapshot,
  provenanceDriftPlanFixture
} = fixtures;

test('copy and symlink installs do not require descriptor pseudo-path child traversal', () => {
  for (const args of [['--copy', '--force'], ['--force']]) {
    const scratch = projectRoot();
    const shim = descriptorPseudoPathBlocker();
    const cwdAudit = path.join(shim, 'cwd-audit.txt');
    try {
      const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
      const result = runInstaller(scratch, args, ROOT, {
        PYTHONPATH: pythonPath,
        DHPK_TEST_CWD_AUDIT_FILE: cwdAudit,
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(fs.readFileSync(cwdAudit, 'utf8'), scratch,
        'materialization must restore the installer working directory');
      const receipt = JSON.parse(
        fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'),
      );
      assert.strictEqual(receipt.mode, args.includes('--copy') ? 'copy' : 'symlink');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(shim, { recursive: true, force: true });
    }
  }
});

test('copy failure restores the installer working directory before reporting failure', () => {
  const scratch = projectRoot();
  const shim = materializationFailureShim();
  const cwdAudit = path.join(shim, 'cwd-audit.txt');
  try {
    const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const result = runInstaller(scratch, ['--copy', '--force'], ROOT, {
      PYTHONPATH: pythonPath,
      DHPK_TEST_CWD_AUDIT_FILE: cwdAudit,
    });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /controlled materialization failure/);
    assert.strictEqual(fs.readFileSync(cwdAudit, 'utf8'), scratch,
      'failed materialization must restore the installer working directory');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'failed materialization must not publish a receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

test('parent-path replacement cannot redirect a pinned update into an external tree', () => {
  const scratch = projectRoot();
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parent-gate-plugin-')));
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-parent-gate-external-')));
  const shim = parentReplacementGate();
  let watcher;
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, '.claude-plugin', 'plugin.json'),
      path.join(plugin, '.claude-plugin', 'plugin.json'),
    );
    copyDistributionInventory(plugin);

    const installed = runInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const changed = fs.readdirSync(path.join(plugin, 'codex', 'skills')).sort()[0];
    const changedSource = path.join(plugin, 'codex', 'skills', changed);
    if (fs.lstatSync(changedSource).isSymbolicLink()) {
      const canonicalSource = fs.realpathSync(changedSource);
      fs.rmSync(changedSource, { recursive: true, force: true });
      fs.cpSync(canonicalSource, changedSource, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(changedSource, 'SKILL.md'), '\nparent replacement fixture\n');

    fs.writeFileSync(path.join(external, 'keep.txt'), 'external sentinel\n');
    const externalBefore = completeTreeFingerprint(external);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const ready = path.join(shim, 'ready');
    const release = path.join(shim, 'release');
    const done = path.join(shim, 'done');
    const watcherError = path.join(shim, 'watcher-error');
    const skills = path.join(scratch, '.codex', 'skills');
    const pinnedSkills = path.join(scratch, '.codex', 'skills-pinned');
    const watcherScript = path.join(shim, 'replace-parent.js');
    fs.writeFileSync(watcherScript, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const [ready, parent, pinned, external, release, done, errorFile] = process.argv.slice(2);",
      'const signal = new Int32Array(new SharedArrayBuffer(4));',
      'const deadline = Date.now() + 10000;',
      'try {',
      '  while (!fs.existsSync(ready) && Date.now() < deadline) Atomics.wait(signal, 0, 0, 10);',
      "  if (!fs.existsSync(ready)) throw new Error('ready marker timed out');",
      '  fs.renameSync(parent, pinned);',
      "  fs.symlinkSync(external, parent, 'dir');",
      "  fs.writeFileSync(release, 'release');",
      "  fs.writeFileSync(done, 'done');",
      '} catch (error) {',
      '  fs.writeFileSync(errorFile, error.stack || String(error));',
      "  fs.writeFileSync(release, 'release');",
      '  process.exitCode = 1;',
      '}',
      '',
    ].join('\n'));
    watcher = spawn(process.execPath, [
      watcherScript,
      ready,
      skills,
      pinnedSkills,
      external,
      release,
      done,
      watcherError,
    ], { stdio: 'ignore' });

    const pythonPath = [shim, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const result = runInstaller(scratch, ['--copy', '--update', '--force'], plugin, {
      PYTHONPATH: pythonPath,
      DHPK_TEST_PARENT_OPEN_READY_FILE: ready,
      DHPK_TEST_PARENT_OPEN_RELEASE_FILE: release,
    });
    assert.ok(waitForFile(done),
      fs.existsSync(watcherError) ? fs.readFileSync(watcherError, 'utf8') : 'parent watcher did not complete');
    assert.notStrictEqual(result.status, 0,
      'a replaced public parent must fail closed instead of publishing a success receipt');
    assert.strictEqual(completeTreeFingerprint(external), externalBefore,
      'descriptor-pinned work must not mutate the replacement target');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore,
      'a replaced parent must not publish a receipt for the wrong directory identity');
  } finally {
    if (watcher && watcher.exitCode === null) watcher.kill('SIGKILL');
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

test('copy mode materializes skills/agents and records the install manifest', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const codex = path.join(scratch, '.codex');
    const skills = fs.readdirSync(path.join(codex, 'skills'));
    const agents = fs.readdirSync(path.join(codex, 'agents'));
    assert.ok(skills.length > 0, 'expected copied Codex skills');
    assert.ok(agents.length > 0, 'expected copied Codex agents');
    assert.ok(!fs.lstatSync(path.join(codex, 'skills', skills[0])).isSymbolicLink(), 'copy mode must materialize files');
    const manifest = JSON.parse(fs.readFileSync(path.join(codex, '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(manifest.managed_entries && manifest.managed_entries.skills);
    assert.ok(manifest.managed_entries && manifest.managed_entries.agents);
    assert.ok(manifest.managed_entries && manifest.managed_entries.supporting_assets);
    const supporting = manifest.managed_entries.supporting_assets['dhpk/agent-traps/_common/prompt-defense.md'];
    assert.ok(supporting, 'expected the Codex prompt-defense trap sheet to be receipt-managed');
    assert.strictEqual(supporting.destination, 'dhpk/agent-traps/_common/prompt-defense.md');
    assert.strictEqual(supporting.source, 'dhpk/agent-traps/_common/prompt-defense.md');
    assert.strictEqual(supporting.mode, 'copy');
    assert.ok(fs.existsSync(path.join(codex, supporting.destination)),
      'receipt-managed Codex supporting assets must materialize in the clean project');
    assert.match(supporting.source_fingerprint, /^[a-f0-9]{64}$/);
    const skillEntry = manifest.managed_entries.skills[skills[0]];
    assert.strictEqual(skillEntry.destination, `skills/${skills[0]}`);
    assert.strictEqual(skillEntry.source, `skills/${skills[0]}`);
    assert.strictEqual(skillEntry.mode, 'copy');
    assert.match(skillEntry.source_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(skillEntry.destination_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(skillEntry.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(typeof skillEntry.id === 'string' && skillEntry.id.length > 0);
    assert.strictEqual(skillEntry.name, skills[0]);
    assert.ok(skillEntry.ownership_marker);
    assert.strictEqual(manifest.mode, 'copy');
    assert.strictEqual(manifest.plugin_version, JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'))).version);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('default mode keeps skills linked but materializes Codex agent role files', () => {
  const scratch = projectRoot();
  try {
    const res = runInstaller(scratch, ['--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);

    const codex = path.join(scratch, '.codex');
    const skillName = fs.readdirSync(path.join(codex, 'skills'))[0];
    const agentName = fs.readdirSync(path.join(codex, 'agents'))[0];
    const receipt = JSON.parse(fs.readFileSync(path.join(codex, '.dhpk-installed.json'), 'utf8'));

    assert.ok(fs.lstatSync(path.join(codex, 'skills', skillName)).isSymbolicLink(),
      'default mode must preserve linked Codex skills');
    assert.ok(fs.lstatSync(path.join(codex, 'agents', agentName)).isFile(),
      'Codex agent role TOMLs must be physical files for runtime discovery');
    assert.strictEqual(receipt.mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.skills[skillName].mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ordinary update migrates a historical managed agent symlink only once', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const codex = path.join(scratch, '.codex');
    const agentName = fs.readdirSync(path.join(codex, 'agents'))[0];
    const skillName = fs.readdirSync(path.join(codex, 'skills'))[0];
    const skillTarget = path.join(codex, 'skills', skillName);
    const skillSource = fs.realpathSync(skillTarget);
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName);

    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 1, `${planned.stdout}\n${planned.stderr}`);
    const plan = JSON.parse(planned.stdout);
    assert.deepStrictEqual(plan.updates.map((entry) => entry.path), [historical.relative]);
    assert.deepStrictEqual(plan.collisions, []);

    const updated = runInstaller(scratch, ['--update', '--force']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.lstatSync(historical.destination).isFile(), 'managed role must migrate to a physical file');
    assert.strictEqual(fs.readFileSync(historical.destination, 'utf8'), fs.readFileSync(historical.source, 'utf8'));
    assert.strictEqual(fs.realpathSync(skillTarget), skillSource, 'unrelated skill symlink must remain unchanged');
    const receipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(receipt.mode, 'symlink');
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
    assert.strictEqual(receipt.reconciliation.updated, 1);

    const repeated = runInstaller(scratch, ['--update', '--force']);
    assert.strictEqual(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const repeatedReceipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(repeatedReceipt.reconciliation.updated, 0);
    assert.strictEqual(repeatedReceipt.reconciliation.backed_up, 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('explicit legacy migration rematerializes exact agent symlinks as physical files', () => {
  const scratch = projectRoot();
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName);
    const legacyReceipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    legacyReceipt.schema_version = 2;
    legacyReceipt.plugin_version = 'legacy';
    legacyReceipt.source_fingerprint = 'legacy';
    fs.writeFileSync(historical.receiptPath, `${JSON.stringify(legacyReceipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.lstatSync(historical.destination).isFile(),
      'legacy migration must not record copy ownership while leaving an agent symlink');
    const receipt = JSON.parse(fs.readFileSync(historical.receiptPath, 'utf8'));
    assert.strictEqual(receipt.schema_version, 3);
    assert.strictEqual(receipt.managed_entries.agents[agentName].mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('ordinary update preserves a retargeted historical agent symlink as a collision', () => {
  const scratch = projectRoot();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-agent-retarget-')));
  try {
    const installed = runInstaller(scratch, ['--force']);
    assert.strictEqual(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const source = path.join(ROOT, 'codex', 'agents', agentName);
    const replacement = path.join(outside, agentName);
    fs.copyFileSync(source, replacement);
    const historical = rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, replacement);

    const planned = runInstaller(scratch, ['--update', '--plan', '--json', '--force']);
    assert.strictEqual(planned.status, 1, `${planned.stdout}\n${planned.stderr}`);
    const collision = JSON.parse(planned.stdout).collisions.find((entry) => entry.path === historical.relative);
    assert.ok(collision, planned.stdout);
    assert.strictEqual(collision.ownership, 'unowned-collision');

    const updated = runInstaller(scratch, ['--update', '--force']);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.ok(fs.lstatSync(historical.destination).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(historical.destination), replacement);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('copy-mode legacy migration preserves a receipt-owned retargeted symlink with identical content', () => {
  const scratch = projectRoot();
  const userOwned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-migrate-identical-target-')));
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentTarget = path.join(scratch, '.codex', 'skills', currentName);
    const legacyTarget = path.join(scratch, '.codex', 'skills', legacyName);
    const source = path.join(ROOT, 'codex', 'skills', currentName);
    const replacement = path.join(userOwned, currentName);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);

    fs.renameSync(currentTarget, legacyTarget);
    fs.cpSync(source, replacement, { recursive: true, dereference: true });
    fs.rmSync(legacyTarget, { recursive: true, force: true });
    fs.symlinkSync(replacement, legacyTarget, 'dir');
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    receipt.schema_version = 2;
    receipt.plugin_version = 'legacy';
    receipt.source_fingerprint = 'legacy';
    receipt.managed_entries.skills[legacyName] = currentEntry;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.lstatSync(legacyTarget).isSymbolicLink(), 'retargeted legacy symlink must be preserved');
    assert.strictEqual(fs.realpathSync(legacyTarget), fs.realpathSync(replacement));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(after.orphaned_entries[`skills/${legacyName}`], 'retargeted legacy path must be recorded as orphaned');
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /legacy conflict|orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(userOwned, { recursive: true, force: true });
  }
});

test('skill sources fail closed when distribution metadata is missing', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-missing-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /skill metadata|distribution inventory|id|name/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'metadata validation must fail before writing a schema-v3 receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('skill sources fail closed when distribution metadata is incomplete', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-incomplete-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
      skills: [{ name: 'dhpk-tdd-workflow', legacy_names: ['tdd'] }],
      supporting_assets: [],
    }));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /skill metadata|id|incomplete|distribution inventory/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'incomplete metadata must fail before writing a schema-v3 receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('external source symlink is rejected before an owned retirement prune', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-source-symlink-plugin-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-source-symlink-outside-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const sourceNames = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort();
    assert.ok(sourceNames.length >= 2, 'fixture needs a retired and active skill');
    const retired = sourceNames.find((name) => name === 'dhpk-tdd-workflow');
    const malicious = sourceNames.find((name) => name === 'dhpk-yii1-security-audit');
    assert.ok(retired && malicious, 'fixture needs prefixed retired and active skills');
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const retiredEntry = inventory.skills.find((entry) => entry.name === retired);
    assert.ok(retiredEntry, `missing fixture inventory entry for ${retired}`);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired);
    inventory.retired_skills = [{
      id: retiredEntry.id,
      name: retiredEntry.name,
      canonicalPath: retiredEntry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: retiredEntry.surfaces,
      replacements: [{ kind: 'skill', id: 'code-trace', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });

    const outsideSource = path.join(outside, malicious);
    fs.mkdirSync(outsideSource, { recursive: true });
    fs.writeFileSync(path.join(outsideSource, 'escaped.txt'), 'outside source\n');
    const maliciousSource = path.join(fakePlugin, 'codex', 'skills', malicious);
    fs.rmSync(maliciousSource, { recursive: true, force: true });
    fs.symlinkSync(outsideSource, maliciousSource, 'dir');

    const retiredTarget = path.join(scratch, '.codex', 'skills', retired);
    const receiptBefore = fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /(source|symlink|outside|escape)/i);
    assert.ok(fs.existsSync(retiredTarget), 'retirement target must remain when source validation fails');
    assert.strictEqual(
      fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'),
      receiptBefore,
      'source validation must fail before receipt mutation',
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('malformed retirement metadata fails closed before receipt mutation', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-retirement-metadata-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    inventory.retired_skills = [{
      id: 'retired-helper',
      name: 'dhpk-retired-helper',
      canonicalPath: 'skills/dhpk-retired-helper',
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: ['claude-core'],
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor', unexpected: 'must-not-leak' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /(retirement|metadata|unknown|not allowed)/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'malformed metadata must not mutate the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('agent retirement successors must exist in the inventory-owned roster', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-agent-roster-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    inventory.retired_skills = [{
      id: 'retired-helper',
      name: 'dhpk-retired-helper',
      canonicalPath: 'skills/dhpk-retired-helper',
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: ['claude-core'],
      replacements: [{ kind: 'agent', id: 'not-an-agent', mode: 'playwright-journey' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /inventory-owned active agent|agent.*roster/i);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'invalid agent successor must not mutate the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('retirement prune rolls back when a later destination path fails preflight', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-rollback-plugin-')));
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-rollback-outside-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const retired = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort()[0];
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const retiredEntry = inventory.skills.find((entry) => entry.name === retired);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired);
    inventory.retired_skills = [{
      id: retiredEntry.id,
      name: retiredEntry.name,
      canonicalPath: retiredEntry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: retiredEntry.surfaces,
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }];
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });

    const externalDhpk = path.join(external, 'dhpk');
    fs.mkdirSync(externalDhpk, { recursive: true });
    fs.writeFileSync(path.join(externalDhpk, 'keep.txt'), 'external keep\n');
    fs.rmSync(path.join(scratch, '.codex', 'dhpk'), { recursive: true, force: true });
    fs.symlinkSync(externalDhpk, path.join(scratch, '.codex', 'dhpk'), 'dir');
    const retiredTarget = path.join(scratch, '.codex', 'skills', retired);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');

    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(fs.existsSync(retiredTarget), 'retirement target must be restored after later preflight failure');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'failed transaction must retain the prior receipt');
    assert.strictEqual(fs.readFileSync(path.join(externalDhpk, 'keep.txt'), 'utf8'), 'external keep\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('receipt failure rolls back ordinary updates and recovers the transaction journal', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-receipt-rollback-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const changed = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills')).sort()[0];
    const changedSource = path.join(fakePlugin, 'codex', 'skills', changed);
    // The canonical Codex tree contains symlink projections. Materialize this
    // fixture entry before mutating it so the test never edits the canonical
    // source skill through a symlink.
    if (fs.lstatSync(changedSource).isSymbolicLink()) {
      const canonicalSource = fs.realpathSync(changedSource);
      fs.rmSync(changedSource, { recursive: true, force: true });
      fs.cpSync(canonicalSource, changedSource, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(changedSource, 'SKILL.md'), '\nreceipt rollback fixture\n');
    const target = path.join(scratch, '.codex', 'skills', changed);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const targetBefore = completeTreeFingerprint(target);
    const receiptBefore = fs.readFileSync(receiptPath, 'utf8');
    const failed = runInstaller(
      scratch,
      ['--copy', '--update', '--force'],
      fakePlugin,
      { DHPK_TEST_FAIL_RECEIPT: '1' },
    );
    assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /receipt|rollback/i);
    assert.strictEqual(completeTreeFingerprint(target), targetBefore, 'failed receipt must restore the prior target');
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBefore, 'failed receipt must retain the prior manifest');

    const recovered = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.match(`${recovered.stdout}\n${recovered.stderr}`, /synced|reconcili/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('supporting-only installs remain compatible without skill metadata', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-supporting-only-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(receipt.managed_entries.skills, {});
    assert.ok(Object.keys(receipt.managed_entries.agents).length > 0);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('copy mode excludes ignored Python bytecode from projection and fingerprints', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-bytecode-plugin-')));
  const bytecodeDir = path.join(
    fakePlugin,
    'codex',
    'skills',
    'harness-govern',
    'scripts',
    'multi_ai_sync_lib',
    '__pycache__',
  );
  const bytecode = path.join(bytecodeDir, 'fixture.pyc');
  const standaloneBytecode = path.join(
    fakePlugin,
    'codex',
    'skills',
    'harness-govern',
    'scripts',
    'multi_ai_sync_lib',
    'standalone-fixture.pyc',
  );
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    fs.mkdirSync(bytecodeDir, { recursive: true });
    fs.writeFileSync(bytecode, 'fixture-bytecode-v1\n');
    fs.writeFileSync(standaloneBytecode, 'standalone-bytecode-v1\n');

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const copiedBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      'harness-govern',
      'scripts',
      'multi_ai_sync_lib',
      '__pycache__',
      'fixture.pyc',
    );
    const copiedStandaloneBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      'harness-govern',
      'scripts',
      'multi_ai_sync_lib',
      'standalone-fixture.pyc',
    );
    assert.ok(!fs.existsSync(copiedBytecode), 'copy mode must omit ignored Python bytecode');
    assert.ok(!fs.existsSync(copiedStandaloneBytecode), 'copy mode must omit standalone .pyc files');

    fs.writeFileSync(bytecode, 'fixture-bytecode-v2\n');
    fs.writeFileSync(standaloneBytecode, 'standalone-bytecode-v2\n');
    const second = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.source_fingerprint, before.source_fingerprint,
      'ignored bytecode changes must not alter the source fingerprint');
    assert.ok(!fs.existsSync(copiedBytecode), 'update mode must continue omitting ignored Python bytecode');
    assert.ok(!fs.existsSync(copiedStandaloneBytecode), 'update mode must continue omitting standalone .pyc files');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('copy update cleans legacy bytecode while preserving receipt ownership', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const skillTarget = path.join(scratch, '.codex', 'skills', 'harness-govern');
    const legacyBytecode = path.join(skillTarget, 'scripts', 'multi_ai_sync_lib', '__pycache__', 'legacy.pyc');
    fs.mkdirSync(path.dirname(legacyBytecode), { recursive: true });
    fs.writeFileSync(legacyBytecode, 'legacy-bytecode\n');

    const entry = receipt.managed_entries.skills['harness-govern'];
    assert.ok(entry, 'expected the harness-govern receipt entry to exist');
    const legacyDestinationFingerprint = completeTreeFingerprint(skillTarget);
    entry.destination_fingerprint = legacyDestinationFingerprint;
    entry.fingerprint = legacyDestinationFingerprint;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const updated = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(!fs.existsSync(legacyBytecode), 'legacy ignored bytecode must be removed by a managed update');
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.skipped_collision, 0);
    assert.ok(after.reconciliation.updated >= 1, 'legacy bytecode should trigger a clean destination refresh');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('symlink mode links the target and --update preserves edited copied content', () => {
  const scratch = projectRoot();
  try {
    const linked = runInstaller(scratch, ['--force']);
    assert.strictEqual(linked.status, 0, `${linked.stdout}\n${linked.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', skillName)).isSymbolicLink());

    const copied = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    const skillFile = path.join(scratch, '.codex', 'skills', skillName, 'SKILL.md');
    fs.writeFileSync(skillFile, 'stale target\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), 'stale target\n',
      'edited copied content must be preserved as a remaining collision, not overwritten');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.mode, 'copy');
    assert.notStrictEqual(manifest.reconciliation.state, 'current');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('same plugin version but changed source content is not treated as up-to-date', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills'), { recursive: true, force: true });
    fs.cpSync(
      path.join(ROOT, 'skills', 'dhpk-tdd-workflow'),
      path.join(fakePlugin, 'codex', 'skills', 'dhpk-tdd-workflow'),
      { recursive: true, dereference: true }
    );
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const sourceFiles = [];
    function collect(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(fp);
        else if (entry.isFile()) sourceFiles.push(fp);
      }
    }
    collect(path.join(fakePlugin, 'codex', 'skills'));
    assert.ok(sourceFiles.length > 0, 'fixture plugin must contain a regular Codex skill file');
    const sourceFile = sourceFiles[0];
    fs.appendFileSync(sourceFile, '\nsource changed without version bump\n');
    const relative = path.relative(path.join(fakePlugin, 'codex', 'skills'), sourceFile);
    const targetFile = path.join(scratch, '.codex', 'skills', relative);
    const second = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('re-running without --update when version and source fingerprint are unchanged is a reported no-op', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const manifestPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const before = fs.readFileSync(manifestPath, 'utf8');

    // No --update this time — the idempotency check should short-circuit
    // before touching .codex/ at all.
    const second = runInstaller(scratch, ['--copy']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /already up-to-date/);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), before, 'manifest must be untouched by a reported no-op run');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--update does not back up unchanged receipt-owned destinations', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.reconciliation.updated, 0, JSON.stringify(manifest.reconciliation));
    assert.strictEqual(manifest.reconciliation.backed_up, 0, JSON.stringify(manifest.reconciliation));
    assert.deepStrictEqual(manifest.reconciliation.evidence.backups, []);
    assert.strictEqual(manifest.reconciliation.state, 'current');
    assert.strictEqual(manifest.reconciliation.complete, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('managed-target replacement: re-sync replaces a dhpk-managed target regardless of whether it is currently a file or a symlink', () => {
  const scratch = projectRoot();
  try {
    const symlinked = runInstaller(scratch, ['--force']);
    assert.strictEqual(symlinked.status, 0, `${symlinked.stdout}\n${symlinked.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'first sync (symlink mode) must produce a symlink target');

    // Switching to copy --update must replace that exact managed symlink
    // target with a real materialized directory, not merge into it or fail
    // because a symlink already occupies the path.
    const copied = runInstaller(scratch, ['--copy', '--update', '--force']);
    assert.strictEqual(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    assert.ok(!fs.lstatSync(target).isSymbolicLink(), 'copy --update must replace the prior symlink target with a real directory');
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'replaced managed target must contain real skill content');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('hybrid mode adopts a new plugin root while keeping agent roles physical', () => {
  const scratch = projectRoot();
  const firstPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v1-')));
  const secondPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v2-')));
  const preparePlugin = (plugin) => {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(plugin);
  };
  try {
    preparePlugin(firstPlugin);
    preparePlugin(secondPlugin);
    const first = runInstaller(scratch, ['--force'], firstPlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const skillTarget = path.join(scratch, '.codex', 'skills', skillName);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const target = path.join(scratch, '.codex', 'agents', agentName);
    assert.strictEqual(fs.realpathSync(skillTarget), fs.realpathSync(path.join(firstPlugin, 'codex', 'skills', skillName)));
    assert.ok(fs.lstatSync(target).isFile(), 'agent role must be a physical file');
    const secondAgent = path.join(secondPlugin, 'codex', 'agents', agentName);
    fs.appendFileSync(secondAgent, '\n# second plugin source\n');
    const second = runInstaller(scratch, ['--update', '--force'], secondPlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.realpathSync(skillTarget), fs.realpathSync(path.join(secondPlugin, 'codex', 'skills', skillName)));
    assert.ok(fs.lstatSync(target).isFile(), 'updated agent role must remain a physical file');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), fs.readFileSync(secondAgent, 'utf8'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(firstPlugin, { recursive: true, force: true });
    fs.rmSync(secondPlugin, { recursive: true, force: true });
  }
});

test('path-safe install handles apostrophes in plugin and project roots', () => {
  const baseProject = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-apostrophe-project-')));
  const basePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-apostrophe-plugin-')));
  const scratch = `${baseProject}'project`;
  const fakePlugin = `${basePlugin}'plugin`;
  fs.renameSync(baseProject, scratch);
  fs.renameSync(basePlugin, fakePlugin);
  fs.mkdirSync(path.join(scratch, '.git'));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = runInstaller(scratch, ['--copy'], fakePlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /already up-to-date/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('inventory supporting sources reject unsafe paths before materialization', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-inventory-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'private.txt'), 'must not escape the mapped file boundary\n');
    for (const source of ['.', 'codex\\supporting']) {
      const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
      inventory.supporting_assets = [{ id: 'bad-source', source, destination: 'dhpk/root-copy' }];
      fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify(inventory));
      const res = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
      assert.notStrictEqual(res.status, 0, `${source}: ${res.stdout}\n${res.stderr}`);
      assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'dhpk', 'root-copy', 'private.txt')),
        `${source} must never copy outside the mapped file boundary`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('fresh sync preserves an unowned copy collision and continues with other entries', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /collision/i);
    assert.strictEqual(fs.readFileSync(path.join(target, 'user-owned.txt'), 'utf8'), 'keep me\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!manifest.managed_entries.skills[skillName], 'unowned collision must not enter receipt inventory');
    const other = Object.keys(manifest.managed_entries.skills).find((name) => name !== skillName);
    assert.ok(other, 'non-conflicting skill should still be installed');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('fresh sync beside generic global skill names installs public dhpk names without creating aliases', () => {
  const scratch = projectRoot();
  try {
    const generic = path.join(scratch, '.codex', 'skills', 'tdd');
    fs.mkdirSync(generic, { recursive: true });
    fs.writeFileSync(path.join(generic, 'global.md'), 'Matt/global skill\n');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(generic, 'global.md'), 'utf8'), 'Matt/global skill\n');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-tdd-workflow', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'tdd', 'SKILL.md')));
    assert.match(`${res.stdout}\n${res.stderr}`, /legacy conflict|collision/i);
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.managed_entries.skills.tdd, 'generic legacy alias must never enter the dhpk receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a resolved collision is retried on the next idempotent sync', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-owned.txt'), 'resolve me\n');
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    fs.rmSync(target, { recursive: true, force: true });
    const second = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.managed_entries.skills[skillName]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('legacy receipt and unowned symlink are fail-closed until explicit --migrate --update', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-')));
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(external, target, 'dir');
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: '0.1.0', mode: 'symlink', installed_at: '2020-01-01T00:00:00Z',
    }));
    const before = fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8');
    const res = runInstaller(scratch, ['--force']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    assert.match(`${res.stdout}\n${res.stderr}`, /--migrate --update/);
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(target), external);
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'), before);
    const migrated = runInstaller(scratch, ['--migrate', '--update', '--force']);
    assert.notStrictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /--adopt/);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(!manifest.managed_entries.skills[skillName]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('--update prunes only unchanged removed sources and preserves edited/unrelated targets', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-prune-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);
    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skills = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'));
    assert.ok(skills.length >= 3, 'fixture needs at least three skills');
    const removed = skills[0];
    const edited = skills[1];
    const unrelated = 'project-owned-skill';
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', removed), { recursive: true, force: true });
    const editedTarget = path.join(scratch, '.codex', 'skills', edited);
    fs.writeFileSync(path.join(editedTarget, 'user-edit.txt'), 'edited\n');
    const unrelatedTarget = path.join(scratch, '.codex', 'skills', unrelated);
    fs.mkdirSync(unrelatedTarget, { recursive: true });
    fs.writeFileSync(path.join(unrelatedTarget, 'keep.txt'), 'keep\n');
    const updated = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /--adopt/);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /pruned/i);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', removed)), 'unchanged removed source should be pruned');
    assert.strictEqual(fs.readFileSync(path.join(editedTarget, 'user-edit.txt'), 'utf8'), 'edited\n');
    assert.strictEqual(fs.readFileSync(path.join(unrelatedTarget, 'keep.txt'), 'utf8'), 'keep\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!manifest.managed_entries.skills[removed]);
    assert.ok(manifest.managed_entries.skills[edited]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('--migrate adopts exact legacy copies but never overwrites mismatches', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const exactTarget = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(exactTarget), { recursive: true });
    fs.cpSync(source, exactTarget, { recursive: true, dereference: true });
    const mismatch = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[1];
    const mismatchTarget = path.join(scratch, '.codex', 'skills', mismatch);
    fs.mkdirSync(mismatchTarget, { recursive: true });
    fs.writeFileSync(path.join(mismatchTarget, 'user-owned.txt'), 'do not replace\n');
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: 'legacy', mode: 'copy', installed_at: '2020-01-01T00:00:00Z',
    }));
    const res = runInstaller(scratch, ['--copy', '--migrate', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 3);
    assert.ok(manifest.managed_entries.skills[skillName], 'exact source match should be adopted');
    assert.ok(!manifest.managed_entries.skills[mismatch], 'mismatched legacy destination must remain unowned');
    assert.strictEqual(fs.readFileSync(path.join(mismatchTarget, 'user-owned.txt'), 'utf8'), 'do not replace\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('legacy migration remains available after stale inspection', () => {
  const scratch = projectRoot();
  try {
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      plugin_version: 'legacy', mode: 'copy', installed_at: '2020-01-01T00:00:00Z',
    }));
    const normal = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(normal.status, 0, `${normal.stdout}\n${normal.stderr}`);
    assert.match(`${normal.stdout}\n${normal.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.managed_entries.skills[skillName], 'exact legacy copy should become receipt-owned after explicit migration');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--migrate renames a receipt-owned unchanged legacy skill destination to its current public name', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-legacy-rename-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    for (const name of fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'))) {
      if (name !== 'dhpk-tdd-workflow') fs.rmSync(path.join(fakePlugin, 'codex', 'skills', name), { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
      skills: [{
        id: 'tdd',
        name: 'dhpk-tdd-workflow',
        legacy_names: ['tdd'],
        lifecycle: 'promoted',
        surfaces: ['codex-sync'],
      }],
      supporting_assets: [],
    }));

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);
    fs.renameSync(
      path.join(scratch, '.codex', 'skills', currentName),
      path.join(scratch, '.codex', 'skills', legacyName)
    );
    const legacyBytecode = path.join(
      scratch,
      '.codex',
      'skills',
      legacyName,
      'scripts',
      'multi_ai_sync_lib',
      '__pycache__',
      'legacy.pyc',
    );
    fs.mkdirSync(path.dirname(legacyBytecode), { recursive: true });
    fs.writeFileSync(legacyBytecode, 'legacy-bytecode\n');
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    currentEntry.destination_fingerprint = completeTreeFingerprint(
      path.join(scratch, '.codex', 'skills', legacyName),
    );
    currentEntry.fingerprint = currentEntry.destination_fingerprint;
    receipt.schema_version = 2;
    receipt.plugin_version = 'legacy';
    receipt.source_fingerprint = 'legacy';
    receipt.managed_entries.skills[legacyName] = currentEntry;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--force'], fakePlugin);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', legacyName)), 'unchanged legacy destination must be removed');
    assert.ok(!fs.existsSync(legacyBytecode), 'legacy migration must not preserve ignored bytecode');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', currentName, 'SKILL.md')));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.schema_version, 3);
    const entry = after.managed_entries.skills[currentName];
    assert.ok(entry, 'current public name must own the migrated destination');
    assert.strictEqual(entry.id, 'tdd');
    assert.strictEqual(entry.name, currentName);
    assert.strictEqual(entry.destination, `skills/${currentName}`);
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.skipped_collision, 0);
    assert.ok(!after.managed_entries.skills[legacyName]);
    assert.match(`${migrated.stdout}\n${migrated.stderr}`, /migrat|updated/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

test('pre-consolidation receipts report an explicit stale state and stay untouched until migration/update', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const currentName = 'dhpk-tdd-workflow';
    const legacyName = 'tdd';
    const currentTarget = path.join(scratch, '.codex', 'skills', currentName);
    const legacyTarget = path.join(scratch, '.codex', 'skills', legacyName);
    const currentEntry = receipt.managed_entries.skills[currentName];
    assert.ok(currentEntry, `expected initial receipt entry for ${currentName}`);

    fs.renameSync(currentTarget, legacyTarget);
    delete receipt.managed_entries.skills[currentName];
    currentEntry.destination = `skills/${legacyName}`;
    currentEntry.source = `skills/${legacyName}`;
    currentEntry.ownership_marker = `copy:skills/${legacyName}`;
    receipt.managed_entries.skills[legacyName] = currentEntry;
    receipt.schema_version = 2;
    receipt.plugin_version = 'pre-consolidation';
    receipt.source_fingerprint = 'pre-consolidation-fingerprint';
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const before = fs.readFileSync(receiptPath, 'utf8');

    const blocked = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(blocked.status, 0, `${blocked.stdout}\n${blocked.stderr}`);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /stale.*receipt|STALE_RECEIPT/i);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /--migrate --update/);
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), before,
      'stale inspection must not rewrite the receipt before explicit migration');
    assert.ok(fs.existsSync(legacyTarget), 'legacy destination must remain recoverable while stale');
    assert.ok(!fs.existsSync(currentTarget), 'canonical destination must not be created during stale inspection');

    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--update', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    assert.ok(fs.existsSync(path.join(currentTarget, 'SKILL.md')));
    assert.ok(!fs.existsSync(legacyTarget));
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(after.schema_version, 3);
    assert.strictEqual(after.reconciliation.state, 'current');
    assert.strictEqual(after.reconciliation.complete, true);
    assert.ok(after.reconciliation.migrated >= 1);
    assert.ok(JSON.stringify(after.reconciliation.evidence).includes('skills/tdd'));
    assert.ok(JSON.stringify(after.reconciliation.evidence).includes('skills/dhpk-tdd-workflow'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('reconciliation evidence records updates, retired entries, backups, and unowned collisions without overwriting', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-evidence-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true, dereference: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    copyDistributionInventory(fakePlugin);

    const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const inventoryPath = path.join(fakePlugin, 'manifests', 'distribution-inventory.json');
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const codexRuntimeNames = new Set((inventory.internal_runtime_skills['codex-native'] || [])
      .map((stableId) => inventory.skills.find((entry) => entry.id === stableId))
      .filter(Boolean)
      .map((entry) => entry.name));
    const sourceSkills = fs.readdirSync(path.join(fakePlugin, 'codex', 'skills'))
      .filter((name) => name.startsWith('dhpk-') && !codexRuntimeNames.has(name))
      .sort();
    assert.ok(sourceSkills.length >= 4, 'fixture needs owned/modified retired, updated, and colliding skills');
    const retired = sourceSkills[0];
    const modifiedRetired = sourceSkills[1];
    const updated = sourceSkills[2];
    const collision = sourceSkills[3];
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', retired), { recursive: true, force: true });
    fs.rmSync(path.join(fakePlugin, 'codex', 'skills', modifiedRetired), { recursive: true, force: true });

    const retiredRows = inventory.skills.filter((entry) => entry.name === retired || entry.name === modifiedRetired);
    inventory.skills = inventory.skills.filter((entry) => entry.name !== retired && entry.name !== modifiedRetired);
    inventory.retired_skills = retiredRows.map((entry) => ({
      id: entry.id,
      name: entry.name,
      canonicalPath: entry.path,
      retiredIn: '0.47.0',
      reasonCode: 'test-retirement',
      priorSurfaces: entry.surfaces,
      replacements: [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }],
      rollback: { release: '0.46.1' },
    }));
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);

    const modifiedRetiredTarget = path.join(scratch, '.codex', 'skills', modifiedRetired);
    const retiredUserMarker = path.join(modifiedRetiredTarget, 'user-retired-edit.txt');
    fs.writeFileSync(retiredUserMarker, 'preserve retired edit\n');
    const updatedPath = path.join(fakePlugin, 'codex', 'skills', updated);
    if (fs.lstatSync(updatedPath).isSymbolicLink()) {
      fs.rmSync(updatedPath, { recursive: true, force: true });
      fs.cpSync(path.join(ROOT, 'skills', updated), updatedPath, { recursive: true, dereference: true });
    }
    fs.appendFileSync(path.join(updatedPath, 'SKILL.md'), '\nsource update for evidence\n');

    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    delete receipt.managed_entries.skills[collision];
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const collisionTarget = path.join(scratch, '.codex', 'skills', collision);
    const userMarker = path.join(collisionTarget, 'user-owned.txt');
    fs.writeFileSync(userMarker, 'do not overwrite\n');

    const receiptBeforePlan = fs.readFileSync(receiptPath, 'utf8');
    const planRun = runInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], fakePlugin);
    assert.notStrictEqual(planRun.status, 0, 'plan remains non-pass while an unowned collision requires adoption');
    const plan = JSON.parse(planRun.stdout);
    for (const name of [retired, modifiedRetired]) {
      const item = plan.retired.find((entry) => entry.name === name);
      assert.ok(item, `missing retired plan row for ${name}`);
      assert.strictEqual(item.retirement.retiredIn, '0.47.0');
      assert.strictEqual(item.retirement.reasonCode, 'test-retirement');
      assert.deepStrictEqual(item.retirement.replacements, [{ kind: 'skill', id: 'tdd', mode: 'test-successor' }]);
    }
    assert.strictEqual(fs.readFileSync(receiptPath, 'utf8'), receiptBeforePlan, 'retirement plan must not mutate receipt');
    assert.strictEqual(fs.readFileSync(retiredUserMarker, 'utf8'), 'preserve retired edit\n', 'retirement plan must not mutate destination');

    const updatedRun = runInstaller(scratch, ['--copy', '--update', '--force'], fakePlugin);
    assert.notStrictEqual(updatedRun.status, 0, `${updatedRun.stdout}\n${updatedRun.stderr}`);
    assert.match(`${updatedRun.stdout}\n${updatedRun.stderr}`, /--adopt/);
    assert.strictEqual(fs.readFileSync(userMarker, 'utf8'), 'do not overwrite\n');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', retired)), 'unchanged receipt-owned retired entry must prune');
    assert.strictEqual(fs.readFileSync(retiredUserMarker, 'utf8'), 'preserve retired edit\n', 'modified retired entry must be preserved');
    const after = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const reconciliation = after.reconciliation;
    assert.ok(reconciliation.updated >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.retired >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.backed_up >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.skipped_collision >= 1, JSON.stringify(reconciliation));
    assert.ok(reconciliation.collided >= 1, JSON.stringify(reconciliation));
    assert.strictEqual(reconciliation.state, 'partial');
    assert.strictEqual(reconciliation.complete, false);
    const evidence = reconciliation.evidence;
    assert.strictEqual(evidence.paths.destination_root, '.codex');
    assert.ok(evidence.paths.updated.includes(`skills/${updated}`));
    assert.ok(evidence.paths.retired.includes(`skills/${retired}`));
    assert.ok(evidence.paths.collisions.includes(`skills/${collision}`));
    assert.ok(evidence.fingerprints.source);
    assert.ok(evidence.fingerprints.destinations[`skills/${updated}`]);
    assert.ok(evidence.backups.length >= 1);
    for (const backup of evidence.backups) {
      assert.ok(backup.path && backup.path.startsWith('.codex/.dhpk-backups/'), JSON.stringify(backup));
      assert.match(backup.path, /^\.codex\/\.dhpk-backups\/\d{8}T\d{6}Z-\d+\/.+$/, JSON.stringify(backup));
      assert.ok(fs.existsSync(path.join(scratch, backup.path)), `backup path missing: ${backup.path}`);
    }
    assert.ok(!after.managed_entries.skills[collision], 'unowned collision must remain outside receipt ownership');
    assert.ok(after.orphaned_entries[`skills/${modifiedRetired}`], 'modified retired path must be receipt-tracked as orphaned');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  }
});

run('install-codex-skills-reconciliation');
