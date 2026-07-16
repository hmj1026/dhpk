#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

const BACKENDS = ['claude', 'codex', 'agy'];
const DEFAULT_ORDER = ['claude', 'codex', 'agy'];
const AGENTS = {
  claude: 'dhpk:fast-worker',
  codex: 'dhpk:codex-fast-worker',
  agy: 'dhpk:agy-fast-worker',
};

const parseArgs = (argv) => {
  const out = { backend: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND || 'claude', order: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_BACKEND_ORDER || DEFAULT_ORDER.join(','), fallback: process.env.CLAUDE_PLUGIN_OPTION_FAST_WORKER_FALLBACK || 'none', failure: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--backend') out.backend = argv[++i] || '';
    else if (arg === '--order') out.order = argv[++i] || '';
    else if (arg === '--fallback') out.fallback = argv[++i] || '';
    else if (arg === '--failure') out.failure = argv[++i] || '';
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

const blocked = (requested, selected, reason) => ({
  status: 'blocked',
  requested_backend: requested,
  selected_backend: selected,
  selected_agent: AGENTS[selected] || `dhpk:${selected}-fast-worker`,
  reason,
  fallback: 'none',
});

const select = (options) => {
  const requested = ['auto', ...BACKENDS].includes(options.backend) ? options.backend : 'claude';
  const fallback = ['none', 'claude'].includes(options.fallback) ? options.fallback : 'none';
  const configuredOrder = String(options.order).split(',').map((item) => item.trim()).filter(Boolean);
  const order = configuredOrder.length > 0 && configuredOrder.every((item) => BACKENDS.includes(item))
    ? configuredOrder
    : DEFAULT_ORDER;
  if (options.failure) return blocked(requested, requested, `execution ${options.failure} failure; fallback is not permitted`);

  if (requested !== 'auto') {
    const result = availability(requested);
    if (result.available) {
      return { status: 'selected', requested_backend: requested, selected_backend: requested, selected_agent: AGENTS[requested], reason: requested === 'claude' ? 'shipped default' : result.reason, fallback: 'none' };
    }
    if (result.reason.startsWith('missing executable') && fallback === 'claude') {
      return { status: 'selected', requested_backend: requested, selected_backend: 'claude', selected_agent: AGENTS.claude, reason: `${result.reason}; configured fallback=claude`, fallback: 'claude' };
    }
    return blocked(requested, requested, result.reason);
  }

  const rejected = [];
  for (const candidate of order) {
    if (!BACKENDS.includes(candidate)) {
      rejected.push({ backend: candidate, reason: 'invalid backend in order' });
      continue;
    }
    const result = availability(candidate);
    if (result.available) {
      return { status: 'selected', requested_backend: 'auto', selected_backend: candidate, selected_agent: AGENTS[candidate], reason: result.reason, fallback: 'none', rejected_candidates: rejected };
    }
    rejected.push({ backend: candidate, reason: result.reason });
  }
  return { ...blocked('auto', 'auto', 'no backend available'), rejected_candidates: rejected };
};

if (require.main === module) {
  const result = select(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'blocked' ? 1 : 0;
}

module.exports = { BACKENDS, DEFAULT_ORDER, parseArgs, select };
