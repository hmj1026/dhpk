#!/usr/bin/env node
'use strict';

// Read-only progressive help for Codex-invokable skills. This helper reads
// only the Skill-local generated catalog; it never loads a target SKILL.md,
// consults a repository inventory, executes a target, or grants authority.

const fs = require('node:fs');
const path = require('node:path');
const { loadRuntimeModule } = require('./_lib/runtime-loader');
const {
  CATALOG_SCHEMA,
  renderSkillUsageCard,
  validateSkillUsage,
} = loadRuntimeModule('skill-usage');

const SKILL_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CATALOG = path.join(SKILL_ROOT, 'references', 'codex-usage-catalog.json');

function parseArgs(argv) {
  const result = {
    json: false,
    target: null,
    help: false,
    errors: [],
  };
  const args = argv || [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === '--json') result.json = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--')) result.errors.push('unknown argument: ' + arg);
    else if (result.target === null) result.target = arg.replace(/^\$/, '');
    else result.errors.push('only one skill target is allowed: ' + arg);
  }
  return result;
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(label + ' not found: ' + filePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(label + ' is invalid JSON: ' + error.message);
  }
}

function loadCatalog() {
  const filePath = DEFAULT_CATALOG;
  const catalog = readJson(filePath, 'generated usage catalog');
  if (!catalog || catalog.schema !== CATALOG_SCHEMA || !Array.isArray(catalog.entries)) {
    throw new Error('generated usage catalog has invalid schema or entries: ' + filePath);
  }
  return { catalog, filePath };
}

function entryName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const value = entry.name || entry.publicName;
  return typeof value === 'string' ? value : '';
}

function entryUsage(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry.usage && typeof entry.usage === 'object' ? entry.usage : entry;
}

function normalizedEntries(catalog) {
  return [...catalog.entries].sort((left, right) => (
    entryName(left).localeCompare(entryName(right))
      || String(left.id || '').localeCompare(String(right.id || ''))
  ));
}

function validateCatalog(catalog) {
  if (!catalog.runtimeIndex || typeof catalog.runtimeIndex !== 'object'
    || Array.isArray(catalog.runtimeIndex)
    || Object.keys(catalog.runtimeIndex).sort().join(',') !== 'aliases,targets') {
    throw new Error('generated usage catalog is missing its closed runtimeIndex');
  }
  const targets = catalog.runtimeIndex.targets;
  const aliases = catalog.runtimeIndex.aliases;
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)
    || !aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new Error('generated usage catalog runtimeIndex targets and aliases must be objects');
  }
  for (const [id, target] of Object.entries(targets)) {
    const keys = Object.keys(target || {}).sort().join(',');
    if (keys !== 'codexInvokable,command,id,invocationClass,publicName') {
      throw new Error(`runtimeIndex target '${id}' has an open or incomplete schema`);
    }
    if (target.id !== id || typeof target.publicName !== 'string' || !target.publicName
      || typeof target.command !== 'string' || !target.command
      || !['implicit-eligible', 'explicit-only', 'not-configured'].includes(target.invocationClass)
      || typeof target.codexInvokable !== 'boolean') {
      throw new Error(`runtimeIndex target '${id}' is invalid`);
    }
  }
  for (const [alias, value] of Object.entries(aliases)) {
    const keys = Object.keys(value || {}).sort().join(',');
    if (keys !== 'disposition,target'
      || typeof value.target !== 'string' || !value.target
      || !['legacy', 'renamed', 'retired'].includes(value.disposition)) {
      throw new Error(`runtimeIndex alias '${alias}' is invalid`);
    }
  }
  for (const entry of catalog.entries) {
    const name = entryName(entry);
    if (!name) throw new Error('generated usage catalog contains an entry without a public name');
    const usage = entryUsage(entry);
    const skill = {
      id: entry.id || name,
      name,
      invocation_class: entry.invocation_class || (usage && usage.invocation_class),
      surfaces: ['codex-native'],
    };
    const result = validateSkillUsage({ skill, usage });
    if (!result.ok) throw new Error(result.errors.join('; '));
  }
}

function catalogEntry(catalog, target) {
  return catalog.entries.find((entry) => entryName(entry) === target) || null;
}

function runtimeIndexEntry(catalog, target) {
  const index = catalog && catalog.runtimeIndex;
  if (!index || !index.targets || typeof index.targets !== 'object') return null;
  return Object.values(index.targets).find((entry) => entry && entry.publicName === target) || null;
}

function runtimeAlias(catalog, target) {
  const aliases = catalog && catalog.runtimeIndex && catalog.runtimeIndex.aliases;
  if (!aliases || typeof aliases !== 'object') return null;
  return aliases[target] || null;
}

function renderList(catalog) {
  const lines = ['Available Codex skills (read-only usage catalog):'];
  for (const entry of normalizedEntries(catalog)) {
    const usage = entryUsage(entry);
    lines.push('- ' + entryName(entry) + ': ' + usage.summary);
  }
  return lines.join('\n');
}

function renderCardText(card) {
  const lines = [
    card.name + ' — ' + card.display_name,
    'summary: ' + card.summary,
    'syntax: ' + card.syntax,
    'input: ' + card.input_kind,
    'invocation: ' + card.invocation_class,
    'authority: ' + card.effect_authority,
  ];
  if (card.invocation_class === 'explicit-only') {
    lines.push('direct invocation required; this help card is read-only');
  }
  if (card.inputs.length > 0) {
    lines.push('inputs:');
    for (const input of card.inputs) {
      const required = input.required ? 'required' : 'optional';
      const values = input.enum_values ? ' values=' + input.enum_values.join('|') : '';
      const defaultValue = Object.prototype.hasOwnProperty.call(input, 'default')
        ? ' default=' + String(input.default)
        : '';
      lines.push('- ' + input.id + ': ' + input.syntax + ' (' + required + ', ' + input.value_kind + values + defaultValue + ') — ' + input.summary);
    }
  }
  if (card.actions.length > 0) {
    lines.push('actions:');
    for (const action of card.actions) {
      lines.push('- ' + action.id + ': ' + action.syntax + ' — ' + action.summary);
    }
  }
  const options = card.options.filter((option) => !option.legacy);
  const legacyOptions = card.options.filter((option) => option.legacy);
  if (options.length > 0) {
    lines.push('options:');
    for (const option of options) {
      const required = option.required ? 'required' : 'optional';
      const values = option.enum_values ? ' values=' + option.enum_values.join('|') : '';
      const defaultValue = Object.prototype.hasOwnProperty.call(option, 'default')
        ? ' default=' + String(option.default)
        : '';
      lines.push('- ' + option.id + ': ' + option.syntax + ' (' + required + ', ' + option.value_kind + values + defaultValue + ') — ' + option.summary);
    }
  }
  if (legacyOptions.length > 0) {
    lines.push('legacy diagnostics:');
    for (const option of legacyOptions) {
      lines.push('- ' + option.id + ': ' + option.syntax + ' (diagnostic-only) — ' + option.legacy.reason);
    }
  }
  if (card.examples.length > 0) {
    lines.push('examples:');
    for (const example of card.examples) {
      lines.push('- ' + example.prompt + ' — ' + example.summary);
    }
  }
  if (card.catalogEvidence) lines.push('catalog: ' + (card.catalogEvidence.state || 'PASS'));
  return lines.join('\n');
}

function diagnostic(code, message, stderr) {
  stderr.write('ERROR [usage-card] ' + code + ': ' + message + '\n');
  return 1;
}

function run(argv, io) {
  const output = io || {};
  const stdout = output.stdout || process.stdout;
  const stderr = output.stderr || process.stderr;
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    stdout.write('Usage: node skills/flow-guide/scripts/usage-card.js [--json] [skill]\n');
    return 0;
  }
  if (args.errors.length > 0) {
    for (const error of args.errors) {
      stderr.write('ERROR [usage-card] invalid-arguments: ' + error + '\n');
    }
    return 2;
  }

  let loaded;
  try {
    loaded = loadCatalog();
    validateCatalog(loaded.catalog);
  } catch (error) {
    return diagnostic('catalog-invalid', error.message, stderr);
  }
  const catalog = loaded.catalog;
  const evidence = {
    schema: catalog.schema,
    state: 'PASS',
    sourceInventoryRevision: catalog.sourceInventoryRevision,
    path: path.relative(SKILL_ROOT, loaded.filePath).split(path.sep).join('/'),
  };

  if (args.target === null) {
    if (args.json) {
      stdout.write(JSON.stringify({ ...catalog, catalogEvidence: evidence }) + '\n');
    } else {
      stdout.write(renderList(catalog) + '\n');
    }
    return 0;
  }

  const target = args.target;
  if (!target || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(target)) {
    return diagnostic('unknown-skill', "skill '" + target + "' is not a known public name", stderr);
  }
  const entry = catalogEntry(catalog, target);
  if (!entry) {
    const known = runtimeIndexEntry(catalog, target);
    if (known && known.codexInvokable !== true) {
      return diagnostic(
        'not-codex-invokable',
        "skill '" + target + "' is known but absent from Codex surfaces",
        stderr,
      );
    }
    const alias = runtimeAlias(catalog, target);
    if (alias && alias.disposition === 'retired') {
      return diagnostic(
        'retired',
        "skill '" + target + "' is retired; use '" + alias.target + "'",
        stderr,
      );
    }
    if (alias && alias.disposition === 'renamed') {
      return diagnostic(
        'renamed',
        "skill '" + target + "' was renamed; use '" + alias.target + "'",
        stderr,
      );
    }
    if (alias && alias.disposition === 'legacy') {
      return diagnostic(
        'legacy-alias',
        "skill '" + target + "' is a legacy alias; use '" + alias.target + "'",
        stderr,
      );
    }
    return diagnostic('unknown-skill', "skill '" + target + "' is not in the local usage catalog", stderr);
  }

  const usage = entryUsage(entry);
  const skill = {
    id: entry.id || target,
    name: target,
    invocation_class: entry.invocation_class || usage.invocation_class,
    surfaces: ['codex-native'],
  };
  let card;
  try {
    card = renderSkillUsageCard({ skill, usage, catalogEvidence: evidence });
  } catch (error) {
    return diagnostic('catalog-invalid', error.message, stderr);
  }
  if (args.json) stdout.write(JSON.stringify(card) + '\n');
  else stdout.write(renderCardText(card) + '\n');
  return 0;
}

if (require.main === module) process.exit(run());

module.exports = {
  entryName,
  entryUsage,
  parseArgs,
  renderCardText,
  renderList,
  run,
};
