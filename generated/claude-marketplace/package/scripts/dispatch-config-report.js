#!/usr/bin/env node
'use strict';

const {
  createDispatchConfigReport,
  resolveDispatchConfig,
} = require('./lib/dispatch-config');

const ENVIRONMENT_KEYS = Object.freeze({
  orchestration_dispatch: 'CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH',
  worker_target: 'CLAUDE_PLUGIN_OPTION_WORKER_TARGET',
  reasoner_target: 'CLAUDE_PLUGIN_OPTION_REASONER_TARGET',
  planner_target: 'CLAUDE_PLUGIN_OPTION_PLANNER_TARGET',
  reviewer_target: 'CLAUDE_PLUGIN_OPTION_REVIEWER_TARGET',
  preference_order: 'CLAUDE_PLUGIN_OPTION_PREFERENCE_ORDER',
  fallback_allow: 'CLAUDE_PLUGIN_OPTION_FALLBACK_ALLOW',
});

function environmentOptions(environment = process.env) {
  return Object.fromEntries(Object.entries(ENVIRONMENT_KEYS)
    .filter(([, key]) => Object.prototype.hasOwnProperty.call(environment, key))
    .map(([field, key]) => [field, environment[key]]));
}

function shouldReport(environment = process.env) {
  if (environment.DHPK_DISPATCH_CONFIG_REPORT === '1') return true;
  return Object.entries(ENVIRONMENT_KEYS).some(([field, key]) => {
    if (!Object.prototype.hasOwnProperty.call(environment, key)) return false;
    const value = environment[key];
    return field === 'orchestration_dispatch' ? value !== 'on' : field === 'fallback_allow' ? value !== 'true' : value !== 'auto' && value !== '';
  });
}

function main(environment = process.env) {
  if (!shouldReport(environment)) return 0;
  const config = resolveDispatchConfig({ environment: environmentOptions(environment) });
  const report = createDispatchConfigReport({ config });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ ENVIRONMENT_KEYS, environmentOptions, main, shouldReport });
