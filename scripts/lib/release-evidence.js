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

const REQUIREMENT_STATUSES = new Set([...CONSUMER_EVIDENCE_STATUS_VALUES, 'PENDING']);
const REQUIREMENT_TRIGGERS = new Set([
  'new-host',
  'loader-change',
  'role-registration-change',
  'tool-mapping-change',
  'activation-defect',
  'explicit-native',
]);
const REQUIREMENT_EVIDENCE_FIELDS = new Set([
  'id', 'host', 'capability', 'trigger', 'reason', 'question', 'requestedEvidenceKind',
  'evidenceKind', 'authorized', 'checkKey', 'status', 'adapter', 'contractEvidence',
  'nativeProof', 'runtimeVerified', 'outcomeReason', 'observedStatus', 'identity', 'evidenceReuse',
]);
const REQUIREMENT_ADAPTER_FIELDS = new Set(['id', 'version']);
const NATIVE_PROOF_HASH = /^[a-f0-9]{64}$/i;
const CONSUMER_CHECK_IDENTITY_FIELDS = Object.freeze([
  'contractVersion',
  'sourceFingerprint',
  'artifactFingerprint',
  'selectionFingerprint',
  'hostVersion',
  'configFingerprint',
]);
const CONSUMER_CHECK_IDENTITY_FINGERPRINT_FIELDS = Object.freeze([
  'sourceFingerprint',
  'artifactFingerprint',
  'selectionFingerprint',
  'configFingerprint',
]);
const CONSUMER_CHECK_IDENTITY_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const CONSUMER_CHECK_IDENTITY_MISMATCH_FIELDS = new Set([
  ...CONSUMER_CHECK_IDENTITY_FIELDS,
  'checkKey',
  'evidenceKind',
  'status',
  'nativeProof',
]);

function normalizeConsumerCheckIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || Object.keys(identity).length !== CONSUMER_CHECK_IDENTITY_FIELDS.length
    || Object.keys(identity).some((key) => !CONSUMER_CHECK_IDENTITY_FIELDS.includes(key))) {
    throw new Error('consumer evidence: consumer check identity must match the frozen flat contract');
  }
  if (identity.contractVersion !== 'consumer-check-identity.v1') {
    throw new Error('consumer evidence: consumer check identity contractVersion is invalid');
  }
  for (const field of CONSUMER_CHECK_IDENTITY_FINGERPRINT_FIELDS) {
    if (typeof identity[field] !== 'string' || !CONSUMER_CHECK_IDENTITY_FINGERPRINT.test(identity[field])) {
      throw new Error(`consumer evidence: consumer check identity ${field} must be sha256 plus 64 lowercase hex characters`);
    }
  }
  if (typeof identity.hostVersion !== 'string' || identity.hostVersion.length === 0
    || identity.hostVersion.length > 200 || identity.hostVersion.trim() !== identity.hostVersion
    || /[\u0000-\u001f\u007f]/.test(identity.hostVersion)) {
    throw new Error('consumer evidence: consumer check identity hostVersion must be an exact bounded Host version');
  }
  return {
    contractVersion: identity.contractVersion,
    sourceFingerprint: identity.sourceFingerprint,
    artifactFingerprint: identity.artifactFingerprint,
    selectionFingerprint: identity.selectionFingerprint,
    hostVersion: identity.hostVersion,
    configFingerprint: identity.configFingerprint,
  };
}

function normalizeConsumerEvidenceReuse(evidenceReuse) {
  const allowed = new Set(['decision', 'origin', 'mismatchFields', 'rejectionReason', 'conflicts']);
  if (!evidenceReuse || typeof evidenceReuse !== 'object' || Array.isArray(evidenceReuse)
    || Object.keys(evidenceReuse).some((key) => !allowed.has(key))
    || !['REUSED', 'REJECTED'].includes(evidenceReuse.decision)
    || !Array.isArray(evidenceReuse.mismatchFields)
    || evidenceReuse.mismatchFields.length > CONSUMER_CHECK_IDENTITY_MISMATCH_FIELDS.size
    || evidenceReuse.mismatchFields.some((field) => (
      typeof field !== 'string' || !CONSUMER_CHECK_IDENTITY_MISMATCH_FIELDS.has(field)
    ))
    || new Set(evidenceReuse.mismatchFields).size !== evidenceReuse.mismatchFields.length) {
    throw new Error('consumer evidence: requirement evidenceReuse is malformed');
  }
  let origin = null;
  if (evidenceReuse.origin !== undefined && evidenceReuse.origin !== null) {
    const candidate = evidenceReuse.origin;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.keys(candidate).sort().join(',') !== 'checkId,envelopeIndex,slot,surface'
      || !Number.isInteger(candidate.envelopeIndex) || candidate.envelopeIndex < 0 || candidate.envelopeIndex > 15
      || typeof candidate.surface !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.surface)
      || typeof candidate.slot !== 'string' || !/^check[1-9][0-9]{0,2}$/.test(candidate.slot)
      || typeof candidate.checkId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.checkId)) {
      throw new Error('consumer evidence: requirement evidenceReuse origin is malformed');
    }
    origin = {
      envelopeIndex: candidate.envelopeIndex,
      surface: candidate.surface,
      slot: candidate.slot,
      checkId: candidate.checkId,
    };
  }
  if (evidenceReuse.decision === 'REUSED'
    && (!origin || evidenceReuse.mismatchFields.length > 0)) {
    throw new Error('consumer evidence: reused evidence requires an exact origin and no mismatch fields');
  }
  let conflicts;
  if (evidenceReuse.conflicts !== undefined) {
    const rawConflicts = evidenceReuse.conflicts;
    if (!Array.isArray(rawConflicts) || rawConflicts.length < 2 || rawConflicts.length > 100) {
      throw new Error('consumer evidence: conflicting reuse evidence requires a bounded origin list');
    }
    const seen = new Set();
    conflicts = rawConflicts.map((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || Object.keys(candidate).sort().join(',') !== 'checkId,envelopeIndex,slot,status,surface'
        || !Number.isInteger(candidate.envelopeIndex) || candidate.envelopeIndex < 0 || candidate.envelopeIndex > 15
        || typeof candidate.surface !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.surface)
        || typeof candidate.slot !== 'string' || !/^check[1-9][0-9]{0,2}$/.test(candidate.slot)
        || typeof candidate.checkId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.checkId)
        || !['PASS', 'FAIL'].includes(candidate.status)) {
        throw new Error('consumer evidence: conflicting reuse origin is malformed');
      }
      const key = `${candidate.envelopeIndex}:${candidate.surface}:${candidate.slot}:${candidate.checkId}`;
      if (seen.has(key)) throw new Error('consumer evidence: conflicting reuse origins must be unique');
      seen.add(key);
      return {
        envelopeIndex: candidate.envelopeIndex,
        surface: candidate.surface,
        slot: candidate.slot,
        checkId: candidate.checkId,
        status: candidate.status,
      };
    });
    if (!conflicts.some((entry) => entry.status === 'PASS')
      || !conflicts.some((entry) => entry.status === 'FAIL')) {
      throw new Error('consumer evidence: conflict provenance must retain both PASS and FAIL outcomes');
    }
  }
  if (evidenceReuse.rejectionReason !== undefined
    && (evidenceReuse.decision !== 'REJECTED'
      || evidenceReuse.rejectionReason !== 'CONFLICTING_EVIDENCE'
      || !conflicts)) {
    throw new Error('consumer evidence: reuse rejection reason is unsupported');
  }
  if (conflicts && evidenceReuse.rejectionReason !== 'CONFLICTING_EVIDENCE') {
    throw new Error('consumer evidence: conflict provenance requires a conflicting-evidence reason');
  }
  return {
    decision: evidenceReuse.decision,
    origin,
    mismatchFields: [...evidenceReuse.mismatchFields],
    ...(evidenceReuse.rejectionReason !== undefined ? { rejectionReason: evidenceReuse.rejectionReason } : {}),
    ...(conflicts ? { conflicts } : {}),
  };
}

function requirementTuple(surface, capability, kind, trigger) {
  if (capability === 'installation-contract') {
    return kind === 'contract' && !['activation-defect', 'explicit-native'].includes(trigger);
  }
  if (capability === 'package-loader') {
    return ['agent-plugin', 'cursor-plugin'].includes(surface) && ['contract', 'native'].includes(kind);
  }
  return surface === 'codex-sync'
    && /^named-role-[a-z][a-z0-9-]{0,62}$/.test(capability)
    && ['contract', 'native'].includes(kind);
}

function normalizeRequirementAdapter(adapter, surface, capability, kind) {
  if (adapter === undefined || adapter === null) return null;
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)
    || Object.keys(adapter).some((key) => !REQUIREMENT_ADAPTER_FIELDS.has(key))
    || typeof adapter.id !== 'string' || adapter.id.length === 0 || adapter.id.length > 100
    || typeof adapter.version !== 'string' || adapter.version.length === 0 || adapter.version.length > 80) {
    throw new Error('consumer evidence: requirement adapter is malformed');
  }
  const expectedId = capability === 'installation-contract'
    ? 'consumer-gate'
    : capability === 'package-loader'
      ? 'consumer-platform-probe'
      : kind === 'native' ? 'codex-named-role-probe' : 'codex-role-materialization';
  if (adapter.id !== expectedId) throw new Error(`consumer evidence: requirement adapter does not match ${surface}:${capability}:${kind}`);
  return boundedEvidenceValue(adapter);
}

function normalizeRoleContract(contractEvidence, capability, status, surfaceRecord) {
  const roleId = capability.slice('named-role-'.length);
  const role = contractEvidence.role;
  if (!role || typeof role !== 'object' || Array.isArray(role)
    || Object.keys(role).some((key) => !['path', 'fingerprint', 'sourceFingerprint', 'destinationFingerprint'].includes(key))
    || role.path !== `agents/${roleId}.toml`) {
    throw new Error('consumer evidence: Codex role contract proof does not match its capability');
  }
  const normalizedRole = { path: role.path };
  for (const field of ['fingerprint', 'sourceFingerprint', 'destinationFingerprint']) {
    if (role[field] !== undefined) {
      if (typeof role[field] !== 'string' || !NATIVE_PROOF_HASH.test(role[field])) {
        throw new Error(`consumer evidence: Codex role contract ${field} is invalid`);
      }
      normalizedRole[field] = role[field].toLowerCase();
    }
  }
  const resources = contractEvidence.resources;
  if (!Array.isArray(resources) || resources.length > 64) {
    throw new Error('consumer evidence: Codex role contract resources must be a bounded array');
  }
  const normalizedResources = resources.map((resource) => {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)
      || Object.keys(resource).some((key) => !['path', 'fingerprint', 'sourceFingerprint', 'destinationFingerprint'].includes(key))
      || typeof resource.path !== 'string' || !/^\.codex\/dhpk\/[A-Za-z0-9._/-]+\.md$/.test(resource.path)
      || resource.path.length > 4096
      || resource.path.split('/').includes('..')) {
      throw new Error('consumer evidence: Codex role contract resource is invalid');
    }
    const normalized = { path: resource.path };
    for (const field of ['fingerprint', 'sourceFingerprint', 'destinationFingerprint']) {
      if (resource[field] !== undefined) {
        if (typeof resource[field] !== 'string' || !NATIVE_PROOF_HASH.test(resource[field])) {
          throw new Error(`consumer evidence: Codex role contract resource ${field} is invalid`);
        }
        normalized[field] = resource[field].toLowerCase();
      }
    }
    return normalized;
  });
  if (status === 'PASS') {
    if (!NATIVE_PROOF_HASH.test(normalizedRole.sourceFingerprint || '')
      || !NATIVE_PROOF_HASH.test(normalizedRole.destinationFingerprint || '')
      || normalizedRole.sourceFingerprint !== normalizedRole.destinationFingerprint
      || (normalizedRole.fingerprint && normalizedRole.fingerprint !== normalizedRole.destinationFingerprint)
      || normalizedResources.some((resource) => (
        !NATIVE_PROOF_HASH.test(resource.sourceFingerprint || '')
          || !NATIVE_PROOF_HASH.test(resource.destinationFingerprint || '')
          || resource.sourceFingerprint !== resource.destinationFingerprint
      ))) {
      throw new Error('consumer evidence: passing Codex role contract lacks matching receipt fingerprints');
    }
  }
  return { role: normalizedRole, resources: normalizedResources };
}

function normalizeRequirementContract(contractEvidence, surface, capability, status, surfaceRecord) {
  if (contractEvidence === undefined || contractEvidence === null) {
    if (status === 'PASS') throw new Error('consumer evidence: contract PASS requires observed contract evidence');
    return null;
  }
  const allowed = new Set(['status', 'adapterRoute', 'reason', 'evidenceRef', 'role', 'resources']);
  if (!contractEvidence || typeof contractEvidence !== 'object' || Array.isArray(contractEvidence)
    || Object.keys(contractEvidence).some((key) => !allowed.has(key))
    || !REQUIREMENT_STATUSES.has(contractEvidence.status)
    || contractEvidence.status !== status
    || typeof contractEvidence.adapterRoute !== 'string'
    || (contractEvidence.reason !== undefined
      && (typeof contractEvidence.reason !== 'string' || contractEvidence.reason.length > 512))) {
    throw new Error('consumer evidence: requirement contract evidence is malformed or has a mismatched status');
  }
  const expectedRoute = capability === 'installation-contract'
    ? 'consumer-gate-installation'
    : capability === 'package-loader'
      ? `${surface === 'agent-plugin' ? 'agent' : 'cursor'}-plugin-package-contract`
      : 'codex-role-materialization';
  if (contractEvidence.adapterRoute !== expectedRoute) {
    throw new Error('consumer evidence: contract evidence adapter route does not match its capability');
  }
  if (capability === 'named-role-security-reviewer' || capability.startsWith('named-role-')) {
    const proof = normalizeRoleContract(contractEvidence, capability, status, surfaceRecord);
    return {
      status,
      adapterRoute: expectedRoute,
      reason: boundedEvidenceValue(contractEvidence.reason || 'Codex role receipt evidence was observed'),
      ...proof,
    };
  }
  const expectedRef = `surfaceResults.${surface}.installationEvidence`;
  if (contractEvidence.evidenceRef !== expectedRef) {
    throw new Error('consumer evidence: contract evidence must reference the observed installation contract');
  }
  const installationEvidence = surfaceRecord.installationEvidence;
  if (!installationEvidence || installationEvidence.status !== status) {
    throw new Error('consumer evidence: contract evidence does not resolve to the observed installation record');
  }
  return {
    status,
    adapterRoute: expectedRoute,
    reason: boundedEvidenceValue(contractEvidence.reason || 'Installation contract evidence was observed'),
    evidenceRef: expectedRef,
  };
}

function normalizeCodexNativeProof(proof, capability) {
  const expectedRole = capability.slice('named-role-'.length);
  const allowed = new Set(['executionOrigin', 'adapterRoute', 'roles', 'registryPreconditions', 'cliVersion']);
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).some((key) => !allowed.has(key))
    || proof.executionOrigin !== 'native' || proof.adapterRoute !== 'codex-named-role'
    || !Array.isArray(proof.roles) || proof.roles.length !== 1) {
    throw new Error('consumer evidence: Codex native role proof is missing or malformed');
  }
  const [role] = proof.roles;
  if (!role || typeof role !== 'object' || Array.isArray(role)
    || Object.keys(role).some((key) => !['id', 'agentTypeAccepted', 'threadId', 'childCompleted'].includes(key))
    || role.id !== expectedRole || role.agentTypeAccepted !== true
    || typeof role.threadId !== 'string' || role.threadId.trim().length === 0 || role.threadId.length > 200
    || role.childCompleted !== true) {
    throw new Error('consumer evidence: Codex native proof must cover the exact completed singleton role');
  }
  const preconditions = proof.registryPreconditions;
  if (!preconditions || typeof preconditions !== 'object' || Array.isArray(preconditions)
    || Object.keys(preconditions).sort().join(',') !== 'authReference,disposableCodexHome,projectTrust,userConfigIgnored'
    || preconditions.disposableCodexHome !== true || preconditions.authReference !== 'symlink'
    || preconditions.projectTrust !== 'trusted' || preconditions.userConfigIgnored !== false) {
    throw new Error('consumer evidence: Codex native proof is missing registry preconditions');
  }
  if (proof.cliVersion !== undefined
    && (typeof proof.cliVersion !== 'string' || proof.cliVersion.trim().length === 0 || proof.cliVersion.length > 200)) {
    throw new Error('consumer evidence: Codex native proof CLI version is invalid');
  }
  return {
    executionOrigin: 'native',
    adapterRoute: 'codex-named-role',
    roles: [{ id: expectedRole, agentTypeAccepted: true, threadId: role.threadId, childCompleted: true }],
    registryPreconditions: {
      disposableCodexHome: true,
      authReference: 'symlink',
      projectTrust: 'trusted',
      userConfigIgnored: false,
    },
    ...(proof.cliVersion !== undefined ? { cliVersion: boundedEvidenceValue(proof.cliVersion) } : {}),
  };
}

function normalizeLoaderNativeProof(proof, surface) {
  const expectedRoute = `${surface === 'agent-plugin' ? 'agent' : 'cursor'}-plugin-loader`;
  const allowed = new Set([
    'executionOrigin', 'adapterRoute', 'exit_code', 'network', 'challenge_verified',
    'loader_attestation', 'session_files',
  ]);
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).some((key) => !allowed.has(key))
    || proof.executionOrigin !== 'native' || proof.adapterRoute !== expectedRoute
    || proof.exit_code !== 0 || !['shared', 'disabled'].includes(proof.network)
    || proof.challenge_verified !== true || proof.loader_attestation !== true
    || !Array.isArray(proof.session_files) || proof.session_files.length > 32
    || !proof.session_files.includes('.config/cursor/auth.json')
    || proof.session_files.some((file) => typeof file !== 'string' || file.length > 200
      || pathIsAbsolute(file) || file.split(/[\\/]/).includes('..'))) {
    throw new Error('consumer evidence: challenged package-loader native proof is missing or malformed');
  }
  return {
    executionOrigin: 'native',
    adapterRoute: expectedRoute,
    exit_code: 0,
    network: proof.network,
    challenge_verified: true,
    loader_attestation: true,
    session_files: boundedEvidenceValue(proof.session_files),
  };
}

function pathIsAbsolute(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeRequirementProof(proof, surface, capability) {
  return capability === 'package-loader'
    ? normalizeLoaderNativeProof(proof, surface)
    : normalizeCodexNativeProof(proof, capability);
}

function normalizeRequirementEvidence(raw, surface, surfaceRecord) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).length === 0 || Object.keys(raw).length > MAX_ACCEPTANCE_CHECKS) {
    throw new Error('consumer evidence: requirementEvidence must be a bounded non-empty object');
  }
  const result = {};
  for (const [slot, evidence] of Object.entries(raw)) {
    if (!/^check[1-9][0-9]{0,2}$/.test(slot)
      || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
      || Object.keys(evidence).some((key) => !REQUIREMENT_EVIDENCE_FIELDS.has(key))) {
      throw new Error('consumer evidence: requirement evidence slot is malformed');
    }
    if (typeof evidence.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(evidence.id)
      || evidence.host !== ({ claude: 'claude', 'claude-core': 'claude', 'codex-sync': 'codex', 'codex-native': 'codex', 'cursor-sync': 'cursor', 'agent-plugin': 'cursor', 'cursor-plugin': 'cursor' })[surface]
      || typeof evidence.capability !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(evidence.capability)
      || !REQUIREMENT_TRIGGERS.has(evidence.trigger)
      || typeof evidence.reason !== 'string' || evidence.reason.trim().length === 0 || evidence.reason.length > 240
      || typeof evidence.question !== 'string' || evidence.question.trim().length === 0 || evidence.question.length > 240
      || !['contract', 'native'].includes(evidence.requestedEvidenceKind)
      || !['contract', 'native'].includes(evidence.evidenceKind)
      || evidence.evidenceKind !== (evidence.trigger === 'explicit-native' ? 'native' : evidence.requestedEvidenceKind)
      || typeof evidence.authorized !== 'boolean'
      || evidence.checkKey !== `${surface}:${evidence.capability}:${evidence.evidenceKind}`
      || !REQUIREMENT_STATUSES.has(evidence.status)) {
      throw new Error(`consumer evidence: requirement evidence '${slot}' has invalid identity or status`);
    }
    const supported = requirementTuple(surface, evidence.capability, evidence.evidenceKind, evidence.trigger);
    if (!supported && evidence.status !== 'BLOCKED') {
      throw new Error('consumer evidence: unsupported capability/evidence pair must remain BLOCKED');
    }
    if (evidence.trigger === 'explicit-native' && evidence.evidenceKind !== 'native') {
      throw new Error('consumer evidence: explicit-native requirements must use native evidence');
    }
    const adapter = normalizeRequirementAdapter(evidence.adapter, surface, evidence.capability, evidence.evidenceKind);
    const identity = evidence.identity === undefined
      ? null
      : normalizeConsumerCheckIdentity(evidence.identity);
    const evidenceReuse = evidence.evidenceReuse === undefined
      ? null
      : normalizeConsumerEvidenceReuse(evidence.evidenceReuse);
    let contractEvidence = null;
    let nativeProof = null;
    if (evidence.evidenceKind === 'contract') {
      contractEvidence = normalizeRequirementContract(
        evidence.contractEvidence,
        surface,
        evidence.capability,
        evidence.status,
        surfaceRecord,
      );
      if (evidence.runtimeVerified === true) {
        // Contract evidence cannot make a runtime claim.
      }
    } else if (evidence.nativeProof !== undefined) {
      nativeProof = normalizeRequirementProof(evidence.nativeProof, surface, evidence.capability);
    }
    if (evidence.evidenceKind === 'native' && evidence.status === 'PASS' && !nativeProof) {
      throw new Error('consumer evidence: native PASS requires typed native proof');
    }
    if (evidence.runtimeVerified === true && evidence.evidenceKind === 'native'
      && (evidence.status !== 'PASS' || !nativeProof)) {
      throw new Error('consumer evidence: runtimeVerified requires passing native proof on this capability');
    }
    if (evidenceReuse && evidenceReuse.decision === 'REUSED'
      && (!identity || evidence.evidenceKind !== 'native' || evidence.status !== 'PASS' || !nativeProof)) {
      throw new Error('consumer evidence: reused evidence requires current native PASS identity and typed proof');
    }
    if (evidence.evidenceKind === 'native' && !evidence.authorized && evidence.status !== 'BLOCKED'
      && (!evidenceReuse || evidenceReuse.decision !== 'REUSED')) {
      throw new Error('consumer evidence: unauthorized native requirements must remain BLOCKED unless typed evidence was reused');
    }
    if (evidence.observedStatus !== undefined && !REQUIREMENT_STATUSES.has(evidence.observedStatus)) {
      throw new Error('consumer evidence: requirement observedStatus is invalid');
    }
    if (evidence.outcomeReason !== undefined
      && (typeof evidence.outcomeReason !== 'string' || evidence.outcomeReason.length > 512)) {
      throw new Error('consumer evidence: requirement outcomeReason is invalid');
    }
    result[slot] = {
      id: evidence.id,
      host: evidence.host,
      capability: evidence.capability,
      trigger: evidence.trigger,
      reason: boundedEvidenceValue(evidence.reason),
      question: boundedEvidenceValue(evidence.question),
      requestedEvidenceKind: evidence.requestedEvidenceKind,
      evidenceKind: evidence.evidenceKind,
      authorized: evidence.authorized,
      checkKey: evidence.checkKey,
      status: evidence.status,
      ...(evidence.observedStatus !== undefined ? { observedStatus: evidence.observedStatus } : {}),
      ...(evidence.outcomeReason !== undefined ? { outcomeReason: boundedEvidenceValue(evidence.outcomeReason) } : {}),
      ...(identity ? { identity } : {}),
      ...(evidenceReuse ? { evidenceReuse } : {}),
      ...(adapter ? { adapter } : {}),
      ...(contractEvidence ? { contractEvidence } : {}),
      ...(nativeProof ? { nativeProof } : {}),
      ...(evidence.evidenceKind === 'native' && evidence.status === 'PASS' && nativeProof
        ? { runtimeVerified: true }
        : {}),
    };
  }
  return result;
}

function evidenceIdentityMismatchFields(expectedIdentity, candidateIdentity) {
  let normalizedCandidate = null;
  try {
    normalizedCandidate = normalizeConsumerCheckIdentity(candidateIdentity);
  } catch (_) {
    // Missing or malformed historical identity remains ineligible. Return
    // each absent/different component so callers can explain the rejection.
  }
  const mismatches = CONSUMER_CHECK_IDENTITY_FIELDS.filter((field) => (
    !normalizedCandidate || normalizedCandidate[field] !== expectedIdentity[field]
  ));
  if (!normalizedCandidate && mismatches.length === 0) mismatches.push('contractVersion');
  return mismatches;
}

function consumerEvidenceCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (candidate.evidence && typeof candidate.evidence === 'object' && !Array.isArray(candidate.evidence)) {
    return candidate.evidence;
  }
  return candidate;
}

function consumerEvidenceCandidateOrigin(candidate, evidence) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const envelopeIndex = candidate.envelopeIndex;
  const surface = candidate.surface;
  const slot = candidate.slot;
  if (!Number.isInteger(envelopeIndex) || envelopeIndex < 0 || envelopeIndex > 15
    || typeof surface !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(surface)
    || typeof slot !== 'string' || !/^check[1-9][0-9]{0,2}$/.test(slot)
    || typeof evidence.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(evidence.id)) {
    return null;
  }
  return { envelopeIndex, surface, slot, checkId: evidence.id };
}

/**
 * Compare one current semantic check with already normalized historical
 * checks. Request IDs, reason/question text, producer and workflow are
 * attribution only; the canonical checkKey, kind, identity and typed proof
 * determine applicability.
 */
function matchConsumerCheckEvidence(expectedCheck, candidates) {
  if (!expectedCheck || typeof expectedCheck !== 'object' || Array.isArray(expectedCheck)
    || typeof expectedCheck.checkKey !== 'string' || expectedCheck.checkKey.length === 0
    || !['contract', 'native'].includes(expectedCheck.evidenceKind)) {
    throw new Error('consumer evidence: expected consumer check is malformed');
  }
  const expectedIdentity = normalizeConsumerCheckIdentity(expectedCheck.identity);
  const keyParts = expectedCheck.checkKey.split(':');
  if (keyParts.length !== 3 || keyParts[2] !== expectedCheck.evidenceKind) {
    return { decision: 'REJECTED', selected: null, origin: null, mismatchFields: ['checkKey'] };
  }
  if (!Array.isArray(candidates) || candidates.length > 100) {
    return { decision: 'REJECTED', selected: null, origin: null, mismatchFields: ['checkKey'] };
  }

  const keyedCandidates = candidates.flatMap((candidate) => {
    const evidence = consumerEvidenceCandidate(candidate);
    if (!evidence) return [];
    if (evidence.checkKey !== expectedCheck.checkKey) return [];
    if (evidence.evidenceKind !== expectedCheck.evidenceKind) return [];
    return [{ candidate, evidence }];
  });
  if (keyedCandidates.length === 0) {
    return { decision: 'REJECTED', selected: null, origin: null, mismatchFields: ['checkKey'] };
  }

  const exactCandidates = [];
  const mismatchFields = new Set();
  for (const entry of keyedCandidates) {
    const mismatches = evidenceIdentityMismatchFields(expectedIdentity, entry.evidence.identity);
    if (mismatches.length === 0) exactCandidates.push(entry);
    else mismatches.forEach((field) => mismatchFields.add(field));
  }

  const exactPasses = exactCandidates.filter(({ evidence }) => evidence.status === 'PASS');
  const exactFailures = exactCandidates.filter(({ evidence }) => evidence.status === 'FAIL');
  if (exactPasses.length > 0 && exactFailures.length > 0) {
    const conflictCandidates = exactCandidates
      .filter(({ evidence }) => ['PASS', 'FAIL'].includes(evidence.status))
      .map(({ candidate, evidence }) => {
        const origin = consumerEvidenceCandidateOrigin(candidate, evidence);
        return origin ? { ...origin, status: evidence.status } : null;
      })
      .filter(Boolean);
    if (conflictCandidates.some((entry) => entry.status === 'PASS')
      && conflictCandidates.some((entry) => entry.status === 'FAIL')) {
      return {
        decision: 'CONFLICT',
        selected: null,
        origin: null,
        mismatchFields: [],
        conflicts: conflictCandidates,
      };
    }
    return { decision: 'REJECTED', selected: null, origin: null, mismatchFields: ['status'] };
  }

  const [surface, capability] = keyParts;
  const reusablePasses = exactPasses.filter(({ evidence }) => {
    if (expectedCheck.evidenceKind !== 'native' || !evidence.nativeProof) return false;
    try {
      normalizeRequirementProof(evidence.nativeProof, surface, capability);
      return true;
    } catch (_) {
      return false;
    }
  });
  reusablePasses.sort((left, right) => {
    const leftIndex = Number.isInteger(left.candidate.envelopeIndex) ? left.candidate.envelopeIndex : Number.MAX_SAFE_INTEGER;
    const rightIndex = Number.isInteger(right.candidate.envelopeIndex) ? right.candidate.envelopeIndex : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex
      || String(left.candidate.surface || '').localeCompare(String(right.candidate.surface || ''))
      || String(left.candidate.slot || '').localeCompare(String(right.candidate.slot || ''));
  });
  if (reusablePasses.length > 0) {
    const selected = reusablePasses[0];
    return {
      decision: 'REUSED',
      selected: selected.evidence,
      origin: consumerEvidenceCandidateOrigin(selected.candidate, selected.evidence),
      mismatchFields: [],
    };
  }

  if (exactCandidates.length > 0) {
    const reasonField = exactPasses.length > 0 ? 'nativeProof' : 'status';
    mismatchFields.add(reasonField);
  }
  return {
    decision: 'REJECTED',
    selected: null,
    origin: keyedCandidates.length > 0
      ? consumerEvidenceCandidateOrigin(keyedCandidates[0].candidate, keyedCandidates[0].evidence)
      : null,
    mismatchFields: [...mismatchFields],
  };
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
  const {
    runtimeVerified: _runtimeVerified,
    runtimeStatus: _runtimeStatus,
    stage: _stage,
    requirementEvidence: _requirementEvidence,
    ...safeSurface
  } = safeRaw;
  const requirementEvidence = normalizeRequirementEvidence(raw.requirementEvidence, surface, raw);
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
    ...(requirementEvidence ? { requirementEvidence } : {}),
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

function validateAcceptanceEvidenceReference(check, listName, input, surfaceResults) {
  const surfacePath = `surfaceResults.${check.surface}`;
  const evidenceRef = check.evidenceRef;
  if (check.id === 'scope.configuration') {
    if (listName === 'requiredChecks'
      && check.surface === 'consumer-scope'
      && check.kind === 'contract'
      && check.status === 'BLOCKED'
      && evidenceRef === null
      && isBlockedConsumerScopeReceipt(input, [])) {
      return;
    }
    throw new Error('consumer evidence: scope.configuration requires the blocked empty-scope receipt');
  }
  if (check.id.startsWith('scope.')) {
    const expectedId = `scope.${check.surface}`;
    if (listName === 'excludedChecks'
      && check.id === expectedId
      && check.kind === 'installation'
      && ['NOT_RUN', 'NOT_CONFIGURED'].includes(check.status)
      && evidenceRef === null) {
      return;
    }
    throw new Error('consumer evidence: scope exclusion must remain an unreferenced non-pass check');
  }

  if (evidenceRef === null) {
    throw new Error('consumer evidence: acceptance evidenceRef is required for observed evidence');
  }
  if (check.id === `install.${check.surface}`) {
    const installationRef = `${surfacePath}.installationEvidence`;
    const nonPassSurfaceFallback = evidenceRef === surfacePath && check.status !== 'PASS';
    if (listName === 'requiredChecks'
      && check.kind === 'installation'
      && (evidenceRef === installationRef || nonPassSurfaceFallback)) {
      return;
    }
    throw new Error('consumer evidence: installation acceptance status must reference typed installationEvidence');
  }
  if (check.id === `runtime.${check.surface}`) {
    if (listName === 'excludedChecks'
      && check.kind === 'native'
      && evidenceRef === `${surfacePath}.runtimeEvidence`) {
      return;
    }
    throw new Error('consumer evidence: acceptance evidenceRef for runtime observations may only reference runtimeEvidence');
  }
  if (check.id.startsWith('requirement.')) {
    const requirementEvidenceRef = new RegExp(`^surfaceResults\\.${check.surface}\\.requirementEvidence\\.check[1-9][0-9]{0,2}$`);
    if (listName === 'requiredChecks'
      && ['contract', 'native'].includes(check.kind)
      && requirementEvidenceRef.test(evidenceRef)) {
      return;
    }
    throw new Error('consumer evidence: requirement acceptance must reference an exact requirement evidence slot');
  }
  throw new Error('consumer evidence: acceptance check surface/evidenceRef does not identify a supported typed evidence record');
}

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
    validateAcceptanceEvidenceReference(check, listName, input, surfaceResults);
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

function validateRequirementAcceptance(acceptance, surfaceResults) {
  const requirementRecords = surfaceResults.flatMap((surfaceResult) => (
    Object.entries(surfaceResult.requirementEvidence || {}).map(([slot, evidence]) => ({
      surface: surfaceResult.surface,
      slot,
      evidence,
    }))
  ));
  const requirementChecks = acceptance
    ? [...acceptance.requiredChecks, ...acceptance.excludedChecks]
      .filter((check) => check.id.startsWith('requirement.'))
    : [];
  if (requirementRecords.length === 0 && requirementChecks.length === 0) return;
  if (!acceptance) {
    throw new Error('consumer evidence: requirement evidence requires schema-v2 acceptance checks');
  }

  const required = acceptance.requiredChecks.filter((check) => check.id.startsWith('requirement.'));
  const excluded = acceptance.excludedChecks.filter((check) => check.id.startsWith('requirement.'));
  if (excluded.length > 0) {
    throw new Error('consumer evidence: requirement acceptance checks cannot be excluded');
  }
  if (required.length !== requirementRecords.length) {
    throw new Error('consumer evidence: requirement evidence and required acceptance checks are not one-to-one');
  }

  const matched = new Set();
  for (const { surface, slot, evidence } of requirementRecords) {
    const expectedId = `requirement.${evidence.id}`;
    const expectedEvidenceRef = `surfaceResults.${surface}.requirementEvidence.${slot}`;
    const matches = required.filter((check) => check.id === expectedId);
    if (matches.length !== 1) {
      throw new Error(`consumer evidence: requirement '${evidence.id}' must have exactly one required acceptance check`);
    }
    const [check] = matches;
    if (matched.has(check.id)
      || check.surface !== surface
      || check.kind !== evidence.evidenceKind
      || check.status !== evidence.status
      || check.evidenceRef !== expectedEvidenceRef) {
      throw new Error(`consumer evidence: requirement '${evidence.id}' does not match its exact acceptance evidenceRef, kind, surface, and status`);
    }
    matched.add(check.id);
  }
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
  validateRequirementAcceptance(acceptance, surfaceResults);
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
  normalizeConsumerCheckIdentity,
  matchConsumerCheckEvidence,
  validateConsumerEvidence,
  normalizeConsumerResult: normalizeConsumerEvidence,
  validateConsumerResult: validateConsumerEvidence,
};
