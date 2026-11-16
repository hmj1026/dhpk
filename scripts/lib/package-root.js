'use strict';

// Resolve the package that physically contains the executing script
// (docs/adr/0038-resolve-runtime-resources-from-the-owning-package.md).
// The root derives only from the script's own location. This module never
// reads process.env: CLAUDE_PLUGIN_ROOT (or any other variable) cannot select
// a root, and a missing required asset is an explicit failure with no
// fallback search.

const fs = require('node:fs');
const path = require('node:path');

function unresolved(message) {
  return new Error(`dhpk package root unresolved: ${message}`);
}

function resolveOwningPackageRoot({ fromDir, levelsUp, requiredAsset }) {
  if (typeof fromDir !== 'string' || fromDir === '') throw unresolved('fromDir is required');
  if (!Number.isInteger(levelsUp) || levelsUp < 0) throw unresolved('levelsUp must be a non-negative integer');
  if (typeof requiredAsset !== 'string' || requiredAsset === '') throw unresolved('requiredAsset is required');

  let physicalDir;
  try {
    physicalDir = fs.realpathSync(fromDir);
  } catch (cause) {
    throw unresolved(`cannot resolve ${fromDir}: ${cause.code || cause.message}`);
  }

  const root = path.resolve(physicalDir, ...Array(levelsUp).fill('..'));
  if (!fs.existsSync(path.join(root, requiredAsset))) {
    throw unresolved(`${root} is missing required asset ${requiredAsset}`);
  }
  return root;
}

module.exports = { resolveOwningPackageRoot };
