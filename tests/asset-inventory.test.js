'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const { collectInventory, listAgentFiles, relativePosix, walkFiles } =
  require(path.join(ROOT, 'scripts', 'lib', 'asset-inventory'));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-asset-inventory-'));
  const dirs = [
    'agents', 'modules/demo/agents', 'skills/base', 'modules/demo/skills/extra',
    'commands', 'skills/dhpk-codex-sample', 'skills/dhpk-change-review', 'hooks', 'manifests', 'scripts/hooks/_lib', 'scripts/ci', 'scripts/lib',
  ];
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'root.md'), '# root');
  fs.writeFileSync(path.join(root, 'agents', 'INDEX.md'), '# index');
  fs.writeFileSync(path.join(root, 'modules/demo/agents', 'module.md'), '# module');
  fs.writeFileSync(path.join(root, 'modules/demo/skills/extra', 'SKILL.md'), '# extra');
  fs.writeFileSync(path.join(root, 'skills/base', 'SKILL.md'), '# base');
  fs.writeFileSync(path.join(root, 'commands', 'do.md'), '# do');
  fs.writeFileSync(path.join(root, 'commands', 'INDEX.md'), '# index');
  fs.writeFileSync(path.join(root, 'skills/dhpk-codex-sample', 'SKILL.md'), 'mcp__codex__review');
  fs.writeFileSync(path.join(root, 'skills/dhpk-change-review', 'SKILL.md'), 'mcp__codex__review');
  fs.writeFileSync(path.join(root, 'commands/codex-review.md'), '# codex');
  fs.mkdirSync(path.join(root, 'modules/second'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { A: [], B: [] } }));
  fs.writeFileSync(path.join(root, 'manifests/module-catalog.json'), JSON.stringify({ version: 7, stacks: [] }));
  fs.writeFileSync(path.join(root, 'scripts/lib/sentinel-slots.json'), JSON.stringify({ schema: 'dhpk.sentinel-slots.v1', slots: [{ id: 'code' }, { id: 'doc' }] }));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version: '1.2.3', agents: ['agents/root.md'] }));
  return root;
}

test('inventory counts source trees and consumes the four SSOT manifests', () => {
  const root = fixture();
  const inventory = collectInventory(root);
  assert.deepStrictEqual(inventory.counts, {
    agentsTotal: 2,
    agentsRoot: 1,
    agentsModule: 1,
    skillsTotal: 4,
    skillsBase: 3,
    skillsModule: 1,
    commands: 2,
    modules: 2,
    slotCount: 2,
    mcpCodexSkills: 2,
    codexCommands: 1,
    hookEvents: 2,
  });
  assert.strictEqual(inventory.sources.claudePlugin.version, '1.2.3');
  assert.strictEqual(inventory.sources.moduleCatalog.version, 7);
  assert.strictEqual(inventory.sources.sentinelRegistry.schema, 'dhpk.sentinel-slots.v1');
  assert.deepStrictEqual(inventory.sources.hooks.events, ['A', 'B']);
});

test('agent path inventory matches validator registration semantics', () => {
  const root = fixture();
  const files = listAgentFiles(root).map((fp) => relativePosix(root, fp));
  assert.deepStrictEqual(files, ['agents/root.md', 'modules/demo/agents/module.md']);
});

test('missing or malformed optional manifests degrade to empty facts', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'hooks/hooks.json'), '{broken');
  fs.rmSync(path.join(root, 'scripts/lib/sentinel-slots.json'));
  const inventory = collectInventory(root);
  assert.deepStrictEqual(inventory.sources.hooks.events, []);
  assert.deepStrictEqual(inventory.sources.sentinelRegistry, null);
  assert.strictEqual(inventory.counts.slotCount, 0);
});

test('inventory traversal rejects a caller-supplied file-count budget before growing output', () => {
  const root = fixture();
  try {
    assert.throws(
      () => walkFiles(path.join(root, 'agents'), () => true, new Set(), 0, { files: 0, maxFiles: 1 }),
      /maximum inventory file count/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inventory traversal rejects a caller-supplied entry-count budget', () => {
  const root = fixture();
  try {
    assert.throws(
      () => walkFiles(path.join(root, 'agents'), () => false, new Set(), 0, {
        files: 0,
        maxFiles: 20000,
        entries: 0,
        maxEntries: 1,
      }),
      /maximum inventory entry count/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inventory traversal fails closed when the depth limit is exceeded', () => {
  const root = fixture();
  try {
    let current = path.join(root, 'agents');
    for (let depth = 0; depth < 66; depth += 1) {
      current = path.join(current, `level-${depth}`);
      fs.mkdirSync(current);
    }
    fs.writeFileSync(path.join(current, 'deep.md'), '# deep');
    assert.throws(
      () => walkFiles(path.join(root, 'agents'), () => true),
      /maximum inventory directory depth/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('asset-inventory');
