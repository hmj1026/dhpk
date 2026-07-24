'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CANONICAL = path.join(ROOT, 'skills', 'multi-ai-sync');
const CODEX = path.join(ROOT, 'codex', 'skills', 'multi-ai-sync');
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

test('canonical and Codex resolve to one complete workflow tree', () => {
  assert.strictEqual(fs.realpathSync(CODEX), fs.realpathSync(CANONICAL));
  assert.ok(canonical.includes('agent_sync.py'), 'canonical agent-sync capability is missing');
  assert.ok(canonical.includes('apply_sync.py'), 'canonical apply-sync capability is missing');
  assert.strictEqual(codex, canonical);
});

test('workflow contract has explicit routing, completion, and gate sections', () => {
  for (const heading of [
    '## When NOT to Use',
    '## Operating Contract',
    '## Workflow',
    '## Output',
    '## Verification',
    '## References',
    '## Stop and report',
  ]) {
    assert.ok(canonical.includes(heading), `missing ${heading}`);
  }

  const phases = [
    '### Step 0: Resolve runtime and preflight',
    '### Step 1: Smoke gate',
    '### Step 2: Generate a read-only plan',
    '### Step 3: Generate reviewable tasks',
    '### Step 4: Dry-run, then apply',
    '### Step 5: Validation gate',
  ].map((heading) => canonical.indexOf(heading));
  assert.ok(phases.every((index) => index >= 0), 'missing workflow phase');
  assert.ok(phases.every((index, position) => position === 0 || index > phases[position - 1]), 'phase order drift');
});

test('workflow contains no stale unsupported instructions', () => {
  for (const content of [canonical, codex]) {
    assert.ok(!content.includes('--force'), 'stale --force bypass remains');
    assert.ok(!content.includes('gemini-adapt-agents'), 'obsolete Gemini adapter remains');
    assert.ok(!content.includes('.gemini/agents'), 'unsupported Gemini agent output remains');
  }
  assert.ok(codex.includes('agent_sync.py'), 'Codex agent-sync extension is missing');
  assert.ok(codex.includes('sync manifest'), 'Codex manifest extension is missing');
});

test('shared references stay synced and runtime entrypoints stay harness-specific', () => {
  const canonicalRuntime = fs.readFileSync(path.join(CANONICAL, 'references', 'runtime-entrypoints.md'), 'utf8');
  const codexRuntime = fs.readFileSync(path.join(CODEX, 'references', 'runtime-entrypoints.md'), 'utf8');
  assert.strictEqual(codexRuntime, canonicalRuntime);
  assert.ok(canonicalRuntime.includes('SYNC_CLI="skills/multi-ai-sync/scripts/multi_ai_sync.py"'));
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

run('multi-ai-sync-skill-contract');
