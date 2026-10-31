#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LEGACY_EFFORT_KEYS,
  LEGACY_KEYS,
  createDispatchConfigReport,
  resolveDispatchConfig,
} = require('./lib/dispatch-config');

const PLUGIN_ID = 'dhpk@dhpk';
const DIAGNOSTIC_FIELDS = new Set([
  'codex_deep_reasoner_model',
  'codex_deep_reasoner_effort',
  'architect_model',
  'architect_effort',
]);
const REPORT_OPTION_FIELDS = Object.freeze([...new Set([
  'orchestration_dispatch',
  'worker_target',
  'reasoner_target',
  'planner_target',
  'reviewer_target',
  'preference_order',
  'fallback_allow',
  ...Object.values(LEGACY_KEYS).flat(),
  ...Object.values(LEGACY_EFFORT_KEYS).flat(),
  'fast_worker_backend_order',
  'fast_worker_fallback',
  ...DIAGNOSTIC_FIELDS,
])]);
const ENVIRONMENT_KEYS = Object.freeze(REPORT_OPTION_FIELDS.map((field) => [
  field,
  `CLAUDE_PLUGIN_OPTION_${field.toUpperCase()}`,
]));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDefaultReportValue(field, value) {
  if (value === undefined || value === null || value === '') return true;
  if (field === 'orchestration_dispatch') return value === 'on' || value === true;
  if (field === 'fallback_allow' || field === 'fast_worker_fallback') return value === 'true' || value === true;
  if (typeof value === 'string') return value === 'auto';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function layerWarrantsReport(options) {
  if (!isRecord(options)) return false;
  return REPORT_OPTION_FIELDS.some((field) => {
    if (!Object.prototype.hasOwnProperty.call(options, field)) return false;
    if (DIAGNOSTIC_FIELDS.has(field)) return true;
    return !isDefaultReportValue(field, options[field]);
  });
}

function environmentOptions(environment = process.env) {
  const source = isRecord(environment) ? environment : {};
  const options = {};
  for (const [field, name] of ENVIRONMENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    const projectOverlay = `DHPK_PROJECT_OPTION_${field.toUpperCase()}`;
    if (Object.prototype.hasOwnProperty.call(source, projectOverlay)) continue;
    const value = source[name];
    if (value === undefined || value === '') continue;
    options[field] = value;
  }
  return options;
}

function shouldReport(environment = process.env, layers = {}) {
  const source = isRecord(environment) ? environment : {};
  if (source.DHPK_DISPATCH_CONFIG_REPORT === '1') return true;
  if (layerWarrantsReport(environmentOptions(source))) return true;
  if (layerWarrantsReport(layers.project) || layerWarrantsReport(layers.global)) return true;
  return Array.isArray(layers.unreadable) && layers.unreadable.length > 0;
}

function classifyPath(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { status: 'unreadable', reason: 'invalid-structure' };
    return { status: 'present' };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { status: 'absent' };
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) return { status: 'unreadable', reason: 'permission' };
    return { status: 'unreadable', reason: 'unreadable' };
  }
}

function readPluginOptions(filePath) {
  const located = classifyPath(filePath);
  if (located.status !== 'present') return located;
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && (error.code === 'EACCES' || error.code === 'EPERM')) return { status: 'unreadable', reason: 'permission' };
    return { status: 'unreadable', reason: 'unreadable' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'unreadable', reason: 'invalid-json' };
  }
  if (!isRecord(parsed)) return { status: 'unreadable', reason: 'invalid-structure' };
  if (!Object.prototype.hasOwnProperty.call(parsed, 'pluginConfigs')) return { status: 'read', options: {} };
  const pluginConfigs = parsed.pluginConfigs;
  if (!isRecord(pluginConfigs)) return { status: 'unreadable', reason: 'invalid-structure' };
  if (!Object.prototype.hasOwnProperty.call(pluginConfigs, PLUGIN_ID)) return { status: 'read', options: {} };
  const plugin = pluginConfigs[PLUGIN_ID];
  if (!isRecord(plugin)) return { status: 'unreadable', reason: 'invalid-structure' };
  if (!Object.prototype.hasOwnProperty.call(plugin, 'options')) return { status: 'read', options: {} };
  if (!isRecord(plugin.options)) return { status: 'unreadable', reason: 'invalid-structure' };
  return { status: 'read', options: plugin.options };
}

function readProjectLayer(projectRoot) {
  const localPath = path.join(projectRoot, '.claude', 'settings.local.json');
  const local = classifyPath(localPath);
  if (local.status === 'unreadable') return local;
  if (local.status === 'present') return readPluginOptions(localPath);
  const sharedPath = path.join(projectRoot, '.claude', 'settings.json');
  const shared = classifyPath(sharedPath);
  if (shared.status === 'absent') return shared;
  if (shared.status === 'unreadable') return shared;
  return readPluginOptions(sharedPath);
}

function resolveRoots(environment, options) {
  const source = isRecord(environment) ? environment : {};
  const settings = isRecord(options) ? options : {};
  return {
    projectRoot: settings.projectRoot || source.CLAUDE_PROJECT_DIR || process.cwd(),
    globalSettingsPath: settings.globalSettingsPath
      || source.DHPK_DISPATCH_GLOBAL_SETTINGS
      || path.join(os.homedir(), '.claude', 'settings.json'),
  };
}

function coveredScope(flags, unreadable) {
  if (unreadable.length > 0) return 'incomplete';
  const names = [];
  if (flags.project) names.push('project');
  if (flags.global) names.push('global');
  if (flags.environment) names.push('environment');
  if (names.length === 1 && names[0] === 'environment') return 'environment-only';
  return names.join('+');
}

const SUMMARY_PREFIX_LENGTH = '[session-start] dispatch config: '.length;
const SUMMARY_LIMIT = 300;
const SUMMARY_HINT = '; full: node scripts/dispatch-config-report.js';
const SUMMARY_ROLES = Object.freeze(['planner', 'reasoner', 'worker', 'reviewer']);
const LEGACY_REPORT_KEYS = Object.freeze([...new Set([
  ...Object.values(LEGACY_KEYS).flat(),
  ...Object.values(LEGACY_EFFORT_KEYS).flat(),
])]);

function roleSummary(role, target, withProvider) {
  if (!isRecord(target)) return null;
  const parts = [target.target_agent];
  if (withProvider) parts.push(target.provider);
  parts.push(target.model_id);
  const text = parts.filter(Boolean).join('/');
  const effort = target.effort && target.effort !== 'auto' ? `:${target.effort}` : '';
  if (!text && !effort) return null;
  return `${role}=${text}${effort}`;
}

function legacyEntries(layerOptions) {
  const entries = [];
  for (const [layer, layerValues] of layerOptions) {
    if (!isRecord(layerValues)) continue;
    for (const key of LEGACY_REPORT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(layerValues, key)) continue;
      if (isDefaultReportValue(key, layerValues[key])) continue;
      entries.push(`${layer}.${key}`);
    }
  }
  return entries;
}

function truncateLongest(items, excess) {
  const next = [...items];
  let remaining = excess;
  while (remaining > 0) {
    let index = 0;
    next.forEach((item, i) => { if (item.length > next[index].length) index = i; });
    if (next[index].length <= 10) break;
    next[index] = `${next[index].slice(0, -2)}…`;
    remaining -= 1;
  }
  return next;
}

function composeSummary({ roles, flags, scope, legacy, forced }, budget) {
  const assemble = (roleTexts, legacyText) => {
    const tokens = [...roleTexts, ...flags, ...scope, ...(legacyText ? [legacyText] : [])];
    if (tokens.length === 0 && forced) tokens.push('defaults');
    return `${tokens.join(' ')}${SUMMARY_HINT}`;
  };
  const fullLegacy = legacy.length > 0 ? `legacy=${legacy.join(',')}` : '';
  const countLegacy = legacy.length > 0 ? `legacy=${legacy.length}` : '';
  const withProvider = roles.map((role) => role.withProvider);
  const without = roles.map((role) => role.plain);
  const attempts = [[withProvider, fullLegacy], [withProvider, countLegacy], [without, countLegacy]];
  for (const [roleTexts, legacyText] of attempts) {
    const line = assemble(roleTexts, legacyText);
    if (line.length <= budget) return line;
  }
  const overflow = assemble(without, countLegacy).length - budget;
  return assemble(truncateLongest(without, overflow), countLegacy);
}

function formatSummary(report, config, layerOptions, forced) {
  const roles = [];
  for (const role of SUMMARY_ROLES) {
    const plain = roleSummary(role, report.targets[role], false);
    if (plain) roles.push({ plain, withProvider: roleSummary(role, report.targets[role], true) });
  }
  const flags = [];
  if (config.orchestration_dispatch !== 'on') flags.push('dispatch=off');
  if (config.fallback_allow !== true) flags.push('fallback=deny');
  const unreadable = (report.covered_inputs && report.covered_inputs.unreadable) || [];
  const scope = unreadable.length > 0
    ? [`scope=incomplete(${unreadable.map((entry) => `${entry.layer}:${entry.reason}`).join(',')})`]
    : [];
  return composeSummary({
    roles, flags, scope, legacy: legacyEntries(layerOptions), forced,
  }, SUMMARY_LIMIT - SUMMARY_PREFIX_LENGTH);
}

function main(environment = process.env, options = {}) {
  const source = isRecord(environment) ? environment : {};
  const roots = resolveRoots(source, options);
  const project = readProjectLayer(roots.projectRoot);
  const globalLayer = readPluginOptions(roots.globalSettingsPath);
  const projectOptions = project.status === 'read' ? project.options : {};
  const globalOptions = globalLayer.status === 'read' ? globalLayer.options : {};
  const unreadable = [];
  if (project.status === 'unreadable') unreadable.push({ layer: 'project', reason: project.reason });
  if (globalLayer.status === 'unreadable') unreadable.push({ layer: 'global', reason: globalLayer.reason });
  if (!shouldReport(source, { project: projectOptions, global: globalOptions, unreadable })) return 0;

  const config = resolveDispatchConfig({
    project: projectOptions,
    global: globalOptions,
    environment: environmentOptions(source),
  });
  const layers = [];
  if (project.status === 'read') layers.push('project');
  if (globalLayer.status === 'read') layers.push('global');
  layers.push('environment');
  const flags = {
    project: project.status === 'read',
    global: globalLayer.status === 'read',
    environment: true,
  };
  const report = createDispatchConfigReport({
    config,
    coveredInputs: {
      layers,
      ...flags,
      complete: flags.project && flags.global && flags.environment && unreadable.length === 0,
      scope: coveredScope(flags, unreadable),
      ...(unreadable.length > 0 ? { unreadable } : {}),
    },
  });
  const summary = isRecord(options) && options.format === 'summary'
    && (report.diagnostics || []).length === 0;
  if (summary) {
    const layerOptions = [
      ['project', projectOptions],
      ['global', globalOptions],
      ['environment', environmentOptions(source)],
    ];
    const forced = source.DHPK_DISPATCH_CONFIG_REPORT === '1';
    process.stdout.write(`${formatSummary(report, config, layerOptions, forced)}\n`);
    return 0;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return 0;
}

module.exports = Object.freeze({ ENVIRONMENT_KEYS, environmentOptions, main, shouldReport });

if (require.main === module) {
  process.exitCode = main(process.env, process.argv.includes('--summary') ? { format: 'summary' } : {});
}
