'use strict';

// Names the JS installer modules a packaged harness-setup Skill ships.
//
// A packaged Skill copy has no scripts/lib/ beside it, yet the Codex and Cursor
// project installer is a JS program of some twenty modules. The Skill carries
// those modules as readable source files at the same scripts/lib/ paths (see
// scripts/lib/marketplace-skill-content.js), not as one generated bundle. This
// module finds them: the static require() closure of the installer entry, which
// may use only relative modules and node: built-ins so nothing is looked up on
// the disk it runs on. Every module stays under MAX_MODULE_BYTES.

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENTRY = 'scripts/lib/install-adapters/codex-cli.js';
const MAX_MODULE_BYTES = 256 * 1024;

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const STATIC_REQUIRE = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const ANY_REQUIRE = /\brequire\s*(?:\.\s*resolve\s*)?\(/g;
const DYNAMIC_IMPORT = /(?<![.\w$])import\s*\(/;

// Replaces comments and string/template bodies by spaces so the scans below
// look at code only. Regex literals are not special-cased: the closure holds
// none that confuse a `require(` scan, and a false hit fails loudly.
function codeOnly(source) {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') { out += ' '; index += 1; }
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else if (char === '\'' || char === '"') {
      let j = index + 1;
      while (j < source.length && source[j] !== char && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      out += source[index] + ' '.repeat(Math.max(0, j - index - 1)) + (source[j] === char ? char : '');
      index = j + 1;
    } else if (char === '`') {
      let j = index + 1;
      while (j < source.length && source[j] !== '`') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(index, j + 1).replace(/[^\n]/g, ' ');
      index = j + 1;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

function resolveRelative(root, fromId, spec) {
  const base = path.posix.join(path.posix.dirname(fromId), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  throw new Error(`installer modules: ${fromId} requires ${spec}, which does not resolve inside the repository`);
}

// The module closure of `entry`: id (repo-relative POSIX path) -> source and
// the specifier -> id map of its relative requires.
function collectClosure(root, entry) {
  const modules = new Map();
  const visit = (id) => {
    if (modules.has(id)) return;
    const source = fs.readFileSync(path.join(root, id), 'utf8');
    const entryRecord = { id, source, deps: {} };
    modules.set(id, entryRecord);
    if (id.endsWith('.json')) return;
    const code = codeOnly(source);
    if (DYNAMIC_IMPORT.test(code)) throw new Error(`installer modules: ${id} uses dynamic import()`);
    const literal = new Set();
    for (const match of source.matchAll(STATIC_REQUIRE)) {
      // Only matches that survive in the comment/string-stripped text are calls.
      const offset = match.index;
      if (!/\brequire/.test(code.slice(offset, offset + 8))) continue;
      literal.add(offset);
      const spec = match[2];
      if (spec.startsWith('.')) {
        const dependency = resolveRelative(root, id, spec);
        entryRecord.deps[spec] = dependency;
        visit(dependency);
      } else if (!BUILTINS.has(spec.replace(/^node:/, ''))) {
        throw new Error(`installer modules: ${id} requires ${spec}; only relative modules and node: built-ins may be shipped`);
      }
    }
    for (const match of code.matchAll(ANY_REQUIRE)) {
      if (!literal.has(match.index)) throw new Error(`installer modules: ${id} has a require that is not a string literal (offset ${match.index})`);
    }
  };
  visit(entry);
  return [...modules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Ids (repo-relative POSIX paths) of every module the installer entry loads.
function installerModuleIds({ root = REPO_ROOT, entry = ENTRY } = {}) {
  return collectClosure(root, entry).map((record) => record.id);
}

module.exports = { ENTRY, REPO_ROOT, MAX_MODULE_BYTES, collectClosure, installerModuleIds, codeOnly };
