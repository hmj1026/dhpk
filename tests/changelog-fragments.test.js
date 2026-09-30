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
  const lines = section.split('\n').filter((l) => l.startsWith('- **'));
  assert.deepStrictEqual(lines, [
    '- **BREAKING(zzz)** — Break zzz.',
    '- **feat(alpha)** — Add alpha.',
    '- **fix(beta)** — Fix beta.',
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
  assert.ok(changelog.includes('- **feat(alpha)** — Add alpha.'));
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

{
  // Named source-suite block consolidated from validate-changelog-fragments-cli.test.js.

  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const { test, assert } = require('./_lib/tinytest');

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

  test('--diff-base passes for a bot-authored workflow change without a fragment', () => {
    const repo = mkRepo();
    fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    spawnSync('git', ['add', '-A'], { cwd: repo });
    spawnSync('git', ['commit', '-q', '-m', 'bot updates workflow'], { cwd: repo });
    const res = runCli(repo, ['--diff-base', 'develop', '--bot-authored']);
    assert.strictEqual(res.status, 0, res.stderr);
  });

  test('--diff-base still fails for a human-authored workflow change without a fragment', () => {
    const repo = mkRepo();
    fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    spawnSync('git', ['add', '-A'], { cwd: repo });
    spawnSync('git', ['commit', '-q', '-m', 'human updates workflow'], { cwd: repo });
    const res = runCli(repo, ['--diff-base', 'develop']);
    assert.notStrictEqual(res.status, 0, res.stdout);
    assert.match(res.stderr, /missing release fragment/);
    assert.match(res.stderr, /.github\/workflows\/ci\.yml/);
  });
}

{
  // Named source-suite block consolidated from current-changelog.test.js.

  const fs = require('node:fs');
  const path = require('node:path');
  const { test, assert } = require('./_lib/tinytest');

  const ROOT = path.join(__dirname, '..');
  const version = JSON.parse(fs.readFileSync(
    path.join(ROOT, '.claude-plugin', 'plugin.json'),
    'utf8',
  )).version;

  function currentVersionHeadings(text) {
    const escapedVersion = version.split('.').join('\\.');
    const heading = new RegExp(`^## ${escapedVersion}(?= )`, 'gm');
    return text.match(heading) || [];
  }

  test('current release has one changelog section', () => {
    const controlled = `## ${version} — exact\n\n## ${version}.1 — longer version\n`;
    assert.deepStrictEqual(currentVersionHeadings(controlled), [`## ${version}`]);

    const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const matches = currentVersionHeadings(changelog);
    assert.strictEqual(matches.length, 1,
      `expected exactly one CHANGELOG.md heading for ${version}, found ${matches.length}`);
  });
}

run('changelog-fragments');
