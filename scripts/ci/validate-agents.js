#!/usr/bin/env node
'use strict';

// Validate agents/*.md frontmatter.
//   FAIL: missing frontmatter, missing/empty name or description, duplicate
//         keys, invalid model / effort / maxTurns value.
//   WARN: missing model / tools / effort / maxTurns (promoted to FAIL under
//         --strict for fields that are explicitly present but empty).
// INDEX.md is a navigation file, not an agent — skipped.

const fs = require('fs');
const path = require('path');
const { extract, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');
const { collectCodexCoverageErrors, collectCodexRuntimeErrors } = require('./_lib/codex-runtime');

const ROOT = path.join(__dirname, '..', '..');
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const VALID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index === -1) return ROOT;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    console.error('ERROR [agents]: --root requires a directory path');
    process.exit(2);
  }
  return path.resolve(value);
}

function hasFrontmatterKey(values, key) {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function isPositiveInteger(value) {
  const normalized = String(value).trim().replace(/^(['"])(.*)\1$/, '$2');
  return /^[1-9]\d*$/.test(normalized);
}

const validationRoot = parseRoot(process.argv);
const AGENTS_DIR = path.join(validationRoot, 'agents');

function collectAgentFiles(root) {
  const roots = [path.join(root, 'agents')];
  const modulesDir = path.join(root, 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) roots.push(path.join(modulesDir, entry.name, 'agents'));
    }
  }
  return roots.flatMap((directory) => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
      .map((entry) => path.join(directory, entry.name));
  });
}

const r = createReporter('agents');

function warnOptional(message) {
  if (r.strict) console.warn(`WARN [agents]: ${message}`);
  else r.warn(message);
}

if (!fs.existsSync(AGENTS_DIR)) {
  console.log('No agents/ directory — skipping.');
  process.exit(0);
}

const files = collectAgentFiles(validationRoot);

for (const fullPath of files) {
  const file = path.relative(validationRoot, fullPath).split(path.sep).join('/');
  const fm = extract(fs.readFileSync(fullPath, 'utf8'));

  if (!fm.present) {
    r.err(`${file} — missing frontmatter`);
    continue;
  }
  if (fm.duplicates.length) {
    r.err(`${file} — duplicate frontmatter keys: ${[...new Set(fm.duplicates)].join(', ')}`);
  }
  if (isEmpty(fm.values.name)) r.err(`${file} — missing/empty 'name'`);
  if (isEmpty(fm.values.description)) r.err(`${file} — missing/empty 'description'`);
  if (isEmpty(fm.values.model)) r.warn(`${file} — missing 'model'`);
  else if (!VALID_MODELS.includes(fm.values.model)) {
    r.err(`${file} — invalid model '${fm.values.model}' (expected: ${VALID_MODELS.join(', ')})`);
  }
  if (isEmpty(fm.values.tools)) r.warn(`${file} — missing 'tools'`);
  if (isEmpty(fm.values.effort)) {
    if (hasFrontmatterKey(fm.values, 'effort')) r.warn(`${file} — missing/empty 'effort'`);
    else warnOptional(`${file} — missing 'effort'`);
  } else if (!VALID_EFFORTS.includes(fm.values.effort)) {
    r.err(`${file} — invalid effort '${fm.values.effort}' (expected: ${VALID_EFFORTS.join(', ')})`);
  }
  if (isEmpty(fm.values.maxTurns)) {
    if (hasFrontmatterKey(fm.values, 'maxTurns')) r.warn(`${file} — missing/empty 'maxTurns'`);
    else warnOptional(`${file} — missing 'maxTurns'`);
  } else if (!isPositiveInteger(fm.values.maxTurns)) {
    r.err(`${file} — invalid maxTurns '${fm.values.maxTurns}' (expected a positive integer)`);
  }
}

for (const error of collectCodexRuntimeErrors(validationRoot)) {
  r.err(error);
}
for (const error of collectCodexCoverageErrors(validationRoot)) {
  r.err(error);
}

r.done(`${files.length} agent files, Codex runtime projection, and coverage matrix`);
