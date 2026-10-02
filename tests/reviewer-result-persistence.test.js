'use strict';

// Return-only reviewer result persistence contract (ADR 0025).
// Every expected value is an independent literal; sha256 digests were
// computed out-of-band from the exact text literals below.

const { test, run, assert } = require('./_lib/tinytest');
const {
  evaluateReturnedReviewResult,
  persistReviewResult,
} = require('../scripts/lib/reviewer-result-persistence');

const TEXT = 'VERDICT: APPROVE\nno findings';
const TEXT_SHA = 'aabb319dd9280899043dd2b0e3e24b771e2650bf31cfa04093997ee52dffb735';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function expected() {
  return { contractVersion: 'rr.v1', reviewerRole: 'code-reviewer', treeId: 'tree-abc', implementerId: 'impl-1' };
}

function result(overrides = {}) {
  return {
    text: TEXT,
    contractVersion: 'rr.v1',
    reviewerRole: 'code-reviewer',
    reviewerRunId: 'run-9',
    implementerId: 'impl-1',
    treeId: 'tree-abc',
    verdict: 'APPROVE',
    findings: [{ id: 'F1', severity: 'low' }],
    ...overrides,
  };
}

function recorder(behavior) {
  const calls = [];
  const save = (record) => {
    calls.push(record);
    return behavior(record);
  };
  return { save, calls };
}

const echo = (record) => ({ ok: true, persisted: JSON.parse(JSON.stringify(record)) });

function persist(extra = {}) {
  return persistReviewResult({
    result: result(),
    expected: expected(),
    contract: { persistence: 'required' },
    ...extra,
  });
}

// ---- evaluateReturnedReviewResult ----

test('evaluate_nullResult_returnsNoResult', () => {
  assert.deepStrictEqual(evaluateReturnedReviewResult({ result: null, expected: expected() }), {
    status: 'NO_RESULT',
    reasons: ['no-result'],
  });
  assert.strictEqual(evaluateReturnedReviewResult({ result: undefined, expected: expected() }).status, 'NO_RESULT');
});

test('evaluate_missingTreeId_returnsMalformed', () => {
  const r = result();
  delete r.treeId;
  const out = evaluateReturnedReviewResult({ result: r, expected: expected() });
  assert.strictEqual(out.status, 'MALFORMED_RESULT');
  assert.deepStrictEqual(out.reasons, ['invalid-field:treeId']);
});

test('evaluate_findingsNotArray_returnsMalformed', () => {
  const out = evaluateReturnedReviewResult({ result: result({ findings: 'none' }), expected: expected() });
  assert.strictEqual(out.status, 'MALFORMED_RESULT');
  assert.deepStrictEqual(out.reasons, ['invalid-field:findings']);
});

test('evaluate_emptyText_returnsMalformed', () => {
  const out = evaluateReturnedReviewResult({ result: result({ text: '' }), expected: expected() });
  assert.strictEqual(out.status, 'MALFORMED_RESULT');
  assert.deepStrictEqual(out.reasons, ['invalid-field:text']);
});

test('evaluate_roleMismatch_returnsMalformedRoleMismatch', () => {
  const out = evaluateReturnedReviewResult({ result: result({ reviewerRole: 'doc-reviewer' }), expected: expected() });
  assert.strictEqual(out.status, 'MALFORMED_RESULT');
  assert.deepStrictEqual(out.reasons, ['role-mismatch']);
});

test('evaluate_differentTree_returnsStaleIdentity', () => {
  const out = evaluateReturnedReviewResult({ result: result({ treeId: 'tree-old' }), expected: expected() });
  assert.strictEqual(out.status, 'STALE_IDENTITY');
  assert.deepStrictEqual(out.reasons, ['tree-mismatch']);
});

test('evaluate_differentContractVersion_returnsStaleIdentity', () => {
  const out = evaluateReturnedReviewResult({ result: result({ contractVersion: 'rr.v0' }), expected: expected() });
  assert.strictEqual(out.status, 'STALE_IDENTITY');
  assert.deepStrictEqual(out.reasons, ['contract-version-mismatch']);
});

test('evaluate_differentImplementer_returnsStaleIdentity', () => {
  const out = evaluateReturnedReviewResult({ result: result({ implementerId: 'impl-other' }), expected: expected() });
  assert.strictEqual(out.status, 'STALE_IDENTITY');
  assert.deepStrictEqual(out.reasons, ['implementer-mismatch']);
});

test('evaluate_reviewerRunIdEqualsImplementer_returnsSelfReview', () => {
  const out = evaluateReturnedReviewResult({ result: result({ reviewerRunId: 'impl-1' }), expected: expected() });
  assert.strictEqual(out.status, 'SELF_REVIEW');
  assert.deepStrictEqual(out.reasons, ['self-review']);
});

test('evaluate_wellFormedMatchingResult_returnsValid', () => {
  assert.deepStrictEqual(evaluateReturnedReviewResult({ result: result(), expected: expected() }), {
    status: 'VALID',
    reasons: [],
  });
});

test('evaluate_output_isFrozen', () => {
  const out = evaluateReturnedReviewResult({ result: result(), expected: expected() });
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.reasons));
});

// ---- persistReviewResult ----

test('persist_nonValidEvaluation_returnsStatusAsIsWithoutSaving', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ result: result({ treeId: 'tree-old' }), save });
  assert.strictEqual(out.status, 'STALE_IDENTITY');
  assert.strictEqual(out.redispatch, false);
  assert.strictEqual(out.record, undefined);
  assert.strictEqual(calls.length, 0);
});

test('persist_nullResult_returnsNoResultWithoutSaving', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ result: null, save });
  assert.strictEqual(out.status, 'NO_RESULT');
  assert.strictEqual(calls.length, 0);
});

test('persist_inlineOnly_returnsValidatedInlineWithoutSaving', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ contract: { persistence: 'inline-only' }, save });
  assert.strictEqual(out.status, 'VALIDATED_INLINE');
  assert.strictEqual(out.redispatch, false);
  assert.strictEqual(calls.length, 0);
});

test('persist_validRequired_savesOnceAndReturnsRecorded', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save });
  assert.strictEqual(out.status, 'RECORDED');
  assert.deepStrictEqual(out.reasons, []);
  assert.strictEqual(out.redispatch, false);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(Object.keys(calls[0]).sort(), [
    'contractVersion', 'findings', 'implementerId', 'resultSha256', 'resultText',
    'reviewerRole', 'reviewerRunId', 'treeId', 'verdict',
  ]);
  assert.strictEqual(out.record.resultText, TEXT);
  assert.strictEqual(out.record.verdict, 'APPROVE');
  assert.strictEqual(out.record.reviewerRunId, 'run-9');
});

test('persist_record_carriesIndependentSha256OfVerbatimText', () => {
  const { save } = recorder(echo);
  const out = persist({ save });
  assert.strictEqual(out.record.resultSha256, TEXT_SHA);
});

test('persist_saveThrows_returnsUnresolvedAndRetainsRecord', () => {
  const { save } = recorder(() => { throw new Error('disk full'); });
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['save-failed']);
  assert.strictEqual(out.redispatch, false);
  assert.strictEqual(out.record.resultText, TEXT);
});

test('persist_saveReturnsOkFalse_returnsUnresolved', () => {
  const { save } = recorder(() => ({ ok: false }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['save-failed']);
  assert.strictEqual(out.record.treeId, 'tree-abc');
});

test('persist_saveReturnsFalsy_returnsUnresolved', () => {
  const { save } = recorder(() => undefined);
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['save-failed']);
});

test('persist_persistedVerdictAltered_returnsUnresolvedMismatch', () => {
  const { save } = recorder((record) => ({ ok: true, persisted: { ...record, verdict: 'REJECT' } }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
  assert.strictEqual(out.record.verdict, 'APPROVE');
});

test('persist_persistedFindingsAltered_returnsUnresolvedMismatch', () => {
  const { save } = recorder((record) => ({ ok: true, persisted: { ...record, findings: [] } }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

test('persist_persistedTextAltered_returnsUnresolvedMismatch', () => {
  const { save } = recorder((record) => ({ ok: true, persisted: { ...record, resultText: 'VERDICT: APPROVE' } }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

test('persist_persistedHashNotMatchingItsText_returnsUnresolvedMismatch', () => {
  const { save } = recorder((record) => ({ ok: true, persisted: { ...record, resultSha256: 'deadbeef' } }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

test('persist_persistedMissing_returnsUnresolvedMismatch', () => {
  const { save } = recorder(() => ({ ok: true }));
  const out = persist({ save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

function existingRecord(overrides = {}) {
  return {
    resultText: TEXT,
    resultSha256: TEXT_SHA,
    contractVersion: 'rr.v1',
    reviewerRole: 'code-reviewer',
    reviewerRunId: 'run-9',
    implementerId: 'impl-1',
    treeId: 'tree-abc',
    verdict: 'APPROVE',
    findings: [{ id: 'F1', severity: 'low' }],
    ...overrides,
  };
}

test('persist_matchingIntactExisting_returnsReusedWithoutSaving', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save, existing: existingRecord() });
  assert.strictEqual(out.status, 'REUSED');
  assert.strictEqual(out.redispatch, false);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(out.record.resultSha256, TEXT_SHA);
});

test('persist_existingWithTamperedHash_fallsThroughToSave', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save, existing: existingRecord({ resultSha256: 'deadbeef' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(calls.length, 1);
});

test('persist_existingWithEditedTextAndMatchingOldHash_fallsThroughToSave', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save, existing: existingRecord({ resultText: 'VERDICT: REJECT' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(calls.length, 1);
});

test('persist_existingForOtherTree_fallsThroughToSave', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save, existing: existingRecord({ treeId: 'tree-old' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(calls.length, 1);
});

test('persist_existingForOtherRun_fallsThroughToSave', () => {
  const { save, calls } = recorder(echo);
  const out = persist({ save, existing: existingRecord({ reviewerRunId: 'run-1' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(calls.length, 1);
});

test('persist_deepFrozenInputs_doesNotThrowAndDoesNotMutate', () => {
  const { save } = recorder(echo);
  const args = deepFreeze({
    result: result(),
    expected: expected(),
    contract: { persistence: 'required' },
    existing: existingRecord({ resultSha256: 'deadbeef' }),
  });
  const snapshot = JSON.parse(JSON.stringify(args));
  const out = persistReviewResult({ ...args, save });
  assert.strictEqual(out.status, 'RECORDED');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(args)), snapshot);
});

test('persist_outputs_areFrozenForEveryStatus', () => {
  const outs = [
    persist({ save: recorder(echo).save }),
    persist({ save: recorder(() => ({ ok: false })).save }),
    persist({ save: recorder(echo).save, existing: existingRecord() }),
    persist({ contract: { persistence: 'inline-only' }, save: recorder(echo).save }),
    persist({ result: null, save: recorder(echo).save }),
  ];
  for (const out of outs) {
    assert.ok(Object.isFrozen(out));
    assert.ok(Object.isFrozen(out.reasons));
    if (out.record) {
      assert.ok(Object.isFrozen(out.record));
      assert.ok(Object.isFrozen(out.record.findings));
    }
  }
});

test('persist_returnedRecord_isNotTheCallerResultObject', () => {
  const r = result();
  const out = persistReviewResult({
    result: r, expected: expected(), contract: { persistence: 'required' }, save: recorder(echo).save,
  });
  assert.notStrictEqual(out.record.findings, r.findings);
  assert.strictEqual(Object.isFrozen(r.findings), false);
});

test('persist_everyStatus_hasRedispatchFalse', () => {
  const cases = [
    persist({ result: null, save: recorder(echo).save }),
    persist({ result: result({ reviewerRunId: 'impl-1' }), save: recorder(echo).save }),
    persist({ save: recorder(echo).save }),
    persist({ save: recorder(() => { throw new Error('x'); }).save }),
    persist({ save: recorder(echo).save, existing: existingRecord() }),
    persist({ contract: { persistence: 'inline-only' }, save: recorder(echo).save }),
  ];
  for (const out of cases) assert.strictEqual(out.redispatch, false);
});

// ---- tamper and fail-closed cases (code review 2026-10-02) ----

test('persist_saveMutatesItsArgumentAndEchoesIt_returnsUnresolvedMismatch', () => {
  const out = persist({
    save: (record) => {
      try { record.verdict = 'REJECT'; } catch (_error) { /* frozen argument is acceptable */ }
      return { ok: true, persisted: record };
    },
  });
  assert.strictEqual(out.status === 'RECORDED' && out.record.verdict !== 'APPROVE', false);
  assert.strictEqual(out.record.verdict, 'APPROVE');
});

test('persist_saveMutatesFindingsAndEchoesIt_neverRecordsAlteredFindings', () => {
  const out = persist({
    save: (record) => {
      try { record.findings.push({ id: 'F9' }); } catch (_error) { /* frozen argument is acceptable */ }
      return { ok: true, persisted: record };
    },
  });
  assert.deepStrictEqual(out.record.findings, [{ id: 'F1', severity: 'low' }]);
});

test('persist_existingWithForgedVerdict_fallsThroughToSave', () => {
  const rec = recorder(echo);
  const out = persist({ save: rec.save, existing: existingRecord({ verdict: 'REJECT' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(rec.calls.length, 1);
});

test('persist_existingWithForgedFindings_fallsThroughToSave', () => {
  const rec = recorder(echo);
  const out = persist({ save: rec.save, existing: existingRecord({ findings: [] }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(rec.calls.length, 1);
});

test('persist_existingForOtherImplementer_fallsThroughToSave', () => {
  const rec = recorder(echo);
  const out = persist({ save: rec.save, existing: existingRecord({ implementerId: 'impl-2' }) });
  assert.strictEqual(out.status, 'RECORDED');
  assert.strictEqual(rec.calls.length, 1);
});

test('persist_persistedForOtherTree_returnsUnresolvedMismatch', () => {
  const out = persist({
    save: (record) => ({ ok: true, persisted: { ...JSON.parse(JSON.stringify(record)), treeId: 'tree-zzz' } }),
  });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

test('persist_persistedForOtherReviewerRun_returnsUnresolvedMismatch', () => {
  const out = persist({
    save: (record) => ({ ok: true, persisted: { ...JSON.parse(JSON.stringify(record)), reviewerRunId: 'run-0' } }),
  });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['persisted-mismatch']);
});

test('persist_cyclicFindings_returnsMalformedWithoutThrowing', () => {
  const findings = [{ id: 'F1' }];
  findings[0].self = findings[0];
  const rec = recorder(echo);
  const out = persist({ result: result({ findings }), save: rec.save });
  assert.strictEqual(out.status, 'MALFORMED_RESULT');
  assert.deepStrictEqual(out.reasons, ['invalid-field:findings']);
  assert.strictEqual(rec.calls.length, 0);
});

test('evaluate_missingExpected_failsClosed', () => {
  const out = evaluateReturnedReviewResult({ result: result() });
  assert.notStrictEqual(out.status, 'VALID');
});

test('evaluate_partialExpected_failsClosed', () => {
  const out = evaluateReturnedReviewResult({ result: result(), expected: { reviewerRole: 'code-reviewer' } });
  assert.notStrictEqual(out.status, 'VALID');
});

test('persist_missingContract_returnsUnresolvedWithoutSaving', () => {
  const rec = recorder(echo);
  const out = persistReviewResult({ result: result(), expected: expected(), save: rec.save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['invalid-persistence-contract']);
  assert.strictEqual(rec.calls.length, 0);
});

test('persist_unknownContractPersistence_returnsUnresolvedWithoutSaving', () => {
  const rec = recorder(echo);
  const out = persist({ contract: { persistence: 'sometimes' }, save: rec.save });
  assert.strictEqual(out.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.reasons, ['invalid-persistence-contract']);
  assert.strictEqual(rec.calls.length, 0);
});

run('reviewer-result-persistence');
