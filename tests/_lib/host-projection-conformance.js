'use strict';

// Host × capability rows for shared projection invariants. Each row carries
// Host-specific expected values and per-row assertFormat. Helpers live under
// tests/_lib/ so they do not create a scripts/ coverage obligation.

const fs = require('node:fs');
const path = require('node:path');

function createHostProjectionConformance({ root, assert }) {
  const resolve = (relative) => path.join(root, relative.replace(/^\.\//, ''));
  return [
    {
      platform: 'claude',
      manifest: '.claude-plugin/plugin.json',
      assertFormat(value) {
        assert.match(value.version, /^\d+\.\d+\.\d+/, `version='${value.version}'`);
        assert.ok(Array.isArray(value.skills), 'Claude manifest must expose skills');
        assert.ok(Array.isArray(value.agents), 'Claude manifest must expose agents');
        assert.ok(value.agents.every((entry) => entry.endsWith('.md')), 'Claude agents must remain markdown');
        for (const agent of value.agents || []) {
          assert.ok(fs.existsSync(resolve(agent)), `missing agent file: ${agent}`);
        }
        for (const skill of value.skills || []) {
          const skillPath = resolve(skill);
          assert.ok(fs.existsSync(skillPath) && fs.statSync(skillPath).isDirectory(), `missing skills dir: ${skill}`);
        }
        for (const command of value.commands || []) {
          assert.ok(fs.existsSync(resolve(command)), `missing commands path: ${command}`);
        }
      },
    },
    {
      platform: 'codex',
      manifest: 'plugins/dhpk/.codex-plugin/plugin.json',
      assertFormat(value) {
        assert.strictEqual(value.name, 'dhpk');
        assert.strictEqual(value.skills, './skills/');
        assert.ok(!Object.prototype.hasOwnProperty.call(value, 'agents'), 'Codex manifest keeps agents in generated projection files');
      },
    },
    {
      platform: 'agy',
      manifest: 'plugins/dhpk-agy/plugin.json',
      assertFormat(value) {
        assert.deepStrictEqual(value.agents, ['./agents/']);
        assert.deepStrictEqual(value.rules, ['./rules/']);
        assert.deepStrictEqual(value.skills, ['./skills/']);
      },
    },
    {
      platform: 'cursor',
      manifest: 'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
      assertFormat(value) {
        for (const field of ['rules', 'agents', 'commands', 'hooks']) {
          assert.ok(typeof value[field] === 'string', `Cursor manifest must expose ${field}`);
        }
        const cursorRoot = resolve('plugins/dhpk-cursor');
        const provenance = JSON.parse(fs.readFileSync(path.join(cursorRoot, 'provenance.json'), 'utf8'));
        if (value.skills !== undefined) {
          assert.strictEqual(typeof value.skills, 'string', 'Cursor skills must be a path');
          assert.ok(fs.statSync(path.join(cursorRoot, value.skills)).isDirectory(), 'missing Cursor skills directory');
        } else {
          assert.strictEqual(provenance.skillProjectionMode, 'shared');
          assert.deepStrictEqual(provenance.selectedSkillIds, [], 'an overlay requires a Cursor skills field');
        }
        if (provenance.sharedSkillSurface) {
          assert.strictEqual(provenance.sharedSkillSurface, 'agent-plugin');
          assert.strictEqual(provenance.sharedSkillSource, 'plugins/dhpk-agent/skills/');
          const owner = JSON.parse(fs.readFileSync(resolve('plugins/dhpk-agent/provenance.json'), 'utf8'));
          assert.deepStrictEqual(provenance.sharedSkillIds, owner.marketplacePublication.publicEntryIds);
          assert.deepStrictEqual(provenance.sharedSkillNames, owner.selectedSkillNames);
          assert.ok(provenance.sharedSkillIds.includes('flow-drive'));
          assert.strictEqual(provenance.sharedSkillNames.length, provenance.sharedSkillIds.length);
          for (const name of provenance.sharedSkillNames) {
            assert.ok(fs.statSync(resolve(`${provenance.sharedSkillSource}${name}/SKILL.md`)).isFile(), `missing shared Skill ${name}`);
          }
        } else {
          assert.strictEqual(typeof value.skills, 'string', 'standalone Cursor requires skills');
        }
      },
    },
  ];
}

module.exports = { createHostProjectionConformance };
