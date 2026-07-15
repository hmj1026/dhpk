'use strict';

// Regression guard for the Markdown lint CI job. The actual lint action owns
// Markdown parsing; this zero-dependency test protects its wiring and keeps a
// table-shape rule from being disabled or the job from being made advisory.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const CONFIG = path.join(ROOT, '.markdownlint.json');

const workflow = fs.readFileSync(WORKFLOW, 'utf8');
const markdownlint = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const lintMatch = workflow.match(/\n  lint:\n([\s\S]*?)(?=\n  [a-z][a-z0-9-]*:\n|$)/);
assert.ok(lintMatch, 'ci.yml must define a lint job');
const lintJob = lintMatch[1];

test('Markdown lint job remains blocking and covers the intended asset globs', () => {
  assert.ok(
    lintJob.includes('uses: DavidAnson/markdownlint-cli2-action@v23'),
    'lint job must use the pinned markdownlint-cli2 action'
  );
  for (const glob of [
    'agents/**/*.md',
    'skills/**/*.md',
    'commands/**/*.md',
    'rules/**/*.md',
    'modules/**/*.md',
  ]) {
    assert.ok(lintJob.includes(`            ${glob}`), `missing Markdown lint glob: ${glob}`);
  }
  assert.ok(
    !lintJob.includes('continue-on-error: true'),
    'Markdown lint must block CI when a violation is found'
  );
});

test('Markdown table column validation remains enabled', () => {
  assert.strictEqual(markdownlint.default, true);
  assert.notStrictEqual(markdownlint.MD056, false, 'MD056 must not be disabled');
});

run('markdownlint-workflow');
