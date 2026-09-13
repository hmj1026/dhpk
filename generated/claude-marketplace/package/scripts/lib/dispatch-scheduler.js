'use strict';

const { createDispatchRequest, createProviderModelCatalog } = require('./dispatch-contract');
const { decideFallback, FAILURE_CLASSES, resolveTarget } = require('./dispatch-engine');

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((file) => rightSet.has(file));
}

function scheduleResolution(request, catalog, preferenceOrder, allowFallback) {
  const resolution = resolveTarget(request, { catalog, preferenceOrder });
  if (allowFallback && resolution.status === 'UNAVAILABLE' && resolution.fallback_eligible === true) {
    const fallback = decideFallback({
      request: resolution.request,
      resolution,
      failureClass: FAILURE_CLASSES.CLI_UNAVAILABLE,
      sideEffects: 'none',
      catalog,
    });
    if (fallback.status === 'FALLBACK') {
      return {
        resolution: Object.freeze({
          ...resolution,
          status: 'RESOLVED',
          target: fallback.target,
          capability: fallback.capability,
          fallback_history: fallback.fallback_history,
        }),
        fallback,
      };
    }
  }
  return { resolution, fallback: null };
}

function createSchedule(inputs, { catalog: rawCatalog, preferenceOrder, fallback = true } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('scheduler requires at least one request');
  const catalog = createProviderModelCatalog(rawCatalog);
  const requests = inputs.map(createDispatchRequest);
  const resolutions = requests.map((request) => scheduleResolution(request, catalog, preferenceOrder, fallback));
  const byId = new Map(requests.map((request) => [request.task_id, request]));
  const remaining = new Set(requests.map((request) => request.task_id));
  const waves = [];
  const diagnostics = [];
  const blocked = [];
  let guard = requests.length * 2;

  while (remaining.size > 0 && guard > 0) {
    guard -= 1;
    const wave = [];
    const usage = new Map();
    for (const request of requests) {
      if (!remaining.has(request.task_id)) continue;
      const scheduled = resolutions.find((entry) => entry.resolution.request.task_id === request.task_id);
      const resolution = scheduled.resolution;
      if (resolution.status !== 'RESOLVED') {
        blocked.push({ request, resolution, status: 'BLOCKED' });
        remaining.delete(request.task_id);
        continue;
      }
      const dependencies = request.parallelism.dependencies;
      if (dependencies.some((dependency) => byId.has(dependency) && remaining.has(dependency))) continue;
      if (dependencies.some((dependency) => !byId.has(dependency))) {
        blocked.push({ request, resolution, status: 'BLOCKED', reason: `unknown dependency: ${dependencies.join(', ')}` });
        remaining.delete(request.task_id);
        continue;
      }
      if (wave.some((entry) => intersects(entry.request.scope.assigned_files, request.scope.assigned_files))) {
        diagnostics.push({ task_id: request.task_id, reason: 'assigned scope conflict' });
        continue;
      }
      const profile = request.host_profile;
      const pool = profile.quota_pools[resolution.target.provider];
      const limit = profile.concurrency_limits[pool];
      const current = usage.get(pool) || 0;
      const requestLimit = request.parallelism.max_concurrency;
      if (current >= limit || wave.length >= requestLimit) {
        diagnostics.push({ task_id: request.task_id, reason: 'Provider quota limit', pool });
        continue;
      }
      usage.set(pool, current + 1);
        wave.push({ request, resolution, target: resolution.target, fallback: scheduled.fallback });
    }
    if (wave.length === 0) {
      if (remaining.size > 0) {
        for (const taskId of remaining) {
          const request = byId.get(taskId);
          blocked.push({ request, status: 'BLOCKED', reason: 'dependency or admission cycle' });
          remaining.delete(taskId);
        }
      }
      break;
    }
    waves.push(wave);
    wave.forEach((entry) => remaining.delete(entry.request.task_id));
  }
  return Object.freeze({ status: blocked.length > 0 && waves.length === 0 ? 'BLOCKED' : 'READY', waves, blocked, diagnostics });
}

function timeoutPromise(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ status: 'TIMEOUT' }), timeoutMs)),
  ]);
}

async function executeSchedule(inputs, { catalog: rawCatalog, preferenceOrder, dispatch, registry, fallback = true, signal, timeoutMs } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('scheduler dispatch function is required');
  const plan = createSchedule(inputs, { catalog: rawCatalog, preferenceOrder, fallback });
  const results = plan.blocked.map((entry) => ({
    task_id: entry.request.task_id,
    status: 'BLOCKED',
    reason: entry.reason || entry.resolution && entry.resolution.reason,
    launch_identity: {
      task_id: entry.request.task_id,
      attempt_id: entry.request.attempt_id,
      target: entry.resolution && entry.resolution.target ? entry.resolution.target.identity : null,
    },
  }));
  const completed = new Map(results.map((entry) => [entry.task_id, entry.status]));
  for (const wave of plan.waves) {
    const waveResults = await Promise.all(wave.map(async (entry) => {
      const launch_identity = {
        task_id: entry.request.task_id,
        attempt_id: entry.request.attempt_id,
        target: entry.target.identity,
      };
      if (signal && signal.aborted) return { task_id: entry.request.task_id, status: 'CANCELLED', launch_identity };
          const failedDependency = entry.request.parallelism.dependencies.find((dependency) => completed.get(dependency) !== 'SUCCEEDED');
      if (failedDependency) return { task_id: entry.request.task_id, status: 'BLOCKED', reason: `dependency did not succeed: ${failedDependency}`, launch_identity };
      try {
        const outcome = await timeoutPromise(dispatch(entry.request, {
          catalog: rawCatalog,
          registry,
          preferenceOrder,
          fallback,
          resolution: entry.resolution,
        }), timeoutMs);
        const status = outcome && outcome.status;
        return {
          task_id: entry.request.task_id,
          status: status === 'SUCCEEDED' ? 'SUCCEEDED' : status || 'FAILED',
          receipt: outcome && outcome.receipt,
          ...(entry.fallback ? { fallback: entry.fallback } : {}),
          launch_identity,
        };
      } catch (error) {
        return { task_id: entry.request.task_id, status: 'CRASHED', reason: error.message, launch_identity };
      }
    }));
    results.push(...waveResults);
    waveResults.forEach((entry) => completed.set(entry.task_id, entry.status));
  }
  return Object.freeze({ status: results.every((entry) => entry.status === 'SUCCEEDED') ? 'SUCCEEDED' : 'COMPLETED_WITH_FAILURES', plan, results });
}

module.exports = Object.freeze({ createSchedule, executeSchedule });
