'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const {
  AUTHORITY_TRUST_POLICY,
  makeAuthorityEvent,
  makeAuthorityReceipt,
  makePlan,
  makeReviewEvent,
  registerPlan,
  requestFor,
  withGate,
} = require('./_lib/review-gate-fixture');

test('a security authority override resolves beside code PASS without inventing a semantic PASS', () => {
  withGate(({ gate }) => {
    const plan = makePlan({ materialRisks: ['BEHAVIOR_CHANGE', 'SECURITY'] });
    const registration = registerPlan(gate, plan, 'plan-registered-authority-semantic-neutrality');
    const code = plan.obligations.find(({ lane }) => lane === 'code-reviewer');
    const security = plan.obligations.find(({ lane }) => lane === 'security-reviewer');
    const codePass = gate.handle({
      expectedRevision: registration.revision,
      expectedChainDigest: registration.chainDigest,
      event: makeReviewEvent(plan, code, requestFor(registration, code), {
        eventId: 'review-result-authority-semantic-code-pass',
        semanticVerdict: 'PASS',
      }),
    });
    const receipt = makeAuthorityReceipt(plan, {
      obligation: security,
      eventId: 'authority-semantic-security',
    });
    const authority = gate.handle({
      expectedRevision: codePass.revision,
      expectedChainDigest: codePass.chainDigest,
      event: makeAuthorityEvent(plan, {
        obligation: security,
        receipt,
        eventId: 'authority-semantic-security',
      }),
    });

    assert.strictEqual(authority.decision.accepted, true);
    assert.strictEqual(authority.decision.allowsProgress, true);
    assert.strictEqual(authority.decision.lifecycleStatus, 'RESOLVED');
    assert.strictEqual(authority.decision.resolution, 'AUTHORITY_OVERRIDE');
    assert.strictEqual(authority.decision.semanticVerdict, undefined);
  }, { trustPolicy: AUTHORITY_TRUST_POLICY });
});

run('review-gate-authority-semantics');
