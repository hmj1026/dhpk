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
      invocationSource: 'scripts/release/consumer-gate.js',
      invocation: /claude plugin validate <manifest> --strict|claude plugin install dhpk@dhpk --scope project/,
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
      invocationSource: 'scripts/release/consumer-platform-probe.js',
      invocation: /codex plugin marketplace add <package-root>/,
      assertFormat(value) {
        assert.strictEqual(value.name, 'dhpk');
        assert.strictEqual(value.skills, './skills/');
        assert.ok(!Object.prototype.hasOwnProperty.call(value, 'agents'), 'Codex manifest keeps agents in generated projection files');
      },
    },
    {
      platform: 'agy',
      manifest: 'plugins/dhpk-agy/plugin.json',
      invocationSource: 'scripts/lib/harness.js',
      invocation: /validate --targets agy --agy-runtime-probe --format json/,
      assertFormat(value) {
        assert.deepStrictEqual(value.agents, ['./agents/']);
        assert.deepStrictEqual(value.rules, ['./rules/']);
        assert.deepStrictEqual(value.skills, ['./skills/']);
      },
    },
    {
      platform: 'cursor',
      manifest: 'plugins/dhpk-cursor/.cursor-plugin/plugin.json',
      invocationSource: 'scripts/release/consumer-platform-probe.js',
      invocation: /cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>/,
      assertFormat(value) {
        for (const field of ['skills', 'rules', 'agents', 'commands', 'hooks']) {
          assert.ok(typeof value[field] === 'string', `Cursor manifest must expose ${field}`);
        }
      },
    },
  ];
}

module.exports = { createHostProjectionConformance };
