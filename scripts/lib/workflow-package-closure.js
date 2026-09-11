'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_SCHEMA = 'dhpk.skill-package.v1';
const SAFE_RELATIVE = /^(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unavailable or invalid: ${error.message}`);
  }
}

function readSkillPackageManifest(root, skillId) {
  const filePath = path.join(root, 'skills', skillId, 'skill-package.json');
  return readJson(filePath, `skill package manifest '${skillId}'`);
}

function validateRelative(value, label) {
  return typeof value === 'string' && SAFE_RELATIVE.test(value) && !path.isAbsolute(value);
}

function parseVersion(value) {
  const match = typeof value === 'string' ? value.match(SEMVER) : null;
  return match ? {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  } : null;
}

function satisfiesVersion(version, range) {
  const actual = parseVersion(version);
  if (!actual || typeof range !== 'string' || range.trim() === '') return false;
  const normalized = range.trim();
  // Package dependency ranges intentionally accept stable releases only. A
  // prerelease must be explicitly promoted into the package contract instead
  // of being silently treated as satisfying a stable range.
  if (actual.prerelease || normalized.includes('-')) return false;
  const exact = parseVersion(normalized);
  if (exact) return actual.major === exact.major && actual.minor === exact.minor && actual.patch === exact.patch;
  const caret = normalized.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (!caret) return false;
  const lower = { major: Number(caret[1]), minor: Number(caret[2]), patch: Number(caret[3]) };
  if (actual.major !== lower.major) return false;
  if (lower.major === 0 && actual.minor !== lower.minor) return false;
  if (actual.minor < lower.minor) return false;
  return actual.minor !== lower.minor || actual.patch >= lower.patch;
}

function resolveSafeRuntimeSource(root, relative) {
  if (!validateRelative(relative, 'runtime asset source')) return { error: 'runtime asset source is unsafe' };
  let rootReal;
  try { rootReal = fs.realpathSync(root); } catch (_) { return { error: 'runtime asset source root is unavailable' }; }
  const candidate = path.resolve(rootReal, relative);
  const relativeToRoot = path.relative(rootReal, candidate);
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return { error: 'runtime asset source escapes the canonical root' };
  }
  let cursor = rootReal;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return { error: 'runtime asset source contains a symlink' };
    } catch (_) { return { error: 'runtime asset source is missing' }; }
  }
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return { error: 'runtime asset source must be a regular file' };
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(rootReal, realCandidate);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return { error: 'runtime asset source realpath escapes the canonical root' };
    }
  } catch (_) { return { error: 'runtime asset source is missing' }; }
  return { path: candidate };
}

function validateSkillPackageManifest(root, skillId, { manifest = null } = {}) {
  const errors = [];
  let candidate = manifest;
  if (!candidate) {
    try { candidate = readSkillPackageManifest(root, skillId); } catch (error) {
      return { ok: false, errors: [error.message] };
    }
  }
  if (!candidate || candidate.schema !== PACKAGE_SCHEMA) errors.push(`skill '${skillId}' has invalid package schema`);
  if (candidate && candidate.id !== skillId) errors.push(`skill package id must be '${skillId}'`);
  if (!candidate || typeof candidate.version !== 'string' || !SEMVER.test(candidate.version)) errors.push('skill package version must be SemVer');
  if (!candidate || !validateRelative(candidate.entry, 'entry')) errors.push('skill package entry must be a safe relative path');
  if (!Array.isArray(candidate && candidate.resources) || candidate.resources.length === 0) {
    errors.push('skill package resources must be a non-empty array');
  } else {
    const seen = new Set();
    for (const resource of candidate.resources) {
      if (!resource || !validateRelative(resource.path, 'resource.path')) errors.push('skill package resource path is unsafe');
      if (resource && seen.has(resource.path)) errors.push(`duplicate skill package resource '${resource.path}'`);
      if (resource) seen.add(resource.path);
      if (!resource || typeof resource.kind !== 'string' || resource.kind.trim() === '') errors.push('skill package resource kind is required');
      if (resource && resource.required === true && !fs.existsSync(path.join(root, 'skills', skillId, resource.path))) {
        errors.push(`required skill package resource is missing: ${resource.path}`);
      }
    }
  }
  if (candidate && candidate.requires !== undefined && !Array.isArray(candidate.requires)) errors.push('skill package requires must be an array');
  if (candidate && candidate.requires && Array.isArray(candidate.requires)) {
    for (const dependency of candidate.requires) {
      if (!dependency || !validateRelative(dependency.id, 'requires.id') || !TOKEN.test(dependency.id)) errors.push('skill package dependency id is unsafe');
      if (dependency && dependency.version !== undefined && (typeof dependency.version !== 'string' || dependency.version.trim() === '')) errors.push('skill package dependency version must be a non-empty string');
    }
  }
  if (candidate && candidate.runtimeAssets !== undefined && !Array.isArray(candidate.runtimeAssets)) errors.push('skill package runtimeAssets must be an array');
  if (candidate && Array.isArray(candidate.runtimeAssets)) {
    for (const asset of candidate.runtimeAssets) {
      if (!asset || !validateRelative(asset.source, 'runtime asset source') || !validateRelative(asset.destination, 'runtime asset destination')) {
        errors.push('skill package runtime asset paths are unsafe');
      } else if (asset.required !== undefined && typeof asset.required !== 'boolean') {
        errors.push('skill package runtime asset required must be boolean');
      } else {
        const sourceResult = resolveSafeRuntimeSource(root, asset.source);
        if (sourceResult.error && asset.required !== false) errors.push(`${sourceResult.error}: ${asset.source}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, manifest: candidate };
}

function runtimeAssetsForSkill(root, skillId) {
  const manifestPath = path.join(root, 'skills', skillId, 'skill-package.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = readSkillPackageManifest(root, skillId);
  const validation = validateSkillPackageManifest(root, skillId, { manifest });
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  const assets = Array.isArray(manifest.runtimeAssets) ? manifest.runtimeAssets : [];
  return assets.map((asset) => {
    if (!asset || !validateRelative(asset.source, 'runtime asset source') || !validateRelative(asset.destination, 'runtime asset destination')) {
      throw new Error(`skill '${skillId}' declares an unsafe runtime asset`);
    }
    const sourceResult = resolveSafeRuntimeSource(root, asset.source);
    if (sourceResult.error) {
      if (asset.required === false && sourceResult.error === 'runtime asset source is missing') return null;
      throw new Error(`${sourceResult.error}: ${asset.source}`);
    }
    const source = sourceResult.path;
    const skillRoot = path.resolve(root, 'skills', skillId);
    const destination = asset.destination.split('/').join(path.posix.sep);
    if (!fs.existsSync(source)) {
      if (asset.required === false) return null;
      throw new Error(`required runtime asset is missing: ${asset.source}`);
    }
    return { source, destination, required: asset.required !== false, skillRoot };
  }).filter(Boolean);
}

function resolveSkillPackageClosure(root, selectedEntries, { availableEntries = selectedEntries, surface = null } = {}) {
  const available = new Map((availableEntries || []).filter((entry) => entry && typeof entry.id === 'string').map((entry) => [entry.id, entry]));
  const requestedIds = new Set((selectedEntries || []).map((entry) => entry && entry.id).filter(Boolean));
  const state = new Map();
  const discovered = [];
  const visit = (entry, chain) => {
    if (!entry || typeof entry.id !== 'string') throw new Error('skill package closure contains an invalid entry');
    const status = state.get(entry.id);
    if (status === 'done') return;
    if (status === 'active') throw new Error(`skill package dependency cycle: ${[...chain, entry.id].join(' -> ')}`);
    state.set(entry.id, 'active');
    const manifestPath = path.join(root, entry.path || path.join('skills', entry.id), 'skill-package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = readJson(manifestPath, `skill package manifest '${entry.id}'`);
      const validation = validateSkillPackageManifest(root, entry.id, { manifest });
      if (!validation.ok) throw new Error(validation.errors.join('; '));
      for (const dependency of manifest.requires || []) {
        const dependencyEntry = available.get(dependency.id);
        if (!dependencyEntry) throw new Error(`skill package dependency '${dependency.id}' required by '${entry.id}' is missing`);
        const dependencyManifestPath = path.join(root, dependencyEntry.path || path.join('skills', dependencyEntry.id), 'skill-package.json');
        if (!fs.existsSync(dependencyManifestPath)) throw new Error(`skill package dependency '${dependency.id}' required by '${entry.id}' has no package manifest`);
        const dependencyManifest = readJson(dependencyManifestPath, `skill package manifest '${dependency.id}'`);
        const dependencyValidation = validateSkillPackageManifest(root, dependency.id, { manifest: dependencyManifest });
        if (!dependencyValidation.ok) throw new Error(dependencyValidation.errors.join('; '));
        if (dependency.version !== undefined && !satisfiesVersion(dependencyManifest.version, dependency.version)) {
          throw new Error(`skill package dependency '${dependency.id}' version '${dependencyManifest.version}' does not satisfy version range '${dependency.version}' required by '${entry.id}'`);
        }
        const publishedOnSurface = surface === 'claude-profile'
          ? Array.isArray(dependencyEntry.surfaces)
            && dependencyEntry.surfaces.some((candidate) => ['claude-profile', 'claude-core', 'claude-module'].includes(candidate))
          : !surface || (Array.isArray(dependencyEntry.surfaces) && dependencyEntry.surfaces.includes(surface));
        if (!publishedOnSurface && !requestedIds.has(dependency.id)) {
          throw new Error(`skill package dependency '${dependency.id}' required by '${entry.id}' is not published on '${surface}'`);
        }
        visit(dependencyEntry, [...chain, entry.id]);
      }
    }
    state.set(entry.id, 'done');
    discovered.push(entry);
  };
  const selected = [];
  const selectedIds = new Set();
  for (const entry of selectedEntries || []) {
    visit(entry, []);
    if (!selectedIds.has(entry.id)) {
      selectedIds.add(entry.id);
      selected.push(entry);
    }
  }
  return [...selected, ...discovered.filter((entry) => !selectedIds.has(entry.id))];
}

function skillPackageClosureReceipt(root, closureEntries) {
  return [...new Map((closureEntries || []).filter((entry) => entry && typeof entry.id === 'string').map((entry) => {
    const manifestPath = path.join(root, entry.path || path.join('skills', entry.id), 'skill-package.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath, `skill package manifest '${entry.id}'`);
    return [entry.id, { id: entry.id, version: manifest.version }];
  }).filter(Boolean)).values()].sort((left, right) => left.id.localeCompare(right.id));
}

module.exports = Object.freeze({
  PACKAGE_SCHEMA,
  readSkillPackageManifest,
  resolveSkillPackageClosure,
  skillPackageClosureReceipt,
  runtimeAssetsForSkill,
  validateSkillPackageManifest,
});
