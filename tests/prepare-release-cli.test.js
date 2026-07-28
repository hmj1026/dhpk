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

function mkRepo({ branch = 'develop' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-prepare-release-')));
  for (const rel of ['.claude-plugin', '.codex-plugin', 'plugins/dhpk/.codex-plugin', '.agents/plugins', 'changelog.d', 'manifests', 'skills/tdd']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'plugins/dhpk/.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, '.agents/plugins', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'dhpk', version: '1.0.0' }] }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-01-01 — Prior\n\nPrior notes.\n');
  fs.writeFileSync(path.join(root, 'skills/tdd', 'SKILL.md'), '---\nname: tdd\n---\n');
  fs.writeFileSync(
    path.join(root, 'manifests', 'distribution-inventory.json'),
    JSON.stringify({ skills: [{ id: 'tdd', path: 'skills/tdd', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-native'] }] })
  );

  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  spawnSync('git', ['checkout', '-q', '-b', branch], { cwd: root });
  return root;
}

function runCli(repo, args) {
  return spawnSync('node', [CLI, '--repo-root', repo, ...args], { cwd: repo, encoding: 'utf8' });
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
  const res = runCli(repo, ['write', '--version', '1.1.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /develop/i);
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
  assert.ok(fs.existsSync(path.join(repo, 'plugins/dhpk/skills/tdd/SKILL.md')));

  const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## 1.1.0 — 2026-07-27 — Add widget'));
  assert.ok(!fs.existsSync(path.join(repo, 'changelog.d', 'feat.widget.md')));
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

run('prepare-release-cli');
