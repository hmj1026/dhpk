'use strict';

// Coverage for scripts/lib/release-parity.js: version parity across every
// version-bearing manifest and the CHANGELOG.md release heading, checked
// against one target SemVer version. Composes (does not duplicate) the
// manifest-to-manifest parity already covered by
// tests/codex-native-package-validate.test.js — this suite covers the target-version
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
    'generated/claude-marketplace/package/.claude-plugin/plugin.json',
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

function withRepo(options, callback) {
  const root = mkRepo(options);
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    'generated/claude-marketplace/package/.claude-plugin/plugin.json': version,
    'generated/claude-profiles/minimal/package/plugin.json': version,
    'generated/claude-profiles/full/package/plugin.json': version,
    'generated/claude-profiles/compat-v1/package/plugin.json': version,
  };
}

test('checkParity fails when a tracked Claude profile manifest lags the target', () => {
  for (const rel of [
    'generated/claude-marketplace/package/.claude-plugin/plugin.json',
    'generated/claude-profiles/minimal/package/plugin.json',
    'generated/claude-profiles/full/package/plugin.json',
    'generated/claude-profiles/compat-v1/package/plugin.json',
  ]) {
    withRepo({
      versions: { ...allAtVersion('1.2.3'), [rel]: '1.2.2' },
      changelogHeading: '## 1.2.3 — 2026-07-27 — Summary',
      agyDocVersion: '1.2.3',
    }, (root) => {
      const result = checkParity(root, '1.2.3');
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some((e) => e.includes(rel) && e.includes('1.2.2') && e.includes('1.2.3')));
    });
  }
});

test('MANIFEST_PATHS lists every version-bearing manifest, including native package provenance', () => {
  const originalPaths = [...MANIFEST_PATHS];
  const expectedPaths = [
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
    'generated/claude-marketplace/package/.claude-plugin/plugin.json',
    'generated/claude-profiles/minimal/package/plugin.json',
    'generated/claude-profiles/full/package/plugin.json',
    'generated/claude-profiles/compat-v1/package/plugin.json',
  ];
  assert.deepStrictEqual([...MANIFEST_PATHS].sort(), [...expectedPaths].sort());
  assert.deepStrictEqual(MANIFEST_PATHS, originalPaths);
});

test('checkParity rejects a non-semver target version', () => {
  withRepo({}, (root) => {
    const result = checkParity(root, '1.0');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => /semver/i.test(e)));
  });
});

test('checkParity passes when every manifest, native package provenance, and the changelog heading match the target', () => {
  withRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.3', 'plugins/dhpk-agent/plugin.json': '1.2.3', 'plugins/dhpk-agent/provenance.json': '1.2.3', 'plugins/dhpk-agy/plugin.json': '1.2.3', 'plugins/dhpk-agy/provenance.json': '1.2.3', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3', 'plugins/dhpk-cursor/provenance.json': '1.2.3' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
  });
});

test('checkParity fails when native package provenance drifts from the target', () => {
  withRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.2' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('plugins/dhpk/provenance.json') && e.includes('1.2.2') && e.includes('1.2.3')));
  });
});

test('checkParity fails when native AGY package provenance drifts from the target', () => {
  withRepo({ versions: { '.claude-plugin/plugin.json': '1.2.3', '.codex-plugin/plugin.json': '1.2.3', 'plugins/dhpk/.codex-plugin/plugin.json': '1.2.3', '.agents/plugins/marketplace.json': '1.2.3', 'plugins/dhpk/provenance.json': '1.2.3', 'plugins/dhpk-agent/plugin.json': '1.2.3', 'plugins/dhpk-agent/provenance.json': '1.2.3', 'plugins/dhpk-agy/plugin.json': '1.2.3', 'plugins/dhpk-agy/provenance.json': '1.2.2', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json': '1.2.3', 'plugins/dhpk-cursor/provenance.json': '1.2.3' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('plugins/dhpk-agy/provenance.json') && e.includes('1.2.2') && e.includes('1.2.3')));
  });
});

test('checkParity reports every manifest that drifts from the target, with observed values', () => {
  withRepo({ versions: { '.codex-plugin/plugin.json': '1.2.4' }, changelogHeading: '## 1.2.3 — 2026-07-27 — Summary', agyDocVersion: '1.2.3' }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('.codex-plugin/plugin.json') && e.includes('1.2.4') && e.includes('1.2.3')));
  });
});

test('checkParity fails when the bilingual AGY generator pin lags the target', () => {
  withRepo({
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
  }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('docs/platform-installation.md') && e.includes('1.2.2') && e.includes('1.2.3')));
    assert.ok(result.errors.some((e) => e.includes('docs/platform-installation.zh-TW.md')));
  });
});

test('checkParity fails when the changelog heading for the target version is missing', () => {
  withRepo({ changelogHeading: '## 0.9.0 — 2026-01-01 — Old', agyDocVersion: '1.2.3' }, (root) => {
    const result = checkParity(root, '1.2.3');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => /changelog/i.test(e) && /heading/i.test(e)));
  });
});


  // Merged from tests/verify-release-parity-cli.test.js.
  {

    // CLI-level coverage for scripts/ci/verify-release-parity.js — the
    // release-only parity gate run against the tagged commit in release.yml.
    // Unlike prepare-release.js, this does NOT enforce a branch (release.yml
    // checks out the tag, which is detached HEAD on main, not develop).

    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');

    const ROOT = path.join(__dirname, '..');
    const CLI = path.join(ROOT, 'scripts', 'ci', 'verify-release-parity.js');

    function mkRepo(version) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-verify-parity-'));
      for (const rel of ['.claude-plugin', '.codex-plugin', 'plugins/dhpk/.codex-plugin', 'plugins/dhpk-agent', 'plugins/dhpk-agy', 'plugins/dhpk-cursor/.cursor-plugin', '.agents/plugins', 'generated/claude-marketplace/package/.claude-plugin', 'generated/claude-profiles/minimal/package', 'generated/claude-profiles/full/package', 'generated/claude-profiles/compat-v1/package']) {
        fs.mkdirSync(path.join(root, rel), { recursive: true });
      }
      for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugins/dhpk/.codex-plugin/plugin.json', 'plugins/dhpk-agent/plugin.json', 'plugins/dhpk-agy/plugin.json', 'plugins/dhpk-cursor/.cursor-plugin/plugin.json', 'generated/claude-marketplace/package/.claude-plugin/plugin.json', 'generated/claude-profiles/minimal/package/plugin.json', 'generated/claude-profiles/full/package/plugin.json', 'generated/claude-profiles/compat-v1/package/plugin.json']) {
        fs.writeFileSync(path.join(root, rel), JSON.stringify({ name: 'dhpk', version }));
      }
      fs.writeFileSync(path.join(root, '.agents/plugins/marketplace.json'), JSON.stringify({ plugins: [{ name: 'dhpk', version }] }));
      fs.writeFileSync(path.join(root, 'plugins/dhpk/provenance.json'), JSON.stringify({ sourceVersion: version }));
      fs.writeFileSync(path.join(root, 'plugins/dhpk-agent/provenance.json'), JSON.stringify({ sourceVersion: version }));
      fs.writeFileSync(path.join(root, 'plugins/dhpk-agy/provenance.json'), JSON.stringify({ sourceVersion: version }));
      fs.writeFileSync(path.join(root, 'plugins/dhpk-cursor/provenance.json'), JSON.stringify({ sourceVersion: version }));
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n## ${version} — 2026-07-27 — Summary\n\nNotes.\n`);
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      const agyPin = `bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=${version} --json\n`;
      fs.writeFileSync(path.join(root, 'docs', 'platform-installation.md'), agyPin);
      fs.writeFileSync(path.join(root, 'docs', 'platform-installation.zh-TW.md'), agyPin);
      return root;
    }

    test('passes when every surface matches the tag version, regardless of branch', () => {
      const repo = mkRepo('1.2.3');
      try {
        const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, res.stderr);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    test('fails and lists every mismatched surface when a manifest drifts from the tag', () => {
      const repo = mkRepo('1.2.3');
      try {
        fs.writeFileSync(path.join(repo, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'dhpk', version: '1.2.4' }));
        const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
        assert.notStrictEqual(res.status, 0);
        assert.match(res.stderr, /\.codex-plugin\/plugin\.json/);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    test('fails and lists the AGY package when its provenance drifts from the tag', () => {
      const repo = mkRepo('1.2.3');
      try {
        fs.writeFileSync(path.join(repo, 'plugins/dhpk-agy/provenance.json'), JSON.stringify({ sourceVersion: '1.2.2' }));
        const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
        assert.notStrictEqual(res.status, 0);
        assert.match(res.stderr, /plugins\/dhpk-agy\/provenance\.json/);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });

    test('fails when the bilingual AGY generator pin lags the tag version', () => {
      const repo = mkRepo('1.2.3');
      try {
        fs.writeFileSync(
          path.join(repo, 'docs', 'platform-installation.md'),
          'bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=1.2.2 --json\n',
        );
        const res = spawnSync('node', [CLI, '--repo-root', repo, '--version', '1.2.3'], { encoding: 'utf8' });
        assert.notStrictEqual(res.status, 0);
        assert.match(res.stderr, /docs\/platform-installation\.md/);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });
  }

run('release-parity');
