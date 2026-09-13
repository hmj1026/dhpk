'use strict';

const {
  createDispatchRequest,
  createFlowHandoff,
} = (() => {
  const dispatch = require('../../../scripts/lib/dispatch-contract');
  const handoff = require('../../../scripts/lib/flow-handoff-contract');
  return { ...dispatch, ...handoff };
})();
const { resolveTarget } = require('../../../scripts/lib/dispatch-engine');

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

function prepareDispatch({ change, request, catalog, preferenceOrder } = {}) {
  requireConfirmedChange(change);
  const normalized = createDispatchRequest({
    ...request,
    role: request.role || 'worker',
    authority: request.authority || ROLE_AUTHORITY[request.role || 'worker'],
  });
  const resolution = resolveTarget(normalized, { catalog, preferenceOrder });
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
