'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  compileMarketplaceSelection,
  compileMarketplacePublicationView,
  compileDispositionLedger,
} = require('../scripts/lib/marketplace-selection');

const ROOT = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const INVENTORY = readJson('manifests/distribution-inventory.json');
const SELECTION = readJson('manifests/marketplace-selection.json');
const ALIASES = Object.keys(readJson('skills/flow-guide/references/codex-usage-catalog.json').runtimeIndex.aliases);
const PACKAGE_SKILL_CATALOGS = [
  { root: 'plugins/dhpk/skills', surface: 'codex-native', includeCommon: true },
  { root: 'plugins/dhpk-agent/skills', surface: 'agent-plugin', includeCommon: true },
  { root: 'plugins/dhpk-agy/skills', surface: 'agy-plugin', includeCommon: true },
  // Cursor owns its Host-only overlay; its common entries are shared from Agent.
  { root: 'plugins/dhpk-cursor/skills', surface: 'cursor-plugin', includeCommon: false },
  { root: 'generated/claude-marketplace/package/skills', surface: 'claude-core', includeCommon: true },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const compile = (overrides = {}) => compileMarketplaceSelection({
  inventory: INVENTORY,
  selection: SELECTION,
  aliases: ALIASES,
  ...overrides,
});
const compilePublication = (overrides = {}) => compileMarketplacePublicationView({
  inventory: INVENTORY,
  selection: SELECTION,
  aliases: ALIASES,
  ...overrides,
});
const errorText = (result) => result.errors.join('\n');

function frontmatterName(file) {
  const match = fs.readFileSync(file, 'utf8').match(/^name:\s*["']?([^"'\n]+)/m);
  return match ? match[1].trim().replace(/^[a-z0-9-]+:/, '') : null;
}

test('the accepted catalog compiles to 15 public entries with every child folded under its owner', () => {
  const result = compile();
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.publicEntries.length, 15);
  const folded = Object.values(result.bundledChildren).reduce((total, children) => total + children.length, 0);
  assert.strictEqual(folded, 45);
  for (const owner of Object.keys(result.bundledChildren)) {
    assert.ok(result.publicEntries.some((entry) => entry.id === owner), `${owner} must be a public entry`);
  }
  assert.strictEqual(result.hostOnly.length, SELECTION.skills.filter((row) => row.selection === 'host-only').length);
  assert.strictEqual(result.withdrawn.length, 0);
});

test('the publication view preserves full catalog descriptors and folds all common children', () => {
  const result = compilePublication();
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.publicEntries.length, 15);
  assert.strictEqual(Object.values(result.bundledChildren).reduce((total, rows) => total + rows.length, 0), 45);
  assert.strictEqual(result.hostOnly.length, 0);
  assert.strictEqual(result.withdrawn.length, 0);

  const entry = result.publicEntries.find((row) => row.id === 'flow-guide');
  const entrySource = INVENTORY.skills.find((row) => row.id === 'flow-guide');
  for (const [key, value] of Object.entries(entrySource)) assert.deepStrictEqual(entry[key], value, `flow-guide.${key}`);
  assert.strictEqual(entry.path, 'skills/flow-guide');
  assert.deepStrictEqual(entry.versionCondition, []);

  const child = result.bundledChildren['flow-drive'].find((row) => row.id === 'php56-yii-dev');
  const childSource = INVENTORY.skills.find((row) => row.id === 'php56-yii-dev');
  for (const [key, value] of Object.entries(childSource)) assert.deepStrictEqual(child[key], value, `php56-yii-dev.${key}`);
  assert.strictEqual(child.path, 'skills/dhpk-yii1-php56-development');
  assert.deepStrictEqual(child.profiles, ['yii-1.1']);
  assert.deepStrictEqual(child.versionCondition, ['yii-1.1']);
  assert.strictEqual(child.owner, 'flow-drive');
});

test('common entries ignore old inventory surface membership in a host view', () => {
  const inventory = clone(INVENTORY);
  delete inventory.skills.find((skill) => skill.id === 'flow-drive').surfaces;
  const result = compilePublication({ inventory, hostSurface: 'agent-plugin' });
  assert.deepStrictEqual(result.errors, []);
  assert.ok(result.publicEntries.some((entry) => entry.id === 'flow-drive'));
  assert.strictEqual(result.publicEntries.length, 15);
});

test('host-only rows follow the requested inventory surface and no surface is implied', () => {
  for (const surface of INVENTORY.surfaces) {
    const result = compilePublication({ hostSurface: surface });
    assert.deepStrictEqual(result.errors, [], `${surface} errors`);
    const expected = SELECTION.skills.filter((row) => row.selection === 'host-only')
      .filter((row) => INVENTORY.skills.find((skill) => skill.id === row.id).surfaces.includes(surface))
      .map((row) => row.id).sort();
    assert.deepStrictEqual(result.hostOnly.map((row) => row.id).sort(), expected, `${surface} host-only rows`);
  }
  const agentOnly = compilePublication({ hostSurface: 'agent-plugin' }).hostOnly.map((entry) => entry.id).sort();
  assert.deepStrictEqual(agentOnly, ['cli-dispatch-context', 'cli-transport']);
});

test('the selection digest is SHA-256 over canonical JSON regardless of object key order', () => {
  const inventory = {
    surfaces: ['claude-core'],
    skills: [{ id: 'catalog-skill', name: 'catalog-skill', path: 'skills/catalog-skill', profiles: ['core'], surfaces: ['claude-core'] }],
  };
  const selection = {
    skills: [{ id: 'catalog-skill', authority: 'read-only', kind: 'entry', owner: 'catalog-skill', selection: 'common' }],
  };
  const reorderedSelection = {
    skills: [{ selection: 'common', owner: 'catalog-skill', kind: 'entry', id: 'catalog-skill', authority: 'read-only' }],
  };
  const result = compilePublication({ inventory, selection });
  const reordered = compilePublication({ inventory, selection: reorderedSelection });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.selectionDigest, '16f180efaf0ca4aea63a4897120b5f09849608ca0b1541c331ba7327f2e00085');
  assert.strictEqual(reordered.selectionDigest, result.selectionDigest);
});

test('the publication view freezes copied descriptors without freezing or changing inputs', () => {
  const inventory = clone(INVENTORY);
  const selection = clone(SELECTION);
  const inventoryBefore = JSON.stringify(inventory);
  const selectionBefore = JSON.stringify(selection);
  const result = compilePublication({ inventory, selection });
  const entry = result.publicEntries.find((row) => row.id === 'flow-guide');
  assert.strictEqual(JSON.stringify(inventory), inventoryBefore);
  assert.strictEqual(JSON.stringify(selection), selectionBefore);
  assert.ok(!Object.isFrozen(inventory.skills[0]));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.publicEntries));
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.profiles));
  assert.ok(Object.isFrozen(entry.usage));
  assert.ok(Object.isFrozen(entry.usage.actions));
  assert.ok(Object.isFrozen(entry.usage.actions[0]));
});

test('an invalid selected child fails closed without partial publication data', () => {
  const selection = clone(SELECTION);
  const child = selection.skills.find((skill) => skill.id === 'php56-yii-dev');
  child.owner = 'missing-owner';
  const result = compilePublication({ selection });
  assert.match(errorText(result), /php56-yii-dev/);
  assert.match(errorText(result), /owner/i);
  assert.deepStrictEqual(result.publicEntries, []);
  assert.deepStrictEqual(result.bundledChildren, {});
  assert.deepStrictEqual(result.hostOnly, []);
  assert.deepStrictEqual(result.withdrawn, []);
});

test('an unknown host surface fails closed without partial publication data', () => {
  const result = compilePublication({ hostSurface: 'missing-surface' });
  assert.match(errorText(result), /missing-surface/);
  assert.deepStrictEqual(result.publicEntries, []);
  assert.deepStrictEqual(result.bundledChildren, {});
  assert.deepStrictEqual(result.hostOnly, []);
  assert.deepStrictEqual(result.withdrawn, []);
});

test('a host-only row without inventory surface data fails closed', () => {
  const inventory = clone(INVENTORY);
  delete inventory.skills.find((skill) => skill.id === 'cli-transport').surfaces;
  const result = compilePublication({ inventory, hostSurface: 'agent-plugin' });
  assert.match(errorText(result), /cli-transport.*surfaces/i);
  assert.deepStrictEqual(result.publicEntries, []);
  assert.deepStrictEqual(result.bundledChildren, {});
  assert.deepStrictEqual(result.hostOnly, []);
  assert.deepStrictEqual(result.withdrawn, []);
});

test('the recorded naming decision is the user decision to keep current names', () => {
  assert.strictEqual(SELECTION.naming_decision.decided_by, 'user');
  assert.strictEqual(SELECTION.naming_decision.decided_on, '2026-10-02');
  for (const entry of compile().publicEntries) {
    const skill = INVENTORY.skills.find((candidate) => candidate.id === entry.id);
    assert.strictEqual(entry.name, skill.name);
  }
});

test('no selected name is a runtime alias', () => {
  const selected = compile();
  const aliasSet = new Set(ALIASES);
  for (const entry of [...selected.publicEntries, ...selected.hostOnly]) {
    assert.ok(!aliasSet.has(entry.name), `${entry.name} is a runtime alias`);
  }
});

test('every generated package lists skills under their inventory name, never an alias', () => {
  const inventoryNames = new Set(INVENTORY.skills.map((skill) => skill.name));
  const aliasSet = new Set(ALIASES);
  for (const { root: relative, surface, includeCommon } of PACKAGE_SKILL_CATALOGS) {
    const root = path.join(ROOT, relative);
    assert.ok(fs.existsSync(root), `${relative} must be generated`);
    const publication = compilePublication({ hostSurface: surface });
    assert.deepStrictEqual(publication.errors, [], `${surface} publication must compile`);
    const expectedEntries = includeCommon
      ? [...publication.publicEntries, ...publication.hostOnly]
      : publication.hostOnly;
    const expectedNames = expectedEntries.map((entry) => entry.name).sort();
    const actualNames = [];
    for (const directory of fs.readdirSync(root)) {
      const file = path.join(root, directory, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const name = frontmatterName(file);
      assert.strictEqual(name, directory, `${relative}/${directory} lists ${name}`);
      assert.ok(inventoryNames.has(name), `${relative}/${directory} is not an inventory name`);
      assert.ok(!aliasSet.has(name), `${relative}/${directory} is a runtime alias`);
      actualNames.push(name);
    }
    assert.deepStrictEqual(actualNames.sort(), expectedNames, `${relative} must contain exactly its published catalog entries`);
  }
});

test('an inventory ID missing from the selection fails closed', () => {
  const selection = clone(SELECTION);
  selection.skills = selection.skills.filter((skill) => skill.id !== 'code-trace');
  const result = compile({ selection });
  assert.match(errorText(result), /code-trace/);
  assert.match(errorText(result), /missing/i);
  assert.strictEqual(result.publicEntries.length, 0);
});

test('a duplicate or unknown selection ID fails closed', () => {
  const selection = clone(SELECTION);
  selection.skills.push({ ...selection.skills[0] });
  selection.skills.push({ id: 'ghost-skill', authority: 'read-only', kind: 'entry', owner: null, selection: 'common' });
  const text = errorText(compile({ selection }));
  assert.match(text, new RegExp(`duplicate.*${selection.skills[0].id}|${selection.skills[0].id}.*duplicate`, 'i'));
  assert.match(text, /ghost-skill/);
});

test('a child whose owner is not a common entry fails closed', () => {
  const selection = clone(SELECTION);
  const child = selection.skills.find((skill) => skill.selection === 'common' && skill.kind === 'branch');
  child.owner = 'tdd-missing-owner';
  const text = errorText(compile({ selection }));
  assert.match(text, new RegExp(child.id));
  assert.match(text, /owner/i);
});

test('a selected name that collides with a runtime alias fails closed', () => {
  const entry = compile().publicEntries[0];
  const result = compile({ aliases: [...ALIASES, entry.name] });
  assert.match(errorText(result), new RegExp(entry.name));
  assert.match(errorText(result), /alias/i);
});

test('a withdrawn row that claims an owner or a common selection fails closed', () => {
  const selection = clone(SELECTION);
  const withdrawn = selection.skills[0];
  withdrawn.kind = 'withdrawn';
  withdrawn.selection = 'common';
  const text = errorText(compile({ selection }));
  assert.match(text, new RegExp(withdrawn.id));
});

test('the compiled result is frozen and leaves its inputs untouched', () => {
  const selection = clone(SELECTION);
  const before = JSON.stringify(selection);
  const result = compile({ selection });
  assert.strictEqual(JSON.stringify(selection), before);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.publicEntries));
});

const TEST_SOURCES = [
  ...fs.readdirSync(path.join(ROOT, 'tests')).filter((name) => name.endsWith('.js')).map((name) => `tests/${name}`),
  ...fs.readdirSync(path.join(ROOT, 'tests', '_lib')).filter((name) => name.endsWith('.js')).map((name) => `tests/_lib/${name}`),
].map((relative) => ({ file: relative, text: fs.readFileSync(path.join(ROOT, relative), 'utf8') }));
const ledger = (overrides = {}) => compileDispositionLedger({
  inventory: INVENTORY,
  selection: SELECTION,
  aliases: ALIASES,
  root: ROOT,
  testSources: TEST_SOURCES,
  ...overrides,
});

test('the disposition ledger covers every active ID exactly once with owner, version condition, authority, and behavior', () => {
  const result = ledger();
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.rows.length, INVENTORY.skills.length);
  assert.strictEqual(new Set(result.rows.map((row) => row.id)).size, INVENTORY.skills.length);
  for (const row of result.rows) {
    assert.ok(['script', 'guidance-only', 'withdrawn'].includes(row.behavior), `${row.id} behavior`);
    assert.ok(Array.isArray(row.versionCondition), `${row.id} version condition`);
    if (row.kind !== 'withdrawn') assert.ok(row.authority, `${row.id} authority`);
    if (['branch', 'reference', 'internal'].includes(row.kind)) assert.ok(row.owner, `${row.id} owner`);
  }
});

test('every skill that ships scripts traces to at least one test file', () => {
  const scripted = ledger().rows.filter((row) => row.behavior === 'script');
  assert.ok(scripted.length > 0, 'scripted skills must retain executable test owners');
  for (const row of scripted) assert.ok(row.tests.length > 0, `${row.id} has no tracing test`);
});

test('a scripted skill without any tracing test fails closed', () => {
  const scripted = ledger().rows.find((row) => row.behavior === 'script');
  const testSources = TEST_SOURCES.map((source) => ({
    file: source.file,
    text: source.text.split(scripted.directory).join('removed-for-fixture'),
  }));
  const result = ledger({ testSources });
  assert.match(errorText(result), new RegExp(scripted.id));
  assert.match(errorText(result), /no test/i);
});

test('core skills have no version condition and module skills name their gating profiles', () => {
  const rows = ledger().rows;
  const core = rows.find((row) => row.id === 'flow-guide');
  assert.deepStrictEqual(core.versionCondition, []);
  const gated = rows.filter((row) => row.versionCondition.length > 0);
  assert.ok(gated.length > 0);
  for (const row of gated) assert.ok(!row.versionCondition.includes('core'), `${row.id} mixes core into a condition`);
});

run('marketplace-selection');
