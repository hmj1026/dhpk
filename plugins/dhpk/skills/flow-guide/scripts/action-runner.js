#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRouteResult, validateRouteResult } = require('./route-result');

const ACTIONS = Object.freeze(['help', 'route', 'rules', 'next', 'close']);
const ACTION_SCHEMA = 'dhpk.flow-guide-action.v1';

function parseAction(argv = []) {
  const tokens = Array.isArray(argv) ? argv.map(String) : String(argv).trim().split(/\s+/).filter(Boolean);
  const diagnostics = [];
  const first = tokens.shift() || null;
  const action = first && first.startsWith('$flow-guide') ? first.slice('$flow-guide'.length) || tokens.shift() : first;
  if (!action || !ACTIONS.includes(action)) diagnostics.push(`exactly one action is required: ${ACTIONS.join(', ')}.`);
  const extraActions = tokens.filter((token) => ACTIONS.includes(token));
  if (extraActions.length > 0) diagnostics.push(`exactly one action is allowed; unexpected action token(s): ${extraActions.join(', ')}.`);
  const goIndex = tokens.indexOf('--go');
  if (goIndex >= 0 && action !== 'route') diagnostics.push('--go is only valid for the route action.');
  if (tokens.filter((token) => token === '--go').length > 1) diagnostics.push('--go may only be specified once.');
  return Object.freeze({
    schema: ACTION_SCHEMA,
    status: diagnostics.length === 0 ? 'ready' : 'blocked',
    action: action || null,
    args: Object.freeze(tokens),
    diagnostics: Object.freeze(diagnostics),
  });
}

function manualReport(action, args) {
  const references = action === 'rules'
    ? ['skills/flow-guide/references/execution-policy.md', 'skills/flow-guide/references/invocation-precedence.md']
    : ['skills/flow-guide/references/handoff-and-verification.md', 'skills/flow-guide/references/review-gate-mechanics.md'];
  return Object.freeze({
    schema: ACTION_SCHEMA,
    action,
    status: 'manual-evidence-required',
    query: args.filter((token) => token !== '--go').join(' ').trim(),
    references,
    diagnostics: [],
    nextAction: action === 'rules'
      ? 'Read the listed policy references, then report the applicable gate and one handoff.'
      : 'Collect changed-file, test, review, and unresolved-risk evidence before handoff; do not claim completion from this report.',
  });
}

function runAction(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const parsed = parseAction(argv);
  if (parsed.status === 'blocked') {
    stderr.write(`ERROR [action-runner] blocked: ${parsed.diagnostics.join(' ')}\n`);
    return 2;
  }
  if (parsed.action === 'help') {
    const usage = require('./usage-card');
    return usage.run(parsed.args, { stdout, stderr });
  }
  if (parsed.action === 'route') {
    const result = createRouteResult({ argv: parsed.args });
    try { validateRouteResult(result); } catch (error) {
      stderr.write(`ERROR [action-runner] invalid-route-result: ${error.message}\n`);
      return 2;
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.disposition === 'blocked' ? 2 : 0;
  }
  if (parsed.action === 'next') {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'analyze.js')], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    });
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
    return result.status === null ? 1 : result.status;
  }
  stdout.write(`${JSON.stringify(manualReport(parsed.action, parsed.args))}\n`);
  return 0;
}

if (require.main === module) process.exitCode = runAction();

module.exports = Object.freeze({ ACTIONS, parseAction, runAction });
