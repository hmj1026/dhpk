'use strict';

// These tests exercise the retained native installer lifecycle. Production
// Codex uses the shared common Skill owner and has no standalone runtime IDs.
// Keep native receipt/adoption scenarios on an explicitly synthetic package.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = require('./install-codex-skills-fixtures');

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-lifecycle-')));
fs.cpSync(path.join(base.ROOT, 'codex'), path.join(ROOT, 'codex'), { recursive: true, dereference: true });
fs.cpSync(path.join(base.ROOT, 'cursor'), path.join(ROOT, 'cursor'), { recursive: true, dereference: true });
fs.cpSync(path.join(base.ROOT, 'skills'), path.join(ROOT, 'skills'), { recursive: true, dereference: true });
fs.cpSync(path.join(base.ROOT, 'plugins/dhpk'), path.join(ROOT, 'plugins/dhpk'), { recursive: true, dereference: true });
fs.mkdirSync(path.join(ROOT, '.claude-plugin'));
fs.copyFileSync(path.join(base.ROOT, '.claude-plugin/plugin.json'), path.join(ROOT, '.claude-plugin/plugin.json'));
base.copyDistributionInventory(ROOT);

const runtimeNames = ['fixture-native-runtime-a', 'fixture-native-runtime-b'];
const inventoryPath = path.join(ROOT, 'manifests/distribution-inventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
for (const name of runtimeNames) {
  for (const directory of ['skills', 'codex/skills']) {
    const target = path.join(ROOT, directory, name);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: Test-owned native lifecycle support.\n---\n\nFixture runtime.\n`);
  }
}
fs.writeFileSync(inventoryPath, JSON.stringify({
  ...inventory,
  skills: [...inventory.skills, ...runtimeNames.map((name) => ({
    id: name, name, path: `skills/${name}`, lifecycle: 'optional',
    invokable: false, profiles: [], surfaces: ['codex-native'],
  }))],
  internal_runtime_skills: { ...inventory.internal_runtime_skills, 'codex-native': runtimeNames },
}, null, 2));
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

function runInstaller(project, args, pluginRoot = ROOT, envOverrides = {}) {
  return base.runInstaller(project, args, pluginRoot, envOverrides);
}

module.exports = {
  ...base,
  ROOT,
  runInstaller,
  runtimeSupportSkillNames: () => [...runtimeNames],
  firstRuntimeSupportSkillName: () => runtimeNames[0],
  provenanceDriftPlanFixture: (drift) => base.provenanceDriftPlanFixture(drift, ROOT),
};
