'use strict';

// Thin platform conformance only: each row checks the platform's projected
// manifest shape and the one consumer invocation owned by that adapter. The
// shared fallback behavior and runtime proof belong to separate suites; this
// table intentionally has no host/worker/model matrix.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = (relative) => JSON.parse(read(relative));

const PLATFORM_CONFORMANCE = [
  {
    platform: 'claude',
    manifest: '.claude-plugin/plugin.json',
    invocationSource: 'scripts/release/consumer-gate.js',
    invocation: /claude plugin validate <manifest> --strict|claude plugin install dhpk@dhpk --scope project/,
    assertFormat(value) {
      assert.ok(Array.isArray(value.skills), 'Claude manifest must expose skills');
      assert.ok(Array.isArray(value.agents), 'Claude manifest must expose agents');
      assert.ok(value.agents.every((entry) => entry.endsWith('.md')), 'Claude agents must remain markdown');
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

test('four platforms have thin table-driven format and invocation conformance', () => {
  assert.deepStrictEqual(PLATFORM_CONFORMANCE.map((entry) => entry.platform), ['claude', 'codex', 'agy', 'cursor']);
  for (const entry of PLATFORM_CONFORMANCE) {
    const value = manifest(entry.manifest);
    entry.assertFormat(value);
    assert.match(read(entry.invocationSource), entry.invocation, `${entry.platform} invocation contract`);
  }
});

run('platform-conformance');
