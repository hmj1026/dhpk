'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { validateSkillPurposeDecisions } = require('../scripts/lib/skill-purpose-decisions');
const ROOT = path.join(__dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/distribution-inventory.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests/skill-purpose-decisions.json'), 'utf8'));
const ids = ['create-pr', 'git-worktree', 'merge-prep', 'pr-summary', 'proposal-analyze',
  'project-brief', 'doc-refactor', 'update-docs', 'update-codemaps', 'precommit',
  'dep-audit', 'repo-verify', 'code-simplify', 'harness-audit', 'review-pending',
  'spec-mine', 'harness-setup', 'opsx-apply-resume', 'ui-ux-verify'];
const additions = ids.map((id) => ({ id, source: 'docs/adr/0022-portable-command-skills-and-public-names.md' }));
function validateRows(rows) {
  return validateSkillPurposeDecisions({ root: ROOT, inventory, ledger: { ...ledger, additions: rows } });
}

function assertOnlyDiagnostic(rows, pattern, label) {
  const errors = validateRows(rows).errors;
  assert.strictEqual(errors.length, 1, `${label}: ${JSON.stringify(errors)}`);
  assert.match(errors[0], pattern, label);
}

test('post-baseline skills require explicit additions without rewriting historical evidence', () => {
  assert.deepStrictEqual(validateRows(additions).errors, []);
  assertOnlyDiagnostic(
    additions.slice(1),
    /active skill 'create-pr' requires an addition decision beyond the issue #467 baseline/,
    'a missing addition must identify the skill and baseline rule',
  );
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, ledger.baseline.path), 'utf8'));
  assert.strictEqual(baseline.static.skills.length, 65);
  assert.ok(!baseline.static.skills.some((skill) => skill.id === 'precommit'));
});

test('addition provenance rejects duplicates, old or unknown IDs, and missing or unsafe evidence', () => {
  assertOnlyDiagnostic(
    [...additions, additions[0]],
    /duplicates addition 'create-pr'/,
    'a duplicate addition must name its identity error',
  );
  assertOnlyDiagnostic(
    [...additions, { id: 'tdd', source: additions[0].source }],
    /cannot redeclare baseline skill 'tdd'/,
    'a baseline skill cannot be re-added',
  );
  assertOnlyDiagnostic(
    [...additions, { id: 'unregistered', source: additions[0].source }],
    /does not resolve to active skill 'unregistered'/,
    'an unknown ID must be distinguished from a baseline ID',
  );
  assertOnlyDiagnostic(
    [{ ...additions[0], source: '../outside.md' }, ...additions.slice(1)],
    /contains an unsafe caller path '\.\.\/outside\.md'/,
    'parent traversal must be rejected',
  );
  assertOnlyDiagnostic(
    [{ ...additions[0], source: '/tmp/outside.md' }, ...additions.slice(1)],
    /contains an unsafe caller path '\/tmp\/outside\.md'/,
    'absolute paths must be rejected',
  );
  assertOnlyDiagnostic(
    [{ ...additions[0], source: 'docs/not-present-addition.md' }, ...additions.slice(1)],
    /caller does not exist: docs\/not-present-addition\.md/,
    'missing provenance documents must be rejected',
  );
});

run('skill-purpose-additions');
