'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL_ROOT = path.resolve(SKILL_ROOT, '..', '..');

function validRoot(root) {
  if (!root || !path.isAbsolute(root)) return false;
  return fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'))
    && fs.existsSync(path.join(root, 'scripts', 'lib'));
}

function canonicalSourceRoot(root) {
  return validRoot(root) && fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json'));
}

function candidateRoots() {
  return [
    process.env.DHPK_SOURCE_ROOT,
    process.env.PLUGIN_ROOT,
    canonicalSourceRoot(CANONICAL_ROOT) ? CANONICAL_ROOT : null,
  ].filter(validRoot);
}

function resolveRuntimeFile(name) {
  const local = path.join(__dirname, name);
  if (fs.existsSync(local)) return local;
  for (const root of candidateRoots()) {
    const candidate = path.join(root, 'scripts', 'lib', name);
    if (fs.existsSync(candidate)) return candidate;
  }
  const error = new Error(`workflow runtime resource '${name}' is unavailable; install the package closure or set DHPK_SOURCE_ROOT in development mode`);
  error.code = 'BLOCKED_RESOURCE_MISSING';
  throw error;
}

function loadRuntimeModule(name) {
  return require(resolveRuntimeFile(`${name}.js`));
}

function loadRuntimeJson(name) {
  return JSON.parse(fs.readFileSync(resolveRuntimeFile(name), 'utf8'));
}

module.exports = Object.freeze({ loadRuntimeJson, loadRuntimeModule, resolveRuntimeFile });
