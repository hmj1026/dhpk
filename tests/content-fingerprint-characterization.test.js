'use strict';

// Characterization of every tree-fingerprint site in the ledger of OpenSpec
// change unify-tree-fingerprint-algorithm (tasks 1.1 to 1.5). The tests pin
// today's values for the MIGRATE and STAYS sites so the migration cannot change
// a value silently. They hold on the unchanged tree and are rewritten per site
// as the migration lands.
//
// Oracles: checked-in package fingerprints.json, the adversarial fixture, pinned
// literal digests, and the frozen marker-less installer receipt and journal under
// tests/fixtures/tree-fingerprint/installer. No test here calls a removed
// directory-tree recipe or accepts a marker-less record.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { loadPrivateFunction } = require('./_lib/private-function');
const receipts = require('../scripts/lib/receipt-primitives');
const { fingerprintDir: codexFingerprintDir } = require('../scripts/lib/codex-native-package');
const { fingerprintDir: agentFingerprintDir } = require('../scripts/lib/agent-plugin-package');
const { fingerprintPath: cursorFingerprintPath } = require('../scripts/lib/cursor-plugin-package');
const { fingerprintPath: gateFingerprintPath, fingerprintDir: gateFingerprintDir } = require('../scripts/release/consumer-gate');
const { packageFingerprints } = require('../scripts/lib/release-artifact-manifest');
const marketplace = require('../scripts/ci/gen-claude-marketplace-package');
const agentsSkills = require('../scripts/lib/agents-skills-package');
const publisher = require('../scripts/lib/project-agent-projection-publisher');
const { collectDirectoryEntries, treeFingerprint, resolveFingerprintAlgorithm } = require('../scripts/lib/content-fingerprint');

const ROOT = path.resolve(__dirname, '..');
// 原 fixture 的 B.txt 與 b.txt 在大小寫不敏感檔案系統衝突，磁碟路徑改為獨立名稱。
const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');
const INSTALLER_FIXTURE = path.join(__dirname, 'fixtures', 'tree-fingerprint', 'installer');

// Portable disk-tree vectors were independently calculated from the documented recipes.
const GOLDEN = Object.freeze({
  receiptDirectory: 'sha256:c998499fbdd7157a0996c1abad90ebac4f258174cc02f0f25237a74dfdaaa7db',
  // tree-merkle-v1 over the complete view (bytecode kept, empty directory dropped),
  // independently calculated for the portable fixture.
  treeCompleteView: '2c0abd25ce032fe1989e0061318a6b1250e108300518a83201736feacf6434e7',
  // tree-merkle-v1 over the source view (bytecode skipped).
  treeSourceView: '7cd0eb904f97b8f1fb8739c89f8a769b1e5cc23c7eb53270d7aca42b451aa283',
  marketplace: '1c88b0645052c224f376c1e49e304899fda0f385b707faf8146f8c82f006645b',
  rollbackDirectory: 'directory:c022808b888f5a8d362a6bf8f8227480c8634ea95321edadf26c2642b7d49d22',
  rollbackFile: 'file:debd29241d0ff114ef5f5914063fa74abb97a77573e2e1c320eac1691f26445a',
  baselineSource: 'b24d5b99ad7e9cc2a57d4b1d7d04396f767d12a3d8a70b517f63e91643809a4c',
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Recipe named by the tracked package's provenance marker.
function packageAlgorithm(packageName) {
  return resolveFingerprintAlgorithm(readJson(path.join(ROOT, 'plugins', packageName, 'provenance.json')));
}

function tempDir(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `tree-fingerprint-${label}-`)));
}

function buildAdversarialTree() {
  const dir = tempDir('adversarial');
  fs.cpSync(ADVERSARIAL, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'empty'));
  fs.mkdirSync(path.join(dir, '__pycache__'));
  fs.writeFileSync(path.join(dir, '__pycache__', 'x.pyc'), 'pyc');
  fs.writeFileSync(path.join(dir, 'skip.pyc'), 'pyc2');
  for (const file of ['a.txt', 'a/inner.txt', 'upper-B.txt', 'b.txt', 'sub/Z.txt', 'sub/a.txt', 'sub/binary.bin']) {
    fs.chmodSync(path.join(dir, file), 0o644);
  }
  fs.chmodSync(path.join(dir, 'b.txt'), 0o755);
  return dir;
}

function withTree(callback) {
  const dir = buildAdversarialTree();
  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Row 1 (STAYS) receipt-primitives fingerprintDirectory
// ---------------------------------------------------------------------------

test('row 1 STAYS: receipt-primitives fingerprintDirectory keeps modes, empty directories, and bytecode', () => {
  withTree((dir) => {
    assert.strictEqual(receipts.fingerprintDirectory(dir), GOLDEN.receiptDirectory);
  });
});

test('tree-merkle-v1 pins the adversarial tree: complete view keeps bytecode, source view skips it, empty directories never count', () => {
  withTree((dir) => {
    const files = (options) => collectDirectoryEntries(dir, options).filter((entry) => entry.type === 'file');
    assert.strictEqual(treeFingerprint(files({})), GOLDEN.treeCompleteView);
    assert.strictEqual(treeFingerprint(files({ skipBytecode: true })), GOLDEN.treeSourceView);
    assert.notStrictEqual(GOLDEN.treeCompleteView, GOLDEN.treeSourceView);
  });
});

// ---------------------------------------------------------------------------
// Rows 2-7 (MIGRATE) package verifiers against the checked-in fingerprints
// ---------------------------------------------------------------------------

test('rows 2-3: Codex fingerprintDir reproduces every plugins/dhpk fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk', 'fingerprints.json'));
  const algorithm = packageAlgorithm('dhpk');
  assert.ok(Object.keys(recorded).length > 0);
  for (const [name, value] of Object.entries(recorded)) {
    assert.strictEqual(codexFingerprintDir(path.join(ROOT, 'plugins', 'dhpk', 'skills', name), { algorithm }), value, name);
  }
});

test('rows 4-5: Agent fingerprintDir reproduces every plugins/dhpk-agent fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk-agent', 'fingerprints.json')).skills;
  const algorithm = packageAlgorithm('dhpk-agent');
  assert.ok(Object.keys(recorded).length > 0);
  for (const [name, value] of Object.entries(recorded)) {
    assert.strictEqual(agentFingerprintDir(path.join(ROOT, 'plugins', 'dhpk-agent', 'skills', name), { algorithm }), value, name);
  }
});

test('rows 6-7: Cursor fingerprintPath reproduces every plugins/dhpk-cursor fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk-cursor', 'fingerprints.json'));
  assert.ok(Object.keys(recorded).length > 0);
  for (const [key, value] of Object.entries(recorded)) {
    assert.strictEqual(cursorFingerprintPath(path.join(ROOT, 'plugins', 'dhpk-cursor', key), { algorithm: 'tree-merkle-v1' }), value, key);
  }
});

test('row 17: the AGY provenance fingerprints hold no directory-level entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk-agy', 'fingerprints.json')).files;
  for (const relative of Object.keys(recorded)) {
    assert.ok(fs.statSync(path.join(ROOT, 'plugins', 'dhpk-agy', relative)).isFile(), relative);
  }
});

// ---------------------------------------------------------------------------
// Row 8 (MIGRATE recipe, KEEP walk) consumer gate fingerprintPath
// ---------------------------------------------------------------------------

test('row 8: gate fingerprintPath follows an approved-root symlink and returns empty for a missing path', () => {
  const root = tempDir('gate-follow');
  try {
    fs.mkdirSync(path.join(root, 'real'));
    fs.writeFileSync(path.join(root, 'real', 'f.txt'), 'content');
    fs.mkdirSync(path.join(root, 'plain'));
    fs.writeFileSync(path.join(root, 'plain', 'f.txt'), 'content');
    fs.symlinkSync('real', path.join(root, 'linked'));
    assert.strictEqual(
      gateFingerprintPath(path.join(root, 'linked'), { allowedRoots: [root] }),
      gateFingerprintPath(path.join(root, 'plain')),
    );
    assert.strictEqual(gateFingerprintPath(path.join(root, 'absent')), '');
    assert.throws(() => gateFingerprintPath(path.join(root, 'linked')), /approved root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('row 3: gate fingerprintDir (project skill verifier) reproduces a plugins/dhpk fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk', 'fingerprints.json'));
  const name = Object.keys(recorded)[0];
  assert.strictEqual(gateFingerprintDir(path.join(ROOT, 'plugins', 'dhpk', 'skills', name), { algorithm: packageAlgorithm('dhpk') }), recorded[name]);
});

// ---------------------------------------------------------------------------
// Rows 9-10 (MIGRATE) agents-skills and publisher receipts
// ---------------------------------------------------------------------------

// Digest of the removed `path NUL bytes NUL` receipt recipe over the two files
// that row 9 writes, captured on 2026-11-02 before the recipe was deleted. Any
// value that is not the tree-merkle-v1 digest must read as drift.
const REMOVED_RECIPE_SOURCE_DIGEST = '7b8a0ea7b00375ee7a2c2809268b7fab3599c62534f642627e853fcd4406cd5f';

test('row 9: agents-skills receipt is tree-merkle-v1, a removed-recipe value under the marker is drift, and an unsupported generator version is rejected', () => {
  assert.strictEqual(agentsSkills.GENERATOR_VERSION, '1.1.0');
  const root = tempDir('agents-skills');
  try {
    const skill = { id: 'sample', name: 'dhpk-sample', path: 'skills/dhpk-sample', lifecycle: 'promoted', surfaces: ['agent-plugin'] };
    const files = {
      'SKILL.md': '---\nname: dhpk-sample\ndescription: Fixture.\n---\n# Sample\n',
      'references/guide.md': '# Guide\n',
    };
    for (const [relative, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, skill.path, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, skill.path, relative), content);
    }
    const inventory = {
      schema: 'dhpk.distribution-inventory.v2',
      skills: [skill],
      surface_membership: { 'agent-plugin': [skill.id] },
      retired_skills: [],
    };
    const outDir = path.join(root, '.agents', 'skills');
    agentsSkills.materializeAgentsSkillsProjection({ root, inventory, outDir });
    const receiptPath = path.join(outDir, '.dhpk-projection.json');
    const receipt = readJson(receiptPath);
    assert.strictEqual(receipt.generatorVersion, '1.1.0');
    assert.strictEqual(receipt.fingerprint_algorithm, 'tree-merkle-v1');
    assert.strictEqual(receipt.entries.length, 1);
    const entry = receipt.entries[0];
    const contents = entry.sourceFiles.map((file) => ({
      path: file.path,
      content: fs.readFileSync(path.join(root, skill.path, file.path)),
    }));
    assert.strictEqual(entry.sourceFingerprint, treeFingerprint(contents.map((file) => ({ ...file, type: 'file' }))));
    assert.deepStrictEqual(entry.sourceFiles.map((file) => file.path).sort(), Object.keys(files).sort());

    // A value from the removed recipe under the tree marker is drift, never accepted by trying both recipes.
    const drifted = { ...receipt, entries: receipt.entries.map((candidate) => ({ ...candidate, sourceFingerprint: REMOVED_RECIPE_SOURCE_DIGEST })) };
    fs.writeFileSync(receiptPath, `${JSON.stringify(drifted)}\n`);
    assert.ok(agentsSkills.validateAgentsSkillsProjection({ root, inventory, outDir }).errors.some((error) => /source fingerprint drifted/.test(error)));

    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, generatorVersion: '0.9.0' })}\n`);
    assert.throws(
      () => agentsSkills.materializeAgentsSkillsProjection({ root, inventory, outDir }),
      /generator 1\.1\.0/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('row 10: publisher receipt is tree-merkle-v1 over real skills and an unsupported generator version is rejected', () => {
  assert.strictEqual(publisher.GENERATOR_VERSION, '2.1.0');
  const project = tempDir('publisher');
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js'),
      '--source-root', ROOT, '--project-root', project, '--profile', 'portable-core',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    const receiptPath = path.join(project, '.agents', '.dhpk-installed.json');
    const receipt = readJson(receiptPath);
    assert.strictEqual(receipt.generatorVersion, '2.1.0');
    assert.strictEqual(receipt.fingerprint_algorithm, 'tree-merkle-v1');
    let verified = 0;
    for (const entry of receipt.entries) {
      // Standalone dependencies are not under the skill directory: read those
      // from the generated copy, trusted only when it matches the recorded digest.
      const contents = entry.sourceFiles.map((file) => {
        const source = path.join(ROOT, entry.source, file.path);
        const generated = path.join(project, '.agents', 'skills', entry.name, file.path);
        const content = fs.existsSync(source) ? fs.readFileSync(source) : (fs.existsSync(generated) ? fs.readFileSync(generated) : null);
        return content && crypto.createHash('sha256').update(content).digest('hex') === file.digest ? { path: file.path, content } : null;
      });
      if (contents.some((file) => file === null)) continue;
      assert.strictEqual(entry.sourceFingerprint, treeFingerprint(contents.map((file) => ({ ...file, type: 'file' }))), entry.stableId);
      verified += 1;
    }
    assert.strictEqual(verified, receipt.entries.length, 'every entry is verifiable from its canonical source files');
    assert.ok(verified > 0, 'at least one entry must be verifiable from its canonical source files');

    const validate = () => spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js'), '--source-root', ROOT, '--project-root', project,
    ], { cwd: ROOT, encoding: 'utf8' });
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, generatorVersion: '0.9.0' })}\n`);
    const rejected = validate();
    assert.notStrictEqual(rejected.status, 0);
    assert.match(`${rejected.stdout}${rejected.stderr}`, /generator 2\.1\.0/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Row 11 (MIGRATE directly) baseline source tree; rows 13-14 (STAYS)
// ---------------------------------------------------------------------------

const BASELINE_SCOPE = { fs, path, collectDirectoryEntries, treeFingerprint };

test('row 11: baseline sourceTreeFingerprint migrated directly to tree-merkle-v1 and now refuses symlinks', () => {
  const sourceTreeFingerprint = loadPrivateFunction('scripts/ci/project-agent-projection-baseline.js', 'sourceTreeFingerprint', BASELINE_SCOPE);
  const root = tempDir('baseline');
  try {
    fs.cpSync(ADVERSARIAL, path.join(root, 'skill'), { recursive: true });
    const value = sourceTreeFingerprint(root, { path: 'skill' });
    const files = ['a/inner.txt', 'a.txt', 'b.txt', 'upper-B.txt', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
    assert.strictEqual(value, treeFingerprint(files.map((file) => ({ path: file, type: 'file', content: fs.readFileSync(path.join(ADVERSARIAL, file)) }))));
    fs.symlinkSync('a.txt', path.join(root, 'skill', 'link.txt'));
    assert.throws(() => sourceTreeFingerprint(root, { path: 'skill' }), /cannot fingerprint symlink 'link\.txt'/);
    assert.strictEqual(sourceTreeFingerprint(root, { path: '../escape' }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('row 11: baseline skips bytecode and ignores empty directories on the adversarial tree', () => {
  const sourceTreeFingerprint = loadPrivateFunction('scripts/ci/project-agent-projection-baseline.js', 'sourceTreeFingerprint', BASELINE_SCOPE);
  withTree((dir) => {
    const files = ['a/inner.txt', 'a.txt', 'b.txt', 'upper-B.txt', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
    const expected = treeFingerprint(files.map((file) => ({ path: file, type: 'file', content: fs.readFileSync(path.join(ADVERSARIAL, file)) })));
    assert.strictEqual(sourceTreeFingerprint(path.dirname(dir), { path: path.basename(dir) }), expected);
  });
});

test('row 12 STAYS: release packageFingerprints keeps content plus mode and the adversarial artifact value', () => {
  withTree((dir) => {
    const result = packageFingerprints(dir);
    assert.strictEqual(result.artifactFingerprint, 'sha256:b68f1089cb962f49001bdd90897c39ab54fd12f67198588baa67d217092bcb3c');
    assert.strictEqual(result.contentFingerprint, 'sha256:fa5267abd7d72ef804f848bc854eb94a73d60a50dc6dce97937f335601e6820c');
    assert.strictEqual(result.modeFingerprint, 'sha256:ef5ef43837565656b9eb8bf031152a7d669329e0b13789128df1507db8f99f39');
  });
});

test('row 13 STAYS: Claude marketplace package fingerprint filters transient entries', () => {
  withTree((dir) => {
    assert.strictEqual(marketplace.fingerprint(dir), GOLDEN.marketplace);
  });
});

test('row 14 STAYS: prepare-release digestPath records empty directories, absence, and refuses symlinks', () => {
  const lstatOrNull = (target) => { try { return fs.lstatSync(target); } catch (_error) { return null; } };
  const digestPath = loadPrivateFunction('scripts/release/prepare-release.js', 'digestPath', { crypto, fs, path, lstatOrNull });
  withTree((dir) => {
    assert.strictEqual(digestPath(dir), GOLDEN.rollbackDirectory);
    assert.strictEqual(digestPath(path.join(dir, 'a.txt')), GOLDEN.rollbackFile);
    assert.strictEqual(digestPath(path.join(dir, 'absent')), 'absent');
    fs.symlinkSync('a.txt', path.join(dir, 'link.txt'));
    assert.throws(() => digestPath(dir), /refuses symlink/);
  });
});

// ---------------------------------------------------------------------------
// Row 15 (MIGRATE) installer: frozen marker-less receipt and journal fixtures
// ---------------------------------------------------------------------------

test('row 15: the frozen marker-less receipt and journal are internally consistent', () => {
  const legacyReceipt = readJson(path.join(INSTALLER_FIXTURE, 'legacy-receipt.json'));
  const journal = readJson(path.join(INSTALLER_FIXTURE, 'legacy-journal.json'));
  assert.ok(!Object.hasOwn(legacyReceipt, 'fingerprint_algorithm'), 'a marker-less receipt carries no algorithm field');
  assert.ok(!Object.hasOwn(journal, 'fingerprint_algorithm'), 'a marker-less journal carries no algorithm field');
  const skills = legacyReceipt.managed_entries.skills['sample-skill'];
  const agent = legacyReceipt.managed_entries.agents['sample.toml'];

  const aggregate = crypto.createHash('sha256');
  for (const [relative, entry] of [['skills/sample-skill', skills], ['agents/sample.toml', agent]]) {
    aggregate.update(relative).update('\0').update(entry.source_fingerprint).update('\0');
  }
  assert.strictEqual(aggregate.digest('hex'), legacyReceipt.source_fingerprint);
  assert.strictEqual(journal.source_fingerprint, legacyReceipt.source_fingerprint);
  assert.deepStrictEqual(
    journal.mutations.map((mutation) => [mutation.destination, mutation.expected]).sort(),
    [['agents/sample.toml', agent.destination_fingerprint], ['skills/sample-skill', skills.destination_fingerprint]],
  );
});

// ---------------------------------------------------------------------------
// Rows 18-19 (MIGRATE call sites) cursor-sync and codex-sync trees
// ---------------------------------------------------------------------------

test('rows 18-19 (JS side only): no cursor-sync or codex-sync script computes a tree fingerprint', () => {
  const files = [
    'scripts/lib/cursor-sync-package.js',
    'scripts/ci/gen-cursor-sync.js',
    'scripts/ci/validate-cursor-sync.js',
    'scripts/ci/validate-distribution.js',
    'scripts/ci/check-codex-discovery.js',
  ];
  const treeApis = /merkleFingerprint|collectDirectoryEntries|fingerprintDir|fingerprintPath|treeFingerprint|directoryEntriesFingerprint/;
  for (const file of files) {
    assert.ok(!treeApis.test(fs.readFileSync(path.join(ROOT, file), 'utf8')), `${file} must not compute a tree fingerprint`);
  }
});

test('rows 18-19: the sync trees hold only skill and AGENTS.md links', () => {
  let links = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links += 1;
        assert.match(fs.readlinkSync(absolute), /^(\.\.\/\.\.\/skills\/[^/]+|\.\.\/AGENTS\.md)$/, absolute);
      } else if (entry.isDirectory()) {
        visit(absolute);
      }
    }
  };
  visit(path.join(ROOT, 'cursor'));
  visit(path.join(ROOT, 'codex'));
  assert.ok(links > 0, 'the sync trees legitimately hold links');
});

run('content-fingerprint-characterization');
