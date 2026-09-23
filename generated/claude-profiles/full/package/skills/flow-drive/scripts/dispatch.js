'use strict';

const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '..');
const EXECUTION_BUNDLE_ROOT = path.join(SKILL_ROOT, 'references', 'execution-bundle');
const bundleModule = (relativePath) => require(path.join(EXECUTION_BUNDLE_ROOT, relativePath));

const { createDispatchRequest } = bundleModule(path.join('scripts', 'lib', 'dispatch-contract'));
const { createFlowHandoff } = bundleModule(path.join('scripts', 'lib', 'flow-handoff-contract'));
const { resolveTarget } = bundleModule(path.join('scripts', 'lib', 'dispatch-engine'));
const DEFAULT_CATALOG = require(path.join(EXECUTION_BUNDLE_ROOT, 'manifests', 'provider-model-catalog.json'));
const HOST_PROFILES = require(path.join(EXECUTION_BUNDLE_ROOT, 'manifests', 'host-profiles.json'));

const ROLE_AUTHORITY = Object.freeze({
  planner: 'read-only',
  reasoner: 'read-only',
  worker: 'workspace-write',
  reviewer: 'read-only',
});

function requireConfirmedChange(change) {
  if (!change || typeof change !== 'object' || change.confirmed !== true) {
    throw new Error('flow-drive requires a confirmed change before dispatch');
  }
  if (typeof change.change_id !== 'string' || change.change_id.trim() === '') {
    throw new Error('confirmed change requires change_id');
  }
  return change;
}

function bundledHostProfile(request) {
  if (request && request.host_profile) return request.host_profile;
  const host = request && (request.host || request.hostProfile);
  const profiles = HOST_PROFILES && Array.isArray(HOST_PROFILES.profiles) ? HOST_PROFILES.profiles : [];
  const profile = profiles.find((candidate) => candidate && candidate.host === host);
  if (!profile) {
    throw new Error(`flow-drive has no bundled Host profile for '${host || 'unspecified'}'; supply an explicit current profile`);
  }
  return profile;
}

function prepareDispatch({ change, request, catalog, preferenceOrder } = {}) {
  requireConfirmedChange(change);
  if (!request || typeof request !== 'object') throw new TypeError('dispatch request is required');
  const normalized = createDispatchRequest({
    ...request,
    host_profile: bundledHostProfile(request),
    role: request.role || 'worker',
    authority: request.authority || ROLE_AUTHORITY[request.role || 'worker'],
  });
  const resolution = resolveTarget(normalized, { catalog: catalog || DEFAULT_CATALOG, preferenceOrder });
  const handoff = createFlowHandoff({
    handoff_id: `flow-drive-${normalized.task_id}-${normalized.attempt_id}`,
    owner: 'flow-drive',
    host: normalized.host_profile.host,
    disposition: resolution.status === 'RESOLVED' ? 'ready' : 'blocked',
    target: resolution.target ? {
      provider: resolution.target.provider,
      model: resolution.target.model,
      role: normalized.role,
      effort: normalized.effort,
      transport: resolution.target.transport,
    } : null,
    evidence: [{
      kind: 'dispatch-resolution',
      state: resolution.status === 'RESOLVED' ? 'available' : 'unavailable',
      detail: resolution.reason || 'Dispatch target resolved by the common engine',
    }],
    next_action: resolution.status === 'RESOLVED' ? 'execute the resolved target' : 'repair the blocked dispatch evidence',
  });
  return Object.freeze({ change_id: change.change_id, request: normalized, resolution, handoff });
}

module.exports = Object.freeze({ ROLE_AUTHORITY, prepareDispatch, requireConfirmedChange });
