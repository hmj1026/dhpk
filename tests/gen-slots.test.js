'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'scripts', 'lib', 'sentinel-slots.json');
const GENERATOR_PATH = path.join(ROOT, 'scripts', 'ci', 'gen-slots.js');

const { loadRegistry, renderPayloadBlock, renderRouteBlock, checkGeneratedFiles } =
  require(GENERATOR_PATH);

test('registry preserves ordered slot identity and aligned defaults', () => {
  const registry = loadRegistry(ROOT);
  assert.strictEqual(registry.schema, 'dhpk.sentinel-slots.v1');
  assert.ok(Array.isArray(registry.slots) && registry.slots.length > 0);
  assert.deepStrictEqual(
    registry.slots.map((slot) => slot.id),
    ['code', 'db', 'sec', 'frontend', 'doc', 'polyfill', 'migration']
  );
  for (const slot of registry.slots) {
    assert.match(slot.name, /^\.pending-[a-z-]+$/);
    assert.match(slot.label, /^[a-z-]+$/);
    assert.match(slot.short_name, /^[a-z]+$/);
    assert.strictEqual(slot.default_agent, slot.label);
    assert.ok(slot.triggers && typeof slot.triggers === 'object');
  }
});

test('generated payload and route blocks are derived from the same registry', () => {
  const registry = loadRegistry(ROOT);
  const payload = renderPayloadBlock(registry);
  const route = renderRouteBlock(registry);

  assert.ok(payload.includes('SENTINEL_NAMES=(".pending-review"'));
  assert.ok(payload.includes('SENTINEL_LABELS=("code-reviewer"'));
  assert.ok(payload.includes('SENTINEL_SHORT_NAMES=("code"'));
  assert.ok(payload.includes('_dhpk_default_agents=("code-reviewer"'));
  assert.ok(route.includes('dhpk_route_slot()'));
  assert.ok(route.includes('NEEDS[0]=1'));
  assert.ok(route.includes('NEEDS[4]=1'));
  assert.ok(!route.includes('NEEDS[6]=1'), 'migration remains opt-in through module/user triggers');
});

test('checked-in generated views are current', () => {
  const result = checkGeneratedFiles(ROOT);
  assert.deepStrictEqual(result, { stale: [], missing: [] });
});

test('registry and generator are checked-in artifacts', () => {
  assert.ok(fs.existsSync(REGISTRY_PATH));
  assert.ok(fs.existsSync(GENERATOR_PATH));
});

run('gen-slots');
