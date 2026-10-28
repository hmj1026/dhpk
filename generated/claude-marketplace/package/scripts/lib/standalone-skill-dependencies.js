'use strict';

const path = require('node:path');

function safeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new Error(`${label} must be a safe relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

function resolveStandaloneSkillDependencies(inventory, skillName, sourceRoot) {
  const declaration = inventory && inventory.standalone_dependencies
    && inventory.standalone_dependencies[skillName];
  const files = declaration ? declaration.files : [];
  if (!Array.isArray(files)) throw new Error(`invalid standalone dependencies for '${skillName}'`);
  const root = path.resolve(sourceRoot);
  const destinations = new Set();
  return files.map((file) => {
    if (!file || typeof file.source !== 'string' || typeof file.destination !== 'string') {
      throw new Error(`invalid standalone dependency declaration for '${skillName}'`);
    }
    const source = safeRelative(file.source, `${skillName} standalone dependency source`);
    const destination = safeRelative(file.destination, `${skillName} standalone dependency destination`);
    const absolute = path.resolve(root, source);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error(`standalone dependency source escapes source root: ${source}`);
    }
    if (destinations.has(destination)) throw new Error(`duplicate standalone dependency destination: ${destination}`);
    destinations.add(destination);
    return {
      source,
      destination,
      relative: `references/_dependencies/${destination}`,
      absolute,
    };
  }).sort((left, right) => left.destination.localeCompare(right.destination));
}

module.exports = { resolveStandaloneSkillDependencies };
