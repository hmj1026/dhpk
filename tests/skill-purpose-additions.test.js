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
function errors(rows) {
  return validateSkillPurposeDecisions({ root: ROOT, inventory, ledger: { ...ledger, additions: rows } })
    .errors.filter((error) => /baseline|addition/.test(error));
}

test('post-baseline skills require explicit additions without rewriting historical evidence', () => {
  assert.deepStrictEqual(errors(additions), []);
  assert.ok(errors(additions.slice(1)).some((error) => /create-pr.*addition|addition.*create-pr/.test(error)));
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, ledger.baseline.path), 'utf8'));
  assert.strictEqual(baseline.static.skills.length, 65);
  assert.ok(!baseline.static.skills.some((skill) => skill.id === 'precommit'));
});

test('addition provenance rejects duplicates, old or unknown IDs, and missing or unsafe evidence', () => {
  for (const extra of [additions[0], { id: 'tdd', source: additions[0].source },
    { id: 'unregistered', source: additions[0].source }]) {
    assert.ok(errors([...additions, extra]).some((error) => /addition/.test(error)), JSON.stringify(extra));
  }
  for (const source of ['../outside.md', '/tmp/outside.md', 'docs/not-present-addition.md']) {
    assert.ok(errors([{ ...additions[0], source }, ...additions.slice(1)]).some((error) => /addition/.test(error)), source);
  }
});

run('skill-purpose-additions');
