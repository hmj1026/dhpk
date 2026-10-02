#!/usr/bin/env node
'use strict';

// Zero-dependency JavaScript guardrail. Every tracked or new .js/.cjs file
// must parse as CommonJS. Modules with a line-start `// dhpk:read-only-planner`
// comment observe untrusted on-disk state, so they read through descriptors opened
// with O_NOFOLLOW and never write, spawn, or call readFileSync (which follows
// a symlink swapped in after lstat). The planner check is lexical: it names
// banned APIs wherever they appear, so keep them out of planner comments too.
// See CODING_STANDARDS.md.
//
//   node scripts/ci/validate-js-guardrails.js

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLANNER_MARKER = 'dhpk:read-only-planner';
const PLANNER_MARKER_LINE = new RegExp(`^// ${PLANNER_MARKER}\\b`, 'm');

const WRITE_APIS = [
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdtempSync',
  'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'cpSync', 'symlinkSync',
  'linkSync', 'chmodSync', 'chownSync', 'truncateSync', 'utimesSync', 'createWriteStream',
  'writeSync', 'writevSync',
];

const PLANNER_RULES = [
  { pattern: /\breadFileSync\b/, message: 'read-only planner uses readFileSync; read through a descriptor opened with O_NOFOLLOW' },
  { pattern: new RegExp(`\\b(${WRITE_APIS.join('|')})\\b|\\.promises\\b|['"](node:)?fs/promises['"]`), message: 'read-only planner uses write API' },
  { pattern: /\bO_(WRONLY|RDWR|CREAT|TRUNC|APPEND)\b/, message: 'read-only planner opens a file for writing' },
  { pattern: /\bopenSync\s*\([^,)]*,\s*['"](?!r['"])[^'"]*['"]/, message: 'read-only planner opens a file for writing' },
  { pattern: /['"](node:)?child_process['"]/, message: 'read-only planner spawns processes' },
];

function listFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.js', '*.cjs'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(output.split('\0').filter(Boolean))].sort();
}

function syntaxError(relativePath, source) {
  const body = source.startsWith('#!') ? `//${source.slice(2)}` : source;
  try {
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${body}\n})`, { filename: relativePath });
    return null;
  } catch (error) {
    return `${relativePath}: syntax: ${error.message}`;
  }
}

function plannerErrors(relativePath, source) {
  return PLANNER_RULES
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => `${relativePath}: ${rule.message}`);
}

function checkFiles(root, files, stats = { plannerFiles: [] }) {
  const errors = [];
  for (const relativePath of files) {
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    const syntax = syntaxError(relativePath, source);
    if (syntax) {
      errors.push(syntax);
      continue;
    }
    if (!PLANNER_MARKER_LINE.test(source)) continue;
    stats.plannerFiles.push(relativePath);
    errors.push(...plannerErrors(relativePath, source));
  }
  return errors;
}

function main(root = path.resolve(__dirname, '..', '..')) {
  const files = listFiles(root);
  const stats = { plannerFiles: [] };
  const errors = checkFiles(root, files, stats);
  return { checked: files.length, plannerFiles: stats.plannerFiles, errors };
}

if (require.main === module) {
  const result = main();
  for (const error of result.errors) console.error(`FAIL [validate-js-guardrails]: ${error}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log(`PASS [validate-js-guardrails]: ${result.checked} files parse; ${result.plannerFiles.length} read-only planner(s) clean`);
}

module.exports = { checkFiles, main, PLANNER_MARKER };
