'use strict';

const { test, run, assert } = require('./_lib/tinytest');
const { createReviewRequest } = require('../scripts/lib/reviewer-contract');
const {
  INITIAL_RISK_POLICY,
  MATERIAL_RISK_SIGNALS,
  RiskRouter,
  SCOPE_KINDS,
  createWorkRecord,
  validateReviewPlan,
} = require('../scripts/lib/risk-router');

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const STABLE_ID = /^(work|decision|wave|review-plan|obligation)-[a-f0-9]{64}$/;

const deepFrozen = (value) => {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => (
    !child || typeof child !== 'object' || deepFrozen(child)
  ));
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const routineRequest = () => ({
  schemaVersion: 'dhpk.work-request.v1',
  requestId: 'github:issue:366',
  decisionKey: 'create-risk-router',
  scope: {
    paths: ['scripts/lib/risk-router.js'],
    kinds: ['SOURCE'],
    baseIdentity: {
      commit: '1111111111111111111111111111111111111111',
      tree: '2222222222222222222222222222222222222222',
    },
    headIdentity: {
      commit: '3333333333333333333333333333333333333333',
      tree: '4444444444444444444444444444444444444444',
    },
    diff: {
      digest: `sha256:${'5'.repeat(64)}`,
      reference: 'git-diff:issue-366',
    },
  },
  ownership: {
    judgmentOwner: 'architect',
    implementationOwner: 'worker:issue-366',
  },
  materialRisks: [],
  governingInputs: [{
    reference: 'docs/adr/0012-route-work-by-named-material-risk.md',
    digest: `sha256:${'6'.repeat(64)}`,
  }],
  outcomeReferences: [{ kind: 'ISSUE', reference: 'github:issue:366' }],
  observations: {
    fileCount: 1,
    lineCount: 0,
    taskCount: 1,
    availableAgentCount: 6,
  },
  extensions: {},
});

test('a bounded routine request produces one stable immutable code-review plan', () => {
  const input = routineRequest();
  const before = JSON.stringify(input);
  const record = createWorkRecord(input);
  const repeatedRecord = createWorkRecord(routineRequest());
  const router = new RiskRouter();
  const plan = router.plan(record, INITIAL_RISK_POLICY);
  const repeatedPlan = router.plan(repeatedRecord, INITIAL_RISK_POLICY);

  assert.strictEqual(JSON.stringify(input), before, 'the caller input must remain unchanged');
  assert.deepStrictEqual(record, repeatedRecord);
  assert.deepStrictEqual(plan, repeatedPlan);
  assert.ok(deepFrozen(record), 'the Work Record must be deeply frozen');
  assert.ok(deepFrozen(plan), 'the Review Plan must be deeply frozen');
  assert.strictEqual(record.workId, 'work-3c67f4c8324fb1bc3cfc124def01ac89b1562d1d2376b1b298839f9510ad344c');
  assert.strictEqual(record.decisionId, 'decision-2e7b79da1a5297bf4cf4f13ee0483a98762fe629a9b956d0cc143e88ecc7f714');
  assert.match(record.workId, STABLE_ID);
  assert.match(record.decisionId, STABLE_ID);
  assert.match(record.waveId, STABLE_ID);
  assert.deepStrictEqual(record.scope.paths, input.scope.paths);
  assert.deepStrictEqual(record.ownership, input.ownership);
  assert.deepStrictEqual(record.materialRisks, []);
  assert.deepStrictEqual(record.outcomeReferences, input.outcomeReferences);
  assert.match(record.scope.digest, SHA256);

  assert.strictEqual(plan.policyVersion, 'dhpk.risk-policy.initial.v1');
  assert.strictEqual(plan.applicability, 'REQUIRED');
  assert.match(plan.planId, STABLE_ID);
  assert.strictEqual(plan.obligations.length, 1);
  assert.deepStrictEqual({
    kind: plan.obligations[0].kind,
    lane: plan.obligations[0].lane,
    applicability: plan.obligations[0].applicability,
    reasonSignals: plan.obligations[0].reasonSignals,
  }, {
    kind: 'SEMANTIC_REVIEW',
    lane: 'code-reviewer',
    applicability: 'REQUIRED',
    reasonSignals: [],
  });
  assert.match(plan.obligations[0].obligationId, STABLE_ID);
});

test('an exact empty diff is not applicable and inconsistent empty evidence fails closed', () => {
  const emptyRequest = routineRequest();
  emptyRequest.scope.paths = [];
  emptyRequest.scope.kinds = [];
  emptyRequest.scope.headIdentity.tree = emptyRequest.scope.baseIdentity.tree;
  emptyRequest.scope.diff.digest = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const plan = new RiskRouter().plan(createWorkRecord(emptyRequest), INITIAL_RISK_POLICY);
  assert.strictEqual(plan.applicability, 'NOT_APPLICABLE');
  assert.deepStrictEqual(plan.obligations, []);
  assert.deepStrictEqual(plan.reasonCodes, ['EMPTY_DIFF']);
  assert.strictEqual(Object.hasOwn(plan, 'semanticVerdict'), false);

  const mismatchedTree = routineRequest();
  mismatchedTree.scope.paths = [];
  mismatchedTree.scope.kinds = [];
  mismatchedTree.scope.diff.digest = emptyRequest.scope.diff.digest;
  assert.throws(() => createWorkRecord(mismatchedTree), /empty diff/i);

  const mismatchedDigest = routineRequest();
  mismatchedDigest.scope.paths = [];
  mismatchedDigest.scope.kinds = [];
  mismatchedDigest.scope.headIdentity.tree = mismatchedDigest.scope.baseIdentity.tree;
  assert.throws(() => createWorkRecord(mismatchedDigest), /empty diff/i);
});

test('named risks and scope kinds select deterministic specialist lanes', () => {
  assert.deepStrictEqual(MATERIAL_RISK_SIGNALS, [
    'BEHAVIOR_CHANGE', 'PUBLIC_CONTRACT', 'ARCHITECTURE_CHANGE', 'CROSS_MODULE', 'MULTI_WAVE',
    'IRREVERSIBLE_ACTION', 'EXTERNAL_ACTION', 'SECURITY', 'PRIVACY', 'AUTHENTICATION', 'MONEY',
    'DATABASE', 'SCHEMA', 'MIGRATION', 'RELEASE', 'COMPATIBILITY', 'CROSS_DOMAIN', 'SHARED_STATE',
    'MULTI_WRITER', 'HIGH_UNCERTAINTY', 'UNKNOWN_ROOT_CAUSE', 'FAILED_VERIFICATION',
  ]);
  assert.deepStrictEqual(SCOPE_KINDS, ['SOURCE', 'FRONTEND', 'DATABASE', 'MIGRATION', 'DOCUMENTATION']);

  const cases = [
    { kinds: ['SOURCE'], risks: [], lanes: ['code-reviewer'] },
    { kinds: ['FRONTEND'], risks: [], lanes: ['code-reviewer', 'frontend-reviewer'] },
    { kinds: ['DATABASE'], risks: [], lanes: ['code-reviewer', 'database-reviewer'] },
    { kinds: ['MIGRATION'], risks: [], lanes: ['code-reviewer', 'database-reviewer', 'migration-reviewer'] },
    { kinds: ['DOCUMENTATION'], risks: [], lanes: ['doc-reviewer'] },
    { kinds: ['SOURCE'], risks: ['SECURITY'], lanes: ['code-reviewer', 'security-reviewer'] },
    { kinds: ['SOURCE'], risks: ['SCHEMA'], lanes: ['code-reviewer', 'database-reviewer', 'migration-reviewer'] },
    { kinds: ['DOCUMENTATION'], risks: ['MONEY'], lanes: ['security-reviewer', 'doc-reviewer'] },
  ];

  for (const item of cases) {
    const request = routineRequest();
    request.scope.kinds = item.kinds;
    request.materialRisks = item.risks;
    const plan = new RiskRouter().plan(createWorkRecord(request), INITIAL_RISK_POLICY);
    assert.deepStrictEqual(plan.obligations.map(({ lane }) => lane), item.lanes);
  }
});

test('counts are observations and cannot change identities, routing, or obligations', () => {
  const baselineRequest = routineRequest();
  baselineRequest.materialRisks = ['BEHAVIOR_CHANGE', 'MULTI_WAVE'];
  const largeRequest = routineRequest();
  largeRequest.materialRisks = ['MULTI_WAVE', 'BEHAVIOR_CHANGE', 'MULTI_WAVE'];
  largeRequest.scope.paths = ['z.js', 'scripts/lib/risk-router.js', 'z.js'];
  baselineRequest.scope.paths = ['scripts/lib/risk-router.js', 'z.js'];
  largeRequest.observations = {
    fileCount: Number.MAX_SAFE_INTEGER,
    lineCount: Number.MAX_SAFE_INTEGER,
    taskCount: Number.MAX_SAFE_INTEGER,
    availableAgentCount: 0,
  };

  const baseline = createWorkRecord(baselineRequest);
  const large = createWorkRecord(largeRequest);
  assert.strictEqual(baseline.workId, large.workId);
  assert.strictEqual(baseline.decisionId, large.decisionId);
  assert.strictEqual(baseline.waveId, large.waveId);
  assert.deepStrictEqual(baseline.scope.paths, large.scope.paths);
  assert.deepStrictEqual(baseline.materialRisks, large.materialRisks);

  const router = new RiskRouter();
  assert.deepStrictEqual(router.plan(baseline, INITIAL_RISK_POLICY), router.plan(large, INITIAL_RISK_POLICY));
});

test('contract versions, vocabularies, and the registered policy fail closed', () => {
  const invalidVersion = routineRequest();
  invalidVersion.schemaVersion = 'dhpk.work-request.v2';
  assert.throws(() => createWorkRecord(invalidVersion), /schemaVersion/);

  const invalidRisk = routineRequest();
  invalidRisk.materialRisks = ['LOW_SCORE'];
  assert.throws(() => createWorkRecord(invalidRisk), /unknown value LOW_SCORE/);

  const invalidKind = routineRequest();
  invalidKind.scope.kinds = ['TEST_COUNT'];
  assert.throws(() => createWorkRecord(invalidKind), /unknown value TEST_COUNT/);

  const record = createWorkRecord(routineRequest());
  const router = new RiskRouter();
  assert.throws(
    () => router.plan({ ...record, schemaVersion: 'dhpk.work-record.v2' }, INITIAL_RISK_POLICY),
    /workRecord\.schemaVersion/
  );
  assert.throws(
    () => router.plan(record, { ...INITIAL_RISK_POLICY, scopeLanes: {} }),
    /registered dhpk\.risk-policy\.initial\.v1 policy/
  );
  assert.throws(
    () => router.plan({ ...record, materialRisks: ['LOW_SCORE'] }, INITIAL_RISK_POLICY),
    /materialRisks/
  );
});

test('compatible JSON extensions survive routing without affecting v1 decisions', () => {
  const baseline = routineRequest();
  const extended = routineRequest();
  extended.extensions = {
    future: {
      labels: ['alpha', 'beta'],
      evidence: { enabled: true },
    },
  };

  const baselineRecord = createWorkRecord(baseline);
  const extendedRecord = createWorkRecord(extended);
  const router = new RiskRouter();
  const baselinePlan = router.plan(baselineRecord, INITIAL_RISK_POLICY);
  const extendedPlan = router.plan(extendedRecord, INITIAL_RISK_POLICY);

  assert.strictEqual(extendedRecord.decisionId, baselineRecord.decisionId);
  assert.strictEqual(extendedRecord.waveId, baselineRecord.waveId);
  assert.strictEqual(extendedPlan.planId, baselinePlan.planId);
  assert.deepStrictEqual(extendedPlan.obligations, baselinePlan.obligations);
  assert.deepStrictEqual(extendedPlan.extensions, extended.extensions);
  assert.ok(deepFrozen(extendedPlan.extensions));

  extended.extensions.future.labels.push('caller-only');
  assert.deepStrictEqual(extendedPlan.extensions.future.labels, ['alpha', 'beta']);
  assert.throws(() => createWorkRecord({ ...routineRequest(), extensions: 'not-json-object' }), /extensions/);
  assert.throws(() => createWorkRecord({
    ...routineRequest(),
    extensions: { callback: () => 'not-json' },
  }), /extensions/);
});

test('obligations retain their named reasons and populate Reviewer Contract v2 requests', () => {
  const request = routineRequest();
  request.materialRisks = [...MATERIAL_RISK_SIGNALS].reverse();
  const plan = new RiskRouter().plan(createWorkRecord(request), INITIAL_RISK_POLICY);
  const byLane = Object.fromEntries(plan.obligations.map((obligation) => [obligation.lane, obligation]));

  assert.deepStrictEqual(byLane['security-reviewer'].reasonSignals, [
    'SECURITY', 'PRIVACY', 'AUTHENTICATION', 'MONEY',
  ]);
  assert.deepStrictEqual(byLane['database-reviewer'].reasonSignals, ['DATABASE', 'SCHEMA', 'MIGRATION']);
  assert.deepStrictEqual(byLane['migration-reviewer'].reasonSignals, ['SCHEMA', 'MIGRATION']);
  assert.deepStrictEqual(byLane['code-reviewer'].reasonSignals, [
    'BEHAVIOR_CHANGE', 'PUBLIC_CONTRACT', 'ARCHITECTURE_CHANGE', 'CROSS_MODULE', 'MULTI_WAVE',
    'IRREVERSIBLE_ACTION', 'EXTERNAL_ACTION', 'RELEASE', 'COMPATIBILITY', 'CROSS_DOMAIN',
    'SHARED_STATE', 'MULTI_WRITER', 'HIGH_UNCERTAINTY', 'UNKNOWN_ROOT_CAUSE', 'FAILED_VERIFICATION',
  ]);

  for (const obligation of plan.obligations) {
    const reviewRequest = createReviewRequest({
      decisionId: plan.decisionId,
      waveId: plan.waveId,
      obligationId: obligation.obligationId,
      lane: obligation.lane,
      scope: plan.scope,
      baseIdentity: plan.baseIdentity,
      headIdentity: plan.headIdentity,
      diff: plan.diff,
      materialRisks: plan.materialRisks,
      governingInputs: plan.governingInputs,
      exclusions: [],
      priorFindings: [],
      contractVersion: plan.contractVersion,
    });
    assert.strictEqual(reviewRequest.obligationId, obligation.obligationId);
  }
});

test('durable Work Records revalidate stable identities and canonical scope before planning', () => {
  const record = createWorkRecord(routineRequest());
  const durableRecord = JSON.parse(JSON.stringify(record));
  const router = new RiskRouter();
  assert.deepStrictEqual(
    router.plan(durableRecord, INITIAL_RISK_POLICY),
    router.plan(record, INITIAL_RISK_POLICY)
  );

  const tamperedDecision = JSON.parse(JSON.stringify(record));
  tamperedDecision.decisionId = `decision-${'0'.repeat(64)}`;
  assert.throws(() => router.plan(tamperedDecision, INITIAL_RISK_POLICY), /decisionId|canonical Work Record/);

  const tamperedScope = JSON.parse(JSON.stringify(record));
  tamperedScope.scope.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => router.plan(tamperedScope, INITIAL_RISK_POLICY), /scope\.digest|canonical Work Record/);

  const tamperedEmpty = JSON.parse(JSON.stringify(record));
  tamperedEmpty.scope.paths = [];
  tamperedEmpty.scope.kinds = [];
  assert.throws(() => router.plan(tamperedEmpty, INITIAL_RISK_POLICY), /empty diff|canonical Work Record/);
});

test('validateReviewPlan returns an immutable canonical clone for a genuine plan', () => {
  const plan = new RiskRouter().plan(createWorkRecord(routineRequest()), INITIAL_RISK_POLICY);
  const durablePlan = cloneJson(plan);

  const validated = validateReviewPlan(durablePlan);

  assert.deepStrictEqual(validated, plan);
  assert.notStrictEqual(validated, durablePlan);
  assert.ok(deepFrozen(validated), 'the validated Review Plan must be deeply frozen');
});

test('validateReviewPlan fails closed for altered scope, identity, reasons, obligations, and empty diffs', () => {
  const plan = new RiskRouter().plan(createWorkRecord(routineRequest()), INITIAL_RISK_POLICY);
  const multiPlanRequest = routineRequest();
  multiPlanRequest.materialRisks = ['SECURITY'];
  const multiPlan = new RiskRouter().plan(
    createWorkRecord(multiPlanRequest),
    INITIAL_RISK_POLICY,
  );
  const emptyRequest = routineRequest();
  emptyRequest.scope.paths = [];
  emptyRequest.scope.kinds = [];
  emptyRequest.scope.headIdentity.tree = emptyRequest.scope.baseIdentity.tree;
  emptyRequest.scope.diff.digest = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const emptyPlan = new RiskRouter().plan(createWorkRecord(emptyRequest), INITIAL_RISK_POLICY);

  const invalidPlans = [
    ['changed scope kinds', plan, (candidate) => { candidate.scope.kinds = ['FRONTEND']; }],
    ['wrong planId', plan, (candidate) => { candidate.planId = `review-plan-${'0'.repeat(64)}`; }],
    ['wrong scope digest', plan, (candidate) => { candidate.scope.digest = `sha256:${'0'.repeat(64)}`; }],
    ['wrong reasons', plan, (candidate) => { candidate.obligations[0].reasonSignals = ['SECURITY']; }],
    ['wrong identity', plan, (candidate) => { candidate.headIdentity.tree = '0'.repeat(40); }],
    ['injected obligation', plan, (candidate) => {
      candidate.obligations.push({ ...candidate.obligations[0], obligationId: `obligation-${'f'.repeat(64)}` });
    }],
    ['removed obligation', plan, (candidate) => { candidate.obligations.pop(); }],
    ['reordered obligations', multiPlan, (candidate) => { candidate.obligations.reverse(); }],
    ['altered obligation', plan, (candidate) => { candidate.obligations[0].lane = 'security-reviewer'; }],
    ['malformed empty diff', emptyPlan, (candidate) => { candidate.reasonCodes = []; }],
  ];

  for (const [label, source, mutate] of invalidPlans) {
    const candidate = cloneJson(source);
    mutate(candidate);
    assert.throws(
      () => validateReviewPlan(candidate),
      /Review Plan|canonical|obligation|scope|identity|empty diff/i,
      `${label} must fail closed`,
    );
  }
});

test('untrusted paths, observations, references, and extensions stay bounded', () => {
  for (const invalidPath of ['/outside.js', '../outside.js', 'dir\\outside.js']) {
    const request = routineRequest();
    request.scope.paths = [invalidPath];
    assert.throws(() => createWorkRecord(request), /repository-relative path/);
  }

  for (const invalidCount of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    const request = routineRequest();
    request.observations.fileCount = invalidCount;
    assert.throws(() => createWorkRecord(request), /observations\.fileCount/);
  }

  const invalidReference = routineRequest();
  invalidReference.governingInputs[0].digest = 'not-a-digest';
  assert.throws(() => createWorkRecord(invalidReference), /governingInputs\[0\]\.digest/);

  const invalidGit = routineRequest();
  invalidGit.scope.baseIdentity.commit = 'not-a-commit';
  assert.throws(() => createWorkRecord(invalidGit), /scope\.baseIdentity\.commit/);

  const dated = routineRequest();
  dated.extensions = { when: new Date(0) };
  assert.throws(() => createWorkRecord(dated), /plain JSON objects/);

  const symbolKey = routineRequest();
  symbolKey.extensions = { valid: true };
  symbolKey.extensions[Symbol('hidden')] = 'value';
  assert.throws(() => createWorkRecord(symbolKey), /symbol keys/);

  const cyclic = routineRequest();
  cyclic.extensions = {};
  cyclic.extensions.self = cyclic.extensions;
  assert.throws(() => createWorkRecord(cyclic), /cycles/);

  const tooDeep = routineRequest();
  tooDeep.extensions = {};
  let cursor = tooDeep.extensions;
  for (let depth = 0; depth < 14; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(() => createWorkRecord(tooDeep), /12 nested levels/);

  const tooLarge = routineRequest();
  tooLarge.extensions = { text: 'x'.repeat(65536) };
  assert.throws(() => createWorkRecord(tooLarge), /65536 canonical JSON bytes/);
});

run('risk-router');
