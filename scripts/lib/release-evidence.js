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

function isBlockedConsumerScopeReceipt(input, rawResults) {
  const acceptance = input && input.acceptance;
  const requiredChecks = acceptance && acceptance.requiredChecks;
  const excludedChecks = acceptance && acceptance.excludedChecks;
  if (input.stage !== 'CONSUMER'
    || input.producer !== 'consumer-gate'
    || !input.adapter || input.adapter.id !== 'consumer-gate'
    || input.schemaVersion !== 2
    || rawResults.length !== 0
    || !acceptance || acceptance.verdict !== 'BLOCKED'
    || !Array.isArray(requiredChecks) || requiredChecks.length !== 1
    || !Array.isArray(excludedChecks) || excludedChecks.length === 0) {
    return false;
  }

  const [scopeCheck] = requiredChecks;
  return scopeCheck
    && scopeCheck.id === 'scope.configuration'
    && scopeCheck.surface === 'consumer-scope'
    && scopeCheck.kind === 'contract'
    && scopeCheck.status === 'BLOCKED'
    && scopeCheck.evidenceRef === null
    && excludedChecks.every((check) => (
      check
      && typeof check.id === 'string'
      && check.id.startsWith('scope.')
      && check.kind === 'installation'
      && check.status === 'NOT_CONFIGURED'
      && check.evidenceRef === null
    ));
}

const ACCEPTANCE_VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED']);
const ACCEPTANCE_KINDS = new Set(['installation', 'contract', 'native', 'research']);
const ACCEPTANCE_STATUSES = new Set([...CONSUMER_EVIDENCE_STATUS_VALUES, 'PENDING']);
const ACCEPTANCE_CHECK_FIELDS = new Set(['id', 'surface', 'kind', 'reason', 'status', 'evidenceRef']);
const MAX_ACCEPTANCE_CHECKS = 100;

function normalizeAcceptance(input, surfaceResults) {
  if (input.acceptance === undefined) {
    if (input.schemaVersion !== undefined) {
      throw new Error('consumer evidence: schemaVersion requires an acceptance object');
    }
    return null;
  }
  if (input.schemaVersion !== 2) throw new Error('consumer evidence: acceptance requires schemaVersion 2');
  if (input.stage !== 'CONSUMER') throw new Error('consumer evidence: acceptance is only valid for CONSUMER');

  const acceptance = input.acceptance;
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) {
    throw new Error('consumer evidence: acceptance must be an object');
  }
  if (Object.keys(acceptance).some((key) => !['verdict', 'requiredChecks', 'excludedChecks'].includes(key))) {
    throw new Error('consumer evidence: acceptance contains an unknown field');
  }
  if (!ACCEPTANCE_VERDICTS.has(acceptance.verdict)) {
    throw new Error(`consumer evidence: invalid acceptance verdict '${acceptance.verdict}'`);
  }
  if (!Array.isArray(acceptance.requiredChecks) || acceptance.requiredChecks.length === 0) {
    throw new Error('consumer evidence: acceptance requiredChecks must be a non-empty array');
  }
  if (!Array.isArray(acceptance.excludedChecks)) {
    throw new Error('consumer evidence: acceptance excludedChecks must be an array');
  }
  if (acceptance.requiredChecks.length > MAX_ACCEPTANCE_CHECKS
    || acceptance.excludedChecks.length > MAX_ACCEPTANCE_CHECKS) {
    throw new Error(`consumer evidence: acceptance check count exceeds ${MAX_ACCEPTANCE_CHECKS}`);
  }

  const seen = new Set();
  const normalizeCheck = (check, listName) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      throw new Error(`consumer evidence: acceptance ${listName} entries must be objects`);
    }
    if (Object.keys(check).some((key) => !ACCEPTANCE_CHECK_FIELDS.has(key))) {
      throw new Error(`consumer evidence: acceptance ${listName} entry contains an unknown field`);
    }
    if (typeof check.id !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/.test(check.id)) {
      throw new Error(`consumer evidence: acceptance ${listName} entry has an invalid id`);
    }
    if (seen.has(check.id)) throw new Error(`consumer evidence: duplicate acceptance check '${check.id}'`);
    seen.add(check.id);
    if (typeof check.surface !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(check.surface)) {
      throw new Error(`consumer evidence: acceptance check '${check.id}' has an invalid surface`);
    }
    if (!ACCEPTANCE_KINDS.has(check.kind)) {
      throw new Error(`consumer evidence: acceptance check '${check.id}' has an invalid kind`);
    }
    if (typeof check.reason !== 'string' || check.reason.trim().length === 0 || check.reason.length > 512) {
      throw new Error(`consumer evidence: acceptance check '${check.id}' requires a bounded reason`);
    }
    if (!ACCEPTANCE_STATUSES.has(check.status)) {
      throw new Error(`consumer evidence: acceptance check '${check.id}' has an invalid status`);
    }
    if (check.evidenceRef !== null && (typeof check.evidenceRef !== 'string' || check.evidenceRef.length > 256)) {
      throw new Error(`consumer evidence: acceptance check '${check.id}' has an invalid evidenceRef`);
    }
    if (check.status === 'PASS' && !check.evidenceRef) {
      throw new Error(`consumer evidence: passing acceptance check '${check.id}' requires evidenceRef`);
    }
    if (check.evidenceRef) {
      const segments = check.evidenceRef.split('.');
      if (segments[0] !== 'surfaceResults' || segments.length < 2
        || segments.some((segment) => !/^[a-z][a-zA-Z0-9_-]*$/.test(segment))) {
        throw new Error(`consumer evidence: acceptance check '${check.id}' has an unsupported evidenceRef`);
      }
      const result = surfaceResults.find((row) => row.surface === segments[1]);
      if (!result) throw new Error(`consumer evidence: acceptance check '${check.id}' references a missing surface`);
      if (check.surface !== result.surface) {
        throw new Error(`consumer evidence: acceptance check '${check.id}' references a different surface`);
      }
      let target = result;
      for (const segment of segments.slice(2)) {
        if (!target || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, segment)) {
          throw new Error(`consumer evidence: acceptance check '${check.id}' has a dangling evidenceRef`);
        }
        target = target[segment];
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)
        || !Object.prototype.hasOwnProperty.call(target, 'status') || target.status !== check.status) {
        throw new Error(`consumer evidence: acceptance check '${check.id}' status does not match referenced evidence`);
      }
    }
    return boundedEvidenceValue(check);
  };

  const requiredChecks = acceptance.requiredChecks.map((check) => normalizeCheck(check, 'requiredChecks'));
  const excludedChecks = acceptance.excludedChecks.map((check) => normalizeCheck(check, 'excludedChecks'));
  const hasFailure = requiredChecks.some((check) => check.status === 'FAIL');
  const allRequiredPass = requiredChecks.every((check) => check.status === 'PASS');
  const derivedVerdict = hasFailure ? 'FAIL' : (allRequiredPass ? 'PASS' : 'BLOCKED');
  if (acceptance.verdict !== derivedVerdict) {
    throw new Error('consumer evidence: acceptance verdict does not match required check statuses');
  }
  if (input.verdict !== undefined && input.verdict !== acceptance.verdict) {
    throw new Error('consumer evidence: stage verdict does not match acceptance verdict');
  }
  return { verdict: acceptance.verdict, requiredChecks, excludedChecks };
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
  if (!Array.isArray(rawResults)
    || (rawResults.length === 0 && !isBlockedConsumerScopeReceipt(input, rawResults))) {
    throw new Error('consumer evidence: missing surface results or blocked scope-selection receipt');
  }
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
  const acceptance = normalizeAcceptance(input, surfaceResults);
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
    ...(acceptance ? { schemaVersion: 2, acceptance } : {}),
    ...(input.runtimeVerified === true
      && !acceptance
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
