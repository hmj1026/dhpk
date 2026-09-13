#!/usr/bin/env node
'use strict';

// Read-only progressive help for Codex-invokable skills. This helper reads
// only the generated catalog and inventory identity; it never loads a target
// SKILL.md, executes a target, or grants target authority.

const fs = require('node:fs');
const path = require('node:path');
const {
  CATALOG_SCHEMA,
  renderSkillUsageCard,
  validateSkillUsage,
} = require('../../../scripts/lib/skill-usage');

const DEFAULT_ROOT = path.resolve(__dirname, '../../..');

function parseArgs(argv) {
  const result = {
    root: DEFAULT_ROOT,
    catalog: null,
    inventory: null,
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
    else if (arg === '--root' || arg === '--catalog' || arg === '--inventory') {
      const value = args[index + 1];
      if (value === undefined || String(value).startsWith('--')) {
        result.errors.push(arg + ' requires a value');
      } else {
        result[arg.slice(2)] = value;
        index += 1;
      }
    } else if (arg.startsWith('--root=')) result.root = arg.slice('--root='.length);
    else if (arg.startsWith('--catalog=')) result.catalog = arg.slice('--catalog='.length);
    else if (arg.startsWith('--inventory=')) result.inventory = arg.slice('--inventory='.length);
    else if (arg.startsWith('--')) result.errors.push('unknown argument: ' + arg);
    else if (result.target === null) result.target = arg.replace(/^\$/, '');
    else result.errors.push('only one skill target is allowed: ' + arg);
  }
  return result;
}

function resolvePath(root, candidate, fallback) {
  return path.resolve(root, candidate || fallback);
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(label + ' not found: ' + filePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(label + ' is invalid JSON: ' + error.message);
  }
}

function loadCatalog(root, candidate) {
  const filePath = resolvePath(root, candidate, 'skills/flow-guide/references/codex-usage-catalog.json');
  const catalog = readJson(filePath, 'generated usage catalog');
  if (!catalog || catalog.schema !== CATALOG_SCHEMA || !Array.isArray(catalog.entries)) {
    throw new Error('generated usage catalog has invalid schema or entries: ' + filePath);
  }
  return { catalog, filePath };
}

function loadInventory(root, candidate) {
  const filePath = resolvePath(root, candidate, 'manifests/distribution-inventory.json');
  return readJson(filePath, 'distribution inventory');
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

function knownInventoryEntry(inventory, target) {
  if (!inventory || !Array.isArray(inventory.skills)) return null;
  // Exact public-name lookup only. Stable IDs and legacy_names are not aliases
  // for help, which keeps retirement diagnostics honest.
  return inventory.skills.find((entry) => entry && entry.name === target) || null;
}

function catalogEntry(catalog, target) {
  return catalog.entries.find((entry) => entryName(entry) === target) || null;
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
  if (card.actions.length > 0) {
    lines.push('actions:');
    for (const action of card.actions) {
      lines.push('- ' + action.id + ': ' + action.syntax + ' — ' + action.summary);
    }
  }
  if (card.options.length > 0) {
    lines.push('options:');
    for (const option of card.options) {
      const required = option.required ? 'required' : 'optional';
      lines.push('- ' + option.id + ': ' + option.syntax + ' (' + required + ') — ' + option.summary);
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

  const root = path.resolve(args.root);
  let loaded;
  try {
    loaded = loadCatalog(root, args.catalog);
    validateCatalog(loaded.catalog);
  } catch (error) {
    return diagnostic('catalog-invalid', error.message, stderr);
  }
  const catalog = loaded.catalog;
  const evidence = {
    schema: catalog.schema,
    state: 'PASS',
    sourceInventoryRevision: catalog.sourceInventoryRevision,
    path: path.relative(root, loaded.filePath).split(path.sep).join('/'),
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
    let inventory;
    try {
      inventory = loadInventory(root, args.inventory);
    } catch (error) {
      return diagnostic('catalog-invalid', error.message, stderr);
    }
    const known = knownInventoryEntry(inventory, target);
    if (known) {
      return diagnostic(
        'not-codex-invokable',
        "skill '" + target + "' is known but absent from Codex surfaces",
        stderr,
      );
    }
    return diagnostic('unknown-skill', "skill '" + target + "' is not in the distribution inventory", stderr);
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
