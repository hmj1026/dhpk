'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  runInstaller: runCodexInstaller,
  projectRoot,
  completeTreeFingerprint,
} = require('./_lib/install-codex-skills-fixtures');

const { write, skillBody, fakePlugin } = require('./_lib/shared-projection-plugin');
const { loadLegacyFixture, restoreTree } = require('./_lib/legacy-journal-fixtures');

const REPO = path.join(__dirname, '..');
const CURSOR_HOOK = path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh');


function runCursorInstaller(project, args, pluginRoot, extraEnv) {
  return spawnSync('bash', [CURSOR_HOOK, ...args], {
    cwd: project,
    env: { ...process.env, DHPK_INSTALLER_ROOT: pluginRoot, ...(extraEnv || {}) },
    encoding: 'utf8',
    timeout: 20000,
  });
}

const sharedSkillRecoveryEntrypoints = [
  { host: 'codex', skillName: 'dhpk-codex-only', run: runCodexInstaller },
  { host: 'cursor', skillName: 'dhpk-portable', run: runCursorInstaller },
];

function prepareManagedSkillSymlinkScenario(entrypoint) {
  const project = projectRoot();
  const plugin = fakePlugin();
  const externalRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-931-recovery-')));
  try {
    const cursor = runCursorInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const codex = runCodexInstaller(project, ['--copy', '--force'], plugin);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);

    const receiptPath = path.join(project, '.agents', '.dhpk-installed.json');
    const receiptText = fs.readFileSync(receiptPath, 'utf8');
    const receipt = JSON.parse(receiptText);
    const relative = `${entrypoint.skillName}/SKILL.md`;
    assert.deepStrictEqual(receipt.managedPaths.filter((item) => item.startsWith(`${entrypoint.skillName}/`)), [relative], 'the fixture skill should have one current-receipt-owned file');
    const expectedDigest = receipt.generatedFingerprints[relative];
    const managedSkill = path.join(project, '.agents', 'skills', entrypoint.skillName);
    const originalFile = path.join(managedSkill, 'SKILL.md');
    const originalStat = fs.lstatSync(originalFile);
    assert.ok(originalStat.isFile() && !originalStat.isSymbolicLink(), 'managed source must be a physical file');
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(originalFile)).digest('hex'), expectedDigest, 'fixture content must match the fingerprint in the current receipt');

    const preservedSkill = path.join(externalRoot, 'receipt-matching-copy');
    fs.cpSync(managedSkill, preservedSkill, { recursive: true });
    const preservedFile = path.join(preservedSkill, 'SKILL.md');
    const preservedStat = fs.lstatSync(preservedFile);
    assert.ok(preservedStat.isFile() && !preservedStat.isSymbolicLink(), 'recovery copy must contain physical files');
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(preservedFile)).digest('hex'), expectedDigest, 'recovery copy must match the current receipt fingerprint');
    assert.strictEqual(fs.existsSync(path.join(project, '.agents', '.dhpk-installed.transaction.json')), false, 'the recovery scenario must not have a pending projection transaction');

    assert.strictEqual(fs.lstatSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only'), { throwIfNoEntry: false }), undefined);
    const nativeBindings = {
      cursor: path.join(project, '.cursor', 'skills', 'dhpk-portable'),
    };
    const nativeBindingTargets = Object.fromEntries(Object.entries(nativeBindings).map(([host, binding]) => [host, fs.readlinkSync(binding)]));
    const foreignSkill = path.join(externalRoot, 'custom-skill');
    write(path.join(foreignSkill, 'README.md'), '# Consumer-owned skill\n');
    fs.rmSync(managedSkill, { recursive: true, force: true });
    fs.symlinkSync(foreignSkill, managedSkill, 'dir');

    const otherHost = entrypoint.host === 'codex' ? 'cursor' : 'codex';
    const otherSkillName = entrypoint.host === 'codex' ? 'dhpk-portable' : 'dhpk-codex-only';
    const otherSkill = path.join(project, '.agents', 'skills', otherSkillName);
    return {
      project,
      plugin,
      externalRoot,
      foreignSkill,
      managedSkill,
      otherHost,
      otherSkill,
      preservedSkill,
      receiptPath,
      receiptText,
      receipt,
      expectedDigest,
      nativeBindings,
      nativeBindingTargets,
    };
  } catch (error) {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
    throw error;
  }
}

function updateSharedSkillThrough(entrypoint, project, plugin) {
  return entrypoint.run(project, ['--copy', '--migrate', '--update', '--force'], plugin);
}

function outputOf(result) {
  return `${result.stdout}\n${result.stderr}`;
}
for (const entrypoint of sharedSkillRecoveryEntrypoints) {
  test(`${entrypoint.host} migrates a 0.65.x v1 receipt and retires another Host stale selection`, () => {
    const { fingerprint } = require('../scripts/lib/distribution-projection-contract');
    const project = projectRoot();
    const plugin = fakePlugin();
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-legacy-installer-home-'));
    try {
      const env = { HOME: isolatedHome };
      write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '0.65.9' }));
      const inventoryPath = path.join(plugin, 'manifests', 'distribution-inventory.json');
      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      const oldInventory = {
        ...inventory,
        skills: [...inventory.skills, { id: 'retired', name: 'dhpk-retired', path: 'skills/dhpk-retired', lifecycle: 'promoted', surfaces: ['codex-sync', 'codex-native', 'cursor-sync', 'cursor-plugin'], legacy_names: [] }],
        project_agent_projection: {
          ...inventory.project_agent_projection,
          profiles: { 'portable-core': { ...inventory.project_agent_projection.profiles['portable-core'], stable_ids: ['codex-only', 'portable', 'retired'] } },
        },
      };
      write(inventoryPath, JSON.stringify(oldInventory));
      const profilesPath = path.join(plugin, 'manifests', 'profile-projection-sets.json');
      const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      write(profilesPath, JSON.stringify({ ...profiles, profiles: { common: { cursor: ['portable', 'retired'], 'codex-sync': ['codex-only', 'retired'] } } }));
      for (const surface of ['skills', 'codex/skills', 'cursor/skills']) {
        write(path.join(plugin, surface, 'dhpk-retired', 'SKILL.md'), skillBody('dhpk-retired', 'Retired'));
      }
      for (const previousEntrypoint of sharedSkillRecoveryEntrypoints) {
        const installed = previousEntrypoint.run(project, ['--copy', '--force'], plugin, env);
        assert.strictEqual(installed.status, 0, outputOf(installed));
      }
      const receiptPath = path.join(project, '.agents', '.dhpk-installed.json');
      const legacy = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      legacy.schema = 'dhpk.project-agent-projection-receipt.v1';
      delete legacy.selectedIdentities;
      delete legacy.emittedIdentities;
      legacy.entries = legacy.entries.map(({ entityKind, ...entry }) => entry);
      legacy.sourceFingerprints = Object.fromEntries(legacy.entries.map((entry) => [entry.stableId, entry.sourceFingerprint]));
      legacy.selectedIds.push('retired-selected-only');
      legacy.rollback = null;
      delete legacy.claudeManagedRoot;
      delete legacy.claudeManagedPaths;
      delete legacy.claudeGeneratedFingerprints;
      delete legacy.receiptFingerprint;
      legacy.receiptFingerprint = fingerprint(legacy);
      write(receiptPath, JSON.stringify(legacy));
      write(inventoryPath, JSON.stringify(inventory));
      write(profilesPath, JSON.stringify(profiles));
      write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
      for (const surface of ['skills', 'codex/skills', 'cursor/skills']) {
        fs.rmSync(path.join(plugin, surface, 'dhpk-retired'), { recursive: true, force: true });
      }
      write(path.join(project, '.agents', 'skills', 'consumer-owned', 'README.md'), '# keep\n');

      const migrated = entrypoint.run(project, ['--copy', '--migrate', '--update', '--force'], plugin, env);

      assert.strictEqual(migrated.status, 0, outputOf(migrated));
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(receipt.schema, 'dhpk.project-agent-projection-receipt.v3');
      assert.deepStrictEqual(receipt.selectedIds, ['codex-only', 'portable']);
      assert.deepStrictEqual(receipt.emittedIds, ['codex-only', 'portable']);
      assert.ok(!receipt.selectedIdentities.some((identity) => identity.stableId === 'retired-selected-only'));
      const otherHost = entrypoint.host === 'codex' ? 'cursor' : 'codex';
      const otherId = entrypoint.host === 'codex' ? 'portable' : 'codex-only';
      const otherName = entrypoint.host === 'codex' ? 'dhpk-portable' : 'dhpk-codex-only';
      assert.deepStrictEqual(receipt.hostBindings[otherHost].selectedStableIds, [otherId]);
      assert.deepStrictEqual(receipt.hostBindings[otherHost].emittedStableIds, [otherId]);
      assert.deepStrictEqual(receipt.hostBindings[otherHost].bindings.map((binding) => binding.stableId), [otherId]);
      if (otherHost === 'cursor') {
        assert.deepStrictEqual(receipt.bindingPaths.cursor, [{ path: `.cursor/skills/${otherName}`, target: `../../.agents/skills/${otherName}` }]);
        assert.ok(fs.lstatSync(path.join(project, '.cursor', 'skills', otherName)).isSymbolicLink());
      } else {
        assert.strictEqual(receipt.hostBindings.codex.bindingShape, 'direct');
        assert.deepStrictEqual(receipt.bindingPaths.codex || [], []);
        assert.strictEqual(fs.lstatSync(path.join(project, '.codex', 'skills', otherName), { throwIfNoEntry: false }), undefined);
      }
      assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills', 'dhpk-retired')));
      assert.ok(!fs.existsSync(path.join(project, `.${otherHost}`, 'skills', 'dhpk-retired')));
      assert.strictEqual(fs.readFileSync(path.join(project, '.agents', 'skills', 'consumer-owned', 'README.md'), 'utf8'), '# keep\n');
      assert.deepStrictEqual(fs.readdirSync(isolatedHome), []);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });

  test(`${entrypoint.host} symlink and missing-content diagnostics point to receipt recovery`, () => {
    const scenario = prepareManagedSkillSymlinkScenario(entrypoint);
    const foreignBefore = snapshotTree(scenario.externalRoot);
    try {
      const collision = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);
      const symlinkWasPreserved = fs.lstatSync(scenario.managedSkill).isSymbolicLink();
      const symlinkTarget = fs.readlinkSync(scenario.managedSkill);
      const receiptAfterCollision = fs.readFileSync(scenario.receiptPath, 'utf8');

      fs.unlinkSync(scenario.managedSkill);
      const missing = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);

      assert.notStrictEqual(collision.status, 0, `${collision.stdout}\n${collision.stderr}`);
      assert.match(outputOf(collision), /docs\/platform-installation\.md#recover-receipt-owned-shared-skills/i);
      assert.match(outputOf(collision), /preserve the symlink and its target/i);
      assert.match(outputOf(collision), /current receipt fingerprints/i);
      assert.ok(symlinkWasPreserved, 'failed collision check must leave the consumer link in place');
      assert.strictEqual(symlinkTarget, scenario.foreignSkill);
      assert.strictEqual(receiptAfterCollision, scenario.receiptText);

      assert.notStrictEqual(missing.status, 0, `${missing.stdout}\n${missing.stderr}`);
      assert.match(outputOf(missing), new RegExp(`expected SHA-256:\\s*${scenario.expectedDigest}`, 'i'));
      assert.match(outputOf(missing), /docs\/platform-installation\.md#recover-receipt-owned-shared-skills/i);
      assert.strictEqual(fs.readFileSync(scenario.receiptPath, 'utf8'), scenario.receiptText);
      assert.strictEqual(fs.existsSync(scenario.managedSkill), false, 'missing-content retry must not invent files');
      assert.strictEqual(snapshotTree(scenario.externalRoot), foreignBefore, 'foreign target and saved copy must remain unchanged');
    } finally {
      fs.rmSync(scenario.project, { recursive: true, force: true });
      fs.rmSync(scenario.plugin, { recursive: true, force: true });
      fs.rmSync(scenario.externalRoot, { recursive: true, force: true });
    }
  });
  test(`${entrypoint.host} accepts only matching current-receipt recovery content`, () => {
    const scenario = prepareManagedSkillSymlinkScenario(entrypoint);
    const otherSkillBefore = snapshotTree(scenario.otherSkill);
    const otherBindingBefore = JSON.stringify(scenario.receipt.hostBindings[scenario.otherHost]);
    const otherBindingPathsBefore = JSON.stringify(scenario.receipt.bindingPaths[scenario.otherHost]);
    const agentsRoot = path.join(scenario.project, '.agents');
    try {
      const collision = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);
      assert.notStrictEqual(collision.status, 0, `${collision.stdout}\n${collision.stderr}`);
      const preservedLink = path.join(scenario.externalRoot, 'preserved-symlink');
      fs.renameSync(scenario.managedSkill, preservedLink);
      const preservedLinkTarget = fs.readlinkSync(preservedLink);
      assert.strictEqual(preservedLinkTarget, scenario.foreignSkill);
      const externalBefore = snapshotTree(scenario.externalRoot);
      const missing = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);
      assert.notStrictEqual(missing.status, 0, `${missing.stdout}\n${missing.stderr}`);
      assert.strictEqual(fs.readFileSync(scenario.receiptPath, 'utf8'), scenario.receiptText);

      assert.ok(fs.lstatSync(path.join(scenario.project, '.agents')).isDirectory(), 'shared root must be physical');
      assert.ok(fs.lstatSync(path.dirname(scenario.managedSkill)).isDirectory(), 'receipt-owned parent must be physical');
      fs.mkdirSync(scenario.managedSkill);
      assert.ok(fs.lstatSync(scenario.managedSkill).isDirectory(), 'restored skill directory must be physical');
      const restoredFile = path.join(scenario.managedSkill, 'SKILL.md');
      fs.copyFileSync(path.join(scenario.preservedSkill, 'SKILL.md'), restoredFile);
      assert.ok(fs.lstatSync(restoredFile).isFile(), 'restored receipt-owned file must be physical');
      fs.appendFileSync(restoredFile, '\n# Mismatched recovery copy\n');
      const mismatchedState = snapshotTree(agentsRoot);
      const mismatch = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);
      assert.notStrictEqual(mismatch.status, 0, `${mismatch.stdout}\n${mismatch.stderr}`);
      assert.match(outputOf(mismatch), /fingerprint|modified|changed/i);
      assert.strictEqual(snapshotTree(agentsRoot), mismatchedState, 'rejected recovery must preserve the mismatched content and receipt');
      const mismatchOutput = outputOf(mismatch);
      assert.strictEqual(snapshotTree(scenario.externalRoot), externalBefore, 'rejected recovery must preserve the foreign target and saved copy');
      assert.ok(fs.lstatSync(scenario.managedSkill).isDirectory(), 'rejected recovery must leave the physical managed directory');
      assert.ok(fs.lstatSync(restoredFile).isFile(), 'rejected recovery must leave the physical managed file');
      fs.copyFileSync(path.join(scenario.preservedSkill, 'SKILL.md'), restoredFile);
      assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(restoredFile)).digest('hex'), scenario.expectedDigest, 'restored file must match the current receipt');
      const recovered = updateSharedSkillThrough(entrypoint, scenario.project, scenario.plugin);
      assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
      assert.match(mismatchOutput, /docs\/platform-installation\.md#recover-receipt-owned-shared-skills/i);
      const receiptAfterRecovery = JSON.parse(fs.readFileSync(scenario.receiptPath, 'utf8'));
      assert.deepStrictEqual(receiptAfterRecovery.hostBindings[scenario.otherHost], JSON.parse(otherBindingBefore));
      assert.deepStrictEqual(receiptAfterRecovery.bindingPaths[scenario.otherHost], JSON.parse(otherBindingPathsBefore));
      assert.strictEqual(snapshotTree(scenario.otherSkill), otherSkillBefore, 'the other Host skill content must remain intact');
      assert.strictEqual(snapshotTree(scenario.externalRoot), externalBefore, 'recovery must leave consumer-owned content untouched');
      assert.strictEqual(fs.readlinkSync(preservedLink), preservedLinkTarget, 'the saved consumer symlink target must remain unchanged');
      assert.strictEqual(fs.existsSync(path.join(scenario.project, '.agents', '.dhpk-installed.transaction.json')), false);
      assert.deepStrictEqual(Object.fromEntries(Object.entries(scenario.nativeBindings).map(([host, binding]) => [host, fs.readlinkSync(binding)])), scenario.nativeBindingTargets);
    } finally {
      fs.rmSync(scenario.project, { recursive: true, force: true });
      fs.rmSync(scenario.plugin, { recursive: true, force: true });
      fs.rmSync(scenario.externalRoot, { recursive: true, force: true });
    }
  });
}

function writeCodexEvidence(dir, status) {
  const file = path.join(dir, 'codex-consumer-evidence.json');
  write(file, `${JSON.stringify({
    stage: 'CONSUMER',
    producer: 'consumer-platform-probe',
    adapter: { id: 'codex-project-discovery', version: '1.0.0' },
    surfaceResults: [{
      surface: 'codex-project',
      status,
      adapter: { id: 'codex-project-discovery', version: '1.0.0' },
      commands: [{
        cmd: 'node scripts/release/consumer-platform-probe.js --platform codex-project',
        exitCode: status === 'PASS' ? 0 : 1,
      }],
      environment: { CI: 'true', DHPK_CONSUMER_PROBE_NETWORK: 'disabled' },
      artifacts: [],
      diagnostics: [],
      reasons: [status === 'PASS' ? 'bounded Codex project probe PASS' : 'Codex project probe failed'],
      checkedClaims: ['project-artifact-structure', 'codex-project-discovery', 'consumer-route'],
    }],
  })}\n`);
  return file;
}

function skillEntries(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

function assertOnlySymlinks(skillsRoot) {
  for (const name of skillEntries(skillsRoot)) {
    const entry = path.join(skillsRoot, name);
    assert.ok(fs.lstatSync(entry).isSymbolicLink(), `${name} must be a native-link, not a copied directory`);
  }
}

test('fresh Codex install defaults to direct Shared Project Projection discovery and keeps native agents', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const planned = runCodexInstaller(scratch, ['--copy', '--plan', '--json', '--force'], plugin);
    const planReport = JSON.parse(planned.stdout);
    assert.strictEqual(planReport.codexBindingShape, 'direct');
    assert.match(String(planReport.codexBindingReason || ''), /ADR-0042/);

    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const shared = path.join(scratch, '.agents', 'skills', 'dhpk-codex-only');
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    assert.ok(fs.existsSync(path.join(shared, 'SKILL.md')));
    assert.ok(!fs.lstatSync(shared).isSymbolicLink());
    assert.ok(!fs.existsSync(nativeSkill), 'direct discovery must not emit per-skill .codex/skills/<name> links');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.managed_entries.skills || !receipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
    assert.deepStrictEqual(projection.bindingPaths.codex || [], []);
    assert.deepStrictEqual(projection.hostBindings.codex.selectedStableIds, ['codex-only']);
    const rerun = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
    assert.match(rerun.stdout + rerun.stderr, /already up-to-date/);
    const again = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(again.hostBindings.codex, projection.hostBindings.codex);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('an explicit non-PASS Codex Consumer Evidence override emits native-link bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const evidence = writeCodexEvidence(scratch, 'FAIL');
    const overrideEnv = { DHPK_CODEX_CONSUMER_EVIDENCE: evidence };
    const planned = runCodexInstaller(scratch, ['--copy', '--plan', '--json', '--force'], plugin, overrideEnv);
    assert.strictEqual(JSON.parse(planned.stdout).codexBindingShape, 'native-link');

    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin, overrideEnv);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
    assertOnlySymlinks(path.join(scratch, '.codex', 'skills'));
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'native-link');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Codex --update retires native-link bindings left by an earlier install and keeps shared content', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const evidence = writeCodexEvidence(scratch, 'FAIL');
    const linked = runCodexInstaller(scratch, ['--copy', '--force'], plugin, { DHPK_CODEX_CONSUMER_EVIDENCE: evidence });
    assert.strictEqual(linked.status, 0, outputOf(linked));
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    const shared = path.join(scratch, '.agents', 'skills', 'dhpk-codex-only');
    const sharedBefore = snapshotTree(shared);

    const updated = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, outputOf(updated));
    assert.strictEqual(fs.lstatSync(nativeSkill, { throwIfNoEntry: false }), undefined);
    assert.strictEqual(snapshotTree(shared), sharedBefore);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
    assert.deepStrictEqual(projection.bindingPaths.codex || [], []);
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.existsSync(path.join(scratch, '.agents', '.dhpk-installed.transaction.json')), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('injected Codex discovery PASS binds declared skills as direct Host Bindings', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const evidence = writeCodexEvidence(scratch, 'PASS');
    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin, {
      DHPK_CODEX_CONSUMER_EVIDENCE: evidence,
    });
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Cursor then Codex unions shared skills and leaves the first Host bindings unchanged', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const cursor = runCursorInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const before = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    const cursorBindings = JSON.parse(JSON.stringify(before.hostBindings.cursor));
    const cursorPaths = JSON.parse(JSON.stringify(before.bindingPaths.cursor));
    const codex = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(fs.lstatSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    const after = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(after.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(after.bindingPaths.cursor, cursorPaths);
    assert.strictEqual(after.hostBindings.codex.bindingShape, 'direct');
    assert.deepStrictEqual(after.hostBindings.codex.selectedStableIds, ['codex-only']);
    const again = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(again.status, 0, `${again.stdout}\n${again.stderr}`);
    const rerun = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(rerun.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(rerun.hostBindings.codex.selectedStableIds, ['codex-only']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('Codex --plan sees declared shared-skill source drift without --update', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const current = runCodexInstaller(scratch, ['--copy', '--force', '--plan', '--json'], plugin);
    assert.strictEqual(current.status, 0, `${current.stdout}\n${current.stderr}`);
    assert.strictEqual(JSON.parse(current.stdout).state, 'current');
    fs.writeFileSync(
      path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'),
      skillBody('dhpk-codex-only', 'Codex only edited'),
    );
    const planned = runCodexInstaller(scratch, ['--copy', '--force', '--plan', '--json'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.notStrictEqual(report.state, 'current');
    assert.match((report.reasons || []).join('\n'), /source fingerprint/);
    const unchanged = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.notStrictEqual(unchanged.status, 0, `${unchanged.stdout}\n${unchanged.stderr}`);
    assert.match(`${unchanged.stdout}\n${unchanged.stderr}`, /SOURCE_DRIFT|explicit update authority|source fingerprint/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('receipt-owned native Codex skill copies stay until --update', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    fs.cpSync(path.join(plugin, 'skills', 'dhpk-codex-only'), nativeSkill, { recursive: true });
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const fingerprint = completeTreeFingerprint(nativeSkill);
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-codex-only'] = {
      destination: 'skills/dhpk-codex-only',
      source: 'skills/dhpk-codex-only',
      mode: 'copy',
      source_fingerprint: fingerprint,
      destination_fingerprint: fingerprint,
      fingerprint,
      ownership_marker: 'copy:skills/dhpk-codex-only',
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const kept = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(kept.status, 0, `${kept.stdout}\n${kept.stderr}`);
    assert.ok(!fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(nativeSkill, 'SKILL.md')));

    const updated = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.strictEqual(fs.lstatSync(nativeSkill, { throwIfNoEntry: false }), undefined);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    const nextReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!nextReceipt.managed_entries.skills || !nextReceipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

function snapshotTree(root) {
  const lines = [];
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) lines.push(`${rel}->${fs.readlinkSync(full)}`);
      else if (stat.isDirectory()) walk(full);
      else lines.push(`${rel}:${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return lines.join('\n');
}

test('--plan --json reports a legacy Codex native skill copy as migrate without writing', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    fs.cpSync(path.join(plugin, 'skills', 'dhpk-codex-only'), nativeSkill, { recursive: true });
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const fingerprint = completeTreeFingerprint(nativeSkill);
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-codex-only'] = {
      destination: 'skills/dhpk-codex-only',
      source: 'skills/dhpk-codex-only',
      mode: 'copy',
      source_fingerprint: fingerprint,
      destination_fingerprint: fingerprint,
      fingerprint,
      ownership_marker: 'copy:skills/dhpk-codex-only',
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const before = snapshotTree(scratch);
    const planned = runCodexInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    assert.notStrictEqual(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    const row = (report.legacyNativeSkills || []).find((entry) => entry.path === 'skills/dhpk-codex-only');
    assert.ok(row, planned.stdout);
    assert.strictEqual(row.handling, 'migrate');
    assert.strictEqual(before, snapshotTree(scratch));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('a hand-edited legacy Codex skill survives --update and migrates only with --adopt', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    fs.cpSync(path.join(plugin, 'skills', 'dhpk-codex-only'), nativeSkill, { recursive: true });
    fs.appendFileSync(path.join(nativeSkill, 'SKILL.md'), '\n# local edit\n');
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    const recorded = completeTreeFingerprint(path.join(plugin, 'skills', 'dhpk-codex-only'));
    receipt.managed_entries.skills = receipt.managed_entries.skills || {};
    receipt.managed_entries.skills['dhpk-codex-only'] = {
      destination: 'skills/dhpk-codex-only',
      source: 'skills/dhpk-codex-only',
      mode: 'copy',
      source_fingerprint: recorded,
      destination_fingerprint: recorded,
      fingerprint: recorded,
      ownership_marker: 'copy:skills/dhpk-codex-only',
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const planned = runCodexInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    const report = JSON.parse(planned.stdout);
    const row = (report.legacyNativeSkills || []).find((entry) => entry.path === 'skills/dhpk-codex-only');
    assert.ok(row, planned.stdout);
    assert.strictEqual(row.handling, 'keep-modified');
    assert.match(String(row.action || ''), /--adopt=skills\/dhpk-codex-only@/);
    const updated = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(!fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.match(fs.readFileSync(path.join(nativeSkill, 'SKILL.md'), 'utf8'), /# local edit/);
    const collision = (report.collisions || []).find((entry) => entry.path === 'skills/dhpk-codex-only') || row;
    const adopted = runCodexInstaller(scratch, [
      '--copy',
      '--update',
      `--adopt=skills/dhpk-codex-only@${collision.destination_fingerprint}@${collision.source_fingerprint}`,
      '--force',
    ], plugin);
    assert.strictEqual(adopted.status, 0, `${adopted.stdout}\n${adopted.stderr}`);
    assert.strictEqual(fs.lstatSync(nativeSkill, { throwIfNoEntry: false }), undefined);
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    const checked = require('../scripts/lib/project-agent-projection-publisher')
      .validateRelocatableAgentsSkillsProjection({ projectRoot: scratch });
    assert.strictEqual(checked.ok, true, (checked.errors || []).join('\n'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('unowned Codex native skill copies stay put and are reported as unowned', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    fs.rmSync(path.join(scratch, '.agents'), { recursive: true, force: true });
    fs.rmSync(nativeSkill, { recursive: true, force: true });
    fs.cpSync(path.join(plugin, 'skills', 'dhpk-codex-only'), nativeSkill, { recursive: true });
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.managed_entries && receipt.managed_entries.skills) {
      delete receipt.managed_entries.skills['dhpk-codex-only'];
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const planned = runCodexInstaller(scratch, ['--copy', '--update', '--plan', '--json', '--force'], plugin);
    const report = JSON.parse(planned.stdout);
    const row = (report.legacyNativeSkills || []).find((entry) => entry.path === 'skills/dhpk-codex-only');
    assert.ok(row, planned.stdout);
    assert.strictEqual(row.handling, 'unowned');
    const updated = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(!fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(nativeSkill, 'SKILL.md')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('uninstalling Cursor leaves Codex-bound shared skills and Codex native assets', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const cursor = runCursorInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(cursor.status, 0, `${cursor.stdout}\n${cursor.stderr}`);
    const codex = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(codex.status, 0, `${codex.stdout}\n${codex.stderr}`);
    write(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), '# keep\n');
    write(path.join(scratch, '.cursor', 'skills', 'unrelated', 'keep.txt'), 'keep\n');
    const removed = runCursorInstaller(scratch, ['--uninstall', '--force'], plugin);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-portable')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(scratch, '.cursor', 'skills', 'unrelated', 'keep.txt')));
    assert.ok(fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor, undefined);
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'direct');
    assert.deepStrictEqual(projection.hostBindings.codex.selectedStableIds, ['codex-only']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('uninstalling the last Host removes shared skills and leaves unowned files', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    write(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), '# keep\n');
    write(path.join(scratch, '.codex', 'skills', 'unrelated', 'keep.txt'), 'keep\n');
    const removed = runCodexInstaller(scratch, ['--uninstall', '--force'], plugin);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(scratch, '.agents', '.dhpk-installed.json')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'skills', 'unrelated', 'keep.txt')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

function selfOverlapPlugin() {
  const plugin = fakePlugin();
  fs.mkdirSync(path.join(plugin, '.git'));
  return plugin;
}

function activeTransactionJournals(hostRoot) {
  if (!fs.existsSync(hostRoot)) return [];
  return fs.readdirSync(hostRoot).filter((name) => {
    if (!/^\.dhpk-transaction-\d{8}T\d{6}Z-\d+\.json$/.test(name)) return false;
    try {
      return JSON.parse(fs.readFileSync(path.join(hostRoot, name), 'utf8')).phase === 'active';
    } catch {
      return true;
    }
  });
}

test('Codex --update inside the canonical source checkout skips relocatable Shared Project Projection', () => {
  const project = selfOverlapPlugin();
  try {
    const first = runCodexInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(`${first.stdout}\n${first.stderr}`, /Shared Project Projection install skipped:.*canonical source checkout/);
    assert.doesNotMatch(`${first.stdout}\n${first.stderr}`, /PROJECT_ROOT_OVERLAP|relocatable projectRoot must not overlap/);
    assert.ok(!fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.codex', 'agents', 'explorer.toml')));
    assert.ok(fs.existsSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only'))
      || !fs.lstatSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only')).isSymbolicLink()
      || fs.readlinkSync(path.join(project, '.codex', 'skills', 'dhpk-codex-only')) !== '../../.agents/skills/dhpk-codex-only');
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.codex')), []);

    const updated = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.match(`${updated.stdout}\n${updated.stderr}`, /Shared Project Projection install skipped:.*canonical source checkout/);
    assert.ok(!fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.codex')), []);

    const planned = runCodexInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], project);
    assert.notStrictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.notStrictEqual(report.state, 'blocked');
    assert.ok(!report.blocking_recovery);

    const removed = runCodexInstaller(project, ['--uninstall', '--force'], project);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.match(`${removed.stdout}\n${removed.stderr}`, /Shared Project Projection uninstall skipped:.*canonical source checkout/);
    assert.doesNotMatch(`${removed.stdout}\n${removed.stderr}`, /PROJECT_ROOT_OVERLAP|relocatable projectRoot must not overlap/);
    assert.ok(!fs.existsSync(path.join(project, '.codex', 'agents', 'explorer.toml')));
    assert.ok(!fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.codex')), []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// A source checkout whose inventory carries the review skill under its real
// identity. `.agents/skills` is always written by the public generator.
function reviewSkillCheckout() {
  const project = selfOverlapPlugin();
  const inventoryPath = path.join(project, 'manifests', 'distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8').replaceAll('"codex-only"', '"change-verdict"'));
  const skill = inventory.skills.find((entry) => entry.id === 'change-verdict');
  skill.name = 'change-verdict';
  skill.path = 'skills/change-verdict';
  fs.writeFileSync(inventoryPath, `${JSON.stringify({
    ...inventory, surface_membership: { 'agent-plugin': ['change-verdict'] },
  }, null, 2)}\n`);
  const profilesPath = path.join(project, 'manifests', 'profile-projection-sets.json');
  fs.writeFileSync(profilesPath, fs.readFileSync(profilesPath, 'utf8').replaceAll('"codex-only"', '"change-verdict"'));
  for (const surface of ['skills', 'codex/skills']) {
    fs.rmSync(path.join(project, surface, 'dhpk-codex-only'), { recursive: true, force: true });
    write(path.join(project, surface, 'change-verdict', 'SKILL.md'), skillBody('change-verdict', 'Change Verdict'));
  }
  return project;
}

function projectCompatibilitySkills(project) {
  const result = spawnSync(process.execPath, [
    path.join(REPO, 'scripts', 'ci', 'gen-agents-skills.js'), '--repo-root', project, '--update', '--preserve-unmanaged',
  ], { cwd: project, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function discoverableReviewSkills(project) {
  return ['.agents/skills', '.codex/skills']
    .map((root) => `${root}/change-verdict/SKILL.md`)
    .filter((relative) => fs.existsSync(path.join(project, relative)));
}

function addThirdPartyReview(project) {
  const owned = path.join(project, 'third-party', 'code-review');
  write(path.join(owned, 'SKILL.md'), skillBody('code-review', 'Third-party review'));
  const links = ['.agents', '.codex'].map((root) => path.join(project, root, 'skills', 'code-review'));
  for (const link of links) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync('../../third-party/code-review', link, 'dir');
  }
  return () => [fs.readFileSync(path.join(owned, 'SKILL.md'), 'utf8'), ...links.map((link) => fs.readlinkSync(link))];
}

test('Codex --update leaves one review source after a two-source install and keeps third-party code-review', () => {
  const project = reviewSkillCheckout();
  try {
    const first = runCodexInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(first.status, 0, outputOf(first));
    projectCompatibilitySkills(project);
    const thirdParty = addThirdPartyReview(project);
    const before = thirdParty();
    const portable = completeTreeFingerprint(path.join(project, '.agents', 'skills', 'change-verdict'));
    assert.deepStrictEqual(discoverableReviewSkills(project), [
      '.agents/skills/change-verdict/SKILL.md', '.codex/skills/change-verdict/SKILL.md',
    ]);

    const updated = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(updated.status, 0, outputOf(updated));
    assert.match(outputOf(updated), /retired=1/);
    assert.deepStrictEqual(discoverableReviewSkills(project), ['.agents/skills/change-verdict/SKILL.md']);
    assert.deepStrictEqual(thirdParty(), before);

    const again = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(again.status, 0, outputOf(again));
    assert.deepStrictEqual(discoverableReviewSkills(project), ['.agents/skills/change-verdict/SKILL.md']);
    assert.strictEqual(completeTreeFingerprint(path.join(project, '.agents', 'skills', 'change-verdict')), portable);
    assert.deepStrictEqual(thirdParty(), before);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Codex fresh install beside the generated projection adds no second review source', () => {
  const project = reviewSkillCheckout();
  try {
    projectCompatibilitySkills(project);
    const installed = runCodexInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(installed.status, 0, outputOf(installed));
    assert.deepStrictEqual(discoverableReviewSkills(project), ['.agents/skills/change-verdict/SKILL.md']);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

for (const { label, edited } of [
  { label: 'a user-modified Codex copy', edited: '.codex/skills/change-verdict/SKILL.md' },
  { label: 'the Codex copy when the projection was modified', edited: '.agents/skills/change-verdict/SKILL.md' },
]) {
  test(`Codex --update preserves ${label}`, () => {
    const project = reviewSkillCheckout();
    try {
      const first = runCodexInstaller(project, ['--copy', '--force'], project);
      assert.strictEqual(first.status, 0, outputOf(first));
      projectCompatibilitySkills(project);
      fs.appendFileSync(path.join(project, edited), '\nLocal note.\n');
      const content = fs.readFileSync(path.join(project, edited), 'utf8');

      const updated = runCodexInstaller(project, ['--copy', '--update'], project);
      assert.doesNotMatch(outputOf(updated), /retired=1/);
      assert.strictEqual(discoverableReviewSkills(project).length, 2, outputOf(updated));
      assert.strictEqual(fs.readFileSync(path.join(project, edited), 'utf8'), content);
      if (edited.startsWith('.agents/')) {
        assert.match(outputOf(updated), /COMPATIBILITY_PROJECTION_STALE: skills\/change-verdict kept: the projected files do not match/);
      }
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}

// A source checkout whose compatibility projection covers several Codex
// skills, plus one Codex skill the projection does not carry.
const OVERLAPPING = ['change-verdict', 'code-trace', 'git-worktree', 'tdd-workflow'];
function overlapCheckout() {
  const project = selfOverlapPlugin();
  const inventoryPath = path.join(project, 'manifests', 'distribution-inventory.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const codexSkills = [...OVERLAPPING, 'codex-local'];
  inventory.skills = inventory.skills.filter((entry) => entry.id !== 'codex-only').concat(codexSkills.map((name) => ({
    id: name, name, path: `skills/${name}`, lifecycle: 'promoted', surfaces: ['codex-sync', 'codex-native'], legacy_names: [],
  })));
  inventory.project_agent_projection.profiles['portable-core'].stable_ids = ['portable', ...codexSkills];
  inventory.surface_membership = { 'agent-plugin': OVERLAPPING.slice() };
  write(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  const profilesPath = path.join(project, 'manifests', 'profile-projection-sets.json');
  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  profiles.profiles.common['codex-sync'] = codexSkills.slice();
  write(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);
  for (const surface of ['skills', 'codex/skills']) {
    fs.rmSync(path.join(project, surface, 'dhpk-codex-only'), { recursive: true, force: true });
    for (const name of codexSkills) write(path.join(project, surface, name, 'SKILL.md'), skillBody(name, `Skill ${name}`));
  }
  return project;
}

function codexSkillNames(project) {
  return skillEntries(path.join(project, '.codex', 'skills'));
}

test('Codex --update in a source checkout retires every proved overlapping copy and preserves the rest', () => {
  const project = overlapCheckout();
  try {
    const first = runCodexInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(first.status, 0, outputOf(first));
    projectCompatibilitySkills(project);
    const thirdParty = addThirdPartyReview(project);
    const thirdPartyBefore = thirdParty();
    const modified = path.join(project, '.codex', 'skills', 'code-trace', 'SKILL.md');
    fs.appendFileSync(modified, '\nLocal note.\n');
    const retargeted = path.join(project, '.codex', 'skills', 'git-worktree');
    fs.rmSync(retargeted, { recursive: true, force: true });
    fs.symlinkSync('../../third-party/code-review', retargeted, 'dir');
    const nonOverlapping = snapshotTree(path.join(project, '.codex', 'skills', 'codex-local'));
    const agentToml = fs.readFileSync(path.join(project, '.codex', 'agents', 'explorer.toml'), 'utf8');
    const projected = snapshotTree(path.join(project, '.agents', 'skills'));
    assert.deepStrictEqual(codexSkillNames(project), ['change-verdict', 'code-review', 'code-trace', 'codex-local', 'git-worktree', 'tdd-workflow']);

    const before = snapshotTree(project);
    const planned = runCodexInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], project);
    assert.strictEqual(snapshotTree(project), before, '--plan must not write');
    const report = JSON.parse(planned.stdout);
    const handling = Object.fromEntries((report.compatibilityRetirements || []).map((row) => [row.path, row.handling]));
    assert.deepStrictEqual(handling, {
      'skills/change-verdict': 'retire',
      'skills/code-trace': 'keep-modified',
      'skills/git-worktree': 'keep-modified',
      'skills/tdd-workflow': 'retire',
    });
    assert.deepStrictEqual(report.diagnostics || [], []);
    assert.notStrictEqual(report.state, 'current');

    const updated = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(updated.status, 1, outputOf(updated));
    assert.match(outputOf(updated), /retired=2/);
    assert.match(outputOf(updated), /collision preserved: skills\/code-trace/);
    assert.match(outputOf(updated), /collision preserved: skills\/git-worktree/);
    assert.deepStrictEqual(codexSkillNames(project), ['code-review', 'code-trace', 'codex-local', 'git-worktree']);
    assert.match(fs.readFileSync(modified, 'utf8'), /Local note\./);
    assert.strictEqual(fs.readlinkSync(retargeted), '../../third-party/code-review');
    assert.strictEqual(snapshotTree(path.join(project, '.codex', 'skills', 'codex-local')), nonOverlapping);
    assert.deepStrictEqual(thirdParty(), thirdPartyBefore);
    assert.strictEqual(fs.readFileSync(path.join(project, '.codex', 'agents', 'explorer.toml'), 'utf8'), agentToml);
    assert.strictEqual(snapshotTree(path.join(project, '.agents', 'skills')), projected);
    const receipt = JSON.parse(fs.readFileSync(path.join(project, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(receipt.managed_entries.skills).filter((name) => ['change-verdict', 'tdd-workflow'].includes(name)), []);
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.codex')), []);

    const replanned = JSON.parse(runCodexInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], project).stdout);
    assert.deepStrictEqual((replanned.missing || []).map((item) => item.path).filter((relative) => /change-verdict|tdd-workflow/.test(relative)), []);
    const again = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.match(outputOf(again), /retired=0/);
    assert.deepStrictEqual(codexSkillNames(project), ['code-review', 'code-trace', 'codex-local', 'git-worktree']);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('a stale compatibility projection keeps the overlapping Codex copy and reports COMPATIBILITY_PROJECTION_STALE', () => {
  const project = overlapCheckout();
  try {
    const first = runCodexInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(first.status, 0, outputOf(first));
    projectCompatibilitySkills(project);
    fs.appendFileSync(path.join(project, 'skills', 'change-verdict', 'SKILL.md'), '\nEdited after projection.\n');
    const copy = snapshotTree(path.join(project, '.codex', 'skills', 'change-verdict'));

    const planned = runCodexInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], project);
    const report = JSON.parse(planned.stdout);
    const stale = (report.diagnostics || []).filter((item) => item.code === 'COMPATIBILITY_PROJECTION_STALE');
    assert.deepStrictEqual(stale.map((item) => item.path), ['skills/change-verdict']);
    assert.match(stale[0].action, /npm run sync:local-skills/);
    const handling = Object.fromEntries((report.compatibilityRetirements || []).map((row) => [row.path, row.handling]));
    assert.strictEqual(handling['skills/change-verdict'], undefined);
    assert.strictEqual(handling['skills/tdd-workflow'], 'retire');

    const updated = runCodexInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(updated.status, 0, outputOf(updated));
    assert.match(outputOf(updated), /COMPATIBILITY_PROJECTION_STALE: skills\/change-verdict/);
    assert.match(outputOf(updated), /npm run sync:local-skills/);
    assert.strictEqual(snapshotTree(path.join(project, '.codex', 'skills', 'change-verdict')), copy);
    assert.ok(!fs.existsSync(path.join(project, '.codex', 'skills', 'tdd-workflow')));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Cursor --update inside the canonical source checkout skips relocatable Shared Project Projection', () => {
  const project = selfOverlapPlugin();
  try {
    const first = runCursorInstaller(project, ['--copy', '--force'], project);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    assert.match(`${first.stdout}\n${first.stderr}`, /Shared Project Projection install skipped:.*canonical source checkout/);
    assert.doesNotMatch(`${first.stdout}\n${first.stderr}`, /PROJECT_ROOT_OVERLAP|relocatable projectRoot must not overlap/);
    assert.ok(!fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
    assert.ok(fs.existsSync(path.join(project, '.cursor', 'agents', 'reviewer.md')));
    assert.ok(fs.existsSync(path.join(project, '.cursor', 'skills', 'dhpk-portable', 'SKILL.md')));
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.cursor')), []);

    const updated = runCursorInstaller(project, ['--copy', '--update', '--force'], project);
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.ok(!fs.existsSync(path.join(project, '.agents', '.dhpk-installed.json')));
    assert.deepStrictEqual(activeTransactionJournals(path.join(project, '.cursor')), []);

    const planned = runCursorInstaller(project, ['--copy', '--update', '--plan', '--json', '--force'], project);
    assert.notStrictEqual(planned.status, 2, `${planned.stdout}\n${planned.stderr}`);
    const report = JSON.parse(planned.stdout);
    assert.notStrictEqual(report.state, 'blocked');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// --- Projection Journal: one commit point across installer and publisher (#1235, ADR-0033) ---


// --- Explicit recovery (REQ-6) ---

// The Python installer that wrote Host journals is gone, and this release no
// longer recovers the ones it left (issue #1321): an active or incomplete
// journal fails closed and names the dhpk 0.74.x line that still recovers it.
// The projects below are recordings of what it left
// (tests/fixtures/legacy-journals/README.md).
const DHPK_INSTALL = path.join(REPO, 'scripts', 'dhpk-install.js');

// The recorded committed install, with its last Host journal turned into an
// incomplete rollback that still owes one restore: `.codex/agents/explorer.toml`
// from its backup.
function incompleteRollbackScenario() {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const recording = loadLegacyFixture('python-codex-host-journal');
  restoreTree(recording.before, scratch, { '@@PROJECT@@': scratch, '@@PLUGIN@@': plugin });
  const hostRoot = path.join(scratch, '.codex');
  const name = fs.readdirSync(hostRoot).filter((entry) => /^\.dhpk-transaction-.*\.json$/.test(entry)).sort().pop();
  const journalPath = path.join(hostRoot, name);
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const relative = 'agents/explorer.toml';
  const backup = `.dhpk-backups/${journal.run}/${relative}`;
  const live = path.join(hostRoot, relative);
  const bytes = fs.readFileSync(live);
  write(path.join(hostRoot, backup), bytes);
  fs.rmSync(live);
  journal.phase = 'rollback_incomplete';
  // A rollback never starts past the commit point, so no committing record remains.
  delete journal.shared_projection;
  journal.prunes = [{ relative, destination: relative, backup }];
  journal.mutations = [];
  journal.adoptions = [];
  journal.receipt_snapshot_present = true;
  journal.receipt_snapshot = JSON.parse(fs.readFileSync(path.join(hostRoot, '.dhpk-installed.json'), 'utf8'));
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return { scratch, plugin, hostRoot, journalPath, run: journal.run };
}

test('an incomplete rollback fails closed naming dhpk 0.74.x, with and without --recover, and changes nothing', () => {
  const { scratch, plugin } = incompleteRollbackScenario();
  try {
    const before = snapshotTree(scratch);
    for (const args of [['--copy', '--force'], ['--recover']]) {
      const result = runCodexInstaller(scratch, args, plugin);
      assert.strictEqual(result.status, 2, outputOf(result));
      assert.match(outputOf(result), /dhpk 0\.74\.x/);
      assert.match(outputOf(result), /--recover/);
      assert.strictEqual(snapshotTree(scratch), before, `${args.join(' ')} must change nothing`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

test('dhpk-install --recover reports an incomplete installer rollback as LEGACY_HOST_JOURNAL without a command', () => {
  const { scratch, plugin, run } = incompleteRollbackScenario();
  try {
    const before = snapshotTree(scratch);
    const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2, outputOf(result));
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.sharedProjection.state, 'SKIPPED');
    assert.strictEqual(report.installerJournals.length, 1);
    const [entry] = report.installerJournals;
    assert.strictEqual(entry.host, '.codex');
    assert.strictEqual(entry.run, run);
    assert.strictEqual(entry.phase, 'rollback_incomplete');
    assert.strictEqual(entry.code, 'LEGACY_HOST_JOURNAL');
    assert.ok(!('command' in entry), 'no command can replay a journal this release does not recover');
    assert.match(entry.action, /dhpk 0\.74\.x/);
    assert.strictEqual(snapshotTree(scratch), before);
    const text = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch], { encoding: 'utf8' });
    assert.strictEqual(text.status, 2, outputOf(text));
    assert.ok(outputOf(text).includes(`.codex transaction ${run} is rollback_incomplete; recover it with dhpk 0.74.x --recover`), outputOf(text));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

function hostJournalProject(scratch, content) {
  fs.mkdirSync(path.join(scratch, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-transaction-20260101T000000Z-1.json'), content);
}

test('dhpk-install --recover with a blocking Host journal skips every mutating recovery and changes nothing', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    restoreTree(loadLegacyFixture('python-codex-host-journal').interrupted, scratch, { '@@PROJECT@@': scratch, '@@PLUGIN@@': plugin });
    // The recording also holds a v3 Publisher journal; unheld, recovery rolls it back.
    const publisherJournal = path.join(scratch, '.agents', '.dhpk-installed.transaction.json');
    const journal = JSON.parse(fs.readFileSync(publisherJournal, 'utf8'));
    delete journal.hold;
    journal.phase = 'publishing';
    fs.writeFileSync(publisherJournal, `${JSON.stringify(journal, null, 2)}\n`);
    assert.ok(activeTransactionJournals(path.join(scratch, '.codex')).length > 0, 'the Host journal must be active');
    const before = snapshotTree(scratch);
    const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2, outputOf(result));
    const report = JSON.parse(result.stdout);
    assert.strictEqual(snapshotTree(scratch), before, 'no mutating recovery may run while a Host journal blocks');
    assert.strictEqual(report.ok, false);
    assert.ok(report.installerJournals.some((entry) => entry.code === 'LEGACY_HOST_JOURNAL'), outputOf(result));
    assert.strictEqual(report.sharedProjection.state, 'SKIPPED', 'the skipped step must be marked, not shown as run');
    assert.strictEqual(report.projectionJournal.state, 'SKIPPED');
    const text = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch], { encoding: 'utf8' });
    assert.match(outputOf(text), /shared projection: SKIPPED/);
    assert.strictEqual(snapshotTree(scratch), before);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

for (const [label, content] of [['an empty object', '{}'], ['an unknown phase', '{"phase":"weird"}'], ['a null phase', '{"phase":null}'], ['a numeric phase', '{"phase":3}']]) {
  test(`dhpk-install --recover blocks on a Host journal with ${label}`, () => {
    const scratch = projectRoot();
    const plugin = fakePlugin();
    try {
      hostJournalProject(scratch, content);
      const before = snapshotTree(scratch);
      const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
      assert.strictEqual(result.status, 2, outputOf(result));
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.ok, false);
      assert.strictEqual(report.installerJournals.length, 1, outputOf(result));
      assert.match(report.installerJournals[0].error, /unsupported phase/);
      assert.strictEqual(snapshotTree(scratch), before);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
    }
  });
}

for (const phase of ['committed', 'rolled_back']) {
  test(`dhpk-install --recover ignores a ${phase} Host journal`, () => {
    const scratch = projectRoot();
    const plugin = fakePlugin();
    try {
      hostJournalProject(scratch, JSON.stringify({ phase }));
      const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
      assert.strictEqual(JSON.parse(result.stdout).installerJournals.length, 0, outputOf(result));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
    }
  });
}

test('dhpk-install --recover reports the active journal of the recorded killed update as LEGACY_HOST_JOURNAL', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    restoreTree(loadLegacyFixture('python-codex-host-journal').interrupted, scratch, { '@@PROJECT@@': scratch, '@@PLUGIN@@': plugin });
    const [active] = activeTransactionJournals(path.join(scratch, '.codex'));
    assert.ok(active, 'the recording must hold an active Host journal');
    const before = snapshotTree(scratch);
    const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2, outputOf(result));
    const entry = JSON.parse(result.stdout).installerJournals.find((item) => item.phase === 'active');
    assert.ok(entry, outputOf(result));
    assert.strictEqual(entry.code, 'LEGACY_HOST_JOURNAL');
    assert.ok(!('command' in entry));
    assert.strictEqual(snapshotTree(scratch), before, 'the refused recovery changes nothing');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

run('install-codex-sync-shared');
