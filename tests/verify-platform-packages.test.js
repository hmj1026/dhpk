'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('platform package verifier reports deterministic Agent Plugin and Cursor outputs', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.verdict, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['cursor-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].selectedSkills, 12);
  assert.strictEqual(report.surfaces['cursor-plugin'].selectedSkills, 3);
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSurface, 'agent-plugin');
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSource, 'plugins/dhpk-agent/skills/');
  const cursorLocal = report.surfaces['cursor-plugin'].selectedSkillIds;
  const cursorShared = report.surfaces['cursor-plugin'].sharedSkillIds;
  assert.deepStrictEqual(cursorLocal, ['agy-fast-worker', 'cli-transport', 'codex-bridge']);
  assert.deepStrictEqual(cursorLocal.filter((id) => cursorShared.includes(id)), []);
});

run('verify-platform-packages');
