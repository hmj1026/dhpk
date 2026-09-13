#!/usr/bin/env node
'use strict';

// Validate commands/**/*.md — each command needs frontmatter with a non-empty
// 'description' (the slash-command picker keys off it). INDEX.md is navigation,
// not a command — skipped.
//   FAIL: missing frontmatter, missing/empty description, duplicate keys.

const fs = require('fs');
const path = require('path');
const { extract, isEmpty } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');

const ROOT = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');

const r = createReporter('commands');

if (!fs.existsSync(COMMANDS_DIR)) {
  console.log('No commands/ directory — skipping.');
  process.exit(0);
}

const rel = (p) => path.relative(ROOT, p);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && e.name !== 'INDEX.md') files.push(p);
  }
})(COMMANDS_DIR);

for (const file of files) {
  const fm = extract(fs.readFileSync(file, 'utf8'));
  if (!fm.present) {
    r.err(`${rel(file)} — missing frontmatter`);
    continue;
  }
  if (fm.duplicates.length) {
    r.err(`${rel(file)} — duplicate frontmatter keys: ${[...new Set(fm.duplicates)].join(', ')}`);
  }
  if (isEmpty(fm.values.description)) r.err(`${rel(file)} — missing/empty 'description'`);
}

r.done(`${files.length} command files`);
