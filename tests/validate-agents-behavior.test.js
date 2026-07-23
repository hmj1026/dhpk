'use strict';

// Regression guard for a historical Release failure (v0.3.1: "Validation
// errors: agents: Invalid input"). scripts/ci/validate-agents.js relies on
// frontmatter.js to detect missing/empty required fields — this test proves
// that detection logic actually flags the malformed input classes that
// caused the failure, rather than only being exercised indirectly against
// already-valid real agent files.

const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { extract, isEmpty } = require(
  path.join(__dirname, '..', 'scripts', 'ci', '_lib', 'frontmatter')
);

test('missing frontmatter block is detected', () => {
  const fm = extract('no frontmatter here');
  assert.strictEqual(fm.present, false);
});

test('missing description is flagged as empty', () => {
  const fm = extract('---\nname: broken-agent\n---\nbody');
  assert.ok(isEmpty(fm.values.description), 'undefined description must be treated as empty');
});

test('blank quoted description is flagged as empty', () => {
  const fm = extract('---\nname: broken-agent\ndescription: \'\'\n---\nbody');
  assert.ok(isEmpty(fm.values.description), "quoted '' description must be treated as empty");
});

test('duplicate frontmatter keys are reported', () => {
  const fm = extract('---\nname: a\nname: b\n---\nbody');
  assert.ok(fm.duplicates.includes('name'), 'duplicate "name" key must be reported');
});

test('a well-formed agent frontmatter passes all checks', () => {
  const fm = extract('---\nname: ok-agent\ndescription: does a thing\nmodel: sonnet\n---\nbody');
  assert.ok(fm.present, 'frontmatter should be present');
  assert.ok(!isEmpty(fm.values.name), 'name should not be empty');
  assert.ok(!isEmpty(fm.values.description), 'description should not be empty');
  assert.strictEqual(fm.duplicates.length, 0, 'no duplicates expected');
});

test('fable is an accepted model tier (agents/architect.md ships on it)', () => {
  const src = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'scripts', 'ci', 'validate-agents.js'), 'utf8');
  assert.ok(/VALID_MODELS\s*=\s*\[[^\]]*'fable'/.test(src),
    'validate-agents.js VALID_MODELS must include fable so agents/architect.md (model: fable) validates');
});

run('validate-agents-behavior');
