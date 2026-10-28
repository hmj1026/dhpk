#!/usr/bin/env node
'use strict';

// Validate commands/**/*.md — each command needs frontmatter with a non-empty
// 'description' (the slash-command picker keys off it). INDEX.md is navigation,
// not a command — skipped.
//   FAIL: missing frontmatter, missing/empty description, duplicate keys.
// A commands/<id>.md whose skills/<id>/SKILL.md exists must grant only an
// allowed-tools token set contained in that skill. Tokens are comma-separated
// and compared after trim and quote-stripping, so Bash is not Bash(git:*).
// A declared alias forwarder needs an explicit owner-skill grant for bare Bash.
// A missing skill key forbids the command key. A missing command key is fine.

const fs = require('fs');
const path = require('path');
const { extract, isEmpty, unquote } = require('./_lib/frontmatter');
const { createReporter } = require('./_lib/report');
const { commandDeclarations } = require('../lib/skill-command-generation');

const ROOT = path.join(__dirname, '..', '..');

function listCommandFiles(root) {
  const commandsDir = path.join(root, 'commands');
  if (!fs.existsSync(commandsDir)) return [];
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.name.endsWith('.md') && entry.name !== 'INDEX.md') files.push(candidate);
    }
  })(commandsDir);
  return files;
}

function allowedTools(content) {
  const fm = extract(content);
  if (!fm.present || !Object.prototype.hasOwnProperty.call(fm.values, 'allowed-tools')) {
    return { present: false, tokens: [] };
  }
  const tokens = unquote(fm.values['allowed-tools'])
    .split(',')
    .map((part) => unquote(part))
    .filter(Boolean);
  return { present: true, tokens };
}

function commandToolSubsetFindings(root) {
  const findings = [];
  for (const file of listCommandFiles(root)) {
    const id = path.basename(file, '.md');
    const skillFile = path.join(root, 'skills', id, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const commandTools = allowedTools(fs.readFileSync(file, 'utf8'));
    const skillTools = allowedTools(fs.readFileSync(skillFile, 'utf8'));
    const rel = path.relative(root, file);
    if (!skillTools.present) {
      if (commandTools.present) {
        findings.push(`${rel} — allowed-tools is set but skills/${id}/SKILL.md has no allowed-tools key`);
      }
      continue;
    }
    if (!commandTools.present) continue;
    const granted = new Set(skillTools.tokens);
    const extra = commandTools.tokens.filter((token) => !granted.has(token));
    if (extra.length) {
      findings.push(`${rel} — allowed-tools token ${extra.join(', ')} is outside skills/${id}/SKILL.md`);
    }
  }
  findings.push(...declaredAliasBareBashFindings(root));
  return findings;
}

function declaredAliasBareBashFindings(root) {
  const findings = [];
  let declarations;
  try {
    declarations = commandDeclarations(root);
  } catch (error) {
    return [`could not inspect declared alias forwarders: ${error.message}`];
  }

  for (const { skill, declaration } of declarations) {
    if (declaration.id === skill.id) continue;
    const commandFile = path.join(root, 'commands', `${declaration.id}.md`);
    const skillFile = path.join(root, skill.path, 'SKILL.md');
    if (!fs.existsSync(commandFile) || !fs.existsSync(skillFile)) continue;
    const commandTools = allowedTools(fs.readFileSync(commandFile, 'utf8'));
    if (!commandTools.tokens.includes('Bash')) continue;
    const skillTools = allowedTools(fs.readFileSync(skillFile, 'utf8'));
    if (skillTools.tokens.includes('Bash')) continue;
    const rel = path.relative(root, commandFile);
    findings.push(
      `${rel} — declared alias forwarder grants bare Bash but ${skill.path}/SKILL.md does not explicitly allow bare Bash`
    );
  }
  return findings;
}

function main() {
  const r = createReporter('commands');
  const commandsDir = path.join(ROOT, 'commands');
  if (!fs.existsSync(commandsDir)) {
    console.log('No commands/ directory — skipping.');
    process.exit(0);
  }

  const rel = (file) => path.relative(ROOT, file);
  const files = listCommandFiles(ROOT);
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
  for (const finding of commandToolSubsetFindings(ROOT)) r.err(finding);
  r.done(`${files.length} command files`);
}

if (require.main === module) main();

module.exports = { commandToolSubsetFindings };
