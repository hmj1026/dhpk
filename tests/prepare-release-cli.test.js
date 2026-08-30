'use strict';

// CLI-level coverage for scripts/release/prepare-release.js:
//   - SemVer validation
//   - branch guard (refuses on main; the develop -> main PR IS the release
//     candidate per RELEASE.md, so preparation must run from develop)
//   - check mode: non-mutating, reports drift
//   - write mode: deterministic manifest + changelog updates, full changed-file report

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'prepare-release.js');

function fileFingerprint(file) {
  return `file:${require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function mkRepo({ branch = 'develop' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-prepare-release-')));
  for (const rel of ['.claude-plugin', '.codex-plugin', 'plugins/dhpk/.codex-plugin', '.agents/plugins', 'changelog.d', 'manifests', 'skills/dhpk-tdd-workflow', 'skills/dhpk-sample', 'agents', 'rules']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'plugins/dhpk/.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, '.agents/plugins', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'dhpk', version: '1.0.0' }] }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-01-01 — Prior\n\nPrior notes.\n');
  fs.writeFileSync(path.join(root, 'skills/dhpk-tdd-workflow', 'SKILL.md'), '---\nname: dhpk-tdd-workflow\n---\n');
  fs.writeFileSync(path.join(root, 'agents', 'sample.md'), [
    '---',
    'name: sample',
    'description: Sample agent',
    'tools: Read, Bash',
    'model: sonnet',
    'color: blue',
    '---',
    '',
    '# Sample',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'rules', 'sample.md'), '# Rule\n');
  fs.writeFileSync(path.join(root, 'skills', 'dhpk-sample', 'SKILL.md'), [
    '---',
    'name: dhpk-sample',
    'description: Sample skill',
    '---',
    '',
    '# Skill',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(root, 'manifests', 'distribution-inventory.json'),
    JSON.stringify({
      skills: [
        { id: 'tdd', name: 'dhpk-tdd-workflow', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] },
        { id: 'sample', path: 'skills/dhpk-sample', surfaces: ['agy-plugin'] },
      ],
      surface_membership: { 'agy-plugin': ['sample'] },
      agy_plugin: { agents: ['sample.md'], rules: ['rules/sample.md'] },
    })
  );
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const agyPin = 'bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=1.0.0 --json\n';
  fs.writeFileSync(path.join(root, 'docs', 'platform-installation.md'), agyPin);
  fs.writeFileSync(path.join(root, 'docs', 'platform-installation.zh-TW.md'), agyPin);

  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: root });
  return root;
}

function runCli(repo, args, extraEnv = {}) {
  return spawnSync('node', [CLI, '--repo-root', repo, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

test('rejects a non-semver version before touching anything', () => {
  const repo = mkRepo();
  const res = runCli(repo, ['check', '--version', '1.2']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /semver/i);
});

test('refuses to prepare a release on main', () => {
  const repo = mkRepo({ branch: 'main' });
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget'], { DHPK_RELEASE_TARGET_BRANCH: 'main' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /develop/i);
});

test('allows read-only parity checks on the merged publish target', () => {
  const repo = mkRepo({ branch: 'main' });
  for (const [relative, data] of [
    ['plugins/dhpk/provenance.json', { sourceVersion: '1.0.0' }],
    ['plugins/dhpk-agent/plugin.json', { version: '1.0.0' }],
    ['plugins/dhpk-agent/provenance.json', { sourceVersion: '1.0.0' }],
    ['plugins/dhpk-agy/plugin.json', { version: '1.0.0' }],
    ['plugins/dhpk-agy/provenance.json', { sourceVersion: '1.0.0' }],
    ['plugins/dhpk-cursor/.cursor-plugin/plugin.json', { version: '1.0.0' }],
    ['plugins/dhpk-cursor/provenance.json', { sourceVersion: '1.0.0' }],
  ]) {
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(data)}\n`);
  }
  const res = runCli(repo, ['check', '--version', '1.0.0'], { DHPK_RELEASE_TARGET_BRANCH: 'main' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /check PASS/);
});

test('check mode reports drift without modifying files', () => {
  const repo = mkRepo();
  const before = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  const res = runCli(repo, ['check', '--version', '1.1.0']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /1\.1\.0/);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), before);
});

test('write mode updates every manifest, promotes fragments, and reports the full changed-file list', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');

  const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.strictEqual(res.status, 0, res.stderr);

  for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json']) {
    assert.match(res.stdout, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `expected changed-file report to list ${rel}`);
  }
  assert.match(res.stdout, /regenerated codex-native package/);
  assert.match(res.stdout, /CHANGELOG\.md/);

  const claudeManifest = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(claudeManifest.version, '1.1.0');
  const marketplace = JSON.parse(fs.readFileSync(path.join(repo, '.agents/plugins', 'marketplace.json'), 'utf8'));
  assert.strictEqual(marketplace.plugins[0].version, '1.1.0');

  // The codex-native package is regenerated wholesale, not field-patched.
  const nativeManifest = JSON.parse(fs.readFileSync(path.join(repo, 'plugins/dhpk/.codex-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(nativeManifest.version, '1.1.0');
  assert.strictEqual(nativeManifest.skills, './skills/');
  const provenance = JSON.parse(fs.readFileSync(path.join(repo, 'plugins/dhpk', 'provenance.json'), 'utf8'));
  assert.strictEqual(provenance.sourceVersion, '1.1.0');
  assert.deepStrictEqual(provenance.selectedSkillIds, ['tdd']);
  assert.deepStrictEqual(provenance.selectedSkillNames, ['dhpk-tdd-workflow']);
  assert.ok(fs.existsSync(path.join(repo, 'plugins/dhpk/skills/dhpk-tdd-workflow/SKILL.md')));

  assert.match(res.stdout, /plugins\/dhpk-agy\/ \(regenerated .*AGY/i);
  assert.ok(fs.existsSync(path.join(repo, 'plugins/dhpk-agy', 'plugin.json')));
  const agyManifest = JSON.parse(fs.readFileSync(path.join(repo, 'plugins/dhpk-agy', 'plugin.json'), 'utf8'));
  assert.strictEqual(agyManifest.version, '1.1.0');
  assert.ok(fs.existsSync(path.join(repo, 'plugins/dhpk-agy', 'provenance.json')));
  const agyProvenance = JSON.parse(fs.readFileSync(path.join(repo, 'plugins/dhpk-agy', 'provenance.json'), 'utf8'));
  assert.strictEqual(agyProvenance.sourceVersion, '1.1.0');
  assert.ok(fs.existsSync(path.join(repo, 'plugins/dhpk-agy/agents/sample.md')));

  const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## 1.1.0 — 2026-07-27 — Add widget'));
  assert.ok(!fs.existsSync(path.join(repo, 'changelog.d', 'feat.widget.md')));

  const expectedPin = 'bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=1.1.0 --json';
  assert.match(res.stdout, /docs\/platform-installation\.md/);
  assert.match(res.stdout, /docs\/platform-installation\.zh-TW\.md/);
  assert.ok(fs.readFileSync(path.join(repo, 'docs', 'platform-installation.md'), 'utf8').includes(expectedPin));
  assert.ok(fs.readFileSync(path.join(repo, 'docs', 'platform-installation.zh-TW.md'), 'utf8').includes(expectedPin));
});

test('write mode retains a durable rollback manifest and rollback restores the prior release tree', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'release-test-1']);
    assert.strictEqual(write.status, 0, write.stderr);
    const backupRoot = path.join(repo, '.claude', 'artifacts', 'release-backups');
    const manifests = fs.readdirSync(backupRoot).filter((name) => name.endsWith('.json'));
    assert.strictEqual(manifests.length, 1, `expected one durable rollback manifest in ${backupRoot}`);
    const reference = path.join(backupRoot, manifests[0]);
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    assert.strictEqual(manifest.operationKey, 'release-test-1');
    assert.ok(manifest.entries.length > 0);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.1.0');

    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.strictEqual(rollback.status, 0, rollback.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0');
    assert.match(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), /## 1\.0\.0/);
    const rolledBack = JSON.parse(fs.readFileSync(reference, 'utf8'));
    assert.ok(rolledBack.rolledBackAt);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('rollback resumes safely after an earlier entry was already restored', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'resume-rollback']);
    assert.strictEqual(write.status, 0, write.stderr);
    const reference = path.join(repo, '.claude', 'artifacts', 'release-backups', 'resume-rollback.json');
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    const index = manifest.entries.findIndex((entry) => entry.target.endsWith(path.join('.claude-plugin', 'plugin.json')));
    assert.ok(index >= 0);
    const entry = manifest.entries[index];
    fs.rmSync(entry.target, { recursive: true, force: true });
    fs.renameSync(entry.backup, entry.target);
    entry.backup = entry.backup;
    entry.rollbackStatus = 'RESTORED';
    entry.restoredFingerprint = fileFingerprint(entry.target);
    manifest.rollbackStatus = 'PARTIAL';
    fs.writeFileSync(reference, `${JSON.stringify(manifest, null, 2)}\n`);

    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.strictEqual(rollback.status, 0, rollback.stderr);
    assert.ok(JSON.parse(fs.readFileSync(reference, 'utf8')).rolledBackAt);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('rollback recovers a publication interrupted before progress persistence', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'crash-window']);
    assert.strictEqual(write.status, 0, write.stderr);
    const reference = path.join(repo, '.claude', 'artifacts', 'release-backups', 'crash-window.json');
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    const index = manifest.entries.findIndex((entry) => entry.target.endsWith(path.join('.claude-plugin', 'plugin.json')));
    assert.ok(index >= 0);
    const entry = manifest.entries[index];
    const recovery = entry.recovery;
    fs.renameSync(entry.target, recovery);
    fs.renameSync(entry.backup, entry.target);
    manifest.rollbackStatus = 'IN_PROGRESS';
    fs.writeFileSync(reference, `${JSON.stringify(manifest, null, 2)}\n`);

    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.strictEqual(rollback.status, 0, rollback.stderr);
    assert.ok(JSON.parse(fs.readFileSync(reference, 'utf8')).rolledBackAt);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('rollback cleans a recovery slot left after RESTORED progress was persisted', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'cleanup-window']);
    assert.strictEqual(write.status, 0, write.stderr);
    const reference = path.join(repo, '.claude', 'artifacts', 'release-backups', 'cleanup-window.json');
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    const index = manifest.entries.findIndex((entry) => entry.target.endsWith(path.join('.claude-plugin', 'plugin.json')));
    assert.ok(index >= 0);
    const entry = manifest.entries[index];
    fs.renameSync(entry.target, entry.recovery);
    fs.renameSync(entry.backup, entry.target);
    entry.rollbackStatus = 'RESTORED';
    entry.restoredFingerprint = fileFingerprint(entry.target);
    manifest.rollbackStatus = 'PARTIAL';
    fs.writeFileSync(reference, `${JSON.stringify(manifest, null, 2)}\n`);

    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.strictEqual(rollback.status, 0, rollback.stderr);
    assert.ok(JSON.parse(fs.readFileSync(reference, 'utf8')).rolledBackAt);
    assert.strictEqual(fs.existsSync(entry.recovery), false);
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('write mode refuses to replace an existing rollback manifest for the same operation key', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  const backupRoot = path.join(repo, '.claude', 'artifacts', 'release-backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const reference = path.join(backupRoot, 'release-collision.json');
  fs.writeFileSync(reference, '{"sentinel":true}\n');
  try {
    const res = runCli(repo, [
      'write', '--version', '1.1.0', '--date', '2026-07-27',
      '--summary', 'Add widget', '--operation-key', 'release-collision',
    ]);
    assert.notStrictEqual(res.status, 0, res.stdout);
    assert.match(res.stderr, /already exists|operation/i);
    assert.strictEqual(fs.readFileSync(reference, 'utf8'), '{"sentinel":true}\n');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('rollback rejects a manifest target outside the canonical release target set', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'target-allowlist']);
    assert.strictEqual(write.status, 0, write.stderr);
    const reference = path.join(repo, '.claude', 'artifacts', 'release-backups', 'target-allowlist.json');
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    const config = path.join(repo, '.git', 'config');
    manifest.entries[0].target = config;
    manifest.entries[0].publishedFingerprint = fileFingerprint(config);
    fs.writeFileSync(reference, `${JSON.stringify(manifest, null, 2)}\n`);
    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.notStrictEqual(rollback.status, 0, rollback.stdout);
    assert.match(rollback.stderr, /canonical|release target|allowlist|target/i);
    assert.ok(fs.existsSync(config), 'rollback must not remove arbitrary repository files');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('rollback rejects duplicate target or backup entries before mutating the tree', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  try {
    const write = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget', '--operation-key', 'duplicate-entry']);
    assert.strictEqual(write.status, 0, write.stderr);
    const reference = path.join(repo, '.claude', 'artifacts', 'release-backups', 'duplicate-entry.json');
    const manifest = JSON.parse(fs.readFileSync(reference, 'utf8'));
    const duplicate = { ...manifest.entries[0] };
    manifest.entries.push(duplicate);
    fs.writeFileSync(reference, `${JSON.stringify(manifest, null, 2)}\n`);
    const rollback = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.notStrictEqual(rollback.status, 0, rollback.stdout);
    assert.match(rollback.stderr, /duplicate|target|backup/i);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.1.0');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('rollback refuses a manifest outside the repository backup root', () => {
  const repo = mkRepo();
  const externalRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-external-rollback-')));
  const reference = path.join(externalRoot, 'external.json');
  fs.writeFileSync(reference, JSON.stringify({
    schema: 'dhpk.release.rollback.v1',
    operationKey: 'external',
    backupDirectory: path.join(externalRoot, 'external'),
    entries: [],
  }));
  fs.mkdirSync(path.join(externalRoot, 'external'));
  try {
    const res = runCli(repo, ['rollback', '--backup-reference', reference]);
    assert.notStrictEqual(res.status, 0, res.stdout);
    assert.match(res.stderr, /repository backup root/i);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('write mode fails closed when the bilingual AGY generator pin is missing', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'platform-installation.md'), '# no generator command\n');
  fs.writeFileSync(path.join(repo, 'docs', 'platform-installation.zh-TW.md'), '# no generator command\n');
  const before = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.notStrictEqual(res.status, 0, res.stdout);
  assert.match(res.stderr, /AGY generator pin|dhpk distribution/i);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, before);
});

test('write mode fails and changes nothing when fragments are invalid', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'bogus.widget.md'), 'scope: widget\nnote: x\n');
  const before = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;

  const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.notStrictEqual(res.status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  assert.strictEqual(after, before);
});

test('write mode fails closed when an inventory-selected Agent/Cursor skill is skipped', () => {
  const repo = mkRepo();
  try {
    const inventoryPath = path.join(repo, 'manifests', 'distribution-inventory.json');
    fs.writeFileSync(inventoryPath, JSON.stringify({
      skills: [{ id: 'portable', name: 'dhpk-portable', path: 'skills/dhpk-tdd-workflow', lifecycle: 'promoted', surfaces: ['agent-plugin', 'cursor-plugin'] }],
    }));
    fs.writeFileSync(path.join(repo, 'skills/dhpk-tdd-workflow', 'SKILL.md'), '---\nname: wrong-name\ndescription: broken\n---\n');
    fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
    const beforeChangelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
    const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget']);
    assert.notStrictEqual(res.status, 0, res.stdout);
    assert.match(res.stderr, /skipped selected skills|validation failed/i);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), beforeChangelog);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version, '1.0.0');
    assert.ok(fs.existsSync(path.join(repo, 'changelog.d', 'feat.widget.md')));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

run('prepare-release-cli');
