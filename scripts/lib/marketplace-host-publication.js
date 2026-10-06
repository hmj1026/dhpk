'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compileMarketplacePublicationView } = require('./marketplace-selection');
const { readFileBounded } = require('./bounded-filesystem');

const SELECTION_RELATIVE_PATH = 'manifests/marketplace-selection.json';

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readSelection(root) {
  let physicalRoot;
  try {
    physicalRoot = fs.realpathSync(root);
    if (!fs.statSync(physicalRoot).isDirectory()) throw new Error('root must be a directory');
  } catch (error) {
    throw new Error(`marketplace source root is unavailable: ${error.message}`);
  }

  const selectionPath = path.resolve(physicalRoot, ...SELECTION_RELATIVE_PATH.split('/'));
  if (!inside(physicalRoot, selectionPath)) throw new Error('marketplace selection path escapes the source root');
  let current = physicalRoot;
  for (const segment of SELECTION_RELATIVE_PATH.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw new Error(`marketplace selection cannot be inspected: ${error.message}`);
    }
    if (stat.isSymbolicLink()) throw new Error('marketplace selection path must not contain symlinks');
    if (current !== selectionPath && !stat.isDirectory()) throw new Error('marketplace selection parent must be a directory');
    if (current === selectionPath && !stat.isFile()) throw new Error('marketplace selection must be a regular file');
  }

  try {
    return JSON.parse(readFileBounded(selectionPath, { maxBytes: 4 * 1024 * 1024 }).toString('utf8'));
  } catch (error) {
    throw new Error(`marketplace selection is invalid JSON: ${error.message}`);
  }
}

function hasValues(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function isPlainCommonProfile(profileSelection) {
  if (!profileSelection) return true;
  return profileSelection.profileId === 'common'
    && profileSelection.selectionMode === 'profile'
    && !hasValues(profileSelection.overlayStableIds)
    && !hasValues(profileSelection.moduleClosure);
}

function sameUniqueIdSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return leftIds.size === left.length
    && rightIds.size === right.length
    && left.every((id) => rightIds.has(id));
}

function loadMarketplaceHostPublication({ root, inventory, hostSurface, profileSelection = null } = {}) {
  if (typeof hostSurface !== 'string' || hostSurface.length === 0) {
    throw new Error('marketplace host surface is required');
  }
  if (!isPlainCommonProfile(profileSelection)) return null;
  const selection = readSelection(root);
  if (selection === null) return null;
  // Many package-unit fixtures point at the repository root while supplying a
  // reduced inventory. The canonical publication manifest is only applicable
  // when the supplied inventory actually declares this host surface.
  if (!inventory || !Array.isArray(inventory.surfaces) || !inventory.surfaces.includes(hostSurface)) {
    if (inventory && inventory.schema === 'dhpk.distribution-inventory.v2') {
      throw new Error(`marketplace inventory v2 is missing host surface ${hostSurface}`);
    }
    return null;
  }
  const view = compileMarketplacePublicationView({ inventory, selection, hostSurface });
  if (view.errors.length > 0) {
    throw new Error(`marketplace publication selection is invalid: ${view.errors.join('; ')}`);
  }
  if (profileSelection) {
    const publicEntryIds = view.publicEntries.map((entry) => entry.id);
    if (!sameUniqueIdSet(profileSelection.selectedStableIds, publicEntryIds)) {
      throw new Error('common profile selection does not match marketplace public entries');
    }
  }
  return view;
}

module.exports = { loadMarketplaceHostPublication };
