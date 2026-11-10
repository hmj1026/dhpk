'use strict';

// A small plugin checkout with a relocatable Shared Project Projection: two
// shared skills (one Cursor, one Codex), native Codex and Cursor assets, and
// the inventory and projection sets the installer and the publisher read.
// Shared by the process-boundary suite and the in-process journal suites.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function skillBody(name, heading) {
  return `---\nname: ${name}\ndescription: ${heading}\n---\n# ${heading}\n`;
}

function fakePlugin() {
  const plugin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-ics-shared-plugin-')));
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'dhpk', version: '9.9.9' }));
  write(
    path.join(plugin, 'scripts', 'lib', 'portable-skill-metadata.js'),
    fs.readFileSync(path.join(REPO, 'scripts', 'lib', 'portable-skill-metadata.js'), 'utf8'),
  );
  write(path.join(plugin, 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
  write(path.join(plugin, 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only'));
  write(path.join(plugin, 'cursor', 'skills', 'dhpk-portable', 'SKILL.md'), skillBody('dhpk-portable', 'Portable'));
  write(path.join(plugin, 'cursor', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: review\nmodel: inherit\nreadonly: true\n---\n# Reviewer\n');
  write(path.join(plugin, 'cursor', 'rules', 'prefer-const.mdc'), '---\nname: prefer-const\ndescription: prefer const\nalwaysApply: false\n---\n# Prefer const\n');
  write(path.join(plugin, 'cursor', 'commands', 'review.md'), '---\nname: review\ndescription: review command\n---\n# Review\n');
  write(path.join(plugin, 'codex', 'skills', 'dhpk-codex-only', 'SKILL.md'), skillBody('dhpk-codex-only', 'Codex only'));
  write(path.join(plugin, 'codex', 'agents', 'explorer.toml'), 'name = "explorer"\ndescription = "explore"\n');
  write(path.join(plugin, 'codex', 'rules', 'prefer-const.md'), '# Prefer const\n');
  write(path.join(plugin, 'agent-traps', '_common', 'prompt-defense.md'), '# defense\n');
  write(path.join(plugin, 'cursor', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'codex', 'config.toml.example'), 'model = "fixture"\n');
  write(path.join(plugin, 'manifests', 'distribution-inventory.json'), `${JSON.stringify({
    skills: [
      {
        id: 'portable',
        name: 'dhpk-portable',
        path: 'skills/dhpk-portable',
        lifecycle: 'promoted',
        surfaces: ['cursor-sync', 'cursor-plugin'],
        legacy_names: [],
      },
      {
        id: 'codex-only',
        name: 'dhpk-codex-only',
        path: 'skills/dhpk-codex-only',
        lifecycle: 'promoted',
        surfaces: ['codex-sync', 'codex-native'],
        legacy_names: [],
      },
    ],
    supporting_assets: [
      {
        id: 'cursor-trap',
        source: 'agent-traps/_common/prompt-defense.md',
        destination: 'dhpk/agent-traps/_common/prompt-defense.md',
      },
      {
        id: 'codex-config',
        source: 'codex/config.toml.example',
        destination: 'config.toml.example',
      },
    ],
    project_agent_projection: {
      schema: 'dhpk.project-agent-projection.v1',
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
      profiles: {
        'portable-core': {
          version: 'portable-core-v1',
          compatibility_mode: 'portable-core',
          stable_ids: ['codex-only', 'portable'],
          hosts: ['agy', 'claude', 'codex', 'cursor'],
        },
      },
      hosts: {
        claude: {
          surface: 'claude-core',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'claude-project-skill', version: '1' },
        },
        codex: {
          surface: 'codex-sync',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'codex-project-skill', version: '1' },
        },
        cursor: {
          surface: 'cursor-plugin',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-directory',
          transform: { id: 'cursor-project-skill', version: '1' },
        },
        agy: {
          surface: 'agy-plugin',
          evidence_source: 'entry_surfaces',
          shape: 'project-skill-direct-file',
          transform: { id: 'agy-project-direct-file', version: '1' },
        },
      },
      dependencies: {},
    },
  }, null, 2)}\n`);
  write(path.join(plugin, 'manifests', 'profile-projection-sets.json'), `${JSON.stringify({
    schema: 'dhpk.profile-projection-sets.v1',
    hostSurfaces: { cursor: 'cursor-sync', 'codex-sync': 'codex-sync' },
    profiles: {
      common: { cursor: ['portable'], 'codex-sync': ['codex-only'] },
    },
  }, null, 2)}\n`);
  return plugin;
}

module.exports = { write, skillBody, fakePlugin, REPO };
