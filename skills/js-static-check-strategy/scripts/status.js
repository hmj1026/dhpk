#!/usr/bin/env node
'use strict';

// Standalone, dependency-free status runner for the per-leaf TypeScript
// directive rollout. It deliberately scans only the immediate regular .js
// files in the selected directory so a consumer does not need the dhpk
// checkout, find, grep, or a shell-specific regex implementation.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PATH = process.env.CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH || 'js/';

function usage() {
  return 'usage: status.js [--path <directory>]';
}

function parseArgs(argv) {
  let scanPath = DEFAULT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--path') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${usage()}\nERROR: --path requires a directory`);
      }
      scanPath = value;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      return { help: true, scanPath };
    }
    throw new Error(`${usage()}\nERROR: unknown argument '${argument}'`);
  }

  return { help: false, scanPath };
}

function unavailable(scanPath, diagnostic) {
  return {
    status: 'UNAVAILABLE',
    path: scanPath,
    diagnostic,
  };
}

function classify(contents) {
  // @ts-nocheck is the effective safety directive when a malformed or
  // transitional leaf contains both directives. Each file enters exactly one
  // bucket, so the summary cannot double-count a file or derive a negative
  // unmarked total by subtraction.
  const nocheck = /^\s*\/\/\s*@ts-nocheck(?:\s+.*)?\s*$/m.test(contents);
  if (nocheck) return 'nocheck';

  const strict = /^\s*\/\/\s*@ts-check\s*$/m.test(contents);
  if (strict) return 'strict';

  return 'unmarked';
}

function scan(scanPath) {
  const resolvedPath = path.resolve(process.cwd(), scanPath);
  let root;
  try {
    root = fs.lstatSync(resolvedPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return unavailable(scanPath, `scan path '${scanPath}' does not exist`);
    }
    return unavailable(scanPath, `scan path '${scanPath}' is unavailable: ${error.message}`);
  }

  if (root.isSymbolicLink()) {
    return unavailable(scanPath, `scan path '${scanPath}' must be a regular directory, not a symlink`);
  }
  if (!root.isDirectory()) {
    return unavailable(scanPath, `scan path '${scanPath}' is not a directory`);
  }

  let entries;
  try {
    entries = fs.readdirSync(resolvedPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.js'))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  } catch (error) {
    return unavailable(scanPath, `scan path '${scanPath}' could not be read: ${error.message}`);
  }

  const files = {
    strict: [],
    nocheck: [],
    unmarked: [],
  };

  for (const entry of entries) {
    const filePath = path.join(resolvedPath, entry.name);
    let contents;
    try {
      contents = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return unavailable(scanPath, `could not read '${entry.name}': ${error.message}`);
    }
    files[classify(contents)].push(entry.name);
  }

  const counts = {
    total: entries.length,
    strict: files.strict.length,
    nocheck: files.nocheck.length,
    unmarked: files.unmarked.length,
  };

  return {
    status: 'PASS',
    path: scanPath,
    files,
    counts,
    // Keep a compact human-readable line in the JSON report for the legacy
    // command's summary contract and shell consumers that grep its output.
    summary: `total=${counts.total} strict=${counts.strict} nocheck=${counts.nocheck} unmarked=${counts.unmarked}`,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(unavailable(DEFAULT_PATH, error.message))}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(scan(args.scanPath))}\n`);
}

main();

