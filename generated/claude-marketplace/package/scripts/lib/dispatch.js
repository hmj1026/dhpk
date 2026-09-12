'use strict';

const { createDispatchReceipt } = require('./dispatch-contract');
const { decideFallback, FAILURE_CLASSES } = require('./dispatch-engine');
const { resolveTarget } = require('./dispatch-engine');

function blockedReceipt(request, resolution) {
  return createDispatchReceipt({
    receipt_id: `receipt-${request.attempt_id}`,
    request,
    target: resolution.target || null,
    status: 'BLOCKED',
    failure_class: resolution.status === 'NOT_RUN' ? 'CAPABILITY_PROBE_NOT_RUN' : 'CAPABILITY_UNAVAILABLE',
    verification: 'BLOCKED',
    capability_evidence: resolution.capability,
    resolution_source: 'dispatch-engine',
  });
}

async function dispatch(request, { catalog, registry, preferenceOrder, fallback = true } = {}) {
  if (!registry || typeof registry.get !== 'function') throw new TypeError('dispatch requires an Adapter registry');
  const resolution = resolveTarget(request, { catalog, preferenceOrder });
  if (resolution.status !== 'RESOLVED') {
    if (fallback && resolution.status === 'UNAVAILABLE' && resolution.fallback_eligible === true) {
      const fallbackDecision = decideFallback({
        request: resolution.request,
        resolution,
        failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
        sideEffects: 'none',
        catalog,
      });
      if (fallbackDecision.status === 'FALLBACK') {
        const adapter = registry.get(fallbackDecision.target.provider);
        if (!adapter) return blockedReceipt(resolution.request, fallbackDecision);
        const outcome = adapter.execute(fallbackDecision.target, fallbackDecision.request);
        return Object.freeze({ ...outcome, fallback: fallbackDecision, receipt: outcome.receipt });
      }
    }
    return Object.freeze({ status: 'BLOCKED', receipt: blockedReceipt(resolution.request, resolution), resolution });
  }
  const adapter = registry.get(resolution.target.provider);
  if (!adapter) {
    const unavailable = { ...resolution, status: 'UNAVAILABLE', reason: `no Adapter is registered for ${resolution.target.provider}` };
    return Object.freeze({ status: 'BLOCKED', receipt: blockedReceipt(resolution.request, unavailable), resolution: unavailable });
  }
  const outcome = await adapter.execute(resolution.target, resolution.request);
  return Object.freeze({ ...outcome, resolution });
}

module.exports = Object.freeze({ dispatch });
