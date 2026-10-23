'use strict';

// Receipt, adoption, legacy, and recovery cases install this synthetic package
// through the real installer. It does not copy the repository skill trees.
// The representative real-package install remains install-codex-skills.test.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = require('./install-codex-skills-fixtures');

const PUBLIC_SKILLS = [
  { id: 'change-verdict', name: 'change-verdict' },
  { id: 'tdd', name: 'tdd-workflow' },
  { id: 'code-trace', name: 'code-trace' },
  { id: 'flow-guide', name: 'flow-guide' },
];
const OVERLAY_SKILLS = [
  { id: 'code-simplify', name: 'code-simplify' },
  { id: 'js-static-checks', name: 'js-static-checks' },
  { id: 'legacy-code-characterization', name: 'dhpk-legacy-characterization-tests' },
];
const RUNTIME_SKILLS = [
  { id: 'fixture-native-runtime-a', name: 'fixture-native-runtime-a' },
  { id: 'fixture-native-runtime-b', name: 'fixture-native-runtime-b' },
];
const PUBLIC_SURFACES = ['codex-native', 'codex-sync', 'cursor-sync'];

function skillRecord(skill, invokable, surfaces) {
  return {
    id: skill.id,
    name: skill.name,
    path: `skills/${skill.name}`,
    lifecycle: invokable ? 'promoted' : 'optional',
    invokable,
    profiles: [],
    surfaces,
  };
}

function writeSkill(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Synthetic lifecycle fixture.\n---\n\nFixture skill.\n`,
  );
}

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-native-lifecycle-')));
for (const skill of [...PUBLIC_SKILLS, ...OVERLAY_SKILLS, ...RUNTIME_SKILLS]) {
  writeSkill(path.join(ROOT, 'codex', 'skills'), skill.name);
  writeSkill(path.join(ROOT, 'cursor', 'skills'), skill.name);
  writeSkill(path.join(ROOT, 'skills'), skill.name);
}
const agent = 'name = "fixture-agent"\ndescription = "Synthetic lifecycle agent."\n';
fs.mkdirSync(path.join(ROOT, 'codex', 'agents'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'cursor', 'agents'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'codex', 'agents', 'fixture-agent.toml'), agent);
fs.writeFileSync(path.join(ROOT, 'cursor', 'agents', 'fixture-agent.toml'), agent);
fs.mkdirSync(path.join(ROOT, 'codex', 'supporting'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'codex', 'supporting', 'prompt-defense.md'), 'synthetic prompt defense\n');
fs.mkdirSync(path.join(ROOT, '.claude-plugin'), { recursive: true });
fs.copyFileSync(path.join(base.ROOT, '.claude-plugin', 'plugin.json'), path.join(ROOT, '.claude-plugin', 'plugin.json'));
fs.mkdirSync(path.join(ROOT, 'manifests'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'scripts', 'lib'), { recursive: true });
fs.copyFileSync(
  path.join(base.ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
  path.join(ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
);
fs.writeFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
  schema: 'dhpk.distribution-inventory.v2',
  profile_policy: {
    version: 'dhpk.capability-bundle-selection.v1',
    required_core_ids: PUBLIC_SKILLS.map((skill) => skill.id),
    profiles: { common: { selection: 'declared-common', compatibilityMode: 'profile' } },
  },
  skills: [
    ...PUBLIC_SKILLS.map((skill) => skillRecord(skill, true, PUBLIC_SURFACES)),
    ...OVERLAY_SKILLS.map((skill) => skillRecord(skill, true, PUBLIC_SURFACES)),
    ...RUNTIME_SKILLS.map((skill) => skillRecord(skill, false, ['codex-native'])),
  ],
  internal_runtime_skills: { 'codex-native': RUNTIME_SKILLS.map((skill) => skill.id) },
  agent_roster: ['fixture-agent'],
  supporting_assets: [{
    id: 'prompt-defense',
    source: 'codex/supporting/prompt-defense.md',
    destination: 'dhpk/agent-traps/_common/prompt-defense.md',
  }],
  retired_skills: [],
}, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'manifests', 'install-profiles.json'), `${JSON.stringify({
  version: 1,
  profiles: {
    common: {
      modules: [],
      skillIds: PUBLIC_SKILLS.map((skill) => skill.id),
      commandIds: [],
      compatibilityMode: 'profile',
    },
  },
  legacy_profiles: {
    minimal: {
      modules: [],
      skillIds: ['code-trace', 'flow-guide'],
      commandIds: [],
      compatibilityMode: 'profile',
    },
    full: {
      modules: [],
      skillIds: ['flow-guide', 'code-trace', 'harness-govern'],
      commandIds: [],
      compatibilityMode: 'profile',
    },
    'compat-v1': {
      modules: [],
      skillIds: ['cli-dispatch-context', 'cli-transport', 'harness-govern'],
      commandIds: [],
      compatibilityMode: 'compat-v1',
    },
  },
}, null, 2)}\n`);
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

function copyDistributionInventory(plugin) {
  fs.cpSync(path.join(ROOT, 'manifests'), path.join(plugin, 'manifests'), { recursive: true, dereference: true });
  fs.mkdirSync(path.join(plugin, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(base.ROOT, 'scripts', 'lib', 'portable-skill-metadata.js'),
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
  );
}

function runInstaller(project, args, pluginRoot = ROOT, envOverrides = {}) {
  return base.runInstaller(project, args, pluginRoot, envOverrides);
}

function rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, targetOverride = null) {
  return base.rewriteAgentAsHistoricalManagedSymlink(scratch, agentName, targetOverride, ROOT);
}

module.exports = {
  ...base,
  ROOT,
  runInstaller,
  copyDistributionInventory,
  rewriteAgentAsHistoricalManagedSymlink,
  runtimeSupportSkillNames: () => RUNTIME_SKILLS.map((skill) => skill.name),
  firstRuntimeSupportSkillName: () => RUNTIME_SKILLS[0].name,
  provenanceDriftPlanFixture: (drift) => base.provenanceDriftPlanFixture(drift, ROOT),
};
