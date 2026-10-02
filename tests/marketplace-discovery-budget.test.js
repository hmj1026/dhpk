'use strict';

// Rendered discovery-budget contract (task 6.7, A5 structural slice).
// Every expected value below is an independent literal; nothing is computed
// through a production helper.

const { test, run, assert } = require('./_lib/tinytest');
const discoveryBudget = require('../scripts/lib/discovery-budget');

const { evaluateRenderedDiscoveryBudget } = discoveryBudget;

const PLAN = 'plan-fp-0001';
const SELECTION = 'selection-fp-0001';
const ARTIFACT = 'artifact-fp-0001';

function fullCoverage() {
  return {
    names: true,
    descriptions: true,
    filePaths: true,
    hostMetadata: 'included',
    hostOverhead: 'included',
  };
}

function tokenEstimator() {
  return {
    id: 'codex-host-tokenizer',
    version: '2026-10-01',
    unit: 'tokens',
    kind: 'observed',
    documentation: 'https://example.invalid/codex/skills#tokenizer',
  };
}

function characterEstimator() {
  return {
    id: 'unicode-codepoint-counter',
    version: '1',
    unit: 'characters',
    kind: 'estimated',
    documentation: 'Array.from(renderedText).length over the full rendered list',
  };
}

// Fresh, valid, token-unit Codex baseline with a known 100000-token context.
function codexTokenInput({ full = 1500, plugin = 300 } = {}) {
  return {
    scope: { host: 'codex', hostVersion: '0.50.0', profile: 'default', consumer: 'clean' },
    identity: {
      planFingerprint: PLAN,
      selectionFingerprint: SELECTION,
      artifactFingerprint: ARTIFACT,
      selectedStableIds: ['skill.alpha', 'skill.beta'],
    },
    model: { id: 'gpt-6-sol', contextWindowTokens: 100000 },
    budget: { policy: 'codex-skill-list', version: '2026-10-01' },
    measurement: {
      identity: { planFingerprint: PLAN, selectionFingerprint: SELECTION, artifactFingerprint: ARTIFACT },
      estimator: tokenEstimator(),
      coverage: fullCoverage(),
      fullConsumer: {
        renderedText: '- alpha: does alpha (skills/alpha/SKILL.md)\n- beta: does beta (skills/beta/SKILL.md)\n- other: third-party (other/SKILL.md)',
        stableIds: ['skill.alpha', 'skill.beta', 'other.gamma'],
        value: full,
      },
      pluginContribution: {
        renderedText: '- alpha: does alpha (skills/alpha/SKILL.md)\n- beta: does beta (skills/beta/SKILL.md)',
        stableIds: ['skill.alpha', 'skill.beta'],
        value: plugin,
      },
    },
  };
}

// Fresh, valid, character-unit Codex baseline with an unknown model context.
function codexCharacterInput({ fullText = 'a'.repeat(7000), pluginText = 'a'.repeat(100) } = {}) {
  const input = codexTokenInput();
  input.model = { id: 'gpt-6-sol', contextWindowTokens: null };
  input.measurement.estimator = characterEstimator();
  input.measurement.fullConsumer = { renderedText: fullText, stableIds: ['skill.alpha', 'skill.beta', 'other.gamma'] };
  input.measurement.pluginContribution = { renderedText: pluginText, stableIds: ['skill.alpha', 'skill.beta'] };
  return input;
}

function cursorInput() {
  const input = codexCharacterInput();
  input.scope = { host: 'cursor', hostVersion: '1.7.0', profile: 'default', consumer: 'coexistence' };
  input.model = { id: 'cursor-default', contextWindowTokens: 200000 };
  input.budget = { policy: 'configured', version: '2026-09-15', unit: 'characters', limit: 12000 };
  return input;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function codes(report) {
  return report.configurationErrors.map((error) => error.code);
}

function assertNotConfigured(report, ...acceptedCodes) {
  const actual = codes(report);
  assert.ok(
    acceptedCodes.some((code) => actual.includes(code)),
    `expected one of ${acceptedCodes.join('|')}, got ${JSON.stringify(actual)}`,
  );
  assert.strictEqual(report.evidence.verdict, 'NOT_CONFIGURED');
  assert.strictEqual(report.ok, false);
  assert.deepStrictEqual(report.violations, []);
}

function assertPass(report) {
  assert.deepStrictEqual(report.configurationErrors, []);
  assert.deepStrictEqual(report.violations, []);
  assert.strictEqual(report.evidence.verdict, 'PASS');
  assert.strictEqual(report.ok, true);
}

function assertSingleOverflow(report) {
  assert.deepStrictEqual(report.configurationErrors, []);
  assert.strictEqual(report.violations.length, 1);
  assert.strictEqual(report.violations[0].code, 'FULL_CONSUMER_BUDGET_EXCEEDED');
  assert.strictEqual(report.evidence.verdict, 'FAIL');
  assert.strictEqual(report.ok, false);
}

// --- export surface -------------------------------------------------------

test('exports evaluateRenderedDiscoveryBudget as a function', () => {
  assert.strictEqual(typeof evaluateRenderedDiscoveryBudget, 'function');
});

test('legacy discovery-budget exports remain present', () => {
  for (const name of [
    'BUDGET_RESULT_SCHEMA',
    'CATEGORIES',
    'ESTIMATOR',
    'configurationError',
    'evaluateDiscoveryBudget',
    'evaluateAggregateDiscoveryBudget',
    'normalizeEstimator',
    'normalizeLimits',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(discoveryBudget, name), `missing legacy export ${name}`);
  }
  assert.strictEqual(discoveryBudget.BUDGET_RESULT_SCHEMA, 'dhpk.discovery-budget-result.v1');
});

// --- Codex budget resolution ----------------------------------------------

test('known 100000-token context resolves a 2000-token limit and passes at 2000', () => {
  const report = evaluateRenderedDiscoveryBudget(codexTokenInput({ full: 2000, plugin: 300 }));
  assert.strictEqual(report.schema, 'dhpk.rendered-discovery-budget-result.v1');
  assert.deepStrictEqual(report.budget, { policy: 'codex-skill-list', version: '2026-10-01', unit: 'tokens', limit: 2000 });
  assert.strictEqual(report.measurement.fullConsumer.value, 2000);
  assertPass(report);
});

test('known 100000-token context fails at 2001 tokens', () => {
  const report = evaluateRenderedDiscoveryBudget(codexTokenInput({ full: 2001, plugin: 300 }));
  assertSingleOverflow(report);
});

test('known 100050-token context resolves exactly 2001 as a safe integer', () => {
  const input = codexTokenInput({ full: 2001, plugin: 300 });
  input.model.contextWindowTokens = 100050;
  const report = evaluateRenderedDiscoveryBudget(input);
  assert.strictEqual(report.budget.limit, 2001);
  assert.ok(Number.isSafeInteger(report.budget.limit));
  assert.strictEqual(report.budget.unit, 'tokens');
  assertPass(report);
});

test('known 100001-token context resolves an unrounded 2000.02 limit: 2000 passes, 2001 fails', () => {
  const pass = codexTokenInput({ full: 2000, plugin: 300 });
  pass.model.contextWindowTokens = 100001;
  const passReport = evaluateRenderedDiscoveryBudget(pass);
  assert.strictEqual(passReport.budget.limit, 2000.02);
  assertPass(passReport);

  const fail = codexTokenInput({ full: 2001, plugin: 300 });
  fail.model.contextWindowTokens = 100001;
  const failReport = evaluateRenderedDiscoveryBudget(fail);
  assert.strictEqual(failReport.budget.limit, 2000.02);
  assertSingleOverflow(failReport);
});

test('model context of 1 token resolves a 0.02 limit, so any nonzero list fails', () => {
  const input = codexTokenInput({ full: 1, plugin: 0 });
  input.model.contextWindowTokens = 1;
  input.measurement.pluginContribution.stableIds = ['skill.alpha', 'skill.beta'];
  const report = evaluateRenderedDiscoveryBudget(input);
  assert.strictEqual(report.budget.limit, 0.02);
  assertSingleOverflow(report);
});

test('model without a context field is unknown and resolves the 8000-character limit', () => {
  const input = codexCharacterInput();
  input.model = { id: 'gpt-6-sol' };
  const report = evaluateRenderedDiscoveryBudget(input);
  assert.deepStrictEqual(report.model, { id: 'gpt-6-sol', contextWindowTokens: null });
  assert.strictEqual(report.budget.limit, 8000);
  assert.strictEqual(report.budget.unit, 'characters');
  assertPass(report);
});

test('Codex budget may not carry its own unit or limit (the limit is derived)', () => {
  for (const extra of [{ unit: 'tokens' }, { limit: 999999 }]) {
    const input = codexTokenInput();
    input.budget = { policy: 'codex-skill-list', version: '2026-10-01', ...extra };
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_BUDGET_CONFIGURATION');
  }
});

test('non-object budget or model is rejected', () => {
  const badBudget = cursorInput();
  badBudget.budget = 'cursor-rules-list';
  assertNotConfigured(evaluateRenderedDiscoveryBudget(badBudget), 'INVALID_BUDGET_CONFIGURATION');
  const badModel = codexTokenInput();
  badModel.model = 'gpt-6-sol';
  assertNotConfigured(evaluateRenderedDiscoveryBudget(badModel), 'INVALID_MODEL_CONTEXT');
});

test('unknown context (null context field) resolves 8000 Unicode characters and passes at 8000', () => {
  const report = evaluateRenderedDiscoveryBudget(codexCharacterInput({ fullText: 'x'.repeat(8000) }));
  assert.deepStrictEqual(report.budget, { policy: 'codex-skill-list', version: '2026-10-01', unit: 'characters', limit: 8000 });
  assert.strictEqual(report.measurement.fullConsumer.value, 8000);
  assertPass(report);
});

test('unknown context (omitted context field) fails at 8001 characters', () => {
  const input = codexCharacterInput({ fullText: 'x'.repeat(8001) });
  delete input.model.contextWindowTokens;
  const report = evaluateRenderedDiscoveryBudget(input);
  assert.strictEqual(report.budget.limit, 8000);
  assert.strictEqual(report.measurement.fullConsumer.value, 8001);
  assertSingleOverflow(report);
});

test('unknown model context is reported as null, not guessed', () => {
  const report = evaluateRenderedDiscoveryBudget(codexCharacterInput());
  assert.ok(report.model === null || report.model.contextWindowTokens === null);
});

test('small plugin contribution never waives a full-consumer overflow and both values are retained', () => {
  const report = evaluateRenderedDiscoveryBudget(codexTokenInput({ full: 2001, plugin: 100 }));
  assertSingleOverflow(report);
  assert.strictEqual(report.measurement.fullConsumer.value, 2001);
  assert.strictEqual(report.measurement.pluginContribution.value, 100);
});

test('supplementary-plane characters count as one code point each', () => {
  const pass = evaluateRenderedDiscoveryBudget(codexCharacterInput({ fullText: '\u{1F600}'.repeat(8000), pluginText: '\u{1F600}' }));
  assert.strictEqual(pass.measurement.fullConsumer.value, 8000);
  assert.strictEqual(pass.measurement.pluginContribution.value, 1);
  assertPass(pass);

  const fail = evaluateRenderedDiscoveryBudget(codexCharacterInput({ fullText: '\u{1F600}'.repeat(8001), pluginText: '\u{1F600}' }));
  assert.strictEqual(fail.measurement.fullConsumer.value, 8001);
  assertSingleOverflow(fail);
});

test('supplied character value must equal the code-point count', () => {
  const input = codexCharacterInput({ fullText: '\u{1F600}'.repeat(8000), pluginText: '\u{1F600}' });
  input.measurement.fullConsumer.value = 16000;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MEASUREMENT');

  const matching = codexCharacterInput({ fullText: '\u{1F600}'.repeat(8000), pluginText: '\u{1F600}' });
  matching.measurement.fullConsumer.value = 8000;
  matching.measurement.pluginContribution.value = 1;
  assertPass(evaluateRenderedDiscoveryBudget(matching));
});

test('empty selection with empty plugin contribution passes', () => {
  const input = codexCharacterInput({ fullText: 'other: third-party (other/SKILL.md)', pluginText: '' });
  input.identity.selectedStableIds = [];
  input.measurement.fullConsumer.stableIds = ['other.gamma'];
  input.measurement.pluginContribution.stableIds = [];
  const report = evaluateRenderedDiscoveryBudget(input);
  assert.strictEqual(report.measurement.pluginContribution.value, 0);
  assertPass(report);
});

// --- other hosts: explicit configuration only -----------------------------

test('Cursor with an explicit configured budget passes', () => {
  const report = evaluateRenderedDiscoveryBudget(cursorInput());
  assert.deepStrictEqual(report.budget, { policy: 'configured', version: '2026-09-15', unit: 'characters', limit: 12000 });
  assertPass(report);
});

test('Cursor list exactly at its configured limit passes and one over fails', () => {
  const atLimit = cursorInput();
  atLimit.measurement.fullConsumer.renderedText = 'c'.repeat(12000);
  assertPass(evaluateRenderedDiscoveryBudget(atLimit));
  const over = cursorInput();
  over.measurement.fullConsumer.renderedText = 'c'.repeat(12001);
  assertSingleOverflow(evaluateRenderedDiscoveryBudget(over));
});

test('Cursor with no budget is NOT_CONFIGURED and does not inherit the Codex policy', () => {
  const input = cursorInput();
  delete input.budget;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MISSING_BUDGET_CONFIGURATION');
});

test('Cursor naming the Codex policy without unit/limit does not inherit Codex resolution', () => {
  const input = cursorInput();
  input.budget = { policy: 'codex-skill-list', version: '2026-10-01' };
  assertNotConfigured(
    evaluateRenderedDiscoveryBudget(input),
    'UNSUPPORTED_BUDGET_POLICY', 'INVALID_BUDGET_CONFIGURATION', 'MISSING_BUDGET_CONFIGURATION',
  );
});

test('other-host budget requires a known unit and a nonnegative finite limit', () => {
  for (const budget of [
    { policy: 'configured', version: '2026-09-15', unit: 'words', limit: 100 },
    { policy: 'configured', version: '2026-09-15', unit: 'characters', limit: -1 },
    { policy: 'configured', version: '2026-09-15', unit: 'characters', limit: Infinity },
    { policy: 'configured', version: '2026-09-15', unit: 'characters' },
    { policy: '', version: '2026-09-15', unit: 'characters', limit: 100 },
    { policy: 'configured', version: ' ', unit: 'characters', limit: 100 },
  ]) {
    const input = cursorInput();
    input.budget = budget;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_BUDGET_CONFIGURATION');
  }
});

test('Codex with a missing budget is NOT_CONFIGURED', () => {
  const input = codexTokenInput();
  delete input.budget;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MISSING_BUDGET_CONFIGURATION');
});

test('Codex with an unknown policy or version is UNSUPPORTED_BUDGET_POLICY', () => {
  for (const budget of [
    { policy: 'codex-skill-list', version: '2025-01-01' },
    { policy: 'codex-legacy-description-sum', version: '2026-10-01' },
  ]) {
    const input = codexTokenInput();
    input.budget = budget;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'UNSUPPORTED_BUDGET_POLICY');
  }
});

// --- configuration errors suppress size violations ------------------------

test('descriptions-only coverage is NOT_CONFIGURED even when the list overflows', () => {
  const input = codexCharacterInput({ fullText: 'x'.repeat(9000) });
  input.measurement.coverage = { names: false, descriptions: true, filePaths: false, hostMetadata: 'not-observable', hostOverhead: 'not-observable' };
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INCOMPLETE_RENDERED_COVERAGE');
});

test('every coverage field must be explicit', () => {
  for (const field of ['names', 'descriptions', 'filePaths', 'hostMetadata', 'hostOverhead']) {
    const input = codexTokenInput();
    delete input.measurement.coverage[field];
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INCOMPLETE_RENDERED_COVERAGE');
  }
  const unknownValue = codexTokenInput();
  unknownValue.measurement.coverage.hostOverhead = 'unknown';
  assertNotConfigured(evaluateRenderedDiscoveryBudget(unknownValue), 'INCOMPLETE_RENDERED_COVERAGE');
});

test('explicitly not-observable host metadata and overhead are preserved in the report', () => {
  const input = codexTokenInput();
  input.measurement.coverage.hostMetadata = 'not-observable';
  input.measurement.coverage.hostOverhead = 'not-observable';
  const report = evaluateRenderedDiscoveryBudget(input);
  assertPass(report);
  assert.deepStrictEqual(report.measurement.coverage, {
    names: true,
    descriptions: true,
    filePaths: true,
    hostMetadata: 'not-observable',
    hostOverhead: 'not-observable',
  });
});

test('missing measurement is NOT_CONFIGURED', () => {
  const input = codexTokenInput();
  delete input.measurement;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MISSING_MEASUREMENT');
});

// --- unit / estimator provenance ------------------------------------------

test('token budget with a character estimator is UNIT_MISMATCH', () => {
  const input = codexTokenInput();
  input.measurement.estimator = characterEstimator();
  delete input.measurement.fullConsumer.value;
  delete input.measurement.pluginContribution.value;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'UNIT_MISMATCH');
});

test('character budget with a token estimator is UNIT_MISMATCH', () => {
  const input = codexCharacterInput();
  input.measurement.estimator = tokenEstimator();
  input.measurement.fullConsumer.value = 1500;
  input.measurement.pluginContribution.value = 30;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'UNIT_MISMATCH');
});

test('token estimator without tokenizer or Host documentation is INVALID_ESTIMATOR', () => {
  for (const documentation of [undefined, '', '   ']) {
    const input = codexTokenInput();
    if (documentation === undefined) delete input.measurement.estimator.documentation;
    else input.measurement.estimator.documentation = documentation;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_ESTIMATOR');
  }
});

test('legacy 4-characters-per-token default is not an acceptable token estimator', () => {
  const input = codexTokenInput();
  input.measurement.estimator = {
    id: 'dhpk-conservative-context-estimator',
    version: '1',
    unit: 'tokens',
    kind: 'estimated',
    documentation: 'ceil-unicode-codepoints-divided-by-4',
  };
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_ESTIMATOR');
});

test('estimator requires explicit id, version, unit and observed|estimated kind', () => {
  const mutations = [
    (estimator) => { delete estimator.id; },
    (estimator) => { estimator.version = ''; },
    (estimator) => { delete estimator.unit; },
    (estimator) => { estimator.kind = 'guessed'; },
  ];
  for (const mutate of mutations) {
    const input = codexTokenInput();
    mutate(input.measurement.estimator);
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_ESTIMATOR', 'UNIT_MISMATCH');
  }
});

test('token values must be nonnegative safe integers', () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, '1500', null, undefined]) {
    const input = codexTokenInput();
    if (value === undefined) delete input.measurement.fullConsumer.value;
    else input.measurement.fullConsumer.value = value;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MEASUREMENT');
  }
});

test('plugin contribution larger than the full consumer is INVALID_MEASUREMENT', () => {
  assertNotConfigured(evaluateRenderedDiscoveryBudget(codexTokenInput({ full: 100, plugin: 101 })), 'INVALID_MEASUREMENT');
});

// --- model context ---------------------------------------------------------

test('model identity is required even when the context window is unknown', () => {
  for (const model of [undefined, null, {}, { contextWindowTokens: 100000 }, { id: '' }, { id: ' ' }]) {
    const input = codexCharacterInput();
    input.model = model;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MODEL_CONTEXT');
  }
});

test('other hosts require the explicitly configured policy discriminator', () => {
  const input = cursorInput();
  input.budget.policy = 'unrecognized-policy';
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'UNSUPPORTED_BUDGET_POLICY');
});

test('invalid supplied context window is INVALID_MODEL_CONTEXT, not silently unknown', () => {
  for (const contextWindowTokens of [0, -100000, 100000.5, '100000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const input = codexTokenInput();
    input.model.contextWindowTokens = contextWindowTokens;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MODEL_CONTEXT');
  }
});

// --- scope / identity / selection -----------------------------------------

test('scope requires nonblank host, hostVersion, profile and a clean|coexistence consumer', () => {
  const mutations = [
    (scope) => { scope.host = ''; },
    (scope) => { delete scope.hostVersion; },
    (scope) => { scope.profile = '  '; },
    (scope) => { scope.consumer = 'shared'; },
  ];
  for (const mutate of mutations) {
    const input = codexTokenInput();
    mutate(input.scope);
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_SCOPE');
  }
  const missing = codexTokenInput();
  delete missing.scope;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(missing), 'INVALID_SCOPE');
});

test('identity requires all three nonblank fingerprints', () => {
  for (const field of ['planFingerprint', 'selectionFingerprint', 'artifactFingerprint']) {
    const input = codexTokenInput();
    input.identity[field] = ' ';
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MISSING_SCOPE_IDENTITY');
  }
  const missing = codexTokenInput();
  delete missing.identity;
  assertNotConfigured(evaluateRenderedDiscoveryBudget(missing), 'MISSING_SCOPE_IDENTITY');
});

test('selected stable IDs must be unique and nonblank', () => {
  for (const selectedStableIds of [['skill.alpha', 'skill.alpha'], ['skill.alpha', ''], 'skill.alpha']) {
    const input = codexTokenInput();
    input.identity.selectedStableIds = selectedStableIds;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_SELECTION');
  }
});

test('each measurement fingerprint must match the scope identity exactly', () => {
  for (const field of ['planFingerprint', 'selectionFingerprint', 'artifactFingerprint']) {
    const input = codexTokenInput();
    input.measurement.identity[field] = `${input.measurement.identity[field]}-stale`;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MEASUREMENT_IDENTITY_MISMATCH');
  }
});

test('plugin stable IDs must equal the selected set', () => {
  const missingOne = codexTokenInput();
  missingOne.measurement.pluginContribution.stableIds = ['skill.alpha'];
  assertNotConfigured(evaluateRenderedDiscoveryBudget(missingOne), 'SELECTION_MISMATCH');

  const extraOne = codexTokenInput();
  extraOne.measurement.pluginContribution.stableIds = ['skill.alpha', 'skill.beta', 'skill.delta'];
  extraOne.measurement.fullConsumer.stableIds = ['skill.alpha', 'skill.beta', 'skill.delta', 'other.gamma'];
  assertNotConfigured(evaluateRenderedDiscoveryBudget(extraOne), 'SELECTION_MISMATCH');
});

test('plugin stable IDs must be a subset of the full consumer IDs', () => {
  const input = codexTokenInput();
  input.measurement.fullConsumer.stableIds = ['skill.alpha', 'other.gamma'];
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'SELECTION_MISMATCH');
});

test('duplicate measurement stable IDs are rejected', () => {
  const input = codexTokenInput();
  input.measurement.fullConsumer.stableIds = ['skill.alpha', 'skill.beta', 'skill.beta'];
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MEASUREMENT');
});

test('non-object measurement is INVALID_MEASUREMENT', () => {
  const input = codexTokenInput();
  input.measurement = 'rendered list';
  assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MEASUREMENT');
});

test('missing or non-object measurement identity is MEASUREMENT_IDENTITY_MISMATCH', () => {
  for (const measured of [undefined, 'plan-fp-0001']) {
    const input = codexTokenInput();
    if (measured === undefined) delete input.measurement.identity;
    else input.measurement.identity = measured;
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'MEASUREMENT_IDENTITY_MISMATCH');
  }
});

test('malformed rendered lists are INVALID_MEASUREMENT', () => {
  const mutations = [
    (measurement) => { delete measurement.fullConsumer; },
    (measurement) => { delete measurement.pluginContribution; },
    (measurement) => { measurement.fullConsumer.renderedText = 42; },
    (measurement) => { measurement.pluginContribution.stableIds = 'skill.alpha'; },
    (measurement) => { measurement.fullConsumer.stableIds = ['skill.alpha', ' ', 'skill.beta']; },
  ];
  for (const mutate of mutations) {
    const input = codexTokenInput();
    mutate(input.measurement);
    assertNotConfigured(evaluateRenderedDiscoveryBudget(input), 'INVALID_MEASUREMENT');
  }
});

// --- report shape / evidence / purity -------------------------------------

test('report echoes scope, identity, model and structural evidence bound to fingerprints', () => {
  const report = evaluateRenderedDiscoveryBudget(codexTokenInput());
  assert.deepStrictEqual(report.scope, { host: 'codex', hostVersion: '0.50.0', profile: 'default', consumer: 'clean' });
  assert.deepStrictEqual(report.identity, {
    planFingerprint: PLAN,
    selectionFingerprint: SELECTION,
    artifactFingerprint: ARTIFACT,
    selectedStableIds: ['skill.alpha', 'skill.beta'],
  });
  assert.deepStrictEqual(report.model, { id: 'gpt-6-sol', contextWindowTokens: 100000 });
  assert.strictEqual(report.evidence.schema, 'dhpk.distribution-projection-contract.v1');
  assert.strictEqual(report.evidence.stage, 'structural');
  assert.strictEqual(report.evidence.planFingerprint, PLAN);
  assert.strictEqual(report.evidence.artifactFingerprint, ARTIFACT);
  assert.deepStrictEqual(report.evidence.provenance, { selectionFingerprint: SELECTION });
  assert.strictEqual(report.evidence.verdict, 'PASS');
  assert.ok(Array.isArray(report.evidence.claims) && report.evidence.claims.length > 0);
  for (const claim of report.evidence.claims) {
    assert.ok(!/runtime|role|packet|reference/i.test(claim), `structural claim overreaches: ${claim}`);
  }
});

test('deep-frozen input is accepted, repeatable, JSON-serializable and defensively copied', () => {
  const input = deepFreeze(codexTokenInput({ full: 2001, plugin: 100 }));
  const first = evaluateRenderedDiscoveryBudget(input);
  const second = evaluateRenderedDiscoveryBudget(input);
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), first);
  assert.notStrictEqual(first.scope, input.scope);
  assert.notStrictEqual(first.identity, input.identity);
  assert.notStrictEqual(first.identity.selectedStableIds, input.identity.selectedStableIds);
  assert.notStrictEqual(first.model, input.model);
  assert.notStrictEqual(first.measurement.coverage, input.measurement.coverage);
  assert.notStrictEqual(first.measurement.estimator, input.measurement.estimator);
  assert.notStrictEqual(first.measurement.identity, input.measurement.identity);
  assert.notStrictEqual(first.measurement.fullConsumer.stableIds, input.measurement.fullConsumer.stableIds);
  assert.notStrictEqual(first.measurement.pluginContribution.stableIds, input.measurement.pluginContribution.stableIds);
  assert.notStrictEqual(first.identity, second.identity);
  assert.notStrictEqual(first.evidence, second.evidence);
  assert.strictEqual(Object.isFrozen(first.evidence), false);
  assert.deepStrictEqual(first.measurement.fullConsumer.stableIds, ['skill.alpha', 'skill.beta', 'other.gamma']);
  assert.strictEqual(first.measurement.fullConsumer.renderedText, input.measurement.fullConsumer.renderedText);
  assertSingleOverflow(first);
});

test('configuration-error report evidence is NOT_CONFIGURED and still fingerprint-bound', () => {
  const input = codexTokenInput({ full: 999999, plugin: 1 });
  input.measurement.coverage.filePaths = false;
  const report = evaluateRenderedDiscoveryBudget(input);
  assertNotConfigured(report, 'INCOMPLETE_RENDERED_COVERAGE');
  assert.strictEqual(report.evidence.stage, 'structural');
  assert.strictEqual(report.evidence.planFingerprint, PLAN);
  assert.strictEqual(report.evidence.artifactFingerprint, ARTIFACT);
  assert.ok(report.evidence.diagnostics.some((line) => line.startsWith('INCOMPLETE_RENDERED_COVERAGE')));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(report)), report);
});

test('no-argument call is NOT_CONFIGURED without throwing', () => {
  const report = evaluateRenderedDiscoveryBudget();
  assert.strictEqual(report.schema, 'dhpk.rendered-discovery-budget-result.v1');
  assertNotConfigured(report, 'INVALID_SCOPE', 'MISSING_SCOPE_IDENTITY', 'MISSING_BUDGET_CONFIGURATION', 'MISSING_MEASUREMENT');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(report)), report);
});

run('marketplace-discovery-budget');
