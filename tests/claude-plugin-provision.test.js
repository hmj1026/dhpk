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

function tempDir(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dhpk-claude-provision-${label}-`)));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// Builds a plugin root shaped like generated/claude-marketplace/package:
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
  const projectRoot = tempDir('probe-project');
  const root = tempDir('probe-root');
  try {
    buildPluginRoot(root);
    const result = provision.probeClaudePluginProvision({
      projectRoot,
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
  const projectRoot = tempDir('disagree-project');
  const installPath = tempDir('disagree-install');
  const folder = tempDir('disagree-folder');
  try {
    buildPluginRoot(installPath);
    buildPluginRoot(folder, { skills: [{ stableId: 'tdd', name: 'tdd-workflow' }] });
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      spawn: fakeSpawn([record({ installPath, readFromFolder: folder, folderVersion: '1.0.0' })]),
    });
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'PLUGIN_ROOTS_DISAGREE');
  } finally {
    for (const dir of [projectRoot, installPath, folder]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('testProbe_enoent_returnsCliNotInstalled', () => {
  const projectRoot = tempDir('enoent');
  try {
    const thrown = provision.probeClaudePluginProvision({
      projectRoot,
      spawn: () => { const error = new Error('spawn claude ENOENT'); error.code = 'ENOENT'; throw error; },
    });
    assert.strictEqual(thrown.status, 'CLI_NOT_INSTALLED');
    const returned = provision.probeClaudePluginProvision({
      projectRoot,
      spawn: fakeSpawn('', { error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }),
    });
    assert.strictEqual(returned.status, 'CLI_NOT_INSTALLED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_nonZeroExit_returnsUnknown', () => {
  const projectRoot = tempDir('nonzero');
  try {
    const result = provision.probeClaudePluginProvision({ projectRoot, spawn: fakeSpawn('', { status: 2 }) });
    assert.strictEqual(result.status, 'UNKNOWN');
    const garbage = provision.probeClaudePluginProvision({ projectRoot, spawn: fakeSpawn('not json') });
    assert.strictEqual(garbage.status, 'UNKNOWN');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_timeout_returnsUnknown', () => {
  const projectRoot = tempDir('timeout');
  try {
    const result = provision.probeClaudePluginProvision({
      projectRoot,
      spawn: fakeSpawn('', { error: Object.assign(new Error('spawnSync claude ETIMEDOUT'), { code: 'ETIMEDOUT' }) }),
    });
    assert.strictEqual(result.status, 'UNKNOWN');
    assert.strictEqual(result.reason, 'CLAUDE_CLI_FAILED');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_runsWithProjectRootCwd', () => {
  const projectRoot = tempDir('cwd');
  const seen = [];
  try {
    provision.probeClaudePluginProvision({ projectRoot, spawn: fakeSpawn([], { seen }) });
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].command, 'claude');
    assert.deepStrictEqual(seen[0].args, ['plugin', 'list', '--json']);
    assert.strictEqual(seen[0].options.cwd, fs.realpathSync(projectRoot));
    assert.ok(seen[0].options.timeout > 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('testProbe_missingProjectRoot_returnsUnknown', () => {
  const seen = [];
  const result = provision.probeClaudePluginProvision({
    projectRoot: path.join(os.tmpdir(), 'dhpk-claude-provision-does-not-exist'),
    spawn: fakeSpawn([], { seen }),
  });
  assert.strictEqual(result.status, 'UNKNOWN');
  assert.strictEqual(result.reason, 'PROJECT_ROOT_MISSING');
  assert.strictEqual(seen.length, 0);
});

test('testProbe_absentPlugin_returnsAbsent', () => {
  const projectRoot = tempDir('absent');
  try {
    const result = provision.probeClaudePluginProvision({ projectRoot, spawn: fakeSpawn([]) });
    assert.strictEqual(result.status, 'ABSENT');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ---- override ----

test('testOverride_inactive_skipsSpawn', () => {
  const projectRoot = tempDir('override');
  const seen = [];
  try {
    const result = provision.resolveClaudePluginProvision({ projectRoot, override: 'inactive', spawn: fakeSpawn([], { seen }) });
    assert.strictEqual(result.status, 'INACTIVE');
    assert.strictEqual(result.source, 'override');
    assert.strictEqual(seen.length, 0);
    const auto = provision.resolveClaudePluginProvision({ projectRoot, override: 'auto', spawn: fakeSpawn([], { seen }) });
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

run('claude-plugin-provision');
