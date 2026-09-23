'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '..', '..');
const EXECUTION_BUNDLE_ROOT = path.join(SKILL_ROOT, 'references', 'execution-bundle');

function assertLocalResourceName(name) {
  if (typeof name !== 'string' || name.trim() === '' || path.isAbsolute(name)
    || path.win32.isAbsolute(name) || name.includes('\0')
    || name.split(/[\\/]/).includes('..')) {
    throw new TypeError(`workflow runtime resource '${name}' must be a Skill-local relative path`);
  }
  return name;
}

function isContainedPath(candidate, root) {
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

function resolveRuntimeFile(name) {
  const resourceName = assertLocalResourceName(name);
  const candidates = [
    path.join(__dirname, resourceName),
    path.join(EXECUTION_BUNDLE_ROOT, 'scripts', 'lib', resourceName),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate)
    && isContainedPath(candidate, candidate.startsWith(EXECUTION_BUNDLE_ROOT)
      ? EXECUTION_BUNDLE_ROOT
      : SKILL_ROOT));
  if (resolved) return resolved;
  const error = new Error(`workflow runtime resource '${resourceName}' is unavailable in the selected Skill directory`);
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
