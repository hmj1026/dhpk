'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contracts', 'reviewer-contract.md'), 'utf8');
const policy = fs.readFileSync(path.join(ROOT, 'rules', 'execution-policy.md'), 'utf8');
const reviewers = [
  ['code-reviewer', 'agents'],
  ['database-reviewer', 'agents'],
  ['security-reviewer', 'agents'],
  ['frontend-reviewer', 'agents'],
  ['doc-reviewer', 'agents'],
  ['migration-reviewer', 'agents'],
  ['polyfill-reviewer', path.join('modules', 'library-author', 'agents')],
];

function teachesReviewGateOwnership(text) {
  return /orchestrator owns Review Gate dispatch and obligation status/i.test(text)
    && /reviewer writes evidence only/i.test(text);
}

test('shared reviewer contract defines compact prompt and artifact/verdict fields', () => {
  for (const token of ['Scope', 'Specialist charter', 'Evidence commands', 'Artifact path', 'Verdict', 'Confirm-only', 'one corrected retry']) {
    assert.ok(contract.includes(token), `reviewer contract missing ${token}`);
  }
  assert.ok(policy.includes('one corrected retry'));
  assert.ok(policy.includes('replacement or a pending gate'));
  assert.ok(!policy.includes('retrying the same agent a third identical time'));
});

test('reviewer prompts reference the shared contract while retaining specialist lanes', () => {
  for (const [name, directory] of reviewers) {
    const text = fs.readFileSync(path.join(ROOT, directory, `${name}.md`), 'utf8');
    assert.ok(text.includes('docs/contracts/reviewer-contract.md'), `${name} missing shared contract reference`);
    assert.ok(text.includes('Specialist checks'), `${name} missing specialist lane marker`);
  }
});

test('reviewer contract requires a single-run Review Gate evidence result', () => {
  assert.ok(contract.toLowerCase().includes('single-run verdict'), 'shared reviewer contract missing single-run verdict marker');
  for (const token of ['canonical filename', 'delimited frontmatter', 'APPROVE or PASS']) {
    assert.ok(contract.includes(token), `shared reviewer contract missing artifact-output token: ${token}`);
  }
  for (const [name, directory] of reviewers) {
    const text = fs.readFileSync(path.join(ROOT, directory, `${name}.md`), 'utf8');
    assert.match(
      text,
      /Single-run verdict: emit the final verdict in this same run/,
      `${name} missing single-run verdict clause`,
    );
    assert.doesNotMatch(
      text,
      /(?:clear the sentinel|clear-sentinel\.sh|\.pending-(?:review|security-review))/i,
      `${name} still instructs the reviewer to use the retired Sentinel workflow`,
    );
    assert.ok(
      teachesReviewGateOwnership(text),
      `${name} must leave Review Gate dispatch and obligation status to the orchestrator`,
    );
  }
});

test('reviewer frequency contract batches waves and bounds recovery', () => {
  for (const token of [
    'contiguous implementation wave',
    'dispatch each applicable reviewer once',
    'confirm-only re-review',
    'new substantive scope starts a new review decision',
  ]) {
    assert.ok(policy.includes(token), `frequency policy missing ${token}`);
  }
  assert.ok(contract.includes('one corrected retry'));
  assert.ok(contract.includes('identical retry is prohibited'));
});

run('reviewer-contract');
