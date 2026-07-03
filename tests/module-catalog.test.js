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

test('full profile: full.modules union full.excludes = every shipped module, disjoint', () => {
  const full = profiles.profiles.full;
  const inc = new Set(full.modules);
  const exc = new Set(Object.keys(full.excludes || {}));
  const shipped = shippedModuleIds();
  const shippedSet = new Set(shipped);

  const overlap = [...inc].filter((id) => exc.has(id));
  assert.ok(overlap.length === 0, `ids in both full.modules and full.excludes: ${overlap.join(', ')}`);

  const missing = shipped.filter((id) => !inc.has(id) && !exc.has(id));
  assert.ok(missing.length === 0, `shipped modules missing from full.modules and full.excludes: ${missing.join(', ')}`);

  const phantomInc = [...inc].filter((id) => !shippedSet.has(id));
  assert.ok(phantomInc.length === 0, `full.modules ids with no modules/<id>/module.yaml: ${phantomInc.join(', ')}`);

  const phantomExc = [...exc].filter((id) => !shippedSet.has(id));
  assert.ok(phantomExc.length === 0, `full.excludes ids with no modules/<id>/module.yaml: ${phantomExc.join(', ')}`);
});

run('module-catalog');
