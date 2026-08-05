'use strict';

// RED (task 4.1, curate-dhpk-distribution-surfaces): computeScopedCounts does
// not exist yet in scripts/lib/distribution-inventory.js. Pins the count
// contract task 4.2 wires into scripts/ci/catalog.js: canonical, promoted-core,
// optional, experimental, deprecated, Claude-published, and Codex-published
// counts must each be independently computable and MUST NOT silently collapse
// to the same number (harness-count-integrity spec: "Documentation SHALL use
// the count whose scope matches the claim and SHALL NOT present canonical
// inventory as the default installed surface").

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { computeScopedCounts } = require('../scripts/lib/distribution-inventory');

const ROOT = path.join(__dirname, '..');

function fixtureInventory() {
  return {
    skills: [
      { id: 'a', path: 'skills/a', lifecycle: 'promoted', surfaces: ['claude-core'] },
      { id: 'b', path: 'skills/b', lifecycle: 'promoted', surfaces: ['claude-core', 'codex-sync'] },
      { id: 'c', path: 'modules/x/skills/c', lifecycle: 'optional', surfaces: ['claude-module'] },
      { id: 'd', path: 'modules/x/skills/d', lifecycle: 'experimental', surfaces: ['claude-module'] },
      { id: 'e', path: 'skills/e', lifecycle: 'deprecated', surfaces: ['claude-core'] },
    ],
    modules: [{ id: 'x', path: 'modules/x', lifecycle: 'optional', surfaces: ['claude-module'] }],
  };
}

test('computes independent canonical/promoted-core/optional/experimental/deprecated counts', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.canonical, 5);
  assert.strictEqual(counts.promotedCore, 2);
  assert.strictEqual(counts.optional, 1);
  assert.strictEqual(counts.experimental, 1);
  assert.strictEqual(counts.deprecated, 1);
});

test('Claude-published count excludes deprecated (host still lists the root, but the count is the inventory-derived intent)', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.claudePublished, 4);
});

test('Codex-published count is the codex-sync/codex-native surface count, distinct from promoted-core', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.strictEqual(counts.codexPublished, 1);
});

test('canonical count never silently equals a scoped count when they truly differ (regression guard against count aliasing)', () => {
  const counts = computeScopedCounts(fixtureInventory());
  assert.notStrictEqual(counts.canonical, counts.promotedCore);
  assert.notStrictEqual(counts.canonical, counts.codexPublished);
  assert.notStrictEqual(counts.canonical, counts.claudePublished);
});

test('module lifecycle counts are computed with the same rigor as skill lifecycle counts', () => {
  const inv = fixtureInventory();
  inv.modules.push(
    { id: 'y', path: 'modules/y', lifecycle: 'experimental', surfaces: ['claude-module'] },
    {
      id: 'z',
      path: 'modules/z',
      lifecycle: 'deprecated',
      surfaces: ['claude-module'],
      deprecation: { since: '2026-01-01', compatibilityWindowEnds: '2026-04-01', migrationNote: 'retired' },
    }
  );
  const counts = computeScopedCounts(inv);
  assert.strictEqual(counts.optionalModules, 1);
  assert.strictEqual(counts.experimentalModules, 1);
  assert.strictEqual(counts.deprecatedModules, 1);
});

test('against the real checked-in inventory, canonical count is 102 and every scoped count is independently derived', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const counts = computeScopedCounts(inventory);
  assert.strictEqual(counts.canonical, 102);
  assert.strictEqual(counts.promotedCore + counts.optional + counts.experimental + counts.deprecated, 102);
  assert.strictEqual(counts.codexPublished, 15);
});

test('neither bilingual README claims the canonical skill total as a default-install count (task 4.2 regression guard)', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const counts = computeScopedCounts(inventory);
  for (const rel of ['README.md', 'README.zh-TW.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A leak looks like "<canonical total> skill(s)" / "<canonical total> 個 skill" —
    // i.e. the raw canonical count phrased as though it were the (narrower)
    // default-install surface. Scoped counts (promotedCore/claudePublished/
    // codexPublished) are unaffected since this only flags the canonical figure.
    const leakPattern = new RegExp(`${counts.canonical}\\s*(?:skills?|個\\s*skill)`, 'i');
    assert.ok(!leakPattern.test(text), `${rel} appears to claim the canonical skill total (${counts.canonical}) as a default-install count`);
  }
});

run('distribution-scoped-counts');
