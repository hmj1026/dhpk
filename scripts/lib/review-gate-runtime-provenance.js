'use strict';

const path = require('node:path');
const {
  canonicalJson,
  SAFE_ID,
  sha256,
} = require('./receipt-primitives');

const RUNTIME_PROVENANCE_SCHEMA = 'dhpk.review-gate.runtime-provenance.v1';
const MAX_STRING_BYTES = 4096;
const MAX_ARTIFACT_REFERENCE_BYTES = 4096;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVIEW_VERDICTS = new Set(['PASS', 'CHANGES_REQUIRED', 'BLOCKED']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const PROVENANCE_LIVENESS_FIELDS = new Set([
  'active',
  'pid',
  'heartbeat',
  'process_liveness',
  'processLiveness',
  'process_id',
  'processId',
  'heartbeat_at',
  'heartbeatAt',
]);
const PROVENANCE_IDENTITY_FIELDS = new Set([
  'task_id', 'taskId',
  'attempt_id', 'attemptId',
  'attempt', 'dispatch_attempt',
  'session_id', 'sessionId',
  'wave', 'dispatch_id', 'dispatchId',
  'scope_id', 'scopeId',
  'diff_id', 'diffId',
]);

function createRuntimeProvenance({
  normalizeObservationContext,
  normalizeCommands,
  identityDigest,
  fail,
} = {}) {
  if (typeof normalizeObservationContext !== 'function'
    || typeof normalizeCommands !== 'function'
    || typeof identityDigest !== 'function'
    || typeof fail !== 'function') {
    throw new TypeError('runtime provenance dependencies are required');
  }

  const assertText = (value, code = 'MALFORMED_INPUT') => {
    if (typeof value !== 'string'
      || value.trim() === ''
      || Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES
      || /[\u0000-\u001f\u007f]/.test(value)) {
      fail(code);
    }
    return value;
  };

  const safeId = (value, code = 'MALFORMED_INPUT') => {
    const text = assertText(value, code);
    if (!SAFE_ID.test(text)) fail(code);
    return text;
  };

  const assertAttempt = (value, code = 'MALFORMED_INPUT') => {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  };

  const normalizeStatus = (value, code = 'MALFORMED_INPUT') => {
    if (typeof value !== 'string' || value.length > 128 || !SAFE_CODE.test(value)) fail(code);
    return value;
  };

  const normalizeDigest = (value, code = 'MALFORMED_INPUT') => {
    if (typeof value !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(value)) fail(code);
    return `sha256:${value.replace(/^sha256:/i, '').toLowerCase()}`;
  };

  const readAlias = (record, aliases) => {
    for (const alias of aliases) {
      if (hasOwn(record, alias)) return record[alias];
    }
    return undefined;
  };

  const normalizeArtifactReference = (value) => {
    if (typeof value !== 'string'
      || value.trim() === ''
      || !value.endsWith('.md')
      || Buffer.byteLength(value, 'utf8') > MAX_ARTIFACT_REFERENCE_BYTES
      || value.includes('\\')
      || value.includes('\u0000')
      || /[\u0001-\u001f\u007f]/.test(value)
      || path.isAbsolute(value)
      || /^[A-Za-z]:(?:\/|\\)/.test(value)
      || value.split('/').some((segment) => segment === '..')) {
      fail('MALFORMED_INPUT');
    }
    return value;
  };

  const normalizeGate = (gate) => {
    if (!isRecord(gate)) fail('MALFORMED_INPUT');
    const result = {
      status: normalizeStatus(gate.status),
      accepted: gate.accepted,
      allowsProgress: gate.allowsProgress,
      lifecycleStatus: normalizeStatus(gate.lifecycleStatus),
      executionStatus: normalizeStatus(gate.executionStatus),
      applicability: normalizeStatus(gate.applicability),
      blockingReasons: gate.blockingReasons,
    };
    for (const field of ['accepted', 'allowsProgress']) {
      if (typeof result[field] !== 'boolean') fail('MALFORMED_INPUT');
    }
    if (!Array.isArray(result.blockingReasons) || result.blockingReasons.length > 32) {
      fail('MALFORMED_INPUT');
    }
    result.blockingReasons = result.blockingReasons.map((reason) => normalizeStatus(reason));
    if (hasOwn(gate, 'eventId')) result.eventId = safeId(gate.eventId);
    if (hasOwn(gate, 'semanticVerdict')) {
      if (!REVIEW_VERDICTS.has(gate.semanticVerdict)) fail('MALFORMED_INPUT');
      result.semanticVerdict = gate.semanticVerdict;
    }
    return result;
  };

  const normalizeEvent = (event, readiness = false) => {
    const code = readiness ? 'MALFORMED_READINESS' : 'MALFORMED_LIFECYCLE';
    if (!isRecord(event)) fail(code);
    const normalized = Object.fromEntries(Object.entries(event).filter(([key]) => (
      !PROVENANCE_LIVENESS_FIELDS.has(key) && !PROVENANCE_IDENTITY_FIELDS.has(key)
    )));
    const identity = {
      task_id: safeId(readAlias(event, ['task_id', 'taskId']), code),
      attempt_id: safeId(readAlias(event, ['attempt_id', 'attemptId']), code),
      attempt: assertAttempt(readAlias(event, ['attempt', 'dispatch_attempt']), code),
      session_id: safeId(readAlias(event, ['session_id', 'sessionId']), code),
      wave: safeId(readAlias(event, ['wave', 'dispatch_id', 'dispatchId']), code),
      scope_id: safeId(readAlias(event, ['scope_id', 'scopeId']), code),
      diff_id: safeId(readAlias(event, ['diff_id', 'diffId']), code),
    };
    normalized.schema_version = event.schema_version;
    normalized.event_id = safeId(readAlias(event, ['event_id', 'eventId']), code);
    Object.assign(normalized, identity);
    if (readiness) normalized.artifact_sha256 = normalizeDigest(event.artifact_sha256, code);
    return normalized;
  };

  function digestFromContext({
    context,
    gate,
    adapter,
    adapterVersion,
    normalizedCommands = null,
  } = {}) {
    if (!context || !isRecord(context.input)) fail('MALFORMED_INPUT');
    const artifactReference = context.artifactReference;
    if (artifactReference === undefined) {
      return identityDigest(
        context.identity,
        context.input.phase,
        adapter,
        adapterVersion,
        context.lifecycleEvents,
        context.readinessEvents,
        gate,
        context.sentinel,
        context.acceptedOutcomeCost,
      );
    }
    if (normalizeArtifactReference(artifactReference) !== artifactReference || !context.artifactDigest) {
      fail('MALFORMED_INPUT');
    }
    const normalizedGate = normalizeGate(gate);
    const commands = normalizedCommands || normalizeCommands(context.input.executedCommands);
    const record = {
      schema: RUNTIME_PROVENANCE_SCHEMA,
      identity: context.identity,
      phase: context.input.phase,
      adapter: safeId(adapter),
      adapterVersion: assertText(adapterVersion),
      plan: {
        workId: context.plan.workId,
        decisionId: context.plan.decisionId,
        planId: context.plan.planId,
        waveId: context.plan.waveId,
        obligationId: context.obligation.obligationId,
        lane: context.obligation.lane,
      },
      artifactReference,
      artifactSha256: context.artifactDigest,
      reviewRequest: context.input.reviewRequest === undefined ? null : context.input.reviewRequest,
      reviewResult: context.input.reviewResult === undefined ? null : context.input.reviewResult,
      executedCommands: commands,
      lifecycleEvents: context.lifecycleEvents.map((event) => normalizeEvent(event)),
      readinessEvents: context.readinessEvents.map((event) => normalizeEvent(event, true)),
      sentinelOutcome: context.sentinel,
      acceptedOutcomeCost: context.acceptedOutcomeCost,
      reviewGate: normalizedGate,
    };
    return `sha256:${sha256(canonicalJson(record))}`;
  }

  function digest({
    input,
    gate,
    adapter,
    adapterVersion,
  } = {}) {
    const context = normalizeObservationContext(input);
    return digestFromContext({ context, gate, adapter, adapterVersion });
  }

  return {
    RUNTIME_PROVENANCE_SCHEMA,
    normalizeArtifactReference,
    digest,
    digestFromContext,
  };
}

module.exports = {
  RUNTIME_PROVENANCE_SCHEMA,
  createRuntimeProvenance,
};
