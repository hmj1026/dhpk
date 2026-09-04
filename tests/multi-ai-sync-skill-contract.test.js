'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'harness-govern');
const CODEX = path.join(ROOT, 'codex', 'skills', 'harness-govern');
const canonical = fs.readFileSync(path.join(CANONICAL, 'SKILL.md'), 'utf8');
const codex = fs.readFileSync(path.join(CODEX, 'SKILL.md'), 'utf8');
const SHARED_REFERENCES = [
  'execution-contract.md',
  'platform-mapping.md',
  'capability-sources.md',
  'risk-policy.md',
  'improvement-todo.md',
  'source-conflicts.json',
];
const MODE_REFERENCES = {
  health: ['health-workflow.md', 'hygiene-checks.md', 'plugin-sync.md', 'usage-examples.md', 'best-practices.md'],
  budget: ['budget-workflow.md'],
  fill: ['fill-workflow.md', 'frontmatter-templates.md'],
  revise: ['revise-workflow.md', 'harness-directory-contract.md'],
  sync: ['sync-workflow.md', 'runtime-entrypoints.md', ...SHARED_REFERENCES],
};

test('canonical and Codex resolve to one complete harness-govern workflow tree', () => {
  assert.strictEqual(fs.realpathSync(CODEX), fs.realpathSync(CANONICAL));
  assert.ok(canonical.includes('health|budget|fill|revise|sync'), 'five governance modes are missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync.py')), 'canonical sync CLI is missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync_lib', 'agent_sync.py')), 'canonical agent-sync capability is missing');
  assert.ok(fs.existsSync(path.join(CANONICAL, 'scripts', 'multi_ai_sync_lib', 'apply_sync.py')), 'canonical apply-sync capability is missing');
  assert.strictEqual(codex, canonical);
});

test('workflow contract has explicit mode routing, completion, and gate sections', () => {
  for (const heading of [
    '# Harness Govern',
    '## Mode selection',
    '## Shared preflight',
    '## Mode contracts',
    '## Output shape',
    '## References and scripts',
    '## Verification',
  ]) {
    assert.ok(canonical.includes(heading), `missing ${heading}`);
  }
  const modes = ['health', 'budget', 'fill', 'revise', 'sync'];
  for (const mode of modes) {
    assert.match(canonical, new RegExp('\\\\| `' + mode + '` \\\\|'), `missing harness-govern mode: ${mode}`);
  }
  assert.ok(canonical.indexOf('## Shared preflight') < canonical.indexOf('## Mode contracts'), 'preflight must precede mode contracts');
  assert.ok(canonical.indexOf('## Mode contracts') < canonical.indexOf('## Verification'), 'mode contracts must precede verification');
});

test('each consolidated mode owns its procedure, references, and executable source', () => {
  const scripts = fs.readdirSync(path.join(CANONICAL, 'scripts'));
  assert.ok(scripts.includes('harness-inventory.sh'), 'revise inventory script is missing');
  assert.ok(scripts.includes('harness-scenarios.sh'), 'revise scenario script is missing');
  assert.ok(scripts.includes('test-harness.sh'), 'revise harness test script is missing');
  assert.ok(scripts.includes('multi_ai_sync.py'), 'sync executable is missing');
  for (const [mode, references] of Object.entries(MODE_REFERENCES)) {
    assert.match(canonical, new RegExp('\\\\| `' + mode + '` \\\\|'), `${mode} must have an explicit mode row`);
    for (const reference of references) {
      assert.ok(fs.existsSync(path.join(CANONICAL, 'references', reference)), `${mode} reference missing: ${reference}`);
    }
  }
});

test('workflow contains no stale unsupported instructions', () => {
  for (const content of [canonical, codex]) {
    assert.ok(!content.includes('--force'), 'stale --force bypass remains');
    assert.ok(!content.includes('gemini-adapt-agents'), 'obsolete Gemini adapter remains');
    assert.ok(!content.includes('.gemini/agents'), 'unsupported Gemini agent output remains');
    for (const predecessor of ['dhpk-claude-health', 'dhpk-harness-budget', 'dhpk-harness-fill', 'dhpk-harness-revise', 'dhpk-cross-agent-sync']) {
      assert.ok(!content.includes(predecessor), `retired predecessor alias remains: ${predecessor}`);
    }
  }
  assert.ok(fs.existsSync(path.join(CODEX, 'scripts', 'multi_ai_sync_lib', 'agent_sync.py')), 'Codex agent-sync extension is missing');
  assert.ok(fs.existsSync(path.join(CODEX, 'scripts', 'multi_ai_sync_lib', 'apply_sync.py')), 'Codex apply-sync extension is missing');
  assert.ok(codex.includes('sync'), 'Codex sync mode is missing');
});

test('shared references stay synced and runtime entrypoints stay harness-specific', () => {
  const canonicalRuntime = fs.readFileSync(path.join(CANONICAL, 'references', 'runtime-entrypoints.md'), 'utf8');
  const codexRuntime = fs.readFileSync(path.join(CODEX, 'references', 'runtime-entrypoints.md'), 'utf8');
  assert.strictEqual(codexRuntime, canonicalRuntime);
  assert.ok(canonicalRuntime.includes('SYNC_CLI="skills/harness-govern/scripts/multi_ai_sync.py"'));
  for (const skillRoot of [CANONICAL, CODEX]) {
    const runtimeReference = path.join(skillRoot, 'references', 'runtime-entrypoints.md');
    assert.ok(fs.existsSync(runtimeReference), `missing ${runtimeReference}`);
    const runtime = fs.readFileSync(runtimeReference, 'utf8');
    assert.ok(runtime.includes('SYNC_CLI'), `missing SYNC_CLI contract in ${runtimeReference}`);
    assert.ok(runtime.includes('--root <repo-root>'), `missing root contract in ${runtimeReference}`);
  }
  for (const referenceName of SHARED_REFERENCES) {
    const canonicalReference = path.join(CANONICAL, 'references', referenceName);
    const codexReference = path.join(CODEX, 'references', referenceName);
    assert.ok(fs.existsSync(canonicalReference), `missing ${canonicalReference}`);
    assert.ok(fs.existsSync(codexReference), `missing ${codexReference}`);
    assert.strictEqual(
      fs.readFileSync(codexReference, 'utf8'),
      fs.readFileSync(canonicalReference, 'utf8'),
      `shared reference drift: ${referenceName}`,
    );
  }
});

test('task 5.4: configured-platform status vocabulary stays consistent between SKILL.md and execution-contract.md', () => {
  const executionContract = fs.readFileSync(path.join(CANONICAL, 'references', 'execution-contract.md'), 'utf8');
  const syncWorkflow = fs.readFileSync(path.join(CANONICAL, 'references', 'sync-workflow.md'), 'utf8');
  for (const term of ['NOT_CONFIGURED', 'BLOCKED']) {
    assert.ok(canonical.includes(term), `missing status vocabulary term "${term}"`);
  }
  for (const content of [executionContract, syncWorkflow]) {
    for (const term of ['NOT_CONFIGURED', 'SKIP_INCOMPATIBLE', 'BLOCKED']) {
      assert.ok(content.includes(term), `missing status vocabulary term "${term}"`);
    }
  }
  assert.ok(executionContract.includes('legacy_gate'), 'compatibility field must remain documented in the sync contract');
  assert.ok(syncWorkflow.includes('--targets'), 'sync workflow must document the --targets/--all-targets explicit-request flags');
});

run('multi-ai-sync-skill-contract');
