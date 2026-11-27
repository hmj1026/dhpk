'use strict';

// Lifecycle orchestration deliberately reuses the projection contracts. It is
// read-only until a surface adapter is characterized for ArtifactStore writes.

const path = require('node:path');
const { sha256Hex } = require('./content-fingerprint');
const { compileDistribution } = require('./distribution-compiler');
const { createEvidenceResult, VERDICTS } = require('./distribution-projection-contract');
const { resolveCapabilitySelection } = require('./capability-bundle-selection');
const { inspectStatus } = require('./dhpk-install-status');

const SURFACES = Object.freeze(['claude', 'codex-sync', 'codex-native', 'agent-plugin', 'cursor', 'agy-plugin']);
const ACTIONS = Object.freeze(['plan', 'install', 'verify', 'update', 'uninstall', 'rollback', 'status']);
const SCOPES = Object.freeze(['project', 'user', 'local']);
const MODES = Object.freeze(['auto', 'copy', 'symlink', 'client-managed']);
const AGENT_PROFILES = Object.freeze(['core', 'extended', 'full']);
const LIFECYCLE_VERDICTS = Object.freeze(['INSTALL_PASS', 'CONSUMER_BLOCKED', 'NOT_RUN', 'BLOCKED']);
const VALUE_OPTIONS = new Set(['--scope', '--mode', '--source', '--agent-profile', '--agent', '--project-root']);
const INSTALL_OPTIONS_HELP = [
  'options: --scope <project|user|local> --mode <auto|copy|symlink|client-managed> --project-root <dir> --source <source>',
  '         --skill <id> --standalone <id> --agent-profile <core|extended|full> --agent <id> --offline --strict --dry-run --yes --json --help',
].join('\n');
const HELP = [
  'usage: dhpk install <surface> <action> [options]',
  '       dhpk install status --all [--project-root <dir>] [--offline] [--strict] [--json]',
  '       dhpk install --recover [--project-root <dir>] [--json]',
  `surfaces: ${SURFACES.join(' | ')}`,
  `actions: ${ACTIONS.join(' | ')}`,
  INSTALL_OPTIONS_HELP,
  '',
].join('\n');

function helpFor({ surface = null, action = null, recover = false, all = false } = {}) {
  if (recover) {
    return 'usage: dhpk install --recover [--project-root <dir>] [--json]\n'
      + 'options: --project-root <dir> --json --help\n';
  }
  if (all || (!surface && action === 'status')) {
    return 'usage: dhpk install status --all [--project-root <dir>] [--offline] [--strict] [--json]\n'
      + 'options: --all --project-root <dir> --offline --strict --json --help\n';
  }
  if (!surface) return HELP;
  if (!action) {
    return `usage: dhpk install ${surface} <action> [options]\n`
      + `actions: ${ACTIONS.join(' | ')}\n`
      + `${INSTALL_OPTIONS_HELP}\n`;
  }
  return `usage: dhpk install ${surface} ${action} [options]\n`
    + `${INSTALL_OPTIONS_HELP}\n`;
}

function rejectLeadingOption(token, nextToken) {
  if (token === '--profile' || token.startsWith('--profile=')) {
    throw failure('--profile is no longer supported; the common collection is selected automatically');
  }
  const optionName = token.split('=')[0];
  if ((VALUE_OPTIONS.has(optionName) || optionName === '--skill' || optionName === '--standalone')
    && !token.includes('=')
    && (!nextToken || nextToken.startsWith('--') || nextToken === '-h')) {
    throw failure(`${optionName} requires a value`);
  }
  throw failure(`unknown option '${token}'`);
}

function validateTrailingHelpArgs(args) {
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') continue;
    if (arg.startsWith('-')) throw failure(`unknown option '${arg}'`);
    throw failure(`unexpected argument '${arg}'`);
  }
}

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

function parseAllStatusRequest(rest) {
  let help = false;
  const request = {
    surface: null,
    all: true,
    action: 'status',
    scope: null,
    mode: 'auto',
    source: 'local',
    offline: false,
    strict: false,
    dryRun: false,
    yes: false,
    json: false,
  };
  let seenAll = false;
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === '--help' || option === '-h') help = true;
    else if (option === '--all') seenAll = true;
    else if (option === '--offline') request.offline = true;
    else if (option === '--strict') request.strict = true;
    else if (option === '--json') request.json = true;
    else if (option === '--project-root' || option === '--scope') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--') || value === '-h') throw failure(`${option} requires a value`);
      index += 1;
      if (option === '--project-root') request.projectRoot = value;
      else request.scope = value;
    } else if (option.startsWith('--project-root=')) {
      const value = option.slice('--project-root='.length);
      if (!value) throw failure('--project-root requires a value');
      request.projectRoot = value;
    } else throw failure(`unknown option '${option}'`);
  }
  if (request.scope && !SCOPES.includes(request.scope)) throw failure(`unsupported scope '${request.scope}'`);
  if (help) return Object.freeze({ help: true, surface: null, action: 'status', all: true });
  if (!seenAll) throw failure('status without a surface requires --all (or specify a surface: dhpk-install <surface> status)');
  return Object.freeze(request);
}

function parseRequest(argv) {
  if (!Array.isArray(argv)) throw failure('usage: dhpk install <surface> <action> [options]');
  if (argv.length === 0) return Object.freeze({ help: true, surface: null, action: null });
  if (argv[0] === '--help' || argv[0] === '-h') {
    validateTrailingHelpArgs(argv.slice(1));
    return Object.freeze({ help: true, surface: null, action: null });
  }
  if (argv[0] === 'status') return parseAllStatusRequest(argv.slice(1));
  const [surface, action, ...rest] = argv;
  if (surface.startsWith('-')) rejectLeadingOption(surface, action);
  if (surface === 'codex') {
    throw failure("unknown surface 'codex'; use canonical surface 'codex-sync' or 'codex-native', or run 'dhpk-install status --all'");
  }
  if (!SURFACES.includes(surface)) throw failure(`unknown surface '${surface}'`);
  if (action === '--help' || action === '-h') {
    validateTrailingHelpArgs(rest);
    return Object.freeze({ help: true, surface, action: null });
  }
  if (!action) throw failure('usage: dhpk install <surface> <action> [options]');
  if (action.startsWith('-')) rejectLeadingOption(action, rest[0]);
  if (!ACTIONS.includes(action)) throw failure(`unknown action '${action}'`);
  let help = false;
  const request = {
    surface,
    action,
    scope: null,
    mode: 'auto',
    source: 'local',
    offline: false,
    strict: false,
    dryRun: false,
    yes: false,
    json: false,
    agentProfile: null,
    agents: [],
    skillIds: [],
    standaloneSkillIds: [],
  };
  let seenAll = false;
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === '--help' || option === '-h') help = true;
    else if (option === '--all') seenAll = true;
    else if (option === '--profile' || option.startsWith('--profile=')) {
      throw failure('--profile is no longer supported; the common collection is selected automatically');
    } else if (option === '--offline') request.offline = true;
    else if (option === '--strict') request.strict = true;
    else if (option === '--dry-run') request.dryRun = true;
    else if (option === '--yes') request.yes = true;
    else if (option === '--json') request.json = true;
    else if (VALUE_OPTIONS.has(option)) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--') || value === '-h') throw failure(`${option} requires a value`);
      index += 1;
      if (option === '--project-root') request.projectRoot = value;
      else if (option === '--scope') request.scope = value;
      else if (option === '--mode') request.mode = value;
      else if (option === '--source') request.source = value;
      else if (option === '--agent-profile') request.agentProfile = value;
      else request.agents.push(value);
    } else if (option === '--skill') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--') || value === '-h') throw failure(`${option} requires a value`);
      index += 1;
      request.skillIds.push(value);
    } else if (option.startsWith('--skill=')) {
      const value = option.slice('--skill='.length);
      if (!value) throw failure('--skill requires a value');
      request.skillIds.push(value);
    } else if (option === '--standalone') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--') || value === '-h') throw failure('--standalone requires a value');
      index += 1;
      if (!request.standaloneSkillIds.includes(value)) request.standaloneSkillIds.push(value);
    } else if (option.startsWith('--standalone=')) {
      const value = option.slice('--standalone='.length);
      if (!value) throw failure('--standalone requires a value');
      if (!request.standaloneSkillIds.includes(value)) request.standaloneSkillIds.push(value);
    } else throw failure(`unknown option '${option}'`);
  }
  if (seenAll) throw failure(action === 'status' ? '--all cannot be combined with a surface' : '--all is only valid with status');
  if (request.strict && action !== 'status') throw failure('--strict is only valid with status');
  if (request.standaloneSkillIds.length > 0 && request.skillIds.length > 0) {
    throw failure('--standalone cannot be combined with --skill');
  }
  if (action !== 'status') {
    request.scope = request.scope || defaultScope(surface);
    if (!request.scope && !help) throw failure(`--scope is required for '${surface}'`);
  }
  if (request.scope && !SCOPES.includes(request.scope)) throw failure(`unsupported scope '${request.scope}'`);
  if (!MODES.includes(request.mode)) throw failure(`unsupported mode '${request.mode}'`);
  if (typeof request.source !== 'string' || request.source.length === 0) throw failure('source must be non-empty');
  if (surface === 'cursor') {
    request.agentProfile = request.agentProfile || 'core';
    if (!AGENT_PROFILES.includes(request.agentProfile)) throw failure(`unsupported Cursor agent profile '${request.agentProfile}'`);
    request.agents = [...new Set(request.agents)].sort();
  } else if (request.agentProfile || request.agents.length > 0) {
    throw failure('--agent-profile and --agent are only valid for cursor');
  }
  if (help) return Object.freeze({ help: true, surface, action });
  // Preserve repeated overlays so the centralized resolver can reject them
  // before planning or mutation instead of silently changing the request.
  request.skillIds = request.skillIds.slice().sort();
  request.standaloneSkillIds = request.standaloneSkillIds.slice().sort();
  const normalized = { ...request };
  if (!normalized.strict) delete normalized.strict;
  if (normalized.skillIds.length === 0) delete normalized.skillIds;
  else normalized.skillIds = Object.freeze(normalized.skillIds);
  if (normalized.standaloneSkillIds.length === 0) delete normalized.standaloneSkillIds;
  else normalized.standaloneSkillIds = Object.freeze(normalized.standaloneSkillIds);
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
  return sha256Hex(JSON.stringify(inventory));
}

function installationSurfaceContract(inventory, surface) {
  const contract = inventory && inventory.installation_contract;
  return contract && contract.surfaces && contract.surfaces[surface]
    ? contract.surfaces[surface]
    : {};
}

function compileLifecyclePlan(request, inventory, selectionConfig = {}) {
  const { profiles = null, moduleCatalog = null, sourceVersion = '0.0.0' } = selectionConfig;
  if (request.surface === 'cursor' && request.agents.length > 0) {
    return { ok: false, error: { code: 'UNSUPPORTED_AGENT_SELECTION', message: 'Cursor native agent selection is blocked until the inventory-owned agent profile contract is implemented' } };
  }
  const surface = sourceSurface(request.surface);
  let entries;
  try { entries = inventoryEntries(inventory, surface); } catch (error) {
    return { ok: false, error: { code: error.code || 'INVALID_INVENTORY', message: error.message } };
  }
  let profileSelection = null;
  const standaloneSkillIds = Array.isArray(request.standaloneSkillIds) ? request.standaloneSkillIds : [];
  if (profiles && moduleCatalog && inventory && inventory.profile_policy) {
    const standalone = standaloneSkillIds.length > 0;
    const selectedProfileId = standalone ? null : 'common';
    const skillIds = Array.isArray(request.skillIds) ? request.skillIds : [];
    const resolved = resolveCapabilitySelection({
      inventory,
      profiles,
      moduleCatalog,
      profileId: selectedProfileId,
      skillIds,
      standaloneSkillIds: standalone ? standaloneSkillIds : undefined,
      surface,
      sourceInputs: { request: { profileId: selectedProfileId, skillIds, standaloneSkillIds } },
      policyVersion: inventory.profile_policy.version,
    });
    if (!resolved.ok) return resolved;
    profileSelection = resolved.value;
  }
  let compiled;
  if (profileSelection) {
    compiled = compileDistribution({
      inventory,
      surface,
      profileSelection,
      compilerVersion: 'dhpk-install-lifecycle-v1',
      inventoryFingerprint: inventoryFingerprint(inventory),
      inputFingerprint: sha256Hex(JSON.stringify(request)),
    });
  } else {
    const normalized = compileDistribution({ inventory, surface });
    if (!normalized.ok) return normalized;
    compiled = compileDistribution({
      inventory,
      surface,
      entries,
      selectedStableIds: normalized.value.selectedStableIds,
      selectionPolicy: normalized.value.selectionPolicy,
      selectionEntries: entries,
      compilerVersion: 'dhpk-install-lifecycle-v1',
      inventoryFingerprint: inventoryFingerprint(inventory),
      inputFingerprint: sha256Hex(JSON.stringify(request)),
    });
  }
  if (!compiled.ok) return compiled;
  const surfaceContract = installationSurfaceContract(inventory, request.surface);
  const selectedIds = compiled.value.entries.map((entry) => entry.stableId);
  const inventoryDigest = inventoryFingerprint(inventory);
  const supportClosure = profileSelection && profileSelection.dependencyClosure
    ? profileSelection.dependencyClosure
    : { stableIds: selectedIds };
  const owner = surfaceContract.owner || compiled.value.entries[0] && compiled.value.entries[0].owner || request.surface;
  const planId = sha256Hex(JSON.stringify({
    schema: 'dhpk.installation-plan.v1',
    sourceVersion,
    source: request.source,
    surface: request.surface,
    scope: request.scope,
    mode: request.mode,
    distribution: compiled.value.planFingerprint,
  }));
  const rollbackIdentity = sha256Hex(JSON.stringify({
    surface: request.surface, scope: request.scope, owner, plan: planId,
  }));
  return {
    ok: true,
    value: Object.freeze({
      schema: 'dhpk.installation-plan.v1',
      id: planId,
      distribution: compiled.value,
      source: Object.freeze({ version: sourceVersion, source: request.source }),
      target: Object.freeze({ surface: request.surface, scope: request.scope, mode: request.mode }),
      selection: Object.freeze({
        profileId: profileSelection && profileSelection.profileId || null,
        selectedStableIds: Object.freeze(selectedIds.slice()),
        supportClosure,
      }),
      ownership: Object.freeze({ owner, roots: Object.freeze((surfaceContract.owned_roots || []).slice()) }),
      fingerprints: Object.freeze({ plan: planId, distribution: compiled.value.planFingerprint, inventory: inventoryDigest }),
      preview: Object.freeze({ mutation: false, entryCount: selectedIds.length }),
      backup: Object.freeze({ requiredBeforeWrite: true, strategy: surfaceContract.backup || 'adapter-owned' }),
      transaction: Object.freeze({ writer: surfaceContract.adapter || null, genericLifecycleMayWrite: false }),
      recovery: Object.freeze({ strategy: surfaceContract.recovery || 'adapter-owned', receiptRequired: true }),
      rollback: Object.freeze({ identity: rollbackIdentity, owner }),
      selectedIds,
      selectedNames: selectedIds,
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

function statusResult(request, inventory, selectionConfig = {}) {
  const root = selectionConfig.root || path.resolve(__dirname, '..', '..');
  let plan = null;
  if (!request.all && request.surface) {
    const planRequest = request.scope ? request : { ...request, scope: defaultScope(request.surface) || 'project' };
    const compiled = compileLifecyclePlan(planRequest, inventory, selectionConfig);
    if (compiled.ok) plan = compiled.value;
  }
  return inspectStatus({
    request,
    root,
    inventory,
    profiles: selectionConfig.profiles || null,
    sourceVersion: selectionConfig.sourceVersion || '0.0.0',
    plan,
    env: selectionConfig.env || process.env,
    spawn: selectionConfig.spawn,
  });
}

function execute(request, inventory, selectionConfig = {}) {
  if (request.action === 'status') return statusResult(request, inventory, selectionConfig);
  if (request.action === 'plan' || request.action === 'verify') return readOnlyResult(request, inventory, selectionConfig);
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
  helpFor,
  compileLifecyclePlan,
  createLifecycleResult,
  execute,
};
