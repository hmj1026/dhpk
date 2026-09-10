'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { FAILURE_CLASSES } = require('../scripts/lib/native-dispatch-policy');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('canonical policy documents all failure classes and state invariants', () => {
  const policy = read('rules/execution-policy.md');
  const dispatch = read('skills/flow-guide/references/implementation-dispatch.md');
  for (const failureClass of Object.values(FAILURE_CLASSES)) {
    assert.ok(policy.includes(`\`${failureClass}\``), `${failureClass} missing from policy`);
    assert.ok(dispatch.includes(`\`${failureClass}\``), `${failureClass} missing from dispatch guide`);
  }
  for (const field of ['attempted_backends', 'unavailable_backends', 'retry_budget']) {
    assert.ok(policy.includes(`\`${field}\``), `${field} missing from policy`);
    assert.ok(dispatch.includes(`\`${field}\``), `${field} missing from dispatch guide`);
  }
  assert.ok(policy.includes('It never chooses a new') && policy.includes('provider or silently retries'));
  assert.ok(policy.includes('preserves the role, task scope, read/write authority'));
});

test('delegated role documents inherit fallback policy without changing contracts', () => {
  for (const role of ['planner', 'deep-reasoner', 'fast-worker', 'code-reviewer']) {
    const document = read(`agents/${role}.md`);
    assert.ok(document.includes('Fallback'), `${role} missing fallback boundary`);
    assert.ok(document.includes('cross-provider'), `${role} missing cross-provider gate`);
  }
  for (const role of ['codex-worker', 'agy-worker', 'codex-reasoner', 'codex-deep-reasoner']) {
    const document = read(`agents/${role}.md`);
    assert.ok(document.includes('dispatcher'), `${role} must leave fallback selection to dispatcher`);
    assert.ok(document.includes('provider side effect'), `${role} must require no-side-effect evidence`);
  }
});

test('transport contract classifies failures but cannot select a provider', () => {
  const transport = read('skills/dhpk-cli-transport/SKILL.md');
  assert.ok(transport.includes('failure_class'));
  assert.ok(transport.includes('Requested and effective') && transport.includes('provider fields remain unchanged'));
  assert.ok(transport.includes('never emits a silent provider switch'));
});

run('native-fallback-contract');
