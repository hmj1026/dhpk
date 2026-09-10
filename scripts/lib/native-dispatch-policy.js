'use strict';

const VALID_BACKENDS = Object.freeze(['claude', 'codex', 'agy']);
const DEFAULT_CROSS_PROVIDER = false;

// This is the one role vocabulary shared by planner, reasoner, worker, and
// reviewer dispatch. Platform-specific adapters may render the native agent
// differently, but they must not invent a second candidate-selection policy.
const ROLE_POLICY = Object.freeze({
  planner: Object.freeze({ native_agent: 'dhpk:planner' }),
  reasoner: Object.freeze({ native_agent: 'dhpk:deep-reasoner' }),
  worker: Object.freeze({ native_agent: 'dhpk:fast-worker' }),
  reviewer: Object.freeze({ native_agent: 'dhpk:code-reviewer' }),
});

const FAILURE_CLASSES = Object.freeze({
  CLI_UNAVAILABLE: 'CLI_UNAVAILABLE',
  AUTHENTICATION_OR_MODEL_UNAVAILABLE: 'AUTHENTICATION_OR_MODEL_UNAVAILABLE',
  QUOTA_OR_RATE_LIMIT: 'QUOTA_OR_RATE_LIMIT',
  SAFETY_OR_USER_DENIAL: 'SAFETY_OR_USER_DENIAL',
  TASK_OR_SEMANTIC_FAILURE: 'TASK_OR_SEMANTIC_FAILURE',
  TIMEOUT_OR_INTERRUPTION: 'TIMEOUT_OR_INTERRUPTION',
});

const FAILURE_ACTIONS = Object.freeze({
  [FAILURE_CLASSES.CLI_UNAVAILABLE]: 'dispatch',
  [FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE]: 'dispatch',
  [FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT]: 'stop',
  [FAILURE_CLASSES.SAFETY_OR_USER_DENIAL]: 'stop',
  [FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE]: 'repair',
  [FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION]: 'reconcile',
});

function resolveDispatchPlan({
  role,
  requestedBackend = 'auto',
  configuredOrder = VALID_BACKENDS,
  nativeBackend = 'claude',
  crossProvider = DEFAULT_CROSS_PROVIDER,
} = {}) {
  const definition = ROLE_POLICY[role];
  if (!definition) throw new Error(`unknown delegated role: ${role}`);
  if (!VALID_BACKENDS.includes(nativeBackend)) throw new Error(`unknown native backend: ${nativeBackend}`);
  if (!VALID_BACKENDS.includes(requestedBackend) && requestedBackend !== 'auto') {
    throw new Error(`unknown requested backend: ${requestedBackend}`);
  }
  if (!Array.isArray(configuredOrder) || configuredOrder.length === 0
    || configuredOrder.some((backend) => !VALID_BACKENDS.includes(backend))) {
    throw new Error('configured backend order must contain only known backends');
  }

  if (requestedBackend !== 'auto') {
    return Object.freeze({
      role,
      native_backend: nativeBackend,
      requested_backend: requestedBackend,
      candidate_scope: 'explicit',
      candidates: Object.freeze([requestedBackend]),
      suppressed_candidates: Object.freeze([]),
      native_agent: definition.native_agent,
    });
  }

  const automaticCandidates = crossProvider === true
    ? configuredOrder
    : [nativeBackend];
  const suppressedCandidates = crossProvider === true
    ? []
    : configuredOrder
      .filter((backend) => backend !== nativeBackend)
      .map((backend) => Object.freeze({ backend, reason: 'cross-provider disabled' }));

  return Object.freeze({
    role,
    native_backend: nativeBackend,
    requested_backend: requestedBackend,
    candidate_scope: crossProvider === true ? 'cross-provider' : 'native-only',
    candidates: Object.freeze([...automaticCandidates]),
    suppressed_candidates: Object.freeze(suppressedCandidates),
    native_agent: definition.native_agent,
  });
}

function createFallbackState({
  retryBudget = 3,
  attemptedBackends = [],
  unavailableBackends = [],
} = {}) {
  if (!Number.isInteger(retryBudget) || retryBudget < 0) {
    throw new Error('retryBudget must be a non-negative integer');
  }
  const normalizeBackends = (value, label) => {
    if (!Array.isArray(value) || value.some((backend) => !VALID_BACKENDS.includes(backend))) {
      throw new Error(`${label} must contain only known backends`);
    }
    return [...new Set(value)];
  };
  return Object.freeze({
    retry_budget: retryBudget,
    attempted_backends: Object.freeze(normalizeBackends(attemptedBackends, 'attemptedBackends')),
    unavailable_backends: Object.freeze(normalizeBackends(unavailableBackends, 'unavailableBackends')),
  });
}

function resolveFallbackDecision({
  role,
  selectedBackend,
  nativeBackend = 'claude',
  configuredOrder = VALID_BACKENDS,
  crossProvider = DEFAULT_CROSS_PROVIDER,
  failureClass,
  sideEffects = 'unknown',
  affectedPool = null,
  candidatePools = {},
  state = createFallbackState(),
  handoff = null,
} = {}) {
  if (!ROLE_POLICY[role]) throw new Error(`unknown delegated role: ${role}`);
  if (!VALID_BACKENDS.includes(selectedBackend)) throw new Error(`unknown selected backend: ${selectedBackend}`);
  if (!VALID_BACKENDS.includes(nativeBackend)) throw new Error(`unknown native backend: ${nativeBackend}`);
  if (!Array.isArray(configuredOrder) || configuredOrder.length === 0
    || configuredOrder.some((backend) => !VALID_BACKENDS.includes(backend))) {
    throw new Error('configured backend order must contain only known backends');
  }
  if (!Object.values(FAILURE_CLASSES).includes(failureClass)) {
    throw new Error(`unknown failure class: ${failureClass}`);
  }
  if (!state || !Number.isInteger(state.retry_budget) || state.retry_budget < 0
    || !Array.isArray(state.attempted_backends) || !Array.isArray(state.unavailable_backends)) {
    throw new Error('state must be created by createFallbackState');
  }

  const unique = (values) => [...new Set(values)];
  const attempted = unique([...state.attempted_backends, selectedBackend]);
  const availabilityFailure = failureClass === FAILURE_CLASSES.CLI_UNAVAILABLE
    || failureClass === FAILURE_CLASSES.AUTHENTICATION_OR_MODEL_UNAVAILABLE;
  const canFallbackFromAvailability = availabilityFailure && sideEffects === 'none';
  const canAvoidQuotaPool = failureClass === FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT
    && crossProvider === true && affectedPool !== null && affectedPool !== undefined;
  const unavailable = (canFallbackFromAvailability || canAvoidQuotaPool)
    ? unique([...state.unavailable_backends, selectedBackend])
    : [...state.unavailable_backends];
  const nextState = (retryBudget, attemptedBackends = attempted, unavailableBackends = unavailable) => ({
    retry_budget: retryBudget,
    attempted_backends: attemptedBackends,
    unavailable_backends: unavailableBackends,
  });
  const base = {
    role,
    native_agent: ROLE_POLICY[role].native_agent,
    requested_backend: selectedBackend,
    resolved_backend: selectedBackend,
    failure_class: failureClass,
    candidate_scope: crossProvider === true ? 'cross-provider' : 'native-only',
    handoff,
  };

  if (failureClass === FAILURE_CLASSES.SAFETY_OR_USER_DENIAL
    || failureClass === FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE
    || failureClass === FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION
    || (availabilityFailure && !canFallbackFromAvailability)
    || (failureClass === FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT && !canAvoidQuotaPool)) {
    const reason = failureClass === FAILURE_CLASSES.SAFETY_OR_USER_DENIAL
      ? 'safety restriction or user denial requires the existing authorization path'
      : failureClass === FAILURE_CLASSES.TASK_OR_SEMANTIC_FAILURE
        ? 'task or semantic failure returns to the existing repair path'
        : failureClass === FAILURE_CLASSES.TIMEOUT_OR_INTERRUPTION
          ? 'timeout or interruption requires writer-stop and scope/diff reconciliation'
          : failureClass === FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT
            ? 'quota or rate-limit fallback requires an explicitly different authorized pool'
            : `${selectedBackend} unavailable without confirmed side effects is required before fallback`;
    const action = FAILURE_ACTIONS[failureClass];
    return {
      ...base,
      status: 'blocked',
      action: action === 'repair' || action === 'reconcile' ? action : 'stop',
      fallback_reason: reason,
      retry_budget_remaining: state.retry_budget,
      next_state: nextState(state.retry_budget),
    };
  }

  const candidates = unique([
    nativeBackend,
    ...(crossProvider === true ? configuredOrder : []),
  ]).filter((backend) => {
    if (backend === selectedBackend || attempted.includes(backend) || unavailable.includes(backend)) return false;
    if (failureClass === FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT
      && (typeof candidatePools[backend] !== 'string' || candidatePools[backend] === affectedPool)) return false;
    return true;
  });
  if (state.retry_budget === 0 || candidates.length === 0) {
    return {
      ...base,
      status: 'blocked',
      action: 'stop',
      fallback_reason: state.retry_budget === 0
        ? 'total retry budget is exhausted; provider switching cannot reset it'
        : 'no valid fallback candidate remains in the authorized candidate set',
      retry_budget_remaining: state.retry_budget,
      next_state: nextState(state.retry_budget),
    };
  }

  const resolvedBackend = candidates[0];
  const reason = failureClass === FAILURE_CLASSES.QUOTA_OR_RATE_LIMIT
    ? `${selectedBackend} quota or rate-limit is avoided; authorized alternate pool selected`
    : `${selectedBackend} unavailable without confirmed side effects; ${resolvedBackend === nativeBackend ? 'native' : 'authorized'} fallback selected`;
  return {
    ...base,
    status: 'fallback',
    action: 'dispatch',
    resolved_backend: resolvedBackend,
    fallback_reason: reason,
    retry_budget_remaining: state.retry_budget - 1,
    next_state: nextState(state.retry_budget - 1),
  };
}

module.exports = Object.freeze({
  DEFAULT_CROSS_PROVIDER,
  FAILURE_CLASSES,
  ROLE_POLICY,
  VALID_BACKENDS,
  createFallbackState,
  resolveFallbackDecision,
  resolveDispatchPlan,
});
