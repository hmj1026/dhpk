'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const { collectInventory, listAgentFiles, relativePosix } =
  require(path.join(ROOT, 'scripts', 'lib', 'asset-inventory'));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-asset-inventory-'));
  const dirs = [
    'agents', 'modules/demo/agents', 'skills/base', 'modules/demo/skills/extra',
    'commands', 'skills/codex-sample', 'hooks', 'manifests', 'scripts/hooks/_lib', 'scripts/ci', 'scripts/lib',
  ];
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'root.md'), '# root');
  fs.writeFileSync(path.join(root, 'agents', 'INDEX.md'), '# index');
  fs.writeFileSync(path.join(root, 'modules/demo/agents', 'module.md'), '# module');
  fs.writeFileSync(path.join(root, 'modules/demo/skills/extra', 'SKILL.md'), '# extra');
  fs.writeFileSync(path.join(root, 'skills/base', 'SKILL.md'), '# base');
  fs.writeFileSync(path.join(root, 'commands', 'do.md'), '# do');
  fs.writeFileSync(path.join(root, 'commands', 'INDEX.md'), '# index');
  fs.writeFileSync(path.join(root, 'skills/codex-sample', 'SKILL.md'), 'mcp__codex__review');
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
    skillsTotal: 3,
    skillsBase: 2,
    skillsModule: 1,
    commands: 2,
    modules: 2,
    slotCount: 2,
    mcpCodexSkills: 1,
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

run('asset-inventory');
