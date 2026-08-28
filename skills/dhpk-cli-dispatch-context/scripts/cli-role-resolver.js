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
  if (mode !== 'read-only' && mode !== 'workspace-write') return blocked('mode is required and must be explicit');

  let effectiveRole = requestedRole;
  let deprecatedAlias = false;
  if (requestedRole === 'codex-bridge') {
    effectiveRole = BRIDGE_MODES[mode];
    deprecatedAlias = true;
  } else if (ALIASES[requestedRole]) {
    effectiveRole = ALIASES[requestedRole].effectiveRole;
    deprecatedAlias = true;
  }

  const definition = ROLE_MATRIX[effectiveRole];
  if (!definition) return blocked(`unknown role: ${requestedRole}`);
  if (definition.authority !== mode) return blocked(`role ${effectiveRole} contradicts mode ${mode}`);
  if (provider !== undefined && provider !== definition.provider) {
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
    deprecated_alias: deprecatedAlias, role_contract: roleContract,
  });
}

const configValue = (config, canonical, legacy) => {
  if (Object.prototype.hasOwnProperty.call(config, canonical)) return { value: config[canonical], source: canonical };
  if (legacy && Object.prototype.hasOwnProperty.call(config, legacy)) return { value: config[legacy], source: legacy };
  return { value: undefined, source: undefined };
};

function resolveConfig({ effectiveRole, config = {} } = {}) {
  const definition = ROLE_MATRIX[effectiveRole];
  if (!definition) return Object.freeze({ status: 'BLOCKED', reason: `unknown role: ${effectiveRole}` });
  const legacy = LEGACY_CONFIG[definition.config] || {};
  return Object.freeze({
    model: configValue(config, `${definition.config}_model`, legacy.model),
    effort: configValue(config, `${definition.config}_effort`, legacy.effort),
    timeout_secs: configValue(config, `${definition.config}_timeout_secs`, legacy.timeout_secs),
  });
}

function resolvePublication({ role, target, capabilities = [] } = {}) {
  if (!ROLE_MATRIX[role]) return Object.freeze({ status: 'UNAVAILABLE', reason: `unknown role: ${role}` });
  if (role === 'codex-reviewer' && target === 'codex-native' && !capabilities.includes('codex-native-read-only-reviewer')) {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'missing capability: codex-native-read-only-reviewer' });
  }
  if (target !== 'shared-runner' && target !== 'codex-native') return Object.freeze({ status: 'UNAVAILABLE', reason: `unknown publication target: ${target}` });
  return Object.freeze({ status: 'AVAILABLE', role });
}

module.exports = Object.freeze({
  ALIASES, BRIDGE_MODES, ROLE_MATRIX, createSessionDiagnostics, resolveConfig, resolvePublication, resolveRole,
});
