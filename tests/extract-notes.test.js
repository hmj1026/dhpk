'use strict';

// Coverage for scripts/release/extract-notes.sh — the release-note extraction
// step shared by CHANGELOG.md-driven release preparation and .github/workflows/release.yml.
// Empty or malformed target sections must fail loudly (non-zero exit) rather
// than let a release publish with empty notes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'extract-notes.sh');

function writeChangelog(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-extract-notes-'));
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, content);
  return file;
}

function extract(changelogPath, version) {
  return spawnSync('bash', [SCRIPT, changelogPath, version], { encoding: 'utf8' });
}

test('extracts the body between the target heading and the next release heading', () => {
  const file = writeChangelog('# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-07-27 — Summary\n\nSome notes.\n\n**feat(x)** — Add x.\n\n## 0.9.0 — 2026-01-01 — Prior\n\nOld notes.\n');
  const res = extract(file, '1.0.0');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Some notes\./);
  assert.match(res.stdout, /\*\*feat\(x\)\*\* — Add x\./);
  assert.ok(!res.stdout.includes('Old notes.'));
});

test('extracts the body when the target release is the last section in the file', () => {
  const file = writeChangelog('# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-07-27 — Summary\n\nOnly notes.\n');
  const res = extract(file, '1.0.0');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Only notes\./);
});

test('fails when the target heading is missing entirely', () => {
  const file = writeChangelog('# Changelog\n\n## [Unreleased]\n\n## 0.9.0 — 2026-01-01 — Prior\n\nOld notes.\n');
  const res = extract(file, '1.0.0');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /not found/i);
});

test('fails when the target heading has an empty body', () => {
  const file = writeChangelog('# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-07-27 — Summary\n\n## 0.9.0 — 2026-01-01 — Prior\n\nOld notes.\n');
  const res = extract(file, '1.0.0');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /empty/i);
});

test('fails when the target heading body is whitespace-only', () => {
  const file = writeChangelog('# Changelog\n\n## [Unreleased]\n\n## 1.0.0 — 2026-07-27 — Summary\n\n   \n\n## 0.9.0 — 2026-01-01 — Prior\n\nOld notes.\n');
  const res = extract(file, '1.0.0');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /empty/i);
});

run('extract-notes');
