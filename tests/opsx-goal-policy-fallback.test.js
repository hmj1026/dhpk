'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  DISPATCH_TRUE_FENCE,
  DISPATCH_FALSE_FENCE,
  generateFixture,
  readFixture,
} = require('./_lib/opsx-goal-fixtures');

const FENCES = { 'DISPATCH_ON=true': DISPATCH_TRUE_FENCE, 'DISPATCH_ON=false': DISPATCH_FALSE_FENCE };

// The clause shared verbatim by both dispatch modes (design.md decision 4).
// This is a hand-typed literal, not extracted from the template — it must be
// kept byte-identical to goal-templates.md's DISPATCH_ON=true/false fences or
// the assertions below will fail, which is the intended tripwire against the
// two branches drifting apart.
const FALLBACK_CLAUSE = 'never filesystem-scan; every reviewer dispatch (even\nconfirm-only) still gets a fresh .claude/artifacts/reviews/ artifact, never\nreply-only';

test('both dispatch modes resolve policy through the same fixed candidate chain, in order', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    const order = ['CLAUDE_PLUGIN_ROOT:-', 'ls -dt', './.claude-plugin/plugin.json', './rules/execution-policy.md', 'POLICY-UNRESOLVED'];
    let cursor = -1;
    for (const token of order) {
      const idx = fence.indexOf(token);
      assert.ok(idx >= 0, `${mode}: missing candidate-chain token "${token}"`);
      assert.ok(idx > cursor, `${mode}: token "${token}" out of precedence order`);
      cursor = idx;
    }
  }
});

test('the source-checkout candidate is root-bound and never scans the filesystem', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(!/find\s/.test(fence), `${mode}: must not invoke find`);
    assert.ok(!fence.includes('..'), `${mode}: must not reference a parent directory`);
    assert.ok(!/\*\*/.test(fence), `${mode}: must not use a recursive glob`);
    // The shell is *substantively* conjunctive even though only one literal
    // `test -r` appears: `test -r ./.claude-plugin/plugin.json && cat
    // ./rules/execution-policy.md` short-circuits on the first check, and `cat`
    // itself fails (non-zero exit, silenced by 2>/dev/null) if the policy file
    // is unreadable — so both markers gate the branch, not just the first.
    assert.ok(fence.includes('test -r ./.claude-plugin/plugin.json &&'), `${mode}: missing plugin.json marker guard`);
    assert.ok(fence.includes('cat ./rules/execution-policy.md; }'), `${mode}: missing source-checkout policy read guarded by the same &&`);
  }
});

test('POLICY-UNRESOLVED remains the terminal fallback and still proceeds on inline gates', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(fence.trimEnd().includes('POLICY-UNRESOLVED') || fence.includes('POLICY-UNRESOLVED` —'), `${mode}: missing POLICY-UNRESOLVED echo`);
    assert.ok(/never filesystem-scan/.test(fence), `${mode}: missing no-filesystem-scan wording`);
  }
});

test('both dispatch modes carry an identical fallback reviewer-artifact clause', () => {
  for (const [mode, fence] of Object.entries(FENCES)) {
    assert.ok(fence.includes(FALLBACK_CLAUSE), `${mode}: does not carry the shared fallback clause verbatim`);
  }
});

test('the shared fallback clause covers confirm-only, canonical path, freshness, and rejects reply-only', () => {
  assert.ok(/confirm-only/.test(FALLBACK_CLAUSE), 'clause missing confirm-only coverage');
  assert.ok(FALLBACK_CLAUSE.includes('.claude/artifacts/reviews/'), 'clause missing canonical artifact path');
  assert.ok(/fresh/.test(FALLBACK_CLAUSE), 'clause missing fresh-artifact wording');
  assert.ok(/never\s+reply-only/.test(FALLBACK_CLAUSE), 'clause missing reply-only-never-substitutes wording');
});

test('DISPATCH_ON=false goal stays under the hard cap and the normal target', () => {
  const result = generateFixture(readFixture('no-dispatch'));
  assert.strictEqual(result.mode, 'full', 'no-dispatch fixture should emit normally');
  assert.ok(result.bytes <= 4000, `no-dispatch exceeds hard cap: ${result.bytes}`);
  assert.ok(result.bytes <= 3600, `no-dispatch exceeds the normal target: ${result.bytes}`);
});

run('opsx-goal-policy-fallback');
