'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('always-visible execution kernel preserves safety and completion boundaries', () => {
  const kernel = read('rules/execution-policy-kernel.md');
  for (const phrase of [
    'Safety and authorization',
    'dirty worktree',
    'route-result.js',
    'explicit-only',
    'Completion boundary',
    'unavailable',
  ]) assert.match(kernel, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.ok(kernel.includes('execution-policy.md'), 'kernel must point to the policy SSOT');
  assert.ok(kernel.length < 6000, 'kernel must stay short enough to remain always visible');
});

test('policy skill and rule bind the same kernel before conditional references', () => {
  const skill = read('skills/flow-guide/SKILL.md');
  const policy = read('rules/execution-policy.md');
  assert.ok(skill.indexOf('execution-policy-kernel.md') < skill.indexOf('execution-policy.md'));
  assert.ok(policy.includes('execution-policy-kernel.md'));
  assert.ok(skill.includes('single source of truth'));
});

test('dispatch contract defines bounded context tiers and a complete cold packet', () => {
  const policy = read('rules/execution-policy.md');
  for (const tier of ['`cold`', '`bounded`', '`full`']) {
    assert.ok(policy.includes(tier), `missing context tier ${tier}`);
  }
  for (const field of ['goal and non-goals', 'exact owned files', 'settled interfaces', 'verification and acceptance', 'task/attempt identity']) {
    assert.ok(policy.includes(field), `cold packet missing ${field}`);
  }
  assert.ok(/File count remains a collision and safety gate/.test(policy));
  assert.ok(/does not by itself justify a\s+`full` fork/.test(policy));
});

run('execution-policy-kernel');
