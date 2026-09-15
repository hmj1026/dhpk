'use strict';

const SCHEMA = 'dhpk.flow-drive-invocation.v1';
const WORKERS = Object.freeze(['claude', 'codex', 'agy', 'auto']);
const REASONER_BACKENDS = Object.freeze(['claude', 'codex']);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EFFORT = /^(?:low|medium|high|max|xhigh|ultra)$/;

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function diagnostic(diagnostics, message) {
  diagnostics.push(message);
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
  if (effort !== null && !EFFORT.test(effort)) {
    diagnostic(diagnostics, `invalid --plan effort '${effort}'.`);
  }
  return { enabled: true, model, effort };
}

function parseReasoner(value, diagnostics) {
  if (!value) {
    diagnostic(diagnostics, '--reasoner requires backend[:model[:effort]].');
    return null;
  }
  const parts = value.split(':');
  if (parts.length > 3 || parts.some((part) => !TOKEN.test(part))) {
    diagnostic(diagnostics, `invalid --reasoner value '${value}'; expected backend[:model[:effort]].`);
    return null;
  }
  const [backend, model = null, effort = null] = parts;
  if (!REASONER_BACKENDS.includes(backend)) {
    diagnostic(diagnostics, `unsupported reasoner backend '${backend}'; choose claude or codex.`);
  }
  if (effort !== null && !EFFORT.test(effort)) {
    diagnostic(diagnostics, `invalid --reasoner effort '${effort}'.`);
  }
  return { backend, model, effort };
}

function parseWorker(value, diagnostics) {
  if (!WORKERS.includes(value)) {
    diagnostic(diagnostics, `unsupported worker '${value}'; choose ${WORKERS.join(', ')}.`);
    return null;
  }
  return value;
}

function parseInvocation(argv = []) {
  const tokens = Array.isArray(argv) ? argv.map(String) : String(argv).trim().split(/\s+/).filter(Boolean);
  const diagnostics = [];
  const seen = new Set();
  let changeId = null;
  let architect = null;
  const options = {
    plan: { enabled: false, model: null, effort: null },
    worker: 'auto',
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
  return freezeDeep({
    schema: SCHEMA,
    status: diagnostics.length === 0 ? 'ready' : 'blocked',
    changeId,
    options,
    diagnostics,
  });
}

module.exports = Object.freeze({ parseInvocation });

if (require.main === module) {
  const context = parseInvocation(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(context)}\n`);
  process.exitCode = context.status === 'blocked' ? 2 : 0;
}
