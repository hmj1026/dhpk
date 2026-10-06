'use strict';

// manifests/module-catalog.json is the installer's SSOT for stacks/versions.
// Every module id it advertises must have a real modules/<id>/module.yaml,
// otherwise the installer offers a module that cannot be enabled.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));
const profiles = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), 'utf8'));
const marketplaceSelection = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'marketplace-selection.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

function catalogModuleIds() {
  const ids = new Set();
  const stacks = Array.isArray(catalog.stacks) ? catalog.stacks : Object.values(catalog.stacks || {});
  for (const st of stacks) {
    for (const v of st.versions || st.modules || []) {
      if (typeof v === 'string') ids.add(v);
      else if (v && v.module) ids.add(v.module);
      else if (v && v.id) ids.add(v.id);
    }
  }
  return [...ids];
}

function shippedModuleIds() {
  const modulesDir = path.join(ROOT, 'modules');
  return fs.readdirSync(modulesDir).filter((d) =>
    fs.existsSync(path.join(modulesDir, d, 'module.yaml'))
  );
}

const ids = catalogModuleIds();

test('catalog advertises at least one module', () => {
  assert.ok(ids.length > 0, 'no module ids parsed from catalog stacks');
});

test('every catalog module id has modules/<id>/module.yaml', () => {
  for (const id of ids) {
    const yaml = path.join(ROOT, 'modules', id, 'module.yaml');
    assert.ok(fs.existsSync(yaml), `catalog id '${id}' has no modules/${id}/module.yaml`);
  }
});

test('every shipped module is catalog-selectable', () => {
  const idSet = new Set(ids);
  for (const shippedId of shippedModuleIds()) {
    assert.ok(idSet.has(shippedId), `module '${shippedId}' has no selectable catalog entry`);
  }
});

test('active profiles select catalogued shipped modules and common owns marketplace skills', () => {
  const declaredProfiles = profiles.profiles;
  const catalogIds = new Set(ids);
  const shippedIds = new Set(shippedModuleIds());
  for (const [profileId, profile] of Object.entries(declaredProfiles)) {
    const selected = Array.isArray(profile.modules) ? profile.modules : [];
    const excluded = Object.keys(profile.excludes || {});
    const excludedIds = new Set(excluded);
    const overlap = selected.filter((id) => excludedIds.has(id));
    assert.deepStrictEqual(overlap, [], `${profileId} selects and excludes the same modules`);

    for (const id of [...selected, ...excluded]) {
      assert.ok(catalogIds.has(id), `${profileId} module '${id}' is missing from the module catalog`);
      assert.ok(shippedIds.has(id), `${profileId} module '${id}' has no shipped modules/${id}/module.yaml`);
    }
  }

  const common = declaredProfiles.common;
  assert.deepStrictEqual(common.modules, [], 'common selects no language/framework modules');
  const commonSkillIds = common.skillIds;
  const marketplaceCommonIds = marketplaceSelection.skills
    .filter((entry) => entry.selection === 'common' && entry.kind === 'entry')
    .map((entry) => entry.id);
  assert.ok(Array.isArray(commonSkillIds), 'common.skillIds must be an explicit list');
  assert.strictEqual(new Set(commonSkillIds).size, commonSkillIds.length, 'common.skillIds must be unique');
  assert.deepStrictEqual(commonSkillIds.slice().sort(), marketplaceCommonIds.slice().sort(),
    'common.skillIds must match marketplace common entry ownership');

  const inventorySkillIds = new Set(inventory.skills.map((entry) => entry.id));
  const commonSkillSet = new Set(commonSkillIds);
  for (const id of inventory.profile_policy.required_core_ids) {
    assert.ok(inventorySkillIds.has(id), `required core skill '${id}' must have an active inventory entry`);
    assert.ok(commonSkillSet.has(id), `common must include required core skill '${id}'`);
  }
});

run('module-catalog');
