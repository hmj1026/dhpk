#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const roles = {
  code: 'code-reviewer',
  db: 'database-reviewer',
  sec: 'security-reviewer',
  fe: 'frontend-reviewer',
  doc: 'doc-reviewer',
  mig: 'migration-reviewer',
  polyfill: 'polyfill-reviewer',
};
const moduleSlots = { ...roles, frontend: roles.fe, migration: roles.mig };
const reviewDocs = /^(?:docs|openspec|\.codex\/(?:agents|rules|skills|commands|manifests|hooks|scripts))\//;
const builtin = {
  code: (file) => /(?:\.(?:php|js)$|(?:^|\/)CLAUDE\.md$)/.test(file),
  db: (file) => /(?:\.sql$|(?:^|\/)(?:repositories|repository|models?|migrations?)(?:\/|\.)|(?:Repository|Model|Migration)\.[^/]+$)/i.test(file),
  sec: (file) => !/\.(?:md|txt|lock)$/i.test(file)
    && /(?:^|\/)(?:controllers?|configs?)(?:\/|\.)|(?:Controller|Auth|Login|Acl|Upload|File)[^/]*\.[^/]+$/i.test(file),
  doc: (file) => /(?:^|\/)(?:CLAUDE|AGENTS)\.md$|^README[^/]*\.md$/.test(file)
    || (/\.(?:md|json|ya?ml)$/.test(file) && reviewDocs.test(file) && !/\.sh$/.test(file)),
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function changedPaths(root, scopes) {
  const args = ['diff', '--name-only', '-z', '--no-renames', '--relative'];
  if (scopes.staged) args.push('--cached');
  if (scopes.base !== undefined) {
    const base = git(root, 'rev-parse', '--verify', '--end-of-options', `${scopes.base}^{commit}`).trim();
    const head = git(root, 'rev-parse', '--verify', 'HEAD').trim();
    args.push(git(root, 'merge-base', base, head).trim(), head);
  }
  return git(root, ...args, '--').split('\0').filter(Boolean);
}

function projectOptions(root) {
  for (const name of ['settings.local.json', 'settings.json']) {
    const file = path.join(root, '.claude', name);
    if (!fs.existsSync(file)) continue;
    const config = JSON.parse(fs.readFileSync(file, 'utf8')).pluginConfigs;
    return { ...config?.['dhpk@dhpk']?.options, ...config?.['dhpk-stacks@dhpk']?.options };
  }
  return {};
}

function stringList(value) {
  if (value === undefined || value === '') return [];
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)) return value;
  throw new Error('Expected a comma-separated list or an array of nonempty strings');
}

function pathPrefix(file, prefix) {
  return file === prefix || file.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

function extraMatcher(extra) {
  const separator = extra.indexOf(':');
  const slot = extra.slice(0, separator);
  const prefix = extra.slice(separator + 1);
  if (separator < 1 || slot === 'polyfill' || !Object.hasOwn(roles, slot) || !prefix
    || path.isAbsolute(prefix) || prefix.split('/').includes('..')) throw new Error('Invalid reviewer path prefix');
  return [roles[slot], (file) => pathPrefix(file, prefix)];
}

// Module declarations use simple inline YAML lists in their triggers section.
function moduleMatchers(root, module) {
  if (!/^[a-z\d][a-z\d.-]*$/.test(module)) throw new Error('Invalid active module identifier');
  const raw = fs.readFileSync(path.join(root, module, 'module.yaml'), 'utf8').split(/\r?\n/);
  const start = raw.findIndex((line) => /^triggers:\s*$/.test(line));
  if (start < 0) return [];
  const lines = raw.slice(start + 1);
  const end = lines.findIndex((line) => /^\S/.test(line) && !line.startsWith('#'));
  const rules = new Map();
  let role;
  for (const line of end < 0 ? lines : lines.slice(0, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const slot = /^ {2}([a-z]+):\s*$/.exec(line);
    if (slot) {
      if (!Object.hasOwn(moduleSlots, slot[1])) throw new Error(`Unknown reviewer slot in active module ${module}`);
      role = moduleSlots[slot[1]];
      if (!rules.has(role)) rules.set(role, { extensions: [], paths: [] });
      continue;
    }
    const values = /^ {4}(extensions|paths):\s*\[([^\]]*)\]\s*(?:#.*)?$/.exec(line);
    if (!values || !role) throw new Error(`Invalid trigger declaration in active module ${module}`);
    rules.get(role)[values[1]].push(...stringList(values[2]).map((item) => item.replace(/^(['"])(.*)\1$/, '$2')));
  }
  return [...rules].map(([name, { extensions, paths }]) => [
    name, (file) => extensions.some((ext) => file.endsWith(ext)) || paths.some((prefix) => pathPrefix(file, prefix)),
  ]);
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean' },
      staged: { type: 'boolean' }, unstaged: { type: 'boolean' }, base: { type: 'string' },
      modules: { type: 'string' }, 'modules-root': { type: 'string' }, extra: { type: 'string', multiple: true },
    },
  });
  if (values.help) {
    process.stdout.write('Usage: resolve-review-triggers.js (--staged | --unstaged | --base <ref>) [--modules <csv>] [--modules-root <path>] [--extra <slot:prefix>]\n');
    return;
  }
  const scopeCount = Number(Boolean(values.staged)) + Number(Boolean(values.unstaged)) + Number(values.base !== undefined);
  if (scopeCount !== 1 || values.base === '') throw new Error('Specify exactly one of --staged, --unstaged or --base <ref>');
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').replace(/\r?\n$/, '');
  const config = projectOptions(root);
  const activeModules = stringList(values.modules ?? process.env.DHPK_ACTIVE_MODULES
    ?? config.modules ?? process.env.CLAUDE_PLUGIN_OPTION_MODULES);
  const modulesRoot = values['modules-root'] ?? process.env.DHPK_REVIEW_MODULES_ROOT
    ?? path.resolve(__dirname, '../../../modules');
  const custom = stringList(config.review_trigger_extra_paths ?? process.env.CLAUDE_PLUGIN_OPTION_REVIEW_TRIGGER_EXTRA_PATHS);
  const matchers = [
    ...Object.entries(builtin).map(([slot, match]) => [roles[slot], match]),
    ...activeModules.flatMap((name) => moduleMatchers(modulesRoot, name)),
    ...[...custom, ...(values.extra ?? [])].map(extraMatcher),
  ];
  const files = changedPaths(root, values);
  const hits = matchers.filter(([, match]) => files.some(match)).map(([name]) => name);
  process.stdout.write(`${JSON.stringify([...new Set(hits)].sort())}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`resolve-review-triggers: ${error.message}\n`);
  process.exitCode = 1;
}
