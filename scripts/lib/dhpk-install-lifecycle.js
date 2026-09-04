'use strict';

// Lifecycle orchestration deliberately reuses the projection contracts. It is
// read-only until a surface adapter is characterized for ArtifactStore writes.

const crypto = require('node:crypto');
const { compileDistribution } = require('./distribution-compiler');
const { createEvidenceResult, VERDICTS } = require('./distribution-projection-contract');
const { resolveCapabilitySelection } = require('./capability-bundle-selection');

const SURFACES = Object.freeze(['claude', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor', 'agy-plugin']);
const ACTIONS = Object.freeze(['plan', 'install', 'verify', 'update', 'uninstall', 'rollback', 'status']);
const SCOPES = Object.freeze(['project', 'user', 'local']);
const MODES = Object.freeze(['auto', 'copy', 'symlink', 'client-managed']);
const AGENT_PROFILES = Object.freeze(['core', 'extended', 'full']);
const LIFECYCLE_VERDICTS = Object.freeze(['INSTALL_PASS', 'CONSUMER_BLOCKED', 'NOT_RUN', 'BLOCKED']);

function failure(message, code = 'INVALID_ARGUMENT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sourceSurface(surface) {
  return surface === 'claude' ? 'claude-core' : surface === 'cursor' ? 'cursor-plugin' : surface;
}

function defaultScope(surface) {
  if (surface === 'cursor' || surface === 'codex-sync') return 'project';
  if (surface === 'agy-plugin') return 'user';
  return null;
}

function parseRequest(argv) {
  if (!Array.isArray(argv) || argv.length < 2) throw failure('usage: dhpk-install <surface> <action> [options]');
  const [surface, action, ...rest] = argv;
  if (!SURFACES.includes(surface)) throw failure(`unknown surface '${surface}'`);
  if (!ACTIONS.includes(action)) throw failure(`unknown action '${action}'`);
  const request = {
    surface,
    action,
    scope: null,
    mode: 'auto',
    source: 'local',
    offline: false,
    dryRun: false,
    yes: false,
    json: false,
    agentProfile: null,
    agents: [],
    profileId: null,
    skillIds: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === '--offline') request.offline = true;
    else if (option === '--dry-run') request.dryRun = true;
    else if (option === '--yes') request.yes = true;
    else if (option === '--json') request.json = true;
    else if (['--scope', '--mode', '--source', '--agent-profile', '--agent'].includes(option)) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw failure(`${option} requires a value`);
      index += 1;
      if (option === '--scope') request.scope = value;
      else if (option === '--mode') request.mode = value;
      else if (option === '--source') request.source = value;
      else if (option === '--agent-profile') request.agentProfile = value;
      else request.agents.push(value);
    } else if (option === '--profile' || option === '--skill') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw failure(`${option} requires a value`);
      index += 1;
      if (option === '--profile') request.profileId = value;
      else request.skillIds.push(value);
    } else if (option.startsWith('--profile=')) {
      const value = option.slice('--profile='.length);
      if (!value) throw failure('--profile requires a value');
      request.profileId = value;
    } else if (option.startsWith('--skill=')) {
      const value = option.slice('--skill='.length);
      if (!value) throw failure('--skill requires a value');
      request.skillIds.push(value);
    } else throw failure(`unknown option '${option}'`);
  }
  request.scope = request.scope || defaultScope(surface);
  if (!request.scope) throw failure(`--scope is required for '${surface}'`);
  if (!SCOPES.includes(request.scope)) throw failure(`unsupported scope '${request.scope}'`);
  if (!MODES.includes(request.mode)) throw failure(`unsupported mode '${request.mode}'`);
  if (typeof request.source !== 'string' || request.source.length === 0) throw failure('source must be non-empty');
  if (surface === 'cursor') {
    request.agentProfile = request.agentProfile || 'core';
    if (!AGENT_PROFILES.includes(request.agentProfile)) throw failure(`unsupported Cursor agent profile '${request.agentProfile}'`);
    request.agents = [...new Set(request.agents)].sort();
  } else if (request.agentProfile || request.agents.length > 0) {
    throw failure('--agent-profile and --agent are only valid for cursor');
  }
  // Preserve repeated overlays so the centralized resolver can reject them
  // before planning or mutation instead of silently changing the request.
  request.skillIds = request.skillIds.slice().sort();
  const normalized = { ...request };
  if (!normalized.profileId) delete normalized.profileId;
  if (normalized.skillIds.length === 0) delete normalized.skillIds;
  else normalized.skillIds = Object.freeze(normalized.skillIds);
  return Object.freeze(normalized);
}

function inventoryEntries(inventory, surface) {
  const ids = inventory && inventory.surface_membership && inventory.surface_membership[surface];
  const allEntries = [...(inventory && inventory.skills || []), ...(inventory && inventory.modules || [])];
  const byId = new Map(allEntries.map((entry) => [entry.id, entry]));
  let selected;
  if (Array.isArray(ids)) {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw failure(`surface '${surface}' references unknown inventory IDs: ${missing.sort().join(', ')}`, 'DANGLING_SURFACE_MEMBERSHIP');
    selected = ids.map((id) => byId.get(id));
  } else {
    selected = allEntries.filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes(surface));
  }
  return selected.map((entry) => ({
    stableId: entry.id,
    source: entry.path,
    destination: entry.destination || entry.path,
    owner: surface,
    transform: entry.transform || { id: 'identity', version: '1' },
    symlinkPolicy: inventory.projection_contract && inventory.projection_contract.surfaces[surface]
      ? inventory.projection_contract.surfaces[surface].symlink_policy
      : 'forbid',
  }));
}

function inventoryFingerprint(inventory) {
  return crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function compileLifecyclePlan(request, inventory, { profiles = null, moduleCatalog = null } = {}) {
  if (request.surface === 'cursor' && request.agents.length > 0) {
    return { ok: false, error: { code: 'UNSUPPORTED_AGENT_SELECTION', message: 'Cursor native agent selection is blocked until the inventory-owned agent profile contract is implemented' } };
  }
  const surface = sourceSurface(request.surface);
  let entries;
  try { entries = inventoryEntries(inventory, surface); } catch (error) {
    return { ok: false, error: { code: error.code || 'INVALID_INVENTORY', message: error.message } };
  }
  let profileSelection = null;
  if (surface !== 'codex-sync' && profiles && moduleCatalog && inventory && inventory.profile_policy) {
    const selectedProfileId = request.profileId || 'minimal';
    const skillIds = Array.isArray(request.skillIds) ? request.skillIds : [];
    const resolved = resolveCapabilitySelection({
      inventory,
      profiles,
      moduleCatalog,
      profileId: selectedProfileId,
      skillIds,
      surface,
      sourceInputs: { request: { profileId: selectedProfileId, skillIds } },
      policyVersion: inventory.profile_policy.version,
    });
    if (!resolved.ok) return resolved;
    profileSelection = resolved.value;
  }
  const compiled = profileSelection
    ? compileDistribution({
      inventory,
      surface,
      profileSelection,
      compilerVersion: 'dhpk-install-lifecycle-v1',
      inventoryFingerprint: inventoryFingerprint(inventory),
      inputFingerprint: crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    })
    : compileDistribution({
      surface,
      entries,
      compilerVersion: 'dhpk-install-lifecycle-v1',
      inventoryFingerprint: inventoryFingerprint(inventory),
      inputFingerprint: crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    });
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    value: Object.freeze({
      id: compiled.value.planFingerprint,
      distribution: compiled.value,
      selectedIds: compiled.value.entries.map((entry) => entry.stableId),
      selectedNames: compiled.value.entries.map((entry) => entry.stableId),
      profileSelection,
      compatibilityState: profileSelection && profileSelection.preservedCompatibility ? 'compat-v1-preserved' : null,
    }),
  };
}

function createLifecycleResult({ lifecycleVerdict, request = null, plan = null, diagnostics = [], remediation = [] } = {}) {
  if (!LIFECYCLE_VERDICTS.includes(lifecycleVerdict)) throw failure(`unsupported lifecycle verdict '${lifecycleVerdict}'`, 'INVALID_LIFECYCLE_VERDICT');
  return Object.freeze({
    request,
    plan,
    lifecycle: Object.freeze({ verdict: lifecycleVerdict }),
    diagnostics: Object.freeze(diagnostics.slice()),
    remediation: Object.freeze(remediation.slice()),
  });
}

function readOnlyResult(request, inventory, selectionConfig) {
  const plan = compileLifecyclePlan(request, inventory, selectionConfig);
  if (!plan.ok) {
    return createLifecycleResult({
      lifecycleVerdict: 'BLOCKED', request,
      diagnostics: [{ code: plan.error.code, message: plan.error.message }],
    });
  }
  const compileEvidence = createEvidenceResult({
    stage: 'structural',
    verdict: 'PASS',
    adapter: { id: sourceSurface(request.surface), version: '1' },
    planFingerprint: plan.value.distribution.planFingerprint,
    claims: ['deterministic-inventory-plan'],
  });
  return Object.freeze({
    ...createLifecycleResult({ lifecycleVerdict: 'NOT_RUN', request, plan: plan.value }),
    stages: Object.freeze({ compile: compileEvidence.value }),
  });
}

function unsupportedWriteResult(request) {
  const legacy = request.surface === 'codex-sync'
    ? 'Use scripts/hooks/install-codex-skills.sh for the retained schema-v3 Codex sync route.'
    : request.surface === 'cursor'
      ? 'Use scripts/hooks/install-cursor-harness.sh for the supported schema-v3 Cursor project-local route.'
      : 'This lifecycle action is not enabled until its adapter has receipt and ArtifactStore characterization.';
  return createLifecycleResult({
    lifecycleVerdict: 'BLOCKED', request,
    diagnostics: [{ code: 'NOT_IMPLEMENTED', message: `${request.surface} ${request.action} is not enabled` }],
    remediation: [legacy],
  });
}

function execute(request, inventory, selectionConfig = {}) {
  if (request.action === 'plan' || request.action === 'status' || request.action === 'verify') return readOnlyResult(request, inventory, selectionConfig);
  return unsupportedWriteResult(request);
}

module.exports = {
  SURFACES,
  ACTIONS,
  SCOPES,
  MODES,
  AGENT_PROFILES,
  LIFECYCLE_VERDICTS,
  VERDICTS,
  parseRequest,
  compileLifecyclePlan,
  createLifecycleResult,
  execute,
};
