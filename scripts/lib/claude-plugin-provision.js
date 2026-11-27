'use strict';

// Host I/O for ADR-0039: the one place that decides whether the official Claude
// plugin dhpk@dhpk is effectively enabled for a consumer project and which Skill
// Identities its verified package catalog provides. Everything here is read-only;
// the project publisher consumes the resulting provision object and never spawns
// a process itself.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { terminateProcessGroup } = require('./bounded-child-process');
const { readFileBounded } = require('./bounded-filesystem');
const { hostCliProbeEvidence, runHostCliProbe } = require('./host-cli-probe');
const { redactSensitiveText } = require('./redaction');

const CLAUDE_PLUGIN_ID = 'dhpk@dhpk';
const CLAUDE_PLUGIN_PROVISION_SCHEMA = 'dhpk.claude-plugin-provision.v1';
const CLAUDE_PLUGIN_CATALOG_SCHEMA = 'dhpk.claude-marketplace-catalog.v1';
const CLAUDE_PLUGIN_STATUSES = Object.freeze([
  'ENABLED', 'DISABLED', 'NOT_APPLICABLE', 'ABSENT', 'INACTIVE', 'CLI_NOT_INSTALLED', 'UNKNOWN',
]);
const PROBE_SOURCE = 'claude-plugin-list';
const QUERY_TIMEOUT_MS = 30000;
const QUERY_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MANIFEST_LIMIT_BYTES = 1024 * 1024;
const CATALOG_LIMIT_BYTES = 4 * 1024 * 1024;
const SKILL_LIMIT_BYTES = 4 * 1024 * 1024;
const APPLICABLE_SCOPES = Object.freeze(['user', 'managed', 'project', 'local']);
const PROJECT_SCOPES = Object.freeze(['project', 'local']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function realpathOrResolve(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (_) {
    return path.resolve(candidate);
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function unknown(reason) {
  return { status: 'UNKNOWN', records: [], reason };
}

function recordApplies(record, projectRoot) {
  if (record.scope === 'user' || record.scope === 'managed') return true;
  return isInside(realpathOrResolve(record.projectPath), realpathOrResolve(projectRoot));
}

// Pure classification of `claude plugin list --json`. `enabled` is the value the
// Host computed for the current working directory, so settings files are never read.
function classifyClaudePluginRecords(payload, { projectRoot } = {}) {
  if (!Array.isArray(payload)) return unknown('PLUGIN_LIST_MALFORMED');
  const matches = payload.filter((entry) => isObject(entry) && entry.id === CLAUDE_PLUGIN_ID);
  if (matches.length === 0) return { status: 'ABSENT', records: [] };
  for (const entry of matches) {
    if (typeof entry.enabled !== 'boolean') return unknown('PLUGIN_RECORD_MALFORMED');
    if (!APPLICABLE_SCOPES.includes(entry.scope)) return unknown('PLUGIN_SCOPE_UNKNOWN');
    if (PROJECT_SCOPES.includes(entry.scope) && !isNonEmptyString(entry.projectPath)) {
      return unknown('PLUGIN_RECORD_MALFORMED');
    }
  }
  const applicable = matches.filter((entry) => recordApplies(entry, projectRoot));
  if (applicable.length === 0) return { status: 'NOT_APPLICABLE', records: [] };
  const enabled = applicable.filter((entry) => entry.enabled);
  if (enabled.length === 0) return { status: 'DISABLED', records: [] };
  if (enabled.length !== applicable.length) return unknown('PLUGIN_ENABLED_CONFLICT');
  if (enabled.some((entry) => Array.isArray(entry.errors) ? entry.errors.length > 0 : entry.errors !== undefined && entry.errors !== null)) {
    return unknown('PLUGIN_LOAD_ERRORS');
  }
  return { status: 'ENABLED', records: enabled.map((entry) => ({ ...entry })) };
}

// Reads a regular file below `physicalRoot`, refusing symlinks on every segment.
function readPackageFile(physicalRoot, relative, maxBytes) {
  const target = path.resolve(physicalRoot, ...relative.split('/'));
  if (!isInside(physicalRoot, target)) return { ok: false, reason: 'UNSAFE_PATH' };
  let current = physicalRoot;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { ok: false, reason: 'MISSING' };
      return { ok: false, reason: 'UNSAFE_PATH' };
    }
    if (stat.isSymbolicLink()) return { ok: false, reason: 'UNSAFE_PATH' };
    if (current === target ? !stat.isFile() : !stat.isDirectory()) return { ok: false, reason: 'UNSAFE_PATH' };
  }
  try {
    return { ok: true, bytes: readFileBounded(target, { maxBytes }) };
  } catch (_) {
    return { ok: false, reason: 'UNSAFE_PATH' };
  }
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    return null;
  }
}

function failure(reason) {
  return { ok: false, reason };
}

function entrySkillName(destination) {
  const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(destination);
  return match ? match[1] : null;
}

function physicalSkillNames(physicalRoot) {
  const skillsRoot = path.join(physicalRoot, 'skills');
  const names = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    let stat = null;
    try { stat = fs.lstatSync(skillFile); } catch (_) { stat = null; }
    if (stat) names.push(entry.name);
  }
  return names.sort();
}

function verifyProvidedEntries(physicalRoot, catalog) {
  const ids = [...catalog.publicEntryIds, ...catalog.hostOnlyIds];
  if (new Set(ids).size !== ids.length) return failure('CATALOG_INVALID');
  const identities = [];
  for (const stableId of ids) {
    const entries = catalog.files.filter((file) => isObject(file) && file.skillId === stableId && file.kind === 'entry'
      && typeof file.destination === 'string' && entrySkillName(file.destination) !== null);
    if (entries.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256 || '')) return failure('CATALOG_INVALID');
    const read = readPackageFile(physicalRoot, entries[0].destination, SKILL_LIMIT_BYTES);
    if (!read.ok) return failure(read.reason === 'MISSING' ? 'CATALOG_DRIFT' : read.reason);
    if (sha256(read.bytes) !== entries[0].sha256) return failure('CATALOG_HASH_MISMATCH');
    identities.push({ stableId, name: entrySkillName(entries[0].destination) });
  }
  const names = identities.map((identity) => identity.name);
  if (new Set(names).size !== names.length) return failure('CATALOG_INVALID');
  let physical;
  try {
    physical = physicalSkillNames(physicalRoot);
  } catch (_) {
    return failure('CATALOG_DRIFT');
  }
  if (physical.join('\0') !== names.slice().sort().join('\0')) return failure('CATALOG_DRIFT');
  return { ok: true, identities: identities.sort((left, right) => left.stableId.localeCompare(right.stableId)) };
}

// Reads and verifies the package catalog of one plugin root. The catalog, not
// the physical directory listing, is the identity source; the listing is only
// compared against it to prove nothing drifted.
function readClaudePluginCatalog(root, { expectedVersion } = {}) {
  let physicalRoot;
  try {
    physicalRoot = fs.realpathSync(root);
    if (!fs.statSync(physicalRoot).isDirectory()) return failure('UNSAFE_PATH');
  } catch (_) {
    return failure('ROOT_MISSING');
  }
  const manifestRead = readPackageFile(physicalRoot, '.claude-plugin/plugin.json', MANIFEST_LIMIT_BYTES);
  if (!manifestRead.ok) return failure(manifestRead.reason === 'MISSING' ? 'PLUGIN_MANIFEST_INVALID' : manifestRead.reason);
  const manifest = parseJson(manifestRead.bytes);
  if (!isObject(manifest) || manifest.name !== 'dhpk' || !isNonEmptyString(manifest.version)
    || Object.prototype.hasOwnProperty.call(manifest, 'skills')) {
    return failure('PLUGIN_MANIFEST_INVALID');
  }
  if (manifest.version !== expectedVersion) return failure('VERSION_MISMATCH');
  const catalogRead = readPackageFile(physicalRoot, 'provenance.json', CATALOG_LIMIT_BYTES);
  if (!catalogRead.ok) return failure(catalogRead.reason === 'MISSING' ? 'CATALOG_MISSING' : catalogRead.reason);
  const catalog = parseJson(catalogRead.bytes);
  if (!isObject(catalog) || catalog.schema !== CLAUDE_PLUGIN_CATALOG_SCHEMA
    || !Array.isArray(catalog.publicEntryIds) || !Array.isArray(catalog.hostOnlyIds) || !Array.isArray(catalog.files)
    || [...catalog.publicEntryIds, ...catalog.hostOnlyIds].some((id) => !isNonEmptyString(id))) {
    return failure('CATALOG_INVALID');
  }
  const verified = verifyProvidedEntries(physicalRoot, catalog);
  if (!verified.ok) return verified;
  return {
    ok: true,
    pluginVersion: manifest.version,
    catalogDigest: sha256(catalogRead.bytes),
    providedIdentities: verified.identities,
  };
}

function resolveProbeTimeoutMs(env = {}) {
  const fromMs = Number(env.DHPK_CLAUDE_PROBE_TIMEOUT_MS);
  if (Number.isSafeInteger(fromMs) && fromMs > 0) return fromMs;
  return QUERY_TIMEOUT_MS;
}

function provisionOf(status, extra = {}) {
  return {
    schema: CLAUDE_PLUGIN_PROVISION_SCHEMA,
    status,
    source: PROBE_SOURCE,
    pluginId: CLAUDE_PLUGIN_ID,
    ...extra,
  };
}

function unknownProvision(reason, extra = {}) {
  return provisionOf('UNKNOWN', { reason, ...extra });
}

function windowsExecutableNames(env) {
  const extensions = String(env.PATHEXT || '.COM;.EXE').split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension === '.exe' || extension === '.com');
  return extensions.map((extension) => `claude${extension}`);
}

function isExecutableFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

// Resolves `claude` from PATH alone: empty and relative entries are skipped, the
// result is a physical executable file, and nothing inside the project root
// qualifies, so a planted binary there can never run with the project as cwd.
// A CLI that exists only inside the project root is reported as `insideProject`,
// which is not the same as not installed. On Windows only PATHEXT names that spawn without a shell (.exe, .com) count.
function resolveClaudeExecutable({ env = process.env, projectRoot } = {}) {
  let physicalProject;
  try {
    physicalProject = fs.realpathSync(projectRoot);
  } catch (_) {
    return { executable: null, insideProject: false };
  }
  let insideProject = false;
  const names = process.platform === 'win32' ? windowsExecutableNames(env) : ['claude'];
  for (const directory of String(env.PATH || '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) {
      // Never used, but a CLI the spawn would find relative to the project root
      // is still the "inside the project" case, not "not installed".
      for (const name of names) {
        if (isExecutableFile(path.resolve(physicalProject, directory || '.', name))) insideProject = true;
      }
      continue;
    }
    for (const name of names) {
      let physical;
      try {
        physical = fs.realpathSync(path.join(directory, name));
      } catch (_) {
        continue;
      }
      if (!isExecutableFile(physical)) continue;
      if (isInside(physicalProject, physical)) {
        insideProject = true;
        continue;
      }
      return { executable: physical, insideProject: false };
    }
  }
  return { executable: null, insideProject };
}

function runPluginList({ cwd, env, spawn, timeoutMs, terminate }) {
  const { executable, insideProject } = resolveClaudeExecutable({ env, projectRoot: cwd });
  if (!executable) return insideProject ? { failed: true, reason: 'CLAUDE_CLI_INSIDE_PROJECT' } : { notInstalled: true };
  // The child runs detached; reap its whole group on every path, not only on error.
  const result = runHostCliProbe(executable, ['plugin', 'list', '--json'], {
    cwd,
    env,
    timeoutMs,
    maxBuffer: QUERY_OUTPUT_LIMIT_BYTES,
    reapGroup: 'always',
    spawn,
    terminate,
  });
  if (result.error && result.error.code === 'ENOENT') return { notInstalled: true };
  const failed = { failed: true, probe: hostCliProbeEvidence(result, redactSensitiveText) };
  if (result.reapFailed || result.error || result.exitCode !== 0) return failed;
  try {
    return { payload: JSON.parse(result.stdout) };
  } catch (_) {
    return failed;
  }
}

// Every verified root of every enabled record must agree on the plugin version
// and the provided identities. The digest may differ between roots (a cache
// snapshot and a directory source differ in generated bytes); the catalog the
// Host reads (`readFromFolder` when present, else `installPath`) supplies it.
function readEnabledCatalogs(records) {
  const hostRead = [];
  const all = [];
  for (const record of records) {
    if (!isNonEmptyString(record.installPath) || !path.isAbsolute(record.installPath)
      || !isNonEmptyString(record.version)) {
      return failure('PLUGIN_RECORD_MALFORMED');
    }
    const roots = [{ root: record.installPath, version: record.version }];
    if (record.readFromFolder !== undefined && record.readFromFolder !== null) {
      if (!isNonEmptyString(record.readFromFolder) || !path.isAbsolute(record.readFromFolder)
        || !isNonEmptyString(record.folderVersion)) {
        return failure('PLUGIN_RECORD_MALFORMED');
      }
      roots.push({ root: record.readFromFolder, version: record.folderVersion });
    }
    const catalogs = [];
    for (const entry of roots) {
      const catalog = readClaudePluginCatalog(entry.root, { expectedVersion: entry.version });
      if (!catalog.ok) return catalog;
      catalogs.push(catalog);
    }
    all.push(...catalogs);
    hostRead.push(catalogs[catalogs.length - 1]);
  }
  const signature = (catalog) => JSON.stringify([catalog.pluginVersion, catalog.providedIdentities]);
  if (all.some((catalog) => signature(catalog) !== signature(all[0]))) return failure('PLUGIN_ROOTS_DISAGREE');
  return hostRead[0];
}

function enabledProvision(records) {
  const catalog = readEnabledCatalogs(records);
  if (!catalog.ok) return unknownProvision(catalog.reason);
  return provisionOf('ENABLED', {
    pluginVersion: catalog.pluginVersion,
    catalogDigest: catalog.catalogDigest,
    providedIdentities: catalog.providedIdentities,
  });
}

function probeClaudePluginProvision({
  projectRoot,
  env = process.env,
  spawn = spawnSync,
  terminate = terminateProcessGroup,
  timeoutMs = resolveProbeTimeoutMs(env),
} = {}) {
  let cwd;
  try {
    cwd = fs.realpathSync(projectRoot);
    if (!fs.statSync(cwd).isDirectory()) return unknownProvision('PROJECT_ROOT_MISSING');
  } catch (_) {
    return unknownProvision('PROJECT_ROOT_MISSING');
  }
  const listed = runPluginList({ cwd, env, spawn, timeoutMs, terminate });
  if (listed.notInstalled) return provisionOf('CLI_NOT_INSTALLED');
  if (listed.failed) return unknownProvision(listed.reason || 'CLAUDE_CLI_FAILED', listed.probe ? { probe: listed.probe } : {});
  const classified = classifyClaudePluginRecords(listed.payload, { projectRoot: cwd });
  if (classified.status === 'UNKNOWN') return unknownProvision(classified.reason);
  if (classified.status !== 'ENABLED') return provisionOf(classified.status);
  return enabledProvision(classified.records);
}

// INACTIVE is override-only: the live probe never reports it.
function normalizeClaudePluginStateOverride(value) {
  if (value === 'auto' || value === 'inactive') return value;
  throw new Error(`invalid --claude-plugin-state '${value}' (expected auto|inactive)`);
}

function resolveClaudePluginProvision({ projectRoot, override = 'auto', env = process.env, spawn = spawnSync } = {}) {
  if (normalizeClaudePluginStateOverride(override) === 'inactive') {
    return { schema: CLAUDE_PLUGIN_PROVISION_SCHEMA, status: 'INACTIVE', source: 'override', pluginId: CLAUDE_PLUGIN_ID };
  }
  return probeClaudePluginProvision({ projectRoot, env, spawn });
}

module.exports = {
  CLAUDE_PLUGIN_ID,
  CLAUDE_PLUGIN_PROVISION_SCHEMA,
  CLAUDE_PLUGIN_CATALOG_SCHEMA,
  CLAUDE_PLUGIN_STATUSES,
  classifyClaudePluginRecords,
  resolveClaudeExecutable,
  readClaudePluginCatalog,
  probeClaudePluginProvision,
  normalizeClaudePluginStateOverride,
  resolveClaudePluginProvision,
};
