'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { registerFixture, getFixtures } = require('./skill-directory-fixtures');
const { assertExpected } = require('./fixture-assertions');

const profileArgs = ['--language', 'javascript', '--runtime', 'node', '--current-version', '22',
  '--target-version', '24', '--architecture', 'modules', '--test-strategy', 'unit',
  '--style', 'standard', '--dependency-policy', 'locked', '--work-item-system', 'docs'];

const definitions = [
  { id: 'flow-guide-usage-local-card', skill: 'flow-guide', entry: 'scripts/usage-card.js',
    args: ['precommit', '--json'], expected: { status: 0, output: ['precommit'] },
    verify(result) { assert.ok(JSON.parse(result.stdout)); } },
  { id: 'flow-guide-analyze-consumer', skill: 'flow-guide', entry: 'scripts/analyze.js',
    expected: { status: 0, output: ['"diff_summary"'] },
    stubs: { git: { body: `const a=process.argv.slice(1);if(a.includes('--show-toplevel'))console.log(process.cwd());else if(a[0]==='branch')console.log('fixture-work');else if(a[0]==='rev-parse')console.log('1234567');else if(!['diff','status'].includes(a[0]))process.exit(91);` } },
    verify(result) { const report = JSON.parse(result.stdout); assert.equal(report.branch, 'fixture-work'); assert.equal(report.diff_summary.total, 0); assert.equal(report.finding_count.P0, 0); } },
  { id: 'flow-guide-prepare-consumer-profile', skill: 'flow-guide', entry: 'scripts/prepare_workflow_profile.py',
    args: profileArgs, expected: { status: 0, output: ['Profile written:'] },
    verify(result, context) { const text = fs.readFileSync(path.join(context.projectDir, '.workflow/profile.yaml'), 'utf8'); assert.match(text, /language: "javascript"/); assert.match(text, /target_upgrade_version: "24"/); } },
  { id: 'flow-guide-prepare-consumer-scope', skill: 'flow-guide', entry: 'scripts/prepare_dev_scope.py',
    args: ['--change', 'portable-check', '--reason', 'fixture reason', '--work-item-system', 'docs', '--path', 'src/example.js'],
    expected: { status: 0, output: ['dev-scope.md'] },
    verify(result, context) { const dir = path.join(context.projectDir, '.workflow/changes/portable-check'); const text = fs.readFileSync(path.join(dir, 'dev-scope.md'), 'utf8'); assert.match(text, /fixture reason/); assert.match(text, /src\/example\.js/); for (const file of ['proposal.md', 'tasks.md', 'legacy-reference.md']) assert.ok(fs.existsSync(path.join(dir, file))); } },
  { id: 'flow-guide-workflow-missing-evidence', skill: 'flow-guide', entry: 'scripts/workflow_gate_check.py',
    args: ['--workflow-type', 'feature'], expected: { status: 1, output: ['Result: FAIL', 'workflow profile not found', '--red-proof is required'] } },
  { id: 'flow-guide-openspec-ready-fixture', skill: 'flow-guide', entry: 'scripts/openspec_gate_check.py',
    args: ['--change', 'fixture-change'], expected: { status: 0, output: ['Change: fixture-change', 'Result: PASS'] },
    stubs: { openspec: { body: `const a=process.argv.slice(1);if(a[0]==='status')console.log(JSON.stringify({schemaName:'spec-driven',applyRequires:['tasks'],artifacts:[{id:'tasks',status:'done'}]}));else if(a[0]==='instructions')console.log(JSON.stringify({state:'ready',contextFiles:['openspec/changes/fixture-change/tasks.md']}));else process.exit(91);` } } },
  ...['flow-guide', 'flow-drive'].map(skill => ({
    id: `${skill}-bundled-selector-native`, skill,
    entry: 'references/execution-bundle/scripts/fast-worker-selector.js',
    args: ['--backend', 'claude', '--fallback', 'none'], expected: { status: 0, output: ['"status":"selected"', '"selected_backend":"claude"', '"fallback":"none"'] },
  })),
];

function registerFlowEntryFixtures() {
  const existing = getFixtures();
  for (const item of definitions) {
    if (existing[item.id]) continue;
    registerFixture({ ...item, assert(result, context) {
      assertExpected(result, item.expected, item.id);
      if (item.verify) item.verify(result, context);
    } });
  }
  return getFixtures();
}

module.exports = { registerFlowEntryFixtures, flowEntryFixtureIds: definitions.map(item => item.id) };
