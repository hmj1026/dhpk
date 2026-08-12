'use strict';

// Deterministic boundary between command parsing and policy. The parser is
// pure and returns frozen data: downstream routing receives one normalized
// invocation context instead of re-parsing flags and duplicating precedence.

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function parsePlan(value) {
  const raw = value === true ? '' : String(value || '');
  const [model = '', effort = ''] = raw.split(':');
  return { enabled: true, model: model || null, effort: effort || null };
}

function parseReasoner(value) {
  const [backend = '', model = '', effort = ''] = String(value || '').split(':');
  return { enabled: true, backend: backend || null, model: model || null, effort: effort || null };
}

function parseInvocationContext(argv = []) {
  const tokens = Array.isArray(argv) ? argv.map(String) : String(argv).trim().split(/\s+/).filter(Boolean);
  let routeOnly = false;
  let codex = false;
  let plan = null;
  let worker = null;
  let reasoner = null;
  let architect = false;
  let openSpec = false;
  const query = [];
  for (const token of tokens) {
    if (token === '--route-only') routeOnly = true;
    else if (token === '--codex') codex = true;
    else if (token === '--architect') architect = true;
    else if (token === '--no-architect') architect = false;
    else if (token === '--openspec' || token === '--opsx') openSpec = true;
    else if (token === '--plan') plan = parsePlan(true);
    else if (token.startsWith('--plan=')) plan = parsePlan(token.slice(7));
    else if (token.startsWith('--worker=')) worker = token.slice(9) || null;
    else if (token.startsWith('--reasoner=')) reasoner = parseReasoner(token.slice(11));
    else query.push(token);
  }
  return freeze({
    routeOnly,
    codex,
    plan,
    worker,
    reasoner,
    architect,
    openSpec,
    cleanedQuery: query.join(' ').trim(),
  });
}

function createRouteResult({ status, skill = null, label = null, context, reason = undefined } = {}) {
  const result = { status, skill, label, context };
  if (reason !== undefined) result.reason = reason;
  return freeze(result);
}

module.exports = { parseInvocationContext, createRouteResult };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(parseInvocationContext(process.argv.slice(2)))}\n`);
}
