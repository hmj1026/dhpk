'use strict';

// Characterization of every tree-fingerprint site in the ledger of OpenSpec
// change unify-tree-fingerprint-algorithm (tasks 1.1 to 1.5). The tests pin
// today's values for the MIGRATE and STAYS sites so the migration cannot change
// a value silently. They hold on the unchanged tree and are rewritten per site
// as the migration lands.
//
// Oracles: checked-in package fingerprints.json, the adversarial fixture, the
// installer's own Python hashing functions (extracted, not reimplemented), and
// the frozen installer receipt and journal under
// tests/fixtures/tree-fingerprint/installer.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { installerHash } = require('./_lib/installer-python-hash');
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
const { canonicalJson, collectDirectoryEntries, treeFingerprint } = require('../scripts/lib/content-fingerprint');

const ROOT = path.resolve(__dirname, '..');
const ADVERSARIAL = path.join(__dirname, 'fixtures', 'content-fingerprint', 'adversarial');
const INSTALLER_FIXTURE = path.join(__dirname, 'fixtures', 'tree-fingerprint', 'installer');

// Values recorded on the pre-change tree for buildAdversarialTree().
const GOLDEN = Object.freeze({
  receiptDirectory: 'sha256:580d562a776f02e67392cf5848dbb18a8294409cf0b7e0dea77519132fff113f',
  gateComplete: '25eb5b9880e63055c7b92fff9787412c3b6d266c9f6985f8bdc4bf79c6e4042d',
  installerSourceView: '81aec28d1865d28cad0e91d7d8ea2f89e34e2454971ee62b7ebeb8fb80b457e4',
  marketplace: 'fe4ae3943f5ff730191cb595c5d83c68a78db0094dd4c7196de21a579f177db1',
  rollbackDirectory: 'directory:082c1b81f402a9162e67dc4d42165c8f7514b04e72ee5e041faa8f5b5178232c',
  rollbackFile: 'file:debd29241d0ff114ef5f5914063fa74abb97a77573e2e1c320eac1691f26445a',
  baselineSource: 'b24d5b99ad7e9cc2a57d4b1d7d04396f767d12a3d8a70b517f63e91643809a4c',
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  for (const file of ['a.txt', 'a/inner.txt', 'B.txt', 'b.txt', 'sub/Z.txt', 'sub/a.txt', 'sub/binary.bin']) {
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

// ---------------------------------------------------------------------------
// Rows 2-7 (MIGRATE) package verifiers against the checked-in fingerprints
// ---------------------------------------------------------------------------

test('rows 2-3: Codex fingerprintDir reproduces every plugins/dhpk fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk', 'fingerprints.json'));
  assert.ok(Object.keys(recorded).length > 0);
  for (const [name, value] of Object.entries(recorded)) {
    assert.strictEqual(codexFingerprintDir(path.join(ROOT, 'plugins', 'dhpk', 'skills', name)), value, name);
  }
});

test('rows 4-5: Agent fingerprintDir reproduces every plugins/dhpk-agent fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk-agent', 'fingerprints.json')).skills;
  assert.ok(Object.keys(recorded).length > 0);
  for (const [name, value] of Object.entries(recorded)) {
    assert.strictEqual(agentFingerprintDir(path.join(ROOT, 'plugins', 'dhpk-agent', 'skills', name)), value, name);
  }
});

test('rows 6-7: Cursor fingerprintPath reproduces every plugins/dhpk-cursor fingerprints.json entry', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk-cursor', 'fingerprints.json'));
  assert.ok(Object.keys(recorded).length > 0);
  for (const [key, value] of Object.entries(recorded)) {
    assert.strictEqual(cursorFingerprintPath(path.join(ROOT, 'plugins', 'dhpk-cursor', key)), value, key);
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

test('row 8: gate fingerprintPath keeps bytecode and equals the installer complete view', () => {
  withTree((dir) => {
    assert.strictEqual(gateFingerprintPath(dir), GOLDEN.gateComplete);
    assert.strictEqual(installerHash('path', dir, { includeIgnored: true }), GOLDEN.gateComplete);
    assert.strictEqual(installerHash('directory', dir, { includeIgnored: true }), GOLDEN.gateComplete);
  });
});

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

test('row 3: gate fingerprintDir (project skill verifier) is the Codex per-directory recipe', () => {
  const recorded = readJson(path.join(ROOT, 'plugins', 'dhpk', 'fingerprints.json'));
  const [name, value] = Object.entries(recorded)[0];
  assert.strictEqual(gateFingerprintDir(path.join(ROOT, 'plugins', 'dhpk', 'skills', name)), value);
});

// ---------------------------------------------------------------------------
// Rows 9-10 (MIGRATE) agents-skills and publisher receipts
// ---------------------------------------------------------------------------

function terminatedDigest(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.path).update('\0').update(file.content).update('\0');
  return hash.digest('hex');
}

test('row 9: agents-skills legacy-marked receipt keeps path, NUL, bytes, NUL in receipt order; the new receipt is tree-merkle-v1; the read gate accepts only the two generator versions', () => {
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

    // Legacy-marked input: the pre-change receipt (generator 1.0.0, no field) still verifies.
    const { fingerprint_algorithm: _marker, ...unmarked } = receipt;
    const legacy = {
      ...unmarked,
      generatorVersion: '1.0.0',
      entries: receipt.entries.map((candidate) => ({ ...candidate, sourceFingerprint: terminatedDigest(contents) })),
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(legacy)}\n`);
    assert.deepStrictEqual(agentsSkills.validateAgentsSkillsProjection({ root, inventory, outDir }).errors, []);
    // A legacy value under the tree marker is drift, never accepted by trying both recipes.
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...legacy, fingerprint_algorithm: 'tree-merkle-v1' })}\n`);
    assert.ok(agentsSkills.validateAgentsSkillsProjection({ root, inventory, outDir }).errors.some((error) => /source fingerprint drifted/.test(error)));
    // An unknown algorithm fails closed.
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...legacy, fingerprint_algorithm: 'tree-merkle-v9' })}\n`);
    assert.ok(agentsSkills.validateAgentsSkillsProjection({ root, inventory, outDir }).errors.some((error) => /unknown fingerprint algorithm/.test(error)));

    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, generatorVersion: '0.9.0' })}\n`);
    assert.throws(
      () => agentsSkills.materializeAgentsSkillsProjection({ root, inventory, outDir }),
      /generator 1\.1\.0/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('row 10: publisher legacy-marked receipt keeps path, NUL, bytes, NUL over real skills; the new receipt is tree-merkle-v1; the read gate accepts only the two generator versions', () => {
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
    const legacyValues = new Map();
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
      legacyValues.set(entry.stableId, terminatedDigest(contents));
      verified += 1;
    }
    assert.strictEqual(verified, receipt.entries.length, 'every entry is verifiable so the legacy receipt is complete');
    assert.ok(verified > 0, 'at least one entry must be verifiable from its canonical source files');

    const validate = () => spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'validate-agents-skills.js'), '--source-root', ROOT, '--project-root', project,
    ], { cwd: ROOT, encoding: 'utf8' });
    const seal = (payload) => ({ ...payload, receiptFingerprint: crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex') });
    const { receiptFingerprint: _sealed, fingerprint_algorithm: _marker, ...unmarked } = receipt;
    const legacy = {
      ...unmarked,
      generatorVersion: '2.0.0',
      entries: receipt.entries.map((entry) => (legacyValues.has(entry.stableId) ? { ...entry, sourceFingerprint: legacyValues.get(entry.stableId) } : entry)),
      sourceFingerprints: Object.fromEntries(Object.entries(receipt.sourceFingerprints).map(([key, value]) => [key, legacyValues.get(key.replace(/^skill:/, '')) || value])),
    };
    // Legacy-marked input: the pre-change receipt (generator 2.0.0, no field) still verifies.
    fs.writeFileSync(receiptPath, `${JSON.stringify(seal(legacy))}\n`);
    const accepted = validate();
    assert.strictEqual(accepted.status, 0, `${accepted.stdout}${accepted.stderr}`);
    // Regenerating over the legacy receipt compares with the legacy recipe (no false source drift) and rewrites the whole receipt as tree-merkle-v1.
    const regenerate = spawnSync(process.execPath, [
      path.join(ROOT, 'scripts', 'ci', 'gen-agents-skills.js'),
      '--source-root', ROOT, '--project-root', project, '--profile', 'portable-core',
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(regenerate.status, 0, `${regenerate.stdout}${regenerate.stderr}`);
    const upgraded = readJson(receiptPath);
    assert.strictEqual(upgraded.fingerprint_algorithm, 'tree-merkle-v1');
    assert.strictEqual(upgraded.generatorVersion, '2.1.0');
    assert.deepStrictEqual(upgraded.entries.map((entry) => entry.sourceFingerprint), receipt.entries.map((entry) => entry.sourceFingerprint));
    // A legacy value under the tree marker is drift; an unknown algorithm fails closed.
    fs.writeFileSync(receiptPath, `${JSON.stringify(seal({ ...legacy, fingerprint_algorithm: 'tree-merkle-v1' }))}\n`);
    const drifted = validate();
    assert.notStrictEqual(drifted.status, 0);
    assert.match(`${drifted.stdout}${drifted.stderr}`, /source fingerprint drifted/);
    fs.writeFileSync(receiptPath, `${JSON.stringify(seal({ ...legacy, fingerprint_algorithm: 'tree-merkle-v9' }))}\n`);
    const unknown = validate();
    assert.notStrictEqual(unknown.status, 0);
    assert.match(`${unknown.stdout}${unknown.stderr}`, /unknown fingerprint algorithm/);

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
    const files = ['a/inner.txt', 'a.txt', 'b.txt', 'B.txt', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
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
    const files = ['a/inner.txt', 'a.txt', 'b.txt', 'B.txt', 'sub/a.txt', 'sub/binary.bin', 'sub/Z.txt'];
    const expected = treeFingerprint(files.map((file) => ({ path: file, type: 'file', content: fs.readFileSync(path.join(ADVERSARIAL, file)) })));
    assert.strictEqual(sourceTreeFingerprint(path.dirname(dir), { path: path.basename(dir) }), expected);
  });
});

test('row 12 STAYS: release packageFingerprints keeps content plus mode and the adversarial artifact value', () => {
  withTree((dir) => {
    const result = packageFingerprints(dir);
    assert.strictEqual(result.artifactFingerprint, 'sha256:33834a3adf417353e49dbb518ff93816708afc9da2093b8b782a6efe6bf316ae');
    assert.strictEqual(result.contentFingerprint, 'sha256:923bb5c74d70436ee00b69e799cca24a94023420f3818b69561b81feadbd3867');
    assert.strictEqual(result.modeFingerprint, 'sha256:b31c98683390e97e4079921cd89cc1ec2c7757aef576a21c7098891cdb94cc2f');
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
// Row 15 (MIGRATE) installer: legacy functions, frozen receipt, frozen journal
// ---------------------------------------------------------------------------

test('row 15: installer source view omits bytecode and the complete view keeps it', () => {
  withTree((dir) => {
    assert.strictEqual(installerHash('path', dir, { includeIgnored: false }), GOLDEN.installerSourceView);
    assert.notStrictEqual(GOLDEN.installerSourceView, GOLDEN.gateComplete);
  });
});

test('row 15: a destination symlink hashes as symlink NUL plus the readlink text, not its target', () => {
  // Built at test time: a dangling link would be invisible to git-based inventories.
  const root = tempDir('installer-link');
  try {
    fs.mkdirSync(path.join(root, 'skills', 'plain'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'plain', 'SKILL.md'), '# plain\n');
    fs.symlinkSync('../../.agents/skills/linked', path.join(root, 'skills', 'linked'));
    const link = installerHash('entry', path.join(root, 'skills'), { name: 'linked' });
    const expected = crypto.createHash('sha256').update('symlink\0').update('../../.agents/skills/linked').digest('hex');
    assert.strictEqual(link, expected);
    const complete = installerHash('directory', root);
    assert.match(complete, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(complete, link);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('row 15: the frozen pre-change receipt and journal reproduce from the legacy installer functions', () => {
  const legacyReceipt = readJson(path.join(INSTALLER_FIXTURE, 'legacy-receipt.json'));
  const journal = readJson(path.join(INSTALLER_FIXTURE, 'legacy-journal.json'));
  assert.ok(!Object.hasOwn(legacyReceipt, 'fingerprint_algorithm'), 'a legacy receipt carries no algorithm field');
  assert.ok(!Object.hasOwn(journal, 'fingerprint_algorithm'), 'a legacy journal carries no algorithm field');
  const destination = path.join(INSTALLER_FIXTURE, 'destination');
  const skills = legacyReceipt.managed_entries.skills['sample-skill'];
  const agent = legacyReceipt.managed_entries.agents['sample.toml'];
  assert.strictEqual(installerHash('entry', path.join(destination, 'skills'), { name: 'sample-skill' }), skills.destination_fingerprint);
  assert.strictEqual(installerHash('path', path.join(destination, 'skills', 'sample-skill'), { includeIgnored: false }), skills.source_fingerprint);
  assert.strictEqual(installerHash('entry', path.join(destination, 'agents'), { name: 'sample.toml' }), agent.destination_fingerprint);
  assert.strictEqual(gateFingerprintPath(path.join(destination, 'skills', 'sample-skill')), skills.destination_fingerprint);

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
