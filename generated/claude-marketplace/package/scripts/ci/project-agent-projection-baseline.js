#!/usr/bin/env node
'use strict';

// Read-only characterization for issue #498.  This module intentionally does
// not invoke an installer or create a projection.  It records the current
// surface decisions so the compiler-owned project plan can be compared with
// the pre-migration behavior later.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { redactSensitiveText } = require('../lib/redaction');
const {
  fingerprint,
  resolveInventoryRevision,
} = require('../lib/distribution-projection-contract');
const {
  selectPortableSkills,
} = require('../lib/agent-plugin-package');
const {
  selectCursorSyncSkills,
} = require('../lib/cursor-sync-package');

const SCHEMA = 'dhpk.project-agent-projection-baseline.v1';
const CAPABILITY_MATRIX_SCHEMA = 'dhpk.project-agent-capability-matrix.v1';
const RUNTIME_STATUSES = new Set([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'BLOCKED',
  'UNAVAILABLE',
]);
const HOSTS = Object.freeze([
  Object.freeze({
    id: 'claude',
    label: 'Claude',
    surfaces: Object.freeze(['claude-core', 'claude-module']),
    shape: Object.freeze({ kind: 'directory', root: '.agents/skills', entry: '<name>/SKILL.md' }),
    native: Object.freeze({ kind: 'claude-plugin', roots: Object.freeze(['skills/', 'agents/', 'rules/']) }),
  }),
  Object.freeze({
    id: 'codex',
    label: 'Codex',
    surfaces: Object.freeze(['codex-sync', 'codex-native']),
    shape: Object.freeze({ kind: 'directory', root: '.agents/skills', entry: '<name>/SKILL.md' }),
    native: Object.freeze({ kind: 'codex-native', roots: Object.freeze(['.agents/agents', '.agents/rules', '.agents/hooks']) }),
  }),
  Object.freeze({
    id: 'cursor',
    label: 'Cursor',
    surfaces: Object.freeze(['cursor-sync', 'cursor-plugin']),
    shape: Object.freeze({ kind: 'directory', root: '.agents/skills', entry: '<name>/SKILL.md' }),
    native: Object.freeze({ kind: 'cursor-native', roots: Object.freeze(['.cursor/agents', '.cursor/rules', '.cursor/hooks']) }),
  }),
  Object.freeze({
    id: 'agy',
    label: 'AGY',
    surfaces: Object.freeze(['agy-plugin']),
    shape: Object.freeze({ kind: 'direct-file', root: '.agents/skills', entry: '<name>.md' }),
    native: Object.freeze({ kind: 'agy-native', roots: Object.freeze(['.agy/agents', '.agy/rules', '.agy/hooks']) }),
  }),
]);
const PORTABLE_HOST_IDS = Object.freeze(HOSTS.map((host) => host.id));

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

function readInventory(root, inventory) {
  if (inventory && typeof inventory === 'object' && !Array.isArray(inventory)) return inventory;
  const inventoryPath = path.join(root, 'manifests', 'distribution-inventory.json');
  return JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
}

function hostLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const host = HOSTS.find((candidate) => candidate.id === normalized
    || candidate.label.toLowerCase() === normalized
    || candidate.surfaces.includes(normalized));
  return host ? host.label : null;
}

function hostForSurface(surface) {
  const host = HOSTS.find((candidate) => candidate.surfaces.includes(surface));
  return host ? host.label : null;
}

function profileDocument(inventory) {
  const config = inventory && (inventory.project_agent_projection || inventory.projectAgentProjection);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const profiles = config.profiles || config.profile || {};
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return null;
  const profile = profiles['portable-core'] || profiles.portableCore;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return profile;
}

function profileStableIds(inventory) {
  const profile = profileDocument(inventory);
  if (!profile) return [];
  const values = profile.stable_ids || profile.stableIds || profile.skillIds || profile.skill_ids;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return value.id || value.stableId || value.skillId;
    return null;
  }).filter((value) => typeof value === 'string' && value.trim() !== ''))].sort();
}

function allSkills(inventory) {
  return (Array.isArray(inventory && inventory.skills) ? inventory.skills : [])
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
    .sort((left, right) => left.id.localeCompare(right.id));
}

function entrySurfaces(entry) {
  const surfaces = new Set(Array.isArray(entry && entry.surfaces) ? entry.surfaces : []);
  if (entry && entry.surface_membership && typeof entry.surface_membership === 'object') {
    for (const [surface, value] of Object.entries(entry.surface_membership)) {
      if (Array.isArray(value) && value.length > 0) surfaces.add(surface);
    }
  }
  return surfaces;
}

function capabilityHostRows(entry) {
  const surfaces = entrySurfaces(entry);
  return Object.fromEntries(HOSTS.map((host) => {
    const supportedSurface = host.surfaces.find((surface) => surfaces.has(surface)) || null;
    return [host.id, {
      status: supportedSurface ? 'OBSERVED' : 'SKIP_INCOMPATIBLE',
      surface: supportedSurface,
      shape: host.shape,
    }];
  }));
}

function classifyCapability(entry, { portableCoreIds = [], hosts = HOSTS } = {}) {
  const stableId = entry && entry.id;
  const surfaces = entrySurfaces(entry);
  const requested = new Set(portableCoreIds);
  const hostSupport = hosts.map((host) => ({
    host,
    surface: host.surfaces.find((surface) => surfaces.has(surface)) || null,
  }));
  const missingHosts = hostSupport.filter((row) => !row.surface).map((row) => row.host.id);
  const internal = entry && entry.invokable === false;
  let status;
  let reason;
  if (internal || (requested.has(stableId) && missingHosts.length > 0)) {
    status = 'SKIP_INCOMPATIBLE';
    reason = internal
      ? 'entry is internal runtime support and is not a portable user-invokable skill'
      : `portable-core lacks a supported representation for: ${missingHosts.join(', ')}`;
  } else if (requested.has(stableId)) {
    status = 'PORTABLE_CORE';
    reason = 'stable ID is explicitly declared by the portable-core evidence allowlist';
  } else if (missingHosts.length > 0 || hostSupport.some((row) => row.surface === null)) {
    status = 'HOST_SPECIFIC';
    reason = missingHosts.length === hosts.length
      ? 'entry is available only through a Host-specific surface'
      : `entry is not declared for every common Host: ${missingHosts.join(', ')}`;
  } else {
    status = 'UNDECLARED';
    reason = 'entry is not in the explicit portable-core allowlist';
  }
  const classifications = [status === 'PORTABLE_CORE' ? 'portable-core' : status];
  return {
    stableId,
    publicName: entry && (entry.name || entry.publicName || entry.id) || null,
    status,
    classifications,
    reason,
    hostSupport: Object.fromEntries(hostSupport.map((row) => [row.host.id, row.surface || 'SKIP_INCOMPATIBLE'])),
    representations: capabilityHostRows(entry),
  };
}

function sourceTreeFingerprint(root, entry) {
  if (!entry || typeof entry.path !== 'string') return null;
  const sourceRoot = path.resolve(root, entry.path);
  const rootRelative = path.relative(path.resolve(root), sourceRoot);
  if (!rootRelative || rootRelative.startsWith(`..${path.sep}`) || path.isAbsolute(rootRelative)) return null;
  try {
    const rootStat = fs.lstatSync(sourceRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
  } catch (_error) {
    return null;
  }
  const files = [];
  const walk = (directory, relative) => {
    for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, child.name);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) walk(absolute, childRelative);
      else if (child.isFile()) files.push({ relative: childRelative, content: fs.readFileSync(absolute) });
    }
  };
  walk(sourceRoot, '');
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.relative);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sourceRows(root, selected) {
  return selected.map((entry) => ({
    stableId: entry.id,
    publicName: entry.name || entry.id,
    canonicalPath: entry.path || null,
    fingerprint: sourceTreeFingerprint(root, entry),
  })).sort((left, right) => left.stableId.localeCompare(right.stableId));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactDiagnostic(value, root = process.cwd()) {
  if (value === undefined || value === null) return null;
  let result = redactSensitiveText(String(value), { maxLength: 1024 });
  for (const privateRoot of [root, os.homedir(), os.tmpdir()]) {
    if (privateRoot) result = result.replace(new RegExp(escapeRegExp(path.resolve(privateRoot)), 'g'), '<path>');
  }
  return result.replace(/(^|[\s"'(=<>])(?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^\s"'(),;}\]]*/gi, '$1<path>');
}

function selectionEvidence(root, inventory, surface, selected) {
  const rows = sourceRows(root, selected);
  return {
    surface,
    selectedStableIds: rows.map((row) => row.stableId),
    selectedPublicNames: rows.map((row) => row.publicName),
    count: rows.length,
    selectionFingerprint: fingerprint({ surface, rows }),
    sourceFingerprints: Object.fromEntries(rows.map((row) => [row.stableId, row.fingerprint])),
    evidenceOnly: true,
    source: 'current-surface-selection',
    inventoryRevision: resolveInventoryRevision(inventory),
  };
}

function surfaceSelection(inventory, surface) {
  if (surface === 'agent-plugin' || surface === 'cursor-plugin' || surface === 'agy-plugin') {
    return selectPortableSkills(inventory, surface);
  }
  if (surface === 'cursor-sync') return selectCursorSyncSkills(inventory);
  return allSkills(inventory).filter((entry) => entrySurfaces(entry).has(surface));
}

function normalizeRuntimeRows(runtimeRows, inventory = {}, root = process.cwd()) {
  const input = Array.isArray(runtimeRows)
    ? runtimeRows
    : ((inventory.platform_matrix && inventory.platform_matrix.entries) || []).map((entry) => ({
      id: entry.id,
      surface: entry.surface,
      host: hostForSurface(entry.surface),
      clientVersion: null,
      status: entry.evidence,
      evidence: entry.evidence,
      source: 'platform-matrix',
    }));
  const rows = input.map((row) => {
    const status = RUNTIME_STATUSES.has(row && (row.status || row.evidence))
      ? (row.status || row.evidence)
      : 'NOT_RUN';
    return {
      id: row && row.id || null,
      host: hostLabel(row && row.host) || hostLabel(row && row.surface) || row && row.host || null,
      surface: row && row.surface || null,
      status,
      evidence: RUNTIME_STATUSES.has(row && row.evidence) ? row.evidence : status,
      clientVersion: row && Object.prototype.hasOwnProperty.call(row, 'clientVersion') ? row.clientVersion : null,
      exitCode: row && Object.prototype.hasOwnProperty.call(row, 'exitCode') ? row.exitCode : null,
      diagnostics: Array.isArray(row && row.diagnostics)
        ? row.diagnostics.map((diagnostic) => redactDiagnostic(diagnostic, root))
        : [],
      source: row && row.source || 'caller',
    };
  });
  for (const host of HOSTS) {
    if (rows.some((row) => row.host === host.label)) continue;
    rows.push({
      id: `dhpk.project.${host.id}.baseline`,
      host: host.label,
      surface: host.surfaces[0],
      status: 'NOT_RUN',
      evidence: 'NOT_RUN',
      clientVersion: null,
      exitCode: null,
      diagnostics: [],
      source: 'required-host-no-runtime-row',
    });
  }
  return rows.sort((left, right) => `${left.host}:${left.surface || ''}:${left.id || ''}`.localeCompare(`${right.host}:${right.surface || ''}:${right.id || ''}`));
}

function providerSelection(root, inventory, host) {
  const selected = host.id === 'claude'
    ? surfaceSelection(inventory, 'claude-core').concat(surfaceSelection(inventory, 'claude-module'))
    : surfaceSelection(inventory, host.surfaces[0]);
  const unique = [...new Map(selected.map((entry) => [entry.id, entry])).values()];
  return selectionEvidence(root, inventory, host.surfaces[0], unique);
}

function providerRecord(root, inventory, host, runtimeRows) {
  const selection = providerSelection(root, inventory, host);
  const runtime = runtimeRows.find((row) => row.host === host.label) || {
    status: 'NOT_RUN',
    evidence: 'NOT_RUN',
    clientVersion: null,
    exitCode: null,
    diagnostics: [],
  };
  return {
    id: host.id,
    host: host.label,
    surfaces: host.surfaces.slice(),
    shape: {
      portable: { ...host.shape },
      native: { ...host.native, roots: host.native.roots.slice() },
    },
    selection,
    output: {
      path: host.shape.root,
      fingerprint: null,
      status: 'NOT_RUN',
    },
    receipt: {
      path: '.agents/.dhpk-installed.json',
      legacyPath: '.agents/skills/.dhpk-projection.json',
      fingerprint: null,
      status: 'NOT_RUN',
    },
    diagnostics: Array.isArray(runtime.diagnostics)
      ? runtime.diagnostics.map((diagnostic) => redactDiagnostic(diagnostic, root))
      : [],
    exit: {
      code: Object.prototype.hasOwnProperty.call(runtime, 'exitCode') ? runtime.exitCode : null,
      status: runtime.status || 'NOT_RUN',
    },
    runtime: {
      status: runtime.status || 'NOT_RUN',
      evidence: runtime.evidence || runtime.status || 'NOT_RUN',
      clientVersion: runtime.clientVersion || null,
    },
  };
}

function portableCoreEvidence(inventory) {
  const profile = profileDocument(inventory);
  const selectedStableIds = profileStableIds(inventory);
  if (!profile) {
    return {
      profileId: 'portable-core',
      declared: false,
      selectedStableIds: [],
      evidenceOnly: true,
      reason: 'portable-core is not declared; no current surface selection may expand into it',
    };
  }
  return {
    profileId: 'portable-core',
    declared: true,
    selectedStableIds,
    hosts: Array.isArray(profile.hosts) ? profile.hosts.slice().sort() : PORTABLE_HOST_IDS.slice(),
    compatibilityMode: profile.compatibility_mode || profile.compatibilityMode || 'portable-core',
    evidenceOnly: true,
    reason: 'portable-core is an explicit evidence-gated allowlist',
  };
}

function buildBaseline({
  root = path.join(__dirname, '..', '..'),
  inventory: providedInventory = null,
  runtimeRows = null,
  sourceCommit = null,
  sourceTree = null,
  provenanceRoot = null,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const inventory = readInventory(resolvedRoot, providedInventory);
  const portableCore = portableCoreEvidence(inventory);
  const currentAgentPlugin = surfaceSelection(inventory, 'agent-plugin');
  const currentSelection = selectionEvidence(resolvedRoot, inventory, 'agent-plugin', currentAgentPlugin);
  currentSelection.contract = 'current-agent-plugin-selection';
  currentSelection.portableCoreExpansion = false;

  const matrixEntries = allSkills(inventory).map((entry) => {
    const classified = classifyCapability(entry, { portableCoreIds: portableCore.selectedStableIds });
    return {
      ...classified,
      lifecycle: entry.lifecycle || null,
      invokable: entry.invokable !== false,
      surfaces: [...entrySurfaces(entry)].sort(),
    };
  });
  const counts = Object.fromEntries([...new Set(matrixEntries.map((entry) => entry.status))].sort()
    .map((status) => [status, matrixEntries.filter((entry) => entry.status === status).length]));
  const rows = normalizeRuntimeRows(runtimeRows, inventory, resolvedRoot);
  const hosts = HOSTS.map((host) => providerRecord(resolvedRoot, inventory, host, rows));

  let resolvedCommit = sourceCommit;
  if (!resolvedCommit) {
    try {
      resolvedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: resolvedRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (_error) { resolvedCommit = null; }
  }
  let resolvedTree = sourceTree;
  if (!resolvedTree && resolvedCommit) {
    try {
      resolvedTree = execFileSync('git', ['rev-parse', `${resolvedCommit}^{tree}`], {
        cwd: provenanceRoot || resolvedRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (_error) { resolvedTree = null; }
  }

  return stableClone({
    schema: SCHEMA,
    sourceCommit: resolvedCommit,
    sourceTree: resolvedTree,
    inventory: {
      schema: inventory.schema || null,
      revision: resolveInventoryRevision(inventory),
      fingerprint: fingerprint(inventory),
    },
    selection: {
      currentAgentPlugin: currentSelection,
      portableCore,
    },
    capabilityMatrix: {
      schema: CAPABILITY_MATRIX_SCHEMA,
      hosts: HOSTS.map((host) => host.label),
      entries: matrixEntries,
      counts,
    },
    hosts,
    runtimeObserved: {
      status: rows.some((row) => row.status === 'PASS') ? 'PARTIAL' : 'NOT_RUN',
      rows,
      note: 'Static selection and package evidence is separate from consumer discovery and runtime proof.',
    },
    limitations: [
      'This characterization collector is read-only and does not install, update, remove, or probe a private client session.',
      'The current Agent Plugin selection is evidence only; it is not an implicit four-Host portable-core contract.',
      'Runtime statuses remain non-PASS until a configured consumer probe records the corresponding evidence.',
    ],
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { root: path.join(__dirname, '..', '..'), write: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = path.resolve(argv[++index]);
    else if (argument === '--write') options.write = path.resolve(argv[++index]);
    else if (argument === '--json') options.json = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const baseline = buildBaseline(options);
  const output = `${JSON.stringify(baseline, null, 2)}\n`;
  if (options.write) fs.writeFileSync(options.write, output, { mode: 0o644 });
  else process.stdout.write(output);
  return baseline;
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`project-agent-projection-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCHEMA,
  CAPABILITY_MATRIX_SCHEMA,
  HOSTS,
  buildBaseline,
  normalizeRuntimeRows,
  hostLabel,
  classifyCapability,
  profileStableIds,
};
