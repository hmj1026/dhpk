'use strict';

const SCHEMA = 'dhpk.flow-drive-invocation.v1';
const PLAN_MODES = Object.freeze(['auto', 'bounded', 'discovery']);
const PROVIDERS = Object.freeze(['claude', 'codex', 'agy']);
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'max', 'xhigh', 'ultra']);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USAGE = '$flow-drive "task" [--worker=auto|provider[/model[:effort]]] [--reasoner=provider[/model[:effort]]] [--cross] [--plan[=auto|bounded|discovery]] [--architect|--no-architect]';

function freezeDeep(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function parseSelection(value, option, diagnostics) {
  const match = /^([^/:]+)(?:\/([^/:]+)(?::([^/:]+))?)?$/.exec(value);
  if (!match || !match.slice(1).filter(Boolean).every((part) => TOKEN.test(part))) {
    diagnostics.push(`invalid ${option} value '${value}'; expected provider[/model[:effort]].`);
    return null;
  }
  const [, provider, model = null, effort = null] = match;
  if (!PROVIDERS.includes(provider)) {
    diagnostics.push(`unsupported ${option} provider '${provider}'; choose ${PROVIDERS.join('|')}.`);
    return null;
  }
  if (effort !== null && !EFFORTS.includes(effort)) {
    diagnostics.push(`invalid ${option} effort '${effort}'; choose ${EFFORTS.join('|')}.`);
    return null;
  }
  return { provider, model, effort };
}

function parseInvocation(argv = [], { host = null } = {}) {
  const tokens = Array.isArray(argv) ? argv.map(String) : String(argv).trim().split(/\s+/).filter(Boolean);
  const diagnostics = [];
  const seen = new Set();
  let taskInput = null;
  let worker = 'auto';
  let workerTarget = null;
  let reasoner = null;
  let crossProvider = false;
  let plan = { enabled: false, model: null, effort: null, mode: null };
  let architect = null;
  const once = (name) => {
    if (seen.has(name)) { diagnostics.push(`${name} may only be specified once.`); return false; }
    seen.add(name); return true;
  };
  for (const token of tokens) {
    if (!token.startsWith('--')) {
      if (taskInput === null) taskInput = token;
      else diagnostics.push(`only one task input is allowed; unexpected '${token}'.`);
    } else if (token.startsWith('--worker=')) {
      if (!once('--worker')) continue;
      const value = token.slice('--worker='.length);
      if (value !== 'auto') {
        const selection = parseSelection(value, '--worker', diagnostics);
        if (selection) { worker = selection.provider; if (selection.model) workerTarget = selection; }
      }
    } else if (token.startsWith('--reasoner=')) {
      if (!once('--reasoner')) continue;
      const selection = parseSelection(token.slice('--reasoner='.length), '--reasoner', diagnostics);
      if (selection) reasoner = { backend: selection.provider, model: selection.model, effort: selection.effort };
    } else if (token === '--cross') {
      if (once('--cross')) crossProvider = true;
    } else if (token === '--plan' || token.startsWith('--plan=')) {
      if (!once('--plan')) continue;
      const mode = token === '--plan' ? 'auto' : token.slice('--plan='.length);
      if (!PLAN_MODES.includes(mode)) diagnostics.push(`invalid --plan scope '${mode}'; choose ${PLAN_MODES.join('|')}.`);
      else plan = { enabled: true, model: null, effort: null, mode };
    } else if (token === '--architect' || token === '--no-architect') {
      if (once(token)) architect = token === '--architect';
    } else if (token === '--codex') {
      diagnostics.push('--codex is retired; select a worker or reasoner with the current usage.');
    } else diagnostics.push(`unsupported flow-drive option '${token}'.`);
  }
  if (typeof taskInput !== 'string' || !taskInput.trim() || taskInput.includes('\0')) {
    diagnostics.push('one non-empty task text, task file, or confirmed specification/change id is required.');
  }
  if (seen.has('--architect') && seen.has('--no-architect')) diagnostics.push('--architect and --no-architect are mutually exclusive.');
  if (host === 'claude-code' && (worker === 'agy' || reasoner && reasoner.backend === 'agy')) {
    diagnostics.push('AGY dispatch is unavailable on the Claude Code host; the parent-session CLI integration is unsupported.');
  }
  if (diagnostics.length) diagnostics.push(`Usage: ${USAGE}`);
  return freezeDeep({ schema: SCHEMA, status: diagnostics.length ? 'blocked' : 'ready',
    changeId: taskInput, taskInput, options: { plan, worker, workerTarget, crossProvider, reasoner, architect },
    diagnostics, notices: [] });
}

module.exports = Object.freeze({ parseInvocation });

if (require.main === module) {
  const context = parseInvocation(process.argv.slice(2), { host: process.env.CLAUDECODE === '1' ? 'claude-code' : null });
  process.stdout.write(`${JSON.stringify(context)}\n`);
  process.exitCode = context.status === 'blocked' ? 2 : 0;
}
