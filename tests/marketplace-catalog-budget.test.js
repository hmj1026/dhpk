'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { compileMarketplacePublicationView } = require('../scripts/lib/marketplace-selection');
const root = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const inventory = read('manifests/distribution-inventory.json');
const selection = read('manifests/marketplace-selection.json');
const budgets = read('manifests/discovery-budgets.json');

for (const surface of ['openai-submission', 'agent-plugin', 'codex-native', 'cursor-plugin', 'agy-plugin', 'claude-core']) {
  test(`${surface} static catalog fits its declared common and Host-only entry ceilings`, () => {
    const limits = budgets.marketplaceCatalog;
    assert.ok(limits, 'marketplace catalog budgets are required');
    assert.strictEqual(limits.scope, 'static-selection');
    const view = compileMarketplacePublicationView({
      inventory, selection, ...(surface === 'openai-submission' ? {} : { hostSurface: surface }),
    });
    assert.deepStrictEqual(view.errors, []);
    assert.strictEqual(view.publicEntries.length, 15);
    assert.ok(view.publicEntries.length <= limits.maxCommonEntries);
    const children = Object.values(view.bundledChildren).flat();
    assert.strictEqual(children.length, 45);
    assert.ok(children.length <= limits.maxBundledChildren);
    assert.ok(view.hostOnly.length <= limits.maxHostOnlyRows[surface], `${surface}: ${view.hostOnly.length}`);
    assert.strictEqual(new Set([...view.publicEntries, ...children, ...view.hostOnly].map((row) => row.id)).size,
      view.publicEntries.length + children.length + view.hostOnly.length);
  });
}

run('marketplace-catalog-budget');
