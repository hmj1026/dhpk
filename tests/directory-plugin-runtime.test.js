'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const fs = require('node:fs');
const path = require('node:path');
const { selectRuntimeFiles } = require('../scripts/lib/directory-plugin-runtime');

const entry = (text) => ({ content: Buffer.from(text), mode: 0o644 });
const tree = (paths) => new Map(paths.map((file) => [file, entry(file)]));
const selected = (paths) => [...selectRuntimeFiles(tree(paths)).keys()].sort();

test('runtime directories and hook scripts are kept', () => {
  const paths = ['skills/a/SKILL.md', 'agents/a.md', 'hooks/hooks.json', 'scripts/hooks/a.sh', 'scripts/lib/a.js', 'manifests/m.json'];
  assert.deepStrictEqual(selected(paths), [...paths].sort());
});

test('docs, CI, release, and maintainer files are dropped', () => {
  const dropped = ['docs/a.md', 'docs/adr/0001.md', 'scripts/ci/gen.js', 'scripts/release/prepare.js', 'scripts/maintainer/x.js', 'scripts/validate/v.js'];
  assert.deepStrictEqual(selected(['skills/a/SKILL.md', ...dropped]), ['skills/a/SKILL.md']);
});

test('the shared CI library that runtime scripts require is kept', () => {
  assert.deepStrictEqual(selected(['scripts/ci/_lib/frontmatter.js', 'scripts/ci/gen.js']), ['scripts/ci/_lib/frontmatter.js']);
});

test('per-skill build metadata, OpenAI listing metadata, and eval fixtures are dropped', () => {
  const dropped = [
    'skills/a/distribution.yaml', 'skills/a/references/b/distribution.yaml', 'skills/a/agents/openai.yaml',
    'skills/a/evals/evals.json', 'skills/a/references/b/evals/x/fixture.sh', 'skills/a/scripts/check-golden.sh',
  ];
  assert.deepStrictEqual(selected(['skills/a/SKILL.md', 'skills/a/scripts/run.sh', ...dropped]), ['skills/a/SKILL.md', 'skills/a/scripts/run.sh']);
});

test('build-only libraries and manifests are dropped while runtime ones are kept', () => {
  const dropped = ['scripts/lib/publication-conformance.js', 'scripts/lib/openai-submission-zip.js', 'manifests/skill-resources.json', 'scripts/dhpk-install.js'];
  const kept = ['scripts/lib/dispatch-config.js', 'manifests/host-profiles.json', 'scripts/hooks/install-codex-skills.sh'];
  assert.deepStrictEqual(selected([...dropped, ...kept]), [...kept].sort());
});

test('stack skills leave the core selection and map to top-level dhpk-stacks skills', () => {
  const { stackSkillDestination } = require('../scripts/lib/directory-plugin-runtime');
  const stack = ['skills/flow-drive/references/swift/SKILL.md', 'skills/flow-drive/references/js-static-checks/scripts/a.js'];
  const kept = ['skills/flow-drive/SKILL.md', 'skills/flow-drive/references/vue-2-notes/SKILL.md'];
  assert.deepStrictEqual(selected([...stack, ...kept]), [...kept].sort());
  assert.deepStrictEqual(stack.map(stackSkillDestination), ['skills/swift/SKILL.md', 'skills/js-static-checks/scripts/a.js']);
  assert.deepStrictEqual(kept.map(stackSkillDestination), [null, null]);
  assert.strictEqual(stackSkillDestination('skills/flow-drive/references/swift/distribution.yaml'), null);
});

// A dropped module that a shipped script still requires would crash at runtime.
test('every relative require in the committed Directory Plugin resolves inside the package', () => {
  const root = path.join(__dirname, '..', 'dist', 'claude-marketplace', 'package');
  const files = new Set();
  const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(full); else files.add(path.relative(root, full).split(path.sep).join('/'));
  });
  visit(root);
  const missing = [];
  for (const file of files) {
    if (!/\.(?:js|cjs)$/.test(file)) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, spec] of text.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (![base, `${base}.js`, `${base}.json`, `${base}.cjs`, `${base}/index.js`].some((candidate) => files.has(candidate))) missing.push(`${file} -> ${spec}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('selection returns a new Map and leaves its input intact', () => {
  const input = tree(['docs/a.md', 'skills/a/SKILL.md']);
  const output = selectRuntimeFiles(input);
  assert.notStrictEqual(output, input);
  assert.strictEqual(input.size, 2);
});

run('directory-plugin-runtime');
