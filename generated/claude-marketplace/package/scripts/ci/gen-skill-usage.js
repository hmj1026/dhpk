#!/usr/bin/env node
'use strict';

// Compile/check the inventory-owned Codex usage catalog. This command is a
// deliberately thin filesystem adapter: grammar validation and catalog shape
// live in scripts/lib/skill-usage.js, while this file only resolves paths and
// performs an atomic generated-file check/write.

const fs = require('node:fs');
const path = require('node:path');

const {
  compileSkillUsageCatalog,
  serializeSkillUsageCatalog,
} = require('../lib/skill-usage');

const DEFAULT_ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const result = {
    root: DEFAULT_ROOT,
    inventory: null,
    output: null,
    check: false,
    write: false,
    help: false,
    errors: [],
  };
  const valueFor = (index, option) => {
    if (argv[index + 1] === undefined || String(argv[index + 1]).startsWith('--')) {
      result.errors.push(option + ' requires a value');
      return null;
    }
    return argv[index + 1];
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (arg === '--check') result.check = true;
    else if (arg === '--write') result.write = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--root') {
      const value = valueFor(index, '--root');
      if (value !== null) {
        result.root = value;
        index += 1;
      }
    } else if (arg.startsWith('--root=')) result.root = arg.slice('--root='.length);
    else if (arg === '--inventory') {
      const value = valueFor(index, '--inventory');
      if (value !== null) {
        result.inventory = value;
        index += 1;
      }
    } else if (arg.startsWith('--inventory=')) result.inventory = arg.slice('--inventory='.length);
    else if (arg === '--out' || arg === '--output') {
      const value = valueFor(index, arg);
      if (value !== null) {
        result.output = value;
        index += 1;
      }
    } else if (arg.startsWith('--out=')) result.output = arg.slice('--out='.length);
    else if (arg.startsWith('--output=')) result.output = arg.slice('--output='.length);
    else result.errors.push('unknown argument: ' + arg);
  }
  if (result.check && result.write) result.errors.push('--check and --write are mutually exclusive');
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

function writeAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(directory, '.skill-usage-tmp-'));
  const temporaryPath = path.join(temporaryDirectory, path.basename(filePath));
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryDirectory)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function usageText() {
  return [
    'Usage: node scripts/ci/gen-skill-usage.js [--check|--write] [--root DIR]',
    '       [--inventory FILE] [--out FILE]',
  ].join('\n');
}

function run(argv, io) {
  const actualArgv = argv || process.argv.slice(2);
  const output = io || {};
  const stdout = output.stdout || process.stdout;
  const stderr = output.stderr || process.stderr;
  const args = parseArgs(actualArgv);
  if (args.help) {
    stdout.write(usageText() + '\n');
    return 0;
  }
  if (args.errors.length > 0) {
    for (const error of args.errors) stderr.write('FAIL [gen-skill-usage]: ' + error + '\n');
    return 2;
  }

  const root = path.resolve(args.root);
  const inventoryPath = resolvePath(root, args.inventory, 'manifests/distribution-inventory.json');
  const outputPath = resolvePath(root, args.output, 'skills/flow-guide/references/codex-usage-catalog.json');
  let catalog;
  try {
    const inventory = readJson(inventoryPath, 'distribution inventory');
    catalog = compileSkillUsageCatalog({ inventory });
  } catch (error) {
    stderr.write('FAIL [gen-skill-usage]: ' + error.message + '\n');
    return 1;
  }
  const expected = serializeSkillUsageCatalog(catalog);

  if (args.check) {
    let actual;
    try {
      if (!fs.existsSync(outputPath)) throw new Error('generated catalog missing: ' + outputPath);
      actual = fs.readFileSync(outputPath, 'utf8');
    } catch (error) {
      stderr.write('FAIL [gen-skill-usage]: ' + error.message + '\n');
      return 1;
    }
    if (actual !== expected) {
      stderr.write('FAIL [gen-skill-usage]: generated catalog drifted from inventory: ' + outputPath + '\n');
      return 1;
    }
    stdout.write(
      'PASS [gen-skill-usage]: catalog matches inventory ('
      + catalog.entries.length
      + ' entries, source '
      + catalog.sourceInventoryRevision
      + ').\n',
    );
    return 0;
  }

  if (args.write) {
    try {
      writeAtomically(outputPath, expected);
    } catch (error) {
      stderr.write('FAIL [gen-skill-usage]: cannot write generated catalog: ' + error.message + '\n');
      return 1;
    }
    stdout.write(
      'PASS [gen-skill-usage]: wrote '
      + catalog.entries.length
      + ' usage entries to '
      + outputPath
      + '.\n',
    );
    return 0;
  }

  stdout.write(
    'dhpk Codex usage catalog: '
    + catalog.entries.length
    + ' entries (source '
    + catalog.sourceInventoryRevision
    + ')\n',
  );
  stdout.write('  output: ' + outputPath + '\n');
  return 0;
}

if (require.main === module) process.exit(run());

module.exports = { parseArgs, run, serializeSkillUsageCatalog, writeAtomically };
