'use strict';

// Coverage for scripts/lib/changelog-fragments.js:
//   - fragment schema (category.slug.md, slug.none marker)
//   - validation: missing category, empty note/scope, duplicate slugs
//   - deterministic render + promotion into CHANGELOG.md's existing format
//   - orphan detection (fragment left unconsumed after promotion)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  CATEGORIES,
  readFragments,
  validateFragments,
  renderSection,
  promote,
  checkCoverage,
} = require('../scripts/lib/changelog-fragments');

function mkFragmentDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-fragments-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('CATEGORIES matches the existing changelog bullet vocabulary', () => {
  assert.deepStrictEqual(
    [...CATEGORIES].sort(),
    ['BREAKING', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'test'].sort()
  );
});

test('readFragments ignores TEMPLATE.md and non-fragment files', () => {
  const dir = mkFragmentDir({
    'TEMPLATE.md': 'ignored template\n',
    '.gitkeep': '',
    'feat.widget.md': 'scope: widget\nnote: Add the widget.\n',
  });
  const { fragments, markers } = readFragments(dir);
  assert.strictEqual(fragments.length, 1);
  assert.strictEqual(markers.length, 0);
  assert.strictEqual(fragments[0].slug, 'widget');
  assert.strictEqual(fragments[0].category, 'feat');
});

test('readFragments recognizes .none internal-only markers', () => {
  const dir = mkFragmentDir({
    'internal-cleanup.none': 'test-only refactor, no user-visible change\n',
  });
  const { fragments, markers } = readFragments(dir);
  assert.strictEqual(fragments.length, 0);
  assert.deepStrictEqual(markers, ['internal-cleanup']);
});

test('validateFragments rejects an invalid category', () => {
  const dir = mkFragmentDir({
    'bogus.widget.md': 'scope: widget\nnote: Add the widget.\n',
  });
  const { fragments } = readFragments(dir);
  const result = validateFragments(fragments);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /category/i.test(e) && /bogus\.widget\.md/.test(e)));
});

test('validateFragments rejects an empty note', () => {
  const dir = mkFragmentDir({
    'feat.widget.md': 'scope: widget\nnote:   \n',
  });
  const { fragments } = readFragments(dir);
  const result = validateFragments(fragments);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /note/i.test(e) && /feat\.widget\.md/.test(e)));
});

test('validateFragments rejects an empty scope', () => {
  const dir = mkFragmentDir({
    'feat.widget.md': 'scope:  \nnote: Add the widget.\n',
  });
  const { fragments } = readFragments(dir);
  const result = validateFragments(fragments);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /scope/i.test(e) && /feat\.widget\.md/.test(e)));
});

test('validateFragments rejects duplicate slugs across categories', () => {
  const dir = mkFragmentDir({
    'feat.widget.md': 'scope: widget\nnote: Add the widget.\n',
    'fix.widget.md': 'scope: widget\nnote: Fix the widget.\n',
  });
  const { fragments } = readFragments(dir);
  const result = validateFragments(fragments);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /duplicate/i.test(e) && /widget/.test(e)));
});

test('validateFragments rejects a slug shared between a fragment and a .none marker', () => {
  const dir = mkFragmentDir({
    'feat.widget.md': 'scope: widget\nnote: Add the widget.\n',
    'widget.none': 'no user-visible change\n',
  });
  const { fragments, markers } = readFragments(dir);
  const result = validateFragments(fragments, markers);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => /duplicate/i.test(e) && /widget/.test(e)));
});

test('validateFragments passes a well-formed fragment set including a .none marker', () => {
  const dir = mkFragmentDir({
    'feat.widget.md': 'scope: widget\nnote: Add the widget.\n',
    'internal-cleanup.none': 'test-only refactor\n',
  });
  const { fragments, markers } = readFragments(dir);
  const result = validateFragments(fragments, markers);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
});

test('renderSection sorts deterministically by category rank then slug', () => {
  const dir = mkFragmentDir({
    'fix.beta.md': 'scope: beta\nnote: Fix beta.\n',
    'feat.alpha.md': 'scope: alpha\nnote: Add alpha.\n',
    'BREAKING.zzz.md': 'scope: zzz\nnote: Break zzz.\n',
  });
  const { fragments } = readFragments(dir);
  const section = renderSection({ version: '1.2.3', date: '2026-07-27', fragments });
  const lines = section.split('\n').filter((l) => l.startsWith('**'));
  assert.deepStrictEqual(lines, [
    '**BREAKING(zzz)** — Break zzz.',
    '**feat(alpha)** — Add alpha.',
    '**fix(beta)** — Fix beta.',
  ]);
});

test('renderSection is byte-identical across repeated calls with the same fragment set', () => {
  const dir = mkFragmentDir({
    'feat.alpha.md': 'scope: alpha\nnote: Add alpha.\n',
  });
  const { fragments } = readFragments(dir);
  const a = renderSection({ version: '1.2.3', date: '2026-07-27', fragments });
  const b = renderSection({ version: '1.2.3', date: '2026-07-27', fragments });
  assert.strictEqual(a, b);
});

test('renderSection uses the existing heading format', () => {
  const dir = mkFragmentDir({
    'feat.alpha.md': 'scope: alpha\nnote: Add alpha.\n',
  });
  const { fragments } = readFragments(dir);
  const section = renderSection({
    version: '1.2.3',
    date: '2026-07-27',
    summary: 'Add alpha support',
    fragments,
  });
  assert.ok(section.startsWith('## 1.2.3 — 2026-07-27 — Add alpha support\n'));
});

test('renderSection with no fragments requires an explicit no-user-visible-change statement', () => {
  const section = renderSection({ version: '1.2.3', date: '2026-07-27', fragments: [] });
  assert.match(section, /no user-visible changes/i);
});

test('promote (write mode) inserts the rendered section into CHANGELOG.md and consumes fragments', () => {
  const fragDir = mkFragmentDir({
    'feat.alpha.md': 'scope: alpha\nnote: Add alpha.\n',
  });
  const changelogPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-changelog-')), 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, '# Changelog\n\n## [Unreleased]\n\n## 0.9.0 — 2026-01-01 — Prior release\n\nPrior notes.\n');

  const result = promote({
    fragmentDir: fragDir,
    changelogPath,
    version: '1.0.0',
    date: '2026-07-27',
    summary: 'Add alpha support',
  });

  assert.strictEqual(result.consumed.length, 1);
  assert.strictEqual(result.consumed[0], 'feat.alpha.md');
  assert.ok(!fs.existsSync(path.join(fragDir, 'feat.alpha.md')), 'fragment file should be deleted after promotion');

  const changelog = fs.readFileSync(changelogPath, 'utf8');
  assert.ok(changelog.includes('## 1.0.0 — 2026-07-27 — Add alpha support'));
  assert.ok(changelog.includes('**feat(alpha)** — Add alpha.'));
  assert.ok(changelog.includes('## [Unreleased]'));
  assert.ok(changelog.indexOf('## [Unreleased]') < changelog.indexOf('## 1.0.0'));
  assert.ok(changelog.includes('## 0.9.0 — 2026-01-01 — Prior release'), 'prior releases must be preserved');
});

test('promote leaves no orphan fragments assigned to the released version', () => {
  const fragDir = mkFragmentDir({
    'feat.alpha.md': 'scope: alpha\nnote: Add alpha.\n',
    'fix.beta.md': 'scope: beta\nnote: Fix beta.\n',
  });
  const changelogPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-changelog-')), 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, '# Changelog\n\n## [Unreleased]\n');

  promote({
    fragmentDir: fragDir,
    changelogPath,
    version: '1.0.0',
    date: '2026-07-27',
    summary: 'Two changes',
  });

  const remaining = fs.readdirSync(fragDir).filter((f) => f.endsWith('.md') || f.endsWith('.none'));
  assert.deepStrictEqual(remaining, []);
});

test('checkCoverage fails when a user-visible file changed with no fragment', () => {
  const result = checkCoverage({ changedFiles: ['scripts/ci/validate-plugin.js'], fragments: [], markers: [] });
  assert.strictEqual(result.ok, false);
  assert.ok(result.uncovered.includes('scripts/ci/validate-plugin.js'));
});

test('checkCoverage passes when only test-only files changed with no fragment', () => {
  const result = checkCoverage({ changedFiles: ['tests/changelog-fragments.test.js'], fragments: [], markers: [] });
  assert.strictEqual(result.ok, true);
});

test('checkCoverage passes for routine repo-hygiene files with no fragment (.gitignore, LICENSE, lockfiles)', () => {
  const result = checkCoverage({ changedFiles: ['.gitignore', 'LICENSE', 'package-lock.json'], fragments: [], markers: [] });
  assert.strictEqual(result.ok, true, JSON.stringify(result.uncovered));
});

test('checkCoverage passes when a user-visible file changed and a fragment exists', () => {
  const dir = mkFragmentDir({ 'feat.widget.md': 'scope: widget\nnote: Add the widget.\n' });
  const { fragments } = readFragments(dir);
  const result = checkCoverage({ changedFiles: ['scripts/ci/validate-plugin.js'], fragments, markers: [] });
  assert.strictEqual(result.ok, true);
});

test('checkCoverage passes when a user-visible file changed and a .none marker exists', () => {
  const dir = mkFragmentDir({ 'internal-cleanup.none': 'no user-visible change\n' });
  const { markers } = readFragments(dir);
  const result = checkCoverage({ changedFiles: ['scripts/ci/validate-plugin.js'], fragments: [], markers });
  assert.strictEqual(result.ok, true);
});

test('checkCoverage passes when an internal .none marker is deleted', () => {
  const result = checkCoverage({ changedFiles: ['changelog.d/internal-cleanup.none'], fragments: [], markers: [] });
  assert.strictEqual(result.ok, true, JSON.stringify(result.uncovered));
});

// Release-PR shape: prepare-release already promoted every pending fragment
// into a CHANGELOG.md release section and deleted it, so the develop -> main
// diff is large while changelog.d/ is empty. Coverage was answered at
// feature-PR merge time; the promoted section is the evidence.
test('checkCoverage passes when the diff promotes a release section and no fragment is pending', () => {
  const result = checkCoverage({
    changedFiles: ['scripts/ci/validate-plugin.js', 'CHANGELOG.md'],
    fragments: [],
    markers: [],
    releaseSectionAdded: true,
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.uncovered));
});

test('checkCoverage still fails without a promoted release section (releaseSectionAdded defaults to false)', () => {
  const result = checkCoverage({
    changedFiles: ['scripts/ci/validate-plugin.js', 'CHANGELOG.md'],
    fragments: [],
    markers: [],
    releaseSectionAdded: false,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.uncovered.includes('scripts/ci/validate-plugin.js'));
});

run('changelog-fragments');
