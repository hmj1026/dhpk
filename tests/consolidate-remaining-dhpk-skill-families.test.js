'use strict';

// RED contract for consolidate-remaining-dhpk-skill-families task 1.1.
//
// These assertions intentionally describe the 0.54.0 inventory before the
// implementation wave updates the checked-in inventory and its validators.
// Keep the expected IDs and mappings literal: deriving them from the
// inventory under test would make a missing, duplicated, or remapped row
// invisible to the canary.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');
const inventoryApi = require('../scripts/lib/distribution-inventory');
const profileApi = require('../scripts/lib/capability-bundle-selection');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const PROFILES = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));

const EXPECTED_PORTABLE_FAMILIES = Object.freeze([
  'change-verdict',
  'code-trace',
  'flow-drive',
  'flow-guide',
  'harness-govern',
  'laravel',
  'phpunit',
  'skill-forge',
  'skill-scope',
]);

const EXPECTED_MINIMAL_PROFILE = Object.freeze([
  'change-verdict',
  'code-trace',
  'flow-drive',
  'flow-guide',
  'git-smart-commit',
  'project-audit',
  'prompt-optimize',
  'tdd',
]);

const SHARED_SURFACES = Object.freeze([
  'agent-plugin',
  'cursor-plugin',
  'agy-plugin',
  'cursor-sync',
]);

const EXPECTED_SHARED_SURFACE_IDS = Object.freeze([
  'agent-architecture-audit',
  'agy-fast-worker',
  'change-verdict',
  'cli-dispatch-context',
  'cli-transport',
  'code-trace',
  'codex-bridge',
  'composer-package-hygiene',
  'deploy-list',
  'feature-verify',
  'flow-drive',
  'flow-guide',
  'git-smart-commit',
  'gitnexus-cli',
  'gitnexus-debugging',
  'gitnexus-exploring',
  'gitnexus-guide',
  'gitnexus-impact-analysis',
  'gitnexus-refactoring',
  'harness-govern',
  'issue-analyze',
  'laravel-package-author',
  'laravel-testbench-matrix',
  'opsx-apply-goal',
  'opsx-load-context',
  'opsx-post-obs',
  'polyfill-version-matrix-audit',
  'project-audit',
  'project-setup',
  'prompt-optimize',
  'release-creator',
  'repo-intake',
  'session-usage-audit',
  'skill-forge',
  'skill-scope',
  'software-architecture',
  'tdd',
]);

function replacement(kind, id, mode) {
  const row = { kind, id };
  if (mode !== undefined) row.mode = mode;
  return row;
}

function retirement(id, name, priorSurfaces, reasonCode, successor) {
  return {
    id,
    name,
    canonicalPath: `skills/${name}`,
    priorSurfaces,
    retiredIn: '0.54.0',
    reasonCode,
    replacements: [successor],
    rollback: { release: '0.53.0' },
  };
}

// This is the complete second-wave set. The former public name for the
// Laravel 5.4 package intentionally uses the repository's safe `5-4` form.
const EXPECTED_CURRENT_WAVE = Object.freeze([
  retirement('laravel-5.4-notes', 'dhpk-laravel-5-4-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '5.4')),
  retirement('laravel-6-notes', 'dhpk-laravel-6-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '6')),
  retirement('laravel-7-notes', 'dhpk-laravel-7-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '7')),
  retirement('laravel-8-notes', 'dhpk-laravel-8-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '8')),
  retirement('laravel-9-notes', 'dhpk-laravel-9-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '9')),
  retirement('laravel-10-notes', 'dhpk-laravel-10-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '10')),
  retirement('laravel-11-notes', 'dhpk-laravel-11-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', '11')),
  retirement('laravel-mix-notes', 'dhpk-laravel-mix-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'laravel', 'mix')),
  retirement('phpunit-9-modern', 'dhpk-phpunit-9-modern', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '9')),
  retirement('phpunit-10-notes', 'dhpk-phpunit-10-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '10')),
  retirement('phpunit-11-notes', 'dhpk-phpunit-11-notes', ['claude-module'], 'version-family-alias-removal', replacement('skill', 'phpunit', '11')),
  retirement('claude-health', 'dhpk-claude-health', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'health')),
  retirement('harness-budget', 'dhpk-harness-budget', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'budget')),
  retirement('harness-fill', 'dhpk-harness-fill', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'fill')),
  retirement('harness-revise', 'dhpk-harness-revise', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'revise')),
  retirement('multi-ai-sync', 'dhpk-cross-agent-sync', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'harness-govern', 'sync')),
  retirement('agy-commit', 'dhpk-agy-commit', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'git-smart-commit')),
  retirement('feasibility-study', 'dhpk-feasibility-study', ['claude-core', 'cursor-sync'], 'remaining-capability-family-consolidation', replacement('skill', 'software-architecture', 'compare')),
  retirement('tech-spec', 'dhpk-tech-spec', ['claude-core', 'cursor-sync'], 'openspec-authoring-consolidation', replacement('external-skill', 'openspec-propose', 'propose')),
  retirement('create-request', 'dhpk-create-request', ['claude-core', 'cursor-sync'], 'openspec-authoring-consolidation', replacement('external-skill', 'openspec-propose', 'propose')),
  retirement('op-session', 'dhpk-onepassword-session', ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'], 'operator-action-capability-removal', replacement('operator-action', 'onepassword-cli', 'signin')),
]);

const EXPECTED_RENAMES = Object.freeze([
  {
    id: 'laravel',
    oldName: 'dhpk-laravel',
    oldPath: 'skills/dhpk-laravel',
    newName: 'laravel',
    newPath: 'skills/laravel',
    rollback: { release: '0.53.0' },
  },
  {
    id: 'phpunit',
    oldName: 'dhpk-phpunit',
    oldPath: 'skills/dhpk-phpunit',
    newName: 'phpunit',
    newPath: 'skills/phpunit',
    rollback: { release: '0.53.0' },
  },
]);

const GIT_SMART_COMMIT_HASHES = Object.freeze({
  'skills/dhpk-git-smart-commit/SKILL.md': '7f7affef0d387cbc03185c37279b428b4a545b9e8c4b8746ce3c6b4a872f0cfc',
  'skills/dhpk-git-smart-commit/agents/openai.yaml': 'e9d135a5004c9c4efc661fa32fa5055914740dd67c1c78344b514f173a70be25',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortById(rows) {
  return rows.slice().sort((left, right) => left.id.localeCompare(right.id));
}

function expectedRetirementShape(row) {
  return {
    id: row.id,
    name: row.name,
    canonicalPath: row.canonicalPath,
    priorSurfaces: row.priorSurfaces,
    retiredIn: row.retiredIn,
    reasonCode: row.reasonCode,
    replacements: row.replacements,
    rollback: row.rollback,
  };
}

function expectedRenameShape(row) {
  return {
    id: row.id,
    oldName: row.oldName,
    oldPath: row.oldPath,
    newName: row.newName,
    newPath: row.newPath,
    rollback: row.rollback,
  };
}

function futureProfiles() {
  const result = clone(PROFILES);
  const currentWaveIds = new Set(EXPECTED_CURRENT_WAVE.map((row) => row.id));
  for (const profileId of ['minimal', 'full', 'compat-v1']) {
    const profile = result.profiles[profileId];
    if (!Array.isArray(profile.skillIds)) continue;
    profile.skillIds = profile.skillIds.filter((id) => !currentWaveIds.has(id));
    if (profileId !== 'minimal' && !profile.skillIds.includes('harness-govern')) {
      profile.skillIds.push('harness-govern');
    }
  }
  return result;
}

// Make a disposable, future-shaped inventory for mutation canaries. The live
// checkout is deliberately not modified, and the fixture keeps historical
// rows so the second-wave closed set is tested independently of prior waves.
function futureInventoryFixture() {
  const result = clone(INVENTORY);
  const currentWaveIds = new Set(EXPECTED_CURRENT_WAVE.map((row) => row.id));
  result.skills = result.skills
    .filter((entry) => !currentWaveIds.has(entry.id))
    .map((entry) => {
      const rename = EXPECTED_RENAMES.find((row) => row.id === entry.id);
      if (!rename) return entry;
      const renamed = { ...entry, name: rename.newName, path: rename.newPath };
      delete renamed.legacy_names;
      return renamed;
    });

  if (!result.skills.some((entry) => entry.id === 'harness-govern')) {
    const guide = result.skills.find((entry) => entry.id === 'flow-guide');
    result.skills.push({
      ...guide,
      id: 'harness-govern',
      name: 'harness-govern',
      path: 'skills/harness-govern',
      capability_id: 'dhpk.skill.harness-govern',
      name_style: 'portable-family',
      invocation_class: 'explicit-only',
    });
  }
  result.profile_policy.required_core_ids = EXPECTED_MINIMAL_PROFILE.slice();
  result.surface_membership = Object.fromEntries(SHARED_SURFACES.map((surface) => [surface, EXPECTED_SHARED_SURFACE_IDS.slice()]));
  result.retired_skills = result.retired_skills
    .filter((entry) => !currentWaveIds.has(entry.id))
    .concat(clone(EXPECTED_CURRENT_WAVE));
  result.renamed_skill_names = clone(EXPECTED_RENAMES);
  return result;
}

function assertDiagnostic(result, pattern, label) {
  assert.ok(result && Array.isArray(result.errors), `${label}: validator must return errors[]`);
  assert.ok(result.errors.some((error) => pattern.test(error)), `${label}: expected ${pattern}, got:\n${result.errors.join('\n')}`);
}

test('0.54.0 retirement ledger is the exact closed set of 21 approved rows', () => {
  const actual = INVENTORY.retired_skills
    .filter((entry) => entry.retiredIn === '0.54.0')
    .map(expectedRetirementShape);
  assert.strictEqual(actual.length, 21, 'the current migration wave must contain exactly 21 retirement rows');
  assert.deepStrictEqual(sortById(actual), sortById(EXPECTED_CURRENT_WAVE));

  for (const row of EXPECTED_CURRENT_WAVE) {
    assert.ok(!INVENTORY.skills.some((entry) => entry.id === row.id), `${row.id} must not remain active`);
    assert.ok(!INVENTORY.skills.some((entry) => entry.name === row.name), `${row.name} must not remain active`);
    assert.ok(!fs.existsSync(path.join(ROOT, row.canonicalPath)), `${row.canonicalPath} must not remain canonical`);
  }
});

test('consolidated inventory exposes exactly nine portable families and canonical name counts', () => {
  const families = INVENTORY.skills
    .filter((entry) => entry.name_style === 'portable-family')
    .map((entry) => ({ id: entry.id, name: entry.name, path: entry.path }));
  assert.deepStrictEqual(families.map((entry) => entry.id).sort(), [...EXPECTED_PORTABLE_FAMILIES].sort());
  assert.strictEqual(INVENTORY.skills.length, 65);
  assert.strictEqual(families.length, 9);
  assert.strictEqual(INVENTORY.skills.filter((entry) => /^dhpk-/.test(entry.name)).length, 56);
  for (const family of families) {
    assert.strictEqual(family.id, family.name);
    assert.strictEqual(family.path, `skills/${family.name}`);
  }
});

test('profiles and shared publication surfaces expose the approved closed counts', () => {
  const profileTable = PROFILES.profiles;
  assert.deepStrictEqual(profileTable.minimal.skillIds.slice().sort(), EXPECTED_MINIMAL_PROFILE.slice().sort());
  assert.strictEqual(profileTable.minimal.skillIds.length, 8);
  assert.strictEqual(profileTable.full.skillIds.length, 55);
  assert.strictEqual(profileTable['compat-v1'].skillIds.length, 62);

  for (const surface of SHARED_SURFACES) {
    const ids = INVENTORY.surface_membership[surface];
    assert.deepStrictEqual(ids.slice().sort(), EXPECTED_SHARED_SURFACE_IDS.slice().sort(), `${surface} must contain the exact 37 selected IDs`);
    assert.strictEqual(ids.length, 37, `${surface} must select 37 stable IDs`);
    for (const protectedId of ['gitnexus-cli', 'gitnexus-debugging', 'gitnexus-exploring', 'gitnexus-guide', 'gitnexus-impact-analysis', 'gitnexus-refactoring']) {
      assert.ok(ids.includes(protectedId), `${surface} must retain protected ${protectedId}`);
    }
  }
});

test('git-smart-commit remains the unchanged standalone owner while agy-commit retires', () => {
  const entry = INVENTORY.skills.find((skill) => skill.id === 'git-smart-commit');
  assert.deepStrictEqual({
    id: entry && entry.id,
    name: entry && entry.name,
    path: entry && entry.path,
    surfaces: entry && entry.surfaces,
  }, {
    id: 'git-smart-commit',
    name: 'dhpk-git-smart-commit',
    path: 'skills/dhpk-git-smart-commit',
    surfaces: ['claude-core', 'codex-sync', 'codex-native', 'cursor-sync'],
  });
  for (const [relative, expectedHash] of Object.entries(GIT_SMART_COMMIT_HASHES)) {
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex');
    assert.strictEqual(actualHash, expectedHash, `${relative} changed despite the protected identity contract`);
  }
  assert.ok(!INVENTORY.skills.some((skill) => skill.id === 'agy-commit'), 'agy-commit must not remain active');
  assert.ok(INVENTORY.retired_skills.some((row) => row.id === 'agy-commit' && row.retiredIn === '0.54.0'));
});

test('active Laravel and PHPUnit renames are diagnostic-only and alias-free', () => {
  const actual = Array.isArray(INVENTORY.renamed_skill_names)
    ? INVENTORY.renamed_skill_names.map(expectedRenameShape)
    : null;
  assert.deepStrictEqual(actual && actual.slice().sort((left, right) => left.id.localeCompare(right.id)), EXPECTED_RENAMES.slice().sort((left, right) => left.id.localeCompare(right.id)));
  for (const row of EXPECTED_RENAMES) {
    const entry = INVENTORY.skills.find((skill) => skill.id === row.id);
    assert.ok(entry, `${row.id} must retain its stable ID`);
    assert.strictEqual(entry.name, row.newName);
    assert.strictEqual(entry.path, row.newPath);
    assert.ok(!Array.isArray(entry.legacy_names) || !entry.legacy_names.includes(row.oldName), `${row.oldName} must not be emitted as an alias`);
    assert.ok(!fs.existsSync(path.join(ROOT, row.oldPath)), `${row.oldPath} must not remain canonical`);
  }
});

test('active public-name rename ledger mutation canaries fail closed', () => {
  const cases = [
    ['missing ledger', (inventory) => { delete inventory.renamed_skill_names; }, /renamed_skill_names.*required|required.*renamed_skill_names/i],
    ['unexpected row', (inventory) => { inventory.renamed_skill_names.push({ ...inventory.renamed_skill_names[0], id: 'extra' }); }, /unexpected.*extra|extra.*unexpected|exactly.*2/i],
    ['duplicate row', (inventory) => { inventory.renamed_skill_names.push(clone(inventory.renamed_skill_names[0])); }, /duplicate.*laravel|laravel.*duplicate/i],
    ['wrong public name', (inventory) => { inventory.renamed_skill_names[0].newName = 'wrong'; }, /laravel.*newName|newName.*laravel/i],
    ['wrong canonical path', (inventory) => { inventory.renamed_skill_names[0].newPath = 'skills/wrong'; }, /laravel.*newPath|newPath.*laravel/i],
    ['wrong rollback', (inventory) => { inventory.renamed_skill_names[0].rollback.release = '0.52.0'; }, /laravel.*0\.53\.0|0\.53\.0.*laravel/i],
    ['unknown field', (inventory) => { inventory.renamed_skill_names[0].alias = true; }, /laravel.*unknown.*alias|alias.*unknown/i],
    ['old name alias', (inventory) => { inventory.skills.find((entry) => entry.id === 'laravel').legacy_names = ['dhpk-laravel']; }, /dhpk-laravel.*alias|alias.*dhpk-laravel/i],
    ['old canonical path', (inventory) => { inventory.skills.find((entry) => entry.id === 'laravel').path = 'skills/dhpk-laravel'; }, /dhpk-laravel.*old path|old path.*dhpk-laravel|laravel.*newPath/i],
  ];
  for (const [label, mutate, expected] of cases) {
    const inventory = futureInventoryFixture();
    mutate(inventory);
    const result = inventoryApi.validateRenamedSkillNames({ inventory });
    assertDiagnostic(result, expected, label);
  }

  const integrated = futureInventoryFixture();
  delete integrated.renamed_skill_names;
  assertDiagnostic(
    inventoryApi.validateDistributionInventoryV2({ inventory: integrated, root: ROOT }),
    /renamed_skill_names.*required|required.*renamed_skill_names/i,
    'v2 integration',
  );
});

test('retirement mutation canaries fail closed for omission, duplicate, remap, release, rollback, and kind drift', () => {
  const missing = futureInventoryFixture();
  missing.retired_skills = missing.retired_skills.filter((entry) => entry.id !== 'agy-commit');
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: missing }),
    /missing.*agy-commit|agy-commit.*missing|0\.54\.0.*agy-commit/i,
    'missing 0.54.0 row',
  );

  const duplicate = futureInventoryFixture();
  duplicate.retired_skills.push(clone(EXPECTED_CURRENT_WAVE.find((entry) => entry.id === 'agy-commit')));
  assertDiagnostic(inventoryApi.validateSkillRetirements({ inventory: duplicate }), /duplicate.*agy-commit/i, 'duplicate row');

  const unexpected = futureInventoryFixture();
  unexpected.retired_skills.push(retirement(
    'retirement-canary',
    'dhpk-retirement-canary',
    ['claude-core'],
    'test-only-mutation',
    replacement('skill', 'flow-guide', 'route'),
  ));
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: unexpected }),
    /unexpected.*retirement-canary|retirement-canary.*unexpected|0\.54\.0.*retirement-canary/i,
    'unexpected current-wave row',
  );

  const remapped = futureInventoryFixture();
  remapped.retired_skills.find((entry) => entry.id === 'agy-commit').replacements = [replacement('skill', 'flow-guide', 'route')];
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: remapped }),
    /agy-commit.*git-smart-commit|git-smart-commit.*agy-commit/i,
    'remapped agy-commit successor',
  );

  const wrongRelease = futureInventoryFixture();
  wrongRelease.retired_skills.find((entry) => entry.id === 'agy-commit').retiredIn = '0.53.0';
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongRelease }),
    /agy-commit.*0\.54\.0|0\.54\.0.*agy-commit/i,
    'wrong retirement release',
  );

  const wrongRollback = futureInventoryFixture();
  wrongRollback.retired_skills.find((entry) => entry.id === 'agy-commit').rollback.release = '0.52.0';
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongRollback }),
    /agy-commit.*0\.53\.0|0\.53\.0.*agy-commit/i,
    'wrong rollback release',
  );

  const wrongKind = futureInventoryFixture();
  wrongKind.retired_skills.find((entry) => entry.id === 'tech-spec').replacements = [replacement('skill', 'flow-drive', 'implement')];
  assertDiagnostic(
    inventoryApi.validateSkillRetirements({ inventory: wrongKind }),
    /tech-spec.*openspec-propose|openspec-propose.*tech-spec/i,
    'wrong replacement kind or identity',
  );
});

test('profile, surface, and protected-identity mutation canaries fail closed', () => {
  const inventory = futureInventoryFixture();
  const profiles = futureProfiles();

  const duplicateProfile = clone(profiles);
  duplicateProfile.profiles.minimal.skillIds.push('flow-guide');
  const duplicateResult = profileApi.validateProfileDefinitions({
    inventory,
    profiles: duplicateProfile,
    moduleCatalog: require('../manifests/module-catalog.json'),
  });
  assert.ok(duplicateResult.errors.some((error) => /duplicate.*flow-guide|flow-guide.*duplicate|profile.*duplicate/i.test(error)), duplicateResult.errors.join('\n'));

  const retiredProfile = clone(profiles);
  retiredProfile.profiles['compat-v1'].skillIds.push('agy-commit');
  const retiredResult = profileApi.validateProfileDefinitions({
    inventory,
    profiles: retiredProfile,
    moduleCatalog: require('../manifests/module-catalog.json'),
  });
  assert.ok(retiredResult.errors.some((error) => /agy-commit.*retired|retired.*agy-commit/i.test(error)), retiredResult.errors.join('\n'));

  const protectedOmission = clone(profiles);
  protectedOmission.profiles.full.skillIds = protectedOmission.profiles.full.skillIds.filter((id) => id !== 'gitnexus-cli');
  const protectedResult = profileApi.validateProfileDefinitions({
    inventory,
    profiles: protectedOmission,
    moduleCatalog: require('../manifests/module-catalog.json'),
  });
  assert.ok(protectedResult.errors.some((error) => /gitnexus-cli.*protected|protected.*gitnexus-cli/i.test(error)), protectedResult.errors.join('\n'));

  const surfaceMutation = futureInventoryFixture();
  surfaceMutation.surface_membership['agent-plugin'].push('agy-commit');
  const surfaceResult = inventoryApi.validateSurfaceMembership({
    inventory: surfaceMutation,
    ids: new Set(surfaceMutation.skills.map((entry) => entry.id)),
  });
  assert.ok(surfaceResult.errors.some((error) => /agent-plugin.*agy-commit|agy-commit.*(?:unknown|retired|surface)/i.test(error)), surfaceResult.errors.join('\n'));
});

run('consolidate-remaining-dhpk-skill-families');
