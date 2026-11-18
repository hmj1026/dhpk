'use strict';

// One Public Plugin tree (#1495): the committed Codex native package and the
// OpenAI submission ZIP are two outputs of the same tree, and both expose
// exactly the public catalog as their skill set.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { compileMarketplacePublicationView } = require('../scripts/lib/marketplace-selection');
const { compileOpenaiSubmissionPackage } = require('../scripts/lib/openai-submission-package');
const { NATIVE_RECEIPT_FILES } = require('../scripts/lib/public-plugin-tree');
const { checkPublicPlugin } = require('../scripts/lib/publication-conformance');
const { readSourceVersion, renderOpenaiSubmissionManifest } = require('../scripts/lib/host-manifests');

const ROOT = path.join(__dirname, '..');
const NATIVE_ROOT = path.join(ROOT, 'plugins', 'dhpk');
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

function listFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

function publicCatalog() {
  const inventory = readJson('manifests/distribution-inventory.json');
  const selection = readJson('manifests/marketplace-selection.json');
  const view = compileMarketplacePublicationView({ inventory, selection });
  assert.deepStrictEqual(view.errors, []);
  return { inventory, selection, view };
}

function buildSubmissionTree() {
  const { inventory, selection } = publicCatalog();
  const version = readSourceVersion(ROOT);
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(tracked.status, 0);
  const compiled = compileOpenaiSubmissionPackage({
    root: ROOT,
    inventory,
    selection,
    manifest: renderOpenaiSubmissionManifest(ROOT, version),
    sourceIdentity: { version, commit: SOURCE_COMMIT },
    sourceFileAllowlist: new Set(tracked.stdout.split('\0').filter(Boolean)),
  });
  assert.deepStrictEqual(compiled.errors, []);
  return new Map(compiled.files.map((file) => [file.path, file.bytes]));
}

const topLevelSkills = (paths) => [...new Set(paths.filter((p) => p.startsWith('skills/')).map((p) => p.split('/')[1]))].sort();

test('Codex native package files equal the OpenAI submission tree byte for byte', () => {
  const submission = buildSubmissionTree();
  const native = new Map(listFiles(NATIVE_ROOT)
    .filter((relative) => !NATIVE_RECEIPT_FILES.includes(relative))
    .map((relative) => [relative, fs.readFileSync(path.join(NATIVE_ROOT, relative))]));

  assert.deepStrictEqual([...native.keys()].sort(), [...submission.keys()].sort());
  const differing = [...submission].filter(([relative, bytes]) => !bytes.equals(native.get(relative)));
  assert.deepStrictEqual(differing.map(([relative]) => relative), []);
});

test('Codex native and the OpenAI submission expose the public catalog as their skill set', () => {
  const { view } = publicCatalog();
  const catalogNames = view.publicEntries.map((entry) => entry.name).sort();
  const nativeNames = fs.readdirSync(path.join(NATIVE_ROOT, 'skills')).sort();

  assert.deepStrictEqual(nativeNames, catalogNames);
  assert.deepStrictEqual(topLevelSkills([...buildSubmissionTree().keys()]), catalogNames);
});

test('Codex native package carries no Host-only skill', () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(NATIVE_ROOT, 'provenance.json'), 'utf8'));
  assert.deepStrictEqual(provenance.marketplacePublication.hostOnlyIds, []);
  assert.deepStrictEqual(provenance.selectedSkillIds, provenance.marketplacePublication.publicEntryIds);
});

test('Codex native manifest is derived from the OpenAI manifest', () => {
  const openai = JSON.parse(fs.readFileSync(path.join(NATIVE_ROOT, 'plugin.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(NATIVE_ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(codex.name, openai.name);
  assert.strictEqual(codex.version, openai.version);
  assert.strictEqual(codex.version, readSourceVersion(ROOT));
  assert.strictEqual(codex.description, openai.description);
  assert.strictEqual(codex.skills, './skills/');
});

test('built Public Plugin passes the publication conformance rules', () => {
  assert.deepStrictEqual(checkPublicPlugin(buildSubmissionTree(), { version: readSourceVersion(ROOT) }), []);
});

test('built Public Plugin listing counts come from the catalog', () => {
  const { view } = publicCatalog();
  const tree = buildSubmissionTree();
  const listing = JSON.parse(tree.get('plugin.json').toString('utf8')).extensions['com.openai'].interface;
  assert.ok(listing.longDescription.includes(`${view.publicEntries.length} general`), listing.longDescription);
  assert.ok(listing.shortDescription.length <= 30);
  assert.strictEqual(listing.composerIcon, './assets/dhpk-icon.svg');
});

test('canonical skill sources keep their distribution.yaml and metadata', () => {
  const source = fs.readFileSync(path.join(ROOT, 'skills', 'flow-guide', 'SKILL.md'), 'utf8');
  assert.match(source, /dhpk-capability-id/);
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'flow-guide', 'distribution.yaml')));
});

run('public-plugin-tree');
