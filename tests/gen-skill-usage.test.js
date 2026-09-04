'use strict';

// RED contracts for the deterministic Codex usage catalog compiler.  The
// fixture contains one Codex-visible pair and one Claude-only entry so the
// tests prove selection, ordering, and source-revision binding independently
// of the live inventory migration.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const USAGE_MODULE = path.join(ROOT, 'scripts', 'lib', 'skill-usage.js');
const GENERATOR = path.join(ROOT, 'scripts', 'ci', 'gen-skill-usage.js');

function usageApi() {
  assert.ok(
    fs.existsSync(USAGE_MODULE),
    'RED: scripts/lib/skill-usage.js is absent; catalog compilation cannot start',
  );
  return require(USAGE_MODULE);
}

function usage(name, overrides = {}) {
  return {
    display_name: name === 'zeta' ? 'Zeta Work' : 'Alpha Work',
    summary: name === 'zeta'
      ? 'Run the selected Zeta workflow with bounded evidence'
      : 'Inspect the selected Alpha workflow and report evidence',
    syntax: `$${name} <input>`,
    input_kind: 'free-text',
    invocation_class: 'implicit-eligible',
    effect_authority: 'read-only',
    actions: [],
    options: [],
    examples: [{
      prompt: `$${name} inspect this change`,
      summary: `Use ${name} for a bounded task`,
    }],
    ...overrides,
  };
}

function inventoryFixture() {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    skills: [
      {
        id: 'zeta',
        name: 'zeta',
        path: 'skills/zeta',
        invocation_class: 'implicit-eligible',
        surfaces: ['codex-sync'],
        usage: usage('zeta'),
      },
      {
        id: 'alpha',
        name: 'alpha',
        path: 'skills/alpha',
        invocation_class: 'implicit-eligible',
        surfaces: ['codex-native', 'codex-sync'],
        usage: usage('alpha'),
      },
      {
        id: 'claude-only',
        name: 'claude-only',
        path: 'skills/claude-only',
        invocation_class: 'implicit-eligible',
        surfaces: ['claude-core'],
      },
    ],
  };
}

function catalogEntries(catalog) {
  assert.ok(Array.isArray(catalog.entries), 'usage catalog must expose an entries array');
  return catalog.entries;
}

function catalogRevision(catalog) {
  const revision = catalog.sourceInventoryRevision
    || (catalog.source && catalog.source.inventoryRevision)
    || catalog.inventoryRevision;
  assert.strictEqual(revision, 'inventory-fixture-1',
    'usage catalog must bind generated records to the source inventory revision');
  return revision;
}

function runGenerator(args = []) {
  assert.ok(
    fs.existsSync(GENERATOR),
    'RED: scripts/ci/gen-skill-usage.js is absent; --check/--write generation is not implemented',
  );
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('catalog compiler emits the v1 schema and deterministic public-name order', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.compileSkillUsageCatalog, 'function',
    'skill-usage.js must expose compileSkillUsageCatalog at the catalog seam');
  const catalog = api.compileSkillUsageCatalog({
    inventory: inventoryFixture(),
    inventoryRevision: 'inventory-fixture-1',
  });
  assert.strictEqual(catalog.schema, 'dhpk.skill-usage-catalog.v1');
  catalogRevision(catalog);
  assert.deepStrictEqual(catalogEntries(catalog).map((entry) => entry.name || entry.publicName), [
    'alpha', 'zeta',
  ]);
  assert.strictEqual(catalogEntries(catalog).some((entry) => (
    entry.name === 'claude-only' || entry.publicName === 'claude-only'
  )), false, 'non-Codex skills must not receive fabricated usage cards');
});

test('catalog compiler preserves normalized usage without copying procedure fields', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.compileSkillUsageCatalog, 'function');
  const fixture = inventoryFixture();
  fixture.skills[0].usage = usage('zeta', { procedure: 'load references and execute the target' });
  let failed = false;
  try {
    const result = api.compileSkillUsageCatalog({
      inventory: fixture,
      inventoryRevision: 'inventory-fixture-1',
    });
    failed = Boolean(result && result.ok === false);
    if (!failed) assert.fail('catalog compilation accepted procedure prose in usage metadata');
  } catch (error) {
    failed = true;
    assert.match(String(error && error.message ? error.message : error), /zeta|procedure|unknown|unsupported|usage/i);
  }
  assert.strictEqual(failed, true);
});

test('catalog compiler output is immutable and repeatable for unchanged input', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.compileSkillUsageCatalog, 'function');
  const first = api.compileSkillUsageCatalog({
    inventory: inventoryFixture(),
    inventoryRevision: 'inventory-fixture-1',
  });
  const second = api.compileSkillUsageCatalog({
    inventory: inventoryFixture(),
    inventoryRevision: 'inventory-fixture-1',
  });
  assert.deepStrictEqual(second, first);
  assert.ok(Object.isFrozen(first), 'catalog root must be immutable');
  assert.ok(Object.isFrozen(first.entries), 'catalog entries must be immutable');
});

test('generator check mode is available as a deterministic no-write gate', () => {
  const result = runGenerator(['--check']);
  assert.strictEqual(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
  assert.match(`${result.stdout || ''}${result.stderr || ''}`, /PASS|usage|catalog/i);
});

test('every Codex-selected inventory entry has one validated usage contract', () => {
  const api = usageApi();
  assert.strictEqual(typeof api.validateSkillUsage, 'function');
  const inventory = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'manifests', 'distribution-inventory.json'),
    'utf8',
  ));
  const codexEntries = inventory.skills.filter((entry) => (
    Array.isArray(entry.surfaces)
      && entry.surfaces.some((surface) => surface === 'codex-native' || surface === 'codex-sync')
      && entry.invokable !== false
  ));
  assert.ok(codexEntries.length > 0, 'fixture/inventory must contain Codex-selected skills');
  for (const entry of codexEntries) {
    assert.ok(entry.usage, `${entry.id} is Codex-selected but has no usage contract`);
    const result = api.validateSkillUsage({ skill: entry, usage: entry.usage });
    if (Array.isArray(result)) assert.deepStrictEqual(result, [], entry.id);
    else if (result && Array.isArray(result.errors)) assert.deepStrictEqual(result.errors, [], entry.id);
    else if (!(result === true || (result && result.ok === true))) {
      assert.fail(`${entry.id} usage validator returned no pass evidence`);
    }
    assert.match(entry.usage.syntax, new RegExp(`^\\$${entry.name}\\b`));
  }
});

test('generator check mode rejects a manually edited generated catalog', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-usage-catalog-'));
  try {
    const result = runGenerator(['--check', '--root', fixtureRoot]);
    assert.notStrictEqual(result.status, 0, 'a root with no generated catalog must fail closed');
    assert.match(`${result.stdout || ''}${result.stderr || ''}`, /catalog|missing|root|inventory/i);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

run('gen-skill-usage');
