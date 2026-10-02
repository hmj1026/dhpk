'use strict';

// Pure discovery-budget accounting.  The context-budget CLI adapts inventory
// records into this contract; this module deliberately has no filesystem or
// projection-parity dependency.

const { createEvidenceResult, VERDICTS } = require('./distribution-projection-contract');

const BUDGET_RESULT_SCHEMA = 'dhpk.discovery-budget-result.v1';
const ESTIMATOR = Object.freeze({
  id: 'dhpk-conservative-context-estimator',
  version: '1',
  words: 'unicode-whitespace-delimited',
  tokens: 'ceil-unicode-codepoints-divided-by-4',
  aggregation: 'measure-each-entry-then-sum',
});
const CATEGORIES = Object.freeze([
  'claude-skill-description',
  'claude-profile-bundle',
  'claude-user-config',
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = clone(value[key]);
    return output;
  }
  return value;
}

function configurationError(code, message, details = {}) {
  return { code, message, details: clone(details) };
}

function normalizeEstimator(estimator) {
  if (!estimator || typeof estimator !== 'object') return { ...ESTIMATOR };
  return { ...ESTIMATOR, ...clone(estimator) };
}

function normalizeLimits(limits) {
  if (!limits || typeof limits !== 'object') return null;
  if (limits.words === undefined || limits.words === null || limits.tokens === undefined || limits.tokens === null) return null;
  const words = Number(limits.words);
  const tokens = Number(limits.tokens);
  if (!Number.isFinite(words) || words < 0 || !Number.isFinite(tokens) || tokens < 0) return null;
  return { words, tokens };
}

function evaluateDiscoveryBudget({
  items = [],
  category = 'claude-skill-description',
  scope = null,
  estimator = null,
  identity = null,
  stage = 'structural',
  adapter = { id: 'discovery-budget', version: '1' },
} = {}) {
  const effectiveEstimator = normalizeEstimator(estimator);
  const configurationErrors = [];
  const violations = [];
  const entries = [];
  const checkedFields = ['discoveryVisible', 'lifecycle', 'publicationSurface', 'category', 'words', 'tokens', 'limits'];
  if (stage !== 'structural') {
    configurationErrors.push(configurationError('UNSUPPORTED_STAGE', `discovery budget accounting is structural-only; requested '${stage}'`, { stage }));
  }
  if (!CATEGORIES.includes(category)) {
    configurationErrors.push(configurationError('UNKNOWN_CATEGORY', `unsupported discovery budget category '${category}'`, { category }));
  }
  const scoped = scope && typeof scope === 'object';
  const manifestScoped = scoped && scope.kind === 'claude-plugin.userConfig';
  if (scoped && (!identity || typeof identity !== 'object'
    || (manifestScoped
      ? typeof identity.artifactFingerprint !== 'string' || identity.artifactFingerprint.trim() === ''
      : typeof identity.planFingerprint !== 'string' || identity.planFingerprint.trim() === ''
        || typeof identity.artifactFingerprint !== 'string' || identity.artifactFingerprint.trim() === ''))) {
    configurationErrors.push(configurationError(
      'MISSING_SCOPE_IDENTITY',
      manifestScoped ? 'userConfig budget accounting requires a plugin-manifest fingerprint' : 'scoped budget accounting requires plan and artifact fingerprints',
      { scope },
    ));
  }
  if (!Array.isArray(items)) {
    configurationErrors.push(configurationError('INVALID_ITEMS', 'budget accounting items must be an array'));
  }
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const entry = item && typeof item === 'object' ? clone(item) : {};
    const id = typeof entry.stableId === 'string' && entry.stableId.trim() !== ''
      ? entry.stableId
      : typeof entry.id === 'string' && entry.id.trim() !== '' ? entry.id : `<entry-${index}>`;
    entry.stableId = id;
    entry.category = entry.category || category;
    entry.estimator = effectiveEstimator;
    entry.scope = scope || null;
    entry.planFingerprint = identity && identity.planFingerprint || null;
    entry.artifactFingerprint = identity && identity.artifactFingerprint || null;
    entry.discoveryVisible = typeof entry.discoveryVisible === 'boolean' ? entry.discoveryVisible : null;
    entry.publicationSurface = entry.publicationSurface || entry.surface || null;
    entry.limits = normalizeLimits(entry.limits || {
      words: entry.wordBudget,
      tokens: entry.tokenBudget,
    });
    entries.push(entry);
    if (entry.discoveryVisible === null) {
      configurationErrors.push(configurationError('UNKNOWN_DISCOVERY_VISIBILITY', `entry '${id}' has no declared discovery visibility`, { stableId: id, surface: entry.publicationSurface }));
      continue;
    }
    if (!entry.lifecycle || !entry.publicationSurface) {
      configurationErrors.push(configurationError('INCOMPLETE_ACCOUNTING_INPUT', `entry '${id}' requires lifecycle and publication surface`, { stableId: id }));
      continue;
    }
    if (!entry.discoveryVisible) continue;
    if (!entry.limits) {
      configurationErrors.push(configurationError('MISSING_BUDGET_CONFIGURATION', `entry '${id}' has no budget for ${entry.lifecycle}/${entry.publicationSurface}`, { stableId: id, lifecycle: entry.lifecycle, surface: entry.publicationSurface }));
      continue;
    }
    if (!Number.isFinite(Number(entry.words)) || !Number.isFinite(Number(entry.tokens))) {
      configurationErrors.push(configurationError('MISSING_MEASUREMENT', `entry '${id}' has no usable description measurement`, { stableId: id }));
      continue;
    }
    if (Number(entry.words) > entry.limits.words || Number(entry.tokens) > entry.limits.tokens) {
      violations.push({
        ...entry,
        reason: 'description exceeds discovery budget',
        wordBudget: entry.limits.words,
        tokenBudget: entry.limits.tokens,
      });
    }
  }
  const verdict = configurationErrors.length > 0
    ? 'NOT_CONFIGURED'
    : violations.length > 0 ? 'FAIL' : 'PASS';
  const evidenceInput = createEvidenceResult({
    stage,
    adapter,
    planFingerprint: identity && identity.planFingerprint || null,
    artifactFingerprint: identity && identity.artifactFingerprint || null,
    claims: [`discovery budget category ${category}`, 'explicit visibility and budget accounting'],
    observations: [`checked ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`, `estimator ${effectiveEstimator.id}@${effectiveEstimator.version}`],
    verdict,
    diagnostics: [
      ...configurationErrors.map((error) => `${error.code}: ${error.message}`),
      ...violations.map((entry) => `${entry.stableId}: ${entry.reason}`),
    ],
  });
  const evidence = evidenceInput.ok ? evidenceInput.value : {
    stage,
    adapter,
    verdict: VERDICTS.includes(verdict) ? verdict : 'NOT_CONFIGURED',
    diagnostics: ['unable to construct canonical budget evidence'],
  };
  const categories = {};
  for (const entry of entries) {
    const key = entry.category || category;
    if (!categories[key]) categories[key] = { entries: 0, discoveryVisible: 0, violations: 0 };
    categories[key].entries += 1;
    if (entry.discoveryVisible === true) categories[key].discoveryVisible += 1;
  }
  for (const entry of violations) {
    const key = entry.category || category;
    if (!categories[key]) categories[key] = { entries: 0, discoveryVisible: 0, violations: 0 };
    categories[key].violations += 1;
  }
  return {
    schema: BUDGET_RESULT_SCHEMA,
    category,
    scope,
    estimator: effectiveEstimator,
    identity: identity || null,
    checkedFields,
    entries,
    violations,
    configurationErrors,
    categories,
    totals: {
      entries: entries.length,
      discoveryVisible: entries.filter((entry) => entry.discoveryVisible === true).length,
      optionalDiscoveryVisible: entries.filter((entry) => entry.discoveryVisible === true && entry.lifecycle === 'optional').length,
      violations: violations.length,
    },
    evidence,
    ok: verdict === 'PASS',
  };
}

function evaluateAggregateDiscoveryBudget({
  items = [],
  baseline = { entries: 0, tokens: 0 },
  maxEntries = 15,
  minReductionPercent = 70,
} = {}) {
  const configurationErrors = [];
  if (!Array.isArray(items)) {
    configurationErrors.push(configurationError('INVALID_AGGREGATE_ITEMS', 'aggregate budget items must be an array'));
  }
  const selected = (Array.isArray(items) ? items : []).filter((item) => item && item.discoveryVisible === true);
  const baselineEntries = Number(baseline && baseline.entries);
  const baselineTokens = Number(baseline && baseline.tokens);
  const entryLimit = Number(maxEntries);
  const reductionLimit = Number(minReductionPercent);
  if (!Number.isSafeInteger(baselineEntries) || baselineEntries < 0) configurationErrors.push(configurationError('INVALID_AGGREGATE_BASELINE_ENTRIES', 'aggregate baseline entries must be a non-negative integer'));
  if (!Number.isFinite(baselineTokens) || baselineTokens <= 0) configurationErrors.push(configurationError('INVALID_AGGREGATE_BASELINE_TOKENS', 'aggregate baseline tokens must be a positive number'));
  if (!Number.isSafeInteger(entryLimit) || entryLimit < 0) configurationErrors.push(configurationError('INVALID_AGGREGATE_ENTRY_LIMIT', 'aggregate entry ceiling must be a non-negative integer'));
  if (!Number.isFinite(reductionLimit) || reductionLimit < 0 || reductionLimit > 100) configurationErrors.push(configurationError('INVALID_AGGREGATE_REDUCTION_LIMIT', 'aggregate reduction target must be between 0 and 100'));
  for (const [index, item] of selected.entries()) {
    const id = item && (item.stableId || item.id) || `<entry-${index}>`;
    if (!Number.isFinite(Number(item.tokens)) || Number(item.tokens) < 0) {
      configurationErrors.push(configurationError('MISSING_AGGREGATE_MEASUREMENT', `aggregate entry '${id}' has no usable token measurement`, { stableId: id }));
    }
  }
  const tokens = selected.reduce((total, item) => total + (Number.isFinite(Number(item.tokens)) && Number(item.tokens) >= 0 ? Number(item.tokens) : 0), 0);
  const reductionPercent = baselineTokens > 0 ? ((baselineTokens - tokens) / baselineTokens) * 100 : 0;
  const excessEntries = selected.length > entryLimit ? selected.slice(entryLimit).map((item) => item.stableId || item.id) : [];
  const violations = [];
  if (Number.isFinite(entryLimit) && selected.length > entryLimit) {
    violations.push({ reason: 'aggregate entry ceiling exceeded', entries: selected.length, maxEntries: entryLimit, excessEntries });
  }
  if (Number.isFinite(reductionLimit) && reductionPercent < reductionLimit) {
    violations.push({ reason: 'aggregate token reduction target not met', baselineTokens, tokens, reductionPercent, minReductionPercent: reductionLimit });
  }
  return {
    entries: selected.length,
    tokens,
    baseline: { entries: baselineEntries, tokens: baselineTokens },
    reductionPercent,
    maxEntries: entryLimit,
    minReductionPercent: reductionLimit,
    excessEntries,
    violations,
    configurationErrors,
    ok: configurationErrors.length === 0 && violations.length === 0,
  };
}

// Rendered discovery-budget accounting (structural stage only).  Measures the
// full rendered consumer list a Host shows at startup against a per-scope
// ceiling; the plugin contribution is reported beside it but never waives a
// full-list overflow.  Runtime observation and role/packet/reference
// acceptance are outside this contract.

const RENDERED_BUDGET_RESULT_SCHEMA = 'dhpk.rendered-discovery-budget-result.v1';
const CODEX_SKILL_LIST_POLICY = Object.freeze({
  host: 'codex',
  policy: 'codex-skill-list',
  version: '2026-10-01',
  contextShareDivisor: 50,
  unknownContextCharacters: 8000,
});
const RENDERED_UNITS = Object.freeze(['tokens', 'characters']);
const RENDERED_CONSUMERS = Object.freeze(['clean', 'coexistence']);
const ESTIMATOR_KINDS = Object.freeze(['observed', 'estimated']);
const OBSERVABILITY = Object.freeze(['included', 'not-observable']);
const REQUIRED_COVERAGE = Object.freeze(['names', 'descriptions', 'filePaths']);
const OBSERVABLE_COVERAGE = Object.freeze(['hostMetadata', 'hostOverhead']);
const FINGERPRINT_FIELDS = Object.freeze(['planFingerprint', 'selectionFingerprint', 'artifactFingerprint']);
const RENDERED_ADAPTER = Object.freeze({ id: 'rendered-discovery-budget', version: '1' });

function isNonblank(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Copy into plain JSON data: drops undefined/function members, maps
// non-finite numbers to null, and never shares references with the input.
function jsonCopy(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : jsonCopy(item)));
  if (isRecord(value)) {
    const output = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined && typeof value[key] !== 'function') output[key] = jsonCopy(value[key]);
    }
    return output;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value === undefined ? null : value;
}

function uniqueNonblankIds(ids) {
  return Array.isArray(ids) && ids.every(isNonblank) && new Set(ids).size === ids.length;
}

function sameIdSet(left, right) {
  const rightSet = new Set(right);
  return left.length === right.length && left.every((id) => rightSet.has(id));
}

function validateRenderedScope(scope, errors) {
  const valid = isRecord(scope)
    && isNonblank(scope.host)
    && isNonblank(scope.hostVersion)
    && isNonblank(scope.profile)
    && RENDERED_CONSUMERS.includes(scope.consumer);
  if (!valid) {
    errors.push(configurationError('INVALID_SCOPE', 'rendered budget scope requires nonblank host, hostVersion, profile and a clean|coexistence consumer'));
  }
  const echo = isRecord(scope)
    ? { host: scope.host, hostVersion: scope.hostVersion, profile: scope.profile, consumer: scope.consumer }
    : null;
  return { valid, echo };
}

function validateRenderedIdentity(identity, errors) {
  const fingerprints = isRecord(identity) && FINGERPRINT_FIELDS.every((field) => isNonblank(identity[field]));
  if (!fingerprints) {
    errors.push(configurationError('MISSING_SCOPE_IDENTITY', 'rendered budget accounting requires plan, selection and artifact fingerprints'));
  }
  const selection = isRecord(identity) && uniqueNonblankIds(identity.selectedStableIds);
  if (isRecord(identity) && !selection) {
    errors.push(configurationError('INVALID_SELECTION', 'selectedStableIds must be an array of unique nonblank stable IDs'));
  }
  const echo = isRecord(identity)
    ? {
      planFingerprint: identity.planFingerprint,
      selectionFingerprint: identity.selectionFingerprint,
      artifactFingerprint: identity.artifactFingerprint,
      selectedStableIds: identity.selectedStableIds,
    }
    : null;
  return { fingerprints, selection, echo };
}

// Returns { valid, contextWindowTokens, echo }; null/omitted context means
// the effective model context is unknown, never a guessed default.
function resolveRenderedModel(model, errors) {
  if (!isRecord(model) || !isNonblank(model.id)) {
    errors.push(configurationError('INVALID_MODEL_CONTEXT', 'model must have a nonblank id and an optional positive safe-integer contextWindowTokens'));
    return { valid: false, contextWindowTokens: null, echo: null };
  }
  const supplied = model.contextWindowTokens;
  if (supplied === undefined || supplied === null) {
    return { valid: true, contextWindowTokens: null, echo: { id: model.id, contextWindowTokens: null } };
  }
  if (!Number.isSafeInteger(supplied) || supplied <= 0) {
    errors.push(configurationError('INVALID_MODEL_CONTEXT', 'supplied contextWindowTokens must be a positive safe integer', { contextWindowTokens: jsonCopy(supplied) }));
    return { valid: false, contextWindowTokens: null, echo: { id: model.id, contextWindowTokens: supplied } };
  }
  return { valid: true, contextWindowTokens: supplied, echo: { id: model.id, contextWindowTokens: supplied } };
}

function resolveCodexBudget(budget, model, errors) {
  if (budget.policy !== CODEX_SKILL_LIST_POLICY.policy || budget.version !== CODEX_SKILL_LIST_POLICY.version) {
    errors.push(configurationError('UNSUPPORTED_BUDGET_POLICY', `codex scope supports only ${CODEX_SKILL_LIST_POLICY.policy}@${CODEX_SKILL_LIST_POLICY.version}`, { policy: jsonCopy(budget.policy), version: jsonCopy(budget.version) }));
    return null;
  }
  if (budget.unit !== undefined || budget.limit !== undefined) {
    errors.push(configurationError('INVALID_BUDGET_CONFIGURATION', 'codex-skill-list derives unit and limit from the model context; do not supply them'));
    return null;
  }
  if (!model.valid) return null;
  const base = { policy: CODEX_SKILL_LIST_POLICY.policy, version: CODEX_SKILL_LIST_POLICY.version };
  // Exactly 2% of a known context, unrounded; division keeps it exact.
  return model.contextWindowTokens === null
    ? { ...base, unit: 'characters', limit: CODEX_SKILL_LIST_POLICY.unknownContextCharacters }
    : { ...base, unit: 'tokens', limit: model.contextWindowTokens / CODEX_SKILL_LIST_POLICY.contextShareDivisor };
}

// Non-Codex hosts must configure every field; nothing is inherited.
function resolveConfiguredBudget(budget, errors) {
  if (!isNonblank(budget.policy) || !isNonblank(budget.version)) {
    errors.push(configurationError('INVALID_BUDGET_CONFIGURATION', 'configured budget requires nonblank policy and version'));
    return null;
  }
  if (budget.policy !== 'configured') {
    errors.push(configurationError('UNSUPPORTED_BUDGET_POLICY', 'non-Codex scopes require the configured policy', { policy: budget.policy }));
    return null;
  }
  const limitValid = typeof budget.limit === 'number' && Number.isFinite(budget.limit) && budget.limit >= 0;
  if (!RENDERED_UNITS.includes(budget.unit) || !limitValid) {
    errors.push(configurationError('INVALID_BUDGET_CONFIGURATION', 'configured budget requires unit tokens|characters and a nonnegative finite limit', { unit: jsonCopy(budget.unit), limit: jsonCopy(budget.limit) }));
    return null;
  }
  return { policy: budget.policy, version: budget.version, unit: budget.unit, limit: budget.limit };
}

function resolveRenderedBudget(scope, budget, model, errors) {
  if (!scope.valid) return null;
  if (budget === undefined || budget === null) {
    errors.push(configurationError('MISSING_BUDGET_CONFIGURATION', `no rendered discovery budget configured for host '${scope.echo.host}'`, { host: scope.echo.host }));
    return null;
  }
  if (!isRecord(budget)) {
    errors.push(configurationError('INVALID_BUDGET_CONFIGURATION', 'budget must be an object'));
    return null;
  }
  return scope.echo.host === CODEX_SKILL_LIST_POLICY.host
    ? resolveCodexBudget(budget, model, errors)
    : resolveConfiguredBudget(budget, errors);
}

function validateRenderedEstimator(estimator, errors) {
  const valid = isRecord(estimator)
    && isNonblank(estimator.id)
    && isNonblank(estimator.version)
    && RENDERED_UNITS.includes(estimator.unit)
    && ESTIMATOR_KINDS.includes(estimator.kind)
    && isNonblank(estimator.documentation);
  if (!valid) {
    errors.push(configurationError('INVALID_ESTIMATOR', 'estimator requires nonblank id, version and documentation, unit tokens|characters and kind observed|estimated'));
    return null;
  }
  const legacyDefault = estimator.id === ESTIMATOR.id || estimator.documentation.trim() === ESTIMATOR.tokens;
  if (estimator.unit === 'tokens' && legacyDefault) {
    errors.push(configurationError('INVALID_ESTIMATOR', 'token measurements require a tokenizer or Host-documented estimator, not the 4-characters-per-token default', { id: estimator.id }));
    return null;
  }
  return {
    id: estimator.id,
    version: estimator.version,
    unit: estimator.unit,
    kind: estimator.kind,
    documentation: estimator.documentation,
  };
}

function validateRenderedCoverage(coverage, errors) {
  const valid = isRecord(coverage)
    && REQUIRED_COVERAGE.every((field) => coverage[field] === true)
    && OBSERVABLE_COVERAGE.every((field) => OBSERVABILITY.includes(coverage[field]));
  if (!valid) {
    errors.push(configurationError('INCOMPLETE_RENDERED_COVERAGE', 'coverage must include names, descriptions and filePaths, and declare hostMetadata/hostOverhead as included|not-observable'));
    return isRecord(coverage) ? jsonCopy(coverage) : null;
  }
  return {
    names: true,
    descriptions: true,
    filePaths: true,
    hostMetadata: coverage.hostMetadata,
    hostOverhead: coverage.hostOverhead,
  };
}

function measureRenderedValue(text, supplied, unit) {
  if (unit === 'characters') {
    const counted = Array.from(text).length;
    return supplied === undefined || supplied === counted ? counted : null;
  }
  return Number.isSafeInteger(supplied) && supplied >= 0 ? supplied : null;
}

function validateRenderedList(name, list, unit, errors) {
  if (!isRecord(list) || typeof list.renderedText !== 'string' || !uniqueNonblankIds(list.stableIds)) {
    errors.push(configurationError('INVALID_MEASUREMENT', `${name} requires renderedText and unique nonblank stableIds`));
    return null;
  }
  const value = unit ? measureRenderedValue(list.renderedText, list.value, unit) : null;
  if (unit && value === null) {
    errors.push(configurationError('INVALID_MEASUREMENT', unit === 'characters'
      ? `${name} supplied value does not equal its Unicode code-point count`
      : `${name} token value must be a nonnegative safe integer`, { supplied: jsonCopy(list.value) }));
  }
  return { renderedText: list.renderedText, stableIds: [...list.stableIds], value };
}

function checkMeasurementIdentity(measured, identity, errors) {
  if (!identity.fingerprints) return;
  const matches = isRecord(measured) && FINGERPRINT_FIELDS.every((field) => measured[field] === identity.echo[field]);
  if (!matches) {
    errors.push(configurationError('MEASUREMENT_IDENTITY_MISMATCH', 'measurement fingerprints must equal the scope plan, selection and artifact fingerprints'));
  }
}

function checkRenderedSelection(full, plugin, identity, errors) {
  if (!full || !plugin) return;
  const fullIds = new Set(full.stableIds);
  const pluginSelected = !identity.selection || sameIdSet(plugin.stableIds, identity.echo.selectedStableIds);
  if (!pluginSelected || !plugin.stableIds.every((id) => fullIds.has(id))) {
    errors.push(configurationError('SELECTION_MISMATCH', 'plugin stable IDs must equal the selected set and be a subset of the full consumer list'));
  }
  if (full.value !== null && plugin.value !== null && plugin.value > full.value) {
    errors.push(configurationError('INVALID_MEASUREMENT', 'plugin contribution cannot exceed the full consumer value', { full: full.value, plugin: plugin.value }));
  }
}

function validateRenderedMeasurement(measurement, identity, budget, errors) {
  if (measurement === undefined || measurement === null) {
    errors.push(configurationError('MISSING_MEASUREMENT', 'rendered budget accounting requires a measurement'));
    return null;
  }
  if (!isRecord(measurement)) {
    errors.push(configurationError('INVALID_MEASUREMENT', 'measurement must be an object'));
    return null;
  }
  checkMeasurementIdentity(measurement.identity, identity, errors);
  const estimator = validateRenderedEstimator(measurement.estimator, errors);
  if (estimator && budget && estimator.unit !== budget.unit) {
    errors.push(configurationError('UNIT_MISMATCH', `estimator unit '${estimator.unit}' does not match budget unit '${budget.unit}'`));
  }
  const coverage = validateRenderedCoverage(measurement.coverage, errors);
  const unit = estimator ? estimator.unit : null;
  const fullConsumer = validateRenderedList('fullConsumer', measurement.fullConsumer, unit, errors);
  const pluginContribution = validateRenderedList('pluginContribution', measurement.pluginContribution, unit, errors);
  checkRenderedSelection(fullConsumer, pluginContribution, identity, errors);
  return {
    identity: isRecord(measurement.identity) ? jsonCopy(measurement.identity) : null,
    estimator,
    coverage,
    fullConsumer,
    pluginContribution,
  };
}

function renderedBudgetViolations(budget, measurement) {
  const value = measurement.fullConsumer.value;
  if (value <= budget.limit) return [];
  return [{
    code: 'FULL_CONSUMER_BUDGET_EXCEEDED',
    message: `full consumer list ${value} ${budget.unit} exceeds limit ${budget.limit}`,
    unit: budget.unit,
    limit: budget.limit,
    value,
    pluginContribution: measurement.pluginContribution.value,
  }];
}

function renderedBudgetEvidence({ identity, budget, measurement, verdict, configurationErrors, violations }) {
  const fingerprint = (field) => (identity.echo && isNonblank(identity.echo[field]) ? identity.echo[field] : null);
  const envelope = createEvidenceResult({
    stage: 'structural',
    adapter: RENDERED_ADAPTER,
    planFingerprint: fingerprint('planFingerprint'),
    artifactFingerprint: fingerprint('artifactFingerprint'),
    provenance: { selectionFingerprint: fingerprint('selectionFingerprint') },
    claims: ['full rendered consumer list measured against the resolved scope ceiling'],
    observations: [
      budget ? `budget ${budget.policy}@${budget.version}: ${budget.limit} ${budget.unit}` : 'budget unresolved',
      measurement && measurement.estimator ? `estimator ${measurement.estimator.id}@${measurement.estimator.version} (${measurement.estimator.kind})` : 'estimator unresolved',
      'structural stage only; excludes runtime observation and role, packet and reference acceptance',
    ],
    verdict,
    diagnostics: [
      ...configurationErrors.map((error) => `${error.code}: ${error.message}`),
      ...violations.map((violation) => `${violation.code}: ${violation.message}`),
    ],
  });
  return envelope.ok
    ? jsonCopy(envelope.value)
    : { stage: 'structural', adapter: jsonCopy(RENDERED_ADAPTER), verdict: 'NOT_CONFIGURED', diagnostics: ['unable to construct canonical budget evidence'] };
}

function evaluateRenderedDiscoveryBudget({
  scope,
  identity,
  model,
  budget,
  measurement,
} = {}) {
  const configurationErrors = [];
  const scopeResult = validateRenderedScope(scope, configurationErrors);
  const identityResult = validateRenderedIdentity(identity, configurationErrors);
  const modelResult = resolveRenderedModel(model, configurationErrors);
  const resolvedBudget = resolveRenderedBudget(scopeResult, budget, modelResult, configurationErrors);
  const measured = validateRenderedMeasurement(measurement, identityResult, resolvedBudget, configurationErrors);
  const violations = configurationErrors.length === 0 ? renderedBudgetViolations(resolvedBudget, measured) : [];
  const verdict = configurationErrors.length > 0 ? 'NOT_CONFIGURED' : violations.length > 0 ? 'FAIL' : 'PASS';
  const evidence = renderedBudgetEvidence({
    identity: identityResult,
    budget: resolvedBudget,
    measurement: measured,
    verdict,
    configurationErrors,
    violations,
  });
  return jsonCopy({
    schema: RENDERED_BUDGET_RESULT_SCHEMA,
    scope: scopeResult.echo,
    identity: identityResult.echo,
    model: modelResult.echo,
    budget: resolvedBudget,
    measurement: measured,
    configurationErrors,
    violations,
    evidence,
    ok: verdict === 'PASS',
  });
}

module.exports = {
  BUDGET_RESULT_SCHEMA,
  CATEGORIES,
  ESTIMATOR,
  configurationError,
  evaluateDiscoveryBudget,
  evaluateAggregateDiscoveryBudget,
  normalizeEstimator,
  normalizeLimits,
  RENDERED_BUDGET_RESULT_SCHEMA,
  evaluateRenderedDiscoveryBudget,
};
