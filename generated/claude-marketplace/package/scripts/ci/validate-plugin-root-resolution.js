#!/usr/bin/env node
'use strict';

// Zero-dependency guardrail for ADR 0038. Runtime scripts must resolve their
// owning package through the shared resolvers (bash `dhpk_plugin_root`, JS
// scripts/lib/package-root.js) and never select a root straight from the
// CLAUDE_PLUGIN_ROOT environment variable. The check is lexical: it rejects
// value reads and env injection, ignoring comment lines.
//
//   node scripts/ci/validate-plugin-root-resolution.js

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VAR = 'CLAUDE_PLUGIN_ROOT';

// Explicit per-file allow-list. Never exempt a directory, and never exempt the
// shared resolvers: they must not read the variable at all.
const EXEMPTIONS = {
  'scripts/lib/cursor-harness-adapt.js': 'generator text transform: rewrites the variable name in emitted content, never reads it',
  'scripts/lib/marketplace-skill-content.js': 'generator text transform: rewrites the variable name in emitted skill content, never reads it',
  'scripts/lib/native-agent-support.js': 'generator text transform: rewrites the variable name in emitted agent content, never reads it',
  'scripts/validate/test-hooks.sh': 'test harness: exports the variable only to simulate the host environment for hooks under test',
};

// Every tracked runtime location is scanned; the scope is inverted so a new
// directory is covered by default instead of silently escaping the check.
const SCOPE = [
  /^scripts\//,
  /^bin\//,
  /^modules\/[^/]+\//,
  /^skills\/[^/]+\/scripts\//,
];

const SHELL_RULES = [
  { pattern: new RegExp('\\$\\{?' + VAR + '\\b'), message: `reads ${VAR}; use dhpk_plugin_root` },
  { pattern: new RegExp('(?<![A-Za-z0-9_])' + VAR + '='), message: `injects ${VAR} into an environment; pass the resolved root explicitly` },
];

const JS_RULES = [
  { pattern: new RegExp('\\{[^}]*(?<![A-Za-z0-9_$])' + VAR + '(?![A-Za-z0-9_$])[^}]*\\}\\s*=(?!=)\\s*(?:process\\.)?env\\b'), message: `destructures ${VAR} from env; use scripts/lib/package-root.js` },
  { pattern: new RegExp('\\benv(?:\\.|\\[\\s*[\'"`])' + VAR + '(?![A-Za-z0-9_])'), message: `reads env ${VAR}; use scripts/lib/package-root.js` },
  { pattern: new RegExp('(?<![A-Za-z0-9_.$])[\'"`]?' + VAR + '[\'"`]?\\s*:(?!:)'), message: `injects ${VAR} as an object key (spawn env); pass the resolved root explicitly` },
];

function kindOf(relativePath, source) {
  const ext = path.extname(relativePath);
  if (ext === '.sh') return 'shell';
  if (['.js', '.cjs', '.mjs'].includes(ext)) return 'js';
  if (ext === '' && /^#!.*\b(?:ba|z|da)?sh\b/.test(source.split('\n', 1)[0])) return 'shell';
  if (ext === '' && /^#!.*\bnode\b/.test(source.split('\n', 1)[0])) return 'js';
  return null;
}

function isScanned(relativePath) {
  if (relativePath.split('/').includes('tests')) return false;
  if (relativePath.endsWith('.md')) return false;
  return SCOPE.some((pattern) => pattern.test(relativePath));
}

// Blank out block comments (keeping newlines) so line numbers stay stable.
function stripBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

// Opener of a quoted heredoc (<<'T', <<"T", <<\T, with optional - and space).
// The body is literal text, not shell code, so it is not scanned.
const QUOTED_HEREDOC = /(?<!<)<<(?!<)(-?)\s*(?:'([^']+)'|"([^"]+)"|\\([A-Za-z0-9_]+))/;

function blankQuotedHeredocs(lines) {
  let closing = null;
  return lines.map((line) => {
    if (closing) {
      const candidate = closing.indent ? line.replace(/^\t+/, '') : line;
      if (candidate === closing.tag) closing = null;
      return '';
    }
    const match = QUOTED_HEREDOC.exec(line);
    if (match) closing = { indent: match[1] === '-', tag: match[2] || match[3] || match[4] };
    return line;
  });
}

function codeLines(kind, source) {
  const text = kind === 'js' ? stripBlockComments(source) : source;
  const comment = kind === 'js' ? /^\s*\/\// : /^\s*#/;
  const lines = text.split(/\r?\n/);
  const live = kind === 'shell' ? blankQuotedHeredocs(lines) : lines;
  return live.map((line) => (comment.test(line) ? '' : line));
}

function fileViolations(relativePath, source) {
  const kind = kindOf(relativePath, source);
  if (kind === null) return [];
  const rules = kind === 'js' ? JS_RULES : SHELL_RULES;
  return codeLines(kind, source).flatMap((line, index) => rules
    .filter((rule) => rule.pattern.test(line))
    .map((rule) => ({ file: relativePath, line: index + 1, message: `${VAR}: ${rule.message}` })));
}

function checkSources(entries) {
  return entries
    .filter(({ path: p }) => isScanned(p) && !(p in EXEMPTIONS))
    .flatMap(({ path: p, source }) => fileViolations(p, source));
}

function listFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return output.split('\0').filter(Boolean).sort();
}

function main(root = path.resolve(__dirname, '..', '..')) {
  const entries = listFiles(root).flatMap((p) => {
    if (!isScanned(p) || p in EXEMPTIONS) return [];
    const file = path.join(root, p);
    try {
      return fs.statSync(file).isFile() ? [{ path: p, source: fs.readFileSync(file, 'utf8') }] : [];
    } catch {
      return [];
    }
  });
  return { checked: entries.length, errors: checkSources(entries) };
}

if (require.main === module) {
  const result = main();
  for (const v of result.errors) console.error(`FAIL [validate-plugin-root-resolution]: ${v.file}:${v.line}: ${v.message}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log(`PASS [validate-plugin-root-resolution]: ${result.checked} files read no ${VAR} directly`);
}

module.exports = { checkSources, isScanned, main, EXEMPTIONS };
