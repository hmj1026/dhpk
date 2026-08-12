'use strict';

// Coverage for scripts/lib/release-parity.js: version parity across every
// version-bearing manifest and the CHANGELOG.md release heading, checked
// against one target SemVer version. Composes (does not duplicate) the
// manifest-to-manifest parity already covered by
// tests/codex-plugin-manifest.test.js — this suite covers the target-version
// dimension and the changelog heading, which that suite does not.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { MANIFEST_PATHS, checkParity } = require('../scripts/lib/release-parity');

function mkRepo({ versions, changelogHeading } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-parity-'));
  const defaults = {
    '.claude-plugin/plugin.json': '1.0.0',
    '.codex-plugin/plugin.json': '1.0.0',
    'plugins/dhpk/.codex-plugin/plugin.json': '1.0.0',
    'plugins/dhpk-agent/plugin.json': '1.0.0',
    'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.0.0',
  };
  const merged = { ...defaults, ...(versions || {}) };
  for (const [rel, version] of Object.entries(merged)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify({ name: 'dhpk', version }));
  }
  fs.mkdirSync(path.join(root, '.agents', 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agents', 'plugins', 'marketplace.json'),
    JSON.stringify({ plugins: [{ name: 'dhpk', version: (versions && versions['.agents/plugins/marketplace.json']) || '1.0.0' }] })
  );
  fs.mkdirSync(path.join(root, 'plugins', 'dhpk'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugins', 'dhpk', 'provenance.json'),
    JSON.stringify({ sourceVersion: (versions && versions['plugins/dhpk/provenance.json']) || '1.0.0' })
  );
  fs.writeFileSync(
    path.join(root, 'plugins', 'dhpk-agent', 'provenance.json'),
    JSON.stringify({ sourceVersion: (versions && versions['plugins/dhpk-agent/provenance.json']) || '1.0.0' })
  );
  fs.writeFileSync(
    path.join(root, 'plugins', 'dhpk-cursor', 'provenance.json'),
    JSON.stringify({ sourceVersion: (versions && versions['plugins/dhpk-cursor/provenance.json']) || '1.0.0' })
  );
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [Unreleased]\n\n${changelogHeading !== undefined ? changelogHeading : '## 1.0.0 — 2026-07-27 — Summary'}\n\nNotes.\n`
  );
  return root;
}

test('MANIFEST_PATHS lists every version-bearing manifest, including native package provenance', () => {
  assert.deepStrictEqual(MANIFEST_PATHS.sort(), [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'plugins/dhpk/.codex-plugin/plugin.json',
    'plugins/dhpk/provenance.json',
    'plugins/dhpk-agent/plugin.json',
    'plugins/dhpk-agent/provenance.json',
    'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
    'plugins/dhpk-cursor/provenance.json',
  ].sort());
});

test('checkParity rejects a non-semver target version', () => {
  const root = mkRepo();
  const result = checkParity(root, '1.0');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /semver/i.test(e)));
});

test('checkParity passes when every manifest, native package provenance, and the changelog heading match the target', () => {
  const root = mkRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.3', 'plugins/dhpk-agent/plugin.json': '1.2.3', 'plugins/dhpk-agent/provenance.json': '1.2.3', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3', 'plugins/dhpk-cursor/provenance.json': '1.2.3' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

test('checkParity fails when native package provenance drifts from the target', () => {
  const root = mkRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.2' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('plugins/dhpk/provenance.json') && e.includes('1.2.2') && e.includes('1.2.3')));
});

test('checkParity reports every manifest that drifts from the target, with observed values', () => {
  const root = mkRepo({ versions: { '.codex-plugin/plugin.json': '1.2.4' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('.codex-plugin/plugin.json') && e.includes('1.2.4') && e.includes('1.2.3')));
});

test('checkParity fails when the changelog heading for the target version is missing', () => {
  const root = mkRepo({ changelogHeading: '## 0.9.0 — 2026-01-01 — Old' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /changelog/i.test(e) && /heading/i.test(e)));
});

run('release-parity');
