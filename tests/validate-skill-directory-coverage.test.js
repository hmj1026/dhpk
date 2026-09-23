'use strict';

// CLI contract for the repository-only Skill directory coverage check.
// Fixture definitions are authoring evidence; this command never executes
// them, so its report must keep fixture execution and Host probes NOT_RUN.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const CLI = path.join(__dirname, '..', 'scripts', 'ci', 'validate-skill-directory-coverage.js');

function invoke(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000 });
}

test('--check reports one PASS result per canonical inventory identity', () => {
  const result = invoke(['--check']);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  const inventory = require('../manifests/distribution-inventory.json');
  assert.strictEqual(report.ok, true, report.errors.join('\n'));
  assert.deepStrictEqual(Object.keys(report.skills).sort(), inventory.skills.map((row) => row.id).sort());
  for (const [id, detail] of Object.entries(report.skills)) {
    assert.strictEqual(detail.status, 'PASS', id);
    assert.ok(['NOT_RUN', 'NOT_APPLICABLE'].includes(detail.fixtures), `${id} fixtures ${detail.fixtures}`);
  }
  assert.strictEqual(report.fixture_execution, 'NOT_RUN');
  assert.strictEqual(report.host_probes, 'NOT_RUN');
});

test('unknown arguments exit 2 without a report', () => {
  for (const args of [[], ['--write'], ['--check', '--extra']]) {
    const result = invoke(args);
    assert.strictEqual(result.status, 2, `${args.join(' ')}: ${result.stdout}`);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /Usage: validate-skill-directory-coverage\.js --check/);
  }
});

run('validate-skill-directory-coverage');
