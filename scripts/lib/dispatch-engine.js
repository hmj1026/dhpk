'use strict';

const {
  CAPABILITY_STATUSES,
  EFFORTS,
  createDispatchRequest,
  createExecutionTarget,
  createProviderModelCatalog,
} = require('./dispatch-contract');
const { authorizeCapability, createCapabilityEvidence } = require('./dispatch-capability-evidence');

const FAILURE_CLASSES = Object.freeze({
  CLI_UNAVAILABLE: 'CLI_UNAVAILABLE',
  AUTHENTICATION_OR_MODEL_UNAVAILABLE: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
  QUOTA_OR_RATE_LIMIT: 'QUOTA_OR_RATE_LIMIT',
  SAFETY_OR_USER_DENIAL: 'SAFETY_OR_USER_DENIAL',
  TASK_OR_SEMANTIC_FAILURE: 'TASK_OR_SEMANTIC_FAILURE',
  TIMEOUT_OR_INTERRUPTION: 'TIMEOUT_OR_INTERRUPTION',
});

const AVAILABILITY_FAILURES = new Set([
  FAILURE_CLASSES.CLI_UNAVAILABLE,
  FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE,
]);

const FALLBACK_ACTIONS = Object.freeze({
  [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL]: 'stop',
  [FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE]: 'repair',
  [FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION]: 'reconcile',
  [FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT]: 'stop',
});

const unique = (items) => [...new Set(items)];

const TARGET_AGENT_ALIASES = Object.freeze({
  claude: 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  agy: 'agy',
  cursor: 'cursor',
  native: 'cursor', // compatibility spelling; config parser records its deprecation
  'cursor-native': 'cursor', // compatibility spelling; config parser records its deprecation
});
const PROVIDER_ALIASES = Object.freeze({
  'claude-code': 'anthropic',
  'codex-cli': 'openai',
  agy: 'google',
  'cursor-native': 'xai',
});
function canonicalAgent(value) {
  return value === undefined || value === null ? undefined : TARGET_AGENT_ALIASES[value] || value;
}

function canonicalProvider(value) {
  return value === undefined || value === null ? undefined : PROVIDER_ALIASES[value] || value;
}

function routeAgentMatches(routeAgent, targetAgent) {
  return !targetAgent || canonicalAgent(routeAgent) === canonicalAgent(targetAgent);
}

function modelView(catalog, route) {
  const raw = catalog.models && catalog.models[`${route.provider}/${route.model_id}`];
  if (!raw) return null;
  return {
    id: route.model_id,
    model_id: route.model_id,
    display_name: raw.display_name,
    pricing: raw.pricing,
    roles: route.roles,
    efforts: route.efforts,
    transports: [route.transport],
    authorities: route.authorities,
    effort_mapping: route.parameter_mapping && route.parameter_mapping.effort || {},
  };
}

function modelForCandidate({ provider, requestedModel, request, catalog, native, targetAgent, requestedRoute, requestedTransport }) {
  const normalizedProvider = canonicalProvider(provider);
  const normalizedAgent = canonicalAgent(targetAgent);
  const routes = Array.isArray(catalog.routes) ? catalog.routes : [];
  const identityRoutes = routes.filter((route) => route.host === request.host_profile.host
    && routeAgentMatches(route.target_agent, normalizedAgent)
    && (!normalizedProvider || route.provider === normalizedProvider)
    && (!requestedModel || route.model_id === requestedModel)
    && (!requestedRoute || route.route === requestedRoute)
    && (!requestedTransport || route.transport === requestedTransport));
  let base = identityRoutes;
  if (native) base = base.filter((route) => route.model_id === request.host_profile.native_model);
  if (base.length === 0) {
    const identity = [normalizedAgent || 'target-agent', normalizedProvider || 'provider', requestedModel || 'model'].join('/');
    return { status: 'UNAVAILABLE', reason: `Route for ${identity} is unsupported for Host ${request.host_profile.host}` };
  }
  const roleMatches = base.filter((route) => route.roles.includes(request.role));
  if (roleMatches.length === 0) {
    return { status: 'UNAVAILABLE', reason: `Model route for ${normalizedProvider || 'requested Provider'}/${requestedModel || 'requested Model'} does not support Role ${request.role}` };
  }
  const authorityMatches = roleMatches.filter((route) => route.authorities.includes(request.authority));
  if (authorityMatches.length === 0) {
    return { status: 'BLOCKED', reason: `Model route for ${normalizedProvider || 'requested Provider'}/${requestedModel || 'requested Model'} does not permit authority ${request.authority}` };
  }
  const unsupportedEffortRoutes = authorityMatches.filter((route) => route.effort_binding === 'unsupported');
  if (request.effort !== undefined && unsupportedEffortRoutes.length === authorityMatches.length) {
    return {
      status: 'BLOCKED',
      reason: `Model route for ${normalizedProvider || 'requested Provider'}/${requestedModel || 'requested Model'} cannot express Effort ${request.effort}`,
    };
  }
  const matches = request.effort === undefined
    ? authorityMatches
    : authorityMatches.filter((route) => route.efforts.includes(request.effort));
  if (matches.length === 0) {
    return { status: 'UNAVAILABLE', reason: `Model route for ${normalizedProvider || 'requested Provider'}/${requestedModel || 'requested Model'} does not support Effort ${request.effort}` };
  }
  const route = matches[0];
  const model = modelView(catalog, route);
  if (!model) return { status: 'UNAVAILABLE', reason: `Model ${route.provider}/${route.model_id} is absent from the catalog` };
  return { status: 'FOUND', model, route, provider: route.provider, targetAgent: route.target_agent };
}

function candidateModel({ provider, model, request, catalog, targetAgent, route, transport }) {
  return modelForCandidate({
    provider,
    requestedModel: model,
    request,
    catalog,
    native: model === undefined && canonicalProvider(provider) === request.host_profile.native_provider
      && canonicalAgent(targetAgent) === request.host_profile.native_target_agent,
    targetAgent,
    requestedRoute: route,
    requestedTransport: transport,
  });
}

function evaluateCandidate(request, candidate, catalog) {
  const targetAgent = canonicalAgent(candidate.target_agent || candidate.targetAgent);
  const requestedProvider = canonicalProvider(candidate.provider);
  const roleDefault = request.host_profile.role_defaults && request.host_profile.role_defaults[request.role];
  const effectiveEffort = candidate.effort || request.effort || roleDefault && roleDefault.effort;
  const effectiveRequest = effectiveEffort === request.effort
    ? request
    : Object.freeze({ ...request, effort: effectiveEffort });
  const modelResult = candidateModel({
    provider: requestedProvider,
    model: candidate.model || candidate.model_id,
    request: effectiveRequest,
    catalog,
    targetAgent,
    route: candidate.route,
    transport: candidate.transport,
  });
  if (modelResult.status !== 'FOUND') {
    return { ...modelResult, provider: requestedProvider || null, model: candidate.model || candidate.model_id || null, probe_performed: false, fallback_eligible: false };
  }

  const provider = modelResult.provider;
  if (!effectiveRequest.host_profile.allowed_providers.includes(provider)) {
    return {
      status: 'BLOCKED', provider, model: modelResult.model.id,
      reason: `Host policy does not allow Provider ${provider}`,
      probe_performed: false, fallback_eligible: false,
    };
  }
  const access = effectiveRequest.host_profile.access[provider];
  if (!access) {
    return {
      status: 'BLOCKED', provider, model: modelResult.model.id,
      reason: `Host profile has no access evidence for Provider ${provider}`,
      probe_performed: false, fallback_eligible: false,
    };
  }
  if (!CAPABILITY_STATUSES.includes(access.status)) {
    return {
      status: 'BLOCKED', provider, model: modelResult.model.id,
      reason: `Host access status for ${provider} is invalid`,
      probe_performed: false, fallback_eligible: false,
    };
  }

  const model = modelResult.model;
  const transport = candidate.transport || modelResult.route.transport;
  const target = createExecutionTarget({
    target_agent: targetAgent || modelResult.targetAgent,
    provider,
    model_id: model.id,
    route: candidate.route || modelResult.route.route,
    effort: effectiveRequest.effort,
    transport,
    native: modelResult.route.route === 'native'
      && provider === effectiveRequest.host_profile.native_provider
      && model.id === effectiveRequest.host_profile.native_model,
  });
  if (!model.roles.includes(effectiveRequest.role)) {
    return { status: 'UNAVAILABLE', provider, model: model.id, target, reason: `Model ${provider}/${model.id} does not support Role ${effectiveRequest.role}`, probe_performed: false, fallback_eligible: false };
  }
  if (!model.efforts.includes(effectiveRequest.effort)) {
    return { status: 'UNAVAILABLE', provider, model: model.id, target, reason: `Model ${provider}/${model.id} does not support Effort ${effectiveRequest.effort}`, probe_performed: false, fallback_eligible: false };
  }
  if (!model.authorities.includes(effectiveRequest.authority)) {
    return { status: 'BLOCKED', provider, model: model.id, target, reason: `Model ${provider}/${model.id} does not permit authority ${effectiveRequest.authority}`, probe_performed: false, fallback_eligible: false };
  }
  if (!model.transports.includes(transport)) {
    return { status: 'UNAVAILABLE', provider, model: model.id, target, reason: `Model ${provider}/${model.id} does not support Transport ${transport}`, probe_performed: false, fallback_eligible: false };
  }
  if (access.status !== 'AVAILABLE') {
    return { status: access.status, provider, model: model.id, target, reason: access.evidence, probe_performed: false, fallback_eligible: access.status === 'UNAVAILABLE' };
  }
  return {
    status: 'AVAILABLE', provider, model: model.id, target, request: effectiveRequest,
    capability: { status: 'AVAILABLE', provider, model: model.id, role: effectiveRequest.role, effort: effectiveRequest.effort, authority: effectiveRequest.authority, route: modelResult.route.route, transport, evidence: access.evidence },
    reason: access.evidence, probe_performed: false, fallback_eligible: false,
  };
}

function evaluateCapabilityCandidate(request, candidate, evidence) {
  const authorization = authorizeCapability({ request, candidate, evidence });
  if (authorization.status !== 'AVAILABLE') {
    return { status: authorization.status, reason: authorization.reason, capability: authorization.evidence, probe_performed: false, fallback_eligible: false };
  }
  const normalized = authorization.evidence;
  const target = createExecutionTarget({
    target_agent: normalized.target_agent,
    provider: normalized.provider,
    model_id: normalized.model_id || 'unknown',
    effort: normalized.effort,
    allow_unknown_effort: normalized.effort === null,
    route: normalized.route,
    transport: normalized.transport,
    native: normalized.route === 'native'
      && normalized.provider === request.host_profile.native_provider
      && normalized.model_id === request.host_profile.native_model,
  });
  return {
    status: 'AVAILABLE',
    request,
    target,
    capability: {
      ...normalized,
      observed_model: normalized.model_id,
      observed_effort: normalized.effort,
    },
    probe_performed: false,
    fallback_eligible: false,
  };
}

function normalizePreference(candidate) {
  if (typeof candidate === 'string') {
    const match = candidate.match(/^([^/]+)(?:\/([^:]+))?(?::([^:]+))?$/);
    if (!match) throw new TypeError('preferenceOrder entries must be Agent/model[:effort] targets');
    const targetAgent = canonicalAgent(match[1]);
    const provider = canonicalProvider({ 'claude-code': 'anthropic', 'codex-cli': 'openai', agy: 'google', cursor: 'cursor' }[targetAgent]);
    if (!targetAgent) throw new TypeError('preferenceOrder entries must identify a supported Target Agent');
    return { target_agent: targetAgent, ...(provider ? { provider } : {}), ...(match[2] ? { model_id: match[2] } : {}), ...(match[3] ? { effort: match[3] } : {}) };
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('preferenceOrder entries must be Provider strings or target records');
  }
  if (Object.prototype.hasOwnProperty.call(candidate, 'route')) {
    throw new TypeError('preferenceOrder route is selected from the catalog and is not accepted at the request boundary');
  }
  const allowed = ['target_agent', 'targetAgent', 'provider', 'model_id', 'model', 'effort', 'transport'];
  if (Object.keys(candidate).some((key) => !allowed.includes(key))) throw new TypeError('preferenceOrder contains unsupported fields');
  if (candidate.provider !== undefined && (typeof candidate.provider !== 'string' || candidate.provider.length === 0)) throw new TypeError('preferenceOrder target provider must be a non-empty string');
  if (candidate.target_agent === undefined && candidate.targetAgent === undefined && candidate.provider === undefined) throw new TypeError('preferenceOrder target requires a Target Agent or Provider');
  if (candidate.effort !== undefined && !EFFORTS.includes(candidate.effort)) throw new TypeError('preferenceOrder target effort must be canonical');
  return {
    ...(candidate.target_agent || candidate.targetAgent ? { target_agent: canonicalAgent(candidate.target_agent || candidate.targetAgent) } : {}),
    ...(candidate.provider ? { provider: canonicalProvider(candidate.provider) } : {}),
    ...(candidate.model_id || candidate.model ? { model_id: candidate.model_id || candidate.model } : {}),
    ...(candidate.effort === undefined ? {} : { effort: candidate.effort }),
    ...(candidate.transport === undefined ? {} : { transport: candidate.transport }),
  };
}

function requestedCandidate(request) {
  return request.target ? {
    ...(request.target.target_agent === undefined ? {} : { target_agent: request.target.target_agent }),
    ...(request.target.provider === undefined ? {} : { provider: request.target.provider }),
    ...(request.target.model_id === undefined && request.target.model === undefined ? {} : { model_id: request.target.model_id || request.target.model }),
    ...(request.target.transport === undefined ? {} : { transport: request.target.transport }),
  } : null;
}

function resolveTarget(input, options = {}) {
  const request = createDispatchRequest(input);
  const catalog = createProviderModelCatalog(options.catalog);
  const requested = requestedCandidate(request);
  const capabilityEvidence = request.capability_evidence === undefined
    ? null : createCapabilityEvidence(request.capability_evidence);
  const defaultPair = request.host_profile.role_defaults && request.host_profile.role_defaults[request.role];
  const fallbackPairs = request.host_profile.role_fallbacks && request.host_profile.role_fallbacks[request.role] || [];
  const cursorPlaceholder = requested && requested.target_agent === 'cursor' && requested.model_id === 'cursor-default';
  const explicit = cursorPlaceholder && request.role === 'worker' && defaultPair
    ? { ...defaultPair, effort: requested.effort || defaultPair.effort }
    : requested;
  const candidates = capabilityEvidence
    ? [explicit || {
      target_agent: capabilityEvidence.target_agent,
      provider: capabilityEvidence.provider,
      ...(capabilityEvidence.model_id === null ? {} : { model_id: capabilityEvidence.model_id }),
      ...(capabilityEvidence.effort === null ? {} : { effort: capabilityEvidence.effort }),
    }]
    : explicit
    ? [explicit]
    : (options.preferenceOrder === undefined
      ? (defaultPair ? [defaultPair, ...fallbackPairs] : unique([request.host_profile.native_provider, ...request.host_profile.allowed_providers]).map((provider) => ({ provider })))
      : options.preferenceOrder.map(normalizePreference));

  const rejected = [];
  let fallbackEligible = false;
  for (const candidate of candidates) {
    const evaluated = capabilityEvidence
      ? evaluateCapabilityCandidate(request, candidate, capabilityEvidence)
      : evaluateCandidate(request, candidate, catalog);
    if (evaluated.status === 'AVAILABLE') {
      return Object.freeze({
        status: 'RESOLVED',
        request: evaluated.request || request,
        requested_target: request.target || null,
        target: evaluated.target,
        capability: evaluated.capability,
        rejected_candidates: rejected,
        probe_performed: evaluated.probe_performed,
        ...(cursorPlaceholder ? { diagnostic: 'legacy cursor-default target translated to the Host/Role worker default pair' } : {}),
      });
    }
    rejected.push({
      ...(evaluated.provider || candidate.provider ? { provider: evaluated.provider || candidate.provider } : {}),
      ...(candidate.target_agent ? { target_agent: candidate.target_agent } : {}),
      ...(evaluated.model ? { model: evaluated.model } : {}),
      status: evaluated.status,
      reason: evaluated.reason,
      probe_performed: evaluated.probe_performed,
    });
    if (explicit) {
      return Object.freeze({
        status: evaluated.status,
        request,
        requested_target: request.target || null,
        target: evaluated.target || null,
        capability: { status: evaluated.status, evidence: evaluated.reason },
        reason: evaluated.reason,
        rejected_candidates: rejected,
        probe_performed: evaluated.probe_performed,
        fallback_eligible: evaluated.fallback_eligible === true,
      });
    }
    // A declared fallback is permitted only after a confirmed availability
    // failure.  NOT_RUN, BLOCKED, unsupported routes, and policy/role/effort
    // mismatches are not availability evidence and must stop resolution.
    if (evaluated.fallback_eligible !== true) {
      return Object.freeze({
        status: evaluated.status,
        request,
        requested_target: null,
        target: evaluated.target || null,
        capability: { status: evaluated.status, evidence: evaluated.reason },
        reason: evaluated.reason,
        rejected_candidates: rejected,
        probe_performed: evaluated.probe_performed,
        fallback_eligible: false,
      });
    }
    fallbackEligible = true;
  }

  const status = rejected.some((entry) => entry.status === 'BLOCKED')
    ? 'BLOCKED'
    : rejected.length > 0 && rejected.every((entry) => entry.status === 'NOT_RUN')
      ? 'NOT_RUN'
      : 'UNAVAILABLE';
  return Object.freeze({
    status,
    request,
    requested_target: null,
    target: null,
    capability: { status, evidence: 'no eligible target in the configured Host policy and capability set' },
    reason: 'no eligible target in the configured Host policy and capability set',
    rejected_candidates: rejected,
    probe_performed: false,
    fallback_eligible: fallbackEligible,
  });
}

function initialFallbackHistory(resolution) {
  const target = resolution.target || resolution.requested_target;
  if (!target) return [];
  return [{
    ...(target.target_agent === undefined ? {} : { target_agent: target.target_agent }),
    provider: target.provider,
    ...(target.model_id === undefined ? {} : { model_id: target.model_id }),
    ...(target.model === undefined ? {} : { model: target.model }),
    ...(target.route === undefined ? {} : { route: target.route }),
    ...(target.transport === undefined ? {} : { transport: target.transport }),
    status: resolution.status,
    reason: resolution.reason || null,
  }];
}

function decideRecoveryCandidate({ request, resolution, failureClass, sideEffects, catalog, candidate_request, reconciliation, recovery_action }) {
  const blocked = (reason, status = 'BLOCKED') => Object.freeze({ status, request, target: null,
    failure_class: failureClass, side_effects: sideEffects, action: 'stop',
    retry_budget_remaining: request.fallback.retry_budget, reason });
  if ([FAILURE_CLASSES.SAFETY_OR_USER_DENIAL, FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT].includes(failureClass)) {
    return blocked('failure requires stopping on the affected Provider');
  }
  if (!request.fallback.allow || request.fallback.retry_budget === 0) return blocked('recovery retry budget is exhausted or disabled');
  let candidate;
  try { candidate = createDispatchRequest(candidate_request); } catch (_) { return blocked('recovery candidate is invalid'); }
  if (!candidate.target) return blocked('recovery requires one explicit candidate target');
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (request.strict_target && (!same(request.target, candidate.target) || request.effort !== candidate.effort)) {
    return blocked('strict recovery must preserve the original target tuple');
  }
  const stable = ['task_id', 'role', 'authority', 'task', 'execution_binding', 'parallelism'];
  if (stable.some((key) => !same(request[key], candidate[key]))
      || request.scope.workdir !== candidate.scope.workdir
      || !same(request.scope.prompt_evidence, candidate.scope.prompt_evidence)
      || candidate.scope.assigned_files.some((file) => !request.scope.assigned_files.includes(file))
      || candidate.strict_target !== request.strict_target) return blocked('recovery candidate widens or changes the task contract');
  const profileIdentity = (profile) => { const { access, allowed_providers, ...identity } = profile; return identity; };
  if (!same(profileIdentity(request.host_profile), profileIdentity(candidate.host_profile))
      || candidate.host_profile.allowed_providers.some((provider) => !request.host_profile.allowed_providers.includes(provider))) return blocked('recovery candidate changes Host permission policy');
  const interrupted = failureClass === FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION;
  const semantic = failureClass === FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE;
  const original = resolution && resolution.target;
  if (semantic || interrupted) {
    if (!['repair', 'resume'].includes(recovery_action) || !original
        || candidate.target.provider !== original.provider) return blocked('repair and resume must retain the Provider');
    if (!reconciliation || reconciliation.status !== 'PASSED'
        || reconciliation.task_id !== request.task_id || reconciliation.attempt_id !== request.attempt_id
        || reconciliation.scope_contained !== true || reconciliation.wip_preserved !== true
        || reconciliation.diff_verified !== true || !Array.isArray(reconciliation.out_of_scope)
        || reconciliation.out_of_scope.length !== 0) return blocked('recovery requires attempt-bound scope and diff reconciliation', 'RECONCILIATION_REQUIRED');
  } else {
    if (!AVAILABILITY_FAILURES.has(failureClass) || sideEffects !== 'none'
        || recovery_action !== 'substitute') return blocked('Provider substitution requires confirmed no side effects', 'RECONCILIATION_REQUIRED');
    if (request.strict_target) return blocked('strict target prevents substitution');
  }
  const next = resolveTarget(candidate, { catalog });
  if (next.status !== 'RESOLVED') return blocked('recovery candidate is unavailable');
  return Object.freeze({ status: 'FALLBACK', action: recovery_action, request, next_request: candidate,
    target: next.target, resolution: next, failure_class: failureClass, side_effects: sideEffects,
    reconciliation: reconciliation || null, retry_budget_remaining: request.fallback.retry_budget - 1 });
}

function decideFallback({ request, resolution, failureClass, sideEffects = 'unknown', catalog, candidate_request, reconciliation, recovery_action } = {}) {
  if (!Object.values(FAILURE_CLASSES).includes(failureClass)) throw new TypeError(`unknown failure class: ${failureClass}`);
  const normalizedRequest = createDispatchRequest(request);
  if (candidate_request !== undefined) return decideRecoveryCandidate({ request: normalizedRequest, resolution,
    failureClass, sideEffects, catalog, candidate_request, reconciliation, recovery_action });
  const history = initialFallbackHistory(resolution || {});
  const retryBudget = normalizedRequest.fallback.retry_budget;
  const fallbackAllowed = normalizedRequest.fallback.allow === true;
  const nativeTarget = {
    target_agent: normalizedRequest.host_profile.native_target_agent,
    provider: normalizedRequest.host_profile.native_provider,
    model: normalizedRequest.host_profile.native_model,
    model_id: normalizedRequest.host_profile.native_model,
    route: normalizedRequest.host_profile.native_route,
    transport: normalizedRequest.host_profile.native_transport,
  };

  if (failureClass === FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION || sideEffects !== 'none') {
    return Object.freeze({
      status: 'RECONCILIATION_REQUIRED',
      request: normalizedRequest,
      target: null,
      failure_class: failureClass,
      side_effects: sideEffects,
      fallback_history: history,
      retry_budget_remaining: retryBudget,
      reason: 'launch or side-effect state is not proven safe for Provider substitution',
    });
  }

  if (resolution && resolution.fallback_eligible === false) {
    return Object.freeze({
      status: 'BLOCKED',
      request: normalizedRequest,
      target: resolution.target || null,
      failure_class: failureClass,
      side_effects: sideEffects,
      fallback_history: history,
      retry_budget_remaining: retryBudget,
      action: 'stop',
      reason: 'resolution failure is not an availability failure eligible for Provider fallback',
    });
  }

  if (!AVAILABILITY_FAILURES.has(failureClass) || !fallbackAllowed || retryBudget === 0) {
    return Object.freeze({
      status: 'BLOCKED',
      request: normalizedRequest,
      target: resolution && resolution.target ? resolution.target : null,
      failure_class: failureClass,
      side_effects: sideEffects,
      fallback_history: history,
      retry_budget_remaining: retryBudget,
      action: FALLBACK_ACTIONS[failureClass] || 'stop',
      reason: !fallbackAllowed
        ? 'fallback is not allowed by the request policy'
        : retryBudget === 0
          ? 'fallback retry budget is exhausted'
          : 'failure class is not eligible for Provider fallback',
    });
  }

  const declaredFallbacks = normalizedRequest.host_profile.role_fallbacks
    && normalizedRequest.host_profile.role_fallbacks[normalizedRequest.role] || [];
  const roleDefault = normalizedRequest.host_profile.role_defaults
    && normalizedRequest.host_profile.role_defaults[normalizedRequest.role];
  const fallbackTargets = [roleDefault || nativeTarget, ...declaredFallbacks];
  const targetIdentity = (target) => {
    if (!target) return null;
    const targetAgent = target.target_agent || target.targetAgent || target.agent;
    const provider = target.provider;
    const modelId = target.model_id || target.model;
    const route = target.route || '';
    const transport = target.transport || '';
    return targetAgent && provider && modelId ? `${targetAgent}/${provider}/${modelId}/${route}/${transport}` : null;
  };
  const attemptedIdentity = targetIdentity(resolution && resolution.target);
  const uniqueFallbackTargets = fallbackTargets.filter((candidate, index, values) => {
    const identity = targetIdentity(candidate);
    return identity !== attemptedIdentity && values.findIndex((other) => targetIdentity(other) === identity) === index;
  });
  let fallback = null;
  let fallbackRequest = null;
  for (const candidate of uniqueFallbackTargets) {
    const candidateTarget = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'effort' && key !== 'route'));
    fallbackRequest = createDispatchRequest({
      ...normalizedRequest,
      target: candidateTarget,
      effort: candidate.effort,
      fallback: { ...normalizedRequest.fallback, retry_budget: retryBudget - 1 },
    });
    const candidateResolution = resolveTarget(fallbackRequest, { catalog });
    if (candidateResolution.status === 'RESOLVED') { fallback = candidateResolution; break; }
  }
  if (!fallback) fallback = { status: 'UNAVAILABLE', rejected_candidates: [], reason: 'no declared fallback target is available' };
  if (fallback.status !== 'RESOLVED') {
    return Object.freeze({
      status: 'BLOCKED',
      request: normalizedRequest,
      target: null,
      failure_class: failureClass,
      side_effects: sideEffects,
      fallback_history: [...history, ...fallback.rejected_candidates],
      retry_budget_remaining: retryBudget,
      action: 'stop',
      reason: `native fallback is not available: ${fallback.reason}`,
    });
  }

  return Object.freeze({
    status: 'FALLBACK',
    request: normalizedRequest,
    target: fallback.target,
    capability: fallback.capability,
    failure_class: failureClass,
    side_effects: sideEffects,
    fallback_history: history,
    retry_budget_remaining: retryBudget - 1,
    reason: `Host-native fallback selected after ${failureClass}`,
  });
}

module.exports = Object.freeze({ FAILURE_CLASSES, decideFallback, resolveTarget });
