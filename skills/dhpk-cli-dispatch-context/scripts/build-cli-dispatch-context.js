'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { resolveConfig, resolveRole } = require('./cli-role-resolver');

const TRANSPORTS = Object.freeze({
  codex: Object.freeze({ transport: 'codex-exec', stdin_mode: 'prompt' }),
  agy: Object.freeze({ transport: 'agy-print', stdin_mode: 'agy-confirmation' }),
});

const SCOPE_PATHS = Object.freeze(['workdir', 'prompt_file', 'artifact_root', 'receipt_path', 'runtime_path']);
const PROMPT_EVIDENCE_KEYS = Object.freeze(['path', 'dev', 'ino', 'sha256']);
const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_REPORT_ENUMS = Object.freeze({
  status: Object.freeze(['selected', 'blocked']),
  requested_backend: Object.freeze(['auto', 'claude', 'codex', 'agy']),
  selected_backend: Object.freeze(['auto', 'claude', 'codex', 'agy']),
  fallback: Object.freeze(['none', 'claude']),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
}

function blocked(reason, legacyReport = {}) {
  return deepFreeze({ status: 'BLOCKED', context: undefined, contextPath: undefined, contextSha256: undefined, legacyReport: clone(legacyReport), reason });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function isAgentIdentity(value) {
  return isNonEmptyString(value) && /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

function isContained(parent, child, { direct = false } = {}) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  if (direct) return path.dirname(childPath) === parentPath;
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function validAssignedFiles(value) {
  return Array.isArray(value) && value.every((entry) => (
    isNonEmptyString(entry)
    && !path.isAbsolute(entry)
    && !entry.split(/[\\/]/).includes('..')
  ));
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function promptEvidenceError(input) {
  const evidence = input.prompt_evidence;
  if (!isPlainRecord(evidence)) return 'prompt_evidence must be a plain object';
  const keys = Object.keys(evidence);
  if (keys.length !== PROMPT_EVIDENCE_KEYS.length || keys.some((key) => !PROMPT_EVIDENCE_KEYS.includes(key))) {
    return 'prompt_evidence must contain only path, dev, ino, and sha256';
  }
  if (evidence.path !== input.prompt_file) return 'prompt_evidence must bind prompt_file';
  if (!Number.isSafeInteger(evidence.dev) || evidence.dev < 0) return 'prompt_evidence.dev must be an explicit non-negative integer';
  if (!Number.isSafeInteger(evidence.ino) || evidence.ino < 0) return 'prompt_evidence.ino must be an explicit non-negative integer';
  if (typeof evidence.sha256 !== 'string' || !SHA256.test(evidence.sha256)) return 'prompt_evidence.sha256 must be lowercase SHA-256';
  return null;
}

// Compatibility reports may carry only the selector's finite status/backend
// summary. Role, authority, transport, paths, and free-form text stay owned by
// the resolved context and are never accepted from a legacy report.
function safeLegacyReport(input) {
  if (!isPlainRecord(input.legacy_report)) return {};
  return Object.fromEntries(Object.entries(LEGACY_REPORT_ENUMS)
    .filter(([key, allowed]) => Object.prototype.hasOwnProperty.call(input.legacy_report, key) && allowed.includes(input.legacy_report[key]))
    .map(([key]) => [key, input.legacy_report[key]]));
}

function scopeError(input) {
  for (const key of SCOPE_PATHS) {
    if (!isNonEmptyString(input[key]) || !path.isAbsolute(input[key])) return `${key} must be an explicit absolute path descriptor`;
  }
  if (!isContained(input.workdir, input.prompt_file)) return 'prompt_file must be contained by workdir';
  if (!isContained(input.workdir, input.artifact_root)) return 'artifact_root must be contained by workdir';
  if (!isContained(input.artifact_root, input.receipt_path, { direct: true })) return 'receipt_path must be directly contained by artifact_root';
  if (input.context_path !== undefined && (!isNonEmptyString(input.context_path) || !path.isAbsolute(input.context_path) || !isContained(input.artifact_root, input.context_path, { direct: true }))) {
    return 'context_path must be directly contained by artifact_root';
  }
  if (!validAssignedFiles(input.assigned_files)) return 'assigned_files must be bounded repository-relative paths';
  if (typeof input.report_only !== 'boolean') return 'report_only must be explicit';
  if (!isNonEmptyString(input.task_id) || !isNonEmptyString(input.attempt_id)) return 'task_id and attempt_id are required';
  return promptEvidenceError(input);
}

function numberOrBlocked(value, label) {
  return Number.isSafeInteger(value) && value >= 0 ? null : `${label} must be an explicit non-negative integer`;
}

function legacyReport(input, resolved, config, transport) {
  const executionProvider = input.execution_provider;
  return {
    ...safeLegacyReport(input),
    requested_role: resolved && resolved.requested_role || input.requested_role,
    effective_role: resolved && resolved.effective_role,
    provider: executionProvider,
    mode: input.mode,
    transport: transport && transport.transport,
    stdin_mode: transport && transport.stdin_mode,
    requested_model: config && config.model.value === undefined ? null : config && config.model.value,
    requested_effort: config && config.effort.value === undefined ? null : config && config.effort.value,
    timeout_secs: config && config.timeout_secs.value,
    model_source: config && config.model.source || null,
    effort_source: config && config.effort.source || null,
    timeout_source: config && config.timeout_secs.source || null,
  };
}

function buildContext(input = {}, { writeFile, diagnostics } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return blocked('input must be an object');
  if (!isAgentIdentity(input.dispatching_agent)) {
    return blocked('dispatching_agent must be an explicit lexical identity', legacyReport(input));
  }
  const executionProvider = input.execution_provider;
  const transport = TRANSPORTS[executionProvider];
  if (!transport) return blocked('execution_provider must be explicitly codex or agy', legacyReport(input));

  const resolved = resolveRole({
    requestedRole: input.requested_role,
    mode: input.mode,
    provider: executionProvider,
    diagnostics,
  });
  if (resolved.status !== 'RESOLVED') return blocked(resolved.reason, legacyReport(input, resolved));
  if (input.effective_role !== undefined && input.effective_role !== resolved.effective_role) {
    return blocked('effective_role contradicts canonical resolver', legacyReport(input, resolved));
  }
  if (input.transport !== undefined && input.transport !== transport.transport) {
    return blocked('transport contradicts provider', legacyReport(input, resolved, undefined, transport));
  }
  if (input.stdin_mode !== undefined && input.stdin_mode !== transport.stdin_mode) {
    return blocked('stdin_mode contradicts provider', legacyReport(input, resolved, undefined, transport));
  }

  const scopeFailure = scopeError(input);
  if (scopeFailure) return blocked(scopeFailure, legacyReport(input, resolved, undefined, transport));
  const config = resolveConfig({ effectiveRole: resolved.effective_role, config: input.config || {} });
  const timeoutFailure = numberOrBlocked(config.timeout_secs.value, 'resolved timeout_secs');
  if (timeoutFailure) return blocked(timeoutFailure, legacyReport(input, resolved, config, transport));
  if (executionProvider === 'agy' && !isNonEmptyString(config.model.value)) {
    return blocked('AGY model must resolve explicitly', legacyReport(input, resolved, config, transport));
  }
  const report = legacyReport(input, resolved, config, transport);
  const context = deepFreeze({
    schema: 'dhpk.cli.context.v1',
    dispatching_agent: input.dispatching_agent,
    execution_provider: executionProvider,
    provider: executionProvider,
    requested_role: resolved.requested_role,
    effective_role: resolved.effective_role,
    role_contract: clone(resolved.role_contract),
    mode: input.mode,
    workdir: input.workdir,
    prompt_file: input.prompt_file,
    artifact_root: input.artifact_root,
    receipt_path: input.receipt_path,
    assigned_files: clone(input.assigned_files),
    report_only: input.report_only,
    timeout_secs: config.timeout_secs.value,
    task_id: input.task_id,
    attempt_id: input.attempt_id,
    transport: transport.transport,
    stdin_mode: transport.stdin_mode,
    requested_model: config.model.value === undefined ? null : config.model.value,
    requested_effort: config.effort.value === undefined ? null : config.effort.value,
    prompt_evidence: clone(input.prompt_evidence),
    runtime_path: input.runtime_path,
  });

  if (writeFile === undefined) return deepFreeze({ status: 'READY', context, legacyReport: report });
  if (typeof writeFile !== 'function') return blocked('writeFile must be a trusted writer function', report);
  if (!input.context_path) return blocked('context_path is required when writing context', report);

  const payload = JSON.stringify(context);
  const contextSha256 = crypto.createHash('sha256').update(payload).digest('hex');
  try {
    writeFile(input.context_path, payload, { mode: 0o600, atomic: true, noFollow: true });
  } catch (error) {
    return blocked(`trusted context writer failed: ${error.message}`, report);
  }
  return deepFreeze({ status: 'READY', context, contextPath: input.context_path, contextSha256, legacyReport: report });
}

module.exports = Object.freeze({ buildContext });
