'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const provision = require('../scripts/lib/claude-plugin-provision');

const PLUGIN_ID = 'dhpk@dhpk';

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const createdTempDirs = [];
// Every temp directory this file creates is removed when the process exits, so
// the runner's TMPDIR leak check sees nothing left behind.
process.on('exit', () => {
  for (const dir of createdTempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-claude-provision-${label}-`)));
  createdTempDirs.push(dir);
  return dir;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// Builds a plugin root shaped like dist/claude-marketplace/package:
// .claude-plugin/plugin.json, provenance.json (catalog v1) and skills/<name>/SKILL.md.
function buildPluginRoot(root, {
  version = '1.0.0',
  skills = [{ stableId: 'tdd', name: 'tdd-workflow' }, { stableId: 'flow-guide', name: 'flow-guide' }],
  manifest = {},
  skipProvenance = false,
  hostOnlyIds = [],
} = {}) {
  write(path.join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'dhpk', version, ...manifest })}\n`);
  const files = [];
  for (const skill of skills) {
    const body = Buffer.from(`---\nname: ${skill.name}\ndescription: fixture\n---\n`);
    write(path.join(root, 'skills', skill.name, 'SKILL.md'), body);
    files.push({
      skillId: skill.stableId,
      ownerId: skill.stableId,
      sourcePath: `skills/${skill.name}/SKILL.md`,
      destination: `skills/${skill.name}/SKILL.md`,
      kind: 'entry',
      sha256: sha(body),
    });
  }
  const catalog = {
    schema: 'dhpk.claude-marketplace-catalog.v1',
    selectionDigest: 'fixture',
    publicEntryIds: skills.map((skill) => skill.stableId).filter((id) => !hostOnlyIds.includes(id)),
    hostOnlyIds,
    files,
  };
  if (!skipProvenance) write(path.join(root, 'provenance.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

function record(overrides = {}) {
  return {
    id: PLUGIN_ID,
    version: '1.0.0',
    scope: 'user',
    enabled: true,
    installPath: '/nonexistent/install',
    ...overrides,
  };
}

// An absolute PATH entry that holds an executable `claude`, outside any project root.
function claudeOnPath() {
  const dir = tempDir('claude-bin');
  const file = path.join(dir, 'claude');
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(file, 0o755);
  return { dir, file: fs.realpathSync(file), env: { PATH: dir } };
}

function fakeSpawn(stdout, { status = 0, error = null, seen = null } = {}) {
  return (command, args, options) => {
    if (seen) seen.push({ command, args, options });
    if (error) return { error, status: null, pid: undefined };
    return { status, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' };
  };
}

// ---- classifyClaudePluginRecords ----

test('testClassify_noDhpkRecord_returnsAbsent', () => {
  const result = provision.classifyClaudePluginRecords([{ id: 'other@x', enabled: true, scope: 'user' }], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'ABSENT');
  assert.deepStrictEqual(provision.classifyClaudePluginRecords([], { projectRoot: '/p' }).status, 'ABSENT');
});

test('testClassify_projectScopeOtherProjectOnly_returnsNotApplicable', () => {
  const result = provision.classifyClaudePluginRecords([
    record({ scope: 'project', projectPath: '/somewhere/else', enabled: true }),
  ], { projectRoot: '/work/mine' });
  assert.strictEqual(result.status, 'NOT_APPLICABLE');
});

test('testClassify_projectScopeInsideProjectRoot_isApplicable', () => {
  const projectRoot = tempDir('inside');
  try {
    const result = provision.classifyClaudePluginRecords([
      record({ scope: 'project', projectPath: projectRoot, enabled: true }),
    ], { projectRoot: path.join(projectRoot, 'sub') });
    // projectRoot below the recorded projectPath is inside it; the reverse is not required.
    assert.ok(['ENABLED', 'NOT_APPLICABLE'].includes(result.status));
    const same = provision.classifyClaudePluginRecords([
      record({ scope: 'project', projectPath: projectRoot, enabled: true }),
    ], { projectRoot });
    assert.strictEqual(same.status, 'ENABLED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testClassify_userEnabled_returnsEnabledCandidate', () => {
  const result = provision.classifyClaudePluginRecords([record()], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'ENABLED');
  assert.strictEqual(result.records.length, 1);
  assert.strictEqual(result.records[0].installPath, '/nonexistent/install');
});

test('testClassify_allApplicableDisabled_returnsDisabled', () => {
  const result = provision.classifyClaudePluginRecords([
    record({ enabled: false }),
    record({ scope: 'managed', enabled: false }),
  ], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'DISABLED');
});

test('testClassify_enabledConflictAcrossRecords_returnsUnknown', () => {
  const result = provision.classifyClaudePluginRecords([
    record({ enabled: true }),
    record({ scope: 'managed', enabled: false }),
  ], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.ok(result.reason);
});

test('testClassify_nonBooleanEnabled_outranksEnabledMatch_returnsUnknown', () => {
  const result = provision.classifyClaudePluginRecords([
    record({ enabled: true }),
    record({ scope: 'managed', enabled: 'yes' }),
  ], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'UNKNOWN');
});

test('testClassify_unknownScope_returnsUnknown', () => {
  const result = provision.classifyClaudePluginRecords([record({ scope: 'galaxy' })], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'UNKNOWN');
});

test('testClassify_loadErrors_returnsUnknown', () => {
  const result = provision.classifyClaudePluginRecords([record({ errors: ['failed to load skills'] })], { projectRoot: '/p' });
  assert.strictEqual(result.status, 'UNKNOWN');
});

test('testClassify_nonArrayPayload_returnsUnknown', () => {
  for (const payload of [null, {}, 'x', 7]) {
    assert.strictEqual(provision.classifyClaudePluginRecords(payload, { projectRoot: '/p' }).status, 'UNKNOWN');
  }
});

// ---- readClaudePluginCatalog ----

test('testCatalog_validPackage_returnsStableIdsNotNames', () => {
  const root = tempDir('valid');
  try {
    buildPluginRoot(root);
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.deepStrictEqual(result.providedIdentities, [
      { stableId: 'flow-guide', name: 'flow-guide' },
      { stableId: 'tdd', name: 'tdd-workflow' },
    ]);
    assert.strictEqual(result.pluginVersion, '1.0.0');
    assert.match(result.catalogDigest, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.catalogDigest, sha(fs.readFileSync(path.join(root, 'provenance.json'))));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testCatalog_missingProvenance_returnsCatalogMissing', () => {
  const root = tempDir('missing');
  try {
    buildPluginRoot(root, { skipProvenance: true });
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'CATALOG_MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testCatalog_skillHashMismatch_returnsUnknown', () => {
  const root = tempDir('hash');
  try {
    buildPluginRoot(root);
    fs.appendFileSync(path.join(root, 'skills', 'tdd-workflow', 'SKILL.md'), 'tampered\n');
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'CATALOG_HASH_MISMATCH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testCatalog_extraPhysicalSkillDir_returnsDrift', () => {
  const root = tempDir('drift');
  try {
    buildPluginRoot(root);
    write(path.join(root, 'skills', 'surprise', 'SKILL.md'), '---\nname: surprise\n---\n');
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'CATALOG_DRIFT');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testCatalog_manifestSkillsField_returnsUnknown', () => {
  const root = tempDir('skillsfield');
  try {
    buildPluginRoot(root, { manifest: { skills: ['./other'] } });
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'PLUGIN_MANIFEST_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testCatalog_symlinkedProvenance_rejected', () => {
  const root = tempDir('symlink');
  const elsewhere = tempDir('symlink-target');
  try {
    buildPluginRoot(root);
    const real = path.join(elsewhere, 'provenance.json');
    fs.copyFileSync(path.join(root, 'provenance.json'), real);
    fs.rmSync(path.join(root, 'provenance.json'));
    fs.symlinkSync(real, path.join(root, 'provenance.json'));
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '1.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'UNSAFE_PATH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('testCatalog_versionMismatch_returnsUnknown', () => {
  const root = tempDir('version');
  try {
    buildPluginRoot(root, { version: '1.0.0' });
    const result = provision.readClaudePluginCatalog(root, { expectedVersion: '2.0.0' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'VERSION_MISMATCH');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- probeClaudePluginProvision ----

test('testProbe_enabledWithCatalog_returnsProvidedIdentitiesAndDigest', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('probe-project');
  const root = tempDir('probe-root');
  try {
    buildPluginRoot(root);
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: fakeSpawn([record({ installPath: root })]),
    });
    assert.strictEqual(result.status, 'ENABLED', JSON.stringify(result));
    assert.strictEqual(result.schema, 'dhpk.claude-plugin-provision.v1');
    assert.strictEqual(result.pluginId, PLUGIN_ID);
    assert.strictEqual(result.pluginVersion, '1.0.0');
    assert.deepStrictEqual(result.providedIdentities.map((entry) => entry.stableId), ['flow-guide', 'tdd']);
    assert.match(result.catalogDigest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('testProbe_readFromFolderAndInstallPathDisagree_returnsUnknown', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('disagree-project');
  const installPath = tempDir('disagree-install');
  const folder = tempDir('disagree-folder');
  try {
    buildPluginRoot(installPath);
    buildPluginRoot(folder, { skills: [{ stableId: 'tdd', name: 'tdd-workflow' }] });
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: fakeSpawn([record({ installPath, readFromFolder: folder, folderVersion: '1.0.0' })]),
    });
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'PLUGIN_ROOTS_DISAGREE');
  } finally {
    for (const dir of [projectRoot, installPath, folder]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('testProbe_enoent_returnsCliNotInstalled', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('enoent');
  try {
    const thrown = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: () => { const error = new Error('spawn claude ENOENT'); error.code = 'ENOENT'; throw error; },
    });
    assert.strictEqual(thrown.status, 'CLI_NOT_INSTALLED');
    const returned = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: fakeSpawn('', { error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }),
    });
    assert.strictEqual(returned.status, 'CLI_NOT_INSTALLED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_nonZeroExit_returnsUnknown', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('nonzero');
  try {
    const result = provision.probeClaudePluginProvision({ projectRoot, env: bin.env, spawn: fakeSpawn('', { status: 2 }) });
    assert.strictEqual(result.status, 'UNKNOWN');
    const garbage = provision.probeClaudePluginProvision({ projectRoot, env: bin.env, spawn: fakeSpawn('not json') });
    assert.strictEqual(garbage.status, 'UNKNOWN');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_timeout_returnsUnknown', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('timeout');
  try {
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: fakeSpawn('', { error: Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' }) }),
    });
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'CLAUDE_CLI_FAILED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_runsWithProjectRootCwd', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('cwd');
  const seen = [];
  try {
    provision.probeClaudePluginProvision({ projectRoot, env: bin.env, spawn: fakeSpawn([], { seen }) });
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].command, bin.file);
    assert.deepStrictEqual(seen[0].args, ['plugin', 'list', '--json']);
    assert.strictEqual(seen[0].options.cwd, fs.realpathSync(projectRoot));
    assert.ok(seen[0].options.timeout > 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_missingProjectRoot_returnsUnknown', () => {
  const bin = claudeOnPath();
  const seen = [];
  const result = provision.probeClaudePluginProvision({
    env: bin.env,
    projectRoot: path.join(os.tmpdir(), 'dhpk-claude-provision-does-not-exist'),
    spawn: fakeSpawn([], { seen }),
  });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'PROJECT_ROOT_MISSING');
  assert.strictEqual(seen.length, 0);
});

test('testProbe_absentPlugin_returnsAbsent', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('absent');
  try {
    const result = provision.probeClaudePluginProvision({ projectRoot, env: bin.env, spawn: fakeSpawn([]) });
    assert.strictEqual(result.status, 'ABSENT');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---- override ----

test('testOverride_inactive_skipsSpawn', () => {
  const bin = claudeOnPath();
  const projectRoot = tempDir('override');
  const seen = [];
  try {
    const result = provision.resolveClaudePluginProvision({ projectRoot, env: bin.env, override: 'inactive', spawn: fakeSpawn([], { seen }) });
    assert.strictEqual(result.status, 'INACTIVE');
    assert.strictEqual(result.source, 'override');
    assert.strictEqual(seen.length, 0);
    const auto = provision.resolveClaudePluginProvision({ projectRoot, env: bin.env, override: 'auto', spawn: fakeSpawn([], { seen }) });
    assert.strictEqual(auto.status, 'ABSENT');
    assert.strictEqual(seen.length, 1);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testOverride_invalidValue_throws', () => {
  assert.strictEqual(provision.normalizeClaudePluginStateOverride('auto'), 'auto');
  assert.strictEqual(provision.normalizeClaudePluginStateOverride('inactive'), 'inactive');
  assert.throws(() => provision.normalizeClaudePluginStateOverride('enabled'), /--claude-plugin-state/);
  assert.throws(() => provision.normalizeClaudePluginStateOverride(undefined), /--claude-plugin-state/);
});

// ---- S1: the CLI is resolved to an absolute path outside the project ----

function plantClaude(directory, marker) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'claude');
  fs.writeFileSync(file, `#!/bin/sh\ntouch '${marker}'\necho '[]'\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('testProbe_plantedClaudeInProjectRootWithTrailingColonPath_notExecuted', () => {
  const projectRoot = tempDir('planted-project');
  const emptyBin = tempDir('planted-emptybin');
  const marker = path.join(tempDir('planted-marker'), 'ran');
  try {
    plantClaude(projectRoot, marker);
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: { PATH: `${emptyBin}${path.delimiter}` },
    });
    assert.strictEqual(fs.existsSync(marker), false, 'a claude planted in the project root must never run');
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'CLAUDE_CLI_INSIDE_PROJECT');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(emptyBin, { recursive: true, force: true });
    fs.rmSync(path.dirname(marker), { recursive: true, force: true });
  }
});

test('testProbe_relativePathEntry_skipped', () => {
  const projectRoot = tempDir('relative-project');
  const workDir = tempDir('relative-cwd');
  const seen = [];
  const previousCwd = process.cwd();
  try {
    plantClaude(path.join(workDir, 'bin'), path.join(workDir, 'ran'));
    process.chdir(workDir);
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: { PATH: 'bin' },
      spawn: fakeSpawn([], { seen }),
    });
    assert.strictEqual(result.status, 'CLI_NOT_INSTALLED');
    assert.strictEqual(seen.length, 0);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('testProbe_claudeResolvedInsideProjectRoot_rejected', () => {
  const projectRoot = tempDir('inside-project');
  const outside = tempDir('inside-outside');
  const seen = [];
  try {
    plantClaude(path.join(projectRoot, 'bin'), path.join(projectRoot, 'ran'));
    const direct = provision.probeClaudePluginProvision({
      projectRoot,
      env: { PATH: path.join(projectRoot, 'bin') },
      spawn: fakeSpawn([], { seen }),
    });
    assert.strictEqual(direct.status, 'UNKNOWN');
    assert.strictEqual(direct.reason, 'CLAUDE_CLI_INSIDE_PROJECT');
    // A symlink in a trusted directory that resolves into the project is rejected too.
    fs.symlinkSync(path.join(projectRoot, 'bin', 'claude'), path.join(outside, 'claude'));
    const linked = provision.probeClaudePluginProvision({
      projectRoot,
      env: { PATH: outside },
      spawn: fakeSpawn([], { seen }),
    });
    assert.strictEqual(linked.status, 'UNKNOWN');
    assert.strictEqual(linked.reason, 'CLAUDE_CLI_INSIDE_PROJECT');
    assert.strictEqual(seen.length, 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('testProbe_nonExecutableClaude_skippedForLaterEntry', () => {
  const projectRoot = tempDir('nonexec-project');
  const first = tempDir('nonexec-first');
  const bin = claudeOnPath();
  const seen = [];
  try {
    fs.writeFileSync(path.join(first, 'claude'), 'not executable\n');
    fs.chmodSync(path.join(first, 'claude'), 0o644);
    provision.probeClaudePluginProvision({
      projectRoot,
      env: { PATH: `${first}${path.delimiter}${bin.dir}` },
      spawn: fakeSpawn([], { seen }),
    });
    assert.strictEqual(seen[0].command, bin.file);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(first, { recursive: true, force: true });
  }
});

// ---- S2: the detached process group is reaped on every path ----

test('testProbe_processGroupReapedAfterSuccess_toleratesEsrch', () => {
  const projectRoot = tempDir('reap-ok');
  const bin = claudeOnPath();
  const killed = [];
  try {
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: (command, args, options) => ({ status: 0, stdout: '[]', stderr: '', pid: 4242 }),
      terminate: (pid, signal) => { killed.push([pid, signal]); return false; },
    });
    assert.strictEqual(result.status, 'ABSENT');
    assert.deepStrictEqual(killed, [[4242, 'SIGKILL']]);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_processGroupKillEperm_returnsUnknownInsteadOfThrowing', () => {
  const projectRoot = tempDir('reap-eperm');
  const bin = claudeOnPath();
  try {
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      env: bin.env,
      spawn: () => ({ status: 0, stdout: '[]', stderr: '', pid: 4242 }),
      terminate: () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); },
    });
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'CLAUDE_CLI_FAILED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---- R2: roots agree on identities and version; the digest may differ ----

function twoRootProbe({ installOptions = {}, folderOptions = {}, mutateFolderCatalog = null }) {
  const projectRoot = tempDir('roots-project');
  const installPath = tempDir('roots-install');
  const folder = tempDir('roots-folder');
  const bin = claudeOnPath();
  buildPluginRoot(installPath, installOptions);
  buildPluginRoot(folder, folderOptions);
  if (mutateFolderCatalog) {
    const catalog = JSON.parse(fs.readFileSync(path.join(folder, 'provenance.json'), 'utf8'));
    mutateFolderCatalog(catalog);
    fs.writeFileSync(path.join(folder, 'provenance.json'), `${JSON.stringify(catalog)}\n`);
  }
  const folderVersion = folderOptions.version || '1.0.0';
  const result = provision.probeClaudePluginProvision({
    projectRoot,
    env: bin.env,
    spawn: fakeSpawn([record({ installPath, readFromFolder: folder, folderVersion })]),
  });
  return { result, folder };
}

test('testProbe_digestOnlyDifferenceBetweenRoots_returnsEnabledWithReadFromFolderDigest', () => {
  const { result, folder } = twoRootProbe({ mutateFolderCatalog: (catalog) => { catalog.selectionDigest = 'different'; } });
  assert.strictEqual(result.status, 'ENABLED', JSON.stringify(result));
  assert.strictEqual(result.catalogDigest, sha(fs.readFileSync(path.join(folder, 'provenance.json'))));
  assert.strictEqual(result.pluginVersion, '1.0.0');
});

test('testProbe_identitySetDifferenceBetweenRoots_returnsUnknown', () => {
  const { result } = twoRootProbe({ folderOptions: { skills: [{ stableId: 'tdd', name: 'tdd-workflow' }] } });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'PLUGIN_ROOTS_DISAGREE');
});

test('testProbe_versionDifferenceBetweenRoots_returnsUnknown', () => {
  const { result } = twoRootProbe({ folderOptions: { version: '1.0.1' } });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'PLUGIN_ROOTS_DISAGREE');
});

// ---- R3: a CLI found inside the project root is not "not installed" ----

test('testProbe_cliInsideAncestorProjectRoot_returnsUnknown', () => {
  const home = tempDir('ancestor-home');
  const projectRoot = path.join(home, 'work');
  fs.mkdirSync(projectRoot);
  const seen = [];
  // The project root is an ancestor of the CLI, as when the project root is $HOME.
  const marker = path.join(home, 'ran');
  plantClaude(path.join(home, 'bin'), marker);
  // The project root is the directory that contains the CLI.
  const result = provision.probeClaudePluginProvision({
    projectRoot: home,
    env: { PATH: path.join(home, 'bin') },
    spawn: fakeSpawn([], { seen }),
  });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'CLAUDE_CLI_INSIDE_PROJECT');
  assert.strictEqual(seen.length, 0);
});

test('testProbe_cliInsideProjectButLaterPathEntryOutside_usesOutside', () => {
  const projectRoot = tempDir('later-project');
  const bin = claudeOnPath();
  const seen = [];
  plantClaude(path.join(projectRoot, 'bin'), path.join(projectRoot, 'ran'));
  const result = provision.probeClaudePluginProvision({
    projectRoot,
    env: { PATH: `${path.join(projectRoot, 'bin')}${path.delimiter}${bin.dir}` },
    spawn: fakeSpawn([], { seen }),
  });
  assert.strictEqual(result.status, 'ABSENT');
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].command, bin.file);
});

test('testProbe_noClaudeAnywhere_stillReturnsCliNotInstalled', () => {
  const projectRoot = tempDir('nowhere-project');
  const empty = tempDir('nowhere-empty');
  const result = provision.probeClaudePluginProvision({ projectRoot, env: { PATH: empty }, spawn: fakeSpawn([]) });
  assert.strictEqual(result.status, 'CLI_NOT_INSTALLED');
});

test('testProbe_realClaudeExit124_keepsInnerExitCodeTimeoutAndRedactedStderr', () => {
  const projectRoot = tempDir('real-124-project');
  const binDir = tempDir('real-124-bin');
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\necho "plugin list deadline token=sk-ant-abcdefghijklmnopqrstuvwxyz0123456789" >&2\nexit 124\n', { mode: 0o755 });
  const result = provision.probeClaudePluginProvision({ projectRoot, env: { PATH: binDir } });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'CLAUDE_CLI_FAILED');
  assert.strictEqual(result.probe.exitCode, 124, JSON.stringify(result));
  assert.strictEqual(result.probe.timedOut, true);
  assert.ok(Number.isInteger(result.probe.durationMs));
  assert.match(result.probe.stderrTail, /plugin list deadline/);
  assert.doesNotMatch(result.probe.stderrTail, /sk-ant-abcdefghijklmnopqrstuvwxyz0123456789/);
});

test('testProbe_realClaudeHang_timesOutWithPartialStderr', () => {
  const projectRoot = tempDir('real-hang-project');
  const binDir = tempDir('real-hang-bin');
  fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\necho "contacting marketplace" >&2\n/bin/sleep 30\n', { mode: 0o755 });
  const result = provision.probeClaudePluginProvision({ projectRoot, env: { PATH: binDir }, timeoutMs: 300 });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.probe.timedOut, true, JSON.stringify(result));
  assert.strictEqual(result.probe.exitCode, null);
  assert.strictEqual(result.probe.signal, 'SIGKILL');
  assert.match(result.probe.stderrTail, /contacting marketplace/);
});

run('claude-plugin-provision');
