'use strict';

// Application/domain facade for deterministic projection planning.  Concrete
// filesystem and consumer implementations are injected at the boundary so
// this module remains safe to exercise without a checkout or installed client.

const {
  createDistributionPlan,
  createDistributionArtifact,
  createEvidenceResult,
  projectionError,
  VERIFICATION_STAGES,
} = require('./distribution-projection-contract');

function inventoryEntries(inventory, surface) {
  if (!inventory || typeof inventory !== 'object') return [];
  return [...(inventory.skills || []), ...(inventory.modules || [])]
    .filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes(surface))
    .map((entry) => ({
      stableId: entry.id,
      source: entry.path,
      destination: entry.destination || entry.path,
      owner: entry.owner || entry.id,
      transform: entry.transform || { id: 'identity', version: '1' },
      symlinkPolicy: entry.symlink_policy || entry.symlinkPolicy || 'forbid',
    }));
}

function compileDistribution(inputs = {}) {
  const entries = inputs.entries || inventoryEntries(inputs.inventory, inputs.surface);
  if (!inputs.entries && (!inputs.inventory || typeof inputs.inventory !== 'object')) {
    return {
      ok: false,
      error: projectionError('INVALID_INPUT', 'compile', 'inventory is required when entries are not supplied'),
    };
  }
  return createDistributionPlan({ ...inputs, entries });
}

function materializeDistribution(plan, adapter, artifactStore) {
  if (!plan || typeof plan !== 'object' || !plan.planFingerprint) {
    return { ok: false, error: projectionError('INVALID_PLAN', 'materialize', 'a compiled plan is required') };
  }
  if (!adapter || typeof adapter.render !== 'function') {
    return { ok: false, error: projectionError('INVALID_ADAPTER', 'materialize', 'projection adapter must expose render(plan)') };
  }
  if (!artifactStore || typeof artifactStore.begin !== 'function') {
    return { ok: false, error: projectionError('INVALID_STORE', 'materialize', 'artifact store must expose begin(plan)') };
  }

  let session;
  try {
    session = artifactStore.begin(plan);
    const rendered = adapter.render(plan, { session });
    if (!rendered || !Array.isArray(rendered.outputs)) {
      throw new Error('projection adapter must return { outputs }');
    }
    if (rendered.links !== undefined && !Array.isArray(rendered.links)) {
      throw new Error('projection adapter links must be an array when present');
    }
    if (typeof session.write !== 'function' || typeof session.publish !== 'function') {
      throw new Error('artifact store session must expose write(output) and publish()');
    }
    const links = rendered.links || [];
    const expectedIds = new Set(plan.entries.map((entry) => entry.stableId));
    const emittedIds = new Set();
    const checkEmission = (emission) => {
      const stableId = emission && emission.stableId;
      if (!expectedIds.has(stableId)) {
        const error = new Error(`rendered output '${stableId}' is absent from the plan`);
        error.projectionCode = 'UNPLANNED_OUTPUT';
        error.projectionDetails = { stableIds: [stableId] };
        throw error;
      }
      if (emittedIds.has(stableId)) {
        const error = new Error(`planned output '${stableId}' was emitted more than once`);
        error.projectionCode = 'DUPLICATE_OUTPUT';
        error.projectionDetails = { stableIds: [stableId] };
        throw error;
      }
      emittedIds.add(stableId);
    };
    for (const output of rendered.outputs) {
      checkEmission(output);
      session.write(output);
    }
    if (typeof session.link !== 'function' && links.length > 0) {
      throw new Error('artifact store session must expose link(output) for rendered links');
    }
    for (const link of links) {
      checkEmission(link);
      session.link(link);
    }
    const missingIds = plan.entries
      .map((entry) => entry.stableId)
      .filter((stableId) => !emittedIds.has(stableId));
    if (missingIds.length > 0) {
      const error = new Error(`rendered projection is missing planned outputs: ${missingIds.join(', ')}`);
      error.projectionCode = 'INCOMPLETE_OUTPUTS';
      error.projectionDetails = { stableIds: missingIds };
      throw error;
    }
    if (typeof adapter.validate === 'function') {
      adapter.validate(rendered, { plan, session });
    }
    const published = session.publish();
    const artifact = createDistributionArtifact({
      planFingerprint: plan.planFingerprint,
      adapter: rendered.adapter || adapter.identity || { id: 'unknown', version: 'unknown' },
      outputs: published && published.outputs ? published.outputs : rendered.outputs,
      links: published && published.links ? published.links : links,
      artifactFingerprint: published && published.artifactFingerprint,
      metadata: rendered.metadata,
    });
    if (!artifact.ok) return artifact;
    return artifact;
  } catch (error) {
    if (session && typeof session.abort === 'function') {
      try { session.abort(); } catch (_) { /* preserve original failure */ }
    }
    return {
      ok: false,
      error: projectionError(error.projectionCode || 'MATERIALIZATION_FAILED', 'materialize', error.message, {
        stableIds: error.projectionDetails && error.projectionDetails.stableIds,
        paths: error.projectionDetails && error.projectionDetails.paths,
        details: { cause: error.name },
      }),
    };
  }
}

function verifyDistribution(stage, artifact, consumerAdapter) {
  if (!VERIFICATION_STAGES.includes(stage)) {
    return { ok: false, error: projectionError('INVALID_STAGE', 'verify', `unsupported verification stage '${stage}'`, { stage }) };
  }
  if (!artifact || typeof artifact !== 'object' || !artifact.planFingerprint) {
    return { ok: false, error: projectionError('INVALID_ARTIFACT', 'verify', 'a materialized artifact is required', { stage }) };
  }
  if (!consumerAdapter || typeof consumerAdapter.verify !== 'function') {
    return { ok: false, error: projectionError('INVALID_ADAPTER', 'verify', 'consumer adapter must expose verify(stage, artifact)', { stage }) };
  }
  try {
    const observed = consumerAdapter.verify(stage, artifact);
    return createEvidenceResult({
      ...observed,
      stage,
      planFingerprint: artifact.planFingerprint,
      artifactFingerprint: artifact.artifactFingerprint,
      adapter: observed && observed.adapter ? observed.adapter : consumerAdapter.identity,
    });
  } catch (error) {
    return createEvidenceResult({
      stage,
      planFingerprint: artifact.planFingerprint,
      artifactFingerprint: artifact.artifactFingerprint,
      adapter: consumerAdapter.identity,
      verdict: 'FAIL',
      diagnostics: [error.message],
    });
  }
}

module.exports = {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
};
