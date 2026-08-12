#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const DEFAULT_TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TEST_FIXTURE_ENV = 'DHPK_SESSION_USAGE_AUDIT_TEST_MODE';

function testFixtureMode() {
  return process.env[TEST_FIXTURE_ENV] === '1';
}

function fixtureHomeAllowed(candidate) {
  return testFixtureMode() && isWithin(realPathOrResolve(os.tmpdir()), candidate);
}

function realPathOrResolve(candidate) {
  const resolved = path.resolve(candidate || '.');
  try { return fs.realpathSync(resolved); } catch (_error) { return resolved; }
}

function dateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseArgs(argv = [], context = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {
    dateRange: null,
    agents: [],
    source: 'auto',
    format: 'text',
    createIssues: false,
    confirmed: false,
    home: context.home || process.env.HOME || '',
    output: context.output || '',
    repo: context.repo || '',
    pluginRoot: context.pluginRoot || '',
    testFixtureHome: Boolean(context.testFixtureHome),
    confirmationDigest: context.confirmationDigest || '',
    executeVerification: Boolean(context.executeVerification),
    verificationFile: context.verificationFile || '',
    verificationDigest: context.verificationDigest || '',
    maxBytes: 512 * 1024 * 1024,
    maxSessions: 5000,
    timeZone: context.timeZone || DEFAULT_TIME_ZONE,
    help: false,
  };
  let date;
  let from;
  let to;

  const valueFor = (index, flag) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--date') {
      date = valueFor(index, arg); index += 1;
    } else if (arg === '--from') {
      from = valueFor(index, arg); index += 1;
    } else if (arg === '--to') {
      to = valueFor(index, arg); index += 1;
    } else if (arg === '--agent') {
      const agent = valueFor(index, arg); index += 1;
      if (!parsed.agents.includes(agent)) parsed.agents.push(agent);
    } else if (arg === '--source') {
      parsed.source = valueFor(index, arg); index += 1;
    } else if (arg === '--format') {
      parsed.format = valueFor(index, arg); index += 1;
    } else if (arg === '--create-issues') {
      parsed.createIssues = true;
    } else if (arg === '--confirm') {
      parsed.confirmed = true;
    } else if (arg === '--confirm-digest') {
      parsed.confirmationDigest = valueFor(index, arg); index += 1;
    } else if (arg === '--execute-verification') {
      parsed.executeVerification = true;
    } else if (arg === '--home') {
      parsed.home = valueFor(index, arg); index += 1;
    } else if (arg === '--output') {
      parsed.output = valueFor(index, arg); index += 1;
    } else if (arg === '--repo') {
      parsed.repo = valueFor(index, arg); index += 1;
    } else if (arg === '--plugin-root') {
      parsed.pluginRoot = valueFor(index, arg); index += 1;
    } else if (arg === '--verification-file') {
      parsed.verificationFile = valueFor(index, arg); index += 1;
    } else if (arg === '--verification-digest') {
      parsed.verificationDigest = valueFor(index, arg); index += 1;
    } else if (arg === '--max-bytes') {
      parsed.maxBytes = Number(valueFor(index, arg)); index += 1;
    } else if (arg === '--max-sessions') {
      parsed.maxSessions = Number(valueFor(index, arg)); index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (parsed.help) return parsed;
  if (date && (from || to)) throw new Error('--date cannot be combined with --from/--to');
  if ((from && !to) || (!from && to)) throw new Error('--from and --to must be supplied together');
  if (date && !validDate(date)) throw new Error(`Invalid date: ${date}`);
  if (from && (!validDate(from) || !validDate(to))) throw new Error('Invalid date range');
  if (from && from > to) throw new Error('--from must not be after --to');
  if (!['text', 'json'].includes(parsed.format)) throw new Error('--format must be text or json');
  if (!['auto', 'claude', 'codex', 'orca'].includes(parsed.source)) throw new Error('--source must be auto, claude, codex, or orca');
  if (!Number.isSafeInteger(parsed.maxBytes) || parsed.maxBytes <= 0) throw new Error('--max-bytes must be a positive integer');
  if (!Number.isSafeInteger(parsed.maxSessions) || parsed.maxSessions <= 0) throw new Error('--max-sessions must be a positive integer');
  if (parsed.confirmed && !parsed.createIssues) throw new Error('--confirm requires --create-issues');
  if (parsed.confirmationDigest && !/^sha256:[a-f0-9]{64}$/.test(parsed.confirmationDigest)) throw new Error('--confirm-digest must be sha256:<64 lowercase hex characters>');
  if (parsed.confirmationDigest && !parsed.createIssues) throw new Error('--confirm-digest requires --create-issues');
  if (parsed.verificationDigest && !/^sha256:[a-f0-9]{64}$/.test(parsed.verificationDigest)) throw new Error('--verification-digest must be sha256:<64 lowercase hex characters>');
  if (parsed.verificationDigest && !parsed.executeVerification) throw new Error('--verification-digest requires --execute-verification');

  const selectedHome = realPathOrResolve(parsed.home);
  const currentHome = realPathOrResolve(process.env.HOME || '');
  if (!isWithin(currentHome, selectedHome) && !(parsed.testFixtureHome && fixtureHomeAllowed(selectedHome))) {
    throw new Error('--home must stay inside the current user home');
  }
  parsed.home = selectedHome;

  const now = context.now instanceof Date ? context.now : new Date();
  const today = dateKey(now, parsed.timeZone);
  parsed.dateRange = date
    ? { from: date, to: date }
    : from
      ? { from, to }
      : { from: today, to: today };
  return parsed;
}

function usage() {
  return [
    'Usage: session-usage-audit.js [options]',
    '  --date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD',
    '  --agent NAME (repeatable) --source auto|claude|codex|orca',
    '  --format text|json --create-issues [--confirm] [--confirm-digest sha256:<64hex>] [--verification-file PATH --execute-verification --verification-digest sha256:<64hex>] [--plugin-root PATH]',
  ].join('\n');
}

const SENSITIVE_KEY_SOURCE = '(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|client[_-]?secret|password|passwd|cookie|authorization|credential|private[_-]?key|access[_-]?key|jwt|aws[_-]?(?:secret[_-]?access[_-]?key|session[_-]?token|access[_-]?key[_-]?id)|google[_-]?(?:api[_-]?key|application[_-]?credentials?)|database[_-]?url|db[_-]?url)';

function redactText(value, options = {}) {
  let text = String(value == null ? '' : value);
  const home = options.home || process.env.HOME || '';
  if (home) {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escapedHome, 'g'), '<HOME>');
  }
  text = text
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, '<REDACTED_PRIVATE_KEY>')
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----|-----END [^-\r\n]*PRIVATE KEY-----/gi, '<REDACTED_PRIVATE_KEY>')
    .replace(/((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1<REDACTED>@')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,}]+/gi, '$1<REDACTED>')
    .replace(/(authorization\s*:\s*basic\s+)[^\s,}]+/gi, '$1<REDACTED>')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1<REDACTED>')
    .replace(/\b(?:gh[ps]_[A-Za-z0-9_\-]{8,}|github_pat_[A-Za-z0-9_\-]{8,}|sk-[A-Za-z0-9_\-]{8,})\b/g, '<REDACTED>')
    .replace(/\b(?:xox[baprs]-|xapp-)[A-Za-z0-9-]{10,}\b/gi, '<REDACTED_SLACK_TOKEN>')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '<REDACTED_AWS_ACCESS_KEY>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<REDACTED_JWT>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<REDACTED_EMAIL>')
    .replace(/((?:[A-Za-z0-9]+[_-])*(?:token|secret|password|passwd|credential|authorization|private[_-]?key|api[_-]?key|access[_-]?key)(?:[_-][A-Za-z0-9]+)*\s*[=:]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi, '$1<REDACTED>')
    .replace(new RegExp(`(\\\\?["']?${SENSITIVE_KEY_SOURCE}\\\\?["']?\\s*[:=]\\s*)(\\\\?["'](?:\\\\.|[^"'\\\\])*(?:\\\\?["'])|[^,}\\s]+)`, 'gi'), '$1<REDACTED>')
    .replace(new RegExp(`(\\b${SENSITIVE_KEY_SOURCE}\\b\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^,\\s}]+)`, 'gi'), '$1<REDACTED>');
  return text;
}

function fingerprintFinding(finding = {}) {
  const normalized = ['category', 'component', 'message', 'version']
    .map((key) => String(finding[key] == null ? '' : finding[key]).trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
  return `sha256:${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

const SENSITIVE_KEY_PATTERN = new RegExp(SENSITIVE_KEY_SOURCE, 'i');

function redactIdentifier(value, label) {
  const text = String(value == null ? '' : value);
  if (!text) return '';
  return `${label}:${crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

const DEFAULT_KNOWN_AGENTS = new Set([
  'code-reviewer', 'security-reviewer', 'doc-reviewer', 'database-reviewer', 'tdd-guide', 'worker', 'explorer',
  'architect', 'bug-investigator', 'deep-reasoner', 'default', 'monitor', 'plugin-agent',
]);

function safeAgent(value, options = {}) {
  const text = String(value == null ? '' : value);
  if (!text) return '';
  const redacted = redactText(text);
  if (redacted !== text || /(?:gh[ps]_\w{8,}|github_pat_\w{8,}|sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.)/i.test(text)) {
    return redactIdentifier(text, 'agent');
  }
  if (/^agent:[a-f0-9]{16}$/.test(text)) return text;
  const knownAgents = options.knownAgents instanceof Set ? options.knownAgents : new Set(options.knownAgents || DEFAULT_KNOWN_AGENTS);
  return knownAgents.has(text) ? text : redactIdentifier(text, 'agent');
}

const PACKAGE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function safePackageVersion(value) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > 64 || !PACKAGE_VERSION_PATTERN.test(text)) return '';
  return redactText(text) === text ? text : '';
}

function installationVersion(value) {
  const version = safePackageVersion(value);
  return { version: version || 'unknown', versionSource: version ? 'metadata' : 'invalid-metadata' };
}

const SAFE_RECORD_TYPES = new Set([
  'assistant', 'effect-span', 'event', 'message', 'result', 'session', 'span', 'system', 'tool', 'tool-result', 'user',
  'hook_failure', 'hook-failure', 'hook_success', 'hook-success', 'runtime_failure', 'runtime-failure',
  'command_failure', 'command-failure', 'tool_failure', 'tool-failure', 'failed', 'error', 'failure',
  'failed-start', 'quota-blocked', 'success', 'completed', 'artifact-ready', 'user_prompt', 'user-prompt',
  'prompt', 'memory', 'historical', 'historical_summary', 'historical-summary', 'instructions',
]);

// Typed evidence is deliberately separate from the text classifier.  A
// transcript may quote an old timeout, a prompt may repeat a pending reminder,
// and a successful hook may include historical diagnostics.  None of those
// are runtime failures without an explicit record status.
const RUNTIME_RECORD_TYPES = new Set([
  'hook_failure', 'hook-failure', 'runtime_failure', 'runtime-failure',
  'command_failure', 'command-failure', 'tool_failure', 'tool-failure',
  'failed', 'error', 'failure', 'failed-start', 'quota-blocked',
]);
const SUCCESS_RECORD_TYPES = new Set([
  'hook_success', 'hook-success', 'success', 'completed', 'artifact-ready',
]);
const CONTEXT_RECORD_TYPES = new Set([
  'user', 'user_prompt', 'user-prompt', 'prompt', 'memory',
  'historical', 'historical_summary', 'historical-summary', 'instructions',
]);
const SOURCE_ROOT_PATTERNS = Object.freeze({
  claudeProjectTranscripts: '~/.claude/projects/**/*.jsonl',
  claudeArtifacts: '~/.claude/artifacts/**/*.{jsonl,log}',
  codexTranscripts: '~/.codex/sessions/**/*.{jsonl,ndjson}',
  activeOrcaCodexSessions: '~/.config/orca/codex-accounts/<account>/home/sessions/**/*.{jsonl,ndjson}',
  projectSurfaces: '~/projects|~/workspaces|~/repos|~/src',
});

function isSupportedRecordType(value) {
  const normalized = normalizeRecordType(value);
  return SAFE_RECORD_TYPES.has(normalized) || RUNTIME_RECORD_TYPES.has(normalized)
    || SUCCESS_RECORD_TYPES.has(normalized) || CONTEXT_RECORD_TYPES.has(normalized);
}

function packageOwnedRoleSet(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || inferPluginRoot() || path.resolve(__dirname, '../../..'));
  const names = (relative, extensions) => {
    const directory = path.join(packageRoot, relative);
    if (!fs.existsSync(directory)) return [];
    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
        .map((entry) => entry.name.replace(/\.(?:md|toml)$/i, ''))
        .filter((name) => name && name.toUpperCase() !== 'INDEX')
        .sort();
    } catch (_error) {
      return [];
    }
  };
  return {
    claude: names('agents', ['.md']),
    codex: names(path.join('codex', 'agents'), ['.toml']),
    excludedNavigationFiles: ['INDEX'],
  };
}

function normalizeRecordType(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || 'unknown';
}

function numericStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordField(record, keys) {
  return nestedValue(record, keys);
}

function normalizeRuntimeRecord(record, options = {}) {
  const recordType = normalizeRecordType(recordField(record, [
    'recordType', 'record_type', 'kind', 'type', 'subtype', 'event.type',
  ]));
  const exitStatus = numericStatus(recordField(record, [
    'exitStatus', 'exit_status', 'exitCode', 'exit_code', 'statusCode',
    'status.code', 'exit.code', 'result.exitCode', 'result.exit_code',
  ]));
  const structuredErrorStatus = String(recordField(record, [
    'structuredErrorStatus', 'structured_error_status', 'error.status',
    'error.code', 'error.type', 'status.error', 'result.error.status',
  ]) || '').trim();
  const eventId = String(recordField(record, [
    'eventId', 'event_id', 'event.id', 'spanId', 'span_id', 'traceId', 'trace_id',
  ]) || '').trim();
  const taskId = String(recordField(record, [
    'taskId', 'task_id', 'task.id', 'jobId', 'job_id', 'dispatchId', 'dispatch_id',
  ]) || '').trim();
  const parentSessionId = String(recordField(record, [
    'parentSessionId', 'parent_session_id', 'parentSession', 'parent.sessionId',
  ]) || '').trim();
  const role = String(recordField(record, [
    'role', 'roleName', 'role_name', 'agent', 'agent_name', 'subagent_type',
    'attributes.agent', 'meta.agent',
  ]) || '').trim();
  const successType = SUCCESS_RECORD_TYPES.has(recordType);
  const failureType = RUNTIME_RECORD_TYPES.has(recordType);
  const contextType = CONTEXT_RECORD_TYPES.has(recordType);
  const nonZeroExit = exitStatus !== null && exitStatus !== 0;
  const typedFailure = !successType && (failureType || nonZeroExit || Boolean(structuredErrorStatus));
  const typedFailureKind = typedFailure
    ? (failureType ? recordType : (nonZeroExit ? 'non-zero-exit' : 'structured-error'))
    : '';
  const sessionId = String(recordField(record, [
    'sessionId', 'session_id', 'run_id', 'runId', 'traceId', 'spanId',
    'session.id', 'meta.sessionId',
  ]) || '').trim();
  return {
    ...record,
    recordType,
    role,
    taskId,
    eventId,
    parentSessionId,
    exitStatus,
    structuredErrorStatus,
    typedFailure,
    typedFailureKind,
    contextEvidence: contextType || (!typedFailure && !successType),
    sessionId,
    sourceKind: options.sourceKind || record.sourceKind || record.source || 'unknown',
  };
}

function accountIdentifier(value) {
  return redactIdentifier(String(value || ''), 'account');
}

function redactSourcePath(value, home) {
  let text = redactText(value, { home });
  return text.replace(/(codex-accounts[\\/])([^\\/]+)/g, '$1<ACCOUNT>');
}

function safeRecordType(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase().slice(0, 80);
  return SAFE_RECORD_TYPES.has(normalized) ? normalized : (normalized ? redactIdentifier(normalized, 'type') : 'unknown');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSessionFile(file) {
  return /\.(?:jsonl|ndjson)$/i.test(file);
}

function walkFiles(root, predicate, output = []) {
  if (!fs.existsSync(root)) return output;
  let rootStat;
  try { rootStat = fs.lstatSync(root); } catch (_error) { return output; }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return output;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_error) {
    return output;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = path.join(root, entry.name);
    let stat;
    try { stat = fs.lstatSync(candidate); } catch (_error) { continue; }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walkFiles(candidate, predicate, output);
    else if (stat.isFile() && predicate(candidate)) output.push(candidate);
  }
  return output;
}

function discoverSources(home, options = {}) {
  const root = path.resolve(home || process.env.HOME || '.');
  const sources = [];
  const installedAgents = [];
  const omittedSources = [];
  const activeOrcaAccounts = new Set(
    (options.activeOrcaAccounts || process.env.DHPK_ACTIVE_ORCA_ACCOUNTS || process.env.ORCA_CODEX_ACCOUNTS || '')
      .toString()
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const add = (kind, sourceRoot, predicate, options = {}) => {
    const resolved = path.resolve(sourceRoot);
    if (!isWithin(root, resolved)) return;
    if (!fs.existsSync(resolved)) {
      if (options.reportMissing) omittedSources.push({ kind, path: resolved, status: 'UNAVAILABLE' });
      return;
    }
    try { fs.accessSync(resolved, fs.constants.R_OK); } catch (_error) {
      omittedSources.push({ kind, path: resolved, status: 'UNREADABLE' });
      return;
    }
    for (const file of walkFiles(resolved, predicate)) {
      sources.push({ kind, path: file, ...(options.metadata || {}) });
    }
  };
  const addOmitted = (kind, sourceRoot, predicate, status = 'UNSUPPORTED') => {
    const resolved = path.resolve(sourceRoot);
    if (!isWithin(root, resolved)) return;
    for (const file of walkFiles(resolved, predicate)) omittedSources.push({ kind, path: file, status });
  };
  const addAgents = (platform, sourceRoot) => {
    const resolved = path.resolve(sourceRoot);
    if (!isWithin(root, resolved)) return;
    const extensions = platform.includes('codex') ? ['.md', '.toml'] : ['.md'];
    for (const file of walkFiles(resolved, (candidate) => extensions.some((extension) => candidate.endsWith(extension)))) {
      const extension = path.extname(file).toLowerCase();
      installedAgents.push({
        name: path.basename(file, extension),
        platform,
        path: file,
      });
    }
  };
  const addInstalledPluginAgents = () => {
    const registry = readJson(path.join(root, '.claude', 'plugins', 'installed_plugins.json'));
    if (!registry || !registry.plugins || typeof registry.plugins !== 'object') return;
    for (const [pluginId, registrations] of Object.entries(registry.plugins)) {
      const entries = Array.isArray(registrations) ? registrations : [registrations];
      for (const registration of entries) {
        if (!registration || typeof registration.installPath !== 'string') continue;
        addAgents(`claude-plugin:${pluginId}`, path.join(registration.installPath, 'agents'));
      }
    }
  };

  add('claude-transcript', path.join(root, '.claude', 'projects'), isSessionFile, { reportMissing: true });
  add('claude-artifact', path.join(root, '.claude', 'artifacts'), (file) => file.endsWith('.jsonl') || file.endsWith('.log'), { reportMissing: true });
  addAgents('claude', path.join(root, '.claude', 'agents'));
  addAgents('codex', path.join(root, '.codex', 'agents'));
  addInstalledPluginAgents();
  add('codex-transcript', path.join(root, '.codex', 'sessions'), isSessionFile, { reportMissing: true });
  add('orca-trace', path.join(root, '.config', 'orca', 'logs'), isSessionFile, { reportMissing: true });
  add('orca-trace', path.join(root, '.orca', 'logs'), isSessionFile, { reportMissing: true });
  add('orca-transcript', path.join(root, '.config', 'orca', 'sessions'), isSessionFile, { reportMissing: true });
  add('orca-transcript', path.join(root, '.orca', 'sessions'), isSessionFile, { reportMissing: true });
  const configuredOrcaRoots = [
    path.join(root, '.config', 'orca', 'codex-accounts'),
    path.join(root, '.orca', 'codex-accounts'),
  ];
  for (const accountsRoot of configuredOrcaRoots) {
    if (!fs.existsSync(accountsRoot)) {
      for (const account of activeOrcaAccounts) {
        omittedSources.push({
          kind: 'orca-codex-session',
          path: path.join(accountsRoot, account, 'home', 'sessions'),
          status: 'UNAVAILABLE',
          reason: 'configured-active-account-missing',
          account: accountIdentifier(account),
        });
      }
      continue;
    }
    for (const account of activeOrcaAccounts) {
      const accountRoot = path.join(accountsRoot, account, 'home', 'sessions');
      const before = sources.length;
      add('orca-codex-session', accountRoot, isSessionFile, {
        reportMissing: false,
        metadata: { accountId: accountIdentifier(account) },
      });
      if (sources.length === before && !fs.existsSync(accountRoot)) {
        omittedSources.push({
          kind: 'orca-codex-session',
          path: accountRoot,
          status: 'UNAVAILABLE',
          reason: 'configured-active-account-missing',
          account: accountIdentifier(account),
        });
      }
    }
    if (activeOrcaAccounts.size === 0) {
      let entries = [];
      try { entries = fs.readdirSync(accountsRoot, { withFileTypes: true }); } catch (_error) { entries = []; }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        omittedSources.push({
          kind: 'orca-codex-session',
          path: path.join(accountsRoot, entry.name, 'home', 'sessions'),
          status: 'OMITTED',
          reason: 'active-account-not-selected',
          account: accountIdentifier(entry.name),
        });
      }
    }
  }
  addOmitted('codex-state', path.join(root, '.codex'), (file) => /\.(?:sqlite|sqlite-wal|db)$/i.test(file));
  addOmitted('orca-state', path.join(root, '.config', 'orca'), (file) => /(?:\.sqlite(?:-wal)?|\.db|orca-(?:claude|codex)-usage\.json|orca-stats\.json)$/i.test(file));

  const projectRoots = options.projectRoots || ['projects', 'workspaces', 'repos', 'src'];
  for (const relative of projectRoots) {
    const projectsRoot = path.join(root, relative);
    if (!fs.existsSync(projectsRoot)) continue;
    let entries;
    try { entries = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch (_error) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const project = path.join(projectsRoot, entry.name);
      add('project-codex-transcript', path.join(project, '.codex', 'sessions'), isSessionFile);
      add('project-claude-artifact', path.join(project, '.claude', 'artifacts'), (file) => file.endsWith('.jsonl') || file.endsWith('.log'));
      addAgents('project-claude', path.join(project, '.claude', 'agents'));
      addAgents('project-codex', path.join(project, '.codex', 'agents'));
    }
  }

  sources.sort((a, b) => a.path.localeCompare(b.path));
  installedAgents.sort((a, b) => `${a.platform}:${a.name}:${a.path}`.localeCompare(`${b.platform}:${b.name}:${b.path}`));
  return {
    schema: 'dhpk.session-usage-audit.discovery.v1',
    home: root,
    sources,
    installedAgents,
    omittedSources,
    activeOrcaAccounts: [...activeOrcaAccounts].map(accountIdentifier),
    sourceCoverageComplete: omittedSources.every((source) => !['UNAVAILABLE', 'UNREADABLE', 'UNSUPPORTED', 'OMITTED'].includes(source.status)),
  };
}

function nestedValue(record, keys) {
  for (const key of keys) {
    let value = record;
    for (const segment of key.split('.')) {
      if (!value || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = value[segment];
    }
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const magnitude = Math.abs(numeric);
    const milliseconds = magnitude >= 1e17
      ? numeric / 1e6
      : magnitude >= 1e14
        ? numeric / 1e3
        : magnitude >= 1e11
          ? numeric
          : numeric * 1e3;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
}

const DIAGNOSTIC_STATUS = {
  failure: /(?:timed? ?out|timeout|failed|exit code [1-9])/i,
  access: /(?:denied|not allowed|permission denied|access denied)/i,
  metadata: /(?:parse error|invalid|empty|rejected|failed)/i,
  drift: /(?:drift|stale|outdated|mismatch|different)/i,
  quality: /(?:pending|missing|incomplete|failed to clear)/i,
};

function normalizeDiagnosticLine(value, options = {}) {
  const line = redactText(value, options).replace(/\s+/g, ' ').trim();
  if (!line) return '';
  const component = line.match(/\b[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(?:sh|js|py|md)\b/i)?.[0] || '';
  const dhpk = line.match(/(?:CLAUDE_PLUGIN_ROOT|\/dhpk:[\w-]+|dhpk[-:][\w-]+)/i)?.[0] || '';
  const prefix = [dhpk, component].filter(Boolean).join(' ') || (/\bdhpk\b/i.test(line) ? 'dhpk' : '');
  const lower = line.toLowerCase();
  if (/(?:hook|sessionstart|posttooluse|subagentstop|stop[- ]advisory)/i.test(line) && DIAGNOSTIC_STATUS.failure.test(line)) {
    const status = lower.match(/timed? ?out|timeout|failed|exit code [1-9]/i)?.[0] || 'failed';
    return `${prefix || 'hook'} hook ${status}`.replace(/\s+/g, ' ').trim();
  }
  if (/(?:tool|command|bash)/i.test(line) && DIAGNOSTIC_STATUS.access.test(line)) {
    const status = lower.match(/permission denied|access denied|not allowed|denied/i)?.[0] || 'denied';
    return `${prefix || 'tool'} access ${status}`.replace(/\s+/g, ' ').trim();
  }
  if (/(?:frontmatter|yaml|metadata)/i.test(line) && DIAGNOSTIC_STATUS.metadata.test(line)) {
    const status = lower.match(/parse error|invalid|empty|rejected|failed/i)?.[0] || 'invalid';
    return `${prefix || 'metadata'} validation ${status}`.replace(/\s+/g, ' ').trim();
  }
  if (/(?:projection|receipt|installed version|content)/i.test(line) && DIAGNOSTIC_STATUS.drift.test(line)) {
    const status = lower.match(/drift|stale|outdated|mismatch|different/i)?.[0] || 'mismatch';
    return `${prefix || 'projection'} ${status}`.replace(/\s+/g, ' ').trim();
  }
  if (/(?:thin report|sentinel)/i.test(line) && DIAGNOSTIC_STATUS.quality.test(line)) {
    const status = lower.match(/pending|missing|incomplete|failed to clear/i)?.[0] || 'incomplete';
    return `${prefix || 'sentinel'} ${status}`.replace(/\s+/g, ' ').trim();
  }
  if (/\bdhpk\b|CLAUDE_PLUGIN_ROOT|\/dhpk:/i.test(line)) return prefix || 'dhpk reference';
  return '';
}

function collectDiagnosticSnippets(value, snippets = [], depth = 0, options = {}) {
  if (depth > 5 || snippets.length >= 40 || value === undefined || value === null) return snippets;
  if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) {
      const normalized = normalizeDiagnosticLine(line, options).slice(0, 180);
      if (normalized && !snippets.includes(normalized)) snippets.push(normalized);
      if (snippets.length >= 40) return snippets;
    }
    return snippets;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDiagnosticSnippets(item, snippets, depth + 1, options);
    return snippets;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:prompt|input|customer|cwd|project|path|file|worktree|worktreePath)$/i.test(key)) continue;
      collectDiagnosticSnippets(item, snippets, depth + 1, options);
    }
  }
  return snippets;
}

function extractRecordText(record, options = {}) {
  const selected = {};
  for (const key of ['type', 'subtype']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'number') selected[key] = safeRecordType(record[key]);
  }
  for (const key of ['agent', 'agent_name', 'subagent_type']) {
    if (typeof record[key] === 'string' || typeof record[key] === 'number') selected[key] = safeAgent(record[key], options);
  }
  const diagnostics = [];
  for (const key of ['message', 'attachment', 'content', 'stdout', 'stderr', 'command', 'error', 'attributes', 'events', 'exit', 'meta']) {
    if (record[key] !== undefined) collectDiagnosticSnippets(record[key], diagnostics, 0, options);
  }
  return JSON.stringify({ ...selected, diagnostics: diagnostics.join(' ') }).slice(0, 12000);
}

function evidenceForText(text) {
  const evidence = [];
  const nonPathText = String(text || '').replace(/"(?:cwd|project|path|file|worktree|worktreePath)"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"/gi, '');
  if (/CLAUDE_PLUGIN_ROOT|\/dhpk:[\w-]+|scripts\/hooks\/|dhpk[-:][\w-]+/i.test(text)) {
    evidence.push('dhpk-runtime-or-invocation');
    return { level: 'strong', evidence };
  }
  if (/\bdhpk\b/i.test(nonPathText)) {
    evidence.push('dhpk-text-reference');
    return { level: 'weak', evidence };
  }
  return { level: 'none', evidence };
}

function forEachLine(file, callback) {
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let stopped = false;
  try {
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      carry += decoder.write(buffer.subarray(0, bytes));
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        if (callback(line) === false) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      if (carry.length > 2 * 1024 * 1024) {
        if (callback(carry.slice(0, 2 * 1024 * 1024)) === false) stopped = true;
        carry = '';
      }
      if (stopped) break;
    } while (bytes > 0);
    if (!stopped) {
      carry += decoder.end();
      if (carry) stopped = callback(carry) === false;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return stopped;
}

function scanJsonlFile(file, options = {}) {
  const dateRange = options.dateRange || { from: '', to: '' };
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  const home = options.home || process.env.HOME || '';
  const maxBytes = options.maxBytes || 512 * 1024 * 1024;
  const records = [];
  const stats = {
    lines: 0,
    matched: 0,
    dhpkMatched: 0,
    nonDhpk: 0,
    limitReached: false,
    malformed: 0,
    missingTimestamp: 0,
    skippedDate: 0,
    unsupported: 0,
    typedFailures: 0,
    bytes: 0,
    partial: false,
  };
  try {
    const size = fs.statSync(file).size;
    stats.bytes = size;
    if (size > maxBytes) {
      stats.partial = true;
      return { schema: 'dhpk.session-usage-audit.scan.v1', file, records, stats };
    }
  } catch (_error) {
    stats.partial = true;
    return { schema: 'dhpk.session-usage-audit.scan.v1', file, records, stats };
  }
  try {
    forEachLine(file, (line) => {
      if (Number.isSafeInteger(options.maxRecords) && records.length >= options.maxRecords) {
        stats.limitReached = true;
        stats.partial = true;
        return false;
      }
      if (!line) return;
      stats.lines += 1;
      let record;
      try { record = JSON.parse(line); } catch (_error) { stats.malformed += 1; return; }
      const timestamp = nestedValue(record, [
        'timestamp', 'created_at', 'createdAt', 'ts', 'startTimeUnixNano', 'at',
      ]);
      const parsedDate = parseTimestamp(timestamp);
      if (!parsedDate) {
        stats.missingTimestamp += 1;
        return;
      }
      const localDate = dateKey(parsedDate, timeZone);
      if (dateRange.from && (localDate < dateRange.from || localDate > dateRange.to)) {
        stats.skippedDate += 1;
        return;
      }
      const normalized = normalizeRuntimeRecord(record, { sourceKind: options.sourceKind });
      if (!isSupportedRecordType(normalized.recordType)) stats.unsupported += 1;
      if (normalized.typedFailure) stats.typedFailures += 1;
      const rawText = extractRecordText(record, { home, knownAgents: options.knownAgents });
      const text = redactText(rawText, { home });
      const evidence = evidenceForText(text);
      const rawAgent = nestedValue(record, [
        'agent', 'agent_name', 'agentName', 'subagent_type', 'subagentType',
        'attributes.agent', 'meta.agent',
      ]) || '';
      if (options.agents && options.agents.length > 0 && !options.agents.includes(rawAgent)) return;
      stats.matched += 1;
      if (evidence.level === 'none') {
        stats.nonDhpk += 1;
        return;
      }
      const rawPackageVersion = nestedValue(record, [
        'packageVersion', 'package_version', 'pluginVersion', 'plugin_version', 'dhpkVersion', 'dhpk_version',
        'metadata.packageVersion', 'meta.packageVersion', 'attributes.packageVersion',
      ]);
      const recordPackageVersion = safePackageVersion(rawPackageVersion);
      const inferredPackageVersion = safePackageVersion(options.packageVersion);
      records.push({
        source: options.sourceKind || 'unknown',
        file,
        line: stats.lines,
        sessionId: normalized.sessionId || `unknown:${stats.lines}`,
        parentSessionId: normalized.parentSessionId,
        eventId: normalized.eventId,
        taskId: normalized.taskId,
        role: safeAgent(normalized.role, { knownAgents: options.knownAgents }),
        timestamp: parsedDate.toISOString(),
        localDate,
        cwd: redactText(nestedValue(record, ['cwd', 'project', 'attributes.cwd', 'meta.cwd']), { home }),
        agent: safeAgent(rawAgent, { knownAgents: options.knownAgents }),
        text,
        dhpkEvidenceLevel: evidence.level,
        dhpkEvidence: evidence.evidence,
        recordType: safeRecordType(normalized.recordType || nestedValue(record, ['type', 'subtype'])),
        exitStatus: normalized.exitStatus,
        structuredErrorStatus: normalized.structuredErrorStatus,
        typedFailure: normalized.typedFailure,
        typedFailureKind: normalized.typedFailureKind,
        contextEvidence: normalized.contextEvidence,
        packageVersion: recordPackageVersion || inferredPackageVersion || '',
        packageVersionSource: recordPackageVersion
          ? 'record'
          : (rawPackageVersion ? 'unknown' : (inferredPackageVersion ? 'current-install-inferred' : 'unknown')),
      });
      stats.dhpkMatched += 1;
    });
  } catch (_error) {
    stats.partial = true;
  }
  return { schema: 'dhpk.session-usage-audit.scan.v1', file, records, stats };
}

const FINDING_RULES = [
  { category: 'hook-failure', pattern: /(?:hook|sessionstart|posttooluse|subagentstop|stop[- ]advisory)[^\n]{0,160}(?:timed? ?out|timeout|failed|exit code [1-9])/i },
  { category: 'tool-access', pattern: /(?:tool|command|bash)[^\n]{0,100}(?:denied|not allowed|permission denied|access denied)/i },
  { category: 'metadata-validation', pattern: /(?:frontmatter|yaml|metadata)[^\n]{0,120}(?:parse error|invalid|empty|rejected|failed)/i },
  { category: 'projection-drift', pattern: /(?:projection|receipt|installed version|content)[^\n]{0,100}(?:drift|stale|outdated|mismatch|different)/i },
  { category: 'agent-quality', pattern: /(?:thin report|sentinel)[^\n]{0,100}(?:pending|missing|incomplete|failed to clear)/i },
];

function findingMatch(text) {
  for (const rule of FINDING_RULES) {
    const match = String(text || '').match(rule.pattern);
    if (match) return { category: rule.category, message: match[0] };
  }
  return null;
}

function findingComponent(message, category) {
  const script = String(message || '').match(/([A-Za-z0-9_.-]+\.(?:sh|js|py|md))/);
  return script ? script[1] : category;
}

const FINDING_ASSERTIONS = {
  'hook-failure': {
    reproduction: { type: 'hook-failure-observed', required: true },
    consumerGate: { type: 'hook-failure-remediated', required: true },
  },
  'tool-access': {
    reproduction: { type: 'tool-access-denied', required: true },
    consumerGate: { type: 'tool-access-allowed', required: true },
  },
  'metadata-validation': {
    reproduction: { type: 'metadata-rejection-observed', required: true },
    consumerGate: { type: 'metadata-valid', required: true },
  },
  'projection-drift': {
    reproduction: { type: 'projection-drift-observed', required: true },
    consumerGate: { type: 'projection-reconciled', required: true },
  },
  'agent-quality': {
    reproduction: { type: 'agent-quality-observed', required: true },
    consumerGate: { type: 'review-artifact-ready', required: true },
  },
};

function detectFindings(records = []) {
  const groups = new Map();
  for (const record of records) {
    if (!record || record.dhpkEvidenceLevel === 'none') continue;
    const match = findingMatch(record.text);
    if (!match) continue;
    const normalized = normalizeRuntimeRecord(record, { sourceKind: record.source || record.sourceKind });
    const explicitlyTyped = Boolean(record.recordType || record.typedFailure !== undefined || record.exitStatus !== undefined || record.structuredErrorStatus);
    const typedFailure = record.typedFailure === true || normalized.typedFailure === true;
    const successRecord = SUCCESS_RECORD_TYPES.has(normalizeRecordType(record.recordType || normalized.recordType));
    const contextRecord = CONTEXT_RECORD_TYPES.has(normalizeRecordType(record.recordType || normalized.recordType));
    const ambiguous = !typedFailure || successRecord || contextRecord;
    if (successRecord || contextRecord) continue;
    const message = match.message.replace(/\d+(?:\.\d+)?/g, '<n>').replace(/\s+/g, ' ').trim();
    const component = findingComponent(message, match.category);
    const versionSource = record.packageVersionSource || (record.packageVersion ? 'record' : 'unknown');
    const version = versionSource === 'record' ? (record.packageVersion || '') : '';
    const displayVersion = record.packageVersion || '';
    const fingerprint = fingerprintFinding({ category: match.category, component, message, version });
    let group = groups.get(fingerprint);
    if (!group) {
      group = {
        fingerprint,
        version: displayVersion,
        versionSource,
        category: match.category,
        component,
        title: `${match.category}: ${component}`,
        message,
        status: ambiguous && explicitlyTyped ? 'unverified' : 'candidate',
        confidence: 0,
        occurrences: 0,
        independentSessions: 0,
        sessionKeys: new Set(),
        inferredVersions: new Set(),
        inferredSurfaces: new Set(),
        evidence: [],
        reproductionAssertion: FINDING_ASSERTIONS[match.category]?.reproduction || null,
        consumerGateAssertion: FINDING_ASSERTIONS[match.category]?.consumerGate || null,
        identityKeys: new Set(),
      };
      groups.set(fingerprint, group);
    }
    const stableIdentity = normalized.eventId || normalized.taskId || (
      normalized.sessionId ? `${normalized.sourceKind}|${normalized.sessionId}` : ''
    );
    const identityKey = stableIdentity || `${record.source || 'unknown'}|${record.file || ''}|${record.line || group.occurrences + 1}`;
    const duplicateIdentity = group.identityKeys.has(identityKey);
    if (!duplicateIdentity) {
      group.identityKeys.add(identityKey);
      group.occurrences += 1;
    }
    if (versionSource === 'current-install-inferred') {
      group.inferredVersions.add(displayVersion || 'unknown');
      group.inferredSurfaces.add(record.source || 'unknown');
    }
    const sessionKey = `${record.source || 'unknown'}|${record.sessionId || normalized.sessionId || `line:${record.line || group.occurrences}`}`;
    if (!group.sessionKeys.has(sessionKey)) {
      group.sessionKeys.add(sessionKey);
      group.independentSessions += 1;
    }
    const baseConfidence = record.dhpkEvidenceLevel === 'strong' ? 0.72 : 0.52;
    group.confidence = Math.min(0.95, baseConfidence + Math.max(0, group.independentSessions - 1) * 0.1);
    if (versionSource === 'record') group.versionSource = 'record';
    group.evidence.push({
      source: record.source,
      file: record.file,
      line: record.line,
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      agent: record.agent,
      recordType: normalized.recordType,
      eventId: normalized.eventId,
      taskId: normalized.taskId,
      parentSessionId: normalized.parentSessionId,
      typedFailure: normalized.typedFailure,
      excerpt: redactText(record.text).slice(0, 500),
    });
  }
  return [...groups.values()]
    .map((group) => {
      const { sessionKeys, inferredVersions, inferredSurfaces, identityKeys, ...publicGroup } = group;
      const inferredVersionList = [...inferredVersions].sort();
      const inferredSurfaceList = [...inferredSurfaces].sort();
      if (publicGroup.versionSource === 'current-install-inferred' && inferredVersionList.length > 1) {
        publicGroup.version = '';
        publicGroup.versionSource = 'mixed-current-install-inferred';
      }
      return {
        ...publicGroup,
        inferredVersions: inferredVersionList,
        inferredSurfaces: inferredSurfaceList,
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
}

function buildIssueDraft(finding, context = {}) {
  const repository = context.repository || 'hmj1026/dhpk';
  const version = finding.versionSource === 'unknown'
    ? 'unknown'
    : finding.version
    ? `${finding.version}${finding.versionSource === 'current-install-inferred' ? ' (current-install-inferred)' : ''}`
    : context.version
      ? `${finding.versionSource === 'mixed-current-install-inferred' ? 'mixed current-install-inferred' : context.version}${finding.versionSource === 'current-install-inferred' ? ' (current-install-inferred)' : ''}`
      : 'unknown';
  const title = `[session-audit] ${finding.category}: ${finding.component}`;
  const evidence = (finding.evidence || []).map((item) => {
    const file = redactText(item.file || '', { home: context.home });
    return `- ${file}:${item.line || '?'} (session ${item.sessionId || 'unknown'}, agent ${item.agent || 'unknown'})`;
  }).join('\n');
  const body = [
    '## Summary',
    `- Repository: ${repository}`,
    `- dhpk version: ${version}`,
    `- Category: ${finding.category}`,
    `- Fingerprint: ${finding.fingerprint}`,
    `- Confidence: ${Number(finding.confidence || 0).toFixed(2)}`,
    `- Occurrences: ${finding.occurrences || 0}`,
    '',
    '## Observed behavior',
    redactText(finding.message || '', { home: context.home }),
    '',
    '## Evidence',
    evidence || '- No evidence recorded',
    '',
    '## Expected behavior',
    'The dhpk consumer path should complete without this package-specific failure.',
    '',
    '## Verification',
    `Status: ${finding.status || 'candidate'}`,
    `Reproduction: ${finding.verification?.reproduction?.status || 'missing'} — ${redactText(finding.verification?.reproduction?.command || 'not recorded', { home: context.home })}`,
    `Consumer gate: ${finding.verification?.consumerGate?.status || 'missing'} — ${redactText(finding.verification?.consumerGate?.command || 'not recorded', { home: context.home })}`,
  ].join('\n');
  const confirmationDigest = `sha256:${crypto.createHash('sha256').update(`${title}\n\n${body}`, 'utf8').digest('hex')}`;
  return { title, body, repository, fingerprint: finding.fingerprint, confirmationDigest };
}

function evaluateIssueGate({ finding, duplicate = false, ghAuth = false, confirmed = false, confirmationDigest = '', expectedDigest = '' } = {}) {
  const reasons = [];
  if (!finding || finding.status !== 'verified') reasons.push('finding-not-verified');
  if (!finding || Number(finding.confidence || 0) < 0.8) reasons.push('confidence-below-0.80');
  if (duplicate) reasons.push('duplicate-issue');
  if (!ghAuth) reasons.push('github-auth-unavailable');
  if (!confirmed) reasons.push('human-confirmation-required');
  if (expectedDigest && confirmationDigest !== expectedDigest) reasons.push('confirmation-digest-mismatch');
  return { allowed: reasons.length === 0, reasons };
}

function redactValue(value, home, depth = 0, additionalRoots = []) {
  if (depth > 5) return '<TRUNCATED>';
  if (typeof value === 'string') {
    let text = redactText(value, { home });
    for (const [root, marker] of additionalRoots) {
      if (!root) continue;
      const escapedRoot = String(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escapedRoot, 'g'), marker);
    }
    return text.slice(0, 4000);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, home, depth + 1, additionalRoots));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? '<REDACTED>'
        : key === 'argv'
          ? (Array.isArray(item) ? item.slice(0, 32).map((argument, index) => safeVerificationArgument(argument, index, home)) : '<REDACTED>')
        : key === 'sessionId' || key === 'session_id' || key === 'runId' || key === 'run_id'
          ? redactIdentifier(item, 'session')
          : key === 'agent' || key === 'agent_name' || key === 'agentName' || key === 'subagent_type'
            ? safeAgent(item)
            : redactValue(item, home, depth + 1, additionalRoots),
    ]));
  }
  return value;
}

function verifyFinding(finding, verification = {}, options = {}) {
  const reproduction = verification.reproduction || { status: 'missing' };
  const consumerGate = verification.consumerGate || { status: 'missing' };
  const reproductionArgv = reproduction.execution?.argv || reproduction.argv;
  const consumerArgv = consumerGate.execution?.argv || consumerGate.argv;
  const reproductionCommand = formatVerificationCommand(reproductionArgv, reproduction.command);
  const consumerCommand = formatVerificationCommand(consumerArgv, consumerGate.command);
  const trusted = reproduction.execution?.trusted === true && consumerGate.execution?.trusted === true;
  const distinctCommands = canonicalArgv(reproductionArgv) && canonicalArgv(consumerArgv)
    && canonicalArgv(reproductionArgv) !== canonicalArgv(consumerArgv);
  const isGenericVerification = (entry) => {
    const argv = entry?.execution?.argv || entry?.argv || [];
    const command = argv.map((value) => String(value)).join(' ').toLowerCase();
    return argv.length === 0
      || /(?:--help|\bhelp\b|\bdate\b|\bscan\b|\bstatus\b|\bversion\b)/i.test(command)
      ;
  };
  const requiresBoundAssertions = Boolean(
    finding?.reproductionAssertion
      || finding?.consumerGateAssertion
      || verification.fingerprint
      || options.requireBoundAssertions,
  );
  const fingerprintMatches = !verification.fingerprint || !finding?.fingerprint || verification.fingerprint === finding.fingerprint;
  const reproductionAssertion = isGenericVerification(reproduction)
    ? false
    : (requiresBoundAssertions ? (reproduction.assertion?.observed === true && reproduction.assertion.type) : true);
  const consumerAssertion = isGenericVerification(consumerGate)
    ? false
    : (requiresBoundAssertions ? (consumerGate.assertion?.observed === true && consumerGate.assertion.type) : true);
  const passed = trusted
    && reproduction.status === 'pass'
    && consumerGate.status === 'pass'
    && reproductionCommand
    && consumerCommand
    && distinctCommands
    && fingerprintMatches
    && !isGenericVerification(reproduction)
    && !isGenericVerification(consumerGate)
    && reproductionAssertion
    && consumerAssertion;
  return {
    ...finding,
    status: passed ? 'verified' : 'needs-verification',
    verification: {
      reproduction: redactValue(reproduction, options.home || ''),
      consumerGate: redactValue(consumerGate, options.home || ''),
      trusted,
      assertions: {
        reproduction: Boolean(reproductionAssertion),
        consumerGate: Boolean(consumerAssertion),
        fingerprint: Boolean(fingerprintMatches),
      },
    },
  };
}

const VERIFICATION_GRAMMAR = {
  node: { script: /\.(?:c|m)?js$/i },
  php: { script: /\.php$/i },
};
const INLINE_EVAL_ARG = /^(?:-e(?:$|[^-])|-p(?:$|[^-])|-r(?:$|[^-])|--(?:command|eval|execute|exec|import|loader|print|require|run)(?:=|$)|--shell(?:=|$))/i;
const SCRIPT_PATH_ARG = /\.(?:c|m)?js$|\.php$/i;
const VERIFICATION_ENV_KEYS = new Set([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TZ', 'CI', 'NO_COLOR', 'TERM',
  'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR',
]);

function verificationEnvironment(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => (
      (VERIFICATION_ENV_KEYS.has(key) || /^LC_[A-Z0-9_]+$/.test(key))
      && typeof value === 'string'
      && !value.includes('\0')
    ))
    .map(([key, value]) => [key, value]));
}

function verificationCwd(options = {}) {
  return realPathOrResolve(options.cwd || process.cwd());
}

function verificationScriptPaths(argv, cwd = verificationCwd()) {
  if (!Array.isArray(argv) || argv.length < 2 || !argv.every((item) => typeof item === 'string')) return [];
  const grammar = VERIFICATION_GRAMMAR[argv[0].toLowerCase()];
  if (!grammar?.script) return [];
  const pathArgs = [argv[1], ...argv.slice(2).filter((item) => SCRIPT_PATH_ARG.test(item))];
  return pathArgs.map((value) => realPathOrResolve(path.isAbsolute(value) ? value : path.join(cwd, value)));
}

function verificationFileDigest(file) {
  try {
    if (!fs.statSync(file).isFile()) return '';
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch (_error) {
    return '';
  }
}

function bindVerificationArgv(argv, cwd = verificationCwd()) {
  if (!Array.isArray(argv) || argv.length < 2 || !argv.every((item) => typeof item === 'string')) return argv;
  const grammar = VERIFICATION_GRAMMAR[argv[0].toLowerCase()];
  if (!grammar?.script) return argv;
  const script = path.isAbsolute(argv[1]) ? argv[1] : path.join(cwd, argv[1]);
  return [argv[0], realPathOrResolve(script), ...argv.slice(2)];
}

function canonicalArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((item) => typeof item === 'string')) return '';
  return JSON.stringify(argv);
}

function safeVerificationArgument(value, index, home = '') {
  const text = String(value == null ? '' : value);
  if (index === 0 || isPathLikeVerificationArg(text)) return redactText(text, { home });
  if (/^--[A-Za-z0-9][A-Za-z0-9-]*$/.test(text) || /^-[A-Za-z]$/.test(text)) return text;
  if (/^--[A-Za-z0-9][A-Za-z0-9-]*=/.test(text)) return `${text.slice(0, text.indexOf('='))}=<ARG_REDACTED>`;
  return '<ARG_REDACTED>';
}

function formatVerificationCommand(argv, fallback = '', options = {}) {
  if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) {
    return argv.map((item, index) => {
      const safe = safeVerificationArgument(item, index, options.home || '');
      return /^[A-Za-z0-9_./:=+<>-]+$/.test(safe) ? safe : JSON.stringify(safe);
    }).join(' ');
  }
  return typeof fallback === 'string' ? fallback.trim() : '';
}

function resolveExecutablePath(executable, env = process.env) {
  if (typeof executable !== 'string' || !executable || executable.includes('/') || executable.includes('\\')) return '';
  const pathValue = (env && env.PATH) || process.env.PATH || '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, executable);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return fs.realpathSync(candidate);
    } catch (_error) { /* try the next PATH entry */ }
  }
  return '';
}

function verificationPayload(entries, options = {}) {
  const environment = verificationEnvironment(options.env || process.env);
  const cwd = verificationCwd(options);
  const checkPayload = (check) => {
    const argv = Array.isArray(check?.argv) ? check.argv : null;
    const scripts = verificationScriptPaths(argv, cwd).map((file) => ({
      path: file,
      digest: verificationFileDigest(file),
    }));
    return {
      argv,
      executablePath: argv && argv.length > 0 ? resolveExecutablePath(argv[0], environment) : '',
      cwd,
      scripts,
    };
  };
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      fingerprint: String(entry?.fingerprint || ''),
      reproduction: checkPayload(entry?.reproduction),
      consumerGate: checkPayload(entry?.consumerGate),
      environment,
    }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

function verificationDigest(entries, options = {}) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(verificationPayload(entries, options)), 'utf8').digest('hex')}`;
}

function isPathLikeVerificationArg(value) {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || /\.(?:c|m)?js$|\.(?:json|jsonl|ndjson|php|sh)$/i.test(value);
}

function verificationArgvError(argv, options = {}) {
  if (!canonicalArgv(argv)) return 'verification argv must be a non-empty string array';
  if (argv.length > 32 || argv.some((item) => item.length > 512 || item.includes('\0'))) return 'verification argv is too large or contains a NUL byte';
  const executable = argv[0];
  const command = executable.toLowerCase();
  const grammar = VERIFICATION_GRAMMAR[command];
  if (!grammar || executable.includes('/') || executable.includes('\\')) return `verification executable is not allowlisted: ${executable}`;
  if (argv.slice(1).some((item) => INLINE_EVAL_ARG.test(item))) return 'verification shell or interpreter evaluation flags are forbidden';
  if (grammar.exact && (argv.length !== 2 || !grammar.exact.has(argv[1]))) return `${command} verification only permits its version command`;
  if (grammar.script) {
    if (argv.length < 2 || argv[1].startsWith('-') || !grammar.script.test(argv[1])) return `${command} verification requires an explicit script path`;
  }
  const executablePath = resolveExecutablePath(executable, verificationEnvironment(options.env || process.env));
  if (!executablePath) return `verification executable was not found: ${executable}`;
  const cwd = verificationCwd(options);
  const currentHome = realPathOrResolve(process.env.HOME || '');
  if (!isWithin(currentHome, cwd) && !fixtureHomeAllowed(cwd)) return 'verification cwd must stay inside the current user home';
  const roots = [cwd, realPathOrResolve(options.home || currentHome), realPathOrResolve(options.pluginRoot || '')]
    .filter((root) => root && root !== path.parse(root).root);
  const pathArgs = grammar.script ? [argv[1], ...argv.slice(2).filter((item) => SCRIPT_PATH_ARG.test(item))] : argv.slice(1).filter(isPathLikeVerificationArg);
  for (const arg of pathArgs) {
    const candidate = realPathOrResolve(path.isAbsolute(arg) ? arg : path.join(cwd, arg));
    if (!roots.some((root) => isWithin(root, candidate))) return 'verification script path is outside the bounded roots';
    try { assertNoSymlinkComponents(candidate); } catch (_error) { return 'verification script path contains a symlink'; }
  }
  return '';
}

function executeVerificationCheck(check = {}, options = {}) {
  const argv = Array.isArray(check.argv) && check.argv.length > 0 && check.argv.every((item) => typeof item === 'string')
    ? check.argv
    : null;
  if (!argv) {
    return {
      assertion: check.assertion,
      status: 'fail',
      command: 'missing argv',
      execution: { trusted: false, reason: 'verification argv must be an explicit string array' },
    };
  }
  const environment = verificationEnvironment(options.env || process.env);
  const error = verificationArgvError(argv, { ...options, env: environment });
  if (error) {
    return {
      assertion: check.assertion,
      status: 'fail',
      command: formatVerificationCommand(argv, '', { home: options.home }),
      execution: { trusted: false, argv, reason: error },
    };
  }
  const cwd = verificationCwd(options);
  const executionArgv = bindVerificationArgv(argv, cwd);
  const executablePath = resolveExecutablePath(executionArgv[0], environment);
  const result = spawnSync(executablePath, executionArgv.slice(1), {
    cwd,
    env: environment,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 120000,
  });
  const exitCode = result.status === null ? 124 : result.status;
  return {
    assertion: check.assertion,
    status: exitCode === 0 ? 'pass' : 'fail',
    command: formatVerificationCommand(executionArgv, '', { home: options.home }),
    execution: {
      trusted: options.digestVerified === true,
      argv: executionArgv,
      executablePath,
      exitCode,
      stdout: collectDiagnosticSnippets(result.stdout || '', [], 0, { home: options.home }).join(' ').slice(0, 1000),
      stderr: collectDiagnosticSnippets(result.stderr || (result.error && result.error.message) || '', [], 0, { home: options.home }).join(' ').slice(0, 1000),
    },
  };
}

function executeVerificationEntries(entries, options = {}) {
  const digestMatches = () => !options.expectedVerificationDigest
    || options.expectedVerificationDigest === verificationDigest(entries, options);
  const digestMismatch = () => ({
    status: 'fail',
    command: 'verification digest mismatch',
    execution: { trusted: false, reason: 'verification-digest-mismatch' },
  });
  const results = [];
  for (const entry of entries) {
    if (!digestMatches()) {
      results.push({ ...entry, reproduction: digestMismatch(), consumerGate: digestMismatch() });
      continue;
    }
    const reproduction = executeVerificationCheck(entry.reproduction, options);
    if (!digestMatches()) {
      results.push({ ...entry, reproduction, consumerGate: digestMismatch() });
      continue;
    }
    results.push({
      ...entry,
      reproduction,
      consumerGate: executeVerificationCheck(entry.consumerGate, options),
    });
  }
  return results;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function inferPluginRoot() {
  const candidate = path.resolve(__dirname, '..', '..', '..');
  return fs.existsSync(path.join(candidate, '.claude-plugin', 'plugin.json')) ? candidate : '';
}

function findDhpkEntries(value, output = [], keyHint = '') {
  if (!value || typeof value !== 'object') return output;
  if (!Array.isArray(value)) {
    const id = value.id || value.plugin || value.name || keyHint || '';
    const version = value.version || value.pluginVersion || value.installedVersion || '';
    if (String(id).toLowerCase().includes('dhpk') && version) {
      output.push({
        id: String(id),
        version: String(version),
        scope: value.scope,
        installPath: value.installPath,
        projectPath: value.projectPath,
      });
    }
  }
  if (Array.isArray(value)) {
    for (const child of value) findDhpkEntries(child, output, keyHint);
  } else {
    for (const [key, child] of Object.entries(value)) {
      findDhpkEntries(child, output, key.toLowerCase().includes('dhpk') ? key : '');
    }
  }
  return output;
}

function collectInstallEvidence(home, options = {}) {
  const root = path.resolve(home || process.env.HOME || '.');
  const entries = [];
  const claudeRegistry = path.join(root, '.claude', 'plugins', 'installed_plugins.json');
  const installed = readJson(claudeRegistry);
  for (const item of findDhpkEntries(installed)) {
    const version = installationVersion(item.version);
    entries.push({
      surface: 'claude',
      path: claudeRegistry,
      id: item.id,
      ...version,
      scope: item.scope,
      installPath: item.installPath,
      projectPath: item.projectPath,
    });
  }
  const candidateProjects = [];
  for (const relative of options.projectRoots || ['projects', 'workspaces', 'repos', 'src']) {
    const parent = path.join(root, relative);
    if (!fs.existsSync(parent)) continue;
    try {
      for (const item of fs.readdirSync(parent, { withFileTypes: true })) {
        if (item.isDirectory() && !item.isSymbolicLink()) candidateProjects.push(path.join(parent, item.name));
      }
    } catch (_error) { /* inaccessible project root is reported by missing evidence */ }
  }
  candidateProjects.push(root);
  for (const project of candidateProjects) {
    const receipt = path.join(project, '.codex', '.dhpk-installed.json');
    const value = readJson(receipt);
    if (value && value.version) {
      const version = installationVersion(value.version);
      entries.push({
        surface: 'codex-project',
        path: receipt,
        ...version,
        mode: value.mode || 'unknown',
        entries: Number.isFinite(value.entries) ? value.entries : undefined,
      });
    }
  }
  if (options.pluginRoot) {
    const manifestPath = path.join(path.resolve(options.pluginRoot), '.claude-plugin', 'plugin.json');
    const manifest = readJson(manifestPath);
    if (manifest && manifest.version) entries.push({ surface: 'source', path: manifestPath, ...installationVersion(manifest.version), id: manifest.name || 'dhpk' });
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.surface}|${entry.path}|${entry.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => `${a.surface}:${a.path}`.localeCompare(`${b.surface}:${b.path}`));
}

function publicRecord(record, home, knownAgents) {
  return {
    ...record,
    file: redactSourcePath(record.file, home),
    cwd: redactText(record.cwd, { home }),
    sessionId: redactIdentifier(record.sessionId, 'session'),
    agent: safeAgent(record.agent, { knownAgents }),
  };
}

function publicFinding(finding, home, knownAgents) {
  return {
    ...finding,
    evidence: (finding.evidence || []).map((item) => ({
      ...item,
      file: redactSourcePath(item.file, home),
      excerpt: redactText(item.excerpt, { home }),
      sessionId: redactIdentifier(item.sessionId, 'session'),
      agent: safeAgent(item.agent, { knownAgents }),
    })),
  };
}

function renderReportMarkdown(report) {
  const lines = [
    '# dhpk Session Usage Audit',
    '',
    `- Date: ${report.args.dateRange.from} → ${report.args.dateRange.to}`,
    `- Sources: ${report.stats.scannedSources}/${report.stats.sources}`,
    `- Records: ${report.stats.records}`,
    `- Findings: ${report.findings.length}`,
    `- Partial: ${report.stats.partial ? 'yes' : 'no'}`,
    `- Scan complete: ${report.coverage.scanComplete ? 'yes' : 'no'}`,
    `- Source coverage complete: ${report.coverage.sourceCoverageComplete ? 'yes' : 'no'}`,
    `- Malformed / unsupported: ${report.coverage.malformedCount} / ${report.coverage.unsupportedCount}`,
    '',
    '## Install Evidence',
  ];
  if (report.installations.length === 0) lines.push('- No dhpk installation evidence found.');
  else for (const item of report.installations) lines.push(`- ${item.surface}: ${item.version} (${item.path})`);
  lines.push('', '## Findings');
  if (report.findings.length === 0) lines.push('- No dhpk-specific candidates found.');
  else for (const finding of report.findings) {
    lines.push(`### ${finding.category}: ${finding.component}`);
    lines.push(`- Status: ${finding.status}; confidence: ${Number(finding.confidence).toFixed(2)}; occurrences: ${finding.occurrences}`);
    lines.push(`- Fingerprint: ${finding.fingerprint}`);
    lines.push(`- ${finding.message}`);
  }
  lines.push('', '## Coverage',
    `- Installed agent rows: ${report.coverage.installationRows ?? report.coverage.installedAgents.length}`,
    `- Unique role identities: ${report.coverage.uniqueRoleIdentities ?? 0}`,
    `- Cache/version duplicates: ${report.coverage.cacheVersionDuplicates ?? 0}`,
    `- Excluded index rows: ${report.coverage.excludedIndexRowCount ?? (report.coverage.excludedIndexRows || []).length}`,
    `- Unsupported/omitted sources: ${report.coverage.omittedSources.length}`);
  return `${lines.join('\n')}\n`;
}

function assertNoSymlinkComponents(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink output path: ${current}`);
  }
}

function ensurePrivateDirectory(target) {
  const resolved = path.resolve(target);
  assertNoSymlinkComponents(resolved);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(resolved);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error(`output path is not a directory: ${resolved}`);
  fs.chmodSync(resolved, 0o700);
  return resolved;
}

function writePrivateFile(file, content) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(file, flags, 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  fs.chmodSync(file, 0o600);
}

function writeReport(report, output) {
  const target = ensurePrivateDirectory(output);
  const files = {
    'report.json': `${JSON.stringify(report, null, 2)}\n`,
    'findings.json': `${JSON.stringify(report.findings, null, 2)}\n`,
    'issue-drafts.json': `${JSON.stringify(report.issueDrafts, null, 2)}\n`,
    'issue-results.json': `${JSON.stringify(report.issueResults, null, 2)}\n`,
    'sessions.jsonl': report.records.map((record) => JSON.stringify(record)).join('\n') + (report.records.length ? '\n' : ''),
    'report.md': renderReportMarkdown(report),
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(target, name);
    assertNoSymlinkComponents(file);
    writePrivateFile(file, content);
  }
  return target;
}

function runAudit(options = {}) {
  const parsed = parseArgs(options.argv || [], {
    now: options.now,
    timeZone: options.timeZone,
    home: options.home,
    output: options.output,
    repo: options.repo,
    testFixtureHome: options.testFixtureHome,
  });
  const currentHome = realPathOrResolve(process.env.HOME || '');
  const localPathAllowed = (candidate) => isWithin(currentHome, candidate)
    || (parsed.testFixtureHome && fixtureHomeAllowed(candidate));
  const resolveLocalInput = (candidate, label) => {
    if (!candidate) return '';
    const resolved = realPathOrResolve(candidate);
    if (!localPathAllowed(resolved)) throw new Error(`--${label} must stay inside the current user home`);
    assertNoSymlinkComponents(resolved);
    return resolved;
  };
  parsed.output = resolveLocalInput(parsed.output, 'output');
  parsed.verificationFile = resolveLocalInput(parsed.verificationFile, 'verification-file');
  parsed.pluginRoot = resolveLocalInput(parsed.pluginRoot, 'plugin-root');
  const discovery = discoverSources(parsed.home, options);
  const knownAgents = new Set([
    ...DEFAULT_KNOWN_AGENTS,
    ...discovery.installedAgents.map((agent) => agent.name),
  ]);
  const inferredRoot = inferPluginRoot();
  const pluginRoot = resolveLocalInput(parsed.pluginRoot || options.pluginRoot || (
    inferredRoot && isWithin(path.resolve(parsed.home), inferredRoot) ? inferredRoot : ''
  ), 'plugin-root');
  const additionalRedactionRoots = pluginRoot ? [[pluginRoot, '<PLUGIN_ROOT>']] : [];
  const installations = collectInstallEvidence(parsed.home, {
    ...options,
    pluginRoot,
  });
  const sourceVersion = installations.find((item) => item.surface === 'source')?.version || '';
  const claudeVersion = installations.find((item) => item.surface === 'claude')?.version || '';
  const codexVersion = installations.find((item) => item.surface === 'codex-project')?.version || '';
  const version = sourceVersion || claudeVersion || codexVersion || installations[0]?.version || 'unknown';
  const sourceFiles = discovery.sources.filter((source) => isSessionFile(source.path))
    .filter((source) => parsed.source === 'auto' || source.kind.includes(parsed.source));
  const records = [];
  const sourceStats = [];
  let partial = false;
  for (const source of sourceFiles) {
    const remaining = parsed.maxSessions - records.length;
    if (remaining <= 0) {
      partial = true;
      break;
    }
    const packageVersion = source.kind.includes('codex') ? (codexVersion || version) : (claudeVersion || version);
    const scan = scanJsonlFile(source.path, {
      dateRange: parsed.dateRange,
      timeZone: parsed.timeZone,
      home: parsed.home,
      agents: parsed.agents,
      sourceKind: source.kind,
      maxBytes: parsed.maxBytes,
      maxRecords: remaining,
      packageVersion,
      knownAgents,
    });
    sourceStats.push({ path: redactSourcePath(source.path, parsed.home), kind: source.kind, stats: scan.stats });
    records.push(...scan.records);
    partial = partial || scan.stats.partial;
    if (scan.stats.limitReached) break;
  }
  let findings = detectFindings(records).map((finding) => publicFinding(finding, parsed.home, knownAgents));
  const verification = parsed.verificationFile ? readJson(parsed.verificationFile) : null;
  const verificationEntries = Array.isArray(verification) ? verification : (verification && Array.isArray(verification.findings) ? verification.findings : []);
  let verificationState = {
    requested: parsed.executeVerification,
    executed: false,
    digest: parsed.verificationDigest || '',
    expectedDigest: verificationEntries.length > 0
      ? verificationDigest(verificationEntries, { cwd: options.cwd, env: options.env })
      : '',
    error: '',
  };
  if (verificationEntries.length > 0) {
    let executedEntries = verificationEntries;
    if (parsed.executeVerification) {
      if (!parsed.verificationDigest) verificationState.error = 'verification-digest-required';
      else if (parsed.verificationDigest !== verificationState.expectedDigest) verificationState.error = 'verification-digest-mismatch';
      else {
        executedEntries = executeVerificationEntries(verificationEntries, {
          home: parsed.home,
          cwd: options.cwd,
          env: options.env,
          pluginRoot,
          digestVerified: true,
          expectedVerificationDigest: parsed.verificationDigest,
        });
        verificationState.executed = true;
        if (executedEntries.some((entry) => (
          entry?.reproduction?.execution?.reason === 'verification-digest-mismatch'
          || entry?.consumerGate?.execution?.reason === 'verification-digest-mismatch'
        ))) verificationState.error = 'verification-digest-mismatch-during-execution';
      }
    }
    const byFingerprint = new Map(executedEntries.filter((item) => item && item.fingerprint).map((item) => [item.fingerprint, item]));
    findings = findings.map((finding) => byFingerprint.has(finding.fingerprint)
      ? verifyFinding(finding, byFingerprint.get(finding.fingerprint), {
        home: parsed.home,
      })
      : finding);
  }
  const publicRecords = records.map((record) => publicRecord(record, parsed.home, knownAgents));
  const repository = parsed.repo || 'hmj1026/dhpk';
  const issueDrafts = findings.map((finding) => buildIssueDraft(finding, {
    version,
    repository,
    home: parsed.home,
  }));
  const issueResults = parsed.createIssues
    ? findings.map((finding, index) => createIssue({
      draft: issueDrafts[index],
      finding,
      repository,
      confirmed: parsed.confirmed,
      confirmationDigest: parsed.confirmationDigest,
      ghPath: options.ghPath,
      cwd: options.cwd,
      env: options.env,
      allowedRepository: options.allowedRepository || 'hmj1026/dhpk',
    })).map((result) => Object.fromEntries(Object.entries(result).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactText(value, { home: parsed.home }) : value,
    ])))
    : [];
  const report = {
    schema: 'dhpk.session-usage-audit.report.v1',
    args: {
      ...parsed,
      home: '<HOME>',
      output: parsed.output ? redactText(parsed.output, { home: parsed.home }) : '',
      pluginRoot: pluginRoot ? redactValue(pluginRoot, parsed.home, 0, additionalRedactionRoots) : '',
      verificationFile: parsed.verificationFile ? redactText(parsed.verificationFile, { home: parsed.home }) : '',
    },
    coverage: {
      sourceRoots: { ...SOURCE_ROOT_PATTERNS },
      packageOwnedRoleSet: packageOwnedRoleSet({ packageRoot: options.packageRoot }),
      installedAgents: discovery.installedAgents.map((agent) => {
        const name = safeAgent(agent.name, { knownAgents });
        const displayedPath = path.join(path.dirname(agent.path), `${name}${path.extname(agent.path)}`);
        return {
          ...agent,
          name,
          platform: redactText(agent.platform, { home: parsed.home }),
          path: redactText(displayedPath, { home: parsed.home }),
        };
      }),
      omittedSources: [
        ...discovery.sources
          .filter((source) => !isSessionFile(source.path))
          .map((source) => ({ kind: source.kind, path: redactText(source.path, { home: parsed.home }), status: 'UNSUPPORTED' })),
        ...discovery.omittedSources.map((source) => ({
          ...source,
          path: redactText(source.path, { home: parsed.home }),
        })),
      ].filter((source, index, all) => all.findIndex((candidate) => `${candidate.kind}|${candidate.path}` === `${source.kind}|${source.path}`) === index),
      activeOrcaAccounts: discovery.activeOrcaAccounts || [],
      agentCounts: {
        installationRows: 0,
        uniqueCanonicalRoles: 0,
        excludedIndexRows: 0,
        displayedCount: 0,
        displayedCountScope: 'unique-canonical-role',
      },
    },
    installations: installations.map((item) => redactValue(item, parsed.home, 0, additionalRedactionRoots)),
    sourceStats,
    records: publicRecords,
    findings,
    verification: verificationState,
    issueDrafts,
    issueResults,
    stats: {
      sources: discovery.sources.filter((source) => isSessionFile(source.path)).length,
      scannedSources: sourceStats.length,
      records: publicRecords.length,
      partial,
      malformed: sourceStats.reduce((sum, item) => sum + item.stats.malformed, 0),
    },
  };
  const normalizedOmittedSources = report.coverage.omittedSources.map((source) => ({
    ...source,
    path: redactSourcePath(source.path, parsed.home),
    reason: source.reason || source.status || 'omitted',
  }));
  const malformedCount = sourceStats.reduce((sum, item) => sum + Number(item.stats.malformed || 0), 0);
  const unsupportedCount = sourceStats.reduce((sum, item) => sum + Number(item.stats.unsupported || 0), 0)
    + normalizedOmittedSources.filter((source) => source.status === 'UNSUPPORTED').length;
  const scanComplete = !partial && sourceStats.every((item) => item.stats.partial !== true);
  const sourceCoverageComplete = scanComplete
    && normalizedOmittedSources.every((source) => !['UNAVAILABLE', 'UNREADABLE', 'UNSUPPORTED', 'OMITTED'].includes(source.status))
    && unsupportedCount === 0;
  const installationRows = discovery.installedAgents.length;
  const excludedIndexRows = discovery.installedAgents
    .filter((agent) => String(agent.name || '').toUpperCase() === 'INDEX')
    .map((agent) => ({
      platform: redactText(agent.platform, { home: parsed.home }),
      path: redactSourcePath(agent.path, parsed.home),
    }));
  const indexRows = excludedIndexRows.length;
  const uniqueRoleIdentities = new Set(
    discovery.installedAgents
      .map((agent) => String(agent.name || '').trim())
      .filter((name) => name && name.toUpperCase() !== 'INDEX'),
  ).size;
  const cacheVersionDuplicates = Math.max(0, discovery.installedAgents.length - indexRows - uniqueRoleIdentities);
  report.coverage.omittedSources = normalizedOmittedSources;
  report.coverage.omittedSourceReasons = normalizedOmittedSources.map((source) => source.reason);
  report.coverage.scanComplete = scanComplete;
  report.coverage.sourceCoverageComplete = sourceCoverageComplete;
  report.coverage.malformedCount = malformedCount;
  report.coverage.unsupportedCount = unsupportedCount;
  report.coverage.installationRows = installationRows;
  report.coverage.uniqueRoleIdentities = uniqueRoleIdentities;
  report.coverage.cacheVersionDuplicates = cacheVersionDuplicates;
  report.coverage.excludedIndexRows = excludedIndexRows;
  report.coverage.excludedIndexRowCount = indexRows;
  report.coverage.agentCounts = {
    installationRows,
    uniqueCanonicalRoles: uniqueRoleIdentities,
    excludedIndexRows: indexRows,
    displayedCount: uniqueRoleIdentities,
    displayedCountScope: 'unique-canonical-role',
  };
  report.stats.scanComplete = scanComplete;
  report.stats.sourceCoverageComplete = sourceCoverageComplete;
  report.stats.malformedCount = malformedCount;
  report.stats.unsupportedCount = unsupportedCount;
  if (options.write || parsed.output) writeReport(report, parsed.output || path.join(process.cwd(), '.claude', 'artifacts', 'audits', 'session-usage'));
  return report;
}

function runGh(args, options = {}) {
  const command = options.ghPath || 'gh';
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: options.timeout || 15000,
  });
  if (result.error) return { ok: false, status: null, stdout: '', stderr: result.error.message };
  return { ok: result.status === 0, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function findDuplicateIssues({ repository, fingerprint, component = '', message = '', ghPath, cwd, env } = {}) {
  if (!repository || !fingerprint) return { ok: false, duplicates: [], error: 'repository-and-fingerprint-required' };
  const queries = [...new Set([fingerprint, component, message].map((value) => String(value || '').trim()).filter(Boolean))];
  const duplicateMap = new Map();
  const candidateMap = new Map();
  for (const query of queries) {
    const result = runGh([
      'issue', 'list', '--repo', repository, '--state', 'all', '--search', query,
      '--limit', '20', '--json', 'number,title,state,url',
    ], { ghPath, cwd, env });
    if (!result.ok) return { ok: false, duplicates: [], queries, error: result.stderr.trim() || `gh exited ${result.status}` };
    let parsed;
    try { parsed = JSON.parse(result.stdout || '[]'); } catch (_error) {
      return { ok: false, duplicates: [], queries, error: 'gh issue list returned invalid JSON' };
    }
    if (!Array.isArray(parsed)) continue;
    for (const issue of parsed) {
      const identity = String(issue.number || issue.url || `${issue.state || ''}|${issue.title || ''}`);
      const target = query === fingerprint ? duplicateMap : candidateMap;
      if (!target.has(identity)) target.set(identity, { ...issue, matchedQueries: [query] });
      else target.get(identity).matchedQueries.push(query);
    }
  }
  return {
    ok: true,
    duplicates: [...duplicateMap.values()],
    duplicateCandidates: [...candidateMap.values()].filter((candidate) => !duplicateMap.has(String(candidate.number || candidate.url || `${candidate.state || ''}|${candidate.title || ''}`))),
    queries,
    error: '',
  };
}

function createIssue({ draft, finding, repository, confirmed = false, confirmationDigest = '', ghPath, cwd, env, allowedRepository = 'hmj1026/dhpk' } = {}) {
  if (!confirmed) return { created: false, reason: 'human-confirmation-required' };
  if (!draft || !finding || !repository) return { created: false, reason: 'missing-issue-input' };
  if (repository !== allowedRepository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return { created: false, reason: 'repository-not-allowed' };
  }
  if (!draft.confirmationDigest || confirmationDigest !== draft.confirmationDigest) {
    return { created: false, reason: 'confirmation-digest-required', expectedDigest: draft.confirmationDigest || '' };
  }
  if (!finding.verification || finding.verification.trusted !== true) {
    return { created: false, reason: 'verification-not-attested' };
  }
  const localGate = evaluateIssueGate({
    finding,
    duplicate: false,
    ghAuth: true,
    confirmed: true,
    confirmationDigest,
    expectedDigest: draft.confirmationDigest,
  });
  if (!localGate.allowed) return { created: false, reason: localGate.reasons.join(',') };
  const auth = runGh(['auth', 'status'], { ghPath, cwd, env });
  if (!auth.ok) return { created: false, reason: 'github-auth-unavailable', detail: auth.stderr.trim() };
  const search = findDuplicateIssues({
    repository,
    fingerprint: finding.fingerprint,
    component: finding.component,
    message: finding.message,
    ghPath,
    cwd,
    env,
  });
  if (!search.ok) return { created: false, reason: 'duplicate-search-failed', detail: search.error };
  const gate = evaluateIssueGate({
    finding,
    duplicate: search.duplicates.length > 0,
    ghAuth: true,
    confirmed: true,
    confirmationDigest,
    expectedDigest: draft.confirmationDigest,
  });
  if (!gate.allowed) return { created: false, reason: gate.reasons.join(','), duplicates: search.duplicates, duplicateCandidates: search.duplicateCandidates || [] };
  const result = runGh([
    'issue', 'create', '--repo', repository, '--title', draft.title, '--body', draft.body,
  ], { ghPath, cwd, env });
  if (!result.ok) return { created: false, reason: 'issue-create-failed', detail: result.stderr.trim() };
  return { created: true, url: result.stdout.trim(), duplicates: [], duplicateCandidates: search.duplicateCandidates || [] };
}

if (require.main === module) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const report = runAudit({ argv: process.argv.slice(2), write: true });
    if (parsed.format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(renderReportMarkdown(report));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exit(2);
  }
}

module.exports = {
  dateKey,
  parseArgs,
  redactText,
  fingerprintFinding,
  discoverSources,
  scanJsonlFile,
  detectFindings,
  buildIssueDraft,
  evaluateIssueGate,
  verifyFinding,
  collectInstallEvidence,
  renderReportMarkdown,
  writeReport,
  runAudit,
  runGh,
  findDuplicateIssues,
  createIssue,
  verificationDigest,
  executeVerificationEntries,
  usage,
};
