'use strict';

// Read-only cross-scope and cross-Host installation inspection (#1586).
// Performs zero filesystem writes; reuses plan-boundary-envelope (#1584),
// duplicate-discovery (#1583), host-cli-probe (#1581), cursor-plan,
// agy-plugin-install, and project-agent-projection-publisher.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hostCliProbeEvidence, runHostCliProbe } = require('./host-cli-probe');
const { redactSensitiveText } = require('./redaction');
const { createDuplicateDiscoveryReport } = require('./duplicate-discovery');
const planBoundary = require('./plan-boundary-envelope');
const { addCursorCacheDriftWarnings } = require('./install-adapters/cursor-plan');
const { installerEnv, runCaptured } = require('./install-adapters/codex-cli');
const { inspectProjectProjectionBoundaries } = require('./project-agent-projection-publisher');
const { loadAgyPathContract, resolveAgyInstallPaths } = require('./agy-path-contract');
const {
  resolveAgyInstallCandidates,
  observeAgyInstallCandidate,
  inspectAgyInstallTargets,
} = require('./agy-plugin-install');

const STATUS_SCHEMA = 'dhpk.install-status.v1';
const ALL_SURFACES = Object.freeze(['claude', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor', 'agy-plugin']);
const MAX_READ_BYTES = 4 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 15000;
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g;
const LEGACY_GENERATED_RE = /(?:^|[\\/])generated(?:[\\/]|$)/;
const LEGACY_PLUGINS_RE = /(?:^|[\\/])plugins(?:[\\/]|$)/;
const LEGACY_AGY_CONFIG_RE = /(?:^|[\\/])\.gemini[\\/]config[\\/]plugins(?:[\\/]|$)/;
const LEGACY_JOURNAL_NAME = /^\.dhpk-transaction-(\d{8}T\d{6}Z-\d+)\.json$/;
const HOST_JOURNAL_PHASES = new Set(['committed', 'rolled_back', 'active', 'rollback_incomplete']);

function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (_) {
    return null;
  }
}

function readBoundedJson(filePath, maxBytes = MAX_READ_BYTES) {
  const stat = lstatOrNull(filePath);
  if (!stat) return { present: false, unsafe: false, valid: false, data: null, error: null };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      present: true,
      unsafe: true,
      valid: false,
      data: null,
      error: stat.isSymbolicLink() ? 'path is a symlink' : 'path is not a regular file',
    };
  }
  if (stat.size > maxBytes) {
    return { present: true, unsafe: false, valid: false, data: null, error: `file exceeds ${maxBytes} bytes` };
  }
  try {
    return { present: true, unsafe: false, valid: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { present: true, unsafe: false, valid: false, data: null, error: error.message };
  }
}

function readBoundedJsonFollow(filePath, maxBytes = MAX_READ_BYTES) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return { present: false, valid: false, data: null, error: null };
  }
  if (!stat.isFile() || stat.size > maxBytes) {
    return { present: true, valid: false, data: null, error: 'not a readable file within size limit' };
  }
  try {
    return { present: true, valid: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { present: true, valid: false, data: null, error: error.message };
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readGitHeadSha(root) {
  try {
    const dotGit = path.join(root, '.git');
    const stat = lstatOrNull(dotGit);
    if (!stat) return null;
    let gitDir = dotGit;
    if (stat.isFile()) {
      const content = fs.readFileSync(dotGit, 'utf8').trim();
      const match = /^gitdir:\s*(.+)$/.exec(content);
      if (!match) return null;
      gitDir = path.resolve(root, match[1].trim());
    }
    const headRaw = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/i.test(headRaw)) return headRaw.toLowerCase();
    const refMatch = /^ref:\s*(\S+)$/.exec(headRaw);
    if (!refMatch) return null;
    const refName = refMatch[1];
    const dirsToCheck = [gitDir];
    const commonDirFile = path.join(gitDir, 'commondir');
    if (fs.existsSync(commonDirFile)) {
      const relCommon = fs.readFileSync(commonDirFile, 'utf8').trim();
      if (relCommon) dirsToCheck.push(path.resolve(gitDir, relCommon));
    }
    for (const dir of dirsToCheck) {
      const refPath = path.join(dir, refName);
      if (fs.existsSync(refPath)) {
        const sha = fs.readFileSync(refPath, 'utf8').trim();
        if (/^[a-f0-9]{40}$/i.test(sha)) return sha.toLowerCase();
      }
      const packed = path.join(dir, 'packed-refs');
      if (fs.existsSync(packed)) {
        for (const line of fs.readFileSync(packed, 'utf8').split(/\r?\n/)) {
          if (!line || line.startsWith('#') || line.startsWith('^')) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2 && parts[1] === refName && /^[a-f0-9]{40}$/i.test(parts[0])) {
            return parts[0].toLowerCase();
          }
        }
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

function classifyLegacyLinkTarget(target) {
  if (typeof target !== 'string' || !target) return null;
  if (LEGACY_AGY_CONFIG_RE.test(target)) return 'legacy-agy-config-target';
  if (LEGACY_GENERATED_RE.test(target)) return 'legacy-generated-target';
  if (LEGACY_PLUGINS_RE.test(target)) return 'legacy-plugins-target';
  return null;
}

function inspectLink(targetPath, { label = null, scope = null } = {}) {
  const stat = lstatOrNull(targetPath);
  if (!stat) {
    return {
      label,
      scope,
      path: targetPath,
      exists: false,
      isSymlink: false,
      broken: false,
      legacyLink: false,
      legacyReason: null,
      linkTarget: null,
      resolvedPath: null,
    };
  }
  if (!stat.isSymbolicLink()) {
    let resolvedPath = null;
    try { resolvedPath = fs.realpathSync(targetPath); } catch (_) { resolvedPath = path.resolve(targetPath); }
    return {
      label,
      scope,
      path: targetPath,
      exists: true,
      isSymlink: false,
      broken: false,
      legacyLink: false,
      legacyReason: null,
      linkTarget: null,
      resolvedPath,
    };
  }
  let linkTarget = null;
  try { linkTarget = fs.readlinkSync(targetPath); } catch (_) { linkTarget = null; }
  let resolvedPath = null;
  let broken = false;
  try {
    resolvedPath = fs.realpathSync(targetPath);
    fs.statSync(resolvedPath);
  } catch (_) {
    broken = true;
  }
  const legacyReason = classifyLegacyLinkTarget(linkTarget)
    || (resolvedPath ? classifyLegacyLinkTarget(resolvedPath) : null);
  return {
    label,
    scope,
    path: targetPath,
    exists: true,
    isSymlink: true,
    broken,
    legacyLink: Boolean(legacyReason),
    legacyReason,
    linkTarget,
    resolvedPath,
  };
}

function scanDirectoryLinks(dirPath, { label, scope, maxEntries = 256 } = {}) {
  const results = [];
  const rootLink = inspectLink(dirPath, { label, scope });
  if (!rootLink.exists) return results;
  if (rootLink.isSymlink) results.push(rootLink);
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) {
    return results;
  }
  for (const entry of entries.slice(0, maxEntries)) {
    const childPath = path.join(dirPath, entry.name);
    const childLink = inspectLink(childPath, { label: `${label}:${entry.name}`, scope });
    if (childLink.broken || childLink.legacyLink || childLink.isSymlink) {
      results.push(childLink);
    }
  }
  return results;
}

function collectLinkDiagnostics(linkEntries, surface) {
  const diagnostics = [];
  const seen = new Set();
  for (const entry of linkEntries) {
    if (!entry || !entry.exists) continue;
    if (entry.broken && !seen.has(`broken:${entry.path}`)) {
      seen.add(`broken:${entry.path}`);
      diagnostics.push({
        surface,
        scope: entry.scope || 'project',
        code: 'BROKEN_LINK',
        severity: 'drift',
        message: `Broken symlink at ${entry.path}${entry.linkTarget ? ` -> ${entry.linkTarget}` : ''}`,
        affectedPaths: [entry.path],
      });
    }
    if (entry.legacyLink && !seen.has(`legacy:${entry.path}`)) {
      seen.add(`legacy:${entry.path}`);
      diagnostics.push({
        surface,
        scope: entry.scope || 'project',
        code: 'LEGACY_MIGRATED_LINK',
        severity: 'drift',
        message: `Legacy migrated symlink at ${entry.path} -> ${entry.linkTarget || entry.resolvedPath} (${entry.legacyReason})`,
        affectedPaths: [entry.path],
      });
    }
  }
  return diagnostics;
}

function isDhpkPluginId(id) {
  return id === 'dhpk@dhpk'
    || id === 'dhpk-stacks@dhpk'
    || id === 'dhpk-lite'
    || (typeof id === 'string' && id.startsWith('dhpk-lite@'));
}

function normalizePathSafe(candidate) {
  if (typeof candidate !== 'string' || !candidate) return null;
  try {
    return fs.realpathSync(candidate);
  } catch (_) {
    return path.resolve(candidate);
  }
}

function recordAppliesToProject(record, projectRoot) {
  const scope = record && record.scope ? record.scope : 'user';
  if (scope === 'user' || scope === 'managed') return true;
  if (scope !== 'project' && scope !== 'local') return false;
  if (typeof record.projectPath !== 'string' || !path.isAbsolute(record.projectPath)) return false;
  const root = normalizePathSafe(record.projectPath);
  const project = normalizePathSafe(projectRoot);
  const relative = path.relative(root, project);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseClaudeTextPluginList(stdout) {
  const clean = String(stdout || '').replace(ANSI_PATTERN, '');
  const lines = clean.split('\n');
  let section = 'installed';
  const blocks = [];
  let current = null;
  let lastField = null;

  const flush = () => {
    if (!current) return;
    while (current.rawLines.length > 0 && current.rawLines[current.rawLines.length - 1].trim() === '') {
      current.rawLines.pop();
    }
    blocks.push({
      id: current.id,
      section: current.section,
      version: current.version,
      readFromFolder: current.readFromFolder,
      path: current.path,
      scope: current.scope,
      enabled: current.enabled,
      statusText: current.statusText,
      rawBlock: current.rawLines.join('\n'),
    });
    current = null;
    lastField = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Installed\s+plugins:/i.test(trimmed)) { flush(); section = 'installed'; continue; }
    if (/^Session-only\s+plugins/i.test(trimmed)) { flush(); section = 'session'; continue; }
    if (/^Synced\s+from/i.test(trimmed)) { flush(); section = 'synced'; continue; }
    if (/^Built-in\s+plugins:/i.test(trimmed)) { flush(); section = 'builtin'; continue; }

    const headerMatch = /^\s*(?:[❯•*-]\s*)?([A-Za-z0-9._-]+@[A-Za-z0-9._-]+)\s*$/.exec(line);
    if (headerMatch) {
      flush();
      current = {
        id: headerMatch[1],
        section,
        version: null,
        readFromFolder: null,
        path: null,
        scope: null,
        enabled: null,
        statusText: null,
        rawLines: [line],
      };
      continue;
    }

    if (!current) continue;
    if (trimmed === '') {
      current.rawLines.push(line);
      lastField = null;
      continue;
    }
    current.rawLines.push(line);

    const fieldMatch = /^\s*(Version|Read\s*from|Path|Scope|Status)\s*:\s*(.*)$/i.exec(line);
    if (fieldMatch) {
      const key = fieldMatch[1].toLowerCase().replace(/\s+/g, '');
      const val = fieldMatch[2].trim();
      lastField = key;
      if (key === 'version') current.version = val || null;
      else if (key === 'readfrom') current.readFromFolder = val || null;
      else if (key === 'path') current.path = val || null;
      else if (key === 'scope') current.scope = val ? val.toLowerCase() : null;
      else if (key === 'status') {
        current.statusText = val;
        if (/\b(?:enabled|loaded)\b/i.test(val)) current.enabled = true;
        else if (/\bdisabled\b/i.test(val)) current.enabled = false;
      }
    } else if (lastField === 'path' || lastField === 'readfrom') {
      const fieldName = lastField === 'path' ? 'path' : 'readFromFolder';
      current[fieldName] = `${current[fieldName] || ''}${trimmed}`;
    }
  }
  flush();
  return blocks;
}

function runProbe(command, args, { cwd, env, spawn }) {
  const result = runHostCliProbe(command, args, {
    cwd,
    env,
    timeoutMs: PROBE_TIMEOUT_MS,
    reapGroup: 'always',
    spawn,
  });
  const evidence = hostCliProbeEvidence(result, redactSensitiveText);
  return {
    command: result.command,
    args,
    exitCode: evidence.exitCode,
    signal: evidence.signal,
    timedOut: evidence.timedOut,
    durationMs: evidence.durationMs,
    stdoutTail: evidence.stdoutTail,
    stderrTail: evidence.stderrTail,
    stdout: result.stdout,
    stderr: result.stderr,
    errorCode: result.error && result.error.code ? result.error.code : null,
    outputLimited: Boolean(result.outputLimited),
  };
}

function classifyProbeOutcome(probe) {
  if (!probe) return { status: 'NOT_RUN', reason: 'offline', failed: false };
  if (probe.errorCode === 'ENOENT') return { status: 'CLI_NOT_INSTALLED', reason: 'host-cli-missing', failed: false };
  if (probe.timedOut) return { status: 'PROBE_FAILED', reason: 'host-cli-timeout', failed: true };
  if (probe.outputLimited || probe.errorCode || probe.exitCode !== 0) {
    return { status: 'PROBE_FAILED', reason: 'host-cli-failed', failed: true };
  }
  return { status: 'OK', reason: null, failed: false };
}

function readEnabledPluginsMap(filePath) {
  const parsed = readBoundedJson(filePath);
  if (!parsed.present) return { present: false, valid: true, map: {} };
  if (!parsed.valid || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return { present: true, valid: false, map: {}, error: parsed.error || 'invalid settings JSON' };
  }
  const enabled = parsed.data.enabledPlugins;
  if (enabled !== undefined && (!enabled || typeof enabled !== 'object' || Array.isArray(enabled))) {
    return { present: true, valid: false, map: {}, error: 'enabledPlugins must be an object' };
  }
  return { present: true, valid: true, map: enabled || {} };
}

function effectiveEnabledFromSettings(pluginId, settingsLayers) {
  let value = null;
  for (const layer of settingsLayers) {
    if (layer && layer.valid && Object.prototype.hasOwnProperty.call(layer.map, pluginId)
      && typeof layer.map[pluginId] === 'boolean') {
      value = layer.map[pluginId];
    }
  }
  return value;
}

function checkVersionPins(projectRoot, versionsToCheck) {
  const pinPath = path.join(projectRoot, '.claude', 'dhpk-versions.json');
  const linkHealth = inspectLink(pinPath, { label: 'version-pin-file', scope: 'project' });
  if (!linkHealth.exists) {
    return { present: false, valid: true, state: 'unpinned', path: pinPath, linkHealth, verifiedRanges: [], incompatibleRanges: [], flagged: [] };
  }
  if (linkHealth.broken) {
    return {
      present: true, valid: false, state: 'broken-link', path: pinPath, linkHealth,
      verifiedRanges: [], incompatibleRanges: [], flagged: [{ version: null, status: 'broken-link' }],
    };
  }
  const parsed = readBoundedJsonFollow(pinPath);
  if (!parsed.valid || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return {
      present: true, valid: false, state: 'invalid', path: pinPath, linkHealth,
      error: parsed.error || 'invalid dhpk-versions.json', verifiedRanges: [], incompatibleRanges: [], flagged: [],
    };
  }
  const toPrefixes = (entries) => (Array.isArray(entries) ? entries : [])
    .map((item) => (item && typeof item.range === 'string' ? item.range.trim().replace(/\.x$/, '').replace(/\.+$/, '') : ''))
    .filter(Boolean);
  const verifiedPrefixes = toPrefixes(parsed.data.verified);
  const incompatPrefixes = toPrefixes(parsed.data.incompatible);
  const matches = (ver, prefixes) => prefixes.some((prefix) => ver === prefix || ver.startsWith(`${prefix}.`));
  const flagged = [];
  for (const ver of [...new Set(versionsToCheck.filter(Boolean))].sort()) {
    if (matches(ver, incompatPrefixes)) flagged.push({ version: ver, status: 'incompatible' });
    else if (!matches(ver, verifiedPrefixes)) flagged.push({ version: ver, status: 'unverified' });
  }
  let state = 'verified';
  if (flagged.some((item) => item.status === 'incompatible')) state = 'incompatible';
  else if (flagged.length > 0) state = 'unverified';
  return {
    present: true,
    valid: true,
    state,
    path: pinPath,
    linkHealth,
    verifiedRanges: verifiedPrefixes,
    incompatibleRanges: incompatPrefixes,
    flagged,
  };
}

function inspectAssetReceipt(projectRoot, sourceVersion) {
  const targetDir = path.join(projectRoot, '.claude', 'dhpk');
  const receiptPath = path.join(targetDir, '.dhpk-asset-receipt.json');
  const linkHealth = inspectLink(receiptPath, { label: 'asset-receipt', scope: 'project' });
  const targetLinkHealth = inspectLink(targetDir, { label: 'asset-target-dir', scope: 'project' });
  const legacyConflicts = ['precommit-runner.js', 'verify-runner.js', 'harness-audit.js']
    .map((name) => path.join(targetDir, 'scripts', name))
    .filter((filePath) => lstatOrNull(filePath) !== null);
  const backupDir = path.join(targetDir, '.dhpk-asset-backups');
  const hasBackups = Boolean(lstatOrNull(backupDir));
  const vendoredRulesDir = path.join(targetDir, 'rules');
  const hasVendoredRules = Boolean(lstatOrNull(vendoredRulesDir));

  if (!linkHealth.exists) {
    return {
      present: false,
      valid: true,
      state: 'ABSENT',
      path: receiptPath,
      targetDir,
      linkHealth,
      targetLinkHealth,
      sourceVersion: null,
      entryCount: 0,
      summary: { unchanged: 0, modified: 0, missing: 0, unsafe: 0 },
      legacyConflicts,
      hasBackups,
      hasVendoredRules,
    };
  }
  const parsed = readBoundedJson(receiptPath);
  if (!parsed.valid || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)
    || parsed.data.schema !== 'dhpk.asset-receipt.v1' || !Array.isArray(parsed.data.entries)) {
    return {
      present: true,
      valid: false,
      state: 'BLOCKED',
      path: receiptPath,
      targetDir,
      linkHealth,
      targetLinkHealth,
      error: parsed.error || 'invalid or unsupported Asset Receipt (.dhpk-asset-receipt.json)',
      sourceVersion: parsed.data && typeof parsed.data.source_version === 'string' ? parsed.data.source_version : null,
      entryCount: 0,
      summary: { unchanged: 0, modified: 0, missing: 0, unsafe: 0 },
      legacyConflicts,
      hasBackups,
      hasVendoredRules,
    };
  }

  const anchors = { target: targetDir, 'target-parent': path.dirname(targetDir) };
  const summary = { unchanged: 0, modified: 0, missing: 0, unsafe: 0 };
  const modifiedPaths = [];
  const missingPaths = [];
  const unsafePaths = [];
  for (const entry of parsed.data.entries) {
    if (!entry || typeof entry !== 'object' || !anchors[entry.anchor] || typeof entry.path !== 'string'
      || typeof entry.sha256 !== 'string') {
      return {
        present: true,
        valid: false,
        state: 'BLOCKED',
        path: receiptPath,
        targetDir,
        linkHealth,
        targetLinkHealth,
        error: 'malformed Asset Receipt entry',
        sourceVersion: typeof parsed.data.source_version === 'string' ? parsed.data.source_version : null,
        entryCount: parsed.data.entries.length,
        summary,
        legacyConflicts,
        hasBackups,
        hasVendoredRules,
      };
    }
    const filePath = path.join(anchors[entry.anchor], ...entry.path.split('/'));
    const stat = lstatOrNull(filePath);
    if (!stat) {
      summary.missing += 1;
      missingPaths.push(filePath);
    } else if (stat.isSymbolicLink() || !stat.isFile()) {
      summary.unsafe += 1;
      unsafePaths.push(filePath);
    } else if (sha256File(filePath) === entry.sha256) {
      summary.unchanged += 1;
    } else {
      summary.modified += 1;
      modifiedPaths.push(filePath);
    }
  }

  const receiptVersion = typeof parsed.data.source_version === 'string' ? parsed.data.source_version : null;
  let state = 'CURRENT';
  if (summary.unsafe > 0 || targetLinkHealth.isSymlink) state = 'BLOCKED';
  else if (summary.modified > 0 || summary.missing > 0 || (receiptVersion && sourceVersion && receiptVersion !== sourceVersion) || legacyConflicts.length > 0) {
    state = 'STALE';
  }
  return {
    present: true,
    valid: true,
    state,
    path: receiptPath,
    targetDir,
    linkHealth,
    targetLinkHealth,
    sourceVersion: receiptVersion,
    entryCount: parsed.data.entries.length,
    summary,
    modifiedPaths,
    missingPaths,
    unsafePaths,
    legacyConflicts,
    hasBackups,
    hasVendoredRules,
  };
}

function inspectClaudeCaches(home, activeVersions, sourceVersion) {
  const caches = [];
  for (const pkg of ['dhpk', 'dhpk-stacks']) {
    const pkgCacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'dhpk', pkg);
    let entries;
    try {
      entries = fs.readdirSync(pkgCacheRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const cacheDir = path.join(pkgCacheRoot, entry.name);
      const manifest = readBoundedJsonFollow(path.join(cacheDir, '.claude-plugin', 'plugin.json'));
      const cachedVersion = (manifest.valid && manifest.data && typeof manifest.data.version === 'string')
        ? manifest.data.version
        : entry.name;
      const orphaned = Boolean(lstatOrNull(path.join(cacheDir, '.orphaned_at')));
      const linkHealth = inspectLink(cacheDir, { label: `claude-cache:${pkg}:${entry.name}`, scope: 'user' });
      const matchesActive = activeVersions.has(cachedVersion) || cachedVersion === sourceVersion;
      caches.push({
        package: pkg,
        path: cacheDir,
        version: cachedVersion,
        orphaned,
        stale: !matchesActive,
        linkHealth,
      });
    }
  }
  return caches;
}

function scopeMatchesRequest(requestedScope, scope) {
  if (!requestedScope) return true;
  return requestedScope === scope;
}

function inspectClaudeSurface({
  projectRoot,
  home,
  sourceVersion,
  sourceCommitSha,
  requestedScope,
  offline,
  env,
  spawn,
  discoveryReport,
  preJsonProbe = null,
}) {
  const diagnostics = [];
  const remediation = [];
  const effectivePaths = [];

  const installedFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const marketplacesFile = path.join(home, '.claude', 'plugins', 'known_marketplaces.json');
  const installedRead = readBoundedJson(installedFile);
  const marketplacesRead = readBoundedJson(marketplacesFile);

  if (installedRead.present && !installedRead.valid) {
    diagnostics.push({
      surface: 'claude',
      scope: 'user',
      code: 'INVALID_CLAUDE_REGISTRY',
      severity: 'blocked',
      message: `Invalid Claude installed_plugins.json: ${installedRead.error}`,
      affectedPaths: [installedFile],
    });
  }

  const userSettings = readEnabledPluginsMap(path.join(home, '.claude', 'settings.json'));
  const projectSettings = readEnabledPluginsMap(path.join(projectRoot, '.claude', 'settings.json'));
  const localSettings = readEnabledPluginsMap(path.join(projectRoot, '.claude', 'settings.local.json'));
  const settingsLayers = [userSettings, projectSettings, localSettings];
  for (const [label, layerPath, layer] of [
    ['user', path.join(home, '.claude', 'settings.json'), userSettings],
    ['project', path.join(projectRoot, '.claude', 'settings.json'), projectSettings],
    ['local', path.join(projectRoot, '.claude', 'settings.local.json'), localSettings],
  ]) {
    if (layer.present && !layer.valid) {
      diagnostics.push({
        surface: 'claude',
        scope: label,
        code: 'INVALID_CLAUDE_SETTINGS',
        severity: 'blocked',
        message: `Invalid ${label} settings.json: ${layer.error}`,
        affectedPaths: [layerPath],
      });
    }
  }

  const registryEntries = [];
  if (installedRead.valid && installedRead.data && installedRead.data.plugins && typeof installedRead.data.plugins === 'object') {
    for (const [pluginId, rawRecords] of Object.entries(installedRead.data.plugins)) {
      if (!isDhpkPluginId(pluginId)) continue;
      for (const record of Array.isArray(rawRecords) ? rawRecords : [rawRecords]) {
        if (!record || typeof record !== 'object') continue;
        const scope = record.scope || 'user';
        if (!recordAppliesToProject({ ...record, scope }, projectRoot)) continue;
        const explicitEnabled = effectiveEnabledFromSettings(pluginId, settingsLayers);
        const enabled = explicitEnabled !== null ? explicitEnabled : (typeof record.enabled === 'boolean' ? record.enabled : null);
        if (record.installPath) {
          effectivePaths.push(inspectLink(record.installPath, { label: `registry:${pluginId}`, scope }));
        }
        registryEntries.push({
          id: pluginId,
          scope,
          version: typeof record.version === 'string' ? record.version : null,
          installPath: typeof record.installPath === 'string' ? record.installPath : null,
          gitCommitSha: typeof record.gitCommitSha === 'string' ? record.gitCommitSha : null,
          projectPath: typeof record.projectPath === 'string' ? record.projectPath : null,
          enabled,
          raw: record,
        });
      }
    }
  }

  let marketplaceInfo = null;
  if (marketplacesRead.valid && marketplacesRead.data && marketplacesRead.data.dhpk && typeof marketplacesRead.data.dhpk === 'object') {
    const mk = marketplacesRead.data.dhpk;
    marketplaceInfo = {
      source: mk.source || null,
      installLocation: typeof mk.installLocation === 'string' ? mk.installLocation : null,
      lastUpdated: mk.lastUpdated || null,
      autoUpdate: typeof mk.autoUpdate === 'boolean' ? mk.autoUpdate : null,
    };
    if (marketplaceInfo.installLocation) {
      effectivePaths.push(inspectLink(marketplaceInfo.installLocation, { label: 'marketplace:dhpk', scope: 'user' }));
    }
  }

  // Live CLI probes (both plain-text `claude plugin list` and JSON `claude plugin list --json`)
  const probeEnv = { ...env, HOME: home };
  let textProbe = null;
  let jsonProbe = null;
  let textOutcome = { status: 'NOT_RUN', reason: 'offline', failed: false };
  let jsonOutcome = { status: 'NOT_RUN', reason: 'offline', failed: false };
  let textEntries = [];
  let jsonEntries = [];

  if (!offline) {
    textProbe = runProbe('claude', ['plugin', 'list'], { cwd: projectRoot, env: probeEnv, spawn });
    textOutcome = classifyProbeOutcome(textProbe);
    jsonProbe = preJsonProbe || runProbe('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: probeEnv, spawn });
    jsonOutcome = classifyProbeOutcome(jsonProbe);

    if (textOutcome.failed) {
      diagnostics.push({
        surface: 'claude',
        scope: requestedScope || 'all',
        code: 'CLAUDE_TEXT_PROBE_FAILED',
        severity: 'blocked',
        message: `claude plugin list probe failed (${textOutcome.reason})`,
        probe: {
          command: textProbe.command,
          args: textProbe.args,
          exitCode: textProbe.exitCode,
          timedOut: textProbe.timedOut,
          stderrTail: textProbe.stderrTail,
        },
      });
    } else if (textOutcome.status === 'OK') {
      textEntries = parseClaudeTextPluginList(textProbe.stdout).filter((entry) => isDhpkPluginId(entry.id));
    }

    if (jsonOutcome.failed) {
      diagnostics.push({
        surface: 'claude',
        scope: requestedScope || 'all',
        code: 'CLAUDE_JSON_PROBE_FAILED',
        severity: 'blocked',
        message: `claude plugin list --json probe failed (${jsonOutcome.reason})`,
        probe: {
          command: jsonProbe.command,
          args: jsonProbe.args,
          exitCode: jsonProbe.exitCode,
          timedOut: jsonProbe.timedOut,
          stderrTail: jsonProbe.stderrTail,
        },
      });
    } else if (jsonOutcome.status === 'OK') {
      try {
        const parsed = JSON.parse(String(jsonProbe.stdout || ''));
        const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.plugins) ? parsed.plugins : null);
        if (!Array.isArray(list)) throw new Error('expected JSON array of plugin records');
        jsonEntries = list.filter((entry) => entry && typeof entry === 'object' && isDhpkPluginId(entry.id) && recordAppliesToProject(entry, projectRoot));
      } catch (error) {
        jsonOutcome = { status: 'PROBE_FAILED', reason: 'host-cli-unparseable', failed: true };
        diagnostics.push({
          surface: 'claude',
          scope: requestedScope || 'all',
          code: 'CLAUDE_JSON_PROBE_UNPARSEABLE',
          severity: 'blocked',
          message: `claude plugin list --json returned unparseable output: ${error.message}`,
          probe: {
            command: jsonProbe.command,
            args: jsonProbe.args,
            exitCode: jsonProbe.exitCode,
            stdoutTail: jsonProbe.stdoutTail,
          },
        });
      }
    }
  }

  for (const entry of jsonEntries) {
    if (entry.readFromFolder) effectivePaths.push(inspectLink(entry.readFromFolder, { label: `cli-json-readFromFolder:${entry.id}`, scope: entry.scope || 'user' }));
    if (entry.installPath) effectivePaths.push(inspectLink(entry.installPath, { label: `cli-json-installPath:${entry.id}`, scope: entry.scope || 'user' }));
  }

  // Side-by-side dual evidence comparison: plain text vs JSON vs installed_plugins.json
  const disagreements = [];
  const keySet = new Set();
  const keyOf = (id, scope) => `${id}::${scope || 'user'}`;
  for (const entry of textEntries) keySet.add(keyOf(entry.id, entry.scope || 'user'));
  for (const entry of jsonEntries) keySet.add(keyOf(entry.id, entry.scope || 'user'));
  for (const entry of registryEntries) keySet.add(keyOf(entry.id, entry.scope || 'user'));

  for (const key of [...keySet].sort()) {
    const [pluginId, scope] = key.split('::');
    const textMatch = textEntries.find((entry) => entry.id === pluginId && (entry.scope || 'user') === scope) || null;
    const jsonMatch = jsonEntries.find((entry) => entry.id === pluginId && (entry.scope || 'user') === scope) || null;
    const regMatch = registryEntries.find((entry) => entry.id === pluginId && (entry.scope || 'user') === scope) || null;

    const evidence = {
      text: textMatch ? { raw: textMatch.rawBlock, parsed: textMatch } : null,
      json: jsonMatch ? { raw: jsonMatch } : null,
      registry: regMatch ? { raw: regMatch.raw } : null,
    };

    const versions = new Set();
    if (textMatch && textMatch.version) versions.add(textMatch.version);
    if (jsonMatch && jsonMatch.version) versions.add(jsonMatch.version);
    if (jsonMatch && jsonMatch.folderVersion) versions.add(jsonMatch.folderVersion);
    if (regMatch && regMatch.version) versions.add(regMatch.version);

    if (versions.size > 1) {
      const diag = {
        surface: 'claude',
        scope,
        pluginId,
        code: 'VERSION_DRIFT',
        severity: 'drift',
        message: `${pluginId} (${scope}) version disagrees across sources: ${[...versions].join(' vs ')}`,
        evidence,
      };
      disagreements.push(diag);
      diagnostics.push(diag);
    }

    const textSource = textMatch ? (textMatch.readFromFolder || textMatch.path || null) : null;
    const jsonSource = jsonMatch ? (jsonMatch.readFromFolder || jsonMatch.installPath || null) : null;
    const regSource = regMatch ? (regMatch.installPath || null) : null;
    const resolvedText = textSource ? normalizePathSafe(textSource) : null;
    const resolvedJson = jsonSource ? normalizePathSafe(jsonSource) : null;
    const resolvedJsonInstall = jsonMatch && jsonMatch.installPath ? normalizePathSafe(jsonMatch.installPath) : null;
    const resolvedReg = regSource ? normalizePathSafe(regSource) : null;

    const textVsJsonMismatch = Boolean(resolvedText && resolvedJson && resolvedText !== resolvedJson)
      || Boolean(textMatch && jsonMatch && Boolean(textSource) !== Boolean(jsonMatch.readFromFolder || jsonMatch.path)
        && resolvedText !== resolvedJson);
    const jsonVsRegInstallMismatch = Boolean(resolvedJsonInstall && resolvedReg && resolvedJsonInstall !== resolvedReg);
    const folderVsCacheMismatch = Boolean(
      jsonMatch && jsonMatch.readFromFolder && jsonMatch.installPath
      && !textMatch && normalizePathSafe(jsonMatch.readFromFolder) !== normalizePathSafe(jsonMatch.installPath),
    );

    if (textVsJsonMismatch || jsonVsRegInstallMismatch || folderVsCacheMismatch) {
      const diag = {
        surface: 'claude',
        scope,
        pluginId,
        code: 'SOURCE_MISMATCH',
        severity: 'drift',
        message: `${pluginId} (${scope}) effective source path disagrees (${[textSource, jsonSource, regSource].filter(Boolean).join(' vs ')})`,
        evidence,
      };
      disagreements.push(diag);
      diagnostics.push(diag);
    }

    if (textMatch && jsonMatch && textMatch.enabled !== null && typeof jsonMatch.enabled === 'boolean' && textMatch.enabled !== jsonMatch.enabled) {
      diagnostics.push({
        surface: 'claude',
        scope,
        pluginId,
        code: 'ENABLED_STATE_MISMATCH',
        severity: 'drift',
        message: `${pluginId} (${scope}) enabled state disagrees between text (${textMatch.enabled}) and JSON (${jsonMatch.enabled})`,
        evidence,
      });
    }
  }

  // Project-local .claude/skills bindings, version pins, Asset Receipt (#1585), shared caches
  effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.claude', 'skills'), { label: 'claude-project-skills', scope: 'project' }));
  effectivePaths.push(...scanDirectoryLinks(path.join(home, '.claude', 'skills'), { label: 'claude-user-skills', scope: 'user' }));

  const activeVersions = new Set();
  for (const r of [...registryEntries, ...jsonEntries, ...textEntries]) {
    if (r && r.version) activeVersions.add(r.version);
    if (r && r.folderVersion) activeVersions.add(r.folderVersion);
  }

  const caches = inspectClaudeCaches(home, activeVersions, sourceVersion);
  for (const cache of caches) {
    effectivePaths.push(cache.linkHealth);
    if (cache.stale && !cache.orphaned) {
      diagnostics.push({
        surface: 'claude',
        scope: 'user',
        code: 'CACHE_DRIFT',
        severity: 'drift',
        message: `Stale Claude plugin cache ${cache.package}@${cache.version} at ${cache.path}`,
        affectedPaths: [cache.path],
      });
    }
  }

  const assetReceipt = inspectAssetReceipt(projectRoot, sourceVersion);
  const pinCheckVersions = activeVersions.size > 0
    ? [...activeVersions]
    : [
      ...(assetReceipt.sourceVersion ? [assetReceipt.sourceVersion] : []),
      ...(sourceVersion ? [sourceVersion] : []),
    ];
  const versionPins = checkVersionPins(projectRoot, pinCheckVersions);
  effectivePaths.push(versionPins.linkHealth);
  if (!versionPins.valid) {
    diagnostics.push({
      surface: 'claude',
      scope: 'project',
      code: versionPins.state === 'broken-link' ? 'BROKEN_LINK' : 'INVALID_VERSION_PIN',
      severity: versionPins.state === 'broken-link' ? 'drift' : 'blocked',
      message: `Invalid version pin file at ${versionPins.path}: ${versionPins.error || versionPins.state}`,
      affectedPaths: [versionPins.path],
    });
  } else if (versionPins.flagged.length > 0) {
    diagnostics.push({
      surface: 'claude',
      scope: 'project',
      code: 'VERSION_PIN_MISMATCH',
      severity: 'drift',
      message: `Version pin ${versionPins.path} flagged: ${versionPins.flagged.map((f) => `${f.version}(${f.status})`).join(', ')}`,
      affectedPaths: [versionPins.path],
    });
  }

  if (assetReceipt.present) {
    if (!assetReceipt.valid || assetReceipt.state === 'BLOCKED') {
      diagnostics.push({
        surface: 'claude',
        scope: 'project',
        code: 'INVALID_ASSET_RECEIPT',
        severity: 'blocked',
        message: assetReceipt.error || `Asset Receipt at ${assetReceipt.path} is blocked`,
        affectedPaths: [assetReceipt.path, ...(assetReceipt.unsafePaths || [])],
      });
    } else if (assetReceipt.state === 'STALE') {
      diagnostics.push({
        surface: 'claude',
        scope: 'project',
        code: 'ASSET_RECEIPT_STALE',
        severity: 'drift',
        message: `Asset Receipt at ${assetReceipt.path} reports drift (sourceVersion=${assetReceipt.sourceVersion || 'unknown'}, modified=${assetReceipt.summary.modified}, missing=${assetReceipt.summary.missing}, legacyConflicts=${assetReceipt.legacyConflicts.length})`,
        affectedPaths: [assetReceipt.path, ...assetReceipt.modifiedPaths, ...assetReceipt.missingPaths, ...assetReceipt.legacyConflicts],
      });
    }
  }

  diagnostics.push(...collectLinkDiagnostics(effectivePaths, 'claude'));

  // Per-scope rollup
  const scopes = {};
  for (const scope of ['user', 'project', 'local', 'managed']) {
    if (!scopeMatchesRequest(requestedScope, scope)) continue;
    const reg = registryEntries.filter((entry) => entry.scope === scope);
    const json = jsonEntries.filter((entry) => (entry.scope || 'user') === scope);
    const txt = textEntries.filter((entry) => (entry.scope || 'user') === scope);
    const primary = reg[0] || json[0] || txt[0] || null;
    if (!primary && scope === 'managed') continue;
    const installed = Boolean(primary);
    const installedVersion = (primary && (primary.version || primary.folderVersion)) || null;
    const enabled = json[0] && typeof json[0].enabled === 'boolean'
      ? json[0].enabled
      : (reg[0] && typeof reg[0].enabled === 'boolean' ? reg[0].enabled : (txt[0] ? txt[0].enabled : null));
    const resolvedPath = (json[0] && (json[0].readFromFolder || json[0].installPath))
      || (txt[0] && (txt[0].readFromFolder || txt[0].path))
      || (reg[0] && reg[0].installPath)
      || null;
    if (installed && installedVersion && sourceVersion && installedVersion !== sourceVersion
      && !diagnostics.some((d) => d.code === 'VERSION_DRIFT' && d.scope === scope)) {
      diagnostics.push({
        surface: 'claude',
        scope,
        pluginId: primary.id,
        code: 'VERSION_DRIFT',
        severity: 'drift',
        message: `${primary.id} (${scope}) installed version ${installedVersion} differs from source version ${sourceVersion}`,
      });
    }
    scopes[scope] = {
      installed,
      enabled,
      installedVersion,
      sourceVersion,
      sourceSha: (reg[0] && reg[0].gitCommitSha) || sourceCommitSha || null,
      resolvedPath: resolvedPath ? normalizePathSafe(resolvedPath) : null,
      rawPath: resolvedPath,
      linkHealth: resolvedPath ? inspectLink(resolvedPath, { label: `claude:${scope}`, scope }) : null,
    };
  }

  // Dual-layer duplicate discovery (#1583)
  const claudeDiscovery = discoveryReport && discoveryReport.hosts ? discoveryReport.hosts.claude : null;
  if (claudeDiscovery) {
    if (claudeDiscovery.baseline && claudeDiscovery.baseline.verdict === 'DUPLICATE') {
      diagnostics.push({
        surface: 'claude',
        scope: 'all',
        code: 'DUPLICATE_DISCOVERY',
        severity: 'drift',
        message: `Claude baseline duplicate discovery detected ${claudeDiscovery.baseline.duplicates.length} duplicate skill(s)`,
        affectedPaths: claudeDiscovery.baseline.duplicates.flatMap((d) => d.entries.map((e) => e.path)),
      });
    }
    if (claudeDiscovery.live && claudeDiscovery.live.verdict === 'DUPLICATE') {
      diagnostics.push({
        surface: 'claude',
        scope: 'all',
        code: 'DUPLICATE_DISCOVERY',
        severity: 'drift',
        message: 'Claude live plugin listing has overlapping dhpk and dhpk-lite plugins enabled',
        affectedPaths: claudeDiscovery.live.duplicates.flatMap((d) => d.entries.map((e) => e.path).filter(Boolean)),
      });
    }
  }

  const hasBlocked = diagnostics.some((d) => d.severity === 'blocked');
  const hasDrift = diagnostics.some((d) => d.severity === 'drift');
  const anyInstalled = Object.values(scopes).some((s) => s.installed) || assetReceipt.present;
  const state = hasBlocked ? 'BLOCKED' : (hasDrift ? 'DRIFT' : (anyInstalled ? 'CURRENT' : 'ABSENT'));

  return {
    surface: 'claude',
    state,
    installed: anyInstalled,
    enabled: Object.values(scopes).some((s) => s.enabled === true) ? true : (anyInstalled ? false : null),
    source: { version: sourceVersion, commitSha: sourceCommitSha },
    marketplace: marketplaceInfo,
    scopes,
    effectivePaths: effectivePaths.filter((item) => item && item.exists),
    caches,
    versionPins,
    assetReceipt,
    boundaryBlockers: [],
    collisions: [],
    discovery: claudeDiscovery,
    cli: {
      text: {
        status: textOutcome.status,
        reason: textOutcome.reason,
        probe: textProbe ? hostCliProbeEvidence(textProbe, redactSensitiveText) : null,
        raw: textProbe ? textProbe.stdout : null,
        entries: textEntries,
      },
      json: {
        status: jsonOutcome.status,
        reason: jsonOutcome.reason,
        probe: jsonProbe ? hostCliProbeEvidence(jsonProbe, redactSensitiveText) : null,
        raw: jsonEntries,
      },
      registry: {
        path: installedFile,
        present: installedRead.present,
        valid: installedRead.valid,
        entries: registryEntries,
      },
      disagreements,
    },
    diagnostics,
    remediation,
  };
}

function legacyHostTransactionBlockers(projectRoot, hostDir, surface) {
  const blockers = [];
  const directory = path.join(projectRoot, hostDir);
  let names;
  try {
    names = fs.readdirSync(directory).sort();
  } catch (_) {
    return blockers;
  }
  for (const name of names) {
    const match = LEGACY_JOURNAL_NAME.exec(name);
    if (!match) continue;
    const journalPath = path.join(directory, name);
    const relPath = `${hostDir}/${name}`;
    let phase = 'unreadable';
    let journalVersion = null;
    try {
      const doc = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      phase = HOST_JOURNAL_PHASES.has(doc && doc.phase) ? doc.phase : 'unreadable';
      if (doc && typeof doc.plugin_version === 'string') journalVersion = doc.plugin_version;
    } catch (_) {
      phase = 'unreadable';
    }
    if (phase === 'active' || phase === 'rollback_incomplete' || phase === 'unreadable') {
      blockers.push(planBoundary.blocker({
        reasonCode: 'LEGACY_HOST_JOURNAL',
        journalVersion,
        message: `${relPath}: ${surface} transaction ${match[1]} is ${phase}`,
        affectedPaths: [relPath],
        remediation: planBoundary.transitionRecoverRemediation({
          transitionVersion: '0.74.x',
          recoverCommand: 'dhpk-install --recover',
        }),
      }));
    }
  }
  return blockers;
}

function nativeReceiptBoundaryBlockers(projectRoot, hostDir, profiles, surface) {
  const relPath = `${hostDir}/.dhpk-installed.json`;
  const receiptPath = path.join(projectRoot, relPath);
  const stat = lstatOrNull(receiptPath);
  if (!stat) return [];
  const parsed = readBoundedJson(receiptPath);
  if (!parsed.valid || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    return [planBoundary.blocker({
      reasonCode: 'INVALID_RECEIPT',
      message: `${relPath}: ${parsed.error || 'unreadable or unsafe receipt'}`,
      affectedPaths: [relPath],
      remediation: planBoundary.manualRemediation(`Inspect ${relPath}; this release cannot read it.`),
    })];
  }
  const receipt = parsed.data;
  const receiptVersion = typeof receipt.plugin_version === 'string' ? receipt.plugin_version : null;
  const blockers = [];
  if (!Object.prototype.hasOwnProperty.call(receipt, 'fingerprint_algorithm')) {
    blockers.push(planBoundary.blocker({
      reasonCode: 'MISSING_FINGERPRINT_ALGORITHM',
      receiptVersion,
      message: `${relPath}: receipt is missing fingerprint_algorithm`,
      affectedPaths: [relPath],
      remediation: planBoundary.versionBoundaryRemediation({
        updateCommand: `dhpk-install ${surface} update --project-root ${planBoundary.shellWord(projectRoot)}`,
        uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
      }),
    }));
  } else if (receipt.fingerprint_algorithm !== 'tree-merkle-v1') {
    blockers.push(planBoundary.blocker({
      reasonCode: 'UNSUPPORTED_FINGERPRINT_ALGORITHM',
      receiptVersion,
      message: `${relPath}: unsupported fingerprint_algorithm '${receipt.fingerprint_algorithm}'`,
      affectedPaths: [relPath],
      remediation: planBoundary.versionBoundaryRemediation({
        updateCommand: `dhpk-install ${surface} update --project-root ${planBoundary.shellWord(projectRoot)}`,
        uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
      }),
    }));
  }
  const legacyProfiles = profiles && profiles.legacy_profiles ? profiles.legacy_profiles : {};
  if (typeof receipt.profileId === 'string' && receipt.profileId !== 'common'
    && Object.prototype.hasOwnProperty.call(legacyProfiles, receipt.profileId)) {
    blockers.push(planBoundary.blocker({
      reasonCode: 'LEGACY_PROFILE_UPDATE_UNSUPPORTED',
      receiptVersion,
      message: `${relPath}: receipt uses retired profile '${receipt.profileId}'`,
      affectedPaths: [relPath],
      remediation: planBoundary.retiredProfileRemediation({
        uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
        installCommand: `dhpk-install ${surface} install --project-root ${planBoundary.shellWord(projectRoot)}`,
      }),
    }));
  }
  return blockers;
}

function projectionBoundaryBlockers(projectRoot, surface) {
  return inspectProjectProjectionBoundaries({ projectRoot }).map((finding) => {
    const base = { message: `${finding.path}: ${finding.message}`, affectedPaths: [finding.path] };
    const receiptVersion = finding.generatorVersion || finding.sourceVersion || null;
    switch (finding.kind) {
      case 'journal-held':
        return planBoundary.blocker({
          ...base,
          reasonCode: 'HELD_PROJECTION_JOURNAL',
          journalVersion: finding.schema,
          remediation: planBoundary.transitionRecoverRemediation({
            transitionVersion: finding.recoveryRelease,
            recoverCommand: 'dhpk-install --recover',
          }),
        });
      case 'journal-schema':
        return planBoundary.blocker({
          ...base,
          reasonCode: 'UNSUPPORTED_PROJECTION_TRANSACTION',
          journalVersion: finding.schema,
          remediation: finding.recoveryRelease
            ? planBoundary.transitionRecoverRemediation({
              transitionVersion: finding.recoveryRelease,
              recoverCommand: 'dhpk-install --recover',
            })
            : planBoundary.manualRemediation(`Inspect ${finding.path}; no release recovers this schema.`),
        });
      case 'receipt-fingerprint-missing':
        return planBoundary.blocker({
          ...base,
          reasonCode: 'MISSING_FINGERPRINT_ALGORITHM',
          receiptVersion,
          remediation: planBoundary.versionBoundaryRemediation({
            updateCommand: `dhpk-install ${surface} update --project-root ${planBoundary.shellWord(projectRoot)}`,
            uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
          }),
        });
      case 'receipt-fingerprint-unsupported':
        return planBoundary.blocker({
          ...base,
          reasonCode: 'UNSUPPORTED_FINGERPRINT_ALGORITHM',
          receiptVersion,
          remediation: planBoundary.versionBoundaryRemediation({
            updateCommand: `dhpk-install ${surface} update --project-root ${planBoundary.shellWord(projectRoot)}`,
            uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
          }),
        });
      case 'receipt-generator-superseded':
        return planBoundary.blocker({
          ...base,
          reasonCode: 'SUPERSEDED_GENERATOR_VERSION',
          receiptVersion,
          remediation: planBoundary.versionBoundaryRemediation({
            updateCommand: `dhpk-install ${surface} update --project-root ${planBoundary.shellWord(projectRoot)}`,
            uninstallCommand: `dhpk-install ${surface} uninstall --project-root ${planBoundary.shellWord(projectRoot)}`,
          }),
        });
      default:
        return planBoundary.blocker({
          ...base,
          reasonCode: finding.kind === 'receipt-unreadable' ? 'INVALID_SHARED_PROJECTION_RECEIPT' : 'UNSAFE_SHARED_PROJECTION',
          remediation: planBoundary.manualRemediation(`Inspect ${finding.path}; this release cannot read it.`),
        });
    }
  });
}

function inspectProjectHostSyncSurface({
  surface,
  hostKind,
  hostDir,
  projectRoot,
  home,
  codexHome,
  root,
  profiles,
  sourceVersion,
  sourceCommitSha,
  env,
  discoveryReport,
}) {
  const diagnostics = [];
  const effectivePaths = [];
  const boundaryBlockers = [
    ...legacyHostTransactionBlockers(projectRoot, hostDir, surface),
    ...projectionBoundaryBlockers(projectRoot, surface),
    ...nativeReceiptBoundaryBlockers(projectRoot, hostDir, profiles, surface),
  ];

  const hostPath = path.join(projectRoot, hostDir);
  const agentsPath = path.join(projectRoot, '.agents');
  const receiptPath = path.join(hostPath, '.dhpk-installed.json');
  const sharedReceiptPath = path.join(agentsPath, '.dhpk-installed.json');
  const nativeReceipt = readBoundedJson(receiptPath);
  const sharedReceipt = readBoundedJson(sharedReceiptPath);
  const hasProjectDirs = Boolean(lstatOrNull(hostPath) || lstatOrNull(agentsPath));

  let planReport = null;
  let collisions = [];
  if (hasProjectDirs && boundaryBlockers.length === 0) {
    const outcome = runCaptured(installerEnv({
      host: hostKind,
      pluginRoot: root,
      installerRoot: root,
      projectRoot,
      mode: nativeReceipt.valid && nativeReceipt.data && nativeReceipt.data.mode === 'copy' ? 'copy' : 'symlink',
      modeExplicit: Boolean(nativeReceipt.valid && nativeReceipt.data && nativeReceipt.data.mode),
      update: true,
      plan: true,
      json: true,
      historyDelegated: true,
      baseEnv: { ...env, PATH: '' },
    }));
    try {
      planReport = JSON.parse(outcome.stdout);
    } catch (_) {
      planReport = null;
    }
    if (planReport && Array.isArray(planReport.collisions)) {
      collisions = planReport.collisions;
    }
    if (planReport && planReport.verdict === 'BLOCKED' && Array.isArray(planReport.blockers)) {
      for (const blocker of planReport.blockers) {
        if (blocker.reasonCode === 'UNOWNED_COLLISION') continue;
        if (!boundaryBlockers.some((b) => b.reasonCode === blocker.reasonCode)) {
          boundaryBlockers.push(blocker);
        }
      }
    }
  }

  for (const blocker of boundaryBlockers) {
    diagnostics.push({
      surface,
      scope: 'project',
      code: blocker.reasonCode,
      severity: 'blocked',
      message: blocker.message,
      affectedPaths: blocker.affectedPaths || [],
      remediation: blocker.remediation || [],
    });
  }

  for (const collision of collisions) {
    diagnostics.push({
      surface,
      scope: 'project',
      code: 'COLLISION',
      severity: 'drift',
      message: `Collision at ${hostDir}/${collision.path} (ownership=${collision.ownership})`,
      affectedPaths: [`${hostDir}/${collision.path}`],
    });
  }

  // Symlink / legacy migrated link inspection
  if (hostKind === 'codex') {
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.codex', 'skills'), { label: 'codex-project-skills', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.codex', 'agents'), { label: 'codex-project-agents', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.agents', 'skills'), { label: 'shared-projection-skills', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(codexHome, 'skills'), { label: 'codex-user-skills', scope: 'user' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(home, '.agents', 'skills'), { label: 'user-agents-skills', scope: 'user' }));
  } else {
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.cursor', 'skills'), { label: 'cursor-project-skills', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.cursor', 'agents'), { label: 'cursor-project-agents', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.cursor', 'rules'), { label: 'cursor-project-rules', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(projectRoot, '.cursor', 'commands'), { label: 'cursor-project-commands', scope: 'project' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent'), { label: 'cursor-local-agent-plugin', scope: 'user' }));
    effectivePaths.push(...scanDirectoryLinks(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-cursor'), { label: 'cursor-local-cursor-plugin', scope: 'user' }));
  }
  diagnostics.push(...collectLinkDiagnostics(effectivePaths, surface));

  const caches = [];
  if (hostKind === 'cursor') {
    const cacheCheck = addCursorCacheDriftWarnings({ plugin_version: sourceVersion, warnings: [] }, { ...env, HOME: home });
    for (const warning of cacheCheck.warnings || []) {
      caches.push(warning);
      diagnostics.push({
        surface,
        scope: 'user',
        code: 'CACHE_DRIFT',
        severity: 'drift',
        message: `Cursor marketplace hash cache drift at ${warning.path} (cache=${warning.cache_version}, expected=${(warning.ssot_versions || []).join(',')})`,
        affectedPaths: [warning.path],
      });
    }
  }

  const installedVersion = nativeReceipt.valid && nativeReceipt.data && typeof nativeReceipt.data.plugin_version === 'string'
    ? nativeReceipt.data.plugin_version
    : (sharedReceipt.valid && sharedReceipt.data && typeof sharedReceipt.data.sourceVersion === 'string'
      ? sharedReceipt.data.sourceVersion
      : null);
  const projectInstalled = Boolean(nativeReceipt.present || sharedReceipt.present || boundaryBlockers.length > 0);
  if (projectInstalled && planReport && planReport.state === 'stale' && collisions.length === 0) {
    diagnostics.push({
      surface,
      scope: 'project',
      code: 'SURFACE_STALE',
      severity: 'drift',
      message: `${surface} project installation is stale (updates=${(planReport.updates || []).length}, missing=${(planReport.missing || []).length}, retired=${(planReport.retired || []).length})`,
    });
  } else if (projectInstalled && installedVersion && sourceVersion && installedVersion !== sourceVersion
    && !diagnostics.some((d) => d.code === 'VERSION_DRIFT' || d.code === 'SURFACE_STALE')) {
    diagnostics.push({
      surface,
      scope: 'project',
      code: 'VERSION_DRIFT',
      severity: 'drift',
      message: `${surface} installed version ${installedVersion} differs from source version ${sourceVersion}`,
    });
  }

  let userInstalled = false;
  let userVersion = null;
  if (hostKind === 'codex') {
    const userCodexReceipt = readBoundedJson(path.join(codexHome, '.dhpk-installed.json'));
    const userAgentsReceipt = readBoundedJson(path.join(home, '.agents', '.dhpk-installed.json'));
    userInstalled = userCodexReceipt.present || userAgentsReceipt.present;
    userVersion = (userCodexReceipt.valid && userCodexReceipt.data && userCodexReceipt.data.plugin_version) || null;
  } else {
    const localCursorManifest = readBoundedJsonFollow(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'));
    const localAgentManifest = readBoundedJsonFollow(path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'));
    userInstalled = localCursorManifest.present || localAgentManifest.present;
    userVersion = (localCursorManifest.valid && localCursorManifest.data && localCursorManifest.data.version)
      || (localAgentManifest.valid && localAgentManifest.data && localAgentManifest.data.version)
      || null;
  }

  const codexDiscovery = hostKind === 'codex' && discoveryReport && discoveryReport.hosts ? discoveryReport.hosts.codex : null;
  if (codexDiscovery) {
    if (codexDiscovery.baseline && codexDiscovery.baseline.verdict === 'DUPLICATE') {
      diagnostics.push({
        surface,
        scope: 'all',
        code: 'DUPLICATE_DISCOVERY',
        severity: 'drift',
        message: `Codex baseline duplicate discovery detected ${codexDiscovery.baseline.duplicates.length} duplicate skill(s)`,
        affectedPaths: codexDiscovery.baseline.duplicates.flatMap((d) => d.entries.map((e) => e.path)),
      });
    }
    if (codexDiscovery.live && codexDiscovery.live.verdict === 'DUPLICATE') {
      diagnostics.push({
        surface,
        scope: 'all',
        code: 'DUPLICATE_DISCOVERY',
        severity: 'drift',
        message: `Codex live skill listing detected ${codexDiscovery.live.duplicates.length} duplicate skill(s)`,
        affectedPaths: codexDiscovery.live.duplicates.flatMap((d) => d.entries.map((e) => e.path)),
      });
    } else if (
      codexDiscovery.live
      && codexDiscovery.live.verdict === 'UNAVAILABLE'
      && codexDiscovery.live.reason !== 'host-cli-missing'
    ) {
      diagnostics.push({
        surface,
        scope: 'all',
        code: 'CODEX_PROBE_FAILED',
        severity: 'blocked',
        message: `codex debug prompt-input probe failed (${codexDiscovery.live.reason})`,
        probe: codexDiscovery.live.probe,
      });
    }
  }

  const hasBlocked = diagnostics.some((d) => d.severity === 'blocked');
  const hasDrift = diagnostics.some((d) => d.severity === 'drift');
  const anyInstalled = projectInstalled || userInstalled || caches.length > 0;
  const state = hasBlocked ? 'BLOCKED' : (hasDrift ? 'STALE' : (anyInstalled ? 'CURRENT' : 'ABSENT'));

  const remediation = boundaryBlockers.flatMap((b) => b.remediation || []);

  return {
    surface,
    state,
    installed: anyInstalled,
    enabled: anyInstalled ? true : null,
    source: { version: sourceVersion, commitSha: sourceCommitSha },
    scopes: {
      project: {
        installed: projectInstalled,
        installedVersion,
        sourceVersion,
        sourceSha: sourceCommitSha,
        mode: nativeReceipt.valid && nativeReceipt.data ? nativeReceipt.data.mode || null : null,
        resolvedPath: projectInstalled ? normalizePathSafe(hostPath) : null,
        receipt: nativeReceipt.present ? {
          path: receiptPath,
          valid: nativeReceipt.valid,
          state: planReport ? planReport.state : (boundaryBlockers.length ? 'blocked' : null),
          profileId: nativeReceipt.data && nativeReceipt.data.profileId ? nativeReceipt.data.profileId : null,
        } : null,
        sharedProjectionReceipt: sharedReceipt.present ? {
          path: sharedReceiptPath,
          valid: sharedReceipt.valid,
          generatorVersion: sharedReceipt.data && sharedReceipt.data.generatorVersion ? sharedReceipt.data.generatorVersion : null,
        } : null,
      },
      user: {
        installed: userInstalled,
        installedVersion: userVersion,
        sourceVersion,
        resolvedPath: hostKind === 'codex'
          ? (userInstalled ? normalizePathSafe(codexHome) : null)
          : (userInstalled ? normalizePathSafe(path.join(home, '.cursor', 'plugins', 'local')) : null),
      },
    },
    effectivePaths: effectivePaths.filter((item) => item && item.exists),
    caches,
    boundaryBlockers,
    boundaryEnvelope: boundaryBlockers.length > 0 ? planBoundary.blockedEnvelope(boundaryBlockers) : null,
    collisions,
    discovery: codexDiscovery,
    diagnostics,
    remediation,
  };
}

function inspectCodexNativeSurface({
  projectRoot,
  home,
  codexHome,
  root,
  sourceVersion,
  sourceCommitSha,
  offline,
  env,
  spawn,
}) {
  const diagnostics = [];
  const effectivePaths = [];
  const packageRoot = path.join(root, 'plugins', 'dhpk');
  const pkgManifest = readBoundedJsonFollow(path.join(packageRoot, '.codex-plugin', 'plugin.json'));
  const pkgProvenance = readBoundedJsonFollow(path.join(packageRoot, 'provenance.json'));
  const packageVersion = (pkgManifest.valid && pkgManifest.data && pkgManifest.data.version)
    || (pkgProvenance.valid && pkgProvenance.data && pkgProvenance.data.sourceVersion)
    || null;

  const installedPluginsPath = path.join(codexHome, 'plugins', 'installed_plugins.json');
  const installedRead = readBoundedJson(installedPluginsPath);
  if (installedRead.present && !installedRead.valid) {
    diagnostics.push({
      surface: 'codex-native',
      scope: 'user',
      code: 'INVALID_CODEX_PLUGIN_REGISTRY',
      severity: 'blocked',
      message: `Invalid Codex installed_plugins.json: ${installedRead.error}`,
      affectedPaths: [installedPluginsPath],
    });
  }
  const registryRecords = installedRead.valid && installedRead.data && Array.isArray(installedRead.data.installed)
    ? installedRead.data.installed.filter((r) => r && r.pluginId === 'dhpk@dhpk')
    : [];
  for (const record of registryRecords) {
    if (record.installPath) effectivePaths.push(inspectLink(record.installPath, { label: 'codex-native-installPath', scope: record.scope || 'user' }));
  }

  let cliStatus = offline ? 'NOT_RUN' : 'CLI_NOT_INSTALLED';
  let cliProbe = null;
  let cliRecord = null;
  if (!offline) {
    const probeEnv = { ...env, HOME: home, CODEX_HOME: codexHome };
    const probe = runProbe('codex', ['plugin', 'list', '--json'], { cwd: projectRoot, env: probeEnv, spawn });
    cliProbe = hostCliProbeEvidence(probe, redactSensitiveText);
    const outcome = classifyProbeOutcome(probe);
    if (outcome.failed) {
      cliStatus = 'PROBE_FAILED';
      diagnostics.push({
        surface: 'codex-native',
        scope: 'user',
        code: 'CODEX_PROBE_FAILED',
        severity: 'blocked',
        message: `codex plugin list --json probe failed (${outcome.reason})`,
        probe: cliProbe,
      });
    } else if (outcome.status === 'OK') {
      try {
        const payload = JSON.parse(String(probe.stdout || ''));
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.installed)) {
          throw new Error('expected object with installed array');
        }
        const match = payload.installed.find((entry) => entry && entry.pluginId === 'dhpk@dhpk');
        if (!match) cliStatus = 'AVAILABLE';
        else {
          cliRecord = match;
          cliStatus = match.enabled === true ? 'ENABLED' : 'DISABLED';
          if (match.installPath) effectivePaths.push(inspectLink(match.installPath, { label: 'codex-cli-installPath', scope: match.scope || 'user' }));
        }
      } catch (error) {
        cliStatus = 'PROBE_FAILED';
        diagnostics.push({
          surface: 'codex-native',
          scope: 'user',
          code: 'CODEX_PROBE_UNPARSEABLE',
          severity: 'blocked',
          message: `codex plugin list --json returned unparseable output: ${error.message}`,
          probe: cliProbe,
        });
      }
    }
  }

  diagnostics.push(...collectLinkDiagnostics(effectivePaths, 'codex-native'));

  const installedVersion = (cliRecord && typeof cliRecord.version === 'string' && cliRecord.version)
    || (registryRecords[0] && typeof registryRecords[0].version === 'string' && registryRecords[0].version)
    || null;
  const installed = registryRecords.length > 0 || cliStatus === 'ENABLED' || cliStatus === 'DISABLED';
  if (installed && installedVersion && sourceVersion && installedVersion !== sourceVersion) {
    diagnostics.push({
      surface: 'codex-native',
      scope: 'user',
      code: 'VERSION_DRIFT',
      severity: 'drift',
      message: `codex-native installed version ${installedVersion} differs from source version ${sourceVersion}`,
    });
  }
  if (cliStatus === 'ENABLED' && lstatOrNull(path.join(projectRoot, '.codex', '.dhpk-installed.json'))) {
    diagnostics.push({
      surface: 'codex-native',
      scope: 'project',
      code: 'DUPLICATE_DISCOVERY',
      severity: 'drift',
      message: 'codex-native dhpk@dhpk is ENABLED alongside a project-local codex-sync receipt (.codex/.dhpk-installed.json)',
      affectedPaths: [path.join(projectRoot, '.codex', '.dhpk-installed.json')],
    });
  }

  const hasBlocked = diagnostics.some((d) => d.severity === 'blocked');
  const hasDrift = diagnostics.some((d) => d.severity === 'drift');
  const state = hasBlocked ? 'BLOCKED' : (hasDrift ? 'DRIFT' : (installed ? 'CURRENT' : 'ABSENT'));

  return {
    surface: 'codex-native',
    state,
    installed,
    enabled: cliStatus === 'ENABLED' ? true : (cliStatus === 'DISABLED' ? false : null),
    source: { version: sourceVersion, commitSha: sourceCommitSha, packageVersion },
    scopes: {
      user: {
        installed,
        enabled: cliStatus === 'ENABLED' ? true : (cliStatus === 'DISABLED' ? false : null),
        installedVersion,
        sourceVersion,
        resolvedPath: (cliRecord && cliRecord.installPath) || (registryRecords[0] && registryRecords[0].installPath) || null,
      },
    },
    effectivePaths: effectivePaths.filter((item) => item && item.exists),
    caches: [],
    boundaryBlockers: [],
    collisions: [],
    cli: { status: cliStatus, probe: cliProbe, record: cliRecord },
    diagnostics,
    remediation: [],
  };
}

function inspectAgentPluginSurface({ projectRoot, home, root, sourceVersion, sourceCommitSha }) {
  const diagnostics = [];
  const effectivePaths = [];
  const boundaryBlockers = projectionBoundaryBlockers(projectRoot, 'agent-plugin');
  for (const blocker of boundaryBlockers) {
    diagnostics.push({
      surface: 'agent-plugin',
      scope: 'project',
      code: blocker.reasonCode,
      severity: 'blocked',
      message: blocker.message,
      affectedPaths: blocker.affectedPaths || [],
      remediation: blocker.remediation || [],
    });
  }

  const onDemandDir = path.join(root, 'dist', 'on-demand', 'dhpk-agent');
  const localAgentDir = path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent');
  const homeAgentsPluginDir = path.join(home, '.agents', 'plugins', 'dhpk-agent');
  const sharedReceiptPath = path.join(projectRoot, '.agents', '.dhpk-installed.json');
  const sharedReceipt = readBoundedJson(sharedReceiptPath);

  const localManifest = readBoundedJsonFollow(path.join(localAgentDir, 'plugin.json'));
  const homeManifest = readBoundedJsonFollow(path.join(homeAgentsPluginDir, 'plugin.json'));
  const onDemandManifest = readBoundedJsonFollow(path.join(onDemandDir, 'plugin.json'));
  effectivePaths.push(
    inspectLink(localAgentDir, { label: 'agent-plugin-cursor-local', scope: 'user' }),
    inspectLink(homeAgentsPluginDir, { label: 'agent-plugin-home-agents', scope: 'user' }),
    ...scanDirectoryLinks(path.join(projectRoot, '.agents', 'skills'), { label: 'agent-plugin-shared-skills', scope: 'project' }),
  );
  diagnostics.push(...collectLinkDiagnostics(effectivePaths, 'agent-plugin'));

  const userInstalled = localManifest.present || homeManifest.present;
  const userVersion = (localManifest.valid && localManifest.data && localManifest.data.version)
    || (homeManifest.valid && homeManifest.data && homeManifest.data.version)
    || null;
  const projectInstalled = sharedReceipt.present || boundaryBlockers.length > 0;
  const projectVersion = sharedReceipt.valid && sharedReceipt.data && sharedReceipt.data.sourceVersion
    ? sharedReceipt.data.sourceVersion
    : null;
  if (userInstalled && userVersion && sourceVersion && userVersion !== sourceVersion) {
    diagnostics.push({
      surface: 'agent-plugin',
      scope: 'user',
      code: 'VERSION_DRIFT',
      severity: 'drift',
      message: `agent-plugin user version ${userVersion} differs from source version ${sourceVersion}`,
    });
  }
  if (projectInstalled && projectVersion && sourceVersion && projectVersion !== sourceVersion) {
    diagnostics.push({
      surface: 'agent-plugin',
      scope: 'project',
      code: 'VERSION_DRIFT',
      severity: 'drift',
      message: `agent-plugin project projection version ${projectVersion} differs from source version ${sourceVersion}`,
    });
  }

  const installed = userInstalled || projectInstalled;
  const hasBlocked = diagnostics.some((d) => d.severity === 'blocked');
  const hasDrift = diagnostics.some((d) => d.severity === 'drift');
  const state = hasBlocked ? 'BLOCKED' : (hasDrift ? 'DRIFT' : (installed ? 'CURRENT' : 'ABSENT'));

  return {
    surface: 'agent-plugin',
    state,
    installed,
    enabled: installed ? true : null,
    source: {
      version: sourceVersion,
      commitSha: sourceCommitSha,
      onDemandBuilt: onDemandManifest.present,
      onDemandVersion: onDemandManifest.valid && onDemandManifest.data ? onDemandManifest.data.version || null : null,
    },
    scopes: {
      project: {
        installed: projectInstalled,
        installedVersion: projectVersion,
        resolvedPath: projectInstalled ? normalizePathSafe(path.join(projectRoot, '.agents')) : null,
      },
      user: {
        installed: userInstalled,
        installedVersion: userVersion,
        resolvedPath: localManifest.present ? normalizePathSafe(localAgentDir) : (homeManifest.present ? normalizePathSafe(homeAgentsPluginDir) : null),
      },
    },
    effectivePaths: effectivePaths.filter((item) => item && item.exists),
    caches: [],
    boundaryBlockers,
    collisions: [],
    diagnostics,
    remediation: boundaryBlockers.flatMap((b) => b.remediation || []),
  };
}

function inspectAgySurface({ home, root, sourceVersion, sourceCommitSha }) {
  const diagnostics = [];
  const effectivePaths = [];
  const contract = loadAgyPathContract(root);
  const paths = resolveAgyInstallPaths(home, contract);
  const candidates = resolveAgyInstallCandidates(home, contract);
  const observations = [
    { role: 'canonical', root: candidates.canonical },
    ...candidates.legacy.map((legacyRoot, index) => ({ role: `legacy-${index + 1}`, root: legacyRoot })),
  ].map((candidate) => ({
    ...observeAgyInstallCandidate(candidate),
    linkHealth: inspectLink(candidate.root, { label: `agy:${candidate.role}`, scope: 'user' }),
  }));

  for (const obs of observations) {
    if (obs.linkHealth && obs.linkHealth.exists) effectivePaths.push(obs.linkHealth);
  }
  diagnostics.push(...collectLinkDiagnostics(effectivePaths, 'agy-plugin'));

  const existing = observations.filter((candidate) => candidate.installed);
  const onDemandAgy = path.join(root, 'dist', 'on-demand', 'dhpk-agy');
  let targetInspection = null;
  if (fs.existsSync(path.join(onDemandAgy, 'provenance.json'))) {
    try {
      targetInspection = inspectAgyInstallTargets({ sourceRoot: onDemandAgy, homeDirectory: home, contract });
    } catch (_) {
      targetInspection = null;
    }
  }

  let installedVersion = null;
  let classification = 'ABSENT';
  if (existing.length > 1) {
    classification = 'AMBIGUOUS_TARGETS';
    diagnostics.push({
      surface: 'agy-plugin',
      scope: 'user',
      code: 'AMBIGUOUS_TARGETS',
      severity: 'blocked',
      message: `AGY has multiple competing targets: ${existing.map((c) => c.root).join(', ')}`,
      affectedPaths: existing.map((c) => c.root),
    });
  } else if (existing.length === 1) {
    const selected = existing[0];
    classification = selected.classification;
    const prov = readBoundedJsonFollow(path.join(selected.root, 'provenance.json'));
    const manifest = readBoundedJsonFollow(path.join(selected.root, 'plugin.json'));
    installedVersion = (prov.valid && prov.data && prov.data.sourceVersion)
      || (manifest.valid && manifest.data && manifest.data.version)
      || null;
    if (['FOREIGN_CHECKOUT', 'INVALID_RECEIPT', 'MODIFIED_MANAGED', 'UNOWNED_TARGET', 'UNSAFE_TARGET', 'LEGACY_UNBOUND'].includes(classification)) {
      diagnostics.push({
        surface: 'agy-plugin',
        scope: 'user',
        code: classification,
        severity: 'blocked',
        message: selected.reason || `AGY target at ${selected.root} is blocked (${classification})`,
        affectedPaths: [selected.root],
      });
    } else if (selected.role !== 'canonical') {
      diagnostics.push({
        surface: 'agy-plugin',
        scope: 'user',
        code: 'LEGACY_MIGRATED_LINK',
        severity: 'drift',
        message: `AGY installation is at legacy path ${selected.root} instead of ${paths.canonical}`,
        affectedPaths: [selected.root],
      });
    } else if (targetInspection && targetInspection.state === 'STALE') {
      diagnostics.push({
        surface: 'agy-plugin',
        scope: 'user',
        code: 'SURFACE_STALE',
        severity: 'drift',
        message: `AGY installation at ${selected.root} is stale compared to ${onDemandAgy}`,
        affectedPaths: [selected.root],
      });
    } else if (installedVersion && sourceVersion && installedVersion !== sourceVersion) {
      diagnostics.push({
        surface: 'agy-plugin',
        scope: 'user',
        code: 'VERSION_DRIFT',
        severity: 'drift',
        message: `AGY installed version ${installedVersion} differs from source version ${sourceVersion}`,
        affectedPaths: [selected.root],
      });
    }
  }

  const hasBlocked = diagnostics.some((d) => d.severity === 'blocked');
  const hasDrift = diagnostics.some((d) => d.severity === 'drift');
  const installed = existing.length > 0;
  const state = hasBlocked ? 'BLOCKED' : (hasDrift ? 'DRIFT' : (installed ? 'CURRENT' : 'ABSENT'));

  return {
    surface: 'agy-plugin',
    state,
    classification,
    installed,
    enabled: installed ? true : null,
    source: { version: sourceVersion, commitSha: sourceCommitSha },
    scopes: {
      user: {
        installed,
        installedVersion,
        sourceVersion,
        resolvedPath: existing[0] ? normalizePathSafe(existing[0].root) : null,
        canonicalPath: paths.canonical,
        legacyPaths: paths.legacy,
      },
    },
    candidates: observations,
    effectivePaths: effectivePaths.filter((item) => item && item.exists),
    caches: [],
    boundaryBlockers: [],
    collisions: [],
    diagnostics,
    remediation: [],
  };
}

function inventorySkillNames(inventory) {
  const names = new Set();
  for (const skill of (inventory && Array.isArray(inventory.skills) ? inventory.skills : [])) {
    if (!skill || typeof skill !== 'object') continue;
    if (typeof skill.name === 'string') names.add(skill.name);
    if (typeof skill.id === 'string') names.add(skill.id);
  }
  return names;
}

function inspectStatus({
  request,
  root,
  inventory,
  profiles,
  sourceVersion,
  plan = null,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const projectRoot = path.resolve(request.projectRoot || process.cwd());
  const home = path.resolve(env.HOME || os.homedir());
  const codexHome = path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
  const offline = Boolean(request.offline);
  const strict = Boolean(request.strict);
  const requestedSurface = request.all ? null : request.surface;
  const requestedScope = request.scope || null;
  const sourceCommitSha = readGitHeadSha(root);

  const selectedSurfaces = request.all ? [...ALL_SURFACES] : [requestedSurface];
  const needClaudeDiscovery = selectedSurfaces.includes('claude');
  const needCodexDiscovery = selectedSurfaces.includes('codex-sync') || selectedSurfaces.includes('codex-native');
  const discoveryHosts = [
    ...(needClaudeDiscovery ? ['claude'] : []),
    ...(needCodexDiscovery ? ['codex'] : []),
  ];

  // Collect duplicate-discovery probes once; claude result is reused below if offline/unneeded
  const probes = {};
  if (!offline && needCodexDiscovery) {
    probes.codex = runProbe('codex', ['debug', 'prompt-input'], {
      cwd: projectRoot,
      env: { ...env, HOME: home, CODEX_HOME: codexHome },
      spawn,
    });
  }

  // Run Claude surface first if selected so its `claude plugin list --json` probe feeds duplicate-discovery too
  let claudeReport = null;
  if (needClaudeDiscovery) {
    let preJsonProbe = null;
    if (!offline) {
      preJsonProbe = runProbe('claude', ['plugin', 'list', '--json'], { cwd: projectRoot, env: { ...env, HOME: home }, spawn });
      probes.claude = preJsonProbe;
    }
    const claudeDiscoveryPre = createDuplicateDiscoveryReport({
      projectRoot,
      home,
      codexHome,
      hosts: ['claude'],
      offline,
      inventoryNames: inventorySkillNames(inventory),
      probes,
    });
    claudeReport = inspectClaudeSurface({
      projectRoot,
      home,
      sourceVersion,
      sourceCommitSha,
      requestedScope,
      offline,
      env,
      spawn,
      discoveryReport: claudeDiscoveryPre,
      preJsonProbe,
    });
  }

  const discoveryReport = discoveryHosts.length > 0
    ? createDuplicateDiscoveryReport({
      projectRoot,
      home,
      codexHome,
      hosts: discoveryHosts,
      offline,
      inventoryNames: inventorySkillNames(inventory),
      probes,
    })
    : null;

  const surfaces = {};
  for (const surface of selectedSurfaces) {
    if (surface === 'claude') {
      surfaces.claude = claudeReport;
    } else if (surface === 'codex-sync') {
      surfaces['codex-sync'] = inspectProjectHostSyncSurface({
        surface: 'codex-sync',
        hostKind: 'codex',
        hostDir: '.codex',
        projectRoot,
        home,
        codexHome,
        root,
        profiles,
        sourceVersion,
        sourceCommitSha,
        env,
        discoveryReport,
      });
    } else if (surface === 'cursor') {
      surfaces.cursor = inspectProjectHostSyncSurface({
        surface: 'cursor',
        hostKind: 'cursor',
        hostDir: '.cursor',
        projectRoot,
        home,
        codexHome,
        root,
        profiles,
        sourceVersion,
        sourceCommitSha,
        env,
        discoveryReport,
      });
    } else if (surface === 'codex-native') {
      surfaces['codex-native'] = inspectCodexNativeSurface({
        projectRoot,
        home,
        codexHome,
        root,
        sourceVersion,
        sourceCommitSha,
        offline,
        env,
        spawn,
      });
    } else if (surface === 'agent-plugin') {
      surfaces['agent-plugin'] = inspectAgentPluginSurface({
        projectRoot,
        home,
        root,
        sourceVersion,
        sourceCommitSha,
      });
    } else if (surface === 'agy-plugin') {
      surfaces['agy-plugin'] = inspectAgySurface({
        home,
        root,
        sourceVersion,
        sourceCommitSha,
      });
    }
  }

  const diagnostics = [];
  const remediation = [];
  for (const surfaceReport of Object.values(surfaces)) {
    diagnostics.push(...(surfaceReport.diagnostics || []));
    remediation.push(...(surfaceReport.remediation || []));
  }

  const assetReceipt = surfaces.claude
    ? surfaces.claude.assetReceipt
    : inspectAssetReceipt(projectRoot, sourceVersion);
  const versionPins = surfaces.claude
    ? surfaces.claude.versionPins
    : checkVersionPins(projectRoot, []);

  // When running status --all without claude selected? (claude IS selected in --all, so covered above)
  const blockedDiagnostics = diagnostics.filter((d) => d.severity === 'blocked');
  const driftDiagnostics = diagnostics.filter((d) => d.severity === 'drift');
  const duplicateDiagnostics = diagnostics.filter((d) => d.code === 'DUPLICATE_DISCOVERY');

  const counts = {
    surfaces: selectedSurfaces.length,
    installed: Object.values(surfaces).filter((s) => s.installed).length,
    current: Object.values(surfaces).filter((s) => s.state === 'CURRENT').length,
    stale: Object.values(surfaces).filter((s) => s.state === 'STALE' || s.state === 'DRIFT').length,
    absent: Object.values(surfaces).filter((s) => s.state === 'ABSENT').length,
    blocked: Object.values(surfaces).filter((s) => s.state === 'BLOCKED').length,
    drift: driftDiagnostics.length,
    duplicates: duplicateDiagnostics.length,
  };

  const summaryVerdict = blockedDiagnostics.length > 0
    ? 'BLOCKED'
    : (driftDiagnostics.length > 0 ? 'DRIFT' : (counts.installed > 0 ? 'CURRENT' : 'ABSENT'));
  const lifecycleVerdict = blockedDiagnostics.length > 0 ? 'BLOCKED' : 'INSTALL_PASS';

  let exitCode = 0;
  if (strict) {
    if (blockedDiagnostics.length > 0) exitCode = 2;
    else if (driftDiagnostics.length > 0) exitCode = 1;
  }

  return Object.freeze({
    schema: STATUS_SCHEMA,
    mode: request.all ? 'all' : 'single',
    strict,
    offline,
    projectRoot,
    requestedSurface,
    requestedScope,
    source: {
      version: sourceVersion,
      commitSha: sourceCommitSha,
      root,
    },
    request,
    plan,
    lifecycle: Object.freeze({ verdict: lifecycleVerdict }),
    summary: Object.freeze({
      verdict: summaryVerdict,
      counts,
      blockedReasons: [...new Set(blockedDiagnostics.map((d) => d.code))],
      driftReasons: [...new Set(driftDiagnostics.map((d) => d.code))],
    }),
    surfaces,
    ...(requestedSurface ? { surfaceReport: surfaces[requestedSurface] } : {}),
    assetReceipt,
    versionPins,
    discovery: discoveryReport,
    diagnostics,
    remediation,
    mutation: Object.freeze({ performed: false }),
    exitCode,
  });
}

function formatStatusReport(report) {
  const lines = [];
  const label = report.mode === 'all' ? 'all' : report.requestedSurface;
  const sha = report.source.commitSha ? report.source.commitSha.slice(0, 12) : 'unknown';
  lines.push(`dhpk-install status (${label}) verdict=${report.summary.verdict} source=${report.source.version} (${sha}) project=${report.projectRoot}${report.offline ? ' [offline]' : ''}${report.strict ? ' [strict]' : ''}`);
  for (const [name, surface] of Object.entries(report.surfaces)) {
    lines.push(`- ${name}: state=${surface.state} installed=${surface.installed} enabled=${surface.enabled === null ? 'n/a' : surface.enabled}`);
    for (const [scopeName, scope] of Object.entries(surface.scopes || {})) {
      const parts = [`    scope=${scopeName}`, `installed=${scope.installed}`];
      if (scope.installedVersion) parts.push(`version=${scope.installedVersion}`);
      if (scope.sourceSha) parts.push(`sha=${scope.sourceSha.slice(0, 12)}`);
      if (scope.enabled !== undefined && scope.enabled !== null) parts.push(`enabled=${scope.enabled}`);
      if (scope.resolvedPath) parts.push(`path=${scope.resolvedPath}`);
      lines.push(parts.join(' '));
    }
    if (surface.cli && Array.isArray(surface.cli.disagreements) && surface.cli.disagreements.length > 0) {
      for (const item of surface.cli.disagreements) {
        lines.push(`    [${item.code}] ${item.message}`);
        if (item.evidence && item.evidence.text) {
          lines.push('    --- raw text evidence ---');
          lines.push(item.evidence.text.raw);
        }
        if (item.evidence && item.evidence.json) {
          lines.push('    --- raw json evidence ---');
          lines.push(JSON.stringify(item.evidence.json.raw, null, 2));
        }
      }
    }
    for (const diag of surface.diagnostics || []) {
      if (diag.code === 'VERSION_DRIFT' || diag.code === 'SOURCE_MISMATCH') {
        if (!surface.cli || !surface.cli.disagreements || !surface.cli.disagreements.includes(diag)) {
          lines.push(`    [${diag.code}] ${diag.message}`);
        }
      } else {
        lines.push(`    [${diag.code}] (${diag.severity}) ${diag.message}`);
      }
    }
  }
  if (report.assetReceipt && report.assetReceipt.present) {
    lines.push(`- asset-receipt: state=${report.assetReceipt.state} valid=${report.assetReceipt.valid} version=${report.assetReceipt.sourceVersion || 'n/a'} entries=${report.assetReceipt.entryCount}`);
  }
  if (report.versionPins && report.versionPins.present) {
    lines.push(`- version-pins: state=${report.versionPins.state} path=${report.versionPins.path}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  STATUS_SCHEMA,
  ALL_SURFACES,
  parseClaudeTextPluginList,
  inspectStatus,
  formatStatusReport,
};
