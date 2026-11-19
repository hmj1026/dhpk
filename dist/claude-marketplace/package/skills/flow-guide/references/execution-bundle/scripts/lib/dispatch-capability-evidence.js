'use strict';

const {
  AUTHORITIES,
  CANONICAL_ROLES,
  CAPABILITY_STATUSES,
  EFFORTS,
  EFFORT_BINDINGS,
  ROUTES,
  TARGET_AGENTS,
  TRANSPORTS,
  PROVIDERS,
} = require('./dispatch-contract');

const KIND = 'host-executable-capability';
const STATES = Object.freeze(['EXPOSED', 'OBSERVED_AVAILABLE', 'DECLARED', 'UNKNOWN', 'OBSERVED_UNAVAILABLE']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function optionalText(value, label) {
  return value === undefined || value === null ? null : text(value, label);
}

function oneOf(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`${label} must be one of ${values.join(', ')}`);
  return value;
}

function createCapabilityEvidence(input) {
  const evidence = record(input, 'capability evidence');
  if (Object.keys(evidence).some((key) => ![
    'kind', 'state', 'status', 'source', 'observed_at', 'session_id', 'binding_id', 'host',
    'provider', 'target_agent', 'model_id', 'role', 'authority', 'effort',
    'effort_binding', 'route', 'transport', 'observed_model', 'observed_effort',
  ].includes(key))) throw new TypeError('capability evidence contains unsupported fields');
  if (evidence.kind !== KIND) throw new TypeError(`capability evidence.kind must be ${KIND}`);
  const status = oneOf(evidence.status, CAPABILITY_STATUSES, 'capability evidence.status');
  const output = {
    kind: KIND,
    state: oneOf(evidence.state, STATES, 'capability evidence.state'),
    status,
    source: text(evidence.source, 'capability evidence.source'),
    observed_at: text(evidence.observed_at, 'capability evidence.observed_at'),
    session_id: text(evidence.session_id, 'capability evidence.session_id'),
    binding_id: text(evidence.binding_id, 'capability evidence.binding_id'),
    host: text(evidence.host, 'capability evidence.host'),
    provider: oneOf(evidence.provider, PROVIDERS, 'capability evidence.provider'),
    target_agent: oneOf(evidence.target_agent, TARGET_AGENTS, 'capability evidence.target_agent'),
    model_id: optionalText(evidence.model_id, 'capability evidence.model_id'),
    observed_model: evidence.state === 'OBSERVED_AVAILABLE' ? optionalText(evidence.observed_model, 'capability evidence.observed_model') : null,
    observed_effort: evidence.state === 'OBSERVED_AVAILABLE' && evidence.observed_effort !== undefined && evidence.observed_effort !== null
      ? oneOf(evidence.observed_effort, EFFORTS, 'capability evidence.observed_effort') : null,
    role: oneOf(evidence.role, CANONICAL_ROLES, 'capability evidence.role'),
    authority: oneOf(evidence.authority, AUTHORITIES, 'capability evidence.authority'),
    effort: evidence.effort === undefined || evidence.effort === null ? null : oneOf(evidence.effort, EFFORTS, 'capability evidence.effort'),
    effort_binding: oneOf(evidence.effort_binding, EFFORT_BINDINGS, 'capability evidence.effort_binding'),
    route: oneOf(evidence.route, ROUTES, 'capability evidence.route'),
    transport: oneOf(evidence.transport, TRANSPORTS, 'capability evidence.transport'),
  };
  if (Number.isNaN(Date.parse(output.observed_at))) throw new TypeError('capability evidence.observed_at must be an ISO timestamp');
  return Object.freeze(output);
}

function authorizeCapability({ request, candidate, evidence } = {}) {
  const normalized = createCapabilityEvidence(evidence);
  if (!['OBSERVED_AVAILABLE', 'EXPOSED'].includes(normalized.state) || normalized.status !== 'AVAILABLE') return { status: normalized.status === 'AVAILABLE' ? 'NOT_RUN' : normalized.status, reason: `Host capability evidence is ${normalized.state}`, evidence: normalized };
  const access = request.host_profile.access[normalized.provider];
  if (access && ['BLOCKED', 'DENIED', 'REFUSED'].includes(String(access.status).toUpperCase())) return { status: 'BLOCKED', reason: 'Host explicitly refuses this Provider', evidence: normalized };
  const binding = request.execution_binding;
  if (!binding || binding.session_id !== normalized.session_id || binding.binding_id !== normalized.binding_id) return { status: 'BLOCKED', reason: 'capability evidence is not bound to the injected executor', evidence: normalized };
  if (normalized.host !== request.host_profile.host) return { status: 'BLOCKED', reason: `capability evidence Host ${normalized.host} does not match ${request.host_profile.host}`, evidence: normalized };
  if (!request.host_profile.allowed_providers.includes(normalized.provider)) return { status: 'BLOCKED', reason: `Host policy does not allow Provider ${normalized.provider}`, evidence: normalized };
  if (candidate.provider && candidate.provider !== normalized.provider) return { status: 'BLOCKED', reason: `capability evidence Provider ${normalized.provider} does not match requested Provider ${candidate.provider}`, evidence: normalized };
  if (candidate.target_agent && candidate.target_agent !== normalized.target_agent) return { status: 'BLOCKED', reason: `capability evidence Target Agent ${normalized.target_agent} does not match requested Target Agent ${candidate.target_agent}`, evidence: normalized };
  if (candidate.transport && candidate.transport !== normalized.transport) return { status: 'BLOCKED', reason: 'capability evidence Transport does not match requested Transport', evidence: normalized };
  if (request.strict_target === true && candidate.model_id && normalized.model_id !== candidate.model_id) return { status: 'BLOCKED', reason: `capability evidence Model ${normalized.model_id || 'unknown'} does not match requested Model ${candidate.model_id}`, evidence: normalized };
  if (normalized.role !== request.role || normalized.authority !== request.authority) return { status: 'BLOCKED', reason: 'capability evidence Role or authority does not match the request', evidence: normalized };
  if (request.effort !== undefined && normalized.effort !== request.effort) return { status: 'BLOCKED', reason: `capability evidence cannot prove requested Effort ${request.effort}`, evidence: normalized };
  if (normalized.effort_binding === 'unsupported' && normalized.effort !== null) return { status: 'BLOCKED', reason: 'unsupported effort binding cannot declare an Effort', evidence: normalized };
  if (normalized.effort_binding === 'embedded' && normalized.effort === null) return { status: 'BLOCKED', reason: 'embedded effort binding requires a fixed Effort', evidence: normalized };
  if ((normalized.model_id === null || candidate.model_id === null) && (normalized.route !== 'native' || normalized.transport !== 'native-runtime'
    || normalized.provider !== request.host_profile.native_provider || request.strict_target === true
    || (candidate.model_id !== undefined && candidate.model_id !== null))) return { status: 'BLOCKED', reason: 'unknown model requires a current native Host role target', evidence: normalized };
  return { status: 'AVAILABLE', evidence: normalized };
}

module.exports = Object.freeze({ KIND, STATES, authorizeCapability, createCapabilityEvidence });
