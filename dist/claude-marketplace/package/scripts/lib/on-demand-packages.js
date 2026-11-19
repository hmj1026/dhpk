'use strict';

// Host packages that are built on demand instead of being committed: the
// Agent Plugin, Cursor Plugin and AGY Plugin (ADR 0040). They are built into a
// gitignored directory, archived, and attached to the GitHub Release by the
// release workflow. Only the Published Packages stay committed.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ON_DEMAND_ROOT = 'dist/on-demand';
const ON_DEMAND_PACKAGES = Object.freeze({
  'agent-plugin': Object.freeze({ name: 'dhpk-agent' }),
  'cursor-plugin': Object.freeze({ name: 'dhpk-cursor' }),
  'agy-plugin': Object.freeze({ name: 'dhpk-agy' }),
});
const ON_DEMAND_SURFACES = Object.freeze(Object.keys(ON_DEMAND_PACKAGES));

function isOnDemandSurface(surface) {
  return Object.prototype.hasOwnProperty.call(ON_DEMAND_PACKAGES, surface);
}

function onDemandPackageName(surface) {
  if (!isOnDemandSurface(surface)) throw new Error(`'${surface}' is not an on-demand package surface`);
  return ON_DEMAND_PACKAGES[surface].name;
}

// Repository-relative default output of `distribution build <surface>`.
function onDemandRelativeDir(surface) {
  return `${ON_DEMAND_ROOT}/${onDemandPackageName(surface)}`;
}

function onDemandPackageDir(root, surface) {
  return path.join(root, ...onDemandRelativeDir(surface).split('/'));
}

function onDemandArchiveName(surface, version) {
  return `${onDemandPackageName(surface)}-${version}.tar.gz`;
}

// Writes <parent>/<name>-<version>.tar.gz holding the package directory under
// its own name, so extracting beside a sibling package reproduces the layout
// the Cursor package expects (`../dhpk-agent`).
function archiveOnDemandPackage({ surface, packageDir, version }) {
  const archivePath = path.join(path.dirname(packageDir), onDemandArchiveName(surface, version));
  fs.rmSync(archivePath, { force: true });
  const result = spawnSync('tar', ['-czf', archivePath, '-C', path.dirname(packageDir), path.basename(packageDir)], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`archive failed: ${String(result.stderr || result.error || 'tar exited non-zero').trim()}`);
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  return { archivePath, sha256 };
}

module.exports = {
  ON_DEMAND_ROOT,
  ON_DEMAND_SURFACES,
  isOnDemandSurface,
  onDemandPackageName,
  onDemandRelativeDir,
  onDemandPackageDir,
  onDemandArchiveName,
  archiveOnDemandPackage,
};
