'use strict';

// Coverage for scripts/release/extract-notes.sh — the release-note extraction
// step shared by CHANGELOG.md-driven release preparation and .github/workflows/release.yml.
// Empty or malformed target sections must fail loudly (non-zero exit) rather
// than let a release publish with empty notes.

const fs = require('node:fs');
const { makeTempDir } = require('./_lib/temp-dir');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release', 'extract-notes.sh');

function writeChangelog(content) {
  const dir = makeTempDir('dhpk-extract-notes-');
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

test('does not treat "." in the version as a regex wildcard', () => {
  const file = writeChangelog('# Changelog\n\n## 2x31y4 — 2026-01-01 — Lookalike\n\nWrong notes.\n');
  const res = extract(file, '2.31.4');
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /not found/i);
  assert.ok(!res.stdout.includes('Wrong notes.'));
});

test('picks the literal heading when a regex lookalike precedes it', () => {
  const file = writeChangelog('# Changelog\n\n## 2x31y4 — 2026-01-01 — Lookalike\n\nWrong notes.\n\n## 2.31.4 — 2026-01-02 — Real\n\nRight notes.\n');
  const res = extract(file, '2.31.4');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Right notes\./);
  assert.ok(!res.stdout.includes('Wrong notes.'));
});

test('extracts versions containing regex metacharacters such as "+"', () => {
  const file = writeChangelog('# Changelog\n\n## 1.0.0-rc.1+build.5 — 2026-01-01 — Build\n\nBuild notes.\n\n## 0.9.0 — 2025-01-01 — Prior\n\nOld notes.\n');
  const res = extract(file, '1.0.0-rc.1+build.5');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Build notes\./);
  assert.ok(!res.stdout.includes('Old notes.'));
});

test('extracts versions containing "/" and "(" without breaking awk syntax', () => {
  const file = writeChangelog('# Changelog\n\n## 1.0.0/x(1)[a] — 2026-01-01 — Odd\n\nOdd notes.\n');
  const res = extract(file, '1.0.0/x(1)[a]');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Odd notes\./);
});

test('treats backslashes in the version literally', () => {
  const file = writeChangelog('# Changelog\n\n## 1\\n2 — 2026-01-01 — Slash\n\nSlash notes.\n');
  const res = extract(file, '1\\n2');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Slash notes\./);
});

run('extract-notes');
