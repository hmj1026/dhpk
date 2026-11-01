#!/usr/bin/env node
'use strict';

// Fast-worker selector CLI. It detects the current Host, loads that Host's
// profile, supplies executable presence as capability evidence, and lets the
// Dispatch Engine choose every Target Agent, Model, Effort, and Route.
// The subagent-name mapping below is presentation only.

const fs = require('node:fs');
const path = require('node:path');
const {
  AGENT_PROVIDER, SCHEMAS, createDispatchRequest, retirementGuidance,
} = require('./lib/dispatch-contract');
const { resolveTarget } = require('./lib/dispatch-engine');
const { parseTarget } = require('./lib/dispatch-config');

const DEFAULT_CATALOG = require('../manifests/provider-model-catalog.json');
const HOST_PROFILES = require('../manifests/host-profiles.json');

// Host signals, one entry per Host. A Host matches when its predicate holds.
// Evidence for each signal is recorded in the design appendix
// "Host detection findings" (openspec change deepen-role-default-resolution).
const HOST_SIGNALS = Object.freeze([
  Object.freeze({ host: 'claude-code', signal: 'CLAUDECODE', matches: (env) => env.CLAUDECODE === '1' }),
  Object.freeze({ host: 'codex-cli', signal: 'CODEX_THREAD_ID', matches: (env) => Boolean(env.CODEX_THREAD_ID) }),
  Object.freeze({
    host: 'cursor',
    signal: 'CURSOR_AGENT|CURSOR_TRACE_ID',
    matches: (env) => Boolean(env.CURSOR_AGENT || env.CURSOR_TRACE_ID),
  }),
  Object.freeze({ host: 'agy', signal: 'ANTIGRAVITY_CONVERSATION_ID', matches: (env) => Boolean(env.ANTIGRAVITY_CONVERSATION_ID) }),
]);

const OVERRIDE = 'DHPK_HOST';
const SIGNALS_CHECKED = [OVERRIDE, ...HOST_SIGNALS.map((entry) => entry.signal)].join(', ');

const REMOVED_ARGUMENTS = Object.freeze(['--backend', '--order', '--fallback', '--failure', '--cross-provider']);

// Presentation only: the Claude Code subagent that fronts a resolved target.
const SUBAGENT_FOR_TARGET_AGENT = Object.freeze({
  'claude-code': 'dhpk:fast-worker',
  'codex-cli': 'dhpk:codex-worker',
  agy: 'dhpk:agy-worker',
});

// Executable whose presence is capability evidence for a Target Agent.
const EXECUTABLE_FOR_TARGET_AGENT = Object.freeze({ 'codex-cli': 'codex', agy: 'agy' });

const detectHost = (env = process.env) => {
  const override = env[OVERRIDE];
  if (override) {
    const known = HOST_SIGNALS.some((entry) => entry.host === override);
    if (known) return { status: 'DETECTED', host: override, signal: OVERRIDE };
    return { status: 'BLOCKED', reason: `host not detected: ${OVERRIDE}=${override} is not one of ${HOST_SIGNALS.map((entry) => entry.host).join(', ')}` };
  }
  const matched = HOST_SIGNALS.filter((entry) => entry.matches(env));
  if (matched.length === 1) return { status: 'DETECTED', host: matched[0].host, signal: matched[0].signal };
  if (matched.length === 0) return { status: 'BLOCKED', reason: `host not detected: no signal matched (checked ${SIGNALS_CHECKED})` };
  return {
    status: 'BLOCKED',
    reason: `host not detected: ambiguous signals for ${matched.map((entry) => entry.host).join(', ')}; set ${OVERRIDE} to choose`,
  };
};

const executableOnPath = (name, env) => String(env.PATH || '').split(path.delimiter).filter(Boolean).some((dir) => {
  try {
    fs.accessSync(path.join(dir, name), fs.constants.X_OK);
    return fs.statSync(path.join(dir, name)).isFile();
  } catch (error) {
    return false;
  }
});

// PATH probe as capability evidence: only an explicit CLI-backed target needs it,
// and only when that Target Agent is not the Host's own native runtime.
const withExecutableEvidence = (hostProfile, target, env) => {
  const executable = target && EXECUTABLE_FOR_TARGET_AGENT[target.target_agent];
  if (!executable || hostProfile.native_target_agent === target.target_agent) return hostProfile;
  const provider = target.provider || AGENT_PROVIDER[target.target_agent];
  const access = executableOnPath(executable, env)
    ? { status: 'AVAILABLE', evidence: `${executable} executable on PATH` }
    : { status: 'UNAVAILABLE', evidence: `missing executable: ${executable}` };
  return { ...hostProfile, access: { ...hostProfile.access, [provider]: access } };
};

const buildRequest = (options) => {
  const workdir = options.workdir || process.cwd();
  return createDispatchRequest({
    schema: SCHEMAS.REQUEST,
    host_profile: options.host_profile || options.hostProfile,
    task_id: options.task_id || 'fast-worker-task',
    attempt_id: options.attempt_id || 'fast-worker-attempt',
    role: 'worker',
    authority: 'workspace-write',
    task: options.task || { description_digest: options.description_digest || '0'.repeat(64) },
    scope: options.scope || {
      workdir,
      assigned_files: options.assigned_files || [],
      prompt_evidence: options.prompt_evidence || {
        path: `${workdir}/.dhpk/prompt.txt`, dev: 0, ino: 0, sha256: '0'.repeat(64),
      },
    },
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.effort === undefined ? {} : { effort: options.effort }),
    fallback: options.fallback || { allow: false, retry_budget: 0 },
    parallelism: options.parallelism || { dependencies: [], max_concurrency: 1 },
  });
};

const select = (options) => {
  const retired = retirementGuidance(options.backend);
  if (retired) return { ...blocked(retired), requested_backend: options.backend };
  if (!(options.host_profile || options.hostProfile)) throw new TypeError('worker selection requires host_profile');
  const resolution = resolveTarget(buildRequest(options), {
    catalog: options.catalog || DEFAULT_CATALOG,
    ...(options.preference_order === undefined ? {} : { preferenceOrder: options.preference_order }),
  });
  const target = resolution.status === 'RESOLVED' ? resolution.target : null;
  return {
    status: resolution.status,
    host: (options.host_profile || options.hostProfile).host,
    request: resolution.request,
    requested_target: resolution.requested_target,
    selected_target: target,
    selected_agent: target ? SUBAGENT_FOR_TARGET_AGENT[target.target_agent] || null : null,
    capability: resolution.capability,
    capability_status: resolution.capability.status,
    resolution_status: resolution.status,
    resolution_source: 'dispatch-engine',
    reason: resolution.reason || resolution.capability.evidence,
    rejected_candidates: resolution.rejected_candidates,
  };
};

const blocked = (reason) => ({ status: 'BLOCKED', selected_target: null, selected_agent: null, resolution_source: 'dispatch-engine', reason });

const parseCliArgs = (argv) => {
  let target;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (REMOVED_ARGUMENTS.includes(arg)) {
      const retired = retirementGuidance(argv[i + 1]);
      if (retired) return { error: retired };
      return { error: `argument ${arg} was removed; use --target <agent>/<model>[:<effort>] for an explicit target, or omit it for the Host Role Default` };
    }
    if (arg === '--target') {
      target = argv[i + 1];
      i += 1;
      if (!target) return { error: '--target requires <agent>/<model>[:<effort>]' };
    } else {
      return { error: `unknown argument ${arg}; supported: --target <agent>/<model>[:<effort>]` };
    }
  }
  return { target };
};

const run = (argv, env = process.env) => {
  const parsed = parseCliArgs(argv);
  if (parsed.error) return blocked(parsed.error);
  const detected = detectHost(env);
  if (detected.status !== 'DETECTED') return blocked(detected.reason);
  const profile = HOST_PROFILES.profiles.find((entry) => entry.host === detected.host);
  if (!profile) return blocked(`host not detected: no profile for ${detected.host}`);
  let target;
  try {
    target = parsed.target === undefined ? undefined : parseTarget(parsed.target, '--target');
  } catch (error) {
    return blocked(error.message);
  }
  const { effort, ...requestedTarget } = target || {};
  return select({
    host_profile: withExecutableEvidence(profile, target, env),
    ...(target ? { target: requestedTarget } : {}),
    ...(effort ? { effort } : {}),
  });
};

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'RESOLVED' ? 0 : 1;
}

module.exports = { detectHost, run, select };
