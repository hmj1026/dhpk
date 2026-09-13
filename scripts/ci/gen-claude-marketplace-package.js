#!/usr/bin/env node
'use strict';

// Materialize the Claude marketplace package from the canonical plugin tree.
// The repository root is an authoring checkout and contains project-level
// CLAUDE.md instructions; it is deliberately not part of this package.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'generated', 'claude-marketplace', 'package');
const PACKAGE_PATHS = [
  '.claude-plugin/plugin.json',
  'agent-traps',
  'agents',
  'commands',
  'docs',
  'hooks',
  'manifests',
  'modules',
  'rules',
  'scripts',
  'skills',
  'templates',
];

function usage() {
  console.error('usage: node scripts/ci/gen-claude-marketplace-package.js [--out <directory>] [--check]');
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUTPUT, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.check = true;
    else if (arg === '--out') args.out = argv[++index] || null;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  if (!args.out) return { error: '--out requires a directory' };
  return args;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function copyPhysicalEntry(source, destination, root) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(source);
    if (!isInside(root, resolved)) throw new Error(`canonical Claude package symlink escapes the source root: ${source}`);
    return copyPhysicalEntry(resolved, destination, root);
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyPhysicalEntry(path.join(source, entry), path.join(destination, entry), root);
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`canonical Claude package source is not a regular file: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyCanonicalTree(root, output) {
  const sourceRoot = fs.realpathSync(root);
  fs.mkdirSync(output, { recursive: true });
  for (const relative of PACKAGE_PATHS) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`canonical Claude package source is missing: ${relative}`);
    copyPhysicalEntry(source, path.join(output, relative), sourceRoot);
  }
}

function assertSafeOutput(root, output) {
  const sourceRoot = fs.realpathSync(root);
  let outputPath = path.resolve(output);
  const missing = [];
  while (!fs.existsSync(outputPath)) {
    const parent = path.dirname(outputPath);
    if (parent === outputPath) break;
    missing.unshift(path.basename(outputPath));
    outputPath = parent;
  }
  outputPath = path.join(fs.realpathSync(outputPath), ...missing);
  for (const relative of PACKAGE_PATHS) {
    const sourcePath = path.resolve(sourceRoot, relative);
    if (isInside(outputPath, sourcePath) || isInside(sourcePath, outputPath)) {
      throw new Error(`generated Claude marketplace output overlaps canonical source path: ${outputPath}`);
    }
  }
}

function fingerprint(directory) {
  const hash = crypto.createHash('sha256');
  const walk = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${childRelative}\n`);
        walk(child, childRelative);
      } else if (entry.isFile()) {
        hash.update(`F:${childRelative}:${crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex')}\n`);
      } else {
        throw new Error(`Claude marketplace package contains an unsupported entry: ${childRelative}`);
      }
    }
  };
  walk(directory);
  return hash.digest('hex');
}

function assertPhysicalPackage(output) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Claude marketplace package contains a symlink: ${path.relative(output, child)}`);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(output);
}

function temporaryPackage(parent) {
  return fs.mkdtempSync(path.join(parent, '.dhpk-claude-marketplace-'));
}

function materialize({ root = ROOT, out = DEFAULT_OUTPUT } = {}) {
  const output = path.resolve(out);
  assertSafeOutput(root, output);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = temporaryPackage(parent);
  try {
    copyCanonicalTree(root, temporary);
    assertPhysicalPackage(temporary);
    if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(temporary, output);
    return { output, fingerprint: fingerprint(output) };
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function check({ root = ROOT, out = DEFAULT_OUTPUT } = {}) {
  const output = path.resolve(out);
  if (!fs.existsSync(output)) return { ok: false, error: `generated Claude marketplace package is missing: ${output}` };
  const parent = fs.realpathSync(path.dirname(output));
  const temporary = temporaryPackage(parent);
  try {
    copyCanonicalTree(root, temporary);
    assertPhysicalPackage(temporary);
    const expected = fingerprint(temporary);
    const actual = fingerprint(output);
    return expected === actual
      ? { ok: true, output, fingerprint: actual }
      : { ok: false, output, expected, actual, error: 'generated Claude marketplace package is out of date' };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }
  if (args.error) { console.error(`FAIL [gen-claude-marketplace-package]: ${args.error}`); usage(); return 2; }
  try {
    if (args.check) {
      const result = check({ out: args.out });
      if (!result.ok) {
        console.error(`FAIL [gen-claude-marketplace-package]: ${result.error}`);
        return 1;
      }
      console.log(`PASS [gen-claude-marketplace-package]: ${result.output}`);
      return 0;
    }
    const result = materialize({ out: args.out });
    console.log(JSON.stringify({ output: result.output, fingerprint: result.fingerprint }, null, 2));
    return 0;
  } catch (error) {
    console.error(`FAIL [gen-claude-marketplace-package]: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_OUTPUT,
  PACKAGE_PATHS,
  check,
  fingerprint,
  main,
  materialize,
};
