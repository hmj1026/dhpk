'use strict';

// Static prose/structure checks for doc-reviewer.md's normatively-coupled-document
// check (task 3.2 of harden-opsx-goal-policy-fallbacks). doc-reviewer is a freeform
// LLM prompt with no runtime-behavior harness (unlike goal-templates.md's
// deterministic byte-composer) — these assertions check that the prose rules
// account for each documented fixture scenario, not that the agent was invoked.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const DOC_REVIEWER = fs.readFileSync(path.join(ROOT, 'agents', 'doc-reviewer.md'), 'utf8');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'doc-reviewer');

const section = (() => {
  const start = DOC_REVIEWER.indexOf('### 5. Normatively coupled document check');
  assert.ok(start >= 0, 'doc-reviewer.md is missing the coupled-document quadrant');
  const end = DOC_REVIEWER.indexOf('## Out of scope', start);
  assert.ok(end > start, 'coupled-document quadrant has no closing boundary');
  return DOC_REVIEWER.slice(start, end);
})();

test('coupled-document section names both governing document types', () => {
  assert.ok(section.includes('spec.md'), 'missing spec.md');
  assert.ok(section.includes('design.md'), 'missing design.md');
});

test('coupled-document section excludes proposal.md/tasks.md and out-of-batch files', () => {
  assert.ok(section.includes('proposal.md'), 'missing proposal.md exclusion');
  assert.ok(section.includes('tasks.md'), 'missing tasks.md exclusion');
  assert.ok(/never coupled/i.test(section), 'missing explicit non-coupling statement');
  assert.ok(/SAME review batch|same-batch/i.test(section), 'missing same-batch scoping');
});

test('coupled-document section forbids asserting an ambiguous or absent relationship', () => {
  assert.ok(/ambiguous or absent/i.test(section), 'missing ambiguous/absent guard');
  assert.ok(/do not assert coupling/i.test(section), 'missing "do not assert coupling" guard');
});

test('coupled-document section reports one finding across both paths, no second dispatch or rewrite', () => {
  assert.ok(/ONE finding/i.test(section), 'missing single-finding requirement');
  assert.ok(/both file:line/i.test(section), 'missing both-locations citation requirement');
  assert.ok(/do not dispatch\s+a second reviewer pass/i.test(section), 'missing no-second-dispatch guard');
  assert.ok(/do not edit either file/i.test(section), 'missing no-rewrite guard');
});

test('coupled-document section confines cross-file reading to the SAME finding pattern (not independent review)', () => {
  assert.ok(/SAME finding pattern/.test(section), 'missing same-finding-pattern scoping');
  assert.ok(/code\s+correctness stays with `code-reviewer`/i.test(section), 'missing code-reviewer lane boundary');
});

test('the Specialist checks marker documents the new coupled-document check', () => {
  const marker = DOC_REVIEWER.slice(DOC_REVIEWER.indexOf('### Specialist checks'));
  assert.ok(/coupled/i.test(marker), 'Specialist checks marker does not mention the coupled-document check');
});

test('every documented fixture scenario maps onto a rule the prose actually states', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5, 'expected at least 5 doc-reviewer coupled-check fixtures');
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    assert.strictEqual(fixture.schema, 'dhpk.doc-reviewer-fixture.v1', `${file}: wrong schema tag`);
    assert.ok(fixture.scenario, `${file}: missing scenario name`);
    assert.ok(
      typeof fixture.verification === 'string' && /not runtime-verified/.test(fixture.verification),
      `${file}: missing the static-annotation-only disclaimer (this is data, not a proven behavioral result)`,
    );
    assert.ok(fixture.expected, `${file}: missing expected block`);

    const e = fixture.expected;
    // Never dispatch a second review or rewrite either file, coupled or not —
    // §5's "no scope expansion" rule applies regardless of the coupling verdict.
    assert.strictEqual(e.dispatchesSecondReview, false, `${file}: must never dispatch a second review`);
    assert.strictEqual(e.rewritesEitherFile, false, `${file}: must never rewrite either file`);

    if (e.coupled === true) {
      assert.strictEqual(e.findingCount, 1, `${file}: a confirmed coupling must collapse to ONE finding`);
      assert.strictEqual(e.citesBothPaths, true, `${file}: a confirmed coupling must cite both paths`);
      if ('artifactCount' in e) {
        assert.strictEqual(e.artifactCount, 1, `${file}: still exactly one review artifact, even when coupled`);
      }
    } else {
      assert.strictEqual(e.citesBothPaths, false, `${file}: an unconfirmed/absent coupling must not cite both paths`);
    }
  }
});

test('the separate-evidence fixture demonstrates same-pattern scoping, not a blanket merge', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'separate-evidence.json'), 'utf8'));
  assert.notStrictEqual(fixture.findingPatternReviewed, fixture.findingPatternCoupled, 'the two coupled paths must carry DIFFERENT finding patterns in this fixture');
  assert.strictEqual(fixture.expected.coupled, false, 'differing patterns across coupled paths must not be reported as coupled');
  assert.strictEqual(fixture.expected.findingCount, 2, 'differing patterns must stay two separate findings, not merged into one');
});

test('the uncoupled-out-of-batch fixture demonstrates the candidate is from a different change', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'uncoupled-out-of-batch.json'), 'utf8'));
  assert.ok(fixture.batch, `${fixture.scenario}: missing batch`);
  assert.ok(!fixture.candidateFile.startsWith(fixture.batch), 'candidateFile must live outside the reviewed batch for this fixture to be meaningful');
});

run('doc-reviewer-coupled-check');
