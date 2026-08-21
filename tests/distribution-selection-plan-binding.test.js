'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { compileDistribution } = require('../scripts/lib/distribution-compiler');
const { compileAgentPluginPackage } = require('../scripts/lib/agent-plugin-package');
const { compileCursorPackage } = require('../scripts/lib/cursor-plugin-package');
const { compileNativePackage } = require('../scripts/lib/codex-native-package');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('all migrated adapters retain compiler canonical selection identity in output plans', () => {
  const surfaces = [
    ['agent-plugin', (outDir) => compileAgentPluginPackage({ inventory: INVENTORY, root: ROOT, outDir })],
    ['cursor-plugin', (outDir) => compileCursorPackage({ inventory: INVENTORY, root: ROOT, outDir })],
    ['codex-native', (outDir) => compileNativePackage({ inventory: INVENTORY, root: ROOT, outDir })],
  ];
  for (const [surface, compile] of surfaces) {
    const outDir = tempDir(`dhpk-selection-plan-${surface}-`);
    try {
      const expected = compileDistribution({ inventory: INVENTORY, surface });
      assert.strictEqual(expected.ok, true, expected.error && expected.error.message);
      const projection = compile(outDir);
      assert.deepStrictEqual(projection.plan.selectedStableIds, expected.value.selectedStableIds, `${surface} selected IDs drifted`);
      assert.deepStrictEqual(projection.plan.selectionPolicy, expected.value.selectionPolicy, `${surface} selection policy drifted`);
      assert.deepStrictEqual(
        projection.plan.selectionEntries.map((entry) => entry.stableId),
        expected.value.entries.map((entry) => entry.stableId),
        `${surface} canonical selection entries drifted`,
      );
      assert.ok(projection.plan.entries.some((entry) => !expected.value.selectedStableIds.includes(entry.stableId)), `${surface} plan has no distinct output intent`);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
});

run('distribution-selection-plan-binding');
