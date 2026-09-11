#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const {
  VALID_BACKENDS,
  resolveDispatchPlan,
} = require('./lib/native-dispatch-policy');
const {
  SCHEMAS,
  createDispatchRequest,
} = require('./lib/dispatch-contract');
const { resolveTarget } = require('./lib/dispatch-engine');

const DEFAULT_CATALOG = require('../manifests/provider-model-catalog.json');

const BACKENDS = VALID_BACKENDS;
const DEFAULT_ORDER = Object.freeze([...BACKENDS]);
const AGENTS = {
  claude: 'dhpk:fast-worker',
  codex: 'dhpk:codex-worker',
  agy: 'dhpk:agy-worker',
};

const parseBoolean = (value, fallback = false) => {
  if (['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'ON'].includes(String(value))) return true;
  if (['0', 'false', 'FALSE', 'no', 'NO', 'off', 'OFF'].includes(String(value))) return false;
  return fallback;
};

const configuredCrossProvider = () => {
  if (Object.prototype.hasOwnProperty.call(process.env, 'DHPK_PROJECT_OPTION_CROSS_PROVIDER')) {
    return parseBoolean(process.env.DHPK_PROJECT_OPTION_CROSS_PROVIDER);
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER')) {
    return parseBoolean(process.env.CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER);
  }
  return false;
};

const parseArgs = (argv) => {
  const out = { backend: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND || 'claude', order: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER || DEFAULT_ORDER.join(','), fallback: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK || 'none', failure: '', cross_provider: configuredCrossProvider() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--backend') out.backend = argv[++i] || '';
    else if (arg === '--order') out.order = argv[++i] || '';
    else if (arg === '--fallback') out.fallback = argv[++i] || '';
    else if (arg === '--failure') out.failure = argv[++i] || '';
    else if (arg === '--cross-provider') out.cross_provider = true;
  }
  return out;
};

const cliAvailable = (name) => spawnSync('bash', ['-c', 'command -v "$1" >/dev/null 2>&1', 'selector', name], { env: process.env }).status === 0;

const availability = (backend) => {
  if (backend === 'claude') return { available: process.env.DHPK_CLAUDE_BACKEND_AVAILABLE !== '0', reason: 'in-process backend' };
  const executable = backend === 'codex' ? 'codex' : 'agy';
  return cliAvailable(executable)
    ? { available: true, reason: `${executable} executable available` }
    : { available: false, reason: `missing executable: ${executable}` };
};

const blocked = (requested, selected, reason, metadata = {}) => ({
  status: 'blocked',
  requested_backend: requested,
  selected_backend: selected,
  selected_agent: AGENTS[selected] || `dhpk:${selected}-fast-worker`,
  reason,
  fallback: 'none',
  ...metadata,
});

const canonicalRequest = (options) => {
  if (options.request !== undefined) return createDispatchRequest(options.request);
  const hostProfile = options.host_profile || options.hostProfile;
  if (!hostProfile) throw new TypeError('canonical worker selection requires host_profile');
  const descriptionDigest = options.description_digest || '0'.repeat(64);
  const promptEvidence = options.prompt_evidence || {
    path: `${options.workdir || process.cwd()}/.dhpk/prompt.txt`,
    dev: 0,
    ino: 0,
    sha256: '0'.repeat(64),
  };
  return createDispatchRequest({
    schema: SCHEMAS.REQUEST,
    host_profile: hostProfile,
    task_id: options.task_id || 'fast-worker-task',
    attempt_id: options.attempt_id || 'fast-worker-attempt',
    role: 'worker',
    authority: 'workspace-write',
    task: options.task || { description_digest: descriptionDigest },
    scope: options.scope || {
      workdir: options.workdir || process.cwd(),
      assigned_files: options.assigned_files || [],
      prompt_evidence: promptEvidence,
    },
    ...(options.target === undefined ? {} : { target: options.target }),
    effort: options.effort || 'medium',
    fallback: options.fallback || { allow: false, retry_budget: 0 },
    parallelism: options.parallelism || { dependencies: [], max_concurrency: 1 },
  });
};

const selectCanonical = (options) => {
  const request = canonicalRequest(options);
  const resolution = resolveTarget(request, {
    catalog: options.catalog || DEFAULT_CATALOG,
    ...(options.preference_order === undefined ? {} : { preferenceOrder: options.preference_order }),
  });
  const selected = resolution.status === 'RESOLVED';
  return {
    status: selected ? 'selected' : 'blocked',
    request: resolution.request,
    requested_target: resolution.requested_target,
    selected_target: resolution.target,
    capability: resolution.capability,
    capability_status: resolution.capability.status,
    resolution_status: resolution.status,
    resolution_source: 'dispatch-engine',
    reason: resolution.reason || resolution.capability.evidence,
    fallback: 'none',
    rejected_candidates: resolution.rejected_candidates,
  };
};

const select = (options = {}, dependencies = {}) => {
  if (options.request !== undefined || options.host_profile !== undefined || options.hostProfile !== undefined) {
    return selectCanonical(options);
  }
  const requested = ['auto', ...BACKENDS].includes(options.backend) ? options.backend : 'claude';
  const fallback = ['none', 'claude'].includes(options.fallback) ? options.fallback : 'none';
  const configuredOrder = String(options.order).split(',').map((item) => item.trim()).filter(Boolean);
  const order = configuredOrder.length > 0 && configuredOrder.every((item) => BACKENDS.includes(item))
    ? configuredOrder
    : DEFAULT_ORDER;
  const plan = resolveDispatchPlan({
    role: 'worker',
    requestedBackend: requested,
    configuredOrder: order,
    crossProvider: options.cross_provider === true,
  });
  const metadata = {
    candidate_scope: plan.candidate_scope,
    suppressed_candidates: plan.suppressed_candidates,
  };
  const checkAvailability = dependencies.availability || availability;
  if (options.failure) return blocked(requested, requested, `execution ${options.failure} failure; fallback is not permitted`, metadata);

  if (requested !== 'auto') {
    const result = checkAvailability(plan.candidates[0]);
    if (result.available) {
      return { status: 'selected', requested_backend: requested, selected_backend: requested, selected_agent: AGENTS[requested], reason: requested === 'claude' ? 'shipped default' : result.reason, fallback: 'none', ...metadata };
    }
    if (result.reason.startsWith('missing executable') && fallback === 'claude') {
      return { status: 'selected', requested_backend: requested, selected_backend: 'claude', selected_agent: AGENTS.claude, reason: `${result.reason}; configured fallback=claude`, fallback: 'claude', ...metadata };
    }
    return blocked(requested, requested, result.reason, metadata);
  }

  const rejected = [];
  for (const candidate of plan.candidates) {
    if (!BACKENDS.includes(candidate)) {
      rejected.push({ backend: candidate, reason: 'invalid backend in order' });
      continue;
    }
    const result = checkAvailability(candidate);
    if (result.available) {
      return { status: 'selected', requested_backend: 'auto', selected_backend: candidate, selected_agent: AGENTS[candidate], reason: result.reason, fallback: 'none', rejected_candidates: rejected, ...metadata };
    }
    rejected.push({ backend: candidate, reason: result.reason });
  }
  return { ...blocked('auto', 'auto', 'no backend available', metadata), rejected_candidates: rejected };
};

if (require.main === module) {
  const result = select(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'blocked' ? 1 : 0;
}

module.exports = { BACKENDS, DEFAULT_ORDER, parseArgs, select };
