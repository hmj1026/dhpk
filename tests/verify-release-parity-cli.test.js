'use strict';

// CLI-level coverage for scripts/ci/verify-release-parity.js — the
// release-only parity gate run against the tagged commit in release.yml.
// Unlike prepare-release.js, this does NOT enforce a branch (release.yml
// checks out the tag, which is detached HEAD on main, not develop).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-release-parity.js');

function mkRepo(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-verify-parity-'));
  for (const rel of ['.claude-plugin', '.codex-plugin', 'plugins/dhpk/.codex-plugin', '.agents/plugins']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugins/dhpk/.codex-plugin/plugin.json']) {
    fs.writeFileSync(path.join(root, rel), JSON.stringify({ name: 'dhpk', version }));
  }
  fs.writeFileSync(path.join(root, '.agents/plugins/marketplace.json'), JSON.stringify({ plugins: [{ name: 'dhpk', version }] }));
  fs.writeFileSync(path.join(root, 'plugins/dhpk/provenance.json'), JSON.stringify({ sourceVersion: version }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n## ${version} — 2026-07-27 — Summary\n\nNotes.\n`);
  return root;
}

test('passes when every surface matches the tag version, regardless of branch', () => {
  const repo = mkRepo('1.2.3');
  const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('fails and lists every mismatched surface when a manifest drifts from the tag', () => {
  const repo = mkRepo('1.2.3');
  fs.writeFileSync(path.join(repo, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.2.4' }));
  const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /\.codex-plugin\/plugin\.json/);
});

run('verify-release-parity-cli');
