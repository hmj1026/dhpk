'use strict';

// Behavioral coverage for install-codex-skills.sh. The fixtures deliberately
// exercise ownership boundaries rather than only checking shell syntax.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', HOOK], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `syntax error: ${res.stderr}`);
});

test('--help invocation is a safe no-op (no .codex/ created, exit 0)', () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-')));
  try {
    const env = { ...process.env };
    const res = spawnSync('bash', [HOOK, '--help'], {
      cwd: scratch,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.strictEqual(res.status, 0, `expected exit 0: ${res.stderr}`);
    assert.match(res.stdout, /--migrate/);
    assert.match(res.stdout, /--uninstall/);
    assert.ok(!fs.existsSync(path.join(scratch, '.codex')),
      'expected --help to provably no-op: no .codex/ directory created');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

function runInstaller(project, args, pluginRoot = ROOT) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-behavior-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

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
    assert.strictEqual(manifest.schema_version, 2);
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
    assert.ok(skillEntry.ownership_marker);
    assert.strictEqual(manifest.mode, 'copy');
    assert.strictEqual(manifest.plugin_version, JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'))).version);
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
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.strictEqual(fs.readFileSync(skillFile, 'utf8'), 'stale target\n',
      'edited receipt-owned content must be preserved and reported as orphaned');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.mode, 'copy');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('same plugin version but changed source content is not treated as up-to-date', () => {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-')));
  try {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
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

test('symlink mode adopts a new plugin root on update when the receipt owns the link', () => {
  const scratch = projectRoot();
  const firstPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v1-')));
  const secondPlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plugin-v2-')));
  const preparePlugin = (plugin) => {
    fs.cpSync(path.join(ROOT, 'codex'), path.join(plugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(plugin, '.claude-plugin', 'plugin.json'));
  };
  try {
    preparePlugin(firstPlugin);
    preparePlugin(secondPlugin);
    const first = runInstaller(scratch, ['--force'], firstPlugin);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const agentName = fs.readdirSync(path.join(scratch, '.codex', 'agents'))[0];
    const target = path.join(scratch, '.codex', 'agents', agentName);
    assert.strictEqual(fs.realpathSync(target), fs.realpathSync(path.join(firstPlugin, 'codex', 'agents', agentName)));
    const second = runInstaller(scratch, ['--update', '--force'], secondPlugin);
    assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.strictEqual(fs.realpathSync(target), fs.realpathSync(path.join(secondPlugin, 'codex', 'agents', agentName)));
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
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
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
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
    fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, 'private.txt'), 'must not escape the mapped file boundary\n');
    for (const source of ['.', 'codex\\supporting']) {
      fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
        supporting_assets: [{ id: 'bad-source', source, destination: 'dhpk/root-copy' }],
      }));
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

test('legacy receipt and unowned symlink are fail-closed until --migrate', () => {
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
    const res = runInstaller(scratch, ['--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(`${res.stdout}\n${res.stderr}`, /collision/i);
    assert.ok(fs.lstatSync(target).isSymbolicLink());
    assert.strictEqual(fs.realpathSync(target), external);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.strictEqual(manifest.schema_version, 2);
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
    fs.cpSync(path.join(ROOT, 'codex'), path.join(fakePlugin, 'codex'), { recursive: true });
    fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
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
    assert.strictEqual(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
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
    assert.strictEqual(manifest.schema_version, 2);
    assert.ok(manifest.managed_entries.skills[skillName], 'exact source match should be adopted');
    assert.ok(!manifest.managed_entries.skills[mismatch], 'mismatched legacy destination must remain unowned');
    assert.strictEqual(fs.readFileSync(path.join(mismatchTarget, 'user-owned.txt'), 'utf8'), 'do not replace\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('legacy migration remains available after a safe normal sync', () => {
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
    assert.strictEqual(normal.status, 0, `${normal.stdout}\n${normal.stderr}`);
    assert.match(`${normal.stdout}\n${normal.stderr}`, /collision/i);
    const migrated = runInstaller(scratch, ['--copy', '--migrate', '--force']);
    assert.strictEqual(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
    assert.ok(manifest.managed_entries.skills[skillName], 'exact legacy copy should become receipt-owned after explicit migration');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('--uninstall removes only unchanged receipt-owned targets and retains orphaned/unrelated assets', () => {
  const scratch = projectRoot();
  try {
    const first = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const skills = fs.readdirSync(path.join(scratch, '.codex', 'skills'));
    assert.ok(skills.length >= 2, 'fixture needs at least two installed skills');
    const edited = skills[0];
    const kept = skills[1];
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
    const restored = runInstaller(scratch, ['--copy', '--force']);
    assert.strictEqual(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
    assert.ok(fs.readdirSync(path.join(scratch, '.codex', 'skills')).length > 0);
    assert.doesNotMatch(restored.stdout, /already up-to-date/);
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
    const skillName = fs.readdirSync(path.join(scratch, '.codex', 'skills'))[0];
    const originalSkills = path.join(scratch, '.codex', 'skills');
    const externalSkills = path.join(external, 'skills');
    fs.renameSync(originalSkills, externalSkills);
    fs.symlinkSync(externalSkills, originalSkills, 'dir');
    const res = runInstaller(scratch, ['--uninstall', '--force']);
    assert.strictEqual(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.ok(fs.existsSync(path.join(externalSkills, skillName, 'SKILL.md')));
    assert.match(`${res.stdout}\n${res.stderr}`, /orphaned|unsafe|preserved/i);
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
    const skillName = fs.readdirSync(path.join(ROOT, 'codex', 'skills'))[0];
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

run('install-codex-skills');
