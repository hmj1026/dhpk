'use strict';

// User-local, append-only, de-identified Install History JSONL persistence.
// Kept as a small standalone relative module so codex-cli.js stays within the
// installer-modules closure (relative .js + node: built-ins only, <= 256 KB).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redactSensitiveText } = require('./redaction');

const SCHEMA_VERSION = 'dhpk.install-history.v1';
const DELEGATED_ENV = 'DHPK_INSTALL_HISTORY_DELEGATED';
const FILE_OVERRIDE_ENV = 'DHPK_INSTALL_HISTORY_FILE';
const DISABLE_ENV = 'DHPK_NO_INSTALL_HISTORY';

const COOKIE_OR_SECRET_TOKEN = /\b((?:set-)?cookie\s*[:=]\s*)(?:[^\r\n;]+(?:;\s*[^\r\n;]+)*)|\b(?:github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/gi;
const UNIX_HOME_PATH = /(\/(?:Users|home)\/)([^/\s"'`,;)}\]]+)/g;
const WIN_HOME_PATH = /([A-Za-z]:[\\/]Users[\\/])([^\\/\s"'`,;)}\]]+)/gi;
const SAFE_STRUCTURAL_WORDS = new Set([
  'user', 'local', 'project', 'install', 'update', 'plan', 'status', 'verify',
  'uninstall', 'rollback', 'recover', 'ready', 'blocked', 'partial', 'current',
  'absent', 'present', 'claude', 'codex', 'cursor', 'agy', 'assets', 'unknown',
]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTruthyFlag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function isHistoryDisabled(env = process.env) {
  if (!env || typeof env !== 'object') return false;
  return isTruthyFlag(env[DISABLE_ENV]) || isTruthyFlag(env[DELEGATED_ENV]);
}

function resolveHomeDir(env = process.env) {
  const candidates = [env && env.HOME, env && env.USERPROFILE];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return path.resolve(candidate.trim());
  }
  try {
    const home = os.homedir();
    if (home) return path.resolve(home);
  } catch (_) { /* ignore */ }
  return path.resolve('.');
}

function resolveHistoryFile(env = process.env) {
  const override = env && typeof env[FILE_OVERRIDE_ENV] === 'string' ? env[FILE_OVERRIDE_ENV].trim() : '';
  if (override) return path.resolve(override);
  const xdgState = env && typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : '';
  if (xdgState) return path.join(path.resolve(xdgState), 'dhpk', 'install-history.jsonl');
  return path.join(resolveHomeDir(env), '.local', 'state', 'dhpk', 'install-history.jsonl');
}

function canonicalPath(targetPath) {
  const resolved = path.resolve(String(targetPath));
  try {
    return fs.realpathSync(resolved);
  } catch (_) {
    const pending = [];
    let current = resolved;
    while (true) {
      try {
        const base = fs.realpathSync(current);
        return pending.length ? path.join(base, ...pending.reverse()) : base;
      } catch (err) {
        if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) return resolved;
        const parent = path.dirname(current);
        if (parent === current) return resolved;
        pending.push(path.basename(current));
        current = parent;
      }
    }
  }
}

function deidentifyProjectId(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) return null;
  const canonical = canonicalPath(projectPath.trim());
  return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function collectHomePrefixes(env = process.env) {
  const set = new Set();
  for (const candidate of [env && env.HOME, env && env.USERPROFILE]) {
    if (typeof candidate === 'string' && candidate.trim() && candidate.trim() !== '/') {
      const trimmed = path.resolve(candidate.trim());
      set.add(trimmed);
      try { set.add(fs.realpathSync(trimmed)); } catch (_) { /* non-existent */ }
    }
  }
  try {
    const home = os.homedir();
    if (home && home !== '/') {
      set.add(path.resolve(home));
      try { set.add(fs.realpathSync(home)); } catch (_) { /* non-existent */ }
    }
  } catch (_) { /* ignore */ }
  return [...set].sort((a, b) => b.length - a.length);
}

function collectUsernames(env = process.env) {
  const set = new Set();
  for (const candidate of [env && env.USER, env && env.LOGNAME, env && env.USERNAME]) {
    if (typeof candidate === 'string' && candidate.trim()) set.add(candidate.trim());
  }
  try {
    const info = os.userInfo();
    if (info && info.username) set.add(info.username);
  } catch (_) { /* container/headless UID without passwd entry */ }
  return [...set]
    .filter((name) => name.length >= 2 && !SAFE_STRUCTURAL_WORDS.has(name.toLowerCase()))
    .sort((a, b) => b.length - a.length);
}

function sanitizeHistoryText(value, env = process.env, { maxLength = 256, redactUsername = true } = {}) {
  if (value === undefined || value === null) return null;
  let text = String(value);
  text = text.replace(COOKIE_OR_SECRET_TOKEN, (match, cookiePrefix) => (
    cookiePrefix ? `${cookiePrefix}<redacted>` : '<redacted-token>'
  ));
  text = redactSensitiveText(text, { maxLength: Math.max(maxLength, 1024) }) || '';
  for (const prefix of collectHomePrefixes(env)) {
    text = text.split(prefix).join('<home>');
  }
  text = text.replace(UNIX_HOME_PATH, '$1<redacted>');
  text = text.replace(WIN_HOME_PATH, '$1<redacted>');
  if (redactUsername) {
    for (const username of collectUsernames(env)) {
      text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(username)}(?![A-Za-z0-9])`, 'g'), '<user>');
    }
  }
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function sanitizeVersionValue(value, env = process.env) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return sanitizeHistoryText(trimmed, env, { maxLength: 64, redactUsername: true });
}

function sanitizeReasonCodes(codes, env = process.env) {
  if (!Array.isArray(codes)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of codes) {
    if (raw === undefined || raw === null) continue;
    const cleaned = sanitizeHistoryText(String(raw).trim(), env, { maxLength: 96, redactUsername: true });
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function normalizeVersionSummary(summary, env = process.env) {
  if (summary === undefined || summary === null) {
    return { version: null, state: 'absent' };
  }
  if (typeof summary === 'string') {
    const version = sanitizeVersionValue(summary, env);
    return { version, state: version ? 'present' : 'absent' };
  }
  if (typeof summary === 'object') {
    const version = sanitizeVersionValue(summary.version, env);
    const rawState = summary.state === undefined || summary.state === null
      ? (version ? 'present' : 'absent')
      : String(summary.state).trim();
    const state = sanitizeHistoryText(rawState, env, { maxLength: 32, redactUsername: false }) || 'unknown';
    return { version, state };
  }
  return { version: null, state: 'unknown' };
}

function buildHistoryRecord(input = {}, env = process.env) {
  const timestamp = typeof input.timestamp === 'string' && input.timestamp.trim()
    ? input.timestamp.trim()
    : new Date().toISOString();
  const projectId = typeof input.projectId === 'string' && /^sha256:[a-f0-9]{64}$/.test(input.projectId)
    ? input.projectId
    : deidentifyProjectId(input.projectRoot);
  return {
    schema: SCHEMA_VERSION,
    timestamp,
    surface: sanitizeHistoryText(input.surface || 'unknown', env, { maxLength: 48, redactUsername: false }),
    action: sanitizeHistoryText(input.action || 'unknown', env, { maxLength: 48, redactUsername: false }),
    scope: input.scope ? sanitizeHistoryText(input.scope, env, { maxLength: 32, redactUsername: false }) : null,
    sourceVersion: sanitizeVersionValue(input.sourceVersion, env),
    projectId,
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : 0,
    verdict: sanitizeHistoryText(input.verdict || 'UNKNOWN', env, { maxLength: 32, redactUsername: false }),
    reasonCodes: sanitizeReasonCodes(input.reasonCodes, env),
    versions: {
      before: normalizeVersionSummary(input.beforeVersion, env),
      after: normalizeVersionSummary(input.afterVersion, env),
    },
  };
}

function appendInstallHistory(input, options = {}) {
  const env = options.env || process.env;
  const stderr = typeof options.stderr === 'function'
    ? options.stderr
    : (text) => process.stderr.write(text);
  if (isHistoryDisabled(env)) {
    return { written: false, skipped: true, reason: 'disabled' };
  }
  let fd = null;
  try {
    const filePath = resolveHistoryFile(env);
    const record = buildHistoryRecord(input, env);
    const line = `${JSON.stringify(record)}\n`;
    const parent = path.dirname(filePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow;
    fd = fs.openSync(filePath, flags, 0o600);
    fs.writeSync(fd, line, null, 'utf8');
    return { written: true, filePath, record };
  } catch (error) {
    const detail = sanitizeHistoryText(error && error.message ? error.message : String(error), env, { maxLength: 200 });
    try {
      stderr(`[install-history] warning: failed to append install history: ${detail}\n`);
    } catch (_) { /* best-effort warning */ }
    return { written: false, error: detail };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
}

function readPackageSourceVersion(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir) return null;
  const candidates = [
    [path.join(rootDir, '.claude-plugin', 'plugin.json'), 'version'],
    [path.join(rootDir, 'package.json'), 'version'],
    [path.join(rootDir, 'provenance.json'), 'sourceVersion'],
    [path.join(rootDir, 'plugin.json'), 'version'],
  ];
  for (const [file, field] of candidates) {
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc && typeof doc[field] === 'string' && doc[field].trim()) return doc[field].trim();
    } catch (_) { /* try next */ }
  }
  return null;
}

function readHostReceiptSummary(projectRoot, destRel) {
  if (typeof projectRoot !== 'string' || !projectRoot || typeof destRel !== 'string' || !destRel) {
    return { version: null, state: 'absent' };
  }
  const receiptPath = path.join(projectRoot, destRel, '.dhpk-installed.json');
  try {
    const stat = fs.lstatSync(receiptPath);
    if (stat.isSymbolicLink() || !stat.isFile()) return { version: null, state: 'invalid' };
    const doc = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { version: null, state: 'invalid' };
    const version = typeof doc.plugin_version === 'string' && doc.plugin_version.trim()
      ? doc.plugin_version.trim()
      : null;
    const state = typeof doc.state === 'string' && doc.state.trim()
      ? doc.state.trim()
      : (version ? 'present' : 'present');
    return { version, state };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { version: null, state: 'absent' };
    return { version: null, state: 'invalid' };
  }
}

module.exports = {
  SCHEMA_VERSION,
  DELEGATED_ENV,
  FILE_OVERRIDE_ENV,
  DISABLE_ENV,
  isHistoryDisabled,
  resolveHistoryFile,
  canonicalPath,
  deidentifyProjectId,
  sanitizeHistoryText,
  buildHistoryRecord,
  appendInstallHistory,
  readPackageSourceVersion,
  readHostReceiptSummary,
};
