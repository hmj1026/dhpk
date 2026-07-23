#!/usr/bin/env node
'use strict';

// Validate agents/*.md frontmatter.
//   FAIL: missing frontmatter, missing/empty name or description, duplicate
//         keys, invalid model value.
//   WARN: missing model / tools (promoted to FAIL under --strict).
// INDEX.md is a navigation file, not an agent — skipped.

const fs = require('fs');
const path = require('path');
const { extract, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];

const r = createReporter('agents');

if (!fs.existsSync(AGENTS_DIR)) {
  console.log('No agents/ directory — skipping.');
  process.exit(0);
}

const files = fs
  .readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'INDEX.md');

for (const file of files) {
  const fm = extract(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8'));

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
}

r.done(`${files.length} agent files`);
