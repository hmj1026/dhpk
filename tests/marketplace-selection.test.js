'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { compileMarketplaceSelection, compileDispositionLedger } = require('../scripts/lib/marketplace-selection');

const ROOT = path.join(__dirname, '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const INVENTORY = readJson('manifests/distribution-inventory.json');
const SELECTION = readJson('manifests/marketplace-selection.json');
const ALIASES = Object.keys(readJson('skills/flow-guide/references/codex-usage-catalog.json').runtimeIndex.aliases);
const PACKAGE_SKILL_ROOTS = [
  'plugins/dhpk/skills',
  'plugins/dhpk-agent/skills',
  'plugins/dhpk-agy/skills',
  'plugins/dhpk-cursor/skills',
  'generated/claude-marketplace/package/skills',
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const compile = (overrides = {}) => compileMarketplaceSelection({
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
  assert.strictEqual(result.hostOnly.length, 15);
  assert.strictEqual(result.withdrawn.length, 6);
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
  let checked = 0;
  for (const relative of PACKAGE_SKILL_ROOTS) {
    const root = path.join(ROOT, relative);
    if (!fs.existsSync(root)) continue;
    for (const directory of fs.readdirSync(root)) {
      const file = path.join(root, directory, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const name = frontmatterName(file);
      assert.strictEqual(name, directory, `${relative}/${directory} lists ${name}`);
      assert.ok(inventoryNames.has(name), `${relative}/${directory} is not an inventory name`);
      assert.ok(!aliasSet.has(name), `${relative}/${directory} is a runtime alias`);
      checked += 1;
    }
  }
  assert.ok(checked > 100, `expected the generated packages to be scanned, got ${checked}`);
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
  const withdrawn = selection.skills.find((skill) => skill.selection === 'withdrawn');
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

test('the disposition ledger covers all 81 IDs exactly once with owner, version condition, authority, and behavior', () => {
  const result = ledger();
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.rows.length, 81);
  assert.strictEqual(new Set(result.rows.map((row) => row.id)).size, 81);
  for (const row of result.rows) {
    assert.ok(['script', 'guidance-only', 'withdrawn'].includes(row.behavior), `${row.id} behavior`);
    assert.ok(Array.isArray(row.versionCondition), `${row.id} version condition`);
    if (row.kind !== 'withdrawn') assert.ok(row.authority, `${row.id} authority`);
    if (['branch', 'reference', 'internal'].includes(row.kind)) assert.ok(row.owner, `${row.id} owner`);
  }
});

test('every skill that ships scripts traces to at least one test file', () => {
  const scripted = ledger().rows.filter((row) => row.behavior === 'script');
  assert.ok(scripted.length >= 28, `expected the scripted skills to be found, got ${scripted.length}`);
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

test('every generated package that ships the vendored tomli parser keeps its MIT license beside it', () => {
  let packages = 0;
  for (const relative of PACKAGE_SKILL_ROOTS) {
    const vendor = path.join(ROOT, relative, 'harness-govern', 'scripts', 'multi_ai_sync_lib', 'vendor', 'tomli');
    if (!fs.existsSync(path.join(vendor, '_parser.py'))) continue;
    packages += 1;
    const license = path.join(vendor, 'LICENSE');
    assert.ok(fs.existsSync(license), `${relative} ships tomli without its LICENSE`);
    assert.match(fs.readFileSync(license, 'utf8'), /MIT License[\s\S]*Taneli Hukkinen/);
  }
  assert.ok(packages > 0, 'expected at least one package to ship tomli');
});

run('marketplace-selection');
