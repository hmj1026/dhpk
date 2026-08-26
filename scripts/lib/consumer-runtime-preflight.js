'use strict';

// The preflight boundary deliberately does not execute a consumer.  It records
// whether a controlled runner can attempt an exact-head probe and keeps that
// readiness evidence separate from the runtime verdict.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { redactSensitiveText } = require('./redaction');

const COMMIT = /^[a-f0-9]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TREE = COMMIT;
const MAX_DIAGNOSTIC_LENGTH = 800;
const MAX_SURFACES = 20;
const MAX_RUNNER_ENTRIES = 40;
const CURSOR_SESSION_ALLOWLIST = Object.freeze([
  '.config/cursor/auth.json',
  '.cursor/cli-config.json',
]);
const AGY_SESSION_ALLOWLIST = Object.freeze([
  '.gemini/oauth_creds.json',
  '.gemini/google_accounts.json',
  '.gemini/antigravity-cli/antigravity-oauth-token',
]);
const SESSION_ALLOWLIST = new Set([...CURSOR_SESSION_ALLOWLIST, ...AGY_SESSION_ALLOWLIST]);

const REQUIRED_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-sync',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
]);
const REQUIRED_RUNTIME_SURFACES = Object.freeze([
  'claude-core',
  'codex-sync',
  'codex-native',
  'cursor-plugin',
  'agent-plugin',
  'agy-plugin',
]);
const RUNNER_CAPABILITY_NAMES = new Set([
  'node',
  'git',
  'bwrap',
  'network',
  'cursor',
  'agent-plugin',
  'agy',
  ...REQUIRED_SURFACES,
]);

const PREFLIGHT_STATUSES = Object.freeze([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
  'SKIP_INCOMPATIBLE',
  'UNAVAILABLE',
]);

// Keep this vocabulary intentionally small and non-sensitive.  Adapters may
// add a diagnostic, but only this reason class is used by release decisions.
const REASON_CODES = new Set([
  'READY',
  'IDENTITY_MISSING',
  'IDENTITY_INVALID',
  'FOREIGN_PREFLIGHT',
  'STALE_PREFLIGHT',
  'WORKTREE_DIRTY',
  'TOOL_UNAVAILABLE',
  'VERSION_UNAVAILABLE',
  'AUTH_REQUIRED',
  'SESSION_UNAVAILABLE',
  'SESSION_NOT_ALLOWLISTED',
  'NETWORK_UNAVAILABLE',
  'DNS_UNAVAILABLE',
  'TRANSPORT_UNAVAILABLE',
  'TIMEOUT',
  'TIMEOUT_SILENT',
  'TIMEOUT_PARTIAL_OUTPUT',
  'OUTPUT_LIMIT',
  'CLI_INCOMPATIBLE',
  'NO_OUTPUT',
  'SANDBOX_UNAVAILABLE',
  'SANDBOX_PATH_UNSAFE',
  'PACKAGE_INVALID',
  'PACKAGE_UNAVAILABLE',
  'INVOCATION_INVALID',
  'PROBE_NOT_RUN',
  'PROBE_FAILED',
  'UNKNOWN',
]);

function firstDefined(object, ...keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function boundedDiagnostic(value) {
  if (value === undefined || value === null) return null;
  return redactSensitiveText(String(value), { maxLength: MAX_DIAGNOSTIC_LENGTH })
    .replace(/(^|[\s"'(=])(?:\/|[A-Za-z]:[\\/])[^\s"'(),;}\]]*/g, '$1<path>')
    .slice(-MAX_DIAGNOSTIC_LENGTH);
}

function boundedReasonCode(value, fallback = 'UNKNOWN') {
  const code = typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '_') : '';
  return REASON_CODES.has(code) ? code : fallback;
}

function reasonCodeForDiagnostic(status, diagnostic) {
  const text = String(diagnostic || '').toLowerCase();
  if (status === 'PASS') return 'READY';
  if (/auth|login|credential|token/.test(text)) return 'AUTH_REQUIRED';
  if (/session|allowlist/.test(text)) return 'SESSION_UNAVAILABLE';
  if (/dns|resolve|eai_|name resolution/.test(text)) return 'DNS_UNAVAILABLE';
  if (/network|transport|connection|socket/.test(text)) return 'NETWORK_UNAVAILABLE';
  if (/timeout|timed out/.test(text)) return 'TIMEOUT';
  if (/sandbox|namespace|bwrap/.test(text)) return 'SANDBOX_UNAVAILABLE';
  if (/package|manifest|structure/.test(text)) return 'PACKAGE_INVALID';
  if (/cli|command|argument|output|loader|discovery/.test(text)) return 'CLI_INCOMPATIBLE';
  if (status === 'UNAVAILABLE') return 'TOOL_UNAVAILABLE';
  return 'PROBE_FAILED';
}

function isSurface(value) {
  return typeof value === 'string' && REQUIRED_SURFACES.includes(value);
}

function normalizeSurfaceList(value, field, { required = false, defaultValue = null } = {}) {
  const source = value === undefined || value === null ? defaultValue : value;
  if (!Array.isArray(source)) {
    return {
      value: source,
      errors: required ? [`${field} must be an array`] : [],
    };
  }
  const errors = [];
  const normalized = [];
  const seen = new Set();
  if (source.length > MAX_SURFACES) errors.push(`${field} exceeds the bounded surface count`);
  source.slice(0, MAX_SURFACES).forEach((entry) => {
    if (!isSurface(entry)) {
      errors.push(`${field} contains unknown surface '${String(entry).slice(0, 80)}'`);
    } else if (seen.has(entry)) {
      errors.push(`${field} contains duplicate surface '${entry}'`);
    } else {
      seen.add(entry);
      normalized.push(entry);
    }
  });
  if (required && normalized.length === 0) errors.push(`${field} must not be empty`);
  return { value: normalized, errors };
}

function normalizeSessionFiles(input) {
  const raw = Array.isArray(input) ? input : [];
  const files = [];
  const seen = new Set();
  for (const entry of raw.slice(0, 20)) {
    if (typeof entry !== 'string') continue;
    const relative = entry.replace(/\\/g, '/').trim();
    // Evidence may name an allowlisted file, but must never carry a host path
    // or the file contents.  Reject absolute/traversal values rather than
    // trying to make an unsafe path look safe.
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) continue;
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(relative)) continue;
    if (!SESSION_ALLOWLIST.has(relative)) continue;
    if (!seen.has(relative)) {
      seen.add(relative);
      files.push(relative);
    }
  }
  return files;
}

function normalizePreflightIdentity(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];
  const identity = {};
  const stringFields = [
    ['taskId', 'task_id'],
    ['attemptId', 'attempt_id'],
  ];
  for (const [field, alias] of stringFields) {
    const value = firstDefined(source, field, alias);
    if (typeof value !== 'string' || !SAFE_ID.test(value)) errors.push(`${field} is missing or invalid`);
    else identity[field] = value;
  }

  const shaFields = [
    ['sourceCommit', 'source_commit', COMMIT],
    ['sourceTree', 'source_tree', TREE],
    ['targetCommit', 'target_commit', COMMIT],
    ['targetTree', 'target_tree', TREE],
  ];
  for (const [field, alias, pattern] of shaFields) {
    const value = firstDefined(source, field, alias);
    if (typeof value !== 'string' || !pattern.test(value)) errors.push(`${field} is missing or invalid`);
    else identity[field] = value.toLowerCase();
  }
  const worktree = firstDefined(source, 'worktree', 'worktree_status');
  if (!['CLEAN', 'DIRTY'].includes(worktree)) errors.push('worktree must be CLEAN or DIRTY');
  else identity.worktree = worktree;

  const selected = normalizeSurfaceList(
    firstDefined(source, 'selectedSurfaces', 'selected_surfaces', 'surfaces'),
    'selectedSurfaces',
    { required: true },
  );
  errors.push(...selected.errors);
  if (selected.value) identity.selectedSurfaces = selected.value;

  const runtime = normalizeSurfaceList(
    firstDefined(source, 'requiredRuntimeSurfaces', 'required_runtime_surfaces'),
    'requiredRuntimeSurfaces',
    { required: true },
  );
  errors.push(...runtime.errors);
  if (runtime.value) identity.requiredRuntimeSurfaces = runtime.value;
  if (identity.selectedSurfaces && identity.requiredRuntimeSurfaces) {
    const selectedSet = new Set(identity.selectedSurfaces);
    const foreign = identity.requiredRuntimeSurfaces.filter((surface) => !selectedSet.has(surface));
    if (foreign.length > 0) errors.push(`requiredRuntimeSurfaces is not a selected subset: ${foreign.join(', ')}`);
    if (identity.requiredRuntimeSurfaces.includes('cursor-sync')) errors.push('requiredRuntimeSurfaces must not include cursor-sync');
  }

  const sessionFiles = normalizeSessionFiles(firstDefined(source, 'sessionFiles', 'session_files'));
  if (sessionFiles.length > 0) identity.sessionFiles = sessionFiles;
  const sessionFileCount = firstDefined(source, 'sessionFileCount', 'session_file_count');
  if (sessionFileCount !== undefined) {
    if (!Number.isSafeInteger(sessionFileCount) || sessionFileCount < 0 || sessionFileCount > 100) {
      errors.push('sessionFileCount is invalid');
    } else {
      identity.sessionFileCount = sessionFileCount;
    }
  } else if (sessionFiles.length > 0) {
    identity.sessionFileCount = sessionFiles.length;
  }
  return { ok: errors.length === 0, errors, identity };
}

function normalizeRunnerCapabilities(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const normalized = {};
  const entries = Object.entries(source).slice(0, MAX_RUNNER_ENTRIES);
  for (const [name, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name)) continue;
    if (!RUNNER_CAPABILITY_NAMES.has(name)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = {};
    const status = firstDefined(value, 'status', 'state');
    if (typeof status === 'string' && PREFLIGHT_STATUSES.includes(status.toUpperCase())) item.status = status.toUpperCase();
    const version = firstDefined(value, 'version', 'toolVersion', 'tool_version');
    if (typeof version === 'string' && version.length <= 128) item.version = boundedDiagnostic(version).slice(0, 128);
    const reasonCode = firstDefined(value, 'reasonCode', 'reason_code');
    if (reasonCode !== undefined) item.reasonCode = boundedReasonCode(reasonCode);
    const diagnostic = boundedDiagnostic(firstDefined(value, 'diagnostic', 'reason', 'details'));
    if (diagnostic) item.diagnostic = diagnostic;
    const mode = firstDefined(value, 'mode', 'networkMode', 'network_mode');
    if (typeof mode === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(mode)) item.mode = mode;
    const files = firstDefined(value, 'sessionFiles', 'session_files', 'selectedFiles', 'selected_files');
    const sessionFiles = normalizeSessionFiles(files);
    if (sessionFiles.length > 0) item.sessionFiles = sessionFiles;
    const count = firstDefined(value, 'sessionFileCount', 'session_file_count', 'count');
    if (Number.isSafeInteger(count) && count >= 0 && count <= 100) item.sessionFileCount = count;
    if (Array.isArray(value.capabilities)) {
      item.capabilities = value.capabilities.slice(0, 40)
        .filter((entry) => typeof entry === 'string')
        .map((entry) => boundedDiagnostic(entry).slice(0, 128));
    }
    normalized[name] = item;
  }
  return normalized;
}

function comparePreflightIdentity(expected, actual) {
  const left = normalizePreflightIdentity(expected);
  const right = normalizePreflightIdentity(actual);
  const errors = [];
  if (!left.ok) errors.push(...left.errors.map((error) => `expected identity: ${error}`));
  if (!right.ok) errors.push(...right.errors.map((error) => `actual identity: ${error}`));
  if (left.ok && right.ok) {
    for (const field of [
      'taskId', 'attemptId', 'sourceCommit', 'sourceTree', 'targetCommit', 'targetTree',
      'worktree', 'selectedSurfaces', 'requiredRuntimeSurfaces',
    ]) {
      if (JSON.stringify(left.identity[field]) !== JSON.stringify(right.identity[field])) {
        errors.push(`identity field '${field}' does not match`);
      }
    }
  }
  return { ok: errors.length === 0, errors, expected: left.identity, actual: right.identity };
}

function statusForSurface(value) {
  const status = typeof value === 'string' ? value.toUpperCase() : '';
  return PREFLIGHT_STATUSES.includes(status) ? status : 'BLOCKED';
}

function createPreflightResult({ identity, status, surfaces = [], runner = {}, diagnostics = [], reasonCode } = {}) {
  const checked = normalizePreflightIdentity(identity);
  const normalizedRunner = normalizeRunnerCapabilities(runner);
  const normalizedSurfaces = Array.isArray(surfaces) ? surfaces.slice(0, MAX_SURFACES).map((entry) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
    const surface = firstDefined(source, 'surface', 'id');
    const row = {
      surface: isSurface(surface) ? surface : '<invalid-surface>',
      status: statusForSurface(firstDefined(source, 'status', 'outcome', 'verdict')),
      reasonCode: boundedReasonCode(firstDefined(source, 'reasonCode', 'reason_code'), 'UNKNOWN'),
    };
    const diagnostic = boundedDiagnostic(firstDefined(source, 'diagnostic', 'reason', 'details'));
    if (diagnostic) row.diagnostic = diagnostic;
    return row;
  }) : [];
  const errors = [...checked.errors];
  if (normalizedSurfaces.some((entry) => entry.surface === '<invalid-surface>')) errors.push('preflight surface identity is invalid');
  const requestedStatus = statusForSurface(status);
  const finalStatus = errors.length > 0 ? 'BLOCKED' : requestedStatus;
  const firstNonPassSurface = normalizedSurfaces.find((entry) => entry.status !== 'PASS');
  const firstNonPassRunner = Object.values(normalizedRunner)
    .find((entry) => entry.status && entry.status !== 'PASS');
  const inferredReason = firstNonPassSurface && firstNonPassSurface.reasonCode !== 'UNKNOWN'
    ? firstNonPassSurface.reasonCode
    : firstNonPassRunner && firstNonPassRunner.reasonCode
      ? firstNonPassRunner.reasonCode
      : finalStatus === 'PASS'
        ? 'READY'
        : finalStatus === 'UNAVAILABLE'
          ? 'TOOL_UNAVAILABLE'
          : finalStatus === 'SKIP_INCOMPATIBLE'
            ? 'CLI_INCOMPATIBLE'
            : 'PROBE_FAILED';
  const result = {
    schema: 'dhpk.consumer-runtime-preflight.v1',
    stage: 'PREFLIGHT',
    status: finalStatus,
    outcome: finalStatus,
    identity: checked.identity,
    runner: normalizedRunner,
    surfaces: normalizedSurfaces,
    diagnostics: (Array.isArray(diagnostics) ? diagnostics : [diagnostics])
      .slice(0, 20).map(boundedDiagnostic).filter(Boolean),
    reasonCode: boundedReasonCode(reasonCode, errors.length > 0 ? 'IDENTITY_INVALID' : inferredReason),
    runtimePromoted: false,
  };
  if (errors.length > 0) result.errors = errors.slice(0, 20).map(boundedDiagnostic);
  return result;
}

function runtimeOutcome(requiredRuntimeSurfaces, surfaceResults) {
  const bySurface = new Map((Array.isArray(surfaceResults) ? surfaceResults : [])
    .filter((entry) => entry && typeof entry.surface === 'string')
    .map((entry) => [entry.surface, statusForSurface(entry.status || entry.outcome || entry.verdict)]));
  const statuses = requiredRuntimeSurfaces.map((surface) => bySurface.get(surface) || 'NOT_RUN');
  if (statuses.some((status) => status === 'FAIL')) return 'PUBLISHED_UNHEALTHY';
  if (statuses.some((status) => status === 'BLOCKED')) return 'BLOCKED';
  if (statuses.some((status) => status !== 'PASS')) return 'PUBLISHED_PENDING';
  return 'COMPLETE';
}

function aggregatePreflight({ preflight, expectedIdentity = null, requiredRuntimeSurfaces = null, surfaceResults = [] } = {}) {
  const errors = [];
  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) {
    errors.push('preflight evidence is required');
  } else {
    if (preflight.schema !== 'dhpk.consumer-runtime-preflight.v1') errors.push('preflight schema is invalid');
    if (preflight.stage !== 'PREFLIGHT') errors.push('preflight stage is invalid');
    if (!PREFLIGHT_STATUSES.includes(preflight.status)) errors.push('preflight status is invalid');
    const actualIdentity = normalizePreflightIdentity(preflight.identity);
    if (!actualIdentity.ok) errors.push(...actualIdentity.errors.map((error) => `preflight identity: ${error}`));
    if (expectedIdentity) {
      const checked = comparePreflightIdentity(expectedIdentity, preflight.identity);
      if (!checked.ok) errors.push(...checked.errors.map((error) => `foreign or stale preflight: ${error}`));
    }
  }
  const runtime = Array.isArray(requiredRuntimeSurfaces)
    ? normalizeSurfaceList(requiredRuntimeSurfaces, 'requiredRuntimeSurfaces', { required: true })
    : { value: REQUIRED_RUNTIME_SURFACES, errors: [] };
  errors.push(...runtime.errors);
  const runtimeStatus = runtimeOutcome(runtime.value || [], surfaceResults);
  const preflightStatus = preflight && PREFLIGHT_STATUSES.includes(preflight.status) ? preflight.status : 'BLOCKED';
  // `outcome` is intentionally the preflight verdict.  A caller must use the
  // independent runtimeOutcome and existing harness aggregation to complete a
  // release; readiness alone can never promote a release.
  return {
    schema: 'dhpk.consumer-runtime-preflight-aggregate.v1',
    status: errors.length > 0 ? 'BLOCKED' : preflightStatus,
    outcome: errors.length > 0 ? 'BLOCKED' : preflightStatus,
    preflightStatus,
    runtimeOutcome: errors.length > 0 ? 'PUBLISHED_PENDING' : runtimeStatus,
    runtimePromoted: false,
    requiredRuntimeSurfaces: runtime.value || [],
    surfaceResults: Array.isArray(surfaceResults) ? surfaceResults.slice(0, MAX_SURFACES) : [],
    diagnostics: errors.slice(0, 20).map(boundedDiagnostic),
  };
}

function resolveExecutable(name, pathValue = process.env.PATH) {
  for (const directory of String(pathValue || '').split(path.delimiter)) {
    if (!directory) continue;
    try {
      const resolvedDirectory = fs.realpathSync(path.resolve(directory));
      if (!fs.statSync(resolvedDirectory).isDirectory()) continue;
      const candidate = path.join(resolvedDirectory, name);
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
      const resolved = fs.realpathSync(candidate);
      if (!(resolved === resolvedDirectory || resolved.startsWith(`${resolvedDirectory}${path.sep}`))) continue;
      const resolvedStat = fs.statSync(resolved);
      if (resolvedStat.isFile() && (resolvedStat.mode & 0o111)) return resolved;
    } catch (_) {
      // A missing or unsafe PATH entry is represented by UNAVAILABLE below.
    }
  }
  return null;
}

function commandVersion(executable, args = ['--version'], env = process.env) {
  if (!executable) return null;
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: { ...env, HOME: undefined, USERPROFILE: undefined },
    timeout: 5000,
    maxBuffer: 16 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0];
  return output ? boundedDiagnostic(output) : null;
}

function allowlistedSessionFiles(hostHome, allowlist) {
  if (typeof hostHome !== 'string' || !path.isAbsolute(hostHome)) return [];
  return allowlist.filter((relative) => {
    const candidate = path.join(hostHome, relative);
    try {
      return fs.lstatSync(candidate).isFile() && !fs.lstatSync(candidate).isSymbolicLink();
    } catch (_) {
      return false;
    }
  });
}

function capability(status, reasonCode, version, diagnostic, extra = {}) {
  const result = { status, reasonCode: boundedReasonCode(reasonCode, status === 'PASS' ? 'READY' : 'UNKNOWN') };
  if (version) result.version = version;
  const bounded = boundedDiagnostic(diagnostic);
  if (bounded) result.diagnostic = bounded;
  return { ...result, ...extra };
}

function collectRunnerCapabilities({
  root = process.cwd(),
  env = process.env,
  pathValue = env.PATH,
  selectedSurfaces = REQUIRED_SURFACES,
} = {}) {
  const capabilities = {};
  const nodeVersion = process.version;
  capabilities.node = capability('PASS', 'READY', nodeVersion);
  const git = resolveExecutable('git', pathValue);
  capabilities.git = git
    ? capability('PASS', 'READY', commandVersion(git, ['--version'], env))
    : capability('UNAVAILABLE', 'TOOL_UNAVAILABLE');

  const bwrap = resolveExecutable('bwrap', pathValue);
  capabilities.bwrap = bwrap
    ? capability('PASS', 'READY', commandVersion(bwrap, ['--version'], env))
    : capability('UNAVAILABLE', 'SANDBOX_UNAVAILABLE');
  capabilities.network = process.platform === 'linux' && bwrap
    ? capability('PASS', 'READY', null, null, { mode: 'shared' })
    : capability('UNAVAILABLE', 'SANDBOX_UNAVAILABLE', null, 'controlled bubblewrap network namespace is unavailable');

  const cursor = resolveExecutable('cursor-agent', pathValue);
  const cursorFiles = allowlistedSessionFiles(env.DHPK_CURSOR_HOST_HOME || env.HOME, CURSOR_SESSION_ALLOWLIST);
  capabilities.cursor = cursor
    ? capability(cursorFiles.length > 0 ? 'PASS' : 'BLOCKED', cursorFiles.length > 0 ? 'READY' : 'AUTH_REQUIRED', commandVersion(cursor, ['--version'], env), null, {
      sessionFiles: cursorFiles,
      sessionFileCount: cursorFiles.length,
    })
    : capability('UNAVAILABLE', 'TOOL_UNAVAILABLE');
  capabilities['agent-plugin'] = { ...capabilities.cursor };

  const agy = resolveExecutable('agy', pathValue);
  const agyFiles = allowlistedSessionFiles(env.DHPK_AGY_HOST_HOME, AGY_SESSION_ALLOWLIST);
  capabilities.agy = agy
    ? capability(agyFiles.length > 0 ? 'PASS' : 'BLOCKED', agyFiles.length > 0 ? 'READY' : 'SESSION_UNAVAILABLE', commandVersion(agy, ['--version'], env), null, {
      sessionFiles: agyFiles,
      sessionFileCount: agyFiles.length,
    })
    : capability('UNAVAILABLE', 'TOOL_UNAVAILABLE');

  for (const surface of selectedSurfaces) {
    if (surface === 'cursor-plugin' || surface === 'agent-plugin') capabilities[surface] = { ...capabilities.cursor };
    else if (surface === 'agy-plugin') capabilities[surface] = { ...capabilities.agy };
    else if (!capabilities[surface]) capabilities[surface] = capability('PASS', 'READY');
  }
  // Keep root and host state out of serialized evidence.  The parameters are
  // accepted for deterministic callers/tests, but only versions/status/files
  // above are returned.
  void root;
  return capabilities;
}

function preflightForCheckout({ identity, root = process.cwd(), env = process.env } = {}) {
  const checked = normalizePreflightIdentity(identity);
  const selected = checked.identity.selectedSurfaces || [];
  const runner = collectRunnerCapabilities({ root, env, selectedSurfaces: selected });
  const surfaces = selected.map((surface) => {
    const source = runner[surface] || capability('UNAVAILABLE', 'TOOL_UNAVAILABLE');
    return {
      surface,
      status: source.status,
      reasonCode: source.reasonCode,
      ...(source.diagnostic ? { diagnostic: source.diagnostic } : {}),
    };
  });
  const runnerPrerequisites = ['git', 'bwrap', 'network']
    .map((name) => runner[name])
    .filter(Boolean)
    .map((entry) => statusForSurface(entry.status));
  const readinessStatuses = [...surfaces.map((entry) => entry.status), ...runnerPrerequisites];
  const status = readinessStatuses.some((entry) => entry === 'FAIL')
    ? 'FAIL'
    : readinessStatuses.some((entry) => entry === 'BLOCKED')
      ? 'BLOCKED'
      : readinessStatuses.some((entry) => entry === 'UNAVAILABLE')
        ? 'UNAVAILABLE'
        : readinessStatuses.some((entry) => entry !== 'PASS') ? 'SKIP_INCOMPATIBLE' : 'PASS';
  const result = createPreflightResult({ identity: checked.identity, status, surfaces, runner });
  if (checked.identity.worktree === 'DIRTY') {
    result.status = 'BLOCKED';
    result.outcome = 'BLOCKED';
    result.reasonCode = 'WORKTREE_DIRTY';
    result.diagnostics = [...result.diagnostics, 'exact-head preflight requires a CLEAN worktree'].slice(0, 20);
  }
  return result;
}

module.exports = {
  COMMIT,
  TREE,
  REQUIRED_SURFACES,
  REQUIRED_RUNTIME_SURFACES,
  PREFLIGHT_STATUSES,
  REASON_CODES,
  MAX_DIAGNOSTIC_LENGTH,
  CURSOR_SESSION_ALLOWLIST,
  AGY_SESSION_ALLOWLIST,
  SESSION_ALLOWLIST,
  RUNNER_CAPABILITY_NAMES,
  boundedDiagnostic,
  boundedReasonCode,
  reasonCodeForDiagnostic,
  normalizeSessionFiles,
  normalizePreflightIdentity,
  normalizeRunnerCapabilities,
  comparePreflightIdentity,
  createPreflightResult,
  aggregatePreflight,
  resolveExecutable,
  commandVersion,
  collectRunnerCapabilities,
  preflightForCheckout,
};
