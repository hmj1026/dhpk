'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const fixtures = require('./_lib/native-installer-lifecycle-fixture');

const {
  ROOT,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  descriptorPseudoPathBlocker,
  parentReplacementGate,
  waitForFile,
  firstNativeManagedSkill,
  nativeManagedSkillNames,
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
