#!/usr/bin/env node
'use strict';

// Reference-integrity CI guard for shipped harness Markdown. It verifies that
// explicit machine-facing references and natural-language capability handoffs
// resolve to real resources in this repository.
//
// Check 3 is deliberately scoped to `${CLAUDE_PLUGIN_ROOT}/…`-anchored paths:
// those make an unambiguous claim that the path resolves inside the installed
// plugin, so a dangling one is a real defect. Bare `scripts/…` / `hooks/…`
// mentions in skill prose are ambiguous, illustrative, or consumer-side, and
// resolving them root-relative yields false positives.
//
//   node scripts/ci/validate-references.js     print findings, exit 1 on any
//
// Also exports `scanRepo` / `scanText` so tests can exercise reference
// resolution against the real tree and synthetic fixtures.

const fs = require('fs');
const path = require('path');
const {
  buildReferenceRegistry,
  resolveReference,
  extractNaturalLanguageReferences,
} = require('../lib/reference-registry');

const ROOT = path.join(__dirname, '..', '..');
const p = (...s) => path.join(ROOT, ...s);
const WHITELIST_PATH = p('scripts', 'ci', 'reference-integrity-whitelist.json');
const REFERENCE_REGISTRY = buildReferenceRegistry(ROOT);

function walk(dir, test) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(fp, test));
    else if (test(fp)) out.push(fp);
  }
  return out;
}

const isMarkdown = (fp) => fp.endsWith('.md');
const relPath = (fp) => path.relative(ROOT, fp).split(path.sep).join('/');

// Shipped harness markdown: skills/, commands/, agents/, rules/, and each
// modules/<id>/{skills,commands,agents}. This is the scan set for resource checks.
function harnessFiles() {
  const files = [];
  for (const d of ['skills', 'commands', 'agents', 'rules']) {
    files.push(...walk(p(d), isMarkdown));
  }
  const modulesDir = p('modules');
  if (fs.existsSync(modulesDir)) {
    for (const e of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const sub of ['skills', 'commands', 'agents']) {
        files.push(...walk(path.join(modulesDir, e.name, sub), isMarkdown));
      }
    }
  }
  return files;
}

function loadWhitelist() {
  if (!fs.existsSync(WHITELIST_PATH)) return { rules_refs: [] };
  return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
}

// Strip trailing punctuation (markdown/prose noise) that regex token capture
// picks up: closing backticks, quotes, brackets, sentence punctuation.
function stripTrailingPunct(tok) {
  return tok.replace(/[.,;:!?)\]}'"`]+$/, '');
}

// --- Check 1: @rules/<file> ------------------------------------------------

function extractRulesRefs(text) {
  const found = [];
  const re = /@rules\/([^\s`)"'*]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = stripTrailingPunct(m[1]);
    if (!target || target.includes('<') || target.includes('>')) continue;
    found.push(target);
  }
  return found;
}

function isConsumerOverride(target) {
  return /-project\.md$/.test(target);
}

function isWhitelistedRulesRef(whitelist, file, target) {
  return whitelist.rules_refs.some((w) => w.file === file && w.target === `@rules/${target}`);
}

function checkRulesRefs(relFile, text, whitelist) {
  const findings = [];
  for (const target of extractRulesRefs(text)) {
    if (isConsumerOverride(target)) continue;
    if (fs.existsSync(p('rules', target))) continue;
    if (isWhitelistedRulesRef(whitelist, relFile, target)) continue;
    findings.push({
      file: relFile,
      check: 1,
      detail: `@rules/${target} does not resolve to rules/${target}`,
    });
  }
  return findings;
}

// --- Check 2: /dhpk:<name> --------------------------------------------------

function extractDhpkRefs(text) {
  const found = [];
  const re = /\/dhpk:([a-z0-9-]+)(:?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2] === ':') continue; // e.g. /dhpk:opsx:<name> — namespaced, skip
    found.push(m[1]);
  }
  return found;
}

function dhpkRefResolves(name) {
  if (fs.existsSync(p('commands', `${name}.md`))) return true;
  if (fs.existsSync(p('skills', name, 'SKILL.md'))) return true;
  const modulesDir = p('modules');
  if (fs.existsSync(modulesDir)) {
    for (const e of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (fs.existsSync(path.join(modulesDir, e.name, 'commands', `${name}.md`))) return true;
      if (fs.existsSync(path.join(modulesDir, e.name, 'skills', name, 'SKILL.md'))) return true;
    }
  }
  return false;
}

function checkDhpkRefs(relFile, text) {
  const findings = [];
  for (const name of extractDhpkRefs(text)) {
    if (dhpkRefResolves(name)) continue;
    findings.push({
      file: relFile,
      check: 2,
      detail: `/dhpk:${name} does not resolve to any commands/${name}.md or skills/${name}/SKILL.md`,
    });
  }
  return findings;
}

// --- Check 3: explicit ${CLAUDE_PLUGIN_ROOT}/ path refs ---------------------

function isConsumerPath(rel) {
  return (
    rel.startsWith('.claude/') ||
    rel.startsWith('$CLAUDE_PROJECT_DIR') ||
    rel.startsWith('~/') ||
    rel.startsWith('node_modules/') ||
    rel.startsWith('/')
  );
}

function extractPathRefs(text) {
  const found = [];
  const seen = new Set();
  let m;
  const rootRe = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s`)"'*]+)/g;
  while ((m = rootRe.exec(text)) !== null) {
    const target = stripTrailingPunct(m[1]);
    if (!target || target.includes('<') || target.includes('>')) continue; // placeholder
    if (isConsumerPath(target) || seen.has(target)) continue;
    seen.add(target);
    found.push(target);
  }
  return found;
}

function checkPathRefs(relFile, text) {
  const findings = [];
  for (const target of extractPathRefs(text)) {
    if (fs.existsSync(p(target))) continue;
    findings.push({ file: relFile, check: 3, detail: `path ref '${target}' does not exist` });
  }
  return findings;
}

// --- Check 6: imperative natural-language capability handoffs --------------
// Markdown frequently names a Skill-tool capability without a slash command,
// e.g. "Invoke the `dhpk-opsx-load-context` skill". These handoffs are part of
// the same registry as /dhpk refs. An unresolved name is allowed only when the
// sentence explicitly marks it as an optional provider/capability; optionality
// is visible to the reader and cannot be inferred from a missing executable.
function checkNaturalLanguageRefs(relFile, text) {
  const findings = [];
  for (const ref of extractNaturalLanguageReferences(text)) {
    if (resolveReference(REFERENCE_REGISTRY, ref.name)) continue;
    if (ref.optional) continue;
    findings.push({
      file: relFile,
      check: 6,
      line: ref.line,
      detail: `natural-language handoff '${ref.name}' does not resolve to a canonical capability or explicit optional provider`,
    });
  }
  return findings;
}

// --- Public API -------------------------------------------------------------

function scanText(relFile, text) {
  const whitelist = loadWhitelist();
  return [
    ...checkRulesRefs(relFile, text, whitelist),
    ...checkDhpkRefs(relFile, text),
    ...checkPathRefs(relFile, text),
    ...checkNaturalLanguageRefs(relFile, text),
  ];
}

function scanRepo() {
  const findings = [];
  for (const fp of harnessFiles()) {
    findings.push(...scanText(relPath(fp), fs.readFileSync(fp, 'utf8')));
  }
  return findings;
}

function formatFinding(f) {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  return `FAIL [check ${f.check}] ${loc}: ${f.detail}`;
}

function main() {
  const findings = scanRepo();
  if (findings.length === 0) {
    console.log('PASS [reference-integrity]: all checked references resolve.');
    return 0;
  }
  for (const f of findings) console.error(formatFinding(f));
  console.error(`FAIL [reference-integrity]: ${findings.length} finding(s).`);
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { scanRepo, scanText, harnessFiles, checkNaturalLanguageRefs };
