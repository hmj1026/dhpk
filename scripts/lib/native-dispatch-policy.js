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

module.exports = Object.freeze({
  DEFAULT_CROSS_PROVIDER,
  ROLE_POLICY,
  VALID_BACKENDS,
  resolveDispatchPlan,
});
