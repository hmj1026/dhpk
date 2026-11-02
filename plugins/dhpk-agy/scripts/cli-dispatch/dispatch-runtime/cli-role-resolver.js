'use strict';

const crypto = require('node:crypto');
const { agentForAlias, retirementGuidance } = require('../../lib/dispatch-contract');
const { resolveRoleConfig } = require('../../lib/dispatch-config');

const ROLE_MATRIX = Object.freeze({
  'codex-worker': Object.freeze({ provider: 'codex', authority: 'workspace-write', config: 'codex_worker' }),
  'codex-reasoner': Object.freeze({ provider: 'codex', authority: 'read-only', config: 'codex_reasoner' }),
  'codex-reviewer': Object.freeze({ provider: 'codex', authority: 'read-only', config: 'codex_reviewer' }),
  'agy-worker': Object.freeze({ provider: 'agy', authority: 'workspace-write', config: 'agy_worker' }),
});

const ALIASES = Object.freeze({});

const CANONICAL_ROLES = Object.freeze({
  planner: Object.freeze({ authority: 'read-only' }),
  reasoner: Object.freeze({ authority: 'read-only' }),
  worker: Object.freeze({ authority: 'workspace-write' }),
  reviewer: Object.freeze({ authority: 'read-only' }),
});

const LEGACY_PROVIDER_ROLES = Object.freeze({
  'codex-worker': Object.freeze({ canonicalRole: 'worker', provider: 'codex-cli' }),
  'codex-reasoner': Object.freeze({ canonicalRole: 'reasoner', provider: 'codex-cli' }),
  'codex-reviewer': Object.freeze({ canonicalRole: 'reviewer', provider: 'codex-cli' }),
  'agy-worker': Object.freeze({ canonicalRole: 'worker', provider: 'agy' }),
});

const digest = (fields) => crypto.createHash('sha256')
  .update(JSON.stringify(fields, Object.keys(fields).sort()))
  .digest('hex');

const blocked = (reason) => Object.freeze({ status: 'BLOCKED', reason });

function createSessionDiagnostics(emit = () => {}) {
  let emitted = false;
  return Object.freeze({
    deprecatedAlias(requestedRole, effectiveRole) {
      if (emitted) return;
      emitted = true;
      emit(`deprecated role alias ${requestedRole}; use ${effectiveRole}`);
    },
  });
}

function resolveRole({ requestedRole, mode, provider, diagnostics } = {}) {
  if (typeof requestedRole !== 'string' || !requestedRole) return blocked('requested role is required');
  const retired = retirementGuidance(requestedRole);
  if (retired) return blocked(retired);

  let effectiveRole = requestedRole;
  let canonicalRole = requestedRole;
  let providerConstraint;
  let deprecatedAlias = false;
  let compatibilitySource = 'canonical-role';
  if (ALIASES[requestedRole]) {
    effectiveRole = ALIASES[requestedRole].effectiveRole;
    canonicalRole = LEGACY_PROVIDER_ROLES[effectiveRole].canonicalRole;
    providerConstraint = LEGACY_PROVIDER_ROLES[effectiveRole].provider;
    deprecatedAlias = true;
    compatibilitySource = 'legacy-role-alias';
  } else if (LEGACY_PROVIDER_ROLES[requestedRole]) {
    canonicalRole = LEGACY_PROVIDER_ROLES[requestedRole].canonicalRole;
    providerConstraint = LEGACY_PROVIDER_ROLES[requestedRole].provider;
    compatibilitySource = 'legacy-provider-role';
  } else if (!CANONICAL_ROLES[requestedRole]) {
    return blocked(`unknown role: ${requestedRole}`);
  }

  const definition = ROLE_MATRIX[effectiveRole] || {
    authority: CANONICAL_ROLES[canonicalRole].authority,
  };
  if (mode !== 'read-only' && mode !== 'workspace-write') return blocked('mode is required and must be explicit');
  if (definition.authority !== mode) return blocked(`role ${effectiveRole} contradicts mode ${mode}`);

  const normalizedProvider = provider === undefined ? undefined : agentForAlias(provider);
  if (provider !== undefined && !normalizedProvider) return blocked(`unknown provider: ${provider}`);
  if (!providerConstraint && normalizedProvider !== undefined) providerConstraint = normalizedProvider;
  if (providerConstraint && normalizedProvider !== undefined && normalizedProvider !== providerConstraint) {
    return blocked(`role ${effectiveRole} is not bound to provider ${provider}`);
  }

  const fields = {
    requested_role: requestedRole,
    effective_role: effectiveRole,
    authority: definition.authority,
    source_id: 'dhpk.cli-role-resolver',
  };
  const roleContract = Object.freeze({
    schema: 'dhpk.role-contract.v1',
    ...fields,
    evidence_sha256: digest(fields),
  });
  if (deprecatedAlias && diagnostics && typeof diagnostics.deprecatedAlias === 'function') {
    diagnostics.deprecatedAlias(requestedRole, effectiveRole);
  }
  return Object.freeze({
    status: 'RESOLVED', requested_role: requestedRole, effective_role: effectiveRole,
    canonical_role: canonicalRole,
    provider_constraint: providerConstraint || null,
    compatibility_source: compatibilitySource,
    deprecation_evidence: deprecatedAlias ? `deprecated role alias: ${requestedRole}` : null,
    deprecated_alias: deprecatedAlias, role_contract: roleContract,
  });
}

// Model, effort, and timeout come from the dispatch-config reader; removed keys are never read.
function resolveConfig({ effectiveRole, config = {} } = {}) {
  return resolveRoleConfig({ role: effectiveRole, config });
}

function resolvePublication({ role, target, capabilities = [] } = {}) {
  if (!ROLE_MATRIX[role] && !CANONICAL_ROLES[role]) return Object.freeze({ status: 'UNAVAILABLE', reason: `unknown role: ${role}` });
  if (role === 'codex-reviewer' && target === 'codex-native' && !capabilities.includes('codex-native-read-only-reviewer')) {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'missing capability: codex-native-read-only-reviewer' });
  }
  if (target !== 'shared-runner' && target !== 'codex-native') return Object.freeze({ status: 'UNAVAILABLE', reason: `unknown publication target: ${target}` });
  return Object.freeze({ status: 'AVAILABLE', role });
}

module.exports = Object.freeze({
  ALIASES, ROLE_MATRIX, createSessionDiagnostics, resolveConfig, resolvePublication, resolveRole,
});
