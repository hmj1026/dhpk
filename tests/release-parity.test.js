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

function writeAgyInstallDocs(root, version) {
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const line = `bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=${version} --json\n`;
  fs.writeFileSync(path.join(root, 'docs', 'platform-installation.md'), line);
  fs.writeFileSync(path.join(root, 'docs', 'platform-installation.zh-TW.md'), line);
}

function mkRepo({ versions, changelogHeading, agyDocVersion = '1.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-release-parity-'));
  const defaults = {
    '.claude-plugin/plugin.json': '1.0.0',
    '.codex-plugin/plugin.json': '1.0.0',
    'plugins/dhpk/.codex-plugin/plugin.json': '1.0.0',
    'plugins/dhpk-agent/plugin.json': '1.0.0',
    'plugins/dhpk-agy/plugin.json': '1.0.0',
    'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.0.0',
  };
  const merged = { ...defaults, ...(versions || {}) };
  for (const rel of [
    'generated/claude-profiles/minimal/package/plugin.json',
    'generated/claude-profiles/full/package/plugin.json',
    'generated/claude-profiles/compat-v1/package/plugin.json',
  ]) {
    if (merged[rel] === undefined) merged[rel] = merged['.claude-plugin/plugin.json'];
  }
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
  fs.mkdirSync(path.join(root, 'plugins', 'dhpk-agy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugins', 'dhpk-agy', 'provenance.json'),
    JSON.stringify({ sourceVersion: (versions && versions['plugins/dhpk-agy/provenance.json']) || '1.0.0' })
  );
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [Unreleased]\n\n${changelogHeading !== undefined ? changelogHeading : '## 1.0.0 — 2026-07-27 — Summary'}\n\nNotes.\n`
  );
  writeAgyInstallDocs(root, agyDocVersion);
  return root;
}

function allAtVersion(version) {
  return {
    '.claude-plugin/plugin.json': version,
    '.codex-plugin/plugin.json': version,
    'plugins/dhpk/.codex-plugin/plugin.json': version,
    '.agents/plugins/marketplace.json': version,
    'plugins/dhpk/provenance.json': version,
    'plugins/dhpk-agent/plugin.json': version,
    'plugins/dhpk-agent/provenance.json': version,
    'plugins/dhpk-agy/plugin.json': version,
    'plugins/dhpk-agy/provenance.json': version,
    'plugins/dhpk-cursor/.cursor-plugin/plugin.json': version,
    'plugins/dhpk-cursor/provenance.json': version,
    'generated/claude-profiles/minimal/package/plugin.json': version,
    'generated/claude-profiles/full/package/plugin.json': version,
    'generated/claude-profiles/compat-v1/package/plugin.json': version,
  };
}

test('checkParity fails when a tracked Claude profile manifest lags the target', () => {
  for (const rel of [
    'generated/claude-profiles/minimal/package/plugin.json',
    'generated/claude-profiles/full/package/plugin.json',
    'generated/claude-profiles/compat-v1/package/plugin.json',
  ]) {
    const root = mkRepo({
      versions: { ...allAtVersion('1.2.3'), [rel]: '1.2.2' },
      changelogHeading: '## 1.2.3 — 2026-07-27 — Summary',
      agyDocVersion: '1.2.3',
    });
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes(rel) && e.includes('1.2.2') && e.includes('1.2.3')));
  }
});

test('MANIFEST_PATHS lists every version-bearing manifest, including native package provenance', () => {
  assert.deepStrictEqual(MANIFEST_PATHS.sort(), [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
    'plugins/dhpk/.codex-plugin/plugin.json',
    'plugins/dhpk/provenance.json',
    'plugins/dhpk-agent/plugin.json',
    'plugins/dhpk-agent/provenance.json',
    'plugins/dhpk-agy/plugin.json',
    'plugins/dhpk-agy/provenance.json',
    'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
    'plugins/dhpk-cursor/provenance.json',
    'generated/claude-profiles/minimal/package/plugin.json',
    'generated/claude-profiles/full/package/plugin.json',
    'generated/claude-profiles/compat-v1/package/plugin.json',
  ].sort());
});

test('checkParity rejects a non-semver target version', () => {
  const root = mkRepo();
  const result = checkParity(root, '1.0');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /semver/i.test(e)));
});

test('checkParity passes when every manifest, native package provenance, and the changelog heading match the target', () => {
  const root = mkRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.3', 'plugins/dhpk-agent/plugin.json': '1.2.3', 'plugins/dhpk-agent/provenance.json': '1.2.3', 'plugins/dhpk-agy/plugin.json': '1.2.3', 'plugins/dhpk-agy/provenance.json': '1.2.3', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3', 'plugins/dhpk-cursor/provenance.json': '1.2.3' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

test('checkParity fails when native package provenance drifts from the target', () => {
  const root = mkRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.2' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('plugins/dhpk/provenance.json') && e.includes('1.2.2') && e.includes('1.2.3')));
});

test('checkParity fails when native AGY package provenance drifts from the target', () => {
  const root = mkRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.3', 'plugins/dhpk-agent/plugin.json': '1.2.3', 'plugins/dhpk-agent/provenance.json': '1.2.3', 'plugins/dhpk-agy/plugin.json': '1.2.3', 'plugins/dhpk-agy/provenance.json': '1.2.2', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3', 'plugins/dhpk-cursor/provenance.json': '1.2.3' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('plugins/dhpk-agy/provenance.json') && e.includes('1.2.2') && e.includes('1.2.3')));
});

test('checkParity reports every manifest that drifts from the target, with observed values', () => {
  const root = mkRepo({ versions: { '.codex-plugin/plugin.json': '1.2.4' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('.codex-plugin/plugin.json') && e.includes('1.2.4') && e.includes('1.2.3')));
});

test('checkParity fails when the bilingual AGY generator pin lags the target', () => {
  const root = mkRepo({
    versions: {
      '.claude-plugin/plugin.json': '1.2.3',
      '.codex-plugin/plugin.json': '1.2.3',
      'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3',
      '.agents/plugins/marketplace.json': '1.2.3',
      'plugins/dhpk/provenance.json': '1.2.3',
      'plugins/dhpk-agent/plugin.json': '1.2.3',
      'plugins/dhpk-agent/provenance.json': '1.2.3',
      'plugins/dhpk-agy/plugin.json': '1.2.3',
      'plugins/dhpk-agy/provenance.json': '1.2.3',
      'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3',
      'plugins/dhpk-cursor/provenance.json': '1.2.3',
    },
    changelogHeading: '## 1.2.3 — 2026-07-27 — Summary',
    agyDocVersion: '1.2.2',
  });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('docs/platform-installation.md') && e.includes('1.2.2') && e.includes('1.2.3')));
  assert.ok(result.errors.some((e) => e.includes('docs/platform-installation.zh-TW.md')));
});

test('checkParity fails when the changelog heading for the target version is missing', () => {
  const root = mkRepo({ changelogHeading: '## 0.9.0 — 2026-01-01 — Old', agyDocVersion: '1.2.3' });
  const result = checkParity(root, '1.2.3');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /changelog/i.test(e) && /heading/i.test(e)));
});

run('release-parity');
