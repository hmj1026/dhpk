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

module.exports = {
  BUDGET_RESULT_SCHEMA,
  CATEGORIES,
  ESTIMATOR,
  configurationError,
  evaluateDiscoveryBudget,
  evaluateAggregateDiscoveryBudget,
  normalizeEstimator,
  normalizeLimits,
};
