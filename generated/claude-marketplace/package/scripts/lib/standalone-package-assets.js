'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && !/^[A-Za-z]:[\\/]/.test(value)
    && path.posix.normalize(value) === value
    && value !== '.'
    && value !== '..'
    && !value.startsWith('../');
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readPhysicalFile(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error(`standalone dependency path is unsafe: ${relativePath}`);
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, ...relativePath.split('/'));
  if (!isInside(resolvedRoot, candidate)) throw new Error(`standalone dependency path escapes source root: ${relativePath}`);
  let cursor = resolvedRoot;
  for (const part of relativePath.split('/')) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`standalone dependency path contains a symlink: ${relativePath}`);
  }
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile()) throw new Error(`standalone dependency is not a regular file: ${relativePath}`);
  return { path: candidate, content: fs.readFileSync(candidate), mode: stat.mode & 0o7777 };
}

function collectStandalonePackageAssets({ root, inventory = {}, profileSelection = null } = {}) {
  if (!profileSelection || profileSelection.selectionMode !== 'standalone') return [];
  const closure = profileSelection.dependencyClosure || {};
  const assetsById = new Map((Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [])
    .filter((entry) => entry && typeof entry.id === 'string')
    .map((entry) => [entry.id, entry]));
  const declarations = [];
  for (const file of Array.isArray(closure.files) ? closure.files : []) {
    declarations.push({
      stableId: `standalone:dependency:${file.destination}`,
      source: file.source,
      destination: file.destination,
    });
  }
  for (const assetId of Array.isArray(closure.supportingAssetIds) ? closure.supportingAssetIds : []) {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error(`standalone supporting asset is not present in inventory: ${assetId}`);
    declarations.push({
      stableId: `standalone:supporting-asset:${assetId}`,
      source: asset.source,
      destination: asset.destination,
    });
  }
  const seenDestinations = new Set();
  return declarations.sort((left, right) => left.destination.localeCompare(right.destination)).map((declaration) => {
    if (!isSafeRelativePath(declaration.destination)) {
      throw new Error(`standalone dependency destination is unsafe: ${declaration.destination}`);
    }
    if (seenDestinations.has(declaration.destination)) {
      throw new Error(`standalone dependency destinations collide: ${declaration.destination}`);
    }
    seenDestinations.add(declaration.destination);
    const file = readPhysicalFile(root, declaration.source);
    return { ...declaration, path: file.path, content: file.content, mode: file.mode };
  });
}

module.exports = { collectStandalonePackageAssets };
