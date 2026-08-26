'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { redactSensitiveText } = require('./redaction');
const runtimePreflight = require('./consumer-runtime-preflight');

const RECEIPT_SCHEMA = 'dhpk.harness.receipt.v1';
const EVENT_SCHEMA = 'dhpk.harness.receipt-event.v1';
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const TREE = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FINGERPRINT = /^(?:sha256:)?[a-f0-9]{64}$/i;
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
const ROLLBACK_FIELDS = Object.freeze([
  'taskId',
  'attemptId',
  'scopeId',
  'diffId',
  'surface',
  'sourceCommit',
  'sourceTree',
  'planFingerprint',
  'artifactFingerprint',
  'owner',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function isFingerprint(value) {
  return typeof value === 'string' && FINGERPRINT.test(value);
}

function normalizeComparable(field, value) {
  if (typeof value === 'string' && (field === 'sourceCommit' || field === 'sourceTree'
    || field === 'generatedFromCommit' || field === 'generatedFromTree'
    || field === 'baseCommit' || field === 'targetCommit' || field === 'targetTree'
    || /Fingerprint$/.test(field))) {
    return value.toLowerCase();
  }
  return value;
}

function compareIdentity(expected, actual) {
  const errors = [];
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, errors: ['expected identity must be an object'] };
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return { ok: false, errors: ['actual identity must be an object'] };
  }
  Object.keys(expected).forEach((field) => {
    const expectedValue = expected[field];
    if (expectedValue === undefined || expectedValue === null) return;
    if (!Object.prototype.hasOwnProperty.call(actual, field)
      || actual[field] === undefined
      || actual[field] === null) {
      errors.push(`identity field '${field}' is missing`);
      return;
    }
    const left = normalizeComparable(field, expectedValue);
    const right = normalizeComparable(field, actual[field]);
    if (canonicalJson(left) !== canonicalJson(right)) errors.push(`identity field '${field}' does not match`);
  });
  return { ok: errors.length === 0, errors };
}

function validateIdentity(expected, actual) {
  return compareIdentity(expected, actual);
}

function fingerprintForBytes(file) {
  return `sha256:${sha256(fs.readFileSync(file))}`;
}

function fingerprintDirectory(directory) {
  const root = path.resolve(directory);
  const entries = [];
  const visit = (current, relative) => {
    const names = fs.readdirSync(current).sort();
    for (const name of names) {
      const absolute = path.join(current, name);
      const childRelative = relative ? path.join(relative, name) : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`cannot fingerprint symlink '${childRelative}'`);
      if (stat.isDirectory()) {
        entries.push({ path: childRelative.split(path.sep).join('/'), type: 'directory' });
        visit(absolute, childRelative);
      } else if (stat.isFile()) {
        entries.push({
          path: childRelative.split(path.sep).join('/'),
          type: 'file',
          fingerprint: fingerprintForBytes(absolute),
          mode: stat.mode & 0o777,
        });
      } else {
        throw new Error(`cannot fingerprint special entry '${childRelative}'`);
      }
    }
  };
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`fingerprint root '${directory}' is not a physical directory`);
  visit(root, '');
  return `sha256:${sha256(canonicalJson(entries))}`;
}

function revalidateBytes(reference, expectedFingerprint = null) {
  const descriptor = reference && typeof reference === 'object' && !Array.isArray(reference)
    ? reference
    : { path: reference, fingerprint: expectedFingerprint };
  const file = descriptor.path;
  const expected = descriptor.fingerprint || expectedFingerprint;
  const errors = [];
  if (typeof file !== 'string' || !file) errors.push('byte reference path is required');
  if (!isFingerprint(expected)) errors.push('byte reference fingerprint must be a SHA-256 digest');
  if (errors.length > 0) return { ok: false, errors, path: file || null, expectedFingerprint: expected || null };
  let actualFingerprint;
  try {
    actualFingerprint = descriptor.kind === 'directory'
      ? fingerprintDirectory(file)
      : fingerprintForBytes(file);
  } catch (error) {
    return {
      ok: false,
      errors: [`byte reference is unreadable: ${error.message}`],
      path: file,
      expectedFingerprint: expected,
    };
  }
  if (actualFingerprint.toLowerCase() !== expected.toLowerCase()) {
    errors.push('byte reference fingerprint does not match persisted digest');
  }
  return { ok: errors.length === 0, errors, path: file, expectedFingerprint: expected, actualFingerprint };
}

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

function redact(value, depth = 0, key = '') {
  if (depth > 5) return '<truncated>';
  if (/authorization|proxy.?authorization|token|password|secret|api.?key|credential/i.test(key)) return '<redacted>';
  if (typeof value === 'string') return redactSensitiveText(value, { maxLength: 4096 });
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redact(entry, depth + 1, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([entryKey, entry]) => [
    entryKey,
    redact(entry, depth + 1, entryKey),
  ]));
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

function writeImmutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    // Hard-link creation is an atomic exclusive claim on POSIX filesystems;
    // unlike existsSync()+renameSync(), it cannot replace a concurrent record.
    fs.linkSync(temporary, file);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(`harness receipt: refusing to overwrite '${path.basename(file)}'`);
    }
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (_) { /* already cleaned */ }
  }
  const directoryFd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
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
  for (let retry = 0; retry < 2; retry += 1) {
    try {
      const fd = fs.openSync(lock, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${process.pid}\n`); } finally { fs.closeSync(fd); }
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = Number.parseInt(fs.readFileSync(lock, 'utf8').trim(), 10); } catch (_) { /* retry below */ }
      if (!Number.isInteger(owner) || owner <= 0 || owner === process.pid) {
        throw new Error('harness receipt: concurrent append is already in progress');
      }
      try {
        process.kill(owner, 0);
        throw new Error('harness receipt: concurrent append is already in progress');
      } catch (probeError) {
        if (probeError && probeError.code !== 'ESRCH') throw probeError;
        try { fs.unlinkSync(lock); } catch (unlinkError) {
          if (!unlinkError || unlinkError.code !== 'ENOENT') throw unlinkError;
        }
      }
    }
  }
  throw new Error('harness receipt: append lock could not be acquired');
}

function releaseAppendLock(attempt) {
  try { fs.unlinkSync(appendLockPath(attempt)); } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function resolveGitTree(root, commit) {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  if (!COMMIT.test(commit)) throw new Error('harness receipt: source commit must be a 40-character SHA');
  try {
    const tree = execFileSync('git', ['rev-parse', '--verify', `${commit}^{tree}`], { cwd: root, encoding: 'utf8' }).trim();
    if (!TREE.test(tree)) throw new Error('resolved source tree is not a 40-character SHA');
    return tree.toLowerCase();
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve source tree: ${error.message}`);
  }
}

function resolveGitCommit(root, revision = 'HEAD') {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  if (typeof revision !== 'string' || !revision.trim()) throw new Error('harness receipt: git revision is required');
  try {
    const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    if (!COMMIT.test(commit)) throw new Error('resolved source commit is not a 40-character SHA');
    return commit.toLowerCase();
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve source commit: ${error.message}`);
  }
}

function resolveGitBinding(root, revision = 'HEAD') {
  const commit = resolveGitCommit(root, revision);
  return { sourceCommit: commit, sourceTree: resolveGitTree(root, commit) };
}

function resolveGitWorktree(root) {
  if (typeof root !== 'string' || !root) throw new Error('harness receipt: git root is required');
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
    });
    return status.trim().length === 0 ? 'CLEAN' : 'DIRTY';
  } catch (error) {
    throw new Error(`harness receipt: cannot resolve worktree status: ${error.message}`);
  }
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

function validateGitBinding(root, sourceCommit, sourceTree, {
  expectedSourceCommit = null,
  expectedSourceTree = null,
} = {}) {
  const errors = [];
  if (!COMMIT.test(sourceCommit)) errors.push('source commit is not a valid SHA');
  if (!TREE.test(sourceTree)) errors.push('source tree is not a valid SHA');
  if (expectedSourceCommit !== null && expectedSourceCommit !== undefined) {
    if (!COMMIT.test(expectedSourceCommit)) errors.push('expected source commit is not a valid SHA');
    else if (String(sourceCommit).toLowerCase() !== expectedSourceCommit.toLowerCase()) {
      errors.push('source commit does not match expected checkout');
    }
  }
  if (expectedSourceTree !== null && expectedSourceTree !== undefined) {
    if (!TREE.test(expectedSourceTree)) errors.push('expected source tree is not a valid SHA');
    else if (String(sourceTree).toLowerCase() !== expectedSourceTree.toLowerCase()) {
      errors.push('source tree does not match expected checkout');
    }
  }
  if (errors.length === 0 && root) {
    try {
      const current = resolveGitBinding(root);
      if (current.sourceCommit.toLowerCase() !== String(sourceCommit).toLowerCase()) errors.push('source commit does not match current checkout');
      if (current.sourceTree.toLowerCase() !== String(sourceTree).toLowerCase()) errors.push('source tree does not match current checkout');
      const resolved = resolveGitTree(root, sourceCommit);
      if (resolved.toLowerCase() !== sourceTree.toLowerCase()) errors.push('source tree does not match source commit');
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { ok: errors.length === 0, errors };
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

  const files = eventFiles(path.join(attemptPath, 'events'));
  let previousChain = '';
  let previousLifecycle = null;
  let lastEvent = null;
  files.forEach((file, index) => {
    let event;
    try { event = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
      errors.push(`event ${index + 1} is unreadable: ${error.message}`);
      return;
    }
    const expectedSequence = index + 1;
    if (event.schema !== EVENT_SCHEMA) errors.push(`event ${expectedSequence} has invalid schema`);
    if (!Array.isArray(event.diagnostics)) errors.push(`event ${expectedSequence} diagnostics must be an array`);
    if (!Array.isArray(event.artifacts)) errors.push(`event ${expectedSequence} artifacts must be an array`);
    if (event.resumeCommand !== null && typeof event.resumeCommand !== 'string') errors.push(`event ${expectedSequence} resumeCommand must be a string or null`);
    if (!Array.isArray(event.byteReferences)) errors.push(`event ${expectedSequence} byteReferences must be an array`);
    if (event.sequence !== expectedSequence) errors.push(`event ${expectedSequence} sequence is not monotonic`);
    if (event.attemptId !== envelope.attemptId) errors.push(`event ${expectedSequence} has foreign attempt identity`);
    if (event.taskId !== envelope.taskId) errors.push(`event ${expectedSequence} has foreign task identity`);
    if (event.command !== envelope.command) errors.push(`event ${expectedSequence} command identity mismatch`);
    if (canonicalJson(event.sessionId || null) !== canonicalJson(envelope.sessionId || null)) errors.push(`event ${expectedSequence} session identity mismatch`);
    if (canonicalJson(event.dispatch || null) !== canonicalJson(envelope.dispatch || null)) errors.push(`event ${expectedSequence} dispatch identity mismatch`);
    if (event.sourceCommit !== envelope.sourceCommit) errors.push(`event ${expectedSequence} source commit identity mismatch`);
    if (event.sourceTree !== envelope.sourceTree) errors.push(`event ${expectedSequence} source tree identity mismatch`);
    if (envelope.preflight !== undefined && canonicalJson(event.preflight || null) !== canonicalJson(envelope.preflight)) {
      errors.push(`event ${expectedSequence} preflight identity mismatch`);
    }
    const transition = lifecycleTransition(previousLifecycle, event.lifecyclePhase);
    errors.push(...transition.errors.map((error) => `event ${expectedSequence} ${error}`));
    if (!OUTCOMES.includes(event.outcome)) errors.push(`event ${expectedSequence} has invalid outcome`);
    const eventSha = sha256(canonicalJson(eventPayload(event)));
    if (event.event_sha256 !== eventSha) errors.push(`event ${expectedSequence} digest mismatch`);
    const chainSha = sha256(`${previousChain}${eventSha}`);
    if (event.chain_sha256 !== chainSha) errors.push(`event ${expectedSequence} chain mismatch`);
    previousChain = event.chain_sha256;
    previousLifecycle = event.lifecyclePhase;
    lastEvent = event;
  });
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
    eventCount: files.length,
    lastEvent,
    chainSha256: previousChain || null,
  };
}

function validateRollbackOwnership(target, candidate) {
  const errors = [];
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return { ok: false, errors: ['rollback target identity is required'] };
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, errors: ['rollback candidate identity is required'] };
  }
  for (const field of ['surface', 'sourceCommit', 'sourceTree', 'planFingerprint', 'artifactFingerprint']) {
    if (target[field] === undefined || target[field] === null || target[field] === '') {
      errors.push(`rollback target is missing ${field}`);
    }
  }
  if (target.sourceCommit !== undefined && !COMMIT.test(target.sourceCommit)) errors.push('rollback target source commit is invalid');
  if (target.sourceTree !== undefined && !TREE.test(target.sourceTree)) errors.push('rollback target source tree is invalid');
  for (const field of ['planFingerprint', 'artifactFingerprint']) {
    if (target[field] !== undefined && !isFingerprint(target[field])) errors.push(`rollback target ${field} is invalid`);
  }
  const identity = ROLLBACK_FIELDS.reduce((result, field) => {
    if (target[field] !== undefined && target[field] !== null) result[field] = target[field];
    return result;
  }, {});
  errors.push(...compareIdentity(identity, candidate).errors.map((error) => `rollback ownership: ${error}`));
  return { ok: errors.length === 0, errors };
}

function assertRollbackOwnership(target, candidate) {
  const checked = validateRollbackOwnership(target, candidate);
  if (!checked.ok) throw new Error(`rollback ownership check failed: ${checked.errors.join('; ')}`);
  return true;
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
