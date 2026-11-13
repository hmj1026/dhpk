'use strict';

// The Codex installer reads the distribution inventory once per run (plan or
// apply) through a context passed down as a parameter. There is no module-level
// cache: a fixture that rewrites the inventory between two runs in the SAME
// process must see the new value in the second run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { installerEnv, runCaptured } = require('../scripts/lib/install-adapters/codex-cli');

const ROOT = path.resolve(__dirname, '..');
const OFFLINE_ENV = { ...process.env, PATH: '/usr/bin:/bin' };

function inventoryDocument(assetDestination) {
  return {
    schema: 'dhpk.distribution-inventory.v2',
    profile_policy: {
      version: 'dhpk.capability-bundle-selection.v1',
      required_core_ids: ['alpha-skill'],
      profiles: { common: { selection: 'declared-common', compatibilityMode: 'profile' } },
    },
    skills: [{
      id: 'alpha-skill',
      name: 'alpha-skill',
      path: 'skills/alpha-skill',
      lifecycle: 'promoted',
      invokable: true,
      profiles: [],
      surfaces: ['codex-native', 'codex-sync'],
    }],
    internal_runtime_skills: { 'codex-native': [] },
    agent_roster: [],
    supporting_assets: [{ id: 'note', source: 'codex/supporting/note.md', destination: assetDestination }],
    retired_skills: [],
  };
}

function createPlugin(root) {
  const plugin = path.join(root, 'plugin');
  fs.mkdirSync(path.join(plugin, 'codex', 'skills', 'alpha-skill'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'codex', 'skills', 'alpha-skill', 'SKILL.md'), '---\nname: alpha-skill\ndescription: Alpha fixture.\n---\n# Alpha\n');
  fs.mkdirSync(path.join(plugin, 'codex', 'supporting'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'codex', 'supporting', 'note.md'), 'support note\n');
  fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"dhpk","version":"0.0.0-fixture"}\n');
  fs.mkdirSync(path.join(plugin, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'), path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'));
  fs.writeFileSync(path.join(plugin, 'manifests', 'install-profiles.json'), `${JSON.stringify({
    version: 1,
    profiles: { common: { modules: [], skillIds: ['alpha-skill'], commandIds: [], compatibilityMode: 'profile' } },
  })}\n`);
  return plugin;
}

function writeInventory(plugin, text) {
  fs.writeFileSync(path.join(plugin, 'manifests', 'distribution-inventory.json'), text);
}

function plan(plugin, project) {
  return runCaptured(installerEnv({
    host: 'codex',
    pluginRoot: plugin,
    projectRoot: project,
    mode: 'copy',
    modeExplicit: true,
    update: true,
    plan: true,
    json: true,
    baseEnv: OFFLINE_ENV,
  }));
}

test('a second plan in the same process reads the rewritten inventory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-inventory-context-'));
  try {
    const plugin = createPlugin(root);
    const project = path.join(root, 'project');
    fs.mkdirSync(project, { recursive: true });

    writeInventory(plugin, `${JSON.stringify(inventoryDocument('dhpk/first.md'))}\n`);
    const first = plan(plugin, project);
    assert.strictEqual(first.code, 1, first.stderr);
    const firstMissing = JSON.parse(first.stdout).missing.map((item) => item.path);
    assert.ok(firstMissing.includes('dhpk/first.md'), JSON.stringify(firstMissing));
    assert.ok(!firstMissing.includes('dhpk/second.md'), JSON.stringify(firstMissing));

    writeInventory(plugin, `${JSON.stringify(inventoryDocument('dhpk/second.md'))}\n`);
    const second = plan(plugin, project);
    assert.strictEqual(second.code, 1, second.stderr);
    const secondMissing = JSON.parse(second.stdout).missing.map((item) => item.path);
    assert.ok(secondMissing.includes('dhpk/second.md'), JSON.stringify(secondMissing));
    assert.ok(!secondMissing.includes('dhpk/first.md'), JSON.stringify(secondMissing));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a plan after the inventory becomes unreadable reports the new parse failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-inventory-context-'));
  try {
    const plugin = createPlugin(root);
    const project = path.join(root, 'project');
    fs.mkdirSync(project, { recursive: true });

    writeInventory(plugin, `${JSON.stringify(inventoryDocument('dhpk/first.md'))}\n`);
    assert.strictEqual(plan(plugin, project).code, 1);

    writeInventory(plugin, '{ not json');
    const broken = plan(plugin, project);
    assert.strictEqual(broken.code, 2, broken.stdout);
    assert.ok(/cannot read distribution inventory/.test(broken.stderr), broken.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the Codex CLI Host list is the installer Host table', () => {
  const codex = require('../scripts/lib/install-adapters/codex');
  const cli = require('../scripts/lib/install-adapters/codex-cli');
  assert.strictEqual(cli.HOSTS, codex.HOSTS);
  assert.deepStrictEqual(Object.keys(cli.HOSTS), ['codex', 'cursor']);
  assert.strictEqual(cli.HOSTS.cursor.installerName, 'install-cursor-harness');
  assert.strictEqual(cli.HOSTS.codex.surfaceLabel, 'Codex');
});

run('install-codex-inventory-context');
