'use strict';

// CLI-level coverage for scripts/ci/validate-changelog-fragments.js:
// argument parsing, check mode exit codes, --diff-base coverage gate, --write mode.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'validate-changelog-fragments.js');

function mkRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-fragments-cli-')));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'changelog.d'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## 0.9.0 — 2026-01-01 — Prior release\n');
  // The release-section exemption cross-checks the plugin manifest version,
  // so the fixture has to carry one like the real repo does.
  writeManifestVersion(dir, '0.9.0');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  spawnSync('git', ['branch', '-q', 'develop'], { cwd: dir });
  return dir;
}

function writeManifestVersion(repo, version) {
  const dir = path.join(repo, '.claude-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'dhpk', version }, null, 2));
}

function runCli(repo, args) {
  return spawnSync('node', [CLI, '--repo-root', repo, ...args], { cwd: repo, encoding: 'utf8' });
}

test('check mode passes on an empty fragment directory', () => {
  const repo = mkRepo();
  const res = runCli(repo, []);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /PASS/);
});

test('check mode fails on an invalid fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'bogus.widget.md'), 'scope: widget\nnote: x\n');
  const res = runCli(repo, []);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /invalid category/);
});

test('--diff-base fails when a user-visible file changed with no fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /missing release fragment/);
});

test('--diff-base passes when a fragment covers the change', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file + fragment'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.strictEqual(res.status, 0, res.stderr);
});

test('--diff-base passes on a release-shaped diff: promoted section, no pending fragment', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'add source file + fragment'], { cwd: repo });
  // Release prep consumes the fragment into a CHANGELOG.md section and bumps
  // the manifest in lockstep.
  const write = runCli(repo, ['--write', '--version', '1.0.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.strictEqual(write.status, 0, write.stderr);
  writeManifestVersion(repo, '1.0.0');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'chore(release): 1.0.0'], { cwd: repo });

  const res = runCli(repo, ['--diff-base', 'develop', '--base-ref', 'main']);
  assert.strictEqual(res.status, 0, res.stderr);
});

// The exemption is only reachable on a release PR. Everything a feature PR can
// write — the heading AND the manifest version — is author-controlled, so on
// any other base the content evidence must not buy an exemption at all.
test('--diff-base gives no exemption on a non-release base even when heading and manifest agree', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'secret-feature.js'), 'module.exports = {};\n');
  const changelog = path.join(repo, 'CHANGELOG.md');
  fs.writeFileSync(
    changelog,
    fs.readFileSync(changelog, 'utf8').replace('## [Unreleased]', '## [Unreleased]\n\n## 9.9.9 — 2026-07-27 — Forged section')
  );
  writeManifestVersion(repo, '9.9.9');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'forge a release-looking diff'], { cwd: repo });

  const res = runCli(repo, ['--diff-base', 'develop', '--base-ref', 'develop']);
  assert.notStrictEqual(res.status, 0, res.stdout);
  assert.match(res.stderr, /missing release fragment/);
  assert.match(res.stderr, /secret-feature\.js/);
});

test('--diff-base gives no exemption when the base ref is unknown (fails closed)', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'secret-feature.js'), 'module.exports = {};\n');
  const changelog = path.join(repo, 'CHANGELOG.md');
  fs.writeFileSync(
    changelog,
    fs.readFileSync(changelog, 'utf8').replace('## [Unreleased]', '## [Unreleased]\n\n## 9.9.9 — 2026-07-27 — Forged section')
  );
  writeManifestVersion(repo, '9.9.9');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'forge a release-looking diff'], { cwd: repo });

  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.notStrictEqual(res.status, 0, res.stdout);
  assert.match(res.stderr, /missing release fragment/);
});

// The exemption must not become a general-purpose way to skip the fragment
// requirement: editing an EXISTING release heading is not a promotion.
test('--diff-base still fails when an existing release heading is only reworded', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  const changelog = path.join(repo, 'CHANGELOG.md');
  fs.writeFileSync(
    changelog,
    fs.readFileSync(changelog, 'utf8').replace('## 0.9.0 — 2026-01-01 — Prior release', '## 0.9.0 — 2026-01-02 — Prior release, fixed date')
  );
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'fix changelog date'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop', '--base-ref', 'main']);
  assert.notStrictEqual(res.status, 0, res.stdout);
  assert.match(res.stderr, /missing release fragment/);
});

// Hand-appending a version section without the lockstep manifest bump is not a
// release either — prepare-release always moves both together.
test('--diff-base still fails when a new section is hand-added without the manifest bump', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  const changelog = path.join(repo, 'CHANGELOG.md');
  fs.writeFileSync(
    changelog,
    fs.readFileSync(changelog, 'utf8').replace('## [Unreleased]', '## [Unreleased]\n\n## 2.0.0 — 2026-07-27 — Hand-written section')
  );
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'hand-write a changelog section'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop', '--base-ref', 'main']);
  assert.notStrictEqual(res.status, 0, res.stdout);
  assert.match(res.stderr, /missing release fragment/);
});

test('--diff-base still fails when CHANGELOG.md changed without adding a release section', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'scripts.js'), 'module.exports = {};\n');
  fs.appendFileSync(path.join(repo, 'CHANGELOG.md'), '\nsome prose edit\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'edit changelog prose'], { cwd: repo });
  const res = runCli(repo, ['--diff-base', 'develop']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /missing release fragment/);
});

test('--write promotes fragments into CHANGELOG.md', () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'changelog.d', 'feat.widget.md'), 'scope: widget\nnote: Add the widget.\n');
  const res = runCli(repo, ['--write', '--version', '1.0.0', '--date', '2026-07-27', '--summary', 'Add widget']);
  assert.strictEqual(res.status, 0, res.stderr);
  const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## 1.0.0 — 2026-07-27 — Add widget'));
  assert.ok(!fs.existsSync(path.join(repo, 'changelog.d', 'feat.widget.md')));
});

run('validate-changelog-fragments-cli');
