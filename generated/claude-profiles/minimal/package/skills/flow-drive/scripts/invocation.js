'use strict';

const path = require('node:path');

const HOST_PROFILES = require(path.join(__dirname, '..', 'references', 'execution-bundle', 'manifests', 'host-profiles.json'));

const SCHEMA = 'dhpk.flow-drive-invocation.v1';
const WORKERS = Object.freeze(['claude', 'codex', 'agy', 'auto']);
const TARGET_PROVIDERS = Object.freeze(['claude', 'codex', 'agy']);
const REASONER_BACKENDS = Object.freeze(['claude', 'codex']);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'max', 'xhigh', 'ultra']);
const EFFORT_CHOICES = EFFORTS.join('|');
// Claude Code subagents cannot receive the dispatcher-attested 0600
// DHPK_CLI_TRANSPORT_CONTEXT that the CLI-backed roles require, and the Agent
// tool cannot override a subagent's frontmatter effort.
const CONTEXTLESS_HOST = 'claude-code';
const CLI_BACKED_PROVIDERS = Object.freeze(['codex', 'agy']);

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function diagnostic(diagnostics, message) {
  diagnostics.push(message);
}

function invalidEffort(effort) {
  return effort !== null && !EFFORTS.includes(effort);
}

function effortDiagnostic(option, effort) {
  return `invalid ${option} effort '${effort}'; choose ${EFFORT_CHOICES}.`;
}

function hostRoleEffort(host, role) {
  const profiles = Array.isArray(HOST_PROFILES.profiles) ? HOST_PROFILES.profiles : [];
  const profile = profiles.find((candidate) => candidate && candidate.host === host);
  const defaults = profile && profile.role_defaults && profile.role_defaults[role];
  return defaults ? defaults.effort : null;
}

function hostFromEnvironment(env) {
  return env.CLAUDECODE === '1' ? CONTEXTLESS_HOST : null;
}

function parsePlan(value, diagnostics) {
  if (value === undefined) return { enabled: true, model: null, effort: null };
  if (!value) {
    diagnostic(diagnostics, '--plan requires a non-empty model[:effort] value when using equals syntax.');
    return { enabled: true, model: null, effort: null };
  }
  const parts = value.split(':');
  if (parts.length > 2 || parts.some((part) => !TOKEN.test(part))) {
    diagnostic(diagnostics, `invalid --plan value '${value}'; expected model[:effort].`);
    return { enabled: true, model: null, effort: null };
  }
  const [model, effort = null] = parts;
  if (invalidEffort(effort)) diagnostic(diagnostics, effortDiagnostic('--plan', effort));
  return { enabled: true, model, effort };
}

function parseReasoner(value, diagnostics) {
  if (!value) {
    diagnostic(diagnostics, '--reasoner requires backend[:model[:effort]].');
    return null;
  }
  const parts = value.includes('/')
    ? value.replace('/', ':').split(':')
    : value.split(':');
  if (parts.length > 3 || parts.some((part) => !TOKEN.test(part))) {
    diagnostic(diagnostics, `invalid --reasoner value '${value}'; expected backend[:model[:effort]].`);
    return null;
  }
  const [backend, model = null, effort = null] = parts;
  if (!REASONER_BACKENDS.includes(backend)) {
    diagnostic(diagnostics, `unsupported reasoner backend '${backend}'; choose claude or codex.`);
  }
  if (invalidEffort(effort)) diagnostic(diagnostics, effortDiagnostic('--reasoner', effort));
  return { backend, model, effort };
}

function parseWorkerTarget(value, diagnostics) {
  if (!value) {
    diagnostic(diagnostics, '--worker-target requires provider/model[:effort].');
    return null;
  }
  const parts = value.split(':');
  if (parts.length > 2 || !parts[0].includes('/')) {
    diagnostic(diagnostics, `invalid --worker-target value '${value}'; expected provider/model[:effort].`);
    return null;
  }
  const [providerAndModel, effort = null] = parts;
  const [provider, model, ...extra] = providerAndModel.split('/');
  if (!provider || !model || extra.length > 0 || !TOKEN.test(provider) || !TOKEN.test(model)) {
    diagnostic(diagnostics, `invalid --worker-target value '${value}'; expected provider/model[:effort].`);
    return null;
  }
  if (!TARGET_PROVIDERS.includes(provider)) {
    diagnostic(diagnostics, `unsupported worker-target provider '${provider}'; choose ${TARGET_PROVIDERS.join(', ')}.`);
  }
  if (invalidEffort(effort)) diagnostic(diagnostics, effortDiagnostic('--worker-target', effort));
  return { provider, model, effort };
}

function parseWorker(value, diagnostics) {
  if (!WORKERS.includes(value)) {
    diagnostic(diagnostics, `unsupported worker '${value}'; choose ${WORKERS.join(', ')}.`);
    return null;
  }
  return value;
}

function checkHostSupport(host, options, diagnostics, notices) {
  if (host !== CONTEXTLESS_HOST) return;
  const unsupported = (selection, alternative) => diagnostic(
    diagnostics,
    `${selection} is unavailable on the ${host} host: its subagents cannot receive the dispatcher-attested DHPK_CLI_TRANSPORT_CONTEXT; use ${alternative} instead.`,
  );
  if (CLI_BACKED_PROVIDERS.includes(options.worker)) unsupported(`--worker=${options.worker}`, '--worker=claude');
  if (options.workerTarget && CLI_BACKED_PROVIDERS.includes(options.workerTarget.provider)) {
    unsupported(`--worker-target=${options.workerTarget.provider}/...`, '--worker=claude');
  }
  if (options.reasoner && CLI_BACKED_PROVIDERS.includes(options.reasoner.backend)) {
    unsupported(`--reasoner=${options.reasoner.backend}`, '--reasoner=claude');
  }
  const appliedEffort = hostRoleEffort(host, 'planner');
  if (options.plan.effort !== null && appliedEffort !== null && options.plan.effort !== appliedEffort) {
    notices.push(`--plan effort '${options.plan.effort}' is not applied on the ${host} host; the planner runs at its configured effort '${appliedEffort}'.`);
  }
}

function parseInvocation(argv = [], { host = null } = {}) {
  const tokens = Array.isArray(argv) ? argv.map(String) : String(argv).trim().split(/\s+/).filter(Boolean);
  const diagnostics = [];
  const notices = [];
  const seen = new Set();
  let changeId = null;
  let architect = null;
  const options = {
    plan: { enabled: false, model: null, effort: null },
    worker: 'auto',
    workerTarget: null,
    crossProvider: false,
    reasoner: null,
    architect: null,
  };

  const markOnce = (name) => {
    if (seen.has(name)) {
      diagnostic(diagnostics, `${name} may only be specified once.`);
      return false;
    }
    seen.add(name);
    return true;
  };

  for (const token of tokens) {
    if (!token.startsWith('--')) {
      if (changeId === null) changeId = token;
      else diagnostic(diagnostics, `only one confirmed specification or change id is allowed; unexpected '${token}'.`);
      continue;
    }
    if (token === '--plan' || token.startsWith('--plan=')) {
      if (markOnce('--plan')) options.plan = parsePlan(token.includes('=') ? token.slice('--plan='.length) : undefined, diagnostics);
      continue;
    }
    if (token.startsWith('--worker=')) {
      if (markOnce('--worker')) options.worker = parseWorker(token.slice('--worker='.length), diagnostics) || 'auto';
      continue;
    }
    if (token.startsWith('--worker-target=')) {
      if (markOnce('--worker-target')) options.workerTarget = parseWorkerTarget(token.slice('--worker-target='.length), diagnostics);
      continue;
    }
    if (token === '--cross-provider') {
      if (markOnce('--cross-provider')) options.crossProvider = true;
      continue;
    }
    if (token.startsWith('--reasoner=')) {
      if (markOnce('--reasoner')) options.reasoner = parseReasoner(token.slice('--reasoner='.length), diagnostics);
      continue;
    }
    if (token === '--architect' || token === '--no-architect') {
      if (markOnce(token)) architect = token === '--architect';
      continue;
    }
    if (token === '--codex') {
      diagnostic(diagnostics, '--codex is retired; choose an explicit worker, reasoner, or owner second-opinion option.');
      continue;
    }
    diagnostic(diagnostics, `unsupported flow-drive option '${token}'.`);
  }

  if (!changeId) diagnostic(diagnostics, 'a confirmed specification or change id is required.');
  if (architect !== null && seen.has('--architect') && seen.has('--no-architect')) {
    diagnostic(diagnostics, '--architect and --no-architect are mutually exclusive.');
    architect = null;
  }
  options.architect = architect;
  checkHostSupport(host, options, diagnostics, notices);
  return freezeDeep({
    schema: SCHEMA,
    status: diagnostics.length === 0 ? 'ready' : 'blocked',
    changeId,
    options,
    diagnostics,
    notices,
  });
}

module.exports = Object.freeze({ parseInvocation });

if (require.main === module) {
  const context = parseInvocation(process.argv.slice(2), { host: hostFromEnvironment(process.env) });
  process.stdout.write(`${JSON.stringify(context)}\n`);
  process.exitCode = context.status === 'blocked' ? 2 : 0;
}
