'use strict';

// Release evidence: three independently reported verdicts (SOURCE, PACKAGE,
// CONSUMER) plus an overall state derived from them. A SOURCE PASS never
// collapses into consumer readiness — see
// openspec/changes/harden-dhpk-release-contracts/specs/consumer-post-install-validation/spec.md.
//
// This module is a schema + builder, not an orchestrator: callers run their
// own gates (tests/run-all.js, the validators, package smoke tests, consumer
// checks) and hand the results in as stage objects.

const STAGES = ['SOURCE', 'PACKAGE', 'CONSUMER'];

const CONSUMER_EVIDENCE_STATUSES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_RUN: 'NOT_RUN',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  SKIP_INCOMPATIBLE: 'SKIP_INCOMPATIBLE',
  BLOCKED: 'BLOCKED',
  UNAVAILABLE: 'UNAVAILABLE',
});

const CONSUMER_EVIDENCE_STATUS_VALUES = Object.freeze(Object.values(CONSUMER_EVIDENCE_STATUSES));

const { redactSensitiveText } = require('./redaction');

const VERDICTS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  UNAVAILABLE: 'UNAVAILABLE',
  PENDING: 'PENDING',
};

// PUBLISHED_PENDING covers both "SOURCE+PACKAGE PASS, not yet tagged" and
// "tag exists, CONSUMER verification still running" — callers distinguish
// those by whether a tag/publication record exists alongside this evidence.
const OVERALL_STATES = {
  BLOCKED: 'BLOCKED',
  PUBLISHED_PENDING: 'PUBLISHED_PENDING',
  PUBLISHED_UNHEALTHY: 'PUBLISHED_UNHEALTHY',
  COMPLETE: 'COMPLETE',
};

function requireStageFields(name, stage) {
  const errors = [];
  if (!stage || typeof stage !== 'object') {
    errors.push(`${name}: missing stage object`);
    return errors;
  }
  if (!Object.values(VERDICTS).includes(stage.verdict)) {
    errors.push(`${name}: invalid verdict '${stage.verdict}' (expected one of ${Object.values(VERDICTS).join(', ')})`);
  }
  if (!Array.isArray(stage.commands)) errors.push(`${name}: 'commands' must be an array`);
  if (typeof stage.environment !== 'string' || !stage.environment) errors.push(`${name}: missing 'environment'`);
  if (!Array.isArray(stage.artifacts)) errors.push(`${name}: 'artifacts' must be an array`);
  if (!Array.isArray(stage.failureReasons)) errors.push(`${name}: 'failureReasons' must be an array`);
  return errors;
}

function validateEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence.version !== 'string' || !evidence.version) {
    errors.push('missing version');
  }
  for (const name of STAGES) {
    errors.push(...requireStageFields(name, evidence && evidence.stages && evidence.stages[name]));
  }
  if (evidence && !Object.values(OVERALL_STATES).includes(evidence.overall)) {
    errors.push(`invalid overall state '${evidence && evidence.overall}'`);
  }
  return { ok: errors.length === 0, errors };
}

function deriveOverall(stages) {
  const { SOURCE, PACKAGE, CONSUMER } = stages;

  if (SOURCE.verdict !== VERDICTS.PASS) return OVERALL_STATES.BLOCKED;
  if (PACKAGE.verdict !== VERDICTS.PASS) return OVERALL_STATES.BLOCKED;

  if (CONSUMER.verdict === VERDICTS.PASS) return OVERALL_STATES.COMPLETE;
  if (CONSUMER.verdict === VERDICTS.FAIL) return OVERALL_STATES.PUBLISHED_UNHEALTHY;
  if (CONSUMER.verdict === VERDICTS.BLOCKED) return OVERALL_STATES.BLOCKED;
  // PENDING or UNAVAILABLE: SOURCE+PACKAGE ready, tag not yet published or
  // consumer verification still running/unresolved.
  return OVERALL_STATES.PUBLISHED_PENDING;
}

function buildEvidence({ version, stages }) {
  for (const name of STAGES) {
    if (!stages || !stages[name]) {
      throw new Error(`release-evidence: missing required stage '${name}'`);
    }
  }
  const evidence = {
    version,
    stages: {
      SOURCE: stages.SOURCE,
      PACKAGE: stages.PACKAGE,
      CONSUMER: stages.CONSUMER,
    },
  };
  if (Array.isArray(stages.CONSUMER.surfaceResults) && stages.CONSUMER.surfaceResults.length > 0) {
    evidence.stages.CONSUMER = normalizeConsumerEvidence({
      ...stages.CONSUMER,
      stage: 'CONSUMER',
    });
  }
  evidence.overall = deriveOverall(evidence.stages);

  const validation = validateEvidence(evidence);
  if (!validation.ok) {
    throw new Error(`release-evidence: invalid evidence:\n${validation.errors.join('\n')}`);
  }
  return evidence;
}

function boundedEvidenceValue(value, depth = 0, key = '') {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') {
    if (/authorization|proxy.?authorization|token|password|secret|api.?key|credential/i.test(key)) return '<redacted>';
    if (/^(?:path|packageRoot|cwd|home|root|sourcePath|installedCachePath)$/i.test(key) && /^(?:\/|[A-Za-z]:[\\/])/.test(value)) {
      return `<path>/${value.split(/[\\/]/).pop()}`;
    }
    const redacted = redactSensitiveText(value, { maxLength: 4096 });
    const containsSensitiveText = /authorization|proxy.?authorization|bearer\s+|basic\s+|token\s*[:=]|password\s*[:=]|secret\s*[:=]|api.?key\s*[:=]|credential\s*[:=]/i.test(value);
    return containsSensitiveText && !/<redacted>/i.test(redacted)
      ? `<redacted> ${redacted}`.slice(0, 4096)
      : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => boundedEvidenceValue(entry, depth + 1, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([entryKey, entry]) => {
    const safeKey = /authorization|proxy.?authorization|token|password|secret|api.?key|credential/i.test(entryKey)
      ? '<redacted-key>'
      : entryKey;
    return [safeKey, boundedEvidenceValue(entry, depth + 1, entryKey)];
  }));
}

function consumerStatus(input) {
  return input && (input.status || input.verdict);
}

function normalizeConsumerSurface(raw, envelope) {
  if (!raw || typeof raw !== 'object') throw new Error('consumer evidence: surface result must be an object');
  const surface = raw.surface || envelope.surface;
  const status = consumerStatus(raw);
  const legacySurfaceStatus = raw.status === 'WARN' || raw.verdict === 'WARN'
    ? 'WARN'
    : raw.legacySurfaceStatus;
  if (typeof surface !== 'string' || !surface) throw new Error('consumer evidence: missing surface');
  if (raw.stage && raw.stage !== envelope.stage) {
    throw new Error(`consumer evidence: surface '${surface}' stage '${raw.stage}' does not match enclosing stage '${envelope.stage}'`);
  }
  if (raw.environment === undefined && envelope.environment === undefined) throw new Error(`consumer evidence: missing environment for surface '${surface}'`);
  if (raw.commands !== undefined && !Array.isArray(raw.commands)) throw new Error(`consumer evidence: commands must be an array for surface '${surface}'`);
  if (raw.artifacts !== undefined && !Array.isArray(raw.artifacts)) throw new Error(`consumer evidence: artifacts must be an array for surface '${surface}'`);
  if (!CONSUMER_EVIDENCE_STATUS_VALUES.includes(status)) {
    throw new Error(`consumer evidence: invalid status '${status}'`);
  }
  const planFingerprint = raw.planFingerprint || envelope.planFingerprint || null;
  const artifactFingerprint = raw.artifactFingerprint || envelope.artifactFingerprint || null;
  if ((planFingerprint && !artifactFingerprint) || (!planFingerprint && artifactFingerprint)) {
    throw new Error(`consumer evidence: plan/artifact binding must be declared as a pair for surface '${surface}'`);
  }
  if (planFingerprint && !/^sha256:[a-f0-9]{64}$/i.test(planFingerprint)) {
    throw new Error(`consumer evidence: invalid plan fingerprint for surface '${surface}'`);
  }
  if (artifactFingerprint && !/^sha256:[a-f0-9]{64}$/i.test(artifactFingerprint)) {
    throw new Error(`consumer evidence: invalid artifact fingerprint for surface '${surface}'`);
  }
  if (raw.planFingerprint && envelope.planFingerprint && raw.planFingerprint !== envelope.planFingerprint) {
    throw new Error(`consumer evidence: stale plan binding for surface '${surface}'`);
  }
  if (raw.artifactFingerprint && envelope.artifactFingerprint && raw.artifactFingerprint !== envelope.artifactFingerprint) {
    throw new Error(`consumer evidence: stale artifact binding for surface '${surface}'`);
  }
  const safeRaw = boundedEvidenceValue(raw);
  const { runtimeVerified: _runtimeVerified, runtimeStatus: _runtimeStatus, stage: _stage, ...safeSurface } = safeRaw;
  return {
    ...safeSurface,
    stage: envelope.stage,
    surface,
    status,
    adapter: boundedEvidenceValue(raw.adapter || envelope.adapter || null),
    commands: boundedEvidenceValue(raw.commands || []),
    environment: boundedEvidenceValue(raw.environment === undefined ? envelope.environment : raw.environment),
    artifacts: boundedEvidenceValue(raw.artifacts || []),
    diagnostics: boundedEvidenceValue(raw.diagnostics || raw.diagnostic || []),
    reasons: boundedEvidenceValue(raw.reasons || raw.failureReasons || (raw.reason ? [raw.reason] : [])),
    checkedClaims: boundedEvidenceValue(raw.checkedClaims || []),
    planFingerprint,
    artifactFingerprint,
    ...(legacySurfaceStatus ? { legacySurfaceStatus } : {}),
  };
}

/**
 * Normalize producer-owned consumer evidence without executing a probe.
 * The returned object intentionally retains legacy top-level fields and adds
 * a stage-bound surfaceResults array for new orchestration consumers.
 */
function normalizeConsumerEvidence(input) {
  if (!input || typeof input !== 'object') throw new Error('consumer evidence: input must be an object');
  const stage = input.stage;
  if (!STAGES.includes(stage)) throw new Error(`consumer evidence: invalid or missing stage '${stage || ''}'`);
  const rawResults = input.surfaceResults || (input.surface ? [input] : []);
  if (!Array.isArray(rawResults) || rawResults.length === 0) throw new Error('consumer evidence: missing surface results');
  const seen = new Set();
  const envelope = {
    stage,
    surface: input.surface,
    adapter: input.adapter,
    environment: input.environment,
    planFingerprint: input.planFingerprint || null,
    artifactFingerprint: input.artifactFingerprint || null,
  };
  if (envelope.planFingerprint && !envelope.artifactFingerprint) {
    throw new Error('consumer evidence: artifact binding is required when plan binding applies');
  }
  const surfaceResults = rawResults.map((raw) => {
    const normalized = normalizeConsumerSurface(raw, envelope);
    if (seen.has(normalized.surface)) throw new Error(`consumer evidence: duplicate surface '${normalized.surface}'`);
    seen.add(normalized.surface);
    return normalized;
  });
  if (envelope.planFingerprint && !/^sha256:[a-f0-9]{64}$/i.test(envelope.planFingerprint)) {
    throw new Error('consumer evidence: invalid plan fingerprint');
  }
  if (envelope.artifactFingerprint && !/^sha256:[a-f0-9]{64}$/i.test(envelope.artifactFingerprint)) {
    throw new Error('consumer evidence: invalid artifact fingerprint');
  }
  const safeInput = boundedEvidenceValue(input);
  const { runtimeVerified: _runtimeVerified, runtimeStatus: _runtimeStatus, ...safeEnvelope } = safeInput;
  return {
    ...safeEnvelope,
    stage,
    surfaceResults,
    ...(input.runtimeVerified === true
      && stage === 'CONSUMER'
      && surfaceResults.every((result) => result.status === CONSUMER_EVIDENCE_STATUSES.PASS)
      ? { runtimeVerified: true }
      : {}),
  };
}

function validateConsumerEvidence(input) {
  try {
    normalizeConsumerEvidence(input);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

module.exports = {
  STAGES,
  VERDICTS,
  OVERALL_STATES,
  CONSUMER_EVIDENCE_STATUSES,
  buildEvidence,
  validateEvidence,
  normalizeConsumerEvidence,
  validateConsumerEvidence,
  normalizeConsumerResult: normalizeConsumerEvidence,
  validateConsumerResult: validateConsumerEvidence,
};
