'use strict';

const {
  CAPABILITY_STATUSES,
  EFFORTS,
  createDispatchRequest,
  createExecutionTarget,
  createProviderModelCatalog,
} = require('./dispatch-contract');

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

function catalogEntry(catalog, providerId) {
  return catalog.providers.find((entry) => entry.provider === providerId) || null;
}

function compatibleModel(model, request) {
  return model.roles.includes(request.role)
    && model.efforts.includes(request.effort)
    && model.authorities.includes(request.authority);
}

function modelForCandidate({ provider, requestedModel, request, catalog, native }) {
  const providerEntry = catalogEntry(catalog, provider);
  if (!providerEntry) return { status: 'UNAVAILABLE', reason: `Provider ${provider} is absent from the catalog` };

  if (requestedModel !== undefined) {
    const model = providerEntry.models.find((entry) => entry.id === requestedModel);
    if (!model) return { status: 'UNAVAILABLE', reason: `Model ${provider}/${requestedModel} is absent from the catalog` };
    return { status: 'FOUND', model };
  }

  const model = providerEntry.models.find((entry) => (
    native ? entry.id === request.host_profile.native_model : compatibleModel(entry, request)
  ));
  if (!model) return { status: 'UNAVAILABLE', reason: `Provider ${provider} has no Model for Role ${request.role} at Effort ${request.effort}` };
  return { status: 'FOUND', model };
}

function candidateModel({ provider, model, request, catalog }) {
  return modelForCandidate({
    provider,
    requestedModel: model,
    request,
    catalog,
    native: provider === request.host_profile.native_provider && model === undefined,
  });
}

function candidateTransport({ provider, model, requestedTransport, request }) {
  if (requestedTransport !== undefined) return requestedTransport;
  if (provider === request.host_profile.native_provider && model.id === request.host_profile.native_model) {
    return request.host_profile.native_transport;
  }
  return model.transports[0];
}

function evaluateCandidate(request, candidate, catalog) {
  const provider = candidate.provider;
  const effectiveRequest = candidate.effort === undefined
    ? request
    : Object.freeze({ ...request, effort: candidate.effort });
  if (!effectiveRequest.host_profile.allowed_providers.includes(provider)) {
    return {
      status: 'BLOCKED',
      provider,
      model: candidate.model || null,
      reason: `Host policy does not allow Provider ${provider}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }

  const access = effectiveRequest.host_profile.access[provider];
  if (!access) {
    return {
      status: 'BLOCKED',
      provider,
      model: candidate.model || null,
      reason: `Host profile has no access evidence for Provider ${provider}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }

  const modelResult = candidateModel({
    provider,
    model: candidate.model,
    request: effectiveRequest,
    catalog,
  });
  if (modelResult.status !== 'FOUND') {
    return { ...modelResult, provider, probe_performed: false, fallback_eligible: false };
  }

  const model = modelResult.model;
  const transport = candidateTransport({
    provider,
    model,
    requestedTransport: candidate.transport,
    request: effectiveRequest,
  });
  const target = createExecutionTarget({
    provider,
    model: model.id,
    effort: effectiveRequest.effort,
    transport,
    native: provider === effectiveRequest.host_profile.native_provider
      && model.id === effectiveRequest.host_profile.native_model
      && transport === effectiveRequest.host_profile.native_transport,
  });

  if (!model.roles.includes(effectiveRequest.role)) {
    return {
      status: 'UNAVAILABLE',
      provider,
      model: model.id,
      target,
      reason: `Model ${provider}/${model.id} does not support Role ${effectiveRequest.role}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }
  if (!model.efforts.includes(effectiveRequest.effort)) {
    return {
      status: 'UNAVAILABLE',
      provider,
      model: model.id,
      target,
      reason: `Model ${provider}/${model.id} does not support Effort ${effectiveRequest.effort}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }
  if (!model.authorities.includes(effectiveRequest.authority)) {
    return {
      status: 'BLOCKED',
      provider,
      model: model.id,
      target,
      reason: `Model ${provider}/${model.id} does not permit authority ${effectiveRequest.authority}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }
  if (!model.transports.includes(transport)) {
    return {
      status: 'UNAVAILABLE',
      provider,
      model: model.id,
      target,
      reason: `Model ${provider}/${model.id} does not support Transport ${transport}`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }

  if (!CAPABILITY_STATUSES.includes(access.status)) {
    return {
      status: 'BLOCKED',
      provider,
      model: model.id,
      target,
      reason: `Host access status for ${provider} is invalid`,
      probe_performed: false,
      fallback_eligible: false,
    };
  }
  if (access.status !== 'AVAILABLE') {
    return {
      status: access.status,
      provider,
      model: model.id,
      target,
      reason: access.evidence,
      probe_performed: false,
      fallback_eligible: access.status === 'UNAVAILABLE',
    };
  }

  return {
    status: 'AVAILABLE',
    provider,
    model: model.id,
    target,
    request: effectiveRequest,
    capability: {
      status: 'AVAILABLE',
      provider,
      model: model.id,
      role: effectiveRequest.role,
      effort: effectiveRequest.effort,
      authority: effectiveRequest.authority,
      transport,
      evidence: access.evidence,
    },
    reason: access.evidence,
    probe_performed: false,
    fallback_eligible: false,
  };
}

function normalizePreference(candidate) {
  if (typeof candidate === 'string') return { provider: candidate };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('preferenceOrder entries must be Provider strings or target records');
  }
  const allowed = ['provider', 'model', 'effort', 'transport'];
  if (Object.keys(candidate).some((key) => !allowed.includes(key))) throw new TypeError('preferenceOrder contains unsupported fields');
  if (typeof candidate.provider !== 'string' || candidate.provider.length === 0) throw new TypeError('preferenceOrder target requires provider');
  if (candidate.effort !== undefined && !EFFORTS.includes(candidate.effort)) throw new TypeError('preferenceOrder target effort must be canonical');
  return {
    provider: candidate.provider,
    ...(candidate.model === undefined ? {} : { model: candidate.model }),
    ...(candidate.effort === undefined ? {} : { effort: candidate.effort }),
    ...(candidate.transport === undefined ? {} : { transport: candidate.transport }),
  };
}

function requestedCandidate(request) {
  return request.target ? {
    provider: request.target.provider,
    ...(request.target.model === undefined ? {} : { model: request.target.model }),
    ...(request.target.transport === undefined ? {} : { transport: request.target.transport }),
  } : null;
}

function resolveTarget(input, options = {}) {
  const request = createDispatchRequest(input);
  const catalog = createProviderModelCatalog(options.catalog);
  const explicit = requestedCandidate(request);
  const candidates = explicit
    ? [explicit]
    : (options.preferenceOrder === undefined
      ? unique([request.host_profile.native_provider, ...request.host_profile.allowed_providers]).map((provider) => ({ provider }))
      : options.preferenceOrder.map(normalizePreference));

  const rejected = [];
  for (const candidate of candidates) {
    const evaluated = evaluateCandidate(request, candidate, catalog);
    if (evaluated.status === 'AVAILABLE') {
      return Object.freeze({
        status: 'RESOLVED',
        request: evaluated.request || request,
        requested_target: request.target || null,
        target: evaluated.target,
        capability: evaluated.capability,
        rejected_candidates: rejected,
        probe_performed: evaluated.probe_performed,
      });
    }
    rejected.push({
      provider: evaluated.provider || candidate.provider,
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
  }

  const status = rejected.some((entry) => entry.status === 'BLOCKED') ? 'BLOCKED' : 'UNAVAILABLE';
  return Object.freeze({
    status,
    request,
    requested_target: null,
    target: null,
    capability: { status, evidence: 'no eligible target in the configured Host policy and capability set' },
    reason: 'no eligible target in the configured Host policy and capability set',
    rejected_candidates: rejected,
    probe_performed: false,
    fallback_eligible: false,
  });
}

function initialFallbackHistory(resolution) {
  const target = resolution.target || resolution.requested_target;
  if (!target) return [];
  return [{
    provider: target.provider,
    ...(target.model === undefined ? {} : { model: target.model }),
    ...(target.transport === undefined ? {} : { transport: target.transport }),
    status: resolution.status,
    reason: resolution.reason || null,
  }];
}

function decideFallback({ request, resolution, failureClass, sideEffects = 'unknown', catalog } = {}) {
  if (!Object.values(FAILURE_CLASSES).includes(failureClass)) throw new TypeError(`unknown failure class: ${failureClass}`);
  const normalizedRequest = createDispatchRequest(request);
  const history = initialFallbackHistory(resolution || {});
  const retryBudget = normalizedRequest.fallback.retry_budget;
  const fallbackAllowed = normalizedRequest.fallback.allow === true;
  const nativeTarget = {
    provider: normalizedRequest.host_profile.native_provider,
    model: normalizedRequest.host_profile.native_model,
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

  if (normalizedRequest.target && normalizedRequest.target.provider === nativeTarget.provider) {
    return Object.freeze({
      status: 'BLOCKED',
      request: normalizedRequest,
      target: null,
      failure_class: failureClass,
      side_effects: sideEffects,
      fallback_history: history,
      retry_budget_remaining: retryBudget,
      action: 'stop',
      reason: 'the unavailable target is already the Host-native target',
    });
  }

  const fallbackRequest = createDispatchRequest({
    ...normalizedRequest,
    target: nativeTarget,
    fallback: { ...normalizedRequest.fallback, retry_budget: retryBudget - 1 },
  });
  const fallback = resolveTarget(fallbackRequest, { catalog });
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
