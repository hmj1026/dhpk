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
const {
  collectDirectoryEntries,
  directoryEntriesFingerprint,
  fingerprintPath,
  resolveFingerprintAlgorithm,
  treeFingerprint,
  treeNodeFingerprint,
} = require('../scripts/lib/content-fingerprint');
const { installerEnv, runCaptured } = require('../scripts/lib/install-adapters/codex-cli');

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
  receiptFileA: 'sha256:debd29241d0ff114ef5f5914063fa74abb97a77573e2e1c320eac1691f26445a',
  receiptCodeUnitSkipBytecode: 'sha256:23c1f361c0ac60cdf5dc9e4d0a3f70bae0468816f5ffeadfbe6538c486d4321d',
  receiptLocaleWithBytecode: 'sha256:e07226528f75e5661da255d756704d4319d30aef80f027302191f42d80b31d30',
  receiptLocaleSkipBytecode: 'sha256:6ea779294b4d281dbef036a25d962abd1101ba1187b516a29ea2b3fde428cbe4',
  treeRecordedLinks: '5acf349a6c5f919f8fd43b6683566f0b5cb6a35696d1292406024458d2a3d3c0',
  treeRecordedLinksSkipBytecode: '4cb316634d3859080521223c2be8a8d0ae8e132d4015b1b6b5ec8787631da9ed',
  treeSingleFileA: 'aba851c522e0ae7e70a8e631e3752e1c4560296be94f54ff06099f71f4339ac3',
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

// ---------------------------------------------------------------------------
// Golden digest & error-message locks for simplify T1 (#1368)
// ---------------------------------------------------------------------------

test('T1 golden: receipt-primitives and directoryEntriesFingerprint pin order and bytecode variants', () => {
  withTree((dir) => {
    assert.strictEqual(receipts.fingerprintDirectory(dir), GOLDEN.receiptDirectory);
    assert.strictEqual(receipts.fingerprintForBytes(path.join(dir, 'a.txt')), GOLDEN.receiptFileA);
    assert.strictEqual(
      directoryEntriesFingerprint(collectDirectoryEntries(dir, { order: 'codeUnit', skipBytecode: true })),
      GOLDEN.receiptCodeUnitSkipBytecode,
    );
    assert.strictEqual(
      directoryEntriesFingerprint(collectDirectoryEntries(dir, { order: 'locale', skipBytecode: false })),
      GOLDEN.receiptLocaleWithBytecode,
    );
    assert.strictEqual(
      directoryEntriesFingerprint(collectDirectoryEntries(dir, { order: 'locale', skipBytecode: true })),
      GOLDEN.receiptLocaleSkipBytecode,
    );
  });
});

test('T1 golden: treeFingerprint records symlinks without dereferencing and fingerprintPath matches single leaf', () => {
  withTree((dir) => {
    assert.strictEqual(fingerprintPath(path.join(dir, 'a.txt')), GOLDEN.treeSingleFileA);
    fs.symlinkSync('sub', path.join(dir, 'linked-dir'));
    assert.strictEqual(
      treeFingerprint(collectDirectoryEntries(dir, { symlinks: 'record', skipBytecode: false })),
      GOLDEN.treeRecordedLinks,
    );
    assert.strictEqual(
      treeFingerprint(collectDirectoryEntries(dir, { symlinks: 'record', skipBytecode: true })),
      GOLDEN.treeRecordedLinksSkipBytecode,
    );
  });
});

test('T1 golden: cursorVirtualFingerprint locks all 6 Cursor prefixes and matches physical tree walks', () => {
  const cursorVirtualFingerprint = loadPrivateFunction(
    'scripts/lib/cursor-plugin-package.js',
    'cursorVirtualFingerprint',
    { treeNodeFingerprint },
  );
  // Deliberately unsorted so path sorting and leaf normalization stay pinned.
  const files = [
    { destination: 'rules/core/01-rule.mdc', content: Buffer.from('---\nalwaysApply: true\n---\nRule body\n', 'utf8'), mode: 0o644 },
    { destination: 'skills/z-skill/SKILL.md', content: Buffer.from('---\nname: z-skill\n---\n# Z\n', 'utf8'), mode: 0o644 },
    { destination: 'skills/a-skill/scripts/run.sh', content: Buffer.from('#!/bin/sh\necho ok\n', 'utf8'), mode: 0o755 },
    { destination: 'agents/reviewer.md', content: Buffer.from('# Reviewer\n', 'utf8'), mode: 0o644 },
    { destination: 'commands/check.md', content: Buffer.from('# Check\n', 'utf8'), mode: 0o644 },
    { destination: 'hooks/hooks.json', content: Buffer.from('{"hooks":{}}\n', 'utf8'), mode: 0o644 },
    { destination: 'agent-traps/_common/guard.md', content: Buffer.from('# Guard\n', 'utf8'), mode: 0o644 },
  ];
  const expected = {
    skills: '5261c0959f75b5d84a62dc88e3d9a78ffda2ce3889c2ea00ea662515327a060a',
    rules: '27c8f5985bc3659843a8a13a4fec0033d7e93bccaf67d4ac6539e3108dc58d0c',
    agents: '0b16bc04cd8b4ee6c5e8ca298c7f4b3f28a5e56a4ad0da38c2659fe644b53097',
    commands: '4dc732b0ed05bb66e36feaaab3b4d1561126e5eb34411bcf37c3b943088af26a',
    'hooks/hooks.json': 'b41c753366ba619555c029ce70c589630cc17537846f593c420f815d9bc82ba2',
    'agent-traps': '10f089e2edd25f3d89b1fc559437824727afc3873073e02bae436e029bccbe76',
    nonexistent: '',
  };
  const disk = tempDir('cursor-virtual-parity');
  try {
    for (const file of files) {
      const target = path.join(disk, file.destination);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { mode: file.mode });
    }
    for (const [prefix, digest] of Object.entries(expected)) {
      assert.strictEqual(cursorVirtualFingerprint(files, prefix), digest, prefix);
      assert.strictEqual(fingerprintPath(path.join(disk, prefix)), digest, `disk parity ${prefix}`);
    }
  } finally {
    fs.rmSync(disk, { recursive: true, force: true });
  }
});

function createCodexGoldenPlugin(root) {
  const plugin = path.join(root, 'plugin');
  fs.mkdirSync(path.join(plugin, 'codex', 'skills', 'alpha-skill', 'references'), { recursive: true });
  fs.writeFileSync(
    path.join(plugin, 'codex', 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: Alpha fixture.\n---\n# Alpha\n',
  );
  fs.writeFileSync(path.join(plugin, 'codex', 'skills', 'alpha-skill', 'references', 'note.md'), 'Alpha reference\n');
  fs.mkdirSync(path.join(plugin, 'codex', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(plugin, 'codex', 'agents', 'fixture-agent.toml'),
    'name = "fixture-agent"\ndescription = "Deterministic agent."\n',
  );
  fs.mkdirSync(path.join(plugin, 'codex', 'supporting'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'codex', 'supporting', 'prompt-defense.md'), 'deterministic support\n');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"dhpk","version":"0.0.0-fixture"}\n');
  fs.mkdirSync(path.join(plugin, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
  fs.writeFileSync(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    schema: 'dhpk.distribution-inventory.v2',
    profile_policy: {
      version: 'dhpk.capability-bundle-selection.v1',
      required_core_ids: ['alpha-skill'],
      profiles: { common: { selection: 'declared-common', compatibilityMode: 'profile' } },
    },
    skills: [{
      id: 'alpha-skill',
      name: 'alpha-skill',
      path: 'skills/alpha-skill',
      lifecycle: 'promoted',
      invokable: true,
      profiles: [],
      surfaces: ['codex-native', 'codex-sync'],
    }],
    internal_runtime_skills: { 'codex-native': [] },
    agent_roster: ['fixture-agent'],
    supporting_assets: [{
      id: 'prompt-defense',
      source: 'codex/supporting/prompt-defense.md',
      destination: 'dhpk/agent-traps/_common/prompt-defense.md',
    }],
    retired_skills: [],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(plugin, 'manifests', 'install-profiles.json'), `${JSON.stringify({
    version: 1,
    profiles: { common: { modules: [], skillIds: ['alpha-skill'], commandIds: [], compatibilityMode: 'profile' } },
  }, null, 2)}\n`);
  return plugin;
}

test('T1 golden: Codex installer copy & symlink receipts and plan collision tree digests stay exact', () => {
  const root = tempDir('codex-golden');
  const offlineEnv = { ...process.env, PATH: '/usr/bin:/bin' };
  try {
    const plugin = createCodexGoldenPlugin(root);
    const expectedSource = 'e1a1ead2f4ee0d44cb1a3ee5d0b744e62176b55335e5eea2f4fe7480883747c9';
    const expectedSelection = 'f6d8b15c5714b01363af5773f9c6df46fa763ca1dc7c2fadde9dd63c11ec9a49';
    const expectedSurfaceSelection = '578a337fb95129b10a2b564d5bdb028669d5a3cd3ba25ffdc9c38e13d04a5fa8';
    const expectedAgent = 'b2ef2eeeef2e9436a99b5594c354cf2f0206d4179aca83e685c9bb8ea54f704a';
    const expectedSkill = 'd4e594dbb6a1f543c0412192778bee23180c58b78e96aed5aecec542ed44535e';
    const expectedSupport = '7edd67bdd40da6d375f84e063ffb54e87210eaffec700f62205aab69bfcca99a';

    for (const mode of ['copy', 'symlink']) {
      const project = path.join(root, `project-${mode}`);
      fs.mkdirSync(project, { recursive: true });
      const res = runCaptured(installerEnv({
        host: 'codex',
        pluginRoot: plugin,
        projectRoot: project,
        mode,
        modeExplicit: true,
        baseEnv: offlineEnv,
      }));
      assert.strictEqual(res.code, 0, res.stderr);
      const receipt = readJson(path.join(project, '.codex', '.dhpk-installed.json'));
      assert.strictEqual(receipt.fingerprint_algorithm, 'tree-merkle-v1');
      assert.strictEqual(receipt.source_fingerprint, expectedSource);
      assert.strictEqual(receipt.selectionFingerprint, expectedSelection);
      assert.strictEqual(receipt.surfaceSelectionFingerprint, expectedSurfaceSelection);
      assert.strictEqual(receipt.managed_entries.agents['fixture-agent.toml'].source_fingerprint, expectedAgent);
      assert.strictEqual(receipt.managed_entries.agents['fixture-agent.toml'].destination_fingerprint, expectedAgent);
      assert.strictEqual(receipt.managed_entries.agents['fixture-agent.toml'].fingerprint, expectedAgent);
      assert.strictEqual(receipt.managed_entries.skills['alpha-skill'].source_fingerprint, expectedSkill);
      assert.strictEqual(receipt.managed_entries.skills['alpha-skill'].destination_fingerprint, expectedSkill);
      assert.strictEqual(receipt.managed_entries.skills['alpha-skill'].fingerprint, expectedSkill);
      const supportEntry = receipt.managed_entries.supporting_assets['dhpk/agent-traps/_common/prompt-defense.md'];
      assert.strictEqual(supportEntry.mode, mode);
      assert.strictEqual(supportEntry.source_fingerprint, expectedSupport);
      assert.strictEqual(supportEntry.destination_fingerprint, expectedSupport);
      assert.strictEqual(supportEntry.fingerprint, expectedSupport);
      assert.strictEqual(receipt.reconciliation.evidence.fingerprints.source, expectedSource);
      assert.strictEqual(
        receipt.reconciliation.evidence.fingerprints.destinations['skills/alpha-skill'].destination_fingerprint,
        expectedSkill,
      );
    }

    // Plan collision parity on the adversarial tree (source view + symlink-recorded complete view).
    const advPlugin = path.join(root, 'adv-plugin');
    const advSrc = path.join(advPlugin, 'codex', 'skills', 'adv-skill');
    fs.mkdirSync(advSrc, { recursive: true });
    fs.cpSync(ADVERSARIAL, advSrc, { recursive: true });
    fs.mkdirSync(path.join(advSrc, 'empty'));
    fs.mkdirSync(path.join(advSrc, '__pycache__'));
    fs.writeFileSync(path.join(advSrc, '__pycache__', 'x.pyc'), 'pyc');
    fs.writeFileSync(path.join(advSrc, 'skip.pyc'), 'pyc2');
    fs.mkdirSync(path.join(advPlugin, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(advPlugin, '.claude-plugin', 'plugin.json'), '{"name":"dhpk","version":"0.0.0-fixture"}\n');
    fs.mkdirSync(path.join(advPlugin, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(advPlugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
      schema: 'dhpk.distribution-inventory.v2',
      profile_policy: {
        version: 'dhpk.capability-bundle-selection.v1',
        required_core_ids: ['adv-skill'],
        profiles: { common: { selection: 'declared-common', compatibilityMode: 'profile' } },
      },
      skills: [{
        id: 'adv-skill',
        name: 'adv-skill',
        path: 'skills/adv-skill',
        lifecycle: 'promoted',
        invokable: true,
        profiles: [],
        surfaces: ['codex-native', 'codex-sync'],
      }],
      internal_runtime_skills: { 'codex-native': [] },
      agent_roster: [],
      supporting_assets: [],
      retired_skills: [],
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(advPlugin, 'manifests', 'install-profiles.json'), `${JSON.stringify({
      version: 1,
      profiles: { common: { modules: [], skillIds: ['adv-skill'], commandIds: [], compatibilityMode: 'profile' } },
    }, null, 2)}\n`);

    const advProject = path.join(root, 'adv-project');
    const advDest = path.join(advProject, '.codex', 'skills', 'adv-skill');
    fs.mkdirSync(advDest, { recursive: true });
    fs.cpSync(advSrc, advDest, { recursive: true });
    fs.symlinkSync('sub', path.join(advDest, 'linked-dir'));
    const plan = runCaptured(installerEnv({
      host: 'codex',
      pluginRoot: advPlugin,
      projectRoot: advProject,
      mode: 'copy',
      modeExplicit: true,
      update: true,
      plan: true,
      json: true,
      baseEnv: offlineEnv,
    }));
    assert.strictEqual(plan.code, 1, plan.stderr);
    const report = JSON.parse(plan.stdout);
    assert.strictEqual(report.source_fingerprint, '5576d0e5ece83bee473bccc0447dcd8aa259b5d06bf2d8db2b21126408f18108');
    assert.deepStrictEqual(report.collisions, [{
      path: 'skills/adv-skill',
      kind: 'skills',
      name: 'adv-skill',
      ownership: 'unowned-collision',
      source_fingerprint: GOLDEN.treeSourceView,
      destination_fingerprint: GOLDEN.treeRecordedLinks,
      action: `--adopt=skills/adv-skill@${GOLDEN.treeRecordedLinks}@${GOLDEN.treeSourceView}`,
    }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T1 golden: collectDirectoryEntries and fingerprintPath lock exact validation and symlink error messages', () => {
  const root = tempDir('errors');
  try {
    const dir = path.join(root, 'dir');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'ok');
    const symlinkTarget = path.join(root, 'linked-root');
    fs.symlinkSync(dir, symlinkTarget);
    const symlinkChild = path.join(dir, 'linked-dir');
    fs.symlinkSync('dir', symlinkChild);

    assert.throws(() => collectDirectoryEntries(dir, { order: 'invalid' }), (err) => err.message === 'unknown directory order: invalid');
    assert.throws(() => collectDirectoryEntries(dir, { symlinks: 'invalid' }), (err) => err.message === 'unknown symlink policy: invalid');
    assert.throws(
      () => collectDirectoryEntries(symlinkTarget),
      (err) => err.message === `fingerprint root '${symlinkTarget}' is not a physical directory`,
    );
    assert.throws(
      () => collectDirectoryEntries(dir, { symlinks: 'refuse' }),
      (err) => err.message === "cannot fingerprint symlink 'linked-dir'",
    );
    assert.throws(
      () => fingerprintPath(symlinkChild),
      (err) => err.message === `cannot fingerprint symlink entry: ${symlinkChild}`,
    );

    if (process.platform !== 'win32') {
      fs.rmSync(symlinkChild);
      const fifo = path.join(dir, 'fifo-entry');
      const mkfifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
      if (mkfifo.status === 0) {
        assert.throws(
          () => collectDirectoryEntries(dir, { symlinks: 'refuse' }),
          (err) => err.message === "cannot fingerprint special entry 'fifo-entry'",
        );
        assert.throws(
          () => fingerprintPath(fifo),
          (err) => err.message === `cannot fingerprint special entry: ${fifo}`,
        );
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('content-fingerprint-characterization');
