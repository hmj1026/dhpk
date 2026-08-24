'use strict';

const { REQUIRED_SURFACES, REQUIRED_RUNTIME_SURFACES } = require('./harness-surfaces');

const OUTCOMES = Object.freeze([
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
  'NOT_CONFIGURED',
  'SKIP_INCOMPATIBLE',
  'UNAVAILABLE',
  'NO_SHIP',
  'PARTIAL',
  'PUBLISHED_PENDING',
  'PUBLISHED_UNHEALTHY',
  'COMPLETE',
  'OVERRIDDEN',
]);

const LIFECYCLE_PHASES = Object.freeze([
  'PLANNED',
  'RED',
  'GREEN',
  'REFACTOR',
  'VERIFIED',
  'COMPLETE',
]);

const EXIT_CODES = Object.freeze({
  PASS: 0,
  COMPLETE: 0,
  FAIL: 1,
  BLOCKED: 2,
  NOT_RUN: 2,
  NOT_CONFIGURED: 2,
  SKIP_INCOMPATIBLE: 2,
  UNAVAILABLE: 2,
  NO_SHIP: 2,
  PARTIAL: 2,
  PUBLISHED_PENDING: 2,
  PUBLISHED_UNHEALTHY: 2,
  OVERRIDDEN: 2,
  USAGE: 64,
  INTERNAL_ERROR: 70,
});

function exitCodeForOutcome(outcome) {
  if (!Object.prototype.hasOwnProperty.call(EXIT_CODES, outcome)) {
    throw new Error(`harness: unknown outcome '${outcome}'`);
  }
  return EXIT_CODES[outcome];
}

function createResult({ phase, lifecyclePhase = null, outcome = 'NOT_RUN', ...details } = {}) {
  if (typeof phase !== 'string' || !phase) throw new Error('harness: phase is required');
  if (!OUTCOMES.includes(outcome)) throw new Error(`harness: invalid outcome '${outcome}'`);
  if (lifecyclePhase !== null && !LIFECYCLE_PHASES.includes(lifecyclePhase)) {
    throw new Error(`harness: invalid lifecycle phase '${lifecyclePhase}'`);
  }
  return {
    schema: 'dhpk.harness.result.v1',
    phase,
    lifecyclePhase,
    outcome,
    status: outcome,
    exitCode: exitCodeForOutcome(outcome),
    ...details,
  };
}

function assertSurfaceList(requiredSurfaces, { fullRelease = true } = {}) {
  if (!Array.isArray(requiredSurfaces) || requiredSurfaces.length === 0) {
    throw new Error('harness: required surface list is missing');
  }
  const known = new Set(REQUIRED_SURFACES);
  const seen = new Set();
  for (const surface of requiredSurfaces) {
    if (!known.has(surface)) throw new Error(`harness: unknown required surface '${surface}'`);
    if (seen.has(surface)) throw new Error(`harness: duplicate required surface '${surface}'`);
    seen.add(surface);
  }
  if (fullRelease && (requiredSurfaces.length !== REQUIRED_SURFACES.length
    || requiredSurfaces.some((surface, index) => surface !== REQUIRED_SURFACES[index]))) {
    throw new Error('harness: full release must use the canonical required surface list');
  }
  return [...requiredSurfaces];
}

function aggregateRequiredSurfaces({ requiredSurfaces, requiredRuntimeSurfaces, surfaceResults, fullRelease = true } = {}) {
  const selected = assertSurfaceList(requiredSurfaces, { fullRelease });
  const explicitRuntimeList = requiredRuntimeSurfaces !== undefined;
  const runtime = assertSurfaceList(explicitRuntimeList ? requiredRuntimeSurfaces : selected, { fullRelease: false });
  const selectedSet = new Set(selected);
  const foreignRuntime = runtime.filter((surface) => !selectedSet.has(surface));
  if (foreignRuntime.length > 0) throw new Error(`harness: runtime surfaces must be a subset of required surfaces: ${foreignRuntime.join(', ')}`);
  if (explicitRuntimeList && runtime.includes('cursor-sync')) throw new Error('harness: required runtime surfaces must not include cursor-sync');
  if (fullRelease && explicitRuntimeList
    && (runtime.length !== REQUIRED_RUNTIME_SURFACES.length
      || runtime.some((surface, index) => surface !== REQUIRED_RUNTIME_SURFACES[index]))) {
    throw new Error('harness: full release must use the canonical required runtime surface list');
  }
  if (!Array.isArray(surfaceResults)) throw new Error('harness: surface results must be an array');

  const bySurface = new Map();
  for (const result of surfaceResults) {
    if (!result || typeof result.surface !== 'string') throw new Error('harness: surface result is missing surface');
    if (bySurface.has(result.surface)) throw new Error(`harness: duplicate surface result '${result.surface}'`);
    bySurface.set(result.surface, result);
  }
  const missing = selected.filter((surface) => !bySurface.has(surface));
  if (missing.length > 0) throw new Error(`harness: missing required surface results: ${missing.join(', ')}`);

  const selectedResults = selected.map((surface) => bySurface.get(surface));
  const runtimeResults = runtime.map((surface) => bySurface.get(surface));
  const statuses = runtimeResults.map((result) => result.status || result.outcome || result.verdict);
  const excludedFailures = selectedResults
    .filter((result) => !runtime.includes(result.surface))
    .map((result) => result.status || result.outcome || result.verdict)
    .filter((status) => status === 'FAIL');
  statuses.push(...excludedFailures);
  let outcome = fullRelease ? 'COMPLETE' : 'PASS';
  if (statuses.some((status) => status === 'FAIL')) outcome = 'PUBLISHED_UNHEALTHY';
  else if (statuses.some((status) => status === 'BLOCKED')) outcome = 'BLOCKED';
  else if (statuses.some((status) => status !== 'PASS')) outcome = 'PUBLISHED_PENDING';

  return {
    schema: 'dhpk.harness.surface-aggregate.v1',
    requiredSurfaces: selected,
    requiredRuntimeSurfaces: runtime,
    fullRelease,
    surfaceResults: selectedResults,
    outcome,
    exitCode: exitCodeForOutcome(outcome),
  };
}

module.exports = {
  REQUIRED_SURFACES,
  REQUIRED_RUNTIME_SURFACES,
  OUTCOMES,
  LIFECYCLE_PHASES,
  EXIT_CODES,
  exitCodeForOutcome,
  createResult,
  assertSurfaceList,
  aggregateRequiredSurfaces,
};
