'use strict';

// Runtime acceptance fixtures use captured identity values and selector rows
// independent from the wrapper's verdict logic.

const { test, run, assert } = require('./_lib/tinytest');
const { evaluateMarketplaceRuntimeAcceptance } = require('../scripts/lib/marketplace-runtime-acceptance');
const CURRENT_MANIFEST_CONFIGURATION = require('../manifests/marketplace-runtime-acceptance.json');

const RESULT_SCHEMA = 'dhpk.marketplace-runtime-acceptance-result.v1';
const SCOPE_ID = 'codex-default-clean';
const SURFACE = 'selector-main';

function makeInput() {
  return {
    configuration: {
      schema: 'dhpk.marketplace-runtime-acceptance.v1',
      requiredScopes: [{
        id: SCOPE_ID,
        host: 'codex',
        profile: 'default',
        consumer: 'clean',
        surface: SURFACE,
        budget: { policy: 'codex-skill-list', version: '2026-10-01' },
        rationale: 'Verify the complete native Codex selector against its current context budget.',
      }],
    },
    identities: {
      [SURFACE]: {
        planFingerprint: 'plan-fp-0001',
        selectionFingerprint: 'selection-fp-0001',
        artifactFingerprint: 'artifact-fp-0001',
        selectedStableIds: ['skill.alpha', 'skill.beta'],
      },
    },
    evidence: [{
      scopeId: SCOPE_ID,
      sessionId: 'session-20261003-codex-01',
      sessionFresh: true,
      hostVersion: '0.50.0',
      scope: { host: 'codex', profile: 'default', consumer: 'clean' },
      identity: {
        planFingerprint: 'plan-fp-0001',
        selectionFingerprint: 'selection-fp-0001',
        artifactFingerprint: 'artifact-fp-0001',
        selectedStableIds: ['skill.alpha', 'skill.beta'],
      },
      model: { id: 'gpt-6-sol', contextWindowTokens: 100000 },
      measurement: {
        identity: {
          planFingerprint: 'plan-fp-0001',
          selectionFingerprint: 'selection-fp-0001',
          artifactFingerprint: 'artifact-fp-0001',
        },
        estimator: {
          id: 'fixture-native-tokenizer',
          version: '1',
          unit: 'tokens',
          kind: 'observed',
          documentation: 'https://example.invalid/codex/tokenizer',
        },
        coverage: {
          names: true,
          descriptions: true,
          filePaths: true,
          hostMetadata: 'included',
          hostOverhead: 'included',
        },
        fullConsumer: {
          renderedText: '- alpha: Alpha workflow (skills/alpha/SKILL.md)\n- beta: Beta workflow (skills/beta/SKILL.md)\n- vendor: Foreign workflow (other/vendor/SKILL.md)',
          stableIds: ['skill.alpha', 'skill.beta', 'foreign.gamma'],
          value: 2000,
        },
        pluginContribution: {
          renderedText: '- alpha: Alpha workflow (skills/alpha/SKILL.md)\n- beta: Beta workflow (skills/beta/SKILL.md)',
          stableIds: ['skill.alpha', 'skill.beta'],
          value: 300,
        },
      },
      sources: [
        { stableId: 'skill.alpha', name: 'alpha', path: 'skills/alpha/SKILL.md', owner: 'plugin', observed: true },
        { stableId: 'skill.beta', name: 'beta', path: 'skills/beta/SKILL.md', owner: 'plugin', observed: true },
        { stableId: 'foreign.gamma', name: 'vendor', path: 'other/vendor/SKILL.md', owner: 'foreign', observed: true },
      ],
      contextScopes: {
        selectedRoleKernel: { state: 'NOT_SELECTED' },
        packet: { state: 'NOT_RUN' },
        references: { state: 'NOT_RUN' },
        runtimeObservation: { state: 'NOT_RUN' },
      },
    }],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function scopeReport(report, id = SCOPE_ID) {
  return report.scopes.find((scope) => scope.id === id);
}

function assertStructuredError(report) {
  assert.ok(Array.isArray(report.errors) && report.errors.length > 0, 'failure must carry structured errors');
  for (const error of report.errors) {
    assert.ok(typeof error.code === 'string' && error.code.length > 0);
    assert.ok(Object.prototype.hasOwnProperty.call(error, 'scopeId'));
    assert.ok(error.scopeId === null || (typeof error.scopeId === 'string' && error.scopeId.length > 0));
    assert.ok(typeof error.message === 'string' && error.message.length > 0);
  }
}

function assertScopeVerdict(report, verdict, id = SCOPE_ID) {
  const scope = scopeReport(report, id);
  assert.ok(scope, `missing result for scope ${id}`);
  assert.strictEqual(scope.verdict, verdict);
  return scope;
}

test('fresh captured scope passes its complete native selector budget without claiming workflow runtime', () => {
  const report = evaluateMarketplaceRuntimeAcceptance(makeInput());
  assert.strictEqual(report.schema, RESULT_SCHEMA);
  assert.strictEqual(report.stage, 'discovery-budget');
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.verdict, 'PASS');
  assert.strictEqual(report.workflowRuntime, 'NOT_EVALUATED');
  const accepted = assertScopeVerdict(report, 'PASS');
  assert.strictEqual(accepted.budgetReport.budget.limit, 2000);
  assert.strictEqual(accepted.budgetReport.measurement.fullConsumer.value, 2000);
  assert.strictEqual(accepted.budgetReport.measurement.pluginContribution.value, 300);
});

test('current manifest Codex clean and coexistence scopes accept matching selector evidence', () => {
  const identity = {
    planFingerprint: 'openai-plan-20261003-0001',
    selectionFingerprint: 'openai-selection-20261003-0001',
    artifactFingerprint: 'openai-artifact-20261003-0001',
    selectedStableIds: ['skill.alpha', 'skill.beta'],
  };
  const measurementIdentity = {
    planFingerprint: identity.planFingerprint,
    selectionFingerprint: identity.selectionFingerprint,
    artifactFingerprint: identity.artifactFingerprint,
  };
  const measurementBase = {
    identity: measurementIdentity,
    estimator: {
      id: 'codex-native-tokenizer',
      version: '1',
      unit: 'tokens',
      kind: 'observed',
      documentation: 'https://example.invalid/codex/tokenizer',
    },
    coverage: {
      names: true,
      descriptions: true,
      filePaths: true,
      hostMetadata: 'included',
      hostOverhead: 'included',
    },
    pluginContribution: {
      renderedText: '- alpha: Alpha workflow (skills/alpha/SKILL.md)\n- beta: Beta workflow (skills/beta/SKILL.md)',
      stableIds: ['skill.alpha', 'skill.beta'],
      value: 300,
    },
  };
  const sharedSources = [
    { stableId: 'skill.alpha', name: 'alpha', path: 'skills/alpha/SKILL.md', owner: 'plugin', observed: true },
    { stableId: 'skill.beta', name: 'beta', path: 'skills/beta/SKILL.md', owner: 'plugin', observed: true },
  ];
  const contextScopes = {
    selectedRoleKernel: { state: 'NOT_SELECTED' },
    packet: { state: 'NOT_RUN' },
    references: { state: 'NOT_RUN' },
    runtimeObservation: { state: 'NOT_RUN' },
  };
  const evidence = [
    {
      scopeId: 'codex-default-clean',
      sessionId: 'codex-clean-session-20261003-01',
      sessionFresh: true,
      hostVersion: '0.50.0',
      scope: { host: 'codex', profile: 'default', consumer: 'clean' },
      identity,
      model: { id: 'gpt-6-sol', contextWindowTokens: 100000 },
      measurement: {
        ...measurementBase,
        fullConsumer: {
          renderedText: '- alpha: Alpha workflow (skills/alpha/SKILL.md)\n- beta: Beta workflow (skills/beta/SKILL.md)',
          stableIds: ['skill.alpha', 'skill.beta'],
          value: 900,
        },
      },
      sources: sharedSources,
      contextScopes,
    },
    {
      scopeId: 'codex-default-coexistence',
      sessionId: 'codex-coexistence-session-20261003-01',
      sessionFresh: true,
      hostVersion: '0.50.0',
      scope: { host: 'codex', profile: 'default', consumer: 'coexistence' },
      identity,
      model: { id: 'gpt-6-sol', contextWindowTokens: 100000 },
      measurement: {
        ...measurementBase,
        fullConsumer: {
          renderedText: '- alpha: Alpha workflow (skills/alpha/SKILL.md)\n- beta: Beta workflow (skills/beta/SKILL.md)\n- vendor: Foreign workflow (other/vendor/SKILL.md)',
          stableIds: ['skill.alpha', 'skill.beta', 'foreign.gamma'],
          value: 1600,
        },
      },
      sources: [
        ...sharedSources,
        { stableId: 'foreign.gamma', name: 'vendor', path: 'other/vendor/SKILL.md', owner: 'foreign', observed: true },
      ],
      contextScopes,
    },
  ];
  const codexScopes = CURRENT_MANIFEST_CONFIGURATION.requiredScopes.filter((scope) => scope.host === 'codex');
  const report = evaluateMarketplaceRuntimeAcceptance({
    configuration: { schema: CURRENT_MANIFEST_CONFIGURATION.schema, requiredScopes: codexScopes },
    identities: { 'openai-submission': identity },
    evidence,
  });

  assert.deepStrictEqual(report.errors, [], JSON.stringify(report.errors));
  assert.strictEqual(report.verdict, 'PASS');
  assertScopeVerdict(report, 'PASS', 'codex-default-clean');
  assertScopeVerdict(report, 'PASS', 'codex-default-coexistence');
});

test('an omitted required evidence row remains NOT_RUN', () => {
  const input = makeInput();
  input.evidence = [];
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assert.strictEqual(report.ok, false);
  assertScopeVerdict(report, 'NOT_RUN');
  assertStructuredError(report);
});

test('malformed evidence collections fail instead of being treated as unrun', () => {
  const input = makeInput();
  input.evidence = { scopeId: SCOPE_ID };
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assert.strictEqual(report.verdict, 'FAIL');
  assertStructuredError(report);
});

test('an empty required-scope configuration is NOT_CONFIGURED', () => {
  const input = makeInput();
  input.configuration.requiredScopes = [];
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.verdict, 'NOT_CONFIGURED');
  assertStructuredError(report);
});

test('invalid configuration schema or incomplete scope metadata fails closed', () => {
  const invalidSchema = makeInput();
  invalidSchema.configuration.schema = 'dhpk.marketplace-runtime-acceptance.v0';
  const schemaReport = evaluateMarketplaceRuntimeAcceptance(invalidSchema);
  assert.strictEqual(schemaReport.ok, false);
  assertStructuredError(schemaReport);

  for (const field of ['id', 'host', 'profile', 'consumer', 'surface', 'rationale']) {
    const input = makeInput();
    delete input.configuration.requiredScopes[0][field];
    if (field === 'surface') delete input.identities[SURFACE];
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assert.strictEqual(report.ok, false, `missing required scope field ${field}`);
    if (field !== 'id') assertScopeVerdict(report, 'NOT_CONFIGURED');
    assertStructuredError(report);
  }
});

test('a required scope without its own budget is NOT_CONFIGURED', () => {
  const input = makeInput();
  delete input.configuration.requiredScopes[0].budget;
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'NOT_CONFIGURED');
  assertStructuredError(report);
});

test('unsupported hosts are rejected instead of receiving another host budget', () => {
  const input = makeInput();
  input.configuration.requiredScopes[0].host = 'generic-cli';
  input.evidence[0].scope.host = 'generic-cli';
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assert.strictEqual(report.ok, false);
  assertStructuredError(report);
});

test('each supported Host can use its own explicitly configured discovery budget', () => {
  for (const host of ['claude', 'cursor', 'agy']) {
    const input = makeInput();
    input.configuration.requiredScopes[0].host = host;
    input.configuration.requiredScopes[0].budget = {
      policy: 'configured', version: 'fixture-v1', unit: 'tokens', limit: 5000,
    };
    input.evidence[0].scope.host = host;
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assertScopeVerdict(report, 'PASS');
  }
});

test('duplicate configured scopes, duplicate evidence rows, and unknown rows fail closed', () => {
  const duplicateConfiguration = makeInput();
  duplicateConfiguration.configuration.requiredScopes.push(clone(duplicateConfiguration.configuration.requiredScopes[0]));
  const duplicateConfigReport = evaluateMarketplaceRuntimeAcceptance(duplicateConfiguration);
  assert.strictEqual(duplicateConfigReport.verdict, 'FAIL');
  assertStructuredError(duplicateConfigReport);

  const duplicateEvidence = makeInput();
  duplicateEvidence.evidence.push(clone(duplicateEvidence.evidence[0]));
  const duplicateEvidenceReport = evaluateMarketplaceRuntimeAcceptance(duplicateEvidence);
  assert.strictEqual(duplicateEvidenceReport.verdict, 'FAIL');
  assertStructuredError(duplicateEvidenceReport);

  const unknownEvidence = makeInput();
  unknownEvidence.evidence.push({ ...clone(unknownEvidence.evidence[0]), scopeId: 'unconfigured-scope' });
  const unknownEvidenceReport = evaluateMarketplaceRuntimeAcceptance(unknownEvidence);
  assert.strictEqual(unknownEvidenceReport.verdict, 'FAIL');
  assertStructuredError(unknownEvidenceReport);
});

test('captured surface identity must match all fingerprints and selected IDs', () => {
  for (const mutate of [
    (identity) => { identity.planFingerprint = 'plan-fp-other'; },
    (identity) => { identity.selectionFingerprint = 'selection-fp-other'; },
    (identity) => { identity.artifactFingerprint = 'artifact-fp-other'; },
    (identity) => { identity.selectedStableIds = ['skill.alpha']; },
  ]) {
    const input = makeInput();
    mutate(input.evidence[0].identity);
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assert.strictEqual(report.ok, false);
    assertScopeVerdict(report, 'FAIL');
    assertStructuredError(report);
  }
});

test('missing expected surface identity fails closed', () => {
  const input = makeInput();
  delete input.identities[SURFACE];
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('expected surface identity requires all captured fingerprints and selected IDs', () => {
  for (const field of ['planFingerprint', 'selectionFingerprint', 'artifactFingerprint', 'selectedStableIds']) {
    const input = makeInput();
    delete input.identities[SURFACE][field];
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assertScopeVerdict(report, 'FAIL');
    assertStructuredError(report);
  }
});

test('stale sessions and missing Host versions cannot pass acceptance', () => {
  const stale = makeInput();
  stale.evidence[0].sessionFresh = false;
  const staleReport = evaluateMarketplaceRuntimeAcceptance(stale);
  assertScopeVerdict(staleReport, 'FAIL');
  assertStructuredError(staleReport);

  const missingVersion = makeInput();
  delete missingVersion.evidence[0].hostVersion;
  const versionReport = evaluateMarketplaceRuntimeAcceptance(missingVersion);
  assertScopeVerdict(versionReport, 'FAIL');
  assertStructuredError(versionReport);
});

test('an evidence row scope must agree with configured Host, profile, and consumer', () => {
  for (const mismatch of [
    { host: 'cursor', profile: 'default', consumer: 'clean' },
    { host: 'codex', profile: 'minimal', consumer: 'clean' },
    { host: 'codex', profile: 'default', consumer: 'coexistence' },
  ]) {
    const input = makeInput();
    input.evidence[0].scope = mismatch;
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assertScopeVerdict(report, 'FAIL');
    assertStructuredError(report);
  }
});

test('selector evidence requires every expected plugin-owned stable ID', () => {
  const input = makeInput();
  input.evidence[0].sources = input.evidence[0].sources.filter((source) => source.stableId !== 'skill.beta');
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('selector evidence rejects an unexpected plugin-owned child or retired ID', () => {
  for (const unexpectedId of ['skill.alpha.child', 'skill.retired']) {
    const input = makeInput();
    input.evidence[0].sources.push({
      stableId: unexpectedId,
      name: 'unexpected',
      path: 'skills/unexpected/SKILL.md',
      owner: 'plugin',
      observed: true,
    });
    input.evidence[0].measurement.fullConsumer.stableIds.push(unexpectedId);
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assertScopeVerdict(report, 'FAIL');
    assertStructuredError(report);
  }
});

test('selector evidence rejects repeated stable IDs even when the source rows are identical', () => {
  const input = makeInput();
  input.evidence[0].sources.push(clone(input.evidence[0].sources[0]));
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('selector evidence rejects duplicate public names and package paths', () => {
  const duplicateName = makeInput();
  duplicateName.evidence[0].sources[1].name = 'alpha';
  const nameReport = evaluateMarketplaceRuntimeAcceptance(duplicateName);
  assertScopeVerdict(nameReport, 'FAIL');
  assertStructuredError(nameReport);

  const duplicatePath = makeInput();
  duplicatePath.evidence[0].sources[1].path = 'skills/alpha/SKILL.md';
  const pathReport = evaluateMarketplaceRuntimeAcceptance(duplicatePath);
  assertScopeVerdict(pathReport, 'FAIL');
  assertStructuredError(pathReport);
});

test('foreign selector entries cannot reuse a plugin public name', () => {
  const input = makeInput();
  input.evidence[0].sources[2].name = 'alpha';
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('selector rows require observed status and complete stable ID, name, path, and owner fields', () => {
  const cases = [
    (source) => { source.observed = false; },
    (source) => { delete source.stableId; },
    (source) => { delete source.name; },
    (source) => { delete source.path; },
    (source) => { source.owner = 'unknown'; },
  ];
  for (const mutate of cases) {
    const input = makeInput();
    mutate(input.evidence[0].sources[0]);
    const report = evaluateMarketplaceRuntimeAcceptance(input);
    assertScopeVerdict(report, 'FAIL');
    assertStructuredError(report);
  }
});

test('full-consumer measurements must list every observed selector source', () => {
  const input = makeInput();
  input.evidence[0].measurement.fullConsumer.stableIds = ['skill.alpha', 'skill.beta'];
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('plugin contribution measurements must list exactly the plugin-owned selector sources', () => {
  const input = makeInput();
  input.evidence[0].sources[1].owner = 'foreign';
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  assertScopeVerdict(report, 'FAIL');
  assertStructuredError(report);
});

test('a full-consumer overflow fails even when the plugin contribution fits', () => {
  const input = makeInput();
  input.evidence[0].measurement.fullConsumer.value = 2001;
  input.evidence[0].measurement.pluginContribution.value = 30;
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  const failed = assertScopeVerdict(report, 'FAIL');
  assert.strictEqual(failed.budgetReport.measurement.fullConsumer.value, 2001);
  assert.strictEqual(failed.budgetReport.measurement.pluginContribution.value, 30);
  assert.ok(failed.budgetReport.violations.some((violation) => violation.code === 'FULL_CONSUMER_BUDGET_EXCEEDED'));
});

test('unknown Codex model context uses the 8000-character budget with a character estimator', () => {
  const input = makeInput();
  const row = input.evidence[0];
  row.model.contextWindowTokens = null;
  row.measurement.estimator = {
    id: 'unicode-codepoint-counter',
    version: '1',
    unit: 'characters',
    kind: 'estimated',
    documentation: 'Counts Unicode code points in the complete rendered list.',
  };
  row.measurement.fullConsumer = {
    renderedText: 'x'.repeat(8000),
    stableIds: ['skill.alpha', 'skill.beta', 'foreign.gamma'],
    value: 8000,
  };
  row.measurement.pluginContribution = {
    renderedText: 'x',
    stableIds: ['skill.alpha', 'skill.beta'],
    value: 1,
  };
  const report = evaluateMarketplaceRuntimeAcceptance(input);
  const accepted = assertScopeVerdict(report, 'PASS');
  assert.deepStrictEqual(accepted.budgetReport.budget, {
    policy: 'codex-skill-list', version: '2026-10-01', unit: 'characters', limit: 8000,
  });
  assert.strictEqual(accepted.budgetReport.measurement.fullConsumer.value, 8000);
});

test('required context scopes are explicit while NOT_SELECTED and NOT_RUN remain valid evidence states', () => {
  const input = makeInput();
  const accepted = evaluateMarketplaceRuntimeAcceptance(input);
  assert.strictEqual(accepted.ok, true);

  const missing = makeInput();
  delete missing.evidence[0].contextScopes;
  const rejected = evaluateMarketplaceRuntimeAcceptance(missing);
  assertScopeVerdict(rejected, 'FAIL');
  assertStructuredError(rejected);
});

test('discovery-budget PASS keeps workflow runtime explicitly unevaluated', () => {
  const report = evaluateMarketplaceRuntimeAcceptance(makeInput());
  assert.strictEqual(report.verdict, 'PASS');
  assert.strictEqual(report.workflowRuntime, 'NOT_EVALUATED');
});

test('frozen inputs are repeatable and returned reports do not alias captured evidence', () => {
  const input = deepFreeze(makeInput());
  const first = evaluateMarketplaceRuntimeAcceptance(input);
  const second = evaluateMarketplaceRuntimeAcceptance(input);
  assert.deepStrictEqual(first, second);
  first.scopes[0].budgetReport.scope.host = 'changed-after-return';
  assert.strictEqual(second.scopes[0].budgetReport.scope.host, 'codex');
  assert.strictEqual(input.evidence[0].scope.host, 'codex');
});

run('marketplace-runtime-acceptance');
