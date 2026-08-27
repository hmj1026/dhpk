'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('an unprofiled generation preserves legacy package membership while adding only declared runtime support', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-unprofiled-platform-'));
  try {
    for (const surface of ['agent-plugin', 'agy-plugin']) {
      const output = path.join(root, surface);
      const result = spawnSync(path.join(ROOT, 'bin', 'dhpk'), [
        'distribution', surface, 'generate', '--output', output, '--version', '0.48.3', '--json',
      ], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(result.stdout);
      assert.strictEqual(report.skillCount, 61, `${surface} must retain the 60 existing skills plus cli-transport`);
      const provenance = JSON.parse(fs.readFileSync(path.join(output, 'provenance.json'), 'utf8'));
      assert.strictEqual(provenance.profileId, undefined, `${surface} must not narrow without an explicit --profile`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('platform package verifier reports deterministic Agent Plugin and Cursor outputs', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ci', 'verify-platform-packages.js')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.verdict, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['cursor-plugin'].structural, 'PASS');
  assert.strictEqual(report.surfaces['agent-plugin'].selectedSkills, 61);
  assert.strictEqual(report.surfaces['cursor-plugin'].selectedSkills, 3);
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSurface, 'agent-plugin');
  assert.strictEqual(report.surfaces['cursor-plugin'].sharedSkillSource, 'plugins/dhpk-agent/skills/');
  const cursorLocal = report.surfaces['cursor-plugin'].selectedSkillIds;
  const cursorShared = report.surfaces['cursor-plugin'].sharedSkillIds;
  assert.deepStrictEqual(cursorLocal, ['agy-fast-worker', 'cli-transport', 'codex-bridge']);
  assert.deepStrictEqual(cursorLocal.filter((id) => cursorShared.includes(id)), []);
});

run('verify-platform-packages');
