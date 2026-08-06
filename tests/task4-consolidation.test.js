'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('approved consolidation leaves 103 canonical packages and records all legacy names', () => {
  const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
  assert.strictEqual(inventory.skills.length, 103);
  for (const name of ['dhpk-code-investigate', 'dhpk-codex-explain', 'dhpk-codex-cli-review']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'skills', name)), `${name} must not remain canonical`);
  }
  const exploration = inventory.skills.find((entry) => entry.name === 'dhpk-codebase-exploration');
  assert.ok(exploration.legacy_names.includes('code-investigate'));
  assert.ok(exploration.legacy_names.includes('codex-explain'));
  const review = inventory.skills.find((entry) => entry.name === 'dhpk-change-review');
  assert.ok(review.legacy_names.includes('codex-cli-review'));
});

test('codebase exploration exposes default, dual, and depth-controlled explain modes', () => {
  const skill = read('skills/dhpk-codebase-exploration/SKILL.md');
  assert.match(skill, /default.*symbol|default.*flow/i);
  assert.match(skill, /--dual/);
  assert.match(skill, /--explain/);
  assert.match(skill, /--depth (?:brief|normal|deep)|brief.*normal.*deep/i);
  assert.match(skill, /clean prompt|independent/i);
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'dhpk-codebase-exploration', 'references', 'dual-perspective.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'dhpk-codebase-exploration', 'references', 'explain.md')));
});

test('change review exposes CLI backend, scopes, depth, and hardened wrapper', () => {
  const skill = read('skills/dhpk-change-review/SKILL.md');
  assert.match(skill, /--backend cli/);
  assert.match(skill, /diff.*branch.*doc.*security.*tests/i);
  assert.match(skill, /depth.*fast.*full/i);
  assert.match(skill, /merge-base/i);
  assert.match(skill, /Standards.*Spec|Spec.*Standards/i);
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'dhpk-change-review', 'scripts', 'review.sh')));
  assert.doesNotMatch(skill, /dhpk-codex-cli-review/);
});

test('module design uses caller leverage, deletion, seam, adapter, glossary, and ADR tests', () => {
  const skill = read('skills/dhpk-module-design/SKILL.md');
  for (const phrase of [
    'caller leverage', 'deletion test', 'interface-as-test-surface',
    'one hypothetical adapter', 'two real adapters', 'active glossary',
    'ambiguous-term', 'edge-case', 'surprising', 'hard-to-reverse',
  ]) assert.match(skill, new RegExp(phrase, 'i'), phrase);
  assert.doesNotMatch(skill, /Clean Architecture|Auth0|Supabase|Redux|Zustand/);
});

test('TDD workflow covers seams, tracer bullets, slicing, and tautological tests', () => {
  const skill = read('skills/dhpk-tdd-workflow/SKILL.md');
  for (const phrase of ['public seams', 'independent expected values', 'vertical tracer bullets', 'horizontal slicing', 'tautological', 'implementation-coupled']) {
    assert.match(skill, new RegExp(phrase, 'i'), phrase);
  }
  assert.match(skill, /RED.*GREEN.*REFACTOR/s);
});

test('root-cause workflow starts with a symptom-specific red loop and ranked falsifiable hypotheses', () => {
  const skill = read('skills/dhpk-root-cause-investigation/SKILL.md');
  for (const phrase of ['symptom-specific', 'red-capable', 'minimiz', 'ranked', 'falsifiable', 'instrumentation', 'cleanup', 'postmortem', 'stop-loss']) {
    assert.match(skill, new RegExp(phrase, 'i'), phrase);
  }
});

test('skill authoring and audits account for cost, checkability, branches, and sediment pruning', () => {
  for (const name of ['dhpk-create-skill', 'dhpk-skill-health-audit', 'dhpk-skill-quality-judge']) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, /invocation.*cost|context.*cost/i, `${name} cost`);
    assert.match(skill, /checkable|machine-check|completion/i, `${name} completion`);
    assert.match(skill, /branch|conditional|progressive disclosure/i, `${name} branch`);
    assert.match(skill, /no-op|duplication|sediment|prun/i, `${name} pruning`);
  }
});

run('task4-consolidation');
