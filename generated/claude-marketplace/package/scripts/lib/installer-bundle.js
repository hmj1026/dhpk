'use strict';

// Builds the single-file JS installer a packaged harness-setup Skill runs.
//
// A packaged Skill copy has no scripts/lib/ beside it, yet the Codex and Cursor
// project installer is a JS program of some forty modules. Rather than copy
// those modules (and let a Skill artifact carry code the installer would
// execute), the closure of the installer entry is embedded in one generated
// CommonJS file: a module table plus a small require shim. The result is
// deterministic (modules in path order, no timestamps) and depends on node:
// built-ins only, so `node dhpk-installer.cjs` needs nothing else from disk.

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENTRY = 'scripts/lib/install-adapters/codex-cli.js';
const BUNDLE_RELATIVE = 'scripts/lib/dhpk-installer.cjs';

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
  throw new Error(`installer bundle: ${fromId} requires ${spec}, which does not resolve inside the repository`);
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
    if (DYNAMIC_IMPORT.test(code)) throw new Error(`installer bundle: ${id} uses dynamic import()`);
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
        throw new Error(`installer bundle: ${id} requires ${spec}; only relative modules and node: built-ins may be bundled`);
      }
    }
    for (const match of code.matchAll(ANY_REQUIRE)) {
      if (!literal.has(match.index)) throw new Error(`installer bundle: ${id} has a require that is not a string literal (offset ${match.index})`);
    }
  };
  visit(entry);
  return [...modules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function moduleEntry(record) {
  if (record.id.endsWith('.json')) {
    return `  ${JSON.stringify(record.id)}: [{}, null, ${JSON.stringify(JSON.stringify(JSON.parse(record.source)))}],`;
  }
  const body = record.source.replace(/^#!.*\n/, '\n');
  return `  ${JSON.stringify(record.id)}: [${JSON.stringify(record.deps)}, function (exports, require, module, __filename, __dirname) {\n${body}\n}],`;
}

const SHIM = `
const nodeRequire = require;
const { isBuiltin } = nodeRequire('node:module');
const cache = Object.create(null);
// A module's __dirname names where its source sat in the repository; nothing
// reads from it at run time. It is virtual so a bundle never points at a
// directory next to itself.
const VIRTUAL_ROOT = '/dhpk-installer-bundle';
const mainModule = { id: ENTRY, exports: {}, loaded: false };

function load(id) {
  if (cache[id]) return cache[id].exports;
  const [deps, factory, json] = MODULES[id];
  const module = id === ENTRY ? mainModule : { id, exports: {}, loaded: false };
  cache[id] = module;
  if (factory === null) {
    module.exports = JSON.parse(json);
  } else {
    // Anything the build did not map must be a Node built-in; the shim never
    // falls back to resolving a path or a package from the disk it runs on.
    const localRequire = (spec) => {
      if (Object.prototype.hasOwnProperty.call(deps, spec)) return load(deps[spec]);
      if (typeof spec === 'string' && isBuiltin(spec)) return nodeRequire(spec);
      throw new Error('installer bundle: ' + id + ' required ' + String(spec) + ', which is neither bundled nor a Node built-in');
    };
    localRequire.main = mainModule;
    const virtualFile = VIRTUAL_ROOT + '/' + id;
    factory.call(module.exports, module.exports, localRequire, module, virtualFile, virtualFile.slice(0, virtualFile.lastIndexOf('/')));
  }
  module.loaded = true;
  return module.exports;
}

load(ENTRY);
`;

function buildInstallerBundle({ root = REPO_ROOT, entry = ENTRY } = {}) {
  const closure = collectClosure(root, entry);
  const lines = [
    '#!/usr/bin/env node',
    '\'use strict\';',
    '',
    '// GENERATED by scripts/lib/installer-bundle.js from the modules listed in',
    '// MODULES, and written into packages by scripts/lib/marketplace-skill-content.js.',
    '// Do not edit; change a module and run `npm run gen:marketplace`. It is the whole',
    '// JS Codex/Cursor project installer, so a packaged harness-setup Skill runs it',
    '// without copying scripts/lib/ beside itself.',
    '',
    `const ENTRY = ${JSON.stringify(entry)};`,
    'const MODULES = {',
    ...closure.map(moduleEntry),
    '};',
    SHIM.trimEnd(),
    '',
  ];
  return lines.join('\n');
}

module.exports = { ENTRY, BUNDLE_RELATIVE, REPO_ROOT, buildInstallerBundle, collectClosure, codeOnly };
