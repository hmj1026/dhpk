'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  makePlan,
  makeReviewEvent,
  registerPlan,
  requestFor,
  withGate,
} = require('./_lib/review-gate-fixture');

const VALID_COMMAND = Object.freeze({
  command: 'node tests/reviewer-contract-v2.test.js',
  outcome: 'PASS',
});

function rejectReviewEvent({ label, reason = 'MALFORMED_EVIDENCE', resultOptions = {}, eventOptions = {}, mutateEvent = null }) {
  withGate(({ gate, store }) => {
    const plan = makePlan();
    const registration = registerPlan(gate, plan, 'plan-registered-writer-a-residual');
    const obligation = plan.obligations[0];
    const options = {
      eventId: 'review-result-writer-a-residual',
      semanticVerdict: 'PASS',
      ...resultOptions,
      ...eventOptions,
    };
    const event = makeReviewEvent(
      plan,
      obligation,
      requestFor(registration, obligation),
      options,
    );
    if (mutateEvent) mutateEvent(event);

    const rejected = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event,
    });
    assert.strictEqual(rejected.decision.accepted, false, label);
    assert.strictEqual(rejected.decision.allowsProgress, false, label);
    assert.deepStrictEqual(rejected.decision.blockingReasons, [reason], label);
    assert.deepStrictEqual(rejected.receipts, [], label);
    assert.strictEqual(rejected.revision, registration.revision, label);
    assert.strictEqual(rejected.chainDigest, registration.chainDigest, label);

    const replayed = store.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
    });
    assert.strictEqual(replayed.revision, registration.revision, label);
    assert.strictEqual(replayed.chainDigest, registration.chainDigest, label);
    assert.deepStrictEqual(replayed.receipts, [], label);
    assert.deepStrictEqual(replayed.events.map(({ eventType }) => eventType), ['PLAN_REGISTERED'], label);
  });
}

function commandSummary(overrides = {}) {
  return { ...VALID_COMMAND, ...overrides };
}

test('review gate rejects an empty or overbound executed command list without appending', () => {
  const variants = [
    { label: 'empty command list', summaries: [] },
    { label: '33 command summaries', summaries: Array.from({ length: 33 }, () => commandSummary()) },
  ];
  for (const variant of variants) {
    rejectReviewEvent({
      label: variant.label,
      eventOptions: { executedCommands: variant.summaries },
    });
  }
});

test('review gate rejects a command summary missing command or outcome without appending', () => {
  const missingCommand = commandSummary();
  delete missingCommand.command;
  const missingOutcome = commandSummary();
  delete missingOutcome.outcome;
  for (const variant of [
    { label: 'missing command', summary: missingCommand },
    { label: 'missing outcome', summary: missingOutcome },
  ]) {
    rejectReviewEvent({
      label: variant.label,
      eventOptions: { executedCommands: [variant.summary] },
    });
  }
});

test('review gate rejects an unsupported command summary key without appending', () => {
  rejectReviewEvent({
    label: 'unsupported summary key',
    eventOptions: {
      executedCommands: [commandSummary({ unexpectedField: 'unsupported-command-field-writer-a' })],
    },
  });
});

test('review gate rejects blank, control-character, and oversized command text without appending', () => {
  const variants = [
    { label: 'blank command', command: '   ' },
    { label: 'control-character command', command: 'node\u0000tests/run-all.js' },
    { label: '513-character command', command: 'x'.repeat(513) },
  ];
  for (const variant of variants) {
    rejectReviewEvent({
      label: variant.label,
      eventOptions: { executedCommands: [commandSummary({ command: variant.command })] },
    });
  }
});

test('review gate rejects an unsupported command outcome without appending', () => {
  rejectReviewEvent({
    label: 'unsupported command outcome',
    eventOptions: { executedCommands: [commandSummary({ outcome: 'NOT_A_COMMAND_OUTCOME' })] },
  });
});

test('review gate rejects negative and unsafe command durations without appending', () => {
  const variants = [
    { label: 'negative duration', durationMs: -1 },
    { label: 'fractional duration', durationMs: 1.5 },
    { label: 'unsafe duration', durationMs: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const variant of variants) {
    rejectReviewEvent({
      label: variant.label,
      eventOptions: { executedCommands: [commandSummary({ durationMs: variant.durationMs })] },
    });
  }
});

test('review gate rejects invalid exit codes and accepts zero without appending invalid evidence', () => {
  const variants = [
    { label: 'negative exit code', exitCode: -1 },
    { label: 'fractional exit code', exitCode: 1.5 },
    { label: 'unsafe exit code', exitCode: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const variant of variants) {
    rejectReviewEvent({
      label: variant.label,
      eventOptions: { executedCommands: [commandSummary({ exitCode: variant.exitCode })] },
    });
  }

  withGate(({ gate, store }) => {
    const plan = makePlan();
    const registration = registerPlan(gate, plan, 'plan-registered-writer-a-exit-zero');
    const obligation = plan.obligations[0];
    const accepted = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(
        plan,
        obligation,
        requestFor(registration, obligation),
        {
          eventId: 'review-result-writer-a-exit-zero',
          semanticVerdict: 'PASS',
          executedCommands: [commandSummary({ exitCode: 0 })],
        },
      ),
    });
    assert.strictEqual(accepted.decision.accepted, true, 'zero is a valid command exit code');
    assert.strictEqual(accepted.decision.allowsProgress, true, 'a valid complete PASS resolves the planned obligation');
    assert.strictEqual(accepted.receipts.length, 1);
    assert.strictEqual(store.inspect({
      workId: plan.workId,
      waveId: plan.waveId,
      expectedRevision: accepted.revision,
      expectedChainDigest: accepted.chainDigest,
    }).receipts.length, 1);
  });
});

test('review gate rejects a non-string command reference without appending', () => {
  rejectReviewEvent({
    label: 'numeric command reference',
    eventOptions: { executedCommands: [commandSummary({ reference: 17 })] },
  });
});

test('review gate rejects more than 64 evidence references without appending', () => {
  const references = Array.from({ length: 65 }, (_, index) => 'artifact:review-writer-a-' + index);
  rejectReviewEvent({
    label: '65 evidence references',
    resultOptions: { evidenceReferences: references },
  });
});

test('review gate rejects an evidence reference longer than 512 characters without appending', () => {
  rejectReviewEvent({
    label: '513-character evidence reference',
    resultOptions: { evidenceReferences: ['artifact:' + 'x'.repeat(504)] },
  });
});

test('review gate rejects a complete required result without evidence references', () => {
  rejectReviewEvent({
    label: 'complete required result has no evidence',
    reason: 'MISSING_EVIDENCE',
    resultOptions: {
      executionStatus: 'COMPLETE',
      applicability: 'REQUIRED',
      evidenceReferences: [],
    },
  });
});

run('review-gate-evidence-residual-security');
