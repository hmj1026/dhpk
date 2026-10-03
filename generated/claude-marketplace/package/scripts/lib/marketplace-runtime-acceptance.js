'use strict';

const { evaluateRenderedDiscoveryBudget } = require('./discovery-budget');

const CONFIG_SCHEMA = 'dhpk.marketplace-runtime-acceptance.v1';
const RESULT_SCHEMA = 'dhpk.marketplace-runtime-acceptance-result.v1';
const SUPPORTED_HOSTS = new Set(['codex', 'claude', 'cursor', 'agy']);
const SUPPORTED_CONSUMERS = new Set(['clean', 'coexistence']);
const FINGERPRINT_FIELDS = ['planFingerprint', 'selectionFingerprint', 'artifactFingerprint'];
const IDENTITY_FIELDS = [...FINGERPRINT_FIELDS, 'selectedStableIds'];
const CONFIG_FIELDS = ['schema', 'requiredScopes'];
const SCOPE_FIELDS = ['id', 'host', 'profile', 'consumer', 'surface', 'budget', 'rationale'];
const INPUT_FIELDS = ['configuration', 'identities', 'evidence'];
const EVIDENCE_FIELDS = [
  'scopeId', 'sessionId', 'sessionFresh', 'hostVersion', 'scope', 'identity',
  'model', 'measurement', 'sources', 'contextScopes',
];
const SOURCE_FIELDS = ['stableId', 'name', 'path', 'owner', 'observed'];
const CONTEXT_SCOPE_NAMES = ['selectedRoleKernel', 'packet', 'references', 'runtimeObservation'];
const CONTEXT_SCOPE_STATES = new Set([
  'NOT_SELECTED', 'NOT_RUN', 'PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NOT_CONFIGURED',
]);
const VERDICT_RANK = { PASS: 0, NOT_RUN: 1, NOT_CONFIGURED: 2, FAIL: 3 };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonblank(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function hasUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(isNonblank)
    && new Set(value).size === value.length;
}

function sameSet(left, right) {
  return hasUniqueStrings(left)
    && hasUniqueStrings(right)
    && left.length === right.length
    && left.every((value) => right.includes(value));
}

function sameIdentity(actual, expected) {
  return isRecord(actual)
    && isRecord(expected)
    && hasOnlyKeys(actual, IDENTITY_FIELDS)
    && hasOnlyKeys(expected, IDENTITY_FIELDS)
    && FINGERPRINT_FIELDS.every((field) => (
      isNonblank(actual[field]) && actual[field] === expected[field]
    ))
    && hasUniqueStrings(actual.selectedStableIds)
    && hasUniqueStrings(expected.selectedStableIds)
    && sameSet(actual.selectedStableIds, expected.selectedStableIds);
}

function isValidIdentity(identity) {
  return isRecord(identity)
    && hasOnlyKeys(identity, IDENTITY_FIELDS)
    && FINGERPRINT_FIELDS.every((field) => isNonblank(identity[field]))
    && hasUniqueStrings(identity.selectedStableIds);
}

function errorRecord(code, scopeId, message) {
  return { code, scopeId: typeof scopeId === 'string' && scopeId.length > 0 ? scopeId : null, message };
}

function addError(errors, code, scopeId, message) {
  errors.push(errorRecord(code, scopeId, message));
}

function raiseVerdict(scope, verdict) {
  if (VERDICT_RANK[verdict] > VERDICT_RANK[scope.verdict]) scope.verdict = verdict;
}

function normalizedCollisionKey(value) {
  return value.normalize('NFC').toLowerCase();
}

function compareUniqueField(sources, field, errors, scopeId, code, label) {
  const seen = new Set();
  for (const source of sources) {
    if (!isRecord(source) || !isNonblank(source[field])) continue;
    const key = normalizedCollisionKey(source[field]);
    if (seen.has(key)) addError(errors, code, scopeId, `selector sources contain an ambiguous ${label}`);
    seen.add(key);
  }
}

function validateSources(sources, expectedIdentity, measurement, errors, scopeId) {
  if (!Array.isArray(sources)) {
    addError(errors, 'INVALID_SELECTOR_SOURCES', scopeId, 'fresh native selector sources must be an array');
    return;
  }

  const stableIds = [];
  const pluginIds = [];
  for (const source of sources) {
    if (!isRecord(source) || !hasOnlyKeys(source, SOURCE_FIELDS)) {
      addError(errors, 'INVALID_SELECTOR_SOURCE', scopeId, 'selector source rows must use the supported fields');
      continue;
    }
    const valid = isNonblank(source.stableId)
      && isNonblank(source.name)
      && isNonblank(source.path)
      && (source.owner === 'plugin' || source.owner === 'foreign')
      && source.observed === true;
    if (!valid) {
      addError(errors, 'INVALID_SELECTOR_SOURCE', scopeId, 'selector sources require observed stable ID, name, path, and plugin|foreign owner');
      continue;
    }
    stableIds.push(source.stableId);
    if (source.owner === 'plugin') pluginIds.push(source.stableId);
  }

  if (new Set(stableIds).size !== stableIds.length) {
    addError(errors, 'DUPLICATE_SELECTOR_ID', scopeId, 'selector source stable IDs must be unique');
  }
  compareUniqueField(sources, 'name', errors, scopeId, 'AMBIGUOUS_SELECTOR_NAME', 'public name');
  compareUniqueField(sources, 'path', errors, scopeId, 'AMBIGUOUS_SELECTOR_PATH', 'package path');

  if (isValidIdentity(expectedIdentity) && !sameSet(pluginIds, expectedIdentity.selectedStableIds)) {
    addError(errors, 'PLUGIN_SOURCE_SET_MISMATCH', scopeId, 'plugin-owned selector IDs must equal the captured selected stable IDs');
  }

  if (!isRecord(measurement)) return;
  const fullIds = measurement.fullConsumer && measurement.fullConsumer.stableIds;
  if (Array.isArray(fullIds) && !sameSet(fullIds, stableIds)) {
    addError(errors, 'FULL_SELECTOR_SET_MISMATCH', scopeId, 'full-consumer measurement IDs must equal all observed selector source IDs');
  }
  const contributionIds = measurement.pluginContribution && measurement.pluginContribution.stableIds;
  if (Array.isArray(contributionIds) && !sameSet(contributionIds, pluginIds)) {
    addError(errors, 'PLUGIN_CONTRIBUTION_SET_MISMATCH', scopeId, 'plugin contribution IDs must equal observed plugin-owned source IDs');
  }
}

function validateContextScopes(contextScopes, errors, scopeId) {
  if (!isRecord(contextScopes) || !hasOnlyKeys(contextScopes, CONTEXT_SCOPE_NAMES)) {
    addError(errors, 'INVALID_CONTEXT_SCOPES', scopeId, 'all four context scopes must be explicitly recorded');
    return;
  }
  for (const name of CONTEXT_SCOPE_NAMES) {
    const context = contextScopes[name];
    if (!isRecord(context)
      || !hasOnlyKeys(context, ['state'])
      || !CONTEXT_SCOPE_STATES.has(context.state)) {
      addError(errors, 'INVALID_CONTEXT_SCOPE_STATE', scopeId, `context scope ${name} must have a recognized state`);
    }
  }
}

function validateEvidenceRow(row, scope, expectedIdentity, errors) {
  const scopeId = scope.id;
  if (!isRecord(row) || !hasOnlyKeys(row, EVIDENCE_FIELDS)) {
    addError(errors, 'INVALID_EVIDENCE_ROW', scopeId, 'evidence row must use the supported fields');
    return false;
  }
  if (!isNonblank(row.sessionId)) addError(errors, 'MISSING_SESSION_ID', scopeId, 'evidence requires a session ID');
  if (row.sessionFresh !== true) addError(errors, 'STALE_SESSION', scopeId, 'budget acceptance requires a fresh session');
  if (!isNonblank(row.hostVersion)) addError(errors, 'MISSING_HOST_VERSION', scopeId, 'evidence requires the observed Host version');

  if (Object.prototype.hasOwnProperty.call(row, 'scope')) {
    if (!isRecord(row.scope)
      || !hasOnlyKeys(row.scope, ['host', 'profile', 'consumer'])
      || row.scope.host !== scope.configuration.host
      || row.scope.profile !== scope.configuration.profile
      || row.scope.consumer !== scope.configuration.consumer) {
      addError(errors, 'SCOPE_IDENTITY_MISMATCH', scopeId, 'evidence scope must match configured Host, profile, and consumer');
    }
  }

  if (!sameIdentity(row.identity, expectedIdentity)) {
    addError(errors, 'CAPTURED_IDENTITY_MISMATCH', scopeId, 'evidence identity must match all captured fingerprints and selected IDs');
  }
  validateSources(row.sources, expectedIdentity, row.measurement, errors, scopeId);
  validateContextScopes(row.contextScopes, errors, scopeId);
}

function result(verdict, errors, scopes) {
  return {
    schema: RESULT_SCHEMA,
    stage: 'discovery-budget',
    ok: verdict === 'PASS',
    verdict,
    errors,
    scopes: scopes.map((scope) => ({ id: scope.id, verdict: scope.verdict, budgetReport: scope.budgetReport })),
    workflowRuntime: 'NOT_EVALUATED',
  };
}

function aggregateVerdict(globalVerdict, scopes) {
  let verdict = globalVerdict;
  for (const scope of scopes) {
    if (VERDICT_RANK[scope.verdict] > VERDICT_RANK[verdict]) verdict = scope.verdict;
  }
  return verdict;
}

function evaluateMarketplaceRuntimeAcceptance(input = {}) {
  const errors = [];
  try {
    if (!isRecord(input) || !hasOnlyKeys(input, INPUT_FIELDS)) {
      addError(errors, 'INVALID_INPUT', null, 'runtime acceptance input must contain configuration, identities, and evidence');
      return result('NOT_CONFIGURED', errors, []);
    }

    const configuration = input.configuration;
    if (!isRecord(configuration)
      || !hasOnlyKeys(configuration, CONFIG_FIELDS)
      || configuration.schema !== CONFIG_SCHEMA
      || !Array.isArray(configuration.requiredScopes)) {
      addError(errors, 'INVALID_CONFIGURATION', null, 'runtime acceptance configuration has an unsupported schema or shape');
      return result('NOT_CONFIGURED', errors, []);
    }
    if (configuration.requiredScopes.length === 0) {
      addError(errors, 'NO_REQUIRED_SCOPES', null, 'runtime acceptance requires at least one configured scope');
      return result('NOT_CONFIGURED', errors, []);
    }

    const scopes = configuration.requiredScopes.map((scopeConfig) => ({
      id: isRecord(scopeConfig) && isNonblank(scopeConfig.id) ? scopeConfig.id : null,
      configuration: scopeConfig,
      verdict: 'PASS',
      budgetReport: null,
    }));
    const ids = new Map();

    for (const scope of scopes) {
      const scopeConfig = scope.configuration;
      if (!isRecord(scopeConfig) || !hasOnlyKeys(scopeConfig, SCOPE_FIELDS)) {
        addError(errors, 'INVALID_REQUIRED_SCOPE', scope.id, 'required scope has an unsupported shape');
        raiseVerdict(scope, 'NOT_CONFIGURED');
        continue;
      }
      const requiredValues = ['id', 'host', 'profile', 'consumer', 'surface', 'rationale'];
      if (requiredValues.some((field) => !isNonblank(scopeConfig[field]))) {
        addError(errors, 'INCOMPLETE_REQUIRED_SCOPE', scope.id, 'required scope needs ID, Host, profile, consumer, surface, and rationale');
        raiseVerdict(scope, 'NOT_CONFIGURED');
      }
      if (!SUPPORTED_HOSTS.has(scopeConfig.host)) {
        addError(errors, 'UNSUPPORTED_HOST', scope.id, 'required scope Host is outside the supported host set');
        raiseVerdict(scope, 'NOT_CONFIGURED');
      }
      if (!SUPPORTED_CONSUMERS.has(scopeConfig.consumer)) {
        addError(errors, 'UNSUPPORTED_CONSUMER', scope.id, 'required scope consumer must be clean or coexistence');
        raiseVerdict(scope, 'NOT_CONFIGURED');
      }
      if (!isRecord(scopeConfig.budget)) {
        addError(errors, 'MISSING_BUDGET_CONFIGURATION', scope.id, 'required scope needs an explicit discovery budget');
        raiseVerdict(scope, 'NOT_CONFIGURED');
      }
      if (scope.id !== null) {
        const prior = ids.get(scope.id);
        if (prior) {
          addError(errors, 'DUPLICATE_REQUIRED_SCOPE', scope.id, 'configured scope IDs must be unique');
          raiseVerdict(scope, 'FAIL');
          raiseVerdict(prior, 'FAIL');
        } else {
          ids.set(scope.id, scope);
        }
      }
    }

    if (!isRecord(input.identities)) {
      addError(errors, 'INVALID_EXPECTED_IDENTITIES', null, 'captured identities must be keyed by surface');
      for (const scope of scopes) raiseVerdict(scope, 'FAIL');
    } else {
      const expectedSurfaces = new Set(scopes
        .map((scope) => scope.configuration && scope.configuration.surface)
        .filter(isNonblank));
      for (const surface of Object.keys(input.identities)) {
        if (!expectedSurfaces.has(surface)) {
          addError(errors, 'UNKNOWN_IDENTITY_SURFACE', null, 'captured identities include a surface with no required scope');
          for (const scope of scopes) raiseVerdict(scope, 'FAIL');
        }
      }
      for (const scope of scopes) {
        const surface = scope.configuration && scope.configuration.surface;
        if (!isNonblank(surface)) continue;
        const expectedIdentity = Object.prototype.hasOwnProperty.call(input.identities, surface)
          ? input.identities[surface]
          : null;
        scope.expectedIdentity = expectedIdentity;
        if (!isValidIdentity(expectedIdentity)) {
          addError(errors, 'MISSING_OR_INVALID_SURFACE_IDENTITY', scope.id, 'surface identity must capture all fingerprints and selected IDs');
          raiseVerdict(scope, 'FAIL');
        }
      }
    }

    if (!Array.isArray(input.evidence)) {
      addError(errors, input.evidence === undefined ? 'MISSING_EVIDENCE' : 'INVALID_EVIDENCE', null, 'runtime evidence must be supplied as a row array');
      raiseAll(scopes, input.evidence === undefined ? 'NOT_RUN' : 'FAIL');
    } else {
      const evidenceByScope = new Map();
      for (const row of input.evidence) {
        if (!isRecord(row) || !isNonblank(row.scopeId)) {
          addError(errors, 'INVALID_EVIDENCE_ROW', null, 'evidence rows require a configured scope ID');
          for (const scope of scopes) raiseVerdict(scope, 'FAIL');
          continue;
        }
        const configuredScope = ids.get(row.scopeId);
        if (!configuredScope) {
          addError(errors, 'UNKNOWN_EVIDENCE_SCOPE', row.scopeId, 'evidence row has no required scope');
          raiseAll(scopes, 'FAIL');
          continue;
        }
        if (evidenceByScope.has(row.scopeId)) {
          addError(errors, 'DUPLICATE_SCOPE_EVIDENCE', row.scopeId, 'each required scope must have exactly one evidence row');
          raiseVerdict(configuredScope, 'FAIL');
          continue;
        }
        evidenceByScope.set(row.scopeId, row);
      }

      for (const scope of scopes) {
        if (scope.id === null || !ids.has(scope.id)) continue;
        const row = evidenceByScope.get(scope.id);
        if (!row) {
          addError(errors, 'MISSING_REQUIRED_EVIDENCE', scope.id, 'required runtime evidence has not been captured');
          raiseVerdict(scope, 'NOT_RUN');
          continue;
        }
        if (scope.verdict === 'FAIL' || scope.verdict === 'NOT_CONFIGURED') continue;

        const rowErrors = [];
        validateEvidenceRow(row, scope, scope.expectedIdentity, rowErrors);
        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
          raiseVerdict(scope, 'FAIL');
          continue;
        }

        try {
          scope.budgetReport = evaluateRenderedDiscoveryBudget({
            scope: {
              host: scope.configuration.host,
              hostVersion: row.hostVersion,
              profile: scope.configuration.profile,
              consumer: scope.configuration.consumer,
            },
            identity: scope.expectedIdentity,
            model: row.model,
            budget: scope.configuration.budget,
            measurement: row.measurement,
          });
        } catch {
          addError(errors, 'BUDGET_EVALUATION_FAILED', scope.id, 'rendered discovery budget evaluation failed safely');
          raiseVerdict(scope, 'FAIL');
          continue;
        }

        const budgetErrors = scope.budgetReport.configurationErrors || [];
        const violations = scope.budgetReport.violations || [];
        if (budgetErrors.length > 0) {
          for (const error of budgetErrors) {
            addError(errors, error.code || 'BUDGET_NOT_CONFIGURED', scope.id, error.message || 'rendered budget is not configured');
          }
          raiseVerdict(scope, 'NOT_CONFIGURED');
        } else if (violations.length > 0 || scope.budgetReport.ok !== true) {
          if (violations.length > 0) {
            for (const violation of violations) {
              addError(errors, violation.code || 'BUDGET_EXCEEDED', scope.id, violation.message || 'rendered consumer exceeds its configured budget');
            }
          } else {
            addError(errors, 'BUDGET_NOT_PASSED', scope.id, 'rendered discovery budget did not pass');
          }
          raiseVerdict(scope, 'FAIL');
        }
      }
    }

    return result(aggregateVerdict('PASS', scopes), errors, scopes);
  } catch {
    addError(errors, 'INVALID_RUNTIME_ACCEPTANCE_INPUT', null, 'runtime acceptance input could not be evaluated safely');
    return result('NOT_CONFIGURED', errors, []);
  }
}

function raiseAll(scopes, verdict) {
  for (const scope of scopes) raiseVerdict(scope, verdict);
}

module.exports = { evaluateMarketplaceRuntimeAcceptance };
