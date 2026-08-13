'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/distribution-projection-characterization.json'), 'utf8'));

function runNode(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('Agent Plugin public validator baseline remains structurally and provenance green', () => {
  const result = runNode('scripts/ci/validate-agent-plugin-package.js', ['plugins/dhpk-agent']);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(result.status, fixture.agentPlugin.validatorStatus);
  assert.strictEqual(output.structural, fixture.agentPlugin.structural);
  assert.strictEqual(output.provenance, fixture.agentPlugin.provenance);
  assert.strictEqual(output.skills.valid.length, fixture.agentPlugin.validSkillCount);
});

test('Cursor public validator baseline preserves structural PASS and unavailable consumer state', () => {
  const result = runNode('scripts/ci/validate-cursor-plugin-package.js', ['plugins/dhpk-cursor']);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(result.status, fixture.cursorPlugin.validatorStatus);
  assert.strictEqual(output.structural, fixture.cursorPlugin.structural);
  assert.strictEqual(output.consumer.status, fixture.cursorPlugin.consumerStatus);
  assert.strictEqual(output.provenance, fixture.cursorPlugin.provenance);
});

test('Claude/inventory public validator baseline preserves output and exit status', () => {
  const result = runNode('scripts/ci/validate-distribution.js', ['--strict']);
  assert.strictEqual(result.status, fixture.distribution.validatorStatus, result.stderr);
  assert.strictEqual(result.stdout.trim(), fixture.distribution.stdout);
});

test('Codex sync characterization explicitly records the legacy absolute-link boundary', () => {
  assert.strictEqual(fixture.codexSync.symlinkBehavior, 'characterize-before-changing-legacy-absolute-targets');
});

run('distribution-projection-characterization');
