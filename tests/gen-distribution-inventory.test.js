'use strict';

// Coverage for scripts/ci/gen-distribution-inventory.js and the classifier it
// wraps. Pins the default classification rule (task 1.3): root skills/ ->
// promoted/claude-core, module skills/modules -> optional/claude-module,
// codex-sync added wherever codex/skills/ mirrors the entry.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  classifyCanonicalInventory,
  LIFECYCLES,
  refreshSupportingDigests,
  compileClaudeProjection,
  preserveProjectionContract,
  writeInventoryAtomically,
} = require('../scripts/lib/distribution-inventory');
const generator = require('../scripts/ci/gen-distribution-inventory');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'manifests', 'distribution-inventory.json');

function writableCapture() {
  let value = '';
  return {
    write(chunk) { value += String(chunk); },
    text() { return value; },
  };
}

function demoRoot(nested = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-red-'));
  const skillPath = nested ? path.join(temp, 'skills', 'group', 'demo') : path.join(temp, 'skills', 'demo');
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# demo\n');
  return temp;
}

function invokeWrite(root, out) {
  const stdout = writableCapture();
  const stderr = writableCapture();
  const result = generator.run({ argv: ['--write'], root, out, stdout, stderr });
  return { result, stdout: stdout.text(), stderr: stderr.text() };
}

function invoke(root, out, options = {}) {
  const stdout = writableCapture();
  const stderr = writableCapture();
  const result = generator.run({ argv: ['--write'], root, out, stdout, stderr, ...options });
  return { result, stdout: stdout.text(), stderr: stderr.text() };
}

function invokeRoute(argv, root, out) {
  const stdout = writableCapture();
  const stderr = writableCapture();
  const result = generator.run({ argv, root, out, stdout, stderr });
  return { result, stdout: stdout.text(), stderr: stderr.text() };
}

function statusOf(result) {
  return typeof result === 'number' ? result : result.status;
}

test('refresh with missing output returns status 2 and does not write', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-refresh-missing-'));
  const output = path.join(temp, 'inventory.json');
  try {
    const observed = invokeRoute(['--refresh-supporting-digests'], temp, output);
    assert.strictEqual(statusOf(observed.result), 2);
    assert.match(observed.stderr, /no checked-in inventory to refresh/);
    assert.strictEqual(fs.existsSync(output), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('summary reports checked-in manifest headline and counts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-summary-'));
  const output = path.join(temp, 'inventory.json');
  fs.copyFileSync(MANIFEST, output);
  try {
    const observed = invokeRoute([], temp, output);
    const inventory = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    assert.strictEqual(statusOf(observed.result), 0);
    assert.match(observed.stdout, /dhpk distribution inventory:/);
    assert.match(observed.stdout, new RegExp(`skills:\\s+${inventory.skills.length}`));
    assert.match(observed.stdout, new RegExp(`modules:\\s+${inventory.modules.length}`));
    assert.match(observed.stdout, /codex-sync surface:/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('summary with parsed false scalar reports compile failure without write', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-summary-false-'));
  const output = path.join(temp, 'inventory.json');
  fs.writeFileSync(output, 'false\n');
  try {
    const observed = invokeRoute([], temp, output);
    assert.strictEqual(statusOf(observed.result), 1);
    assert.match(observed.stderr, /Claude projection compilation failed/);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), 'false\n');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('summary classification with missing output and nested skill is unclassified', () => {
  const temp = demoRoot(true);
  const output = path.join(temp, 'inventory.json');
  try {
    const observed = invokeRoute([], temp, output);
    assert.strictEqual(statusOf(observed.result), 1);
    assert.match(observed.stderr, /unclassified canonical entry: skills\/group\/demo/);
    assert.strictEqual(fs.existsSync(output), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('missing output classifies a recognized root skill and writes literal v1 projection', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  try {
    const { result, stdout, stderr } = invokeWrite(temp, output);
    assert.strictEqual(statusOf(result), 0, stderr);
    assert.match(stdout, /wrote 1 skills \+ 0 modules/);
    const inventory = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(inventory.schema, 'dhpk.distribution-inventory.v1');
    assert.deepStrictEqual(inventory.skills, [{
      id: 'demo', path: 'skills/demo', lifecycle: 'promoted', surfaces: ['claude-core'],
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('refresh-supporting-digests remains available separately from v2 write refusal', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  try {
    const bootstrap = generator.run({ argv: ['--write'], root: temp, out: output });
    assert.strictEqual(statusOf(bootstrap), 0);

    const stdout = writableCapture();
    const stderr = writableCapture();
    const refreshed = generator.run({
      argv: ['--refresh-supporting-digests'], root: temp, out: output, stdout, stderr,
    });
    assert.strictEqual(statusOf(refreshed), 0);
    assert.match(stdout.text(), /refreshed transformed supporting-asset provenance/);
    assert.strictEqual(stderr.text(), '');
    const inventory = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(inventory.schema, 'dhpk.distribution-inventory.v1');
    assert.deepStrictEqual(inventory.skills, [{
      id: 'demo', path: 'skills/demo', lifecycle: 'promoted', surfaces: ['claude-core'],
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('checked-in v2 refresh succeeds and subsequent write refusal preserves refreshed bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-v2-refresh-'));
  const output = path.join(temp, 'inventory.json');
  fs.copyFileSync(MANIFEST, output);
  try {
    const stdout = writableCapture();
    const stderr = writableCapture();
    const refreshed = generator.run({
      argv: ['--refresh-supporting-digests'], root: ROOT, out: output, stdout, stderr,
    });
    assert.strictEqual(statusOf(refreshed), 0, stderr.text());
    assert.match(stdout.text(), /refreshed transformed supporting-asset provenance/);
    assert.strictEqual(stderr.text(), '');
    const refreshedBytes = fs.readFileSync(output, 'utf8');
    assert.strictEqual(JSON.parse(refreshedBytes).schema, 'dhpk.distribution-inventory.v2');

    const refused = invokeWrite(ROOT, output);
    assert.notStrictEqual(statusOf(refused.result), 0);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), refreshedBytes);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('falsey parsed JSON inventories fail closed without changing exact bytes', () => {
  for (const literal of ['null\n', 'false\n', '0\n', '""\n']) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-falsey-'));
    const output = path.join(temp, 'inventory.json');
    fs.writeFileSync(output, literal);
    try {
      const observed = invokeWrite(temp, output);
      assert.notStrictEqual(statusOf(observed.result), 0, literal);
      assert.match(observed.stderr, /unsupported|invalid schema/i, literal);
      assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
});

test('writeInventory injection is used once for missing output and zero times on v2 refusal', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  let calls = 0;
  const supplied = [];
  const writeInventory = (filePath, content) => {
    calls += 1;
    supplied.push(content);
    fs.writeFileSync(filePath, content);
  };
  try {
    const first = invoke(temp, output, { writeInventory });
    assert.strictEqual(statusOf(first.result), 0, first.stderr);
    assert.strictEqual(calls, 1);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), supplied[0]);
    const literal = '{"schema":"dhpk.distribution-inventory.v2"}\n';
    fs.writeFileSync(output, literal);
    calls = 0;
    const refused = invoke(temp, output, { writeInventory });
    assert.notStrictEqual(statusOf(refused.result), 0);
    assert.strictEqual(calls, 0);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('existing exact v1 preserves supported projection contract while adding recognized classification', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  const existing = '{"schema":"dhpk.distribution-inventory.v1","projection_contract":{"marker":"keep"}}\n';
  fs.writeFileSync(output, existing);
  try {
    const { result, stderr } = invokeWrite(temp, output);
    assert.strictEqual(statusOf(result), 0, stderr);
    const inventory = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.deepStrictEqual(inventory.projection_contract, { marker: 'keep' });
    assert.deepStrictEqual(inventory.skills, [{
      id: 'demo', path: 'skills/demo', lifecycle: 'promoted', surfaces: ['claude-core'],
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('existing v2 with omitted skills refuses write and preserves exact bytes', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  const literal = '{"schema":"dhpk.distribution-inventory.v2","skills":[]}\n';
  fs.writeFileSync(output, literal);
  try {
    const { result, stderr } = invokeWrite(temp, output);
    assert.notStrictEqual(statusOf(result), 0);
    assert.match(stderr, /--refresh-supporting-digests/);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('malformed existing inventory returns nonzero and preserves exact bytes', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  const literal = '{malformed\n';
  fs.writeFileSync(output, literal);
  try {
    let observed;
    assert.doesNotThrow(() => { observed = invokeWrite(temp, output); });
    assert.notStrictEqual(statusOf(observed.result), 0);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('unknown existing schema fails closed with an unsupported-schema diagnostic', () => {
  const temp = demoRoot();
  const output = path.join(temp, 'inventory.json');
  const literal = '{"schema":"dhpk.distribution-inventory.v999"}\n';
  fs.writeFileSync(output, literal);
  try {
    const { result, stderr } = invokeWrite(temp, output);
    assert.notStrictEqual(statusOf(result), 0);
    assert.match(stderr, /unknown|unsupported schema/i);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('unclassified nested canonical skill fails before creating a missing output', () => {
  const temp = demoRoot(true);
  const output = path.join(temp, 'inventory.json');
  try {
    const { result, stderr } = invokeWrite(temp, output);
    assert.notStrictEqual(statusOf(result), 0);
    assert.match(stderr, /skills\/group\/demo/);
    assert.strictEqual(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('unclassified nested canonical skill fails and preserves an existing v1 inventory', () => {
  const temp = demoRoot(true);
  const output = path.join(temp, 'inventory.json');
  const literal = '{"schema":"dhpk.distribution-inventory.v1","skills":[]}\n';
  fs.writeFileSync(output, literal);
  try {
    const { result, stderr } = invokeWrite(temp, output);
    assert.notStrictEqual(statusOf(result), 0);
    assert.match(stderr, /identity|skills\/group\/demo/);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('generator refuses a write over an existing v2 inventory and preserves its bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-generator-'));
  const output = path.join(temp, 'dhpk.distribution-inventory.v2');
  const literal = '{"schema":"dhpk.distribution-inventory.v2"}\n';
  fs.writeFileSync(output, literal);
  try {
    assert.strictEqual(typeof generator.run, 'function', 'gen-distribution-inventory must export an injectable run function');
    const stdout = writableCapture();
    const stderr = writableCapture();
    const result = generator.run({ argv: ['--write'], root: temp, out: output, stdout, stderr });
    const status = typeof result === 'number' ? result : result.status;
    assert.notStrictEqual(status, 0);
    assert.strictEqual(stdout.text(), '');
    assert.match(stderr.text(), /--refresh-supporting-digests/);
    assert.strictEqual(fs.readFileSync(output, 'utf8'), literal);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('checked-in manifest exists and declares the v2 schema', () => {
  assert.ok(fs.existsSync(MANIFEST), 'manifests/distribution-inventory.json is missing — run scripts/ci/gen-distribution-inventory.js --write');
  const inv = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.strictEqual(inv.schema, 'dhpk.distribution-inventory.v2');
  assert.deepStrictEqual([...inv.lifecycles].sort(), [...LIFECYCLES].sort());
});

test('every canonical skill directory (skills/, modules/*/skills/) is classified', () => {
  const generated = classifyCanonicalInventory(ROOT);
  assert.ok(generated.skills.length > 0);
  for (const s of generated.skills) {
    assert.ok(fs.existsSync(path.join(ROOT, s.path, 'SKILL.md')), `${s.path}/SKILL.md missing on disk`);
  }
});

test('root skills classify promoted/claude-core; module skills classify optional/claude-module', () => {
  const generated = classifyCanonicalInventory(ROOT);
  for (const s of generated.skills) {
    if (s.path.startsWith('modules/')) {
      assert.strictEqual(s.lifecycle, 'optional', `${s.id} (module skill) should default to optional`);
      assert.ok(s.surfaces.includes('claude-module'), `${s.id} should carry claude-module surface`);
    } else {
      assert.strictEqual(s.lifecycle, 'promoted', `${s.id} (root skill) should default to promoted`);
      assert.ok(s.surfaces.includes('claude-core'), `${s.id} should carry claude-core surface`);
    }
  }
});

test('codex-sync surface is granted exactly to entries mirrored under codex/skills/', () => {
  const generated = classifyCanonicalInventory(ROOT);
  const codexSkillsDir = path.join(ROOT, 'codex', 'skills');
  const mirrorNames = new Set(fs.readdirSync(codexSkillsDir));
  for (const s of generated.skills) {
    const hasCodexSync = s.surfaces.includes('codex-sync');
    assert.strictEqual(hasCodexSync, mirrorNames.has(s.id), `${s.id} codex-sync surface should match codex/skills/ mirror presence`);
  }
});

test('every module directory under modules/ is classified optional/claude-module', () => {
  const generated = classifyCanonicalInventory(ROOT);
  const moduleDirs = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepStrictEqual(generated.modules.map((m) => m.id).sort(), moduleDirs);
  for (const m of generated.modules) {
    assert.strictEqual(m.lifecycle, 'optional');
    assert.deepStrictEqual(m.surfaces, ['claude-module']);
  }
});

test('checked-in manifest covers every canonical skill/module (a deliberate lifecycle override is expected to diverge from the default classifier, so this checks coverage, not byte-equality)', () => {
  const existing = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const generated = classifyCanonicalInventory(ROOT);
  const existingSkillPaths = new Set(existing.skills.map((s) => s.path));
  const existingModulePaths = new Set(existing.modules.map((m) => m.path));
  for (const s of generated.skills) {
    assert.ok(existingSkillPaths.has(s.path), `${s.path} missing from checked-in manifest — run scripts/ci/gen-distribution-inventory.js --write`);
  }
  for (const m of generated.modules) {
    assert.ok(existingModulePaths.has(m.path), `${m.path} missing from checked-in manifest — run scripts/ci/gen-distribution-inventory.js --write`);
  }
});

test('supporting provenance refresh derives transformed digests without mutating the source inventory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-provenance-'));
  try {
    fs.mkdirSync(path.join(temp, 'canonical'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'codex'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'canonical', 'policy.md'), 'canonical policy\n');
    fs.writeFileSync(path.join(temp, 'codex', 'policy.md'), 'codex projection\n');
    const original = {
      supporting_assets: [{
        id: 'policy',
        source: 'codex/policy.md',
        canonical_source: 'canonical/policy.md',
        canonical_digest: 'stale',
        projection_digest: 'stale',
        destination: 'dhpk/policies/policy.md',
      }],
    };
    const refreshed = refreshSupportingDigests(original, temp);
    const digest = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(temp, rel))).digest('hex');
    assert.strictEqual(refreshed.supporting_assets[0].canonical_digest, digest('canonical/policy.md'));
    assert.strictEqual(refreshed.supporting_assets[0].projection_digest, digest('codex/policy.md'));
    assert.strictEqual(original.supporting_assets[0].canonical_digest, 'stale');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Claude compilation is deterministic and does not let contract preservation select roots', () => {
  const inventory = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const first = compileClaudeProjection({ inventory });
  const second = compileClaudeProjection({ inventory: JSON.parse(JSON.stringify(inventory)) });
  assert.strictEqual(first.ok, true, first.error && first.error.message);
  assert.strictEqual(second.ok, true, second.error && second.error.message);
  assert.strictEqual(first.plan.planFingerprint, second.plan.planFingerprint);
  assert.deepStrictEqual(first.generated, second.generated);
  assert.deepStrictEqual(first.inventoryView.skillRoutingProjection, first.routingProjection);
  const rendered = first.adapter.render(first.plan);
  const inventoryOutput = rendered.outputs.find((entry) => entry.stableId === 'claude:inventory-view');
  assert.deepStrictEqual(JSON.parse(inventoryOutput.content.toString()).skillRoutingProjection, first.routingProjection);
  const regenerated = preserveProjectionContract({ ...inventory, skills: inventory.skills.slice() }, inventory);
  const preserved = compileClaudeProjection({ inventory: regenerated });
  assert.strictEqual(preserved.ok, true, preserved.error && preserved.error.message);
  assert.deepStrictEqual(preserved.generated, first.generated);
});

test('inventory writer preserves the accepted manifest when atomic rename fails', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-inventory-atomic-'));
  const target = path.join(temp, 'distribution-inventory.json');
  const before = '{"schema":"old"}\n';
  fs.writeFileSync(target, before);
  const realRename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('synthetic inventory rename failure'); };
    assert.throws(
      () => writeInventoryAtomically(target, '{"schema":"new"}\n'),
      /synthetic inventory rename failure/,
    );
    assert.strictEqual(fs.readFileSync(target, 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(temp), ['distribution-inventory.json']);
  } finally {
    fs.renameSync = realRename;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

run('gen-distribution-inventory');
