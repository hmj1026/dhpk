'use strict';

// Activation is deliberately separate from compilation and staging.  A
// candidate can be fully materialized and structurally verified without
// replacing the active root; only this gate may authorize the replacement.

const { evaluateActivation } = require('./capability-bundle-selection');

function activateStagedCandidate({ session, requiredRuntimeSurfaces = [], evidence = [] } = {}) {
  if (!session || typeof session.activate !== 'function') {
    return {
      ok: false,
      gate: evaluateActivation({ requiredRuntimeSurfaces, evidence }),
      error: { code: 'ACTIVATION_UNAVAILABLE', message: 'artifact session does not expose a separate activate() phase' },
    };
  }
  const gate = evaluateActivation({ requiredRuntimeSurfaces, evidence });
  if (!gate.ok) {
    if (typeof session.abort === 'function') session.abort();
    return {
      ok: false,
      gate,
      error: {
        code: 'ACTIVATION_BLOCKED',
        message: `required runtime activation evidence is non-pass: ${gate.nonPassSurfaces.join(', ') || gate.diagnostics.join('; ')}`,
      },
    };
  }
  try {
    const artifact = session.activate();
    return { ok: true, gate, artifact };
  } catch (error) {
    if (typeof session.abort === 'function') session.abort();
    return { ok: false, gate, error: { code: 'ACTIVATION_FAILED', message: error.message } };
  }
}

module.exports = { activateStagedCandidate };
