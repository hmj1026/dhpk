'use strict';

const crypto = require('node:crypto');

const ROLE_MATRIX = Object.freeze({
  'codex-worker': Object.freeze({ provider: 'codex', authority: 'workspace-write', config: 'codex_worker' }),
  'codex-reasoner': Object.freeze({ provider: 'codex', authority: 'read-only', config: 'codex_reasoner' }),
  'codex-reviewer': Object.freeze({ provider: 'codex', authority: 'read-only', config: 'codex_reviewer' }),
  'agy-worker': Object.freeze({ provider: 'agy', authority: 'workspace-write', config: 'agy_worker' }),
});

const ALIASES = Object.freeze({
  'codex-fast-worker': Object.freeze({ effectiveRole: 'codex-worker' }),
  'codex-deep-reasoner': Object.freeze({ effectiveRole: 'codex-reasoner' }),
  'agy-fast-worker': Object.freeze({ effectiveRole: 'agy-worker' }),
});

const BRIDGE_MODES = Object.freeze({
  'read-only': 'codex-reviewer',
  'workspace-write': 'codex-worker',
});

const CANONICAL_ROLES = Object.freeze({
  planner: Object.freeze({ authority: 'read-only' }),
  reasoner: Object.freeze({ authority: 'read-only' }),
  worker: Object.freeze({ authority: 'workspace-write' }),
  reviewer: Object.freeze({ authority: 'read-only' }),
});

const PROVIDER_ALIASES = Object.freeze({
  claude: 'claude-code',
  codex: 'codex-cli',
  agy: 'agy',
  'claude-code': 'claude-code',
  'codex-cli': 'codex-cli',
  'cursor-native': 'cursor-native',
});

const LEGACY_PROVIDER_ROLES = Object.freeze({
  'codex-worker': Object.freeze({ canonicalRole: 'worker', provider: 'codex-cli' }),
  'codex-reasoner': Object.freeze({ canonicalRole: 'reasoner', provider: 'codex-cli' }),
  'codex-reviewer': Object.freeze({ canonicalRole: 'reviewer', provider: 'codex-cli' }),
  'agy-worker': Object.freeze({ canonicalRole: 'worker', provider: 'agy' }),
});

const LEGACY_CONFIG = Object.freeze({
  codex_worker: Object.freeze({
    model: 'codex_fast_worker_model', effort: 'codex_fast_worker_effort', timeout_secs: 'codex_fast_worker_timeout_secs',
  }),
  codex_reasoner: Object.freeze({
    model: 'codex_deep_reasoner_model', effort: 'codex_deep_reasoner_effort', timeout_secs: 'codex_deep_reasoner_timeout_secs',
  }),
  codex_reviewer: Object.freeze({ timeout_secs: 'codex_bridge_timeout_secs' }),
  agy_worker: Object.freeze({ model: 'agy_fast_worker_model' }),
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

  let effectiveRole = requestedRole;
  let canonicalRole = requestedRole;
  let providerConstraint;
  let deprecatedAlias = false;
  let compatibilitySource = 'canonical-role';
  if (requestedRole === 'codex-bridge') {
    if (mode !== 'read-only' && mode !== 'workspace-write') return blocked('mode is required and must be explicit');
    effectiveRole = BRIDGE_MODES[mode];
    canonicalRole = mode === 'read-only' ? 'reviewer' : 'worker';
    providerConstraint = 'codex-cli';
    deprecatedAlias = true;
    compatibilitySource = 'legacy-role-alias';
  } else if (ALIASES[requestedRole]) {
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

  const normalizedProvider = provider === undefined ? undefined : PROVIDER_ALIASES[provider];
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

const configValue = (config, canonical, legacy) => {
  if (Object.prototype.hasOwnProperty.call(config, canonical)) return { value: config[canonical], source: canonical };
  if (legacy && Object.prototype.hasOwnProperty.call(config, legacy)) return { value: config[legacy], source: legacy };
  return { value: undefined, source: undefined };
};

function resolveConfig({ effectiveRole, config = {} } = {}) {
  const canonicalDefinition = CANONICAL_ROLES[effectiveRole];
  const definition = ROLE_MATRIX[effectiveRole] || (canonicalDefinition ? {
    config: effectiveRole === 'worker' ? 'codex_worker' : effectiveRole,
  } : null);
  if (!definition) return Object.freeze({ status: 'BLOCKED', reason: `unknown role: ${effectiveRole}` });
  const legacy = LEGACY_CONFIG[definition.config] || {};
  const canonicalConfig = ROLE_MATRIX[effectiveRole] ? definition.config : effectiveRole;
  return Object.freeze({
    model: configValue(config, `${canonicalConfig}_model`, legacy.model || undefined),
    effort: configValue(config, `${canonicalConfig}_effort`, legacy.effort || undefined),
    timeout_secs: configValue(config, `${canonicalConfig}_timeout_secs`, legacy.timeout_secs || undefined),
  });
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
  ALIASES, BRIDGE_MODES, ROLE_MATRIX, createSessionDiagnostics, resolveConfig, resolvePublication, resolveRole,
});
