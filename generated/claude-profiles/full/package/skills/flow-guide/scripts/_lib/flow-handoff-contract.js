'use strict';

const HOSTS = Object.freeze(['claude-code', 'codex-cli', 'agy', 'cursor', 'claude', 'codex']);
const ROLES = Object.freeze(['planner', 'reasoner', 'worker', 'reviewer']);
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'max']);
const TRANSPORTS = Object.freeze(['native-runtime', 'local-cli', 'app-server']);
const DISPOSITIONS = Object.freeze(['advice', 'ready', 'explicit-required', 'blocked', 'unavailable']);
const EVIDENCE_STATES = Object.freeze(['available', 'unavailable', 'not-run', 'blocked', 'not-configured']);
const SCHEMA = 'dhpk.flow.handoff.v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function oneOf(value, values, label) {
  if (!values.includes(value)) throw new TypeError(`${label} must be one of ${values.join(', ')}`);
  return value;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function normalizeTarget(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new TypeError('handoff.target must be a record');
  const target = {
    provider: requiredString(value.provider, 'handoff.target.provider'),
    ...(value.model === undefined ? {} : { model: requiredString(value.model, 'handoff.target.model') }),
    ...(value.role === undefined ? {} : { role: oneOf(value.role, ROLES, 'handoff.target.role') }),
    ...(value.effort === undefined ? {} : { effort: oneOf(value.effort, EFFORTS, 'handoff.target.effort') }),
    ...(value.transport === undefined ? {} : { transport: oneOf(value.transport, TRANSPORTS, 'handoff.target.transport') }),
  };
  if (Object.keys(value).some((key) => !Object.prototype.hasOwnProperty.call(target, key))) {
    throw new TypeError('handoff.target contains unsupported fields');
  }
  return target;
}

function createFlowHandoff(input) {
  if (!isRecord(input)) throw new TypeError('flow handoff must be a record');
  if (input.execution !== undefined && input.execution !== 'not-started') throw new TypeError('flow handoff cannot claim execution');
  const evidence = input.evidence === undefined ? [] : input.evidence;
  if (!Array.isArray(evidence) || evidence.some((item) => !isRecord(item))) throw new TypeError('handoff.evidence must be an array of records');
  const normalizedEvidence = evidence.map((item) => {
    if (Object.keys(item).some((key) => !['kind', 'state', 'detail'].includes(key))) throw new TypeError('handoff evidence contains unsupported fields');
    return {
      kind: requiredString(item.kind, 'handoff.evidence.kind'),
      state: oneOf(item.state, EVIDENCE_STATES, 'handoff.evidence.state'),
      detail: requiredString(item.detail, 'handoff.evidence.detail'),
    };
  });
  const handoff = {
    schema: SCHEMA,
    handoff_id: requiredString(input.handoff_id, 'handoff_id'),
    owner: requiredString(input.owner, 'owner'),
    host: oneOf(input.host, HOSTS, 'host'),
    disposition: oneOf(input.disposition, DISPOSITIONS, 'disposition'),
    target: normalizeTarget(input.target),
    evidence: normalizedEvidence,
    next_action: requiredString(input.next_action, 'next_action'),
    execution: 'not-started',
  };
  return freeze(handoff);
}

function validateFlowHandoff(value) {
  const handoff = createFlowHandoff(value);
  if (handoff.execution !== 'not-started') throw new TypeError('flow handoff cannot claim execution');
  return true;
}

module.exports = Object.freeze({ DISPOSITIONS, EFFORTS, EVIDENCE_STATES, HOSTS, ROLES, SCHEMA, TRANSPORTS, createFlowHandoff, validateFlowHandoff });
