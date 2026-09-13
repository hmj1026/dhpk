'use strict';

// Shared checks for the post-consolidation skill topology. The validator is
// deliberately filesystem-based and accepts a caller-supplied root so tests,
// release checks, and future migration tooling can inspect disposable trees
// without coupling the rules to this checkout.

const fs = require('node:fs');
const path = require('node:path');
const { extract } = require('../ci/_lib/frontmatter');

function asTopologyOptions(options, inventoryArg, extraOptions) {
  if (typeof options === 'string') {
    return { ...(extraOptions || {}), root: options, inventory: inventoryArg };
  }
  return options || {};
}

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function readDirectoryEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function walkSkillFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of readDirectoryEntries(dir)) {
    const filePath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...walkSkillFiles(filePath));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push(filePath);
    }
  }
  return files.sort();
}

function walkSymlinks(dir) {
  const links = [];
  if (!fs.existsSync(dir)) return links;

  for (const entry of readDirectoryEntries(dir)) {
    const filePath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(filePath);
    } else if (entry.isDirectory()) {
      links.push(...walkSymlinks(filePath));
    }
  }
  return links.sort();
}

function liveSkillByName(inventory) {
  const result = new Map();
  for (const entry of (inventory && Array.isArray(inventory.skills) ? inventory.skills : [])) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue;
    result.set(entry.name, entry);
  }
  return result;
}

function physicalSkillError(errors, entry, expectedDir) {
  const relative = `skills/${entry.name}`;
  let dirStat;
  try {
    dirStat = fs.lstatSync(expectedDir);
  } catch (_) {
    errors.push(`live capability ${entry.capability_id || entry.name} has fewer than one physical canonical SKILL.md: ${relative}/SKILL.md is missing`);
    return;
  }

  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    errors.push(`canonical package ${relative} must be a physical directory, not a symlink`);
    return;
  }

  const skillMd = path.join(expectedDir, 'SKILL.md');
  let skillStat;
  try {
    skillStat = fs.lstatSync(skillMd);
  } catch (_) {
    errors.push(`live capability ${entry.capability_id || entry.name} has fewer than one physical canonical SKILL.md: ${relative}/SKILL.md is missing`);
    return;
  }
  if (!skillStat.isFile() || skillStat.isSymbolicLink()) {
    errors.push(`canonical ${relative}/SKILL.md must be one physical file per live capability`);
    return;
  }

  let content;
  try {
    content = fs.readFileSync(skillMd, 'utf8');
  } catch (error) {
    errors.push(`cannot read canonical ${relative}/SKILL.md: ${error.message}`);
    return;
  }
  const frontmatter = extract(content);
  const frontmatterName = frontmatter.values && frontmatter.values.name;
  if (!frontmatter.present || !frontmatterName) {
    errors.push(`canonical ${relative}/SKILL.md frontmatter/name mismatch: expected name '${entry.name}'`);
  } else if (frontmatterName.replace(/^(['"])(.*)\1$/, '$2') !== entry.name) {
    errors.push(`canonical ${relative}/SKILL.md frontmatter/name mismatch: folder/inventory '${entry.name}' but frontmatter '${frontmatterName}'`);
  }
}

function validateProjectionLink({ root, linkPath, expectedEntry, kind, errors }) {
  const relativeLink = relativePosix(root, linkPath);
  let stat;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (_) {
    errors.push(`${kind} projection ${relativeLink} is missing`);
    return;
  }
  if (!stat.isSymbolicLink()) {
    errors.push(`${kind} projection ${relativeLink} must be a symlink to its canonical skill`);
    return;
  }

  let rawTarget;
  try {
    rawTarget = fs.readlinkSync(linkPath);
  } catch (error) {
    errors.push(`${kind} projection ${relativeLink} has an unreadable symlink target: ${error.message}`);
    return;
  }
  if (!rawTarget || path.isAbsolute(rawTarget) || /^[A-Za-z]:[\\/]/.test(rawTarget)) {
    errors.push(`${kind} projection ${relativeLink} uses an absolute symlink target; projections must use relative repository-contained targets`);
    return;
  }

  const resolvedTarget = path.resolve(path.dirname(linkPath), rawTarget);
  if (isOutside(root, resolvedTarget)) {
    errors.push(`${kind} projection ${relativeLink} points outside the repository: ${rawTarget}`);
    return;
  }
  if (!fs.existsSync(resolvedTarget)) {
    errors.push(`${kind} projection ${relativeLink} has a dangling symlink target: ${rawTarget}`);
    return;
  }

  const canonicalPath = expectedEntry && typeof expectedEntry.path === 'string'
    ? path.resolve(root, expectedEntry.path)
    : null;
  if (!canonicalPath || resolvedTarget !== canonicalPath) {
    const expected = canonicalPath ? relativePosix(root, canonicalPath) : '(no canonical inventory entry)';
    errors.push(`${kind} projection ${relativeLink} points to the wrong target: expected ${expected}, got ${relativePosix(root, resolvedTarget)}`);
  }
}

function validateProjectionRoot({ root, projectionRoot, kind, byName, errors }) {
  if (!fs.existsSync(projectionRoot)) return;
  for (const entry of readDirectoryEntries(projectionRoot)) {
    const entryPath = path.join(projectionRoot, entry.name);
    // Projection roots contain skill directories only. Unknown entries are
    // still checked so a stale or third-party package cannot silently become a
    // second canonical source.
    const expectedEntry = byName.get(entry.name);
    if (!expectedEntry) {
      errors.push(`${kind} projection ${relativePosix(root, entryPath)} has no canonical inventory entry`);
      if (!entry.isSymbolicLink()) {
        errors.push(`${kind} projection ${relativePosix(root, entryPath)} must be a symlink`);
      }
      continue;
    }
    validateProjectionLink({ root, linkPath: entryPath, expectedEntry, kind, errors });
  }
}

function validateSkillTopology(options, inventoryArg, extraOptions) {
  const { root, inventory, nativeRoots, nativePackageRoots } = asTopologyOptions(options, inventoryArg, extraOptions);
  const errors = [];
  if (typeof root !== 'string' || root.trim() === '') {
    return { ok: false, errors: ['topology root is required'] };
  }

  const repoRoot = path.resolve(root);
  const byName = liveSkillByName(inventory);
  const allSkills = inventory && Array.isArray(inventory.skills) ? inventory.skills : [];
  const liveCapabilities = new Map();

  for (const entry of allSkills) {
    if (!entry || typeof entry !== 'object') {
      errors.push('inventory skill entry is not an object');
      continue;
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      errors.push(`inventory skill ${entry.id || '<unknown>'} is missing a public name`);
      continue;
    }
    if (entry.lifecycle !== 'deprecated' && typeof entry.capability_id === 'string' && entry.capability_id.trim() !== '') {
      const prior = liveCapabilities.get(entry.capability_id);
      if (prior) {
        errors.push(`duplicate live capability_id '${entry.capability_id}' is claimed by ${prior} and ${entry.name}`);
      } else {
        liveCapabilities.set(entry.capability_id, entry.name);
      }
    }
    const expectedPath = `skills/${entry.name}`;
    if (entry.path !== expectedPath || !/^skills\/[^/]+$/.test(entry.path || '')) {
      errors.push(`canonical inventory path for ${entry.name} must be flat '${expectedPath}'; got '${entry.path}'`);
    }
    if (entry.lifecycle === 'deprecated') continue;
    physicalSkillError(errors, entry, path.join(repoRoot, 'skills', entry.name));
  }

  // Every physical SKILL.md beneath skills/ must be one of the inventory's
  // live canonical packages. This catches duplicate copies for one capability
  // as well as an untracked nested canonical source.
  const physicalCanonicalFiles = walkSkillFiles(path.join(repoRoot, 'skills'));
  const physicalByName = new Map();
  for (const skillMd of physicalCanonicalFiles) {
    const dirName = path.basename(path.dirname(skillMd));
    const list = physicalByName.get(dirName) || [];
    list.push(skillMd);
    physicalByName.set(dirName, list);
    const relativeFile = relativePosix(repoRoot, skillMd);
    const canonical = byName.get(dirName);
    if (!canonical || path.dirname(relativeFile) !== `skills/${dirName}`) {
      errors.push(`unexpected physical canonical SKILL.md for ${dirName}: ${relativeFile}`);
    }
  }
  for (const [name, files] of physicalByName.entries()) {
    const entry = byName.get(name);
    if (entry && files.length !== 1) {
      errors.push(`live capability ${entry.capability_id || name} has more than one physical canonical SKILL.md (${files.map((file) => relativePosix(repoRoot, file)).join(', ')})`);
    }
  }

  validateProjectionRoot({
    root: repoRoot,
    projectionRoot: path.join(repoRoot, 'codex', 'skills'),
    kind: 'codex/skills',
    byName,
    errors,
  });

  const modulesRoot = path.join(repoRoot, 'modules');
  for (const moduleEntry of readDirectoryEntries(modulesRoot)) {
    if (!moduleEntry.isDirectory() || moduleEntry.isSymbolicLink()) continue;
    validateProjectionRoot({
      root: repoRoot,
      projectionRoot: path.join(modulesRoot, moduleEntry.name, 'skills'),
      kind: `module ${moduleEntry.name}`,
      byName,
      errors,
    });
  }

  const configuredNativeRoots = nativeRoots || nativePackageRoots || ['plugins/dhpk'];
  const nativeRootList = Array.isArray(configuredNativeRoots)
    ? configuredNativeRoots
    : [configuredNativeRoots];
  for (const configuredRoot of nativeRootList) {
    const nativeRoot = path.resolve(repoRoot, configuredRoot);
    for (const link of walkSymlinks(nativeRoot)) {
      errors.push(`native package content contains a symlink: ${relativePosix(repoRoot, link)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateSkillTopology,
  validateTopology: validateSkillTopology,
};
