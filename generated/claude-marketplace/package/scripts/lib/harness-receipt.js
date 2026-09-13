'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const runtimePreflight = require('./consumer-runtime-preflight');
const {
  COMMIT,
  TREE,
  SAFE_ID,
  FINGERPRINT,
  ROLLBACK_FIELDS,
  sha256,
  canonicalJson,
  isFingerprint,
  compareIdentity,
  validateIdentity,
  fingerprintForBytes,
  fingerprintDirectory,
  revalidateBytes,
  redact,
  writeImmutable,
  replayJsonSequence,
  acquireProcessLock,
  releaseProcessLock,
  resolveGitTree,
  resolveGitCommit,
  resolveGitBinding,
  resolveGitWorktree,
  validateGitBinding,
  validateRollbackOwnership,
  assertRollbackOwnership,
} = require('./receipt-primitives');

const RECEIPT_SCHEMA = 'dhpk.harness.receipt.v1';
const EVENT_SCHEMA = 'dhpk.harness.receipt-event.v1';
const LIFECYCLE_PHASES = Object.freeze(['PLANNED', 'RED', 'GREEN', 'REFACTOR', 'VERIFIED', 'COMPLETE']);
const OUTCOMES = Object.freeze([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'UNAVAILABLE',
  'NO_SHIP',
  'PARTIAL',
  'PUBLISHED_PENDING',
  'PUBLISHED_UNHEALTHY',
  'OVERRIDDEN',
  'COMPLETE',
]);
const IDENTITY_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'scopeId',
  'diffId',
  'sessionId',
  'dispatch',
  'dispatchId',
  'sourceCommit',
  'sourceTree',
  'generatedFromCommit',
  'generatedFromTree',
  'baseCommit',
  'targetCommit',
  'targetTree',
  'worktree',
  'planFingerprint',
  'artifactFingerprint',
  'surface',
  'adapter',
  'stage',
  'producer',
  'preflight',
  'runnerCapabilities',
  'previousReceipt',
  'operationIntent',
]);
function lifecycleTransition(previous, next) {
  const errors = [];
  if (!LIFECYCLE_PHASES.includes(next)) errors.push(`invalid lifecycle phase '${next}'`);
  if (previous !== null && previous !== undefined && !LIFECYCLE_PHASES.includes(previous)) {
    errors.push(`invalid previous lifecycle phase '${previous}'`);
  }
  if (errors.length === 0 && previous !== null && previous !== undefined) {
    const previousIndex = LIFECYCLE_PHASES.indexOf(previous);
    const nextIndex = LIFECYCLE_PHASES.indexOf(next);
    if (nextIndex < previousIndex) errors.push(`lifecycle transition '${previous}' -> '${next}' is backward`);
    if (previous === 'COMPLETE') errors.push('COMPLETE is terminal and cannot transition');
  }
  return { ok: errors.length === 0, errors };
}

function ensureId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`harness receipt: invalid ${name}`);
  return value;
}

function findAttemptByOperationKey(root, operationKey) {
  if (typeof root !== 'string' || !root || !operationKey) return null;
  if (!fs.existsSync(root)) return null;
  const taskEntries = fs.readdirSync(root, { withFileTypes: true });
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory()) continue;
    const taskPath = path.join(root, taskEntry.name);
    const attemptEntries = fs.readdirSync(taskPath, { withFileTypes: true });
    for (const attemptEntry of attemptEntries) {
      if (!attemptEntry.isDirectory()) continue;
      const attemptPath = path.join(taskPath, attemptEntry.name);
      const envelopePath = path.join(attemptPath, 'attempt.json');
      try {
        const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
        if (envelope.operationKey === operationKey || envelope.idempotencyKey === operationKey) {
          return { path: attemptPath, envelopePath, attemptId: envelope.attemptId, taskId: envelope.taskId, envelope };
        }
      } catch (error) {
        // Ignore unrelated or incomplete attempt directories. Validation of a
        // selected receipt remains responsible for reporting malformed bytes.
      }
    }
  }
  return null;
}

function operationClaimPath(root, operationKey) {
  return path.join(root, '.operations', `${sha256(operationKey)}.json`);
}

function claimOperationKey(root, operationKey, identity) {
  if (!operationKey) return;
  const claimPath = operationClaimPath(root, operationKey);
  fs.mkdirSync(path.dirname(claimPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(claimPath)) {
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(claimPath, 'utf8')); } catch (_) { /* fail closed below */ }
    throw new Error(`harness receipt: operation key is already reserved by '${existing && existing.taskId}/${existing && existing.attemptId}'`);
  }
  writeImmutable(claimPath, `${JSON.stringify({ operationKey, ...identity }, null, 2)}\n`);
}

function verifyOperationReservation(reservation, root, operationKey, identity) {
  if (typeof reservation !== 'string' || !reservation) {
    throw new Error('harness receipt: operation reservation handle is required');
  }
  const expectedPath = operationClaimPath(root, operationKey);
  if (path.resolve(reservation) !== path.resolve(expectedPath)) {
    throw new Error('harness receipt: operation reservation path does not match the operation key');
  }
  let existing;
  try { existing = JSON.parse(fs.readFileSync(expectedPath, 'utf8')); } catch (error) {
    throw new Error(`harness receipt: operation reservation is unreadable: ${error.message}`);
  }
  if (!existing || existing.operationKey !== operationKey
    || existing.taskId !== identity.taskId || existing.attemptId !== identity.attemptId) {
    throw new Error('harness receipt: operation reservation identity does not match the attempt');
  }
}

function reserveOperationKey(root, operationKey, identity = {}) {
  ensureId(operationKey, 'operation key');
  ensureId(identity.taskId, 'operation task id');
  ensureId(identity.attemptId, 'operation attempt id');
  try {
    claimOperationKey(root, operationKey, identity);
  } catch (error) {
    error.code = 'HARNESS_BLOCKED';
    throw error;
  }
  return operationClaimPath(root, operationKey);
}

function appendLockPath(attempt) {
  return path.join(attempt.path, '.append.lock');
}

function acquireAppendLock(attempt) {
  const lock = appendLockPath(attempt);
  const conflictError = () => new Error('harness receipt: concurrent append is already in progress');
  acquireProcessLock({
    file: lock,
    pid: process.pid,
    attempts: 2,
    conflictError,
    unavailableError: () => new Error('harness receipt: append lock could not be acquired'),
  });
  return true;
}

function releaseAppendLock(attempt) {
  releaseProcessLock({
    file: appendLockPath(attempt),
    pid: process.pid,
    missingIsSuccess: true,
  });
}

function createAttempt({
  root,
  command,
  phase = null,
  taskId,
  attemptId,
  sourceCommit,
  sourceTree,
  sessionId = null,
  dispatch = null,
  identity = {},
  operationKey = null,
  idempotencyKey = null,
  operationReservation = null,
  retryOf = null,
  previousAttempt = null,
  previousReceipt = null,
  backupReference = null,
  diagnostics = [],
  artifacts = [],
  requiredSurfaces = null,
  requiredRuntimeSurfaces = null,
  surfaceResults = null,
  resumeCommand = null,
  byteReferences = [],
  lifecyclePhase = 'PLANNED',
  outcome = 'NOT_RUN',
  ...fields
} = {}) {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: receipt root is required');
  ensureId(taskId, 'task id');
  ensureId(attemptId, 'attempt id');
  if (typeof command !== 'string' || !command.trim()) throw new Error('harness receipt: command is required');
  if (phase !== null && phase !== undefined && (typeof phase !== 'string' || !phase.trim())) {
    throw new Error('harness receipt: phase must be a non-empty string');
  }
  if (!COMMIT.test(sourceCommit)) throw new Error('harness receipt: source commit must be a 40-character SHA');
  if (!TREE.test(sourceTree)) throw new Error('harness receipt: source tree must be a 40-character SHA');
  if (!LIFECYCLE_PHASES.includes(lifecyclePhase)) throw new Error(`harness receipt: invalid lifecycle phase '${lifecyclePhase}'`);
  if (!OUTCOMES.includes(outcome)) throw new Error(`harness receipt: invalid outcome '${outcome}'`);
  if (operationKey !== null && operationKey !== undefined) ensureId(operationKey, 'operation key');
  if (idempotencyKey !== null && idempotencyKey !== undefined) ensureId(idempotencyKey, 'idempotency key');
  if (operationKey && idempotencyKey && operationKey !== idempotencyKey) {
    throw new Error('harness receipt: operation and idempotency keys must match');
  }
  const resolvedOperationKey = operationKey || idempotencyKey;
  if (resolvedOperationKey) {
    if (operationReservation) verifyOperationReservation(operationReservation, root, resolvedOperationKey, { taskId, attemptId });
    else claimOperationKey(root, resolvedOperationKey, { taskId, attemptId });
  }
  const retryReference = retryOf || previousAttempt;
  const suppliedIdentity = {
    ...(identity && typeof identity === 'object' && !Array.isArray(identity) ? identity : {}),
    ...fields,
    ...(sessionId !== null && sessionId !== undefined ? { sessionId } : {}),
    ...(dispatch !== null && dispatch !== undefined ? { dispatch } : {}),
    ...(resolvedOperationKey ? { operationKey: resolvedOperationKey, idempotencyKey: resolvedOperationKey } : {}),
    ...(retryReference ? { retryOf: retryReference } : {}),
    ...(previousReceipt ? { previousReceipt } : {}),
    ...(backupReference ? { backupReference } : {}),
  };
  for (const fingerprintField of ['planFingerprint', 'artifactFingerprint']) {
    if (suppliedIdentity[fingerprintField] !== undefined && !isFingerprint(suppliedIdentity[fingerprintField])) {
      throw new Error(`harness receipt: ${fingerprintField} must be a SHA-256 digest`);
    }
  }

  const attemptPath = path.join(root, taskId, attemptId);
  const eventsPath = path.join(attemptPath, 'events');
  fs.mkdirSync(eventsPath, { recursive: true, mode: 0o700 });
  const envelopeSessionId = sessionId !== null && sessionId !== undefined
    ? sessionId
    : suppliedIdentity.sessionId;
  const envelopeDispatch = dispatch !== null && dispatch !== undefined
    ? dispatch
    : suppliedIdentity.dispatch;
  const envelope = {
    schema: RECEIPT_SCHEMA,
    taskId,
    attemptId,
    command: redact(command),
    sourceCommit: sourceCommit.toLowerCase(),
    sourceTree: sourceTree.toLowerCase(),
    sessionId: envelopeSessionId ? redact(envelopeSessionId) : null,
    dispatch: envelopeDispatch ? redact(envelopeDispatch) : null,
    lifecyclePhase,
    outcome,
    phase: phase || null,
    diagnostics: redact(Array.isArray(diagnostics) ? diagnostics : [diagnostics]),
    artifacts: redact(Array.isArray(artifacts) ? artifacts : [artifacts]),
    ...(Array.isArray(requiredSurfaces) ? { requiredSurfaces: redact(requiredSurfaces) } : {}),
    ...(Array.isArray(requiredRuntimeSurfaces) ? { requiredRuntimeSurfaces: redact(requiredRuntimeSurfaces) } : {}),
    ...(Array.isArray(surfaceResults) ? { surfaceResults: redact(surfaceResults) } : {}),
    resumeCommand: resumeCommand === null || resumeCommand === undefined ? null : redact(resumeCommand),
    byteReferences: redact(Array.isArray(byteReferences) ? byteReferences : [byteReferences]),
    createdAt: new Date().toISOString(),
  };
  for (const field of IDENTITY_FIELDS) {
    if (field === 'taskId' || field === 'attemptId' || field === 'sourceCommit' || field === 'sourceTree') continue;
    if (suppliedIdentity[field] !== undefined && suppliedIdentity[field] !== null) {
      envelope[field] = redact(suppliedIdentity[field], 0, field);
    }
  }
  if (resolvedOperationKey) {
    envelope.operationKey = resolvedOperationKey;
    envelope.idempotencyKey = resolvedOperationKey;
  }
  if (retryReference) envelope.retryOf = redact(retryReference);
  if (backupReference) envelope.backupReference = redact(backupReference);
  const envelopePath = path.join(attemptPath, 'attempt.json');
  writeImmutable(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return { path: attemptPath, envelopePath, eventsPath, envelope };
}

function eventFiles(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  return fs.readdirSync(eventsPath)
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort()
    .map((name) => path.join(eventsPath, name));
}

function eventPayload(event) {
  const copy = { ...event };
  delete copy.event_sha256;
  delete copy.chain_sha256;
  return copy;
}

function appendEvent(attempt, event = {}) {
  acquireAppendLock(attempt);
  try {
    const envelope = JSON.parse(fs.readFileSync(attempt.envelopePath, 'utf8'));
    const files = eventFiles(attempt.eventsPath);
    const sequence = files.length + 1;
    const previous = files.length > 0 ? JSON.parse(fs.readFileSync(files[files.length - 1], 'utf8')) : null;
    const lifecyclePhase = event.lifecyclePhase || (previous && previous.lifecyclePhase) || 'PLANNED';
    const transition = lifecycleTransition(previous && previous.lifecyclePhase, lifecyclePhase);
    if (!transition.ok) throw new Error(`harness receipt: ${transition.errors.join('; ')}`);
    const outcome = event.outcome || (previous && previous.outcome) || 'NOT_RUN';
    if (!OUTCOMES.includes(outcome)) throw new Error(`harness receipt: invalid outcome '${outcome}'`);
    const record = redact({
      ...event,
      schema: EVENT_SCHEMA,
      attemptId: envelope.attemptId,
      taskId: envelope.taskId,
      command: envelope.command,
      sessionId: event.sessionId === undefined ? (envelope.sessionId || null) : event.sessionId,
      dispatch: event.dispatch === undefined ? (envelope.dispatch || null) : event.dispatch,
      sourceCommit: envelope.sourceCommit,
      sourceTree: envelope.sourceTree,
      sequence,
      lifecyclePhase,
      outcome,
      diagnostics: Array.isArray(event.diagnostics) ? event.diagnostics : [],
      artifacts: Array.isArray(event.artifacts) ? event.artifacts : [],
      resumeCommand: event.resumeCommand === undefined
        ? (envelope.resumeCommand || null)
        : event.resumeCommand,
      byteReferences: Array.isArray(event.byteReferences) ? event.byteReferences : [],
      recordedAt: new Date().toISOString(),
    });
    const eventSha = sha256(canonicalJson(eventPayload(record)));
    const previousChain = previous ? previous.chain_sha256 : '';
    const chainSha = sha256(`${previousChain}${eventSha}`);
    const persisted = { ...record, event_sha256: eventSha, chain_sha256: chainSha };
    const file = path.join(attempt.eventsPath, `${String(sequence).padStart(4, '0')}.json`);
    writeImmutable(file, `${JSON.stringify(persisted, null, 2)}\n`);
    return {
      ...persisted,
      eventSha256: eventSha,
      chainSha256: chainSha,
      path: file,
    };
  } finally {
    releaseAppendLock(attempt);
  }
}

function validateReceipt(attemptPath, {
  root = null,
  expected = null,
  expectedIdentity = null,
  expectedSourceCommit = null,
  expectedSourceTree = null,
  planFingerprint = null,
  artifactFingerprint = null,
  expectedPlanFingerprint = null,
  expectedArtifactFingerprint = null,
  byteReferences = [],
} = {}) {
  const errors = [];
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(path.join(attemptPath, 'attempt.json'), 'utf8'));
  } catch (error) {
    return { ok: false, errors: [`receipt envelope is unreadable: ${error.message}`] };
  }
  if (envelope.schema !== RECEIPT_SCHEMA) errors.push(`invalid receipt schema '${envelope.schema}'`);
  if (!SAFE_ID.test(envelope.taskId || '')) errors.push('invalid receipt taskId');
  if (!SAFE_ID.test(envelope.attemptId || '')) errors.push('invalid receipt attemptId');
  if (!Array.isArray(envelope.diagnostics)) errors.push('receipt diagnostics must be an array');
  if (!Array.isArray(envelope.artifacts)) errors.push('receipt artifacts must be an array');
  if (envelope.resumeCommand !== null && typeof envelope.resumeCommand !== 'string') errors.push('receipt resumeCommand must be a string or null');
  if (!Array.isArray(envelope.byteReferences)) errors.push('receipt byteReferences must be an array');
  for (const field of ['targetCommit', 'generatedFromCommit']) {
    if (envelope[field] !== undefined && !COMMIT.test(envelope[field])) errors.push(`receipt ${field} is not a valid commit SHA`);
  }
  for (const field of ['targetTree', 'generatedFromTree']) {
    if (envelope[field] !== undefined && !TREE.test(envelope[field])) errors.push(`receipt ${field} is not a valid tree SHA`);
  }
  const targetCommitPresent = envelope.targetCommit !== undefined;
  const targetTreePresent = envelope.targetTree !== undefined;
  if (targetCommitPresent !== targetTreePresent) {
    errors.push('receipt target commit/tree pair is incomplete');
  }
  if (envelope.worktree !== undefined && !['CLEAN', 'DIRTY'].includes(envelope.worktree)) {
    errors.push('receipt worktree must be CLEAN or DIRTY');
  }
  if (envelope.preflight !== undefined) {
    if (!envelope.preflight || typeof envelope.preflight !== 'object' || Array.isArray(envelope.preflight)) {
      errors.push('receipt preflight must be an object');
    } else {
      if (envelope.preflight.schema !== 'dhpk.consumer-runtime-preflight.v1') errors.push('receipt preflight schema is invalid');
      if (envelope.preflight.stage !== 'PREFLIGHT') errors.push('receipt preflight stage is invalid');
      if (!runtimePreflight.PREFLIGHT_STATUSES.includes(envelope.preflight.status)) errors.push('receipt preflight status is invalid');
      const preflightIdentity = envelope.preflight.identity;
      if (!preflightIdentity || typeof preflightIdentity !== 'object' || Array.isArray(preflightIdentity)) {
        errors.push('receipt preflight identity is missing');
      } else {
        const identityFields = {
          taskId: envelope.taskId,
          attemptId: envelope.attemptId,
          sourceCommit: envelope.sourceCommit,
          sourceTree: envelope.sourceTree,
          ...(envelope.targetCommit ? { targetCommit: envelope.targetCommit } : {}),
          ...(envelope.targetTree ? { targetTree: envelope.targetTree } : {}),
          ...(envelope.worktree ? { worktree: envelope.worktree } : {}),
        };
        const bound = runtimePreflight.normalizePreflightIdentity(preflightIdentity);
        if (!bound.ok) {
          errors.push(...bound.errors.map((error) => `receipt preflight identity: ${error}`));
        } else {
          // Validate the preflight as supplied before comparing the envelope
          // anchors.  Spreading envelope fields over the preflight would turn
          // a foreign task/attempt/tree into apparently matching evidence.
          const expectedPreflightIdentity = { ...bound.identity, ...identityFields };
          const compared = runtimePreflight.comparePreflightIdentity(
            expectedPreflightIdentity,
            preflightIdentity,
          );
          if (!compared.ok) {
            errors.push(...compared.errors.map((error) => `receipt preflight identity: ${error}`));
          }
        }
        const redacted = redact(envelope.preflight);
        if (canonicalJson(redacted) !== canonicalJson(envelope.preflight)) errors.push('receipt preflight contains unredacted sensitive data');
      }
    }
  }
  const generatedCommitPresent = envelope.generatedFromCommit !== undefined;
  const generatedTreePresent = envelope.generatedFromTree !== undefined;
  if (generatedCommitPresent !== generatedTreePresent) {
    errors.push('receipt generated-input commit/tree pair is incomplete');
  }
  const expectedContext = expected && typeof expected === 'object' ? expected : {};
  const expectedCommit = expectedSourceCommit || expectedContext.sourceCommit || null;
  const expectedTree = expectedSourceTree || expectedContext.sourceTree || null;
  errors.push(...validateGitBinding(root, envelope.sourceCommit, envelope.sourceTree, {
    expectedSourceCommit: expectedCommit,
    expectedSourceTree: expectedTree,
  }).errors);
  if (root && (!targetCommitPresent || !targetTreePresent)) {
    errors.push('receipt target commit/tree pair is required when validating against a checkout');
  }
  if (root && envelope.worktree === undefined) {
    errors.push('receipt worktree is required when validating against a checkout');
  }
  if (root) {
    try {
      const current = resolveGitBinding(root);
      if (targetCommitPresent && COMMIT.test(envelope.targetCommit)
        && current.sourceCommit.toLowerCase() !== envelope.targetCommit.toLowerCase()) {
        errors.push('target commit does not match current checkout');
      }
      if (targetTreePresent && TREE.test(envelope.targetTree)
        && current.sourceTree.toLowerCase() !== envelope.targetTree.toLowerCase()) {
        errors.push('target tree does not match current checkout');
      }
      if (envelope.worktree !== undefined) {
        const actualWorktree = resolveGitWorktree(root);
        if (actualWorktree !== envelope.worktree) {
          errors.push(`receipt worktree '${envelope.worktree}' does not match current checkout '${actualWorktree}'`);
        }
      }
    } catch (error) {
      errors.push(`target checkout cannot be resolved: ${error.message}`);
    }
  }
  if (envelope.outcome === 'COMPLETE' && envelope.worktree !== 'CLEAN') {
    errors.push('COMPLETE receipt requires a clean worktree');
  }
  if (root && generatedCommitPresent && generatedTreePresent && COMMIT.test(envelope.generatedFromCommit) && TREE.test(envelope.generatedFromTree)) {
    try {
      const generatedTree = resolveGitTree(root, envelope.generatedFromCommit);
      if (generatedTree.toLowerCase() !== envelope.generatedFromTree.toLowerCase()) {
        errors.push('generated-input tree does not match generated-input commit');
      }
      if (envelope.targetCommit && COMMIT.test(envelope.targetCommit)) {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', envelope.generatedFromCommit, envelope.targetCommit], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'ignore', 'ignore'],
          });
        } catch (error) {
          if (error && error.status === 1) errors.push('generated-input commit is not an ancestor of target commit');
          else throw error;
        }
      }
    } catch (error) {
      errors.push(`generated-input identity cannot be resolved: ${error.message}`);
    }
  }
  for (const fingerprintField of ['planFingerprint', 'artifactFingerprint']) {
    if (envelope[fingerprintField] !== undefined && !isFingerprint(envelope[fingerprintField])) {
      errors.push(`receipt ${fingerprintField} is not a SHA-256 digest`);
    }
  }
  const expectedFingerprintBindings = {
    ...(expectedContext.planFingerprint !== undefined ? { planFingerprint: expectedContext.planFingerprint } : {}),
    ...(expectedContext.artifactFingerprint !== undefined ? { artifactFingerprint: expectedContext.artifactFingerprint } : {}),
    ...(planFingerprint !== null && planFingerprint !== undefined ? { planFingerprint } : {}),
    ...(artifactFingerprint !== null && artifactFingerprint !== undefined ? { artifactFingerprint } : {}),
    ...(expectedPlanFingerprint !== null && expectedPlanFingerprint !== undefined ? { planFingerprint: expectedPlanFingerprint } : {}),
    ...(expectedArtifactFingerprint !== null && expectedArtifactFingerprint !== undefined ? { artifactFingerprint: expectedArtifactFingerprint } : {}),
  };
  for (const [field, value] of Object.entries(expectedFingerprintBindings)) {
    if (!isFingerprint(value)) errors.push(`expected ${field} is not a SHA-256 digest`);
    else if (!isFingerprint(envelope[field]) || envelope[field].toLowerCase() !== value.toLowerCase()) {
      errors.push(`receipt ${field} does not match expected identity`);
    }
  }
  const identity = expectedIdentity || expectedContext.identity || null;
  if (identity) errors.push(...compareIdentity(identity, envelope).errors);

  let previousChain = '';
  let previousLifecycle = null;
  let lastEvent = null;
  const replayed = replayJsonSequence({
    directory: path.join(attemptPath, 'events'),
    includeName: (name) => /^\d{4}\.json$/.test(name),
    initialChain: '',
    validateRecord: (event, { sequence, report }) => {
      if (event.schema !== EVENT_SCHEMA) report({ message: `event ${sequence} has invalid schema` });
      if (!Array.isArray(event.diagnostics)) report({ message: `event ${sequence} diagnostics must be an array` });
      if (!Array.isArray(event.artifacts)) report({ message: `event ${sequence} artifacts must be an array` });
      if (event.resumeCommand !== null && typeof event.resumeCommand !== 'string') report({ message: `event ${sequence} resumeCommand must be a string or null` });
      if (!Array.isArray(event.byteReferences)) report({ message: `event ${sequence} byteReferences must be an array` });
      if (event.sequence !== sequence) report({ message: `event ${sequence} sequence is not monotonic` });
      if (event.attemptId !== envelope.attemptId) report({ message: `event ${sequence} has foreign attempt identity` });
      if (event.taskId !== envelope.taskId) report({ message: `event ${sequence} has foreign task identity` });
      if (event.command !== envelope.command) report({ message: `event ${sequence} command identity mismatch` });
      if (canonicalJson(event.sessionId || null) !== canonicalJson(envelope.sessionId || null)) report({ message: `event ${sequence} session identity mismatch` });
      if (canonicalJson(event.dispatch || null) !== canonicalJson(envelope.dispatch || null)) report({ message: `event ${sequence} dispatch identity mismatch` });
      if (event.sourceCommit !== envelope.sourceCommit) report({ message: `event ${sequence} source commit identity mismatch` });
      if (event.sourceTree !== envelope.sourceTree) report({ message: `event ${sequence} source tree identity mismatch` });
      if (envelope.preflight !== undefined && canonicalJson(event.preflight || null) !== canonicalJson(envelope.preflight)) {
        report({ message: `event ${sequence} preflight identity mismatch` });
      }
      const transition = lifecycleTransition(previousLifecycle, event.lifecyclePhase);
      transition.errors.forEach((error) => report({ message: `event ${sequence} ${error}` }));
      if (!OUTCOMES.includes(event.outcome)) report({ message: `event ${sequence} has invalid outcome` });
    },
    payloadForDigest: eventPayload,
    digestForPayload: (payload) => sha256(canonicalJson(payload)),
    storedDigest: (event) => event.event_sha256,
    chainFor: (chain, digest) => sha256(`${chain}${digest}`),
    storedChain: (event) => event.chain_sha256,
    onIssue: ({ type, sequence, error, message }) => {
      if (type === 'UNREADABLE') errors.push(`event ${sequence} is unreadable: ${error.message}`);
      else if (type === 'DIGEST') errors.push(`event ${sequence} digest mismatch`);
      else if (type === 'CHAIN') errors.push(`event ${sequence} chain mismatch`);
      else errors.push(message);
    },
    onRecord: (event) => {
      previousLifecycle = event.lifecyclePhase;
      lastEvent = event;
    },
  });
  previousChain = replayed.chainDigest;
  const references = Array.isArray(byteReferences)
    ? byteReferences
    : (byteReferences ? [byteReferences] : []);
  const persistedReferences = Array.isArray(envelope.byteReferences) ? envelope.byteReferences : [];
  [...persistedReferences, ...references].forEach((reference, index) => {
    const checked = revalidateBytes(reference);
    if (!checked.ok) errors.push(...checked.errors.map((error) => `byte reference ${index + 1}: ${error}`));
  });
  return {
    ok: errors.length === 0,
    errors,
    envelope,
    eventCount: replayed.recordCount,
    lastEvent,
    chainSha256: previousChain || null,
  };
}

module.exports = {
  RECEIPT_SCHEMA,
  EVENT_SCHEMA,
  FINGERPRINT,
  LIFECYCLE_PHASES,
  OUTCOMES,
  IDENTITY_FIELDS,
  ROLLBACK_FIELDS,
  sha256,
  canonicalJson,
  redact,
  replayJsonSequence,
  acquireProcessLock,
  releaseProcessLock,
  compareIdentity,
  validateIdentity,
  fingerprintForBytes,
  fingerprintDirectory,
  revalidateBytes,
  lifecycleTransition,
  resolveGitTree,
  resolveGitCommit,
  resolveGitBinding,
  resolveGitWorktree,
  createAttempt,
  reserveOperationKey,
  findAttemptByOperationKey,
  appendEvent,
  validateGitBinding,
  validateReceipt,
  validateRollbackOwnership,
  assertRollbackOwnership,
};
