'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/native-installer-lifecycle-fixture');

const {
  ROOT,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  firstNativeManagedSkill,
  nativeManagedSkillNames,
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

test('uninstall preserves a retargeted symlink even when the replacement has identical content', () => {
  const scratch = projectRoot();
  const userOwned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-identical-target-')));
  try {
    const first = runInstaller(scratch, ['--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const assetPath = 'dhpk/agent-traps/_common/prompt-defense.md';
    const source = path.join(ROOT, 'codex', 'supporting', 'prompt-defense.md');
    const target = path.join(scratch, '.codex', assetPath);
    const replacement = path.join(userOwned, 'prompt-defense.md');
    const installed = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(installed.managed_entries.supporting_assets[assetPath].mode, 'symlink',
      'the supporting asset remains a symlink in the default install mode');
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'the fixture begins with a receipt-owned symlink');
    fs.copyFileSync(source, replacement);
    fs.unlinkSync(target);
    fs.symlinkSync(replacement, target);

    const removed = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), 'retargeted supporting-asset symlink must be preserved');
    assert.strictEqual(fs.realpathSync(target), fs.realpathSync(replacement));
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.orphaned_entries[assetPath]);
    assert.match(`${removed.stdout}\n${removed.stderr}`, /orphaned|preserved/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(userOwned, { recursive: true, force: true });
  }
});

test('uninstall preserves an external tree reached through a symlinked .codex/skills parent', () => {
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
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(externalSkills, skillName, 'SKILL.md')));
    assert.ok(fs.lstatSync(originalSkills).isSymbolicLink());
    assert.match(`${res.stdout}\n${res.stderr}`, /symlink|unsafe|ancestor/i);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

run('macos-installer-darwin');
