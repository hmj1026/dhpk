'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const {
  REVIEWER_CONTRACT_VERSION,
  REVIEW_REQUEST_FIELDS,
  EXECUTION_STATUSES,
  APPLICABILITIES,
  SEMANTIC_VERDICTS,
  FINDING_SEVERITIES,
  FINDING_DISPOSITIONS,
  createReviewRequest,
  createFinding,
  createReviewResult,
  mapLegacyReviewResult,
} = require('../scripts/lib/reviewer-contract');

const ROOT = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'review-gate', 'reviewer-contract-v2.json'),
  'utf8'
));

const deepFrozen = (value) => {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => (
    !child || typeof child !== 'object' || deepFrozen(child)
  ));
};

const hydrateResult = (name) => ({
  ...fixture.results[name],
  findings: fixture.results[name].findings.map((findingName) => fixture.findings[findingName]),
});

test('v2 creates an immutable fully bound Review Request without mutating its input', () => {
  const input = { ...fixture.request, contractVersion: fixture.contractVersion };
  const before = JSON.stringify(input);
  const request = createReviewRequest(input);

  assert.strictEqual(REVIEWER_CONTRACT_VERSION, fixture.contractVersion);
  assert.deepStrictEqual(REVIEW_REQUEST_FIELDS, [
    'decisionId', 'waveId', 'obligationId', 'lane', 'scope', 'baseIdentity',
    'headIdentity', 'diff', 'materialRisks', 'governingInputs', 'exclusions',
    'priorFindings', 'contractVersion',
  ]);
  assert.deepStrictEqual(request, input);
  assert.notStrictEqual(request, input);
  assert.strictEqual(JSON.stringify(input), before);
  assert.ok(deepFrozen(request), 'Review Request must be deeply frozen');
  assert.strictEqual(Object.isFrozen(input.scope), false, 'caller input must not be frozen');
  input.scope.paths.push('caller-only-change.md');
  assert.doesNotMatch(JSON.stringify(request), /caller-only-change/);

  for (const field of REVIEW_REQUEST_FIELDS) {
    const invalid = { ...input };
    delete invalid[field];
    assert.throws(() => createReviewRequest(invalid), new RegExp(field));
  }
  assert.throws(
    () => createReviewRequest({ ...input, contractVersion: 'dhpk.reviewer-contract.v3' }),
    /contractVersion/
  );
  for (const [field, value, expected] of [
    ['scope', {}, /scope\.paths/],
    ['baseIdentity', {}, /baseIdentity\.commit/],
    ['headIdentity', {}, /headIdentity\.commit/],
    ['diff', {}, /diff\.digest/],
  ]) {
    assert.throws(() => createReviewRequest({ ...input, [field]: value }), expected);
  }
});

test('v2 validates finding severity independently from workflow disposition', () => {
  assert.deepStrictEqual(FINDING_SEVERITIES, ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
  assert.deepStrictEqual(FINDING_DISPOSITIONS, ['MUST_FIX', 'FOLLOW_UP', 'NOTE']);

  for (const finding of Object.values(fixture.findings)) {
    const before = JSON.stringify(finding);
    const created = createFinding(finding);
    assert.ok(deepFrozen(created));
    assert.strictEqual(JSON.stringify(finding), before);
    assert.notStrictEqual(created.evidence, finding.evidence);
  }
  assert.throws(
    () => createFinding({ ...fixture.findings.mustFix, severity: 'URGENT' }),
    /severity/
  );
  assert.throws(
    () => createFinding({ ...fixture.findings.mustFix, disposition: 'NOTE' }),
    /disposition/
  );
  assert.throws(
    () => createFinding({ ...fixture.findings.followUp, decisionReceipt: undefined }),
    /decisionReceipt/
  );
  assert.throws(
    () => createFinding({ ...fixture.findings.followUp, disposition: 'NOTE' }),
    /MEDIUM findings cannot be NOTE/
  );
  const missingDisposition = { ...fixture.findings.followUp };
  delete missingDisposition.disposition;
  assert.throws(() => createFinding(missingDisposition), /disposition/);
});

test('v2 keeps execution, applicability, and semantic verdict axes distinct', () => {
  assert.deepStrictEqual(EXECUTION_STATUSES, ['COMPLETE', 'NOT_RUN', 'INTERRUPTED', 'UNAVAILABLE']);
  assert.deepStrictEqual(APPLICABILITIES, ['REQUIRED', 'NOT_APPLICABLE']);
  assert.deepStrictEqual(SEMANTIC_VERDICTS, ['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);

  for (const name of Object.keys(fixture.results)) {
    const input = hydrateResult(name);
    const before = JSON.stringify(input);
    const result = createReviewResult(input);
    assert.ok(deepFrozen(result), `${name} result must be deeply frozen`);
    assert.strictEqual(result.executionStatus, fixture.results[name].executionStatus);
    assert.strictEqual(result.applicability, fixture.results[name].applicability);
    assert.strictEqual(result.findings.length, fixture.results[name].findings.length);
    assert.strictEqual(JSON.stringify(input), before);
    assert.notStrictEqual(result.findings, input.findings);
  }
  assert.strictEqual(createReviewResult(hydrateResult('notApplicable')).semanticVerdict, undefined);
  assert.strictEqual(createReviewResult(hydrateResult('unavailable')).semanticVerdict, undefined);
  assert.strictEqual(createReviewResult(hydrateResult('interrupted')).semanticVerdict, undefined);
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), executionStatus: 'NOT_RUN' }),
    /semanticVerdict/
  );
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), applicability: 'NOT_APPLICABLE' }),
    /semanticVerdict/
  );
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), semanticVerdict: undefined }),
    /semanticVerdict/
  );
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), semanticVerdict: 'FAIL' }),
    /semanticVerdict/
  );
  assert.throws(
    () => createReviewResult({
      ...hydrateResult('pass'),
      findings: [fixture.findings.mustFix],
    }),
    /PASS cannot include a MUST_FIX/
  );
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), executionStatus: 'SKIPPED' }),
    /executionStatus/
  );
  assert.throws(
    () => createReviewResult({ ...hydrateResult('pass'), applicability: 'OPTIONAL' }),
    /applicability/
  );
});

test('legacy mappings are observations and never synthesize approval or Sentinel clearance', () => {
  for (const mapping of fixture.legacyMappings) {
    const findings = mapping.legacyVerdict === 'WARNING' ? [fixture.findings.mustFix] : [];
    const result = mapLegacyReviewResult({
      ...hydrateResult('pass'),
      legacyVerdict: mapping.legacyVerdict,
      findings,
    });
    assert.strictEqual(result.semanticVerdict, mapping.semanticVerdict);
    assert.strictEqual(result.kind, 'MIGRATION_OBSERVATION');
    assert.strictEqual(result.authorizesApproval, false);
    assert.strictEqual(result.clearsSentinel, false);
    assert.ok(deepFrozen(result));
  }

  const followUpWarning = mapLegacyReviewResult({
    ...hydrateResult('pass'),
    legacyVerdict: 'WARNING',
    findings: [fixture.findings.note],
  });
  assert.strictEqual(followUpWarning.semanticVerdict, 'PASS');

  const unavailable = mapLegacyReviewResult({
    ...hydrateResult('unavailable'),
    legacyVerdict: null,
  });
  assert.strictEqual(unavailable.semanticVerdict, undefined);
  assert.strictEqual(unavailable.authorizesApproval, false);

  const interrupted = mapLegacyReviewResult({
    ...hydrateResult('interrupted'),
    legacyVerdict: 'PASS',
  });
  assert.strictEqual(interrupted.executionStatus, 'INTERRUPTED');
  assert.strictEqual(interrupted.semanticVerdict, undefined);

  const missingVerdict = mapLegacyReviewResult({
    ...hydrateResult('pass'),
    legacyVerdict: null,
  });
  assert.strictEqual(missingVerdict.executionStatus, 'NOT_RUN');
  assert.strictEqual(missingVerdict.semanticVerdict, undefined);

  const missingDisposition = { ...fixture.findings.mustFix };
  delete missingDisposition.disposition;
  const malformedWarning = mapLegacyReviewResult({
    ...hydrateResult('pass'),
    legacyVerdict: 'WARNING',
    findings: [missingDisposition],
  });
  assert.strictEqual(malformedWarning.semanticVerdict, 'CHANGES_REQUIRED');
  assert.match(malformedWarning.mappingDiagnostics.join('\n'), /missing finding disposition/);

  for (const legacyVerdict of ['APPROVE', 'PASS', 'BLOCK', 'FAIL']) {
    const malformed = mapLegacyReviewResult({
      ...hydrateResult('pass'),
      legacyVerdict,
      findings: [missingDisposition],
    });
    assert.strictEqual(malformed.executionStatus, 'INTERRUPTED');
    assert.strictEqual(malformed.semanticVerdict, undefined);
    assert.deepStrictEqual(malformed.findings, []);
    assert.match(malformed.mappingDiagnostics.join('\n'), /malformed legacy findings/);
    assert.strictEqual(malformed.authorizesApproval, false);
    assert.strictEqual(malformed.clearsSentinel, false);
  }

  const malformedFindingsCollection = mapLegacyReviewResult({
    ...hydrateResult('pass'),
    legacyVerdict: 'PASS',
    findings: 'not-an-array',
  });
  assert.strictEqual(malformedFindingsCollection.executionStatus, 'INTERRUPTED');
  assert.strictEqual(malformedFindingsCollection.semanticVerdict, undefined);
  assert.deepStrictEqual(malformedFindingsCollection.findings, []);

  assert.throws(
    () => mapLegacyReviewResult({ ...hydrateResult('pass'), legacyVerdict: 'ACCEPT' }),
    /legacyVerdict/
  );
});

test('canonical and projected reviewer definitions conform to the same v2 fixture', () => {
  const contractPaths = [
    'docs/contracts/reviewer-contract.md',
    'codex/supporting/contracts/reviewer-contract.md',
    'cursor/dhpk/contracts/reviewer-contract.md',
  ];
  const requiredTokens = [
    fixture.contractVersion,
    ...REVIEW_REQUEST_FIELDS,
    ...EXECUTION_STATUSES,
    ...APPLICABILITIES,
    ...SEMANTIC_VERDICTS,
    ...FINDING_SEVERITIES,
    ...FINDING_DISPOSITIONS,
    ...fixture.legacyMappings.map(({ legacyVerdict }) => legacyVerdict),
    'read-only',
    'findings-first',
    'chain-of-thought',
    'full inputs',
    'new approval',
  ];
  for (const relativePath of contractPaths) {
    const text = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const token of requiredTokens) {
      assert.ok(text.includes(token), `${relativePath} missing v2 conformance token ${token}`);
    }
  }

  const reviewerVocabularies = {
    'code-reviewer': ['APPROVE', 'WARNING', 'BLOCK'],
    'database-reviewer': ['PASS', 'WARNING', 'FAIL'],
    'security-reviewer': ['PASS', 'WARNING', 'FAIL'],
    'frontend-reviewer': ['APPROVE', 'WARNING', 'BLOCK'],
    'doc-reviewer': ['APPROVE', 'WARNING', 'BLOCK'],
    'migration-reviewer': ['PASS', 'WARNING', 'FAIL'],
  };
  const mappedLegacyVerdicts = new Set(fixture.legacyMappings.map(({ legacyVerdict }) => legacyVerdict));
  for (const [reviewer, vocabulary] of Object.entries(reviewerVocabularies)) {
    const definitions = [
      [`agents/${reviewer}.md`, 'docs/contracts/reviewer-contract.md'],
      [`codex/agents/${reviewer}.toml`, '.codex/dhpk/contracts/reviewer-contract.md'],
      [`cursor/agents/${reviewer}.md`, 'docs/contracts/reviewer-contract.md'],
    ];
    for (const [relativePath, contractReference] of definitions) {
      const text = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
      assert.ok(text.includes(contractReference), `${relativePath} missing contract reference`);
      for (const verdict of vocabulary) {
        assert.ok(mappedLegacyVerdicts.has(verdict), `${relativePath} has unmapped legacy verdict ${verdict}`);
        assert.ok(text.includes(verdict), `${relativePath} missing declared legacy verdict ${verdict}`);
      }
    }
  }
});

run('reviewer-contract-v2');
