'use strict';

// Behavioral coverage for install-codex-skills.sh. The fixtures deliberately
// exercise ownership boundaries rather than only checking shell syntax.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assert } = require('./tinytest');

const ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'install-codex-skills.sh');
const CODEX_STUB_BIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-codex-stub-')));
const CODEX_STUB = path.join(CODEX_STUB_BIN, 'codex');
fs.writeFileSync(CODEX_STUB, `#!/bin/sh
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  if [ "\${DHPK_TEST_CODEX_PLUGIN_LIST_OVERSIZED:-0}" = "1" ]; then
    head -c 2097152 /dev/zero | tr '\\0' x
    sleep 3
    exit 0
  fi
  if [ -n "\${DHPK_TEST_CODEX_BACKGROUND_MARKER:-}" ]; then
    (sleep 4; printf survived > "\${DHPK_TEST_CODEX_BACKGROUND_MARKER}") &
    exit 0
  fi
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_LIST_SLEEP_SECONDS:-}" ]; then
    sleep "\${DHPK_TEST_CODEX_PLUGIN_LIST_SLEEP_SECONDS}"
  fi
  if [ -n "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON:-}" ]; then
    printf '%s\\n' "\${DHPK_TEST_CODEX_PLUGIN_LIST_JSON}"
  else
    printf '%s\\n' '{"installed":[],"available":[]}'
  fi
  exit "\${DHPK_TEST_CODEX_PLUGIN_LIST_EXIT:-0}"
fi
exit 2
`, { mode: 0o755 });
process.on('exit', () => fs.rmSync(CODEX_STUB_BIN, { recursive: true, force: true }));
// Copy-mode fixture setup hashes a complete generated Codex package. Keep this
// bounded, while allowing four-way CI contention to complete that real work.
const INSTALLER_CHILD_TIMEOUT_MS = 60_000;


function runInstaller(project, args, pluginRoot = ROOT, envOverrides = {}) {
  return spawnSync('bash', [HOOK, ...args], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${CODEX_STUB_BIN}:${process.env.PATH || ''}`,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ...envOverrides,
    },
    encoding: 'utf8',
    timeout: INSTALLER_CHILD_TIMEOUT_MS,
  });
}

function projectRoot() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-behavior-')));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function copyDistributionInventory(plugin) {
  fs.cpSync(path.join(ROOT, 'manifests'), path.join(plugin, 'manifests'), { recursive: true, dereference: true });
  fs.cpSync(path.join(ROOT, 'agent-traps'), path.join(plugin, 'agent-traps'), { recursive: true, dereference: true });
  fs.mkdirSync(path.join(plugin, 'docs'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'docs', 'subagent-prompt-template.md'),
    path.join(plugin, 'docs', 'subagent-prompt-template.md'),
  );
  fs.copyFileSync(
    path.join(ROOT, 'docs', 'docker-setup.md'),
    path.join(plugin, 'docs', 'docker-setup.md'),
  );
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
}

// Literal digests of the removed pre-tree-merkle-v1 installer recipe (`dir\0`
// prefix, code-point name order). Captured on 2026-11-02 from the then-current
// fixture helper over tests/fixtures/tree-fingerprint/installer/destination
// before the recipe was deleted; the recipe no longer exists, so these are the
// only legacy oracle. `skillSource` is the unedited sample-skill tree (it equals
// the skill digests in legacy-receipt.json); `skillAfterNotesEdit` is the same
// tree after the line "edited" is appended to references/notes.md.
const LEGACY_RECIPE_DIGESTS = Object.freeze({
  skillSource: '2a95463b69c90af7cf646b87fc430b65087d814384dcf4c033642e6dc8349a53',
  skillAfterNotesEdit: '4370a3a314d8e0f3174d5e5a43fc66b286e8360b1235772a8821baafed90cde0',
});

// Recipe-free change detector for before/after comparisons: every entry's
// relative path, kind, and bytes (or link text), sorted. Unlike a tree digest it
// also notices an empty directory appearing or disappearing.
function snapshotTree(target) {
  const lines = [];
  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      lines.push(`link:${relative}:${fs.readlinkSync(current)}`);
    } else if (stat.isDirectory()) {
      lines.push(`dir:${relative}`);
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), `${relative}/${name}`);
    } else {
      lines.push(`file:${relative}:${fs.readFileSync(current).toString('base64')}`);
    }
  };
  visit(target, '.');
  return lines.join('\n');
}

// Oracle for `tree-merkle-v1` over the complete view (bytecode kept, links
// followed, empty directories dropped), written independently of the library
// function and of the installer: UTF-16 name order, `directory\0` prefix.
function completeTreeFingerprint(target) {
  const hashNode = (current, isRoot) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return hashNode(fs.realpathSync(current), isRoot);
    if (!stat.isDirectory()) {
      return crypto.createHash('sha256').update('file\0').update(fs.readFileSync(current)).digest('hex');
    }
    const children = fs.readdirSync(current)
      .sort()
      .map((name) => [name, hashNode(path.join(current, name), false)])
      .filter(([, childDigest]) => childDigest !== null);
    if (children.length === 0 && !isRoot) return null;
    const digest = crypto.createHash('sha256').update('directory\0');
    for (const [name, childDigest] of children) {
      digest.update(name).update('\0').update(childDigest).update('\0');
    }
    return digest.digest('hex');
  };
  return hashNode(target, true);
}

function rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, targetOverride = null, sourceRoot = ROOT) {
  const codex = path.join(scratch, '.codex');
  const receiptPath = path.join(codex, '.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const relative = `agents/${agentName}`;
  const source = path.join(sourceRoot, 'codex', 'agents', agentName);
  const destination = path.join(codex, relative);
  const linkTarget = targetOverride || source;

  fs.rmSync(destination, { force: true });
  fs.symlinkSync(linkTarget, destination);
  receipt.managed_entries.agents[agentName] = {
    ...receipt.managed_entries.agents[agentName],
    mode: 'symlink',
    ownership_marker: `symlink:${relative}`,
    destination_target: source,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, source, destination, relative };
}

function materializeFixtureSkill(fakePlugin, name) {
  const skillSource = path.join(fakePlugin, 'codex', 'skills', name);
  if (!fs.lstatSync(skillSource).isSymbolicLink()) {
    return;
  }
  const resolvedSource = fs.realpathSync(skillSource);
  fs.rmSync(skillSource, { recursive: true, force: true });
  fs.cpSync(resolvedSource, skillSource, { recursive: true, dereference: true });
}

function runtimeSupportSkillNames() {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const ids = new Set((inventory.internal_runtime_skills && inventory.internal_runtime_skills['codex-native']) || []);
  return (inventory.skills || [])
    .filter((skill) => skill && ids.has(skill.id) && typeof skill.name === 'string')
    .map((skill) => skill.name)
    .sort();
}

function firstRuntimeSupportSkillName() {
  const names = runtimeSupportSkillNames();
  if (names.length === 0) throw new Error('expected Codex native runtime-support skills in inventory');
  return names[0];
}

function nativeManagedSkillNames(scratch) {
  const receipt = JSON.parse(fs.readFileSync(path.join(scratch, '.codex', '.dhpk-installed.json'), 'utf8'));
  return Object.keys((receipt.managed_entries && receipt.managed_entries.skills) || {}).sort();
}

function firstNativeManagedSkill(scratch) {
  const names = nativeManagedSkillNames(scratch);
  assert.ok(names.length > 0, 'expected native runtime-support skills in the Codex receipt');
  return names[0];
}

function collisionFixture(envOverrides = {}) {
  const scratch = projectRoot();
  const fakePlugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-plan-plugin-')));
  // Keep only the collision target and sibling skills used by planning cases.
  const collisionSkills = ['code-trace', 'tdd-workflow', 'flow-guide'];
  const fakeCodexSkills = path.join(fakePlugin, 'codex', 'skills');
  fs.mkdirSync(fakeCodexSkills, { recursive: true });
  for (const name of collisionSkills) {
    const skillDir = path.join(fakeCodexSkills, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Synthetic collision fixture.\n---\n\nFixture skill.\n`);
  }
  fs.mkdirSync(path.join(fakePlugin, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), path.join(fakePlugin, '.claude-plugin', 'plugin.json'));
  fs.mkdirSync(path.join(fakePlugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(fakePlugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
  const skillMetadata = collisionSkills.map((name) => ({
    id: name === 'tdd-workflow' ? 'tdd' : name,
    name,
    path: `skills/${name}`,
    legacy_names: [],
    lifecycle: 'promoted',
    invokable: true,
    profiles: [],
    surfaces: ['codex-native', 'codex-sync'],
  }));
  fs.mkdirSync(path.join(fakePlugin, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(fakePlugin, 'manifests', 'distribution-inventory.json'), JSON.stringify({
    skills: skillMetadata,
    supporting_assets: [],
  }, null, 2));
  const first = runInstaller(scratch, ['--copy', '--force'], fakePlugin, envOverrides);
  assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const collision = 'code-trace';
  const receiptPath = path.join(scratch, '.codex', '.dhpk-installed.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.ok(receipt.managed_entries.skills[collision], `expected fixture receipt entry for ${collision}`);
  delete receipt.managed_entries.skills[collision];
  receipt.reconciliation = {
    ...(receipt.reconciliation || {}),
    state: 'partial',
    status: 'partial',
    complete: false,
    skipped_collision: 1,
  };
  receipt.state = 'partial';
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const target = path.join(scratch, '.codex', 'skills', collision);
  fs.writeFileSync(path.join(target, 'user-owned.txt'), 'keep me\n');
  return { scratch, fakePlugin, collision, receiptPath, target };
}

function transactionMetadataSnapshot(codexRoot) {
  return fs.readdirSync(codexRoot)
    .filter((name) => name.startsWith('.dhpk-transaction-'))
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(codexRoot, name), 'utf8')]);
}

function provenanceDriftPlanFixture(drift, pluginRoot = ROOT) {
  const scratch = projectRoot();
  const first = runInstaller(scratch, ['--force'], pluginRoot);
  assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const codexRoot = path.join(scratch, '.codex');
  const receiptPath = path.join(codexRoot, '.dhpk-installed.json');
  const currentReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.strictEqual(currentReceipt.mode, 'symlink', 'fixture must reproduce the default projection mode');
  assert.strictEqual(currentReceipt.reconciliation.state, 'current',
    'fixture requires a historical current reconciliation state');
  const currentProvenance = {
    pluginVersion: currentReceipt.plugin_version,
    sourceFingerprint: currentReceipt.source_fingerprint,
  };
  const receipt = {
    ...currentReceipt,
    plugin_version: drift === 'version' || drift === 'both'
      ? '0.0.0-provenance-drift'
      : currentReceipt.plugin_version,
    source_fingerprint: drift === 'fingerprint' || drift === 'both'
      ? '0'.repeat(64)
      : currentReceipt.source_fingerprint,
  };
  const recordedProvenance = {
    pluginVersion: receipt.plugin_version,
    sourceFingerprint: receipt.source_fingerprint,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const before = {
    receipt: fs.readFileSync(receiptPath, 'utf8'),
    projection: completeTreeFingerprint(codexRoot),
    transactionMetadata: transactionMetadataSnapshot(codexRoot),
  };
  const planned = runInstaller(scratch, [
    '--migrate', '--update', '--plan', '--json', '--force',
  ], pluginRoot);
  return {
    scratch,
    codexRoot,
    receiptPath,
    before,
    currentProvenance,
    recordedProvenance,
    planned,
  };
}

module.exports = {
  ROOT,
  HOOK,
  CODEX_STUB_BIN,
  INSTALLER_CHILD_TIMEOUT_MS,
  runInstaller,
  projectRoot,
  copyDistributionInventory,
  completeTreeFingerprint,
  LEGACY_RECIPE_DIGESTS,
  snapshotTree,
  rewriteAgentAsHistoricalManagedSymlink,
  materializeFixtureSkill,
  runtimeSupportSkillNames,
  firstRuntimeSupportSkillName,
  nativeManagedSkillNames,
  firstNativeManagedSkill,
  collisionFixture,
  transactionMetadataSnapshot,
  provenanceDriftPlanFixture,
};
