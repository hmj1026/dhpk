'use strict';

// Behavioral coverage for install-codex-skills.sh (install-codex-skills-uninstall).
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
  firstNativeManagedSkill,
  nativeManagedSkillNames,
  collisionFixture,
  transactionMetadataSnapshot,
  provenanceDriftPlanFixture
} = fixtures;

test('--uninstall removes only unchanged receipt-owned targets and retains orphaned/unrelated assets', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const nativeSkills = nativeManagedSkillNames(scratch);
    assert.ok(nativeSkills.length >= 2, 'fixture needs at least two installed runtime-support skills');
    const edited = nativeSkills[0];
    const kept = nativeSkills[1];
    const editedTarget = path.join(scratch, '.codex', 'skills', edited);
    fs.writeFileSync(path.join(editedTarget, 'user-edit.txt'), 'edited\n');
    const unrelatedTarget = path.join(scratch, '.codex', 'skills', 'unrelated');
    fs.mkdirSync(unrelatedTarget, { recursive: true });
    fs.writeFileSync(path.join(unrelatedTarget, 'keep.txt'), 'keep\n');
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|preserved/i);
    assert.ok(fs.existsSync(editedTarget), 'edited owned target must be preserved');
    assert.ok(fs.existsSync(unrelatedTarget), 'unrelated target must be preserved');
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', 'skills', kept)), 'unchanged owned target should be removed');
    const manifestPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    assert.ok(fs.existsSync(manifestPath), 'receipt remains while orphaned content is retained');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a normal install repopulates the project after uninstall', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.strictEqual(fs.readdirSync(path.join(scratch, '.codex', 'skills')).length, 0);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex', '.dhpk-installed.json')),
      'complete uninstall must remove the live receipt');
    const receiptBackups = fs.readdirSync(path.join(scratch, '.codex', '.dhpk-backups'))
      .map((run) => path.join(scratch, '.codex', '.dhpk-backups', run, 'receipt.json'))
      .filter((candidate) => fs.existsSync(candidate));
    assert.ok(receiptBackups.length >= 1, 'complete uninstall must retain an fsynced receipt quarantine');
    const restored = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
    assert.ok(fs.readdirSync(path.join(scratch, '.codex', 'skills')).length > 0);
    assert.doesNotMatch(restored.stdout, /already up-to-date/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('complete uninstall restores the receipt when its quarantine fsync fails', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
    const failed = runInstaller(
      scratch,
      ['--uninstall', '--force'],
      ROOT,
      { DHPK_TEST_FAIL_UNINSTALL_RECEIPT_FSYNC: '1' },
    );
    assert.notStrictEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
    assert.ok(fs.existsSync(receiptPath), 'failed uninstall must restore the live receipt');
    const managed = JSON.parse(fs.readFileSync(receiptPath, 'utf8')).managed_entries.skills;
    const restoredTarget = Object.values(managed)
      .map((entry) => path.join(scratch, '.codex', entry.destination))
      .find((candidate) => fs.existsSync(candidate));
    assert.ok(restoredTarget, 'failed uninstall must restore at least one managed target');

    const recovered = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`);
    assert.ok(!fs.existsSync(receiptPath), 'recovered uninstall must remove the receipt');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a deleted orphaned destination is restored to managed ownership on reinstall', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = firstNativeManagedSkill(scratch);
    const target = path.join(scratch, '.codex', 'skills', skillName);
    fs.writeFileSync(path.join(target, 'user-edit.txt'), 'edited\n');
    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(fs.existsSync(target), 'edited destination should be retained as orphaned');
    fs.rmSync(target, { recursive: true, force: true });

    const restored = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
    assert.strictEqual(Object.keys(manifest.orphaned_entries || {}).length, 0, JSON.stringify(manifest));
    assert.strictEqual(manifest.reconciliation.state, 'current');
    assert.strictEqual(manifest.reconciliation.complete, true);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall rejects receipt traversal paths without deleting outside .codex', () => {
  const scratch = projectRoot();
  const outside = path.join(scratch, 'outside-owned');
  try {
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep me\n');
    fs.mkdirSync(path.join(scratch, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), JSON.stringify({
      schema_version: 2,
      plugin_version: 'legacy',
      source_fingerprint: 'fixture',
      mode: 'copy',
      managed_entries: {
        skills: {
          evil: {
            destination: '../outside-owned',
            source: '../outside-owned',
            mode: 'copy',
            destination_fingerprint: 'fixture',
            ownership_marker: 'copy:../outside-owned',
          },
        },
        agents: {},
        supporting_assets: {},
      },
    }));
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep me\n');
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|unsafe|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall rejects symlinked .codex parents without deleting the external tree', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-codex-')));
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = firstNativeManagedSkill(scratch);
    const originalSkills = path.join(scratch, '.codex', 'skills');
    const externalSkills = path.join(external, 'skills');
    fs.renameSync(originalSkills, externalSkills);
    fs.symlinkSync(externalSkills, originalSkills, 'dir');
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.notStrictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(externalSkills, skillName, 'SKILL.md')));
    assert.match(`${res.stdout}\n${res.stderr}`, /symlink|unsafe|ancestor/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('sync rejects a symlinked project .codex root before writing a receipt', () => {
  const scratch = projectRoot();
  const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-external-root-')));
  try {
    fs.symlinkSync(external, path.join(scratch, '.codex'), 'dir');
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(res.status, 0);
    assert.ok(!fs.existsSync(path.join(external, '.dhpk-installed.json')));
    assert.match(`${res.stdout}\n${res.stderr}`, /symlink|refusing/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('sync rejects a symlinked receipt without modifying the external target', () => {
  const scratch = projectRoot();
  const external = path.join(scratch, 'external-receipt.json');
  try {
    fs.mkdirSync(path.join(scratch, '.codex'), { recursive: true });
    fs.writeFileSync(external, 'keep external receipt\n');
    fs.symlinkSync(external, path.join(scratch, '.codex', '.dhpk-installed.json'));
    const res = runInstaller(scratch, ['--copy', '--force']);
    assert.notStrictEqual(res.status, 0);
    assert.strictEqual(fs.readFileSync(external, 'utf8'), 'keep external receipt\n');
    assert.ok(fs.lstatSync(path.join(scratch, '.codex', '.dhpk-installed.json')).isSymbolicLink());
    assert.match(`${res.stdout}\n${res.stderr}`, /receipt|symlink|refusing/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('uninstall preserves a retargeted symlink even when the replacement has identical content', () => {
  const scratch = projectRoot();
  const userOwned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-identical-target-')));
  try {
    const first = runInstaller(scratch, ['--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skillName = firstNativeManagedSkill(scratch);
    const source = path.join(ROOT, 'codex', 'skills', skillName);
    const target = path.join(scratch, '.codex', 'skills', skillName);
    const replacement = path.join(userOwned, skillName);
    fs.cpSync(source, replacement, { recursive: true, dereference: true });
    fs.unlinkSync(target);
    fs.symlinkSync(replacement, target, 'dir');

    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'retargeted symlink must be preserved');
    assert.strictEqual(fs.realpathSync(target), fs.realpathSync(replacement));
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.orphaned_entries[`skills/${skillName}`]);
    assert.match(`${removed.stdout}\n${removed.stderr}`, /orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(userOwned, { recursive: true, force: true });
  }
});

run('install-codex-skills-uninstall');
