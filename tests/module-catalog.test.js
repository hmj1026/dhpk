'use strict';

// manifests/module-catalog.json is the installer's SSOT for stacks/versions.
// Every module id it advertises must have a real modules/<id>/module.yaml,
// otherwise the installer offers a module that cannot be enabled.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'module-catalog.json'), 'utf8'));

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

run('module-catalog');
