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
  CODEX_STUB_BIN,
} = require('./_lib/install-codex-skills-fixtures');

const { write, skillBody, fakePlugin } = require('./_lib/shared-projection-plugin');

const REPO = path.join(__dirname, '..');
const PYTHON_ENGINE = { DHPK_INSTALLER_ENGINE: 'python' };
const CURSOR_HOOK = path.join(REPO, 'scripts', 'hooks', 'install-cursor-harness.sh');

// Apple's Xcode python3 writes its own bytecode cache under
// $HOME/Library/Caches/com.apple.python. Pin it on macOS so the isolated-HOME
// assertion always meets that interpreter instead of whichever python3 the
// caller's PATH happens to resolve. Without Command Line Tools the stub would
// open an install dialog, so the pin is skipped there.
const APPLE_PYTHON = '/usr/bin/python3';
function applePythonShimDir() {
  if (process.platform !== 'darwin' || !fs.existsSync(APPLE_PYTHON)) return null;
  if (spawnSync('xcode-select', ['-p'], { encoding: 'utf8', timeout: 10000 }).status !== 0) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-apple-python-'));
  try {
    fs.symlinkSync(APPLE_PYTHON, path.join(dir, 'python3'));
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return dir;
}


function runCursorInstaller(project, args, pluginRoot, extraEnv) {
  return spawnSync('bash', [CURSOR_HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...(extraEnv || {}) },
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

    const nativeBindings = {
      codex: path.join(project, '.codex', 'skills', 'dhpk-codex-only'),
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
    let pythonShim = null;
    try {
      pythonShim = applePythonShimDir();
      const env = {
        HOME: isolatedHome,
        // The assertion is that the installers write nothing to HOME; the
        // interpreter's own bytecode cache is not installer output.
        PYTHONDONTWRITEBYTECODE: '1',
        ...(pythonShim ? { PATH: `${CODEX_STUB_BIN}:${pythonShim}:${process.env.PATH || ''}` } : {}),
      };
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
      assert.deepStrictEqual(receipt.bindingPaths[otherHost], [{ path: `.${otherHost}/skills/${otherName}`, target: `../../.agents/skills/${otherName}` }]);
      assert.ok(fs.lstatSync(path.join(project, `.${otherHost}`, 'skills', otherName)).isSymbolicLink());
      assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills', 'dhpk-retired')));
      assert.ok(!fs.existsSync(path.join(project, `.${otherHost}`, 'skills', 'dhpk-retired')));
      assert.strictEqual(fs.readFileSync(path.join(project, '.agents', 'skills', 'consumer-owned', 'README.md'), 'utf8'), '# keep\n');
      assert.deepStrictEqual(fs.readdirSync(isolatedHome), []);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(plugin, { recursive: true, force: true });
      fs.rmSync(isolatedHome, { recursive: true, force: true });
      if (pythonShim) fs.rmSync(pythonShim, { recursive: true, force: true });
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

test('fresh Codex install delegates declared skills via native-link and keeps native agents', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const res = runCodexInstaller(scratch, ['--copy', '--force'], plugin);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const shared = path.join(scratch, '.agents', 'skills', 'dhpk-codex-only');
    const nativeSkill = path.join(scratch, '.codex', 'skills', 'dhpk-codex-only');
    assert.ok(fs.existsSync(path.join(shared, 'SKILL.md')));
    assert.ok(!fs.lstatSync(shared).isSymbolicLink());
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    assertOnlySymlinks(path.join(scratch, '.codex', 'skills'));
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(!receipt.managed_entries.skills || !receipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'native-link');
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
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')).isSymbolicLink());
    assert.ok(!fs.existsSync(path.join(scratch, '.cursor', 'skills', 'dhpk-codex-only')));
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', 'dhpk-portable')));
    const after = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.deepStrictEqual(after.hostBindings.cursor, cursorBindings);
    assert.deepStrictEqual(after.bindingPaths.cursor, cursorPaths);
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
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
    const nextReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(!nextReceipt.managed_entries.skills || !nextReceipt.managed_entries.skills['dhpk-codex-only']);
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.codex.bindingShape, 'native-link');
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
    assert.ok(fs.lstatSync(nativeSkill).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(nativeSkill), '../../.agents/skills/dhpk-codex-only');
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
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', 'skills', 'dhpk-codex-only')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(scratch, '.codex', 'agents', 'explorer.toml')));
    assert.strictEqual(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'foreign', 'keep.md'), 'utf8'), '# keep\n');
    const projection = JSON.parse(fs.readFileSync(path.join(scratch, '.agents', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(projection.hostBindings.cursor, undefined);
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

function latestTransactionJournal(hostRoot, previousNames) {
  if (!fs.existsSync(hostRoot)) return null;
  const names = fs.readdirSync(hostRoot)
    .filter((name) => /^\.dhpk-transaction-\d{8}T\d{6}Z-\d+\.json$/.test(name)
      && !previousNames.includes(name));
  assert.strictEqual(names.length, 1, 'expected exactly one new Host transaction journal');
  const name = names[0];
  return {
    name,
    journal: JSON.parse(fs.readFileSync(path.join(hostRoot, name), 'utf8')),
  };
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

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('shared projection failure after a Host transaction records rolled_back', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const journalsBeforeUpdate = fs.readdirSync(path.join(scratch, '.codex'));
    const failed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, {
      ...PYTHON_ENGINE, DHPK_TEST_FAIL_SHARED_PROJECTION: '1',
    });
    assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.match(`${failed.stdout}\n${failed.stderr}`, /shared projection/i);
    assert.deepStrictEqual(activeTransactionJournals(path.join(scratch, '.codex')), []);
    const latest = latestTransactionJournal(path.join(scratch, '.codex'), journalsBeforeUpdate);
    assert.ok(latest, 'expected a Host transaction journal after the failed update');
    assert.strictEqual(latest.journal.phase, 'rolled_back');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// --- Projection Journal: one commit point across installer and publisher (#1235, ADR-0033) ---

const NODE_JOURNAL = path.join('.agents', '.dhpk-installed.transaction.json');

// The installer's Python runs under bash, so a SIGKILL shows as bash exit 137.
function wasKilled(result) {
  return result.signal === 'SIGKILL' || result.status === 137;
}

function liveState(scratch) {
  // Transient journals and backups are excluded; everything a user or Host reads is included.
  const keep = (rel) => !/(^|\/)\.dhpk-transaction-|(^|\/)backups(\/|$)|\.dhpk-installed\.transaction\.json$|\.dhpk-projection-/.test(rel);
  return ['.agents', '.codex'].map((dir) => snapshotTree(path.join(scratch, dir))
    .split('\n').filter((line) => line && keep(`${dir}/${line}`)).map((line) => `${dir}/${line}`).join('\n')).join('\n');
}

// An installed project whose plugin content then changes, so --update makes
// the publisher write new shared-projection content inside the installer run.
function changedPluginScenario(env = {}) {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin, env);
  assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
  write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only v2'));
  write(path.join(plugin, 'codex', 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only v2'));
  return { scratch, plugin };
}

function killerPreload(dir) {
  // Kills the installer (parent) and the publisher together while the publisher
  // copies into the shared projection, i.e. the installer dies mid-publish.
  const file = path.join(dir, 'kill-mid-publish.js');
  write(file, `
    const fs = require('node:fs');
    const original = fs.copyFileSync;
    fs.copyFileSync = (...args) => {
      if (String(args[1]).includes('/.agents/skills/')) {
        try { process.kill(process.ppid, 'SIGKILL'); } catch {}
        process.kill(process.pid, 'SIGKILL');
      }
      return original(...args);
    };
  `);
  return file;
}

// Python-only mechanics (DHPK_TEST_* fault/kill hooks); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('native install failure after the held shared projection restores both sides', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const before = liveState(scratch);
    const failed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_FAIL_AFTER_SHARED_PROJECTION: '1' });
    assert.notStrictEqual(failed.status, 0, outputOf(failed));
    assert.match(outputOf(failed), /test-injected failure after the shared projection step/);
    assert.strictEqual(liveState(scratch), before);
    assert.doesNotMatch(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md'), 'utf8'), /v2/);
    assert.strictEqual(fs.existsSync(path.join(scratch, NODE_JOURNAL)), false);
    assert.deepStrictEqual(activeTransactionJournals(path.join(scratch, '.codex')), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_KILL_AT fault hook, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('installer killed after the held shared projection rolls back both sides on the next run', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const before = liveState(scratch);
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'after-shared-projection' });
    assert.ok(wasKilled(killed), outputOf(killed));
    const [active] = activeTransactionJournals(path.join(scratch, '.codex'));
    assert.ok(active, 'expected the killed run to leave its installer journal active');
    const held = JSON.parse(fs.readFileSync(path.join(scratch, NODE_JOURNAL), 'utf8')).hold;
    assert.strictEqual(`.dhpk-transaction-${held.transactionId}.json`, active);
    const plan = runCodexInstaller(scratch, ['--copy', '--update', '--force', '--plan', '--json'], plugin, PYTHON_ENGINE);
    assert.doesNotMatch(outputOf(plan), /RECOVERY_CONFLICT/);
    const rerun = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_FAIL_AFTER_SHARED_PROJECTION: '1' });
    assert.doesNotMatch(outputOf(rerun), /RECOVERY_CONFLICT|held by/);
    assert.strictEqual(liveState(scratch), before, 'recovery plus a failed rerun must leave the pre-update state');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (killerPreload kills process.ppid, which is the Python installer only under the Python engine); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('installer killed while the publisher is publishing recovers without RECOVERY_CONFLICT', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  const preloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-preload-'));
  try {
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, NODE_OPTIONS: `--require ${killerPreload(preloadDir)}` });
    assert.ok(wasKilled(killed), outputOf(killed));
    const rerun = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(rerun.status, 0, outputOf(rerun));
    assert.doesNotMatch(outputOf(rerun), /RECOVERY_CONFLICT/);
    assert.match(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md'), 'utf8'), /Codex only v2/);
    assert.strictEqual(fs.existsSync(path.join(scratch, NODE_JOURNAL)), false);
    assert.deepStrictEqual(activeTransactionJournals(path.join(scratch, '.codex')), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.rmSync(preloadDir, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('installer killed after the publisher commit rolls forward on the next run', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'after-shared-commit' });
    assert.ok(wasKilled(killed), outputOf(killed));
    assert.strictEqual(fs.existsSync(path.join(scratch, NODE_JOURNAL)), false, 'the publisher committed before the kill');
    const rerun = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(rerun.status, 0, outputOf(rerun));
    assert.match(rerun.stdout, /already up-to-date/, 'roll-forward must finalize the updated receipt');
    assert.match(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md'), 'utf8'), /Codex only v2/);
    assert.deepStrictEqual(activeTransactionJournals(path.join(scratch, '.codex')), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('a failure after the publisher commit rolls nothing back and the next run rolls forward', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const failed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_FAIL_AFTER_SHARED_COMMIT: '1' });
    assert.notStrictEqual(failed.status, 0, outputOf(failed));
    assert.match(outputOf(failed), /already committed; rerun the installer/);
    assert.strictEqual(activeTransactionJournals(path.join(scratch, '.codex')).length, 1, 'the installer journal must stay active');
    assert.match(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md'), 'utf8'), /Codex only v2/, 'nothing may be rolled back');
    const rerun = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(rerun.status, 0, outputOf(rerun));
    assert.match(rerun.stdout, /already up-to-date/);
    assert.deepStrictEqual(activeTransactionJournals(path.join(scratch, '.codex')), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('uninstall killed after the held shared projection restores both sides on the next run', () => {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  try {
    const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(first.status, 0, outputOf(first));
    const before = liveState(scratch);
    const killed = runCodexInstaller(scratch, ['--uninstall', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'after-shared-projection' });
    assert.ok(wasKilled(killed), outputOf(killed));
    const plan = runCodexInstaller(scratch, ['--copy', '--force', '--plan', '--json'], plugin, PYTHON_ENGINE);
    assert.doesNotMatch(outputOf(plan), /RECOVERY_CONFLICT/);
    const rerun = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(rerun.status, 0, outputOf(rerun));
    // The rerun may rewrite the publisher receipt; every file and link it owns must be back.
    const withoutReceipt = (state) => state.split('\n').filter((line) => !line.startsWith('.agents/.dhpk-installed.json:')).join('\n');
    assert.strictEqual(withoutReceipt(liveState(scratch)), withoutReceipt(before));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('installer killed after its partial receipt but before the commit intent rolls back both sides', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const before = liveState(scratch);
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'before-shared-commit' });
    assert.ok(wasKilled(killed), outputOf(killed));
    const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(receipt.transaction_final, false, 'the kill must land after the partial receipt');
    const rerun = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_FAIL_AFTER_SHARED_PROJECTION: '1' });
    assert.doesNotMatch(outputOf(rerun), /RECOVERY_CONFLICT|held by/);
    assert.strictEqual(liveState(scratch), before);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('a Host that meets another Host\'s held projection rolls back cleanly and succeeds once it is released', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const cursorFirst = runCursorInstaller(scratch, ['--copy', '--update', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(cursorFirst.status, 0, outputOf(cursorFirst));
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'after-shared-projection' });
    assert.ok(wasKilled(killed), outputOf(killed));
    const journalsBefore = fs.readdirSync(path.join(scratch, '.cursor'));
    const blocked = runCursorInstaller(scratch, ['--copy', '--update', '--force'], plugin, PYTHON_ENGINE);
    assert.notStrictEqual(blocked.status, 0, outputOf(blocked));
    assert.match(outputOf(blocked), /held by the codex installer/);
    const latest = latestTransactionJournal(path.join(scratch, '.cursor'), journalsBefore);
    assert.strictEqual(latest.journal.phase, 'rolled_back', JSON.stringify(latest.journal.rollback_errors || []));
    const codex = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(codex.status, 0, outputOf(codex));
    const cursor = runCursorInstaller(scratch, ['--copy', '--update', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(cursor.status, 0, outputOf(cursor));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// --- Explicit recovery (REQ-6) ---

// Turns the last committed installer journal into an incomplete rollback that
// still owes one restore: `.codex/agents/explorer.toml` from its backup.
function incompleteRollbackScenario(env = {}) {
  const scratch = projectRoot();
  const plugin = fakePlugin();
  const first = runCodexInstaller(scratch, ['--copy', '--force'], plugin, env);
  assert.strictEqual(first.status, 0, outputOf(first));
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
  return { scratch, plugin, hostRoot, journalPath, live, bytes, backup };
}

// Python-only mechanics (Python Host journal file .codex/.dhpk-transaction-<run>.json); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('an incomplete rollback blocks with its remaining paths and backup, and --recover finishes it', () => {
  const { scratch, plugin, journalPath, live, bytes, backup } = incompleteRollbackScenario(PYTHON_ENGINE);
  try {
    const blocked = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.notStrictEqual(blocked.status, 0, outputOf(blocked));
    assert.match(outputOf(blocked), /agents\/explorer\.toml/);
    assert.ok(outputOf(blocked).includes(path.posix.dirname(path.posix.dirname(backup))), outputOf(blocked));
    assert.match(outputOf(blocked), /--recover/);
    const recovered = runCodexInstaller(scratch, ['--recover'], plugin, PYTHON_ENGINE);
    assert.strictEqual(recovered.status, 0, outputOf(recovered));
    assert.deepStrictEqual(fs.readFileSync(live), bytes);
    assert.strictEqual(JSON.parse(fs.readFileSync(journalPath, 'utf8')).phase, 'rolled_back');
    const next = runCodexInstaller(scratch, ['--copy', '--force'], plugin, PYTHON_ENGINE);
    assert.strictEqual(next.status, 0, outputOf(next));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

const SHARED_CLI = path.join(REPO, 'scripts', 'ci', 'install-native-shared-skills.js');
const DHPK_INSTALL = path.join(REPO, 'scripts', 'dhpk-install.js');

// Python-only mechanics (DHPK_TEST_* fault/kill hooks, Python Host journal); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('explicit recovery refuses a held publication while its installer journal is active, then aborts it once orphaned', () => {
  const { scratch, plugin } = changedPluginScenario(PYTHON_ENGINE);
  try {
    const killed = runCodexInstaller(scratch, ['--copy', '--update', '--force'], plugin, { ...PYTHON_ENGINE, DHPK_TEST_KILL_AT: 'after-shared-projection' });
    assert.ok(wasKilled(killed), outputOf(killed));
    const [active] = activeTransactionJournals(path.join(scratch, '.codex'));
    const refused = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(refused.status, 2, outputOf(refused));
    const report = JSON.parse(refused.stdout);
    assert.strictEqual(report.sharedProjection.code, 'INSTALLER_ACTIVE');
    assert.match(report.sharedProjection.message, /codex/);
    assert.ok(fs.existsSync(path.join(scratch, NODE_JOURNAL)));
    // The installer journal is lost: the publication is orphaned.
    fs.rmSync(path.join(scratch, '.codex', active));
    const aborted = spawnSync(process.execPath, [SHARED_CLI, 'recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(aborted.status, 0, outputOf(aborted));
    assert.strictEqual(JSON.parse(aborted.stdout).state, 'ABORTED');
    assert.strictEqual(fs.existsSync(path.join(scratch, NODE_JOURNAL)), false);
    assert.doesNotMatch(fs.readFileSync(path.join(scratch, '.agents', 'skills', 'dhpk-codex-only', 'SKILL.md'), 'utf8'), /v2/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

// Python-only mechanics (Python Host journal file .codex/.dhpk-transaction-<run>.json); JS coverage: tests/install-codex-adapter-journal.test.js. Retired with the embedded Python in stage 5.
test('dhpk-install --recover lists incomplete installer rollbacks with the command that finishes them', () => {
  const { scratch, plugin } = incompleteRollbackScenario(PYTHON_ENGINE);
  try {
    const result = spawnSync(process.execPath, [DHPK_INSTALL, '--recover', '--project-root', scratch, '--json'], { encoding: 'utf8' });
    assert.strictEqual(result.status, 2, outputOf(result));
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.sharedProjection.state, 'ABSENT');
    assert.strictEqual(report.installerJournals.length, 1);
    assert.strictEqual(report.installerJournals[0].host, '.codex');
    assert.match(report.installerJournals[0].command, /--recover/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});

run('install-codex-sync-shared');
