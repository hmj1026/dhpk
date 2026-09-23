'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SAFE_RELATIVE = /^(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

function validateRelative(value) {
  return typeof value === 'string' && SAFE_RELATIVE.test(value) && !path.isAbsolute(value);
}

function inventoryEntryForId(root, id) {
  if (typeof id !== 'string' || id.trim() === '') return null;
  const manifestPath = path.join(root, 'manifests', 'distribution-inventory.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const inventory = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = Array.isArray(inventory && inventory.skills) ? inventory.skills : [];
    return entries.find((entry) => entry && entry.id === id) || null;
  } catch (_) {
    return null;
  }
}

function resolveSkillEntry(root, skillOrEntry, availableEntries = []) {
  const supplied = typeof skillOrEntry === 'string'
    ? { id: skillOrEntry }
    : skillOrEntry && typeof skillOrEntry === 'object' ? skillOrEntry : {};
  const id = supplied.id;
  const available = Array.isArray(availableEntries)
    ? availableEntries.find((entry) => entry && entry.id === id)
    : null;
  const inventory = available || inventoryEntryForId(root, id);
  return {
    ...(inventory || {}),
    ...supplied,
    ...(supplied.path || !inventory || !inventory.path ? {} : { path: inventory.path }),
  };
}

function resolveSafeSkillPath(root, entry, { availableEntries = [] } = {}) {
  const resolvedEntry = resolveSkillEntry(root, entry, availableEntries);
  const relative = resolvedEntry && (resolvedEntry.path || path.join('skills', resolvedEntry.id || ''));
  if (!validateRelative(relative, 'skill package path')) return { error: `skill package path is unsafe: ${relative || '<missing>'}` };
  let rootReal;
  try {
    rootReal = fs.realpathSync(root);
  } catch (_) {
    return { error: 'skill package source root is unavailable' };
  }
  const candidate = path.resolve(rootReal, relative);
  const relativeToRoot = path.relative(rootReal, candidate);
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    return { error: `skill package path escapes source root: ${relative}` };
  }
  let cursor = rootReal;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return { error: `skill package path contains a symlink: ${relative}` };
    } catch (error) {
      if (!error || error.code !== 'ENOENT') return { error: `skill package path is unavailable: ${relative}` };
      break;
    }
  }
  try {
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(rootReal, realCandidate);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return { error: `skill package path realpath escapes source root: ${relative}` };
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return { error: `skill package path is unavailable: ${relative}` };
  }
  return { path: candidate, relative, entry: resolvedEntry };
}

// Matches the ignore convention every publisher and installer fingerprint
// already uses, so a physical tree hashes identically on every surface.
const IGNORED_DIRECTORIES = new Set(['__pycache__']);
const TREE_LIMITS = Object.freeze({ maxDepth: 32, maxFiles: 4096, maxEntries: 16384 });

function isIgnoredTreeName(name, isDirectory) {
  if (isDirectory) return IGNORED_DIRECTORIES.has(name);
  return name.endsWith('.pyc');
}

// A published Skill is its complete canonical directory: every regular file
// beneath it except ignored runtime caches.  Symlinks anywhere in the tree fail
// closed so a package can never pull content from outside its Skill.
function physicalSkillTree(root, entry, { availableEntries = [] } = {}) {
  const skillPath = resolveSafeSkillPath(root, entry, { availableEntries });
  if (skillPath.error) throw new Error(skillPath.error);
  const label = (skillPath.entry && skillPath.entry.id) || skillPath.relative;
  let rootStat;
  try { rootStat = fs.lstatSync(skillPath.path); } catch (_) {
    throw new Error(`skill '${label}' directory is missing: ${skillPath.relative}`);
  }
  if (!rootStat.isDirectory()) throw new Error(`skill '${label}' path is not a directory: ${skillPath.relative}`);
  const entryStat = (() => { try { return fs.lstatSync(path.join(skillPath.path, 'SKILL.md')); } catch (_) { return null; } })();
  if (!entryStat || !entryStat.isFile()) throw new Error(`skill '${label}' has no regular SKILL.md entry`);
  const files = [];
  let entries = 0;
  const walk = (directory, relative, depth) => {
    if (depth > TREE_LIMITS.maxDepth) throw new Error(`skill '${label}' tree exceeds depth ${TREE_LIMITS.maxDepth}`);
    for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      entries += 1;
      if (entries > TREE_LIMITS.maxEntries) throw new Error(`skill '${label}' tree exceeds ${TREE_LIMITS.maxEntries} entries`);
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error(`skill '${label}' tree contains a symlink: ${childRelative}`);
      if (isIgnoredTreeName(child.name, child.isDirectory())) continue;
      if (child.isDirectory()) walk(absolute, childRelative, depth + 1);
      else if (child.isFile()) {
        files.push({ relative: childRelative, absolute });
        if (files.length > TREE_LIMITS.maxFiles) throw new Error(`skill '${label}' tree exceeds ${TREE_LIMITS.maxFiles} files`);
      } else {
        throw new Error(`skill '${label}' tree contains a non-regular entry: ${childRelative}`);
      }
    }
  };
  walk(skillPath.path, '', 0);
  return files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));
}

module.exports = Object.freeze({
  isIgnoredTreeName,
  physicalSkillTree,
  resolveSafeSkillPath,
});
