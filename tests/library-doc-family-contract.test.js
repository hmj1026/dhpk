'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { withIsolatedSkill } = require('./_lib/skill-directory-isolation');

// Independent predecessor I/O oracles. These instruction-package checks do not
// claim model execution, consumer installation, or Host runtime evidence.
const fixtures = [
  ['library-author', 'author', 'provider and facade design', /register\(\)/, /authoring decision/i],
  ['library-author', 'testbench', 'Laravel multi-major test matrix', /prefer-lowest/, /TestCase/],
  ['library-author', 'composer', 'Composer public API semver review', /composer validate --strict/, /semver verdict/],
  ['library-author', 'polyfill-audit', 'Monolog version guard branch audit', /branch-specific/, /Matrix gap/i],
  ['library-author', 'suite-map', 'src\/Core\/Storage.php edited', /composer test:core/, /Cross-layer/],
  ['library-author', 'cell-onboard', 'PHP 8.3 Laravel 12 cell', /composer NEEDS/, /onboarding report/],
  ['doc-maintain', 'update', 'refresh stale configuration docs', /documentation only/, /Need Human/],
  ['doc-maintain', 'codemap', 'refresh architecture maps', /30%/, /codemap-diff.txt/],
  ['doc-maintain', 'refactor', 'simplify docs\/guide.md', /one bounded|only the Markdown file/, /Preserved Facts/],
];

for (const [family, mode, input, procedure, output] of fixtures) {
  test(`${family} ${mode}: isolated ${input} preserves its own I/O`, () => {
    const child = { author: 'authoring-patterns.md', testbench: 'testbench-recipes.md', composer: 'package-contracts.md' }[mode];
    const files = ['SKILL.md', `references/${mode}.md`, ...(child ? [`references/${child}`] : [])];
    withIsolatedSkill({ source: path.join(__dirname, '..', 'skills', family), files }, ({ skillDir }) => {
      const entry = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
      const selected = fs.readFileSync(path.join(skillDir, 'references', `${mode}.md`), 'utf8');
      assert.ok(entry.includes(`references/${mode}.md`));
      assert.match(selected, procedure);
      assert.match(selected, output);
      assert.ok(!fs.existsSync(path.join(skillDir, 'scripts')));
      assert.strictEqual(fs.readdirSync(path.join(skillDir, 'references')).length, child ? 2 : 1);
      if (child) {
        assert.ok(selected.includes(child));
        assert.ok(fs.readFileSync(path.join(skillDir, 'references', child), 'utf8').length > 0);
      }
    });
    if (child) {
      assert.throws(() => withIsolatedSkill({ source: path.join(__dirname, '..', 'skills', family),
        files: [...files, 'references/missing-required-child.md'] }, () => {}), /ENOENT/);
      withIsolatedSkill({ source: path.join(__dirname, '..', 'skills', family) }, ({ skillDir }) => {
        fs.unlinkSync(path.join(skillDir, 'references', child));
        assert.throws(() => fs.readFileSync(path.join(skillDir, 'references', child)), /ENOENT/);
      });
    }
  });
}

test('family entrypoints select one procedure and retain distinct output contracts', () => {
  for (const family of ['library-author', 'doc-maintain']) {
    const entry = fs.readFileSync(path.join(__dirname, '..', 'skills', family, 'SKILL.md'), 'utf8');
    assert.match(entry, /only the selected mode/);
    for (const [, mode] of fixtures.filter(([owner]) => owner === family)) {
      assert.ok(entry.includes(`| ${mode} |`));
    }
  }
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'modules', 'library-author', 'agents', 'polyfill-reviewer.md')));
});

test('documentation commands retain stable names and fixed family modes', () => {
  const dispositions = require('../manifests/command-skill-dispositions.json').commands;
  for (const [id, mode] of [['update-docs', 'update'], ['update-codemaps', 'codemap'], ['doc-refactor', 'refactor']]) {
    const row = dispositions.find((entry) => entry.id === id);
    assert.strictEqual(row.skill_owner, 'doc-maintain');
    assert.strictEqual(row.mode, mode);
    const command = fs.readFileSync(path.join(__dirname, '..', 'commands', `${id}.md`), 'utf8');
    assert.ok(command.includes('$doc-maintain'));
    assert.ok(command.includes(mode));
    assert.ok(command.includes('$ARGUMENTS'));
    assert.ok(!command.includes('## Usage Grammar'));
  }
});

const replacements = [
  ['laravel-package-author', 'dhpk-laravel-package-author', 'library-author', 'author'],
  ['laravel-testbench-matrix', 'dhpk-laravel-testbench-matrix', 'library-author', 'testbench'],
  ['composer-package-hygiene', 'dhpk-composer-package-hygiene', 'library-author', 'composer'],
  ['polyfill-version-matrix-audit', 'dhpk-polyfill-version-matrix-audit', 'library-author', 'polyfill-audit'],
  ['library-dual-testsuite-map', 'dhpk-library-dual-testsuite-map', 'library-author', 'suite-map'],
  ['matrix-cell-onboard', 'matrix-cell-onboard', 'library-author', 'cell-onboard'],
  ['update-docs', 'update-docs', 'doc-maintain', 'update'],
  ['update-codemaps', 'update-codemaps', 'doc-maintain', 'codemap'],
  ['doc-refactor', 'doc-refactor', 'doc-maintain', 'refactor'],
];

test('exact nine predecessors retire with independent migration guidance at the helper boundary', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  const wave = inventory.retired_skills.filter((row) => row.reasonCode === 'library-doc-family-consolidation');
  assert.deepStrictEqual(wave.map((row) => row.id).sort(), replacements.map(([id]) => id).sort());
  for (const [id, name, family, mode] of replacements) {
    assert.ok(!inventory.skills.some((row) => row.id === id));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md')));
    for (const identifier of new Set([id, name])) {
      const result = spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'run-skill.sh'), identifier, 'missing.js'], { encoding: 'utf8' });
      assert.notStrictEqual(result.status, 0);
      for (const fragment of [family, mode, '0.66.2', '0.66.1']) assert.ok(result.stderr.includes(fragment), result.stderr);
    }
  }
});

test('previously renamed matrix identity retains retirement guidance without an executable alias', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  const api = require('../scripts/lib/distribution-inventory');
  const row = inventory.renamed_skill_names.find((entry) => entry.id === 'matrix-cell-onboard');
  assert.ok(row, 'historical rename evidence must remain');
  const resolution = api.resolveSkillIdentity({ inventory, identifier: row.oldName });
  assert.strictEqual(resolution.state, 'retired');
  assert.strictEqual(resolution.replacements[0].id, 'library-author');
});

test('keep-separate skills retain independent inventory identities and physical entrypoints', () => {
  const inventory = require('../manifests/distribution-inventory.json');
  for (const id of ['proposal-analyze', 'project-brief', 'issue-analyze', 'repo-intake', 'project-audit', 'repo-verify', 'precommit', 'ui-ux-verify', 'feature-verify', 'tdd', 'legacy-code-characterization', 'opsx-apply-resume', 'openspec-artifact-guard', 'vue-2-notes', 'pr-summary', 'merge-prep']) {
    const row = inventory.skills.find((entry) => entry.id === id);
    assert.ok(row, id);
    assert.ok(fs.existsSync(path.join(__dirname, '..', row.path, 'SKILL.md')), id);
  }
  assert.ok(!require('../manifests/install-profiles.json').profiles.common.skillIds.includes('library-author'));
});

test('active canonical library and documentation delegates have no retired skill pointer', () => {
  const roots = ['skills', 'agents', 'commands', 'modules/library-author', 'rules'];
  const forbidden = replacements.flatMap(([, name]) => [`skills/${name}/SKILL.md`, `$${name}\``]);
  const libraryNames = replacements.slice(0, 5).map(([, name]) => name);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = fs.readFileSync(file, 'utf8');
        for (const token of [...forbidden, ...libraryNames]) assert.ok(!content.includes(token), `${file}: stale ${token}`);
      }
    }
  }
  for (const root of roots) visit(path.join(__dirname, '..', root));
});

run('library-doc-family-contract');
