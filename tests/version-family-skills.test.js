'use strict';

// Contract for the consolidated Laravel and PHPUnit family skills.  These
// tests were authored against the pre-consolidation tree as the RED baseline;
// the family implementation is now present, so the focused run should be
// GREEN.
//
// The family-local resolver is deliberately exercised through its public
// module and JSON CLI.  These tests do not parse SKILL.md to infer behavior:
// the resolver must select one reference, load its guidance, and report an
// actionable ask when selection is impossible.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const {
  generateClaudeSkillRoots,
  resolveSkillRoutingAlias,
  resolveSkillRoutingReference,
  validateSkillRoutingFamilies,
} = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');
const INVENTORY_FILE = path.join(ROOT, 'manifests', 'distribution-inventory.json');

const FAMILY_CONTRACTS = Object.freeze({
  laravel: Object.freeze({
    directory: 'dhpk-laravel',
    selectors: Object.freeze(['5.4', '6', '7', '8', '9', '10', '11', 'mix']),
    references: Object.freeze({
      '5.4': 'references/5-4.md',
      '6': 'references/6.md',
      '7': 'references/7.md',
      '8': 'references/8.md',
      '9': 'references/9.md',
      '10': 'references/10.md',
      '11': 'references/11.md',
      mix: 'references/mix.md',
    }),
    legacyIds: Object.freeze({
      '5.4': 'laravel-5.4-notes',
      '6': 'laravel-6-notes',
      '7': 'laravel-7-notes',
      '8': 'laravel-8-notes',
      '9': 'laravel-9-notes',
      '10': 'laravel-10-notes',
      '11': 'laravel-11-notes',
      mix: 'laravel-mix-notes',
    }),
    composerJson: { require: { 'laravel/framework': '^9.0' } },
  }),
  phpunit: Object.freeze({
    directory: 'dhpk-phpunit',
    selectors: Object.freeze(['9', '10', '11']),
    references: Object.freeze({
      '9': 'references/9.md',
      '10': 'references/10.md',
      '11': 'references/11.md',
    }),
    legacyIds: Object.freeze({
      '9': 'phpunit-9-modern',
      '10': 'phpunit-10-notes',
      '11': 'phpunit-11-notes',
    }),
    composerJson: { require: { 'phpunit/phpunit': '^9.6' } },
  }),
});

function readInventory() {
  return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
}

function familyRoot(family) {
  return path.join(ROOT, 'skills', FAMILY_CONTRACTS[family].directory);
}

function apiPath(family) {
  return path.join(familyRoot(family), 'scripts', 'version-resolver.js');
}

function cliPath(family) {
  return path.join(familyRoot(family), 'scripts', 'resolve-version.js');
}

function loadResolver(family) {
  try {
    return require(apiPath(family));
  } catch (error) {
    return { __loadError: error };
  }
}

function resolveViaApi(family, options) {
  const resolver = loadResolver(family);
  assert.ifError(resolver.__loadError);
  assert.strictEqual(
    typeof resolver.resolveVersion,
    'function',
    `${family} family resolver must export resolveVersion(options)`,
  );
  return resolver.resolveVersion(options);
}

function runFamilyCli(family, args, cwd) {
  return spawnSync(process.execPath, [cliPath(family), '--json', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
    timeout: 10000,
  });
}

function writeFiles(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function withProject(files, callback) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-project-'));
  try {
    writeFiles(project, files);
    return callback(project);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function expectedReference(family, selector) {
  return FAMILY_CONTRACTS[family].references[selector];
}

function assertResolved(result, family, selector, source) {
  const reference = expectedReference(family, selector);
  assert.strictEqual(result.status, 'resolved');
  assert.strictEqual(result.family, family);
  assert.strictEqual(result.selector, selector);
  assert.strictEqual(result.source, source);
  assert.strictEqual(result.reference, reference);
  assert.deepStrictEqual(result.loadedReferences, [reference]);
  assert.strictEqual(typeof result.guidance, 'string');
  assert.strictEqual(
    result.guidance,
    fs.readFileSync(path.join(familyRoot(family), reference), 'utf8'),
    `${family} resolver must return the selected reference guidance`,
  );
  assert.ok(
    result.loadedReferences.every((loaded) => loaded === reference),
    `${family} resolver must not load sibling-version references`,
  );
}

test('Laravel API resolves every explicit selector and loads exactly one version reference', () => {
  withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
    for (const selector of FAMILY_CONTRACTS.laravel.selectors) {
      const result = resolveViaApi('laravel', { version: selector, cwd });
      assertResolved(result, 'laravel', selector, 'explicit');
    }
  });
});

test('PHPUnit API resolves every explicit selector and loads exactly one version reference', () => {
  withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
    for (const selector of FAMILY_CONTRACTS.phpunit.selectors) {
      const result = resolveViaApi('phpunit', { version: selector, cwd });
      assertResolved(result, 'phpunit', selector, 'explicit');
    }
  });
});

test('Laravel API auto-detects its version from composer.json without a dhpk manifest', () => {
  withProject({ 'composer.json': JSON.stringify(FAMILY_CONTRACTS.laravel.composerJson) }, (cwd) => {
    const result = resolveViaApi('laravel', { cwd });
    assertResolved(result, 'laravel', '9', 'composer.json');
  });
});

test('PHPUnit API auto-detects its version from composer.lock without a dhpk manifest', () => {
  withProject({
    'composer.lock': JSON.stringify({
      packages: [{ name: 'phpunit/phpunit', version: '10.5.20' }],
      'packages-dev': [],
    }),
  }, (cwd) => {
    const result = resolveViaApi('phpunit', { cwd });
    assertResolved(result, 'phpunit', '10', 'composer.lock');
  });
});

test('Laravel API fails closed with an actionable ask when no version can be detected', () => {
  withProject({}, (cwd) => {
    const result = resolveViaApi('laravel', { cwd });
    assert.strictEqual(result.status, 'ask');
    assert.strictEqual(result.selector, null);
    assert.strictEqual(result.reference, null);
    assert.deepStrictEqual(result.loadedReferences, []);
    assert.strictEqual(typeof result.question, 'string');
    assert.match(result.question, /Laravel/i);
    assert.match(result.question, /version/i);
  });
});

test('PHPUnit API fails closed with an actionable ask for an unsupported version', () => {
  withProject({}, (cwd) => {
    const result = resolveViaApi('phpunit', { version: '12', cwd });
    assert.strictEqual(result.status, 'ask');
    assert.strictEqual(result.selector, null);
    assert.strictEqual(result.reference, null);
    assert.deepStrictEqual(result.loadedReferences, []);
    assert.strictEqual(typeof result.question, 'string');
    assert.match(result.question, /PHPUnit/i);
    assert.match(result.question, /version/i);
  });
});

test('Laravel resolver CLI returns the explicit selector contract as JSON', () => {
  withProject({ 'composer.json': '{ malformed explicit-only probe' }, (cwd) => {
    const result = runFamilyCli('laravel', ['--version', '8'], cwd);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assertResolved(payload, 'laravel', '8', 'explicit');
  });
});

test('Laravel resolver CLI returns an ask contract and nonzero exit for an unsupported selector', () => {
  withProject({}, (cwd) => {
    const result = runFamilyCli('laravel', ['--version', '12'], cwd);
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'ask');
    assert.strictEqual(payload.family, undefined);
    assert.strictEqual(payload.selector, null);
    assert.strictEqual(payload.reference, null);
    assert.deepStrictEqual(payload.loadedReferences, []);
    assert.match(payload.question, /Laravel/i);
    assert.match(payload.question, /version/i);
  });
});

test('Laravel resolver CLI returns an ask contract and nonzero exit when no version is available', () => {
  withProject({}, (cwd) => {
    const result = runFamilyCli('laravel', [], cwd);
    assert.strictEqual(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'ask');
    assert.strictEqual(payload.family, undefined);
    assert.strictEqual(payload.selector, null);
    assert.strictEqual(payload.reference, null);
    assert.deepStrictEqual(payload.loadedReferences, []);
    assert.match(payload.question, /Laravel/i);
    assert.match(payload.question, /version/i);
  });
});

test('PHPUnit resolver CLI returns the auto-detected selector contract as JSON', () => {
  withProject({
    'composer.json': JSON.stringify({ require: { 'phpunit/phpunit': '^11.0' } }),
  }, (cwd) => {
    const result = runFamilyCli('phpunit', [], cwd);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assertResolved(payload, 'phpunit', '11', 'composer.json');
  });
});

test('a copied Laravel family directory resolves explicitly with no repository dependencies', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-copy-'));
  try {
    const copiedFamily = path.join(stage, 'dhpk-laravel');
    const emptyProject = path.join(stage, 'empty-project');
    fs.cpSync(familyRoot('laravel'), copiedFamily, { recursive: true });
    fs.mkdirSync(emptyProject);

    const result = spawnSync(process.execPath, [
      path.join(copiedFamily, 'scripts', 'resolve-version.js'),
      '--json', '--version', '6',
    ], {
      cwd: emptyProject,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assertResolved(payload, 'laravel', '6', 'explicit');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test('a copied PHPUnit family directory resolves explicitly with no repository dependencies', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-version-family-copy-'));
  try {
    const copiedFamily = path.join(stage, 'dhpk-phpunit');
    const emptyProject = path.join(stage, 'empty-project');
    fs.cpSync(familyRoot('phpunit'), copiedFamily, { recursive: true });
    fs.mkdirSync(emptyProject);

    const result = spawnSync(process.execPath, [
      path.join(copiedFamily, 'scripts', 'resolve-version.js'),
      '--json', '--version', '9',
    ], {
      cwd: emptyProject,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assertResolved(payload, 'phpunit', '9', 'explicit');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
});

test('checked-in legacy IDs resolve to family references while preserving invocation class and surfaces', () => {
  const inventory = readInventory();
  const families = inventory.skill_routing_families || [];
  const familyById = new Map(families.map((family) => [family.id, family]));

  for (const [familyId, contract] of Object.entries(FAMILY_CONTRACTS)) {
    const family = familyById.get(familyId);
    assert.ok(family, `${familyId} routing family must exist`);
    assert.strictEqual(family.router_id, 'php-pro');
    assert.strictEqual(family.invocation_class, 'implicit-eligible');
    const familyEntry = inventory.skills.find((skill) => skill.id === familyId);
    assert.ok(familyEntry, `${familyId} family skill must have a canonical inventory entry`);
    assert.strictEqual(familyEntry.path, `skills/${contract.directory}`);
    assert.strictEqual(familyEntry.lifecycle, 'promoted');
    assert.strictEqual(familyEntry.invocation_class, family.invocation_class);
    assert.ok(familyEntry.surfaces.includes('claude-core'));

    for (const selector of contract.selectors) {
      const legacyId = contract.legacyIds[selector];
      const alias = family.aliases.find((candidate) => candidate.id === legacyId);
      const legacyEntry = inventory.skills.find((skill) => skill.id === legacyId);
      const reference = `skills/${contract.directory}/${contract.references[selector]}`;

      assert.ok(alias, `${legacyId} must be retained as one family alias`);
      assert.ok(legacyEntry, `${legacyId} must retain an inventory identity`);
      assert.strictEqual(family.selectors[selector], reference);
      assert.strictEqual(alias.selector, selector);
      assert.strictEqual(alias.invocation_class, family.invocation_class);
      assert.deepStrictEqual([...alias.surfaces].sort(), [...family.surfaces].sort());
      assert.strictEqual(legacyEntry.invocation_class, family.invocation_class);
      assert.deepStrictEqual([...legacyEntry.surfaces].sort(), [...alias.surfaces].sort());

      assert.deepStrictEqual(resolveSkillRoutingAlias({ families, id: legacyId }), {
        familyId,
        routerId: family.router_id,
        selector,
        reference,
      });
      assert.strictEqual(resolveSkillRoutingReference({ inventory, families, id: legacyId }), reference);
    }
  }
});

test('legacy family aliases are lifecycle-hidden and absent from discovery-generated IDs', () => {
  const inventory = readInventory();
  const generated = generateClaudeSkillRoots(inventory).generatedSkillIds;

  for (const contract of Object.values(FAMILY_CONTRACTS)) {
    for (const legacyId of Object.values(contract.legacyIds)) {
      const entry = inventory.skills.find((skill) => skill.id === legacyId);
      assert.ok(entry, `${legacyId} must remain addressable in the inventory`);
      assert.strictEqual(entry.lifecycle, 'deprecated');
      assert.strictEqual(entry.discoveryVisible, false);
      assert.ok(!generated.includes(legacyId), `${legacyId} must not be discovery-generated`);
    }
  }
});

function routingFixture() {
  return {
    id: 'laravel',
    router_id: 'php-pro',
    invocation_class: 'implicit-eligible',
    surfaces: ['claude-module'],
    selectors: { '8': 'skills/dhpk-laravel/references/8.md' },
    aliases: [{
      id: 'laravel-8-notes',
      selector: '8',
      invocation_class: 'implicit-eligible',
      surfaces: ['claude-module'],
    }],
  };
}

function validateRoutingFixture(families) {
  return validateSkillRoutingFamilies({
    families,
    skillIds: new Set(['php-pro']),
    skills: [],
  });
}

test('routing validator rejects an alias that names no selector', () => {
  const family = routingFixture();
  family.aliases[0].selector = 'missing';
  const result = validateRoutingFixture([family]);
  assert.ok(result.errors.some((error) => /ambiguous\/missing selector/.test(error)), result.errors.join('\n'));
  assert.strictEqual(resolveSkillRoutingReference({ families: [family], familyId: 'laravel', selector: 'missing' }), null);
});

test('routing validator rejects invocation-class and surface drift on an alias', () => {
  const family = routingFixture();
  family.aliases[0].invocation_class = 'explicit-only';
  family.aliases[0].surfaces = ['claude-core'];
  const result = validateRoutingFixture([family]);
  assert.ok(result.errors.some((error) => /conflicting invocation class/.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /unsupported surface membership/.test(error)), result.errors.join('\n'));
  assert.strictEqual(resolveSkillRoutingReference({ families: [family], id: 'laravel-8-notes' }), null);
});

test('routing resolver rejects unsafe references and duplicate alias identities', () => {
  const unsafe = routingFixture();
  unsafe.selectors['8'] = '../outside/SKILL.md';
  const duplicate = routingFixture();
  duplicate.id = 'phpunit';
  duplicate.aliases[0].id = 'laravel-8-notes';
  const families = [unsafe, duplicate];
  const result = validateRoutingFixture(families);
  assert.ok(result.errors.some((error) => /safe relative path/.test(error)), result.errors.join('\n'));
  assert.ok(result.errors.some((error) => /duplicate alias/.test(error)), result.errors.join('\n'));
  assert.strictEqual(resolveSkillRoutingReference({ families, id: 'laravel-8-notes' }), null);
});

run('version-family-skills');
