'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('approved consolidation leaves 65 canonical packages and retires predecessor identities', () => {
  const inventory = JSON.parse(read('manifests/distribution-inventory.json'));
  assert.strictEqual(inventory.skills.length, 65);
  for (const name of [
    'dhpk-code-investigate', 'dhpk-codex-explain', 'dhpk-codex-cli-review',
    'dhpk-codex-architect', 'dhpk-codex-implement',
  ]) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'skills', name)), `${name} must not remain canonical`);
  }
  assert.strictEqual(inventory.skills.find((entry) => entry.name === 'flow-drive').id, 'flow-drive');
  assert.deepStrictEqual(
    inventory.retired_skills.filter((entry) => entry.retiredIn === '0.52.0').map((entry) => entry.id),
    ['codex-architect', 'codex-implement'],
  );
  assert.ok(inventory.retired_skills.some((entry) => entry.id === 'code-explore' && entry.replacements[0].id === 'code-trace'));
  assert.ok(inventory.retired_skills.some((entry) => entry.id === 'codex-code-review' && entry.replacements[0].id === 'change-verdict'));
});

test('code tracing exposes explore, diagnose, history, and tool selection modes', () => {
  const skill = read('skills/code-trace/SKILL.md');
  for (const mode of ['explore', 'diagnose', 'history', 'select-tool']) assert.match(skill, new RegExp(mode, 'i'));
});

test('change verdict exposes all read-only modes', () => {
  const skill = read('skills/change-verdict/SKILL.md');
  for (const mode of ['code', 'pr', 'security', 'tests', 'docs', 'risk']) assert.match(skill, new RegExp(mode, 'i'));
  assert.match(skill, /read-only|read only/i);
});

test('change verdict shell permissions are scoped to read-only helpers', () => {
  const skill = read('skills/change-verdict/SKILL.md');
  for (const broadGrant of ['Bash(git:*)', 'Bash(node:*)', 'Bash(gh:*)', 'Bash(bash:*)']) {
    assert.doesNotMatch(skill, new RegExp(broadGrant.replace(/[()*]/g, '\\$&')), broadGrant);
  }
  assert.match(skill, /Bash\(git diff:\*\)/);
  assert.match(skill, /Bash\(node skills\/change-verdict\/scripts\/risk-analyze\.js:\*\)/);
  assert.match(skill, /Bash\(bash skills\/change-verdict\/scripts\/check-unrelated-changes\.sh:\*\)/);
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
  const skill = read('skills/code-trace/SKILL.md');
  for (const phrase of ['diagnose', 'hypoth', 'evidence', 'verify']) {
    assert.match(skill, new RegExp(phrase, 'i'), phrase);
  }
});

test('skill authoring and audits account for cost, checkability, branches, and sediment pruning', () => {
  for (const name of ['skill-forge', 'skill-scope']) {
    const skill = read(`skills/${name}/SKILL.md`);
    assert.match(skill, /invocation.*cost|context.*cost/i, `${name} cost`);
    assert.match(skill, /checkable|machine-check|completion/i, `${name} completion`);
    assert.match(skill, /branch|conditional|progressive disclosure/i, `${name} branch`);
    assert.match(skill, /no-op|duplication|sediment|prun/i, `${name} pruning`);
  }
});

run('task4-consolidation');
