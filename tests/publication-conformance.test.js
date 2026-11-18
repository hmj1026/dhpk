'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { checkPublicPlugin, checkDirectoryPlugin, runClaudeValidate } = require('../scripts/lib/publication-conformance');

const VERSION = '1.2.3';
const LISTING = {
  shortDescription: 'Skills for software delivery',
  longDescription: 'A plugin with 1 general workflows and 1 bundled specialist reference resources.',
  composerIcon: './assets/icon.svg',
  logo: './assets/icon.svg',
};
const withListing = (overrides = {}) => ({ extensions: { 'com.openai': { interface: { ...LISTING, ...overrides } } } });
const manifest = (extra = {}) => Buffer.from(JSON.stringify({ name: 'dhpk', version: VERSION, ...withListing(), ...extra }));
const tree = (overrides = {}) => new Map(Object.entries({
  'plugin.json': manifest(),
  'skills/a/SKILL.md': Buffer.from('---\nname: a\n---\n'),
  'skills/a/references/b/REFERENCE.md': Buffer.from('---\nname: b\n---\n'),
  'assets/icon.svg': Buffer.from('<svg/>'),
  ...overrides,
}));

test('conformant Public Plugin passes', () => {
  assert.deepStrictEqual(checkPublicPlugin(tree(), { version: VERSION }), []);
});

test('Public Plugin with a hooks directory fails', () => {
  const errors = checkPublicPlugin(tree({ 'hooks/hooks.json': Buffer.from('{}') }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin with a hooks manifest key fails', () => {
  const errors = checkPublicPlugin(tree({ 'plugin.json': manifest({ hooks: './hooks/hooks.json' }) }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin hooks inside the Codex manifest fail', () => {
  const errors = checkPublicPlugin(tree({ '.codex-plugin/plugin.json': manifest({ hooks: {} }) }), { version: VERSION });
  assert.ok(errors.some((error) => /hooks/.test(error)), errors.join('; '));
});

test('Public Plugin version differing from package.json fails', () => {
  const errors = checkPublicPlugin(tree({ 'plugin.json': manifest({ version: '0.64.4' }) }), { version: VERSION });
  assert.ok(errors.some((error) => /0\.64\.4/.test(error) && /1\.2\.3/.test(error)), errors.join('; '));
});

test('Public Plugin without a manifest fails', () => {
  const files = tree();
  files.delete('plugin.json');
  assert.ok(checkPublicPlugin(files, { version: VERSION }).length > 0);
});

const run1 = (files) => checkPublicPlugin(files, { version: VERSION });
const mentions = (errors, pattern) => errors.some((error) => pattern.test(error));

test('conformant Public Plugin passes with catalog counts', () => {
  assert.deepStrictEqual(run1(tree()), []);
});

test('Public Plugin carrying distribution.yaml fails', () => {
  const errors = run1(tree({ 'skills/a/distribution.yaml': Buffer.from('{}') }));
  assert.ok(mentions(errors, /distribution\.yaml/), errors.join('; '));
});

test('Public Plugin skill with dhpk metadata fails', () => {
  const skill = Buffer.from('---\nname: a\nmetadata:\n  dhpk-capability-id: "x"\n---\n');
  const errors = run1(tree({ 'skills/a/SKILL.md': skill }));
  assert.ok(mentions(errors, /dhpk-capability-id/), errors.join('; '));
});

test('Public Plugin with a nested reference SKILL.md fails', () => {
  const errors = run1(tree({ 'skills/a/references/c/SKILL.md': Buffer.from('---\nname: c\n---\n') }));
  assert.ok(mentions(errors, /skills\/a\/references\/c\/SKILL\.md/), errors.join('; '));
});

test('Public Plugin icon outside ./assets/ fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ logo: './skills/a/assets/icon.svg' })) }));
  assert.ok(mentions(errors, /logo/), errors.join('; '));
});

test('Public Plugin icon missing from the tree fails', () => {
  const files = tree();
  files.delete('assets/icon.svg');
  assert.ok(mentions(run1(files), /composerIcon/));
});

test('Public Plugin shortDescription over 30 characters fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ shortDescription: 'x'.repeat(31) })) }));
  assert.ok(mentions(errors, /shortDescription/), errors.join('; '));
});

test('Public Plugin truncated shortDescription fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ shortDescription: 'Skills for software...' })) }));
  assert.ok(mentions(errors, /shortDescription/), errors.join('; '));
});

test('Public Plugin longDescription counts that disagree with the content fail', () => {
  const stale = 'A plugin with 15 general workflows and 45 bundled specialist reference resources.';
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: stale })) }));
  assert.ok(mentions(errors, /15 workflows/) && mentions(errors, /45 reference/), errors.join('; '));
});

test('Public Plugin longDescription without counts fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: 'No numbers here.' })) }));
  assert.ok(mentions(errors, /longDescription/), errors.join('; '));
});

test('Public Plugin longDescription with an unresolved count token fails', () => {
  const errors = run1(tree({ 'plugin.json': manifest(withListing({ longDescription: '{workflowCount} general workflows and {referenceCount} bundled specialist reference resources.' })) }));
  assert.ok(mentions(errors, /longDescription/), errors.join('; '));
});

const words = (count) => Buffer.from(Array.from({ length: count }, () => 'word').join(' '));
const directoryManifest = (extra = {}) => Buffer.from(JSON.stringify({
  name: 'dhpk', version: VERSION, homepage: 'https://example.com/dhpk', repository: 'https://example.com/dhpk.git',
  icon: './.claude-plugin/icon.png', ...extra,
}));
// A null override removes that file from the tree.
const directoryTree = (overrides = {}) => {
  const files = new Map(Object.entries({
    '.claude-plugin/plugin.json': directoryManifest(),
    '.claude-plugin/icon.png': Buffer.from('png'),
    'README.md': words(45),
    LICENSE: Buffer.from('MIT'),
    'skills/a/SKILL.md': Buffer.from('---\nname: a\n---\n'),
    ...overrides,
  }));
  for (const [file, value] of [...files]) if (value === null) files.delete(file);
  return files;
};
const directoryErrors = (overrides) => checkDirectoryPlugin(directoryTree(overrides), { version: VERSION });

test('conformant Directory Plugin passes', () => {
  assert.deepStrictEqual(directoryErrors(), []);
});

test('Directory Plugin carrying docs, CI, or release files fails', () => {
  for (const file of ['docs/guide.md', '.github/workflows/ci.yml', 'scripts/ci/gen.js', 'scripts/release/prepare.js']) {
    const errors = directoryErrors({ [file]: Buffer.from('x') });
    assert.ok(errors.some((error) => error.includes(file)), `${file}: ${errors.join('; ')}`);
  }
});

test('Directory Plugin keeps runtime scripts and hooks', () => {
  assert.deepStrictEqual(directoryErrors({
    'scripts/hooks/a.sh': Buffer.from('x'), 'hooks/hooks.json': Buffer.from('{}'), 'scripts/ci/_lib/frontmatter.js': Buffer.from('x'),
  }), []);
});

test('Directory Plugin README under 40 words fails and 40 words passes', () => {
  const errors = directoryErrors({ 'README.md': words(39) });
  assert.ok(errors.some((error) => /40 words/.test(error)), errors.join('; '));
  assert.deepStrictEqual(directoryErrors({ 'README.md': words(40) }), []);
});

test('Directory Plugin missing README or LICENSE fails', () => {
  assert.ok(directoryErrors({ 'README.md': null }).some((error) => /README/.test(error)));
  assert.ok(directoryErrors({ LICENSE: null }).some((error) => /LICENSE/.test(error)));
});

test('Directory Plugin manifest without icon, repository, or URL fields fails', () => {
  for (const field of ['icon', 'repository', 'homepage']) {
    const manifest = JSON.parse(directoryManifest().toString());
    delete manifest[field];
    const errors = directoryErrors({ '.claude-plugin/plugin.json': Buffer.from(JSON.stringify(manifest)) });
    assert.ok(errors.some((error) => error.includes(field)), `${field}: ${errors.join('; ')}`);
  }
});

test('Directory Plugin icon that is not packaged fails', () => {
  const errors = directoryErrors({ '.claude-plugin/icon.png': null });
  assert.ok(errors.some((error) => /icon/.test(error)), errors.join('; '));
});

test('Directory Plugin non-https URL field fails', () => {
  const errors = directoryErrors({ '.claude-plugin/plugin.json': directoryManifest({ repository: 'git@host:x.git' }) });
  assert.ok(errors.some((error) => /repository/.test(error)), errors.join('; '));
});

test('Directory Plugin version differing from package.json fails', () => {
  const errors = directoryErrors({ '.claude-plugin/plugin.json': directoryManifest({ version: '0.64.4' }) });
  assert.ok(errors.some((error) => /0\.64\.4/.test(error) && /1\.2\.3/.test(error)), errors.join('; '));
});

test('Directory Plugin without a manifest fails', () => {
  assert.ok(directoryErrors({ '.claude-plugin/plugin.json': null }).some((error) => /plugin\.json/.test(error)));
});

const filler = (count) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`skills/a/references/f${index}.md`, Buffer.from('x')]));
// directoryTree already holds 5 files.
const BASE_FILES = 5;

test('Directory Plugin at 512 files passes and 513 files fails', () => {
  assert.deepStrictEqual(directoryErrors(filler(512 - BASE_FILES)), []);
  const errors = directoryErrors(filler(513 - BASE_FILES));
  assert.ok(errors.some((error) => /513 files/.test(error) && /512/.test(error)), errors.join('; '));
});

test('Directory Plugin non-image file over 256 KiB fails and 256 KiB passes', () => {
  assert.deepStrictEqual(directoryErrors({ 'scripts/a.js': Buffer.alloc(256 * 1024) }), []);
  const errors = directoryErrors({ 'scripts/big.js': Buffer.alloc(256 * 1024 + 1) });
  assert.ok(errors.some((error) => error.includes('scripts/big.js') && /256 KiB/.test(error)), errors.join('; '));
});

test('Directory Plugin image over 256 KiB is allowed', () => {
  assert.deepStrictEqual(directoryErrors({ '.claude-plugin/icon.png': Buffer.alloc(300 * 1024) }), []);
});

test('claude plugin validate passes when the runner exits 0', () => {
  const seen = [];
  assert.deepStrictEqual(runClaudeValidate('/pkg', (directory) => { seen.push(directory); return { status: 0, output: 'ok' }; }), []);
  assert.deepStrictEqual(seen, ['/pkg']);
});

test('claude plugin validate failure and missing CLI are reported', () => {
  const failed = runClaudeValidate('/pkg', () => ({ status: 1, output: 'missing README' }));
  assert.ok(failed.some((error) => /exit 1/.test(error) && /missing README/.test(error)), failed.join('; '));
  const missing = runClaudeValidate('/pkg', () => ({ error: 'ENOENT' }));
  assert.ok(missing.some((error) => /could not run/.test(error)), missing.join('; '));
});

const skillWith = (text) => tree({ 'skills/a/references/guide.md': Buffer.from(text) });

test('Public Plugin may name consumer-project output, cache, and settings paths', () => {
  for (const text of [
    'Write to `.claude/artifacts/reviews/x.md` or `.codex/artifacts/reviews/x.md`.',
    'Logs go under `.claude/cache/verify/<repoKey>/`; see ~/.claude/cache/repo-intake/.',
    'Read `.claude/settings.local.json` before `.claude/settings.json`; see `.codex/config.toml`.',
    'Run `node .claude/dhpk/skills/repo-verify/scripts/verify-runner.js` when present.',
    'Excludes `.claude/`, `.codex/` and `.git/` directories.',
  ]) assert.deepStrictEqual(run1(skillWith(text)), [], text);
});

test('Public Plugin telling the agent to read dhpk-internal harness content fails', () => {
  for (const text of [
    'Read `.claude/rules/execution-policy.md` first.',
    'Delegate to `.claude/agents/code-reviewer.md`.',
    'See `.codex/agents/tdd-guide.toml`.',
    'Follow .claude/docs/guide.md.',
  ]) {
    const errors = run1(skillWith(text));
    assert.ok(mentions(errors, /dhpk-internal path \.(claude|codex)\//), `${text}: ${errors.join('; ')}`);
  }
});

test('Public Plugin harness path allowance is per file for shipped scripts', () => {
  const comment = Buffer.from('# see .claude/rules/dev-workflow-project.md\n');
  assert.deepStrictEqual(run1(tree({ 'skills/a/scripts/prepare_dev_scope.py': comment })), []);
  assert.ok(run1(tree({ 'skills/a/scripts/other.py': comment })).length > 0);
});

run('publication-conformance');
