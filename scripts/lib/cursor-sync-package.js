'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  adaptNativeDocument,
  parseFrontmatter,
  COMPONENT_EXTENSIONS,
} = require('./cursor-plugin-package');
const { selectPortableSkills } = require('./agent-plugin-package');
const {
  cursorDocumentDestinationName,
  retainsClaudePluginRoot,
  retainsCodexSupportRoot,
  rewriteCursorSupportingAssetBody,
} = require('./cursor-harness-adapt');
const { readDirectoryEntries } = require('./bounded-filesystem');

const GENERATOR_VERSION = '1.0.0';
const INDEX_NAMES = /^(?:INDEX|README)\./i;
const CANONICAL_SOURCE_TREES = Object.freeze([
  'skills', 'rules', 'agents', 'commands', 'hooks', 'modules', 'scripts', 'docs', 'manifests',
]);

function listComponentFiles(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  return readDirectoryEntries(directory)
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !INDEX_NAMES.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function confinedChild(parent, name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('cursor-sync output path is unsafe: ' + name);
  }
  const child = path.resolve(parent, name);
  if (path.dirname(child) !== path.resolve(parent) || !isInside(parent, child)) {
    throw new Error('cursor-sync output path escapes its parent: ' + name);
  }
  return child;
}

function assertProjectionDestination(root, outDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  if (resolvedRoot === resolvedOut || isInside(resolvedOut, resolvedRoot)) {
    throw new Error('cursor-sync output must not be the canonical root or its ancestor: ' + resolvedOut);
  }
  for (const source of CANONICAL_SOURCE_TREES) {
    if (isInside(path.join(resolvedRoot, source), resolvedOut)) {
      throw new Error('cursor-sync output overlaps canonical source tree: ' + resolvedOut);
    }
  }
}

function ensureCleanDirectory(outDir, name) {
  const directory = confinedChild(outDir, name);
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function hasDeclaredCursorSyncMembership(inventory) {
  const membership = inventory && inventory.surface_membership;
  return Boolean(membership && Object.prototype.hasOwnProperty.call(membership, 'cursor-sync'));
}

function selectCursorSyncSkills(inventory) {
  const selected = selectPortableSkills(inventory, 'cursor-sync');
  if (hasDeclaredCursorSyncMembership(inventory) || selected.length > 0) return selected;
  return selectPortableSkills(inventory, 'agent-plugin');
}

function dhpkSupportingAssets(inventory) {
  const entries = inventory && Array.isArray(inventory.supporting_assets) ? inventory.supporting_assets : [];
  return entries.filter((entry) => {
    const destination = entry && entry.destination;
    return typeof destination === 'string' && (destination === 'dhpk' || destination.startsWith('dhpk/'));
  });
}

function generateCursorSkillSymlinks({ inventory, root, outDir }) {
  const skillsDir = ensureCleanDirectory(outDir, 'skills');
  const links = [];
  for (const skill of selectCursorSyncSkills(inventory)) {
    const publicName = skill.name || skill.id;
    const sourceDir = path.resolve(root, skill.path);
    if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
      throw new Error('cursor-sync skill is missing SKILL.md: ' + skill.path);
    }
    const destination = path.join(skillsDir, publicName);
    const target = relativePosix(skillsDir, sourceDir);
    fs.symlinkSync(target, destination);
    links.push({ id: skill.id, name: publicName, target });
  }
  return links;
}

function generateCursorDocuments({ root, outDir, kind }) {
  const sourceDir = path.join(root, kind);
  const destinationDir = ensureCleanDirectory(outDir, kind);
  const files = [];
  const transformations = [];
  for (const source of listComponentFiles(sourceDir, COMPONENT_EXTENSIONS[kind])) {
    const basename = path.basename(source);
    const adapted = adaptNativeDocument(fs.readFileSync(source, 'utf8'), kind, basename, source, root);
    if (!adapted.ok) {
      transformations.push({ source: basename, destination: null, transform: 'SKIP_INCOMPATIBLE: ' + adapted.reason });
      continue;
    }
    const destName = cursorDocumentDestinationName(kind, basename);
    const destination = path.join(destinationDir, destName);
    fs.writeFileSync(destination, adapted.content);
    files.push(relativePosix(outDir, destination));
    transformations.push({ source: basename, destination: kind + '/' + destName, transform: adapted.transform });
  }
  return { files, transformations };
}

function generateCursorSupportingAssets({ inventory, root, outDir }) {
  const destRoot = ensureCleanDirectory(outDir, 'dhpk');
  const files = [];
  for (const asset of dhpkSupportingAssets(inventory)) {
    const source = path.resolve(root, ...String(asset.source).split('/'));
    const destination = path.resolve(outDir, ...String(asset.destination).split('/'));
    if (!fs.existsSync(source)) {
      throw new Error('cursor-sync supporting asset source is missing: ' + asset.source);
    }
    if (!isInside(destRoot, destination) && destination !== destRoot) {
      throw new Error('cursor-sync supporting asset destination escapes dhpk/: ' + asset.destination);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const buffer = fs.readFileSync(source);
    let output = buffer;
    if (!buffer.includes(0)) {
      const text = buffer.toString('utf8');
      const rewritten = rewriteCursorSupportingAssetBody(text);
      if (rewritten !== text) output = Buffer.from(rewritten);
    }
    fs.writeFileSync(destination, output);
    files.push(relativePosix(outDir, destination));
  }
  return files;
}

function materializeCursorSyncTree({ inventory, root, outDir }) {
  if (!inventory || typeof inventory !== 'object') throw new Error('cursor-sync inventory is required');
  if (!root || !outDir) throw new Error('cursor-sync root and outDir are required');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  assertProjectionDestination(resolvedRoot, resolvedOut);
  fs.mkdirSync(resolvedOut, { recursive: true });
  const skills = generateCursorSkillSymlinks({ inventory, root: resolvedRoot, outDir: resolvedOut });
  const agents = generateCursorDocuments({ root: resolvedRoot, outDir: resolvedOut, kind: 'agents' });
  const rules = generateCursorDocuments({ root: resolvedRoot, outDir: resolvedOut, kind: 'rules' });
  const commands = generateCursorDocuments({ root: resolvedRoot, outDir: resolvedOut, kind: 'commands' });
  const supporting = generateCursorSupportingAssets({ inventory, root: resolvedRoot, outDir: resolvedOut });
  return {
    generatorVersion: GENERATOR_VERSION,
    skills,
    agents: agents.files,
    rules: rules.files,
    commands: commands.files,
    supporting,
    transformations: [...agents.transformations, ...rules.transformations, ...commands.transformations],
  };
}

function validateCursorSyncTree({ root, outDir, inventory }) {
  const errors = [];
  const skillsDir = path.join(outDir, 'skills');
  if (!fs.existsSync(skillsDir)) {
    errors.push('cursor/skills is missing');
    return { ok: false, errors };
  }
  const expected = new Set(selectCursorSyncSkills(inventory).map((skill) => skill.name || skill.id));
  for (const entry of fs.readdirSync(skillsDir)) {
    const full = path.join(skillsDir, entry);
    const stat = fs.lstatSync(full);
    if (!stat.isSymbolicLink()) {
      errors.push('cursor/skills/' + entry + ' must be a relative symlink');
      continue;
    }
    const target = fs.readlinkSync(full);
    if (path.isAbsolute(target)) errors.push('cursor/skills/' + entry + ' target is absolute');
    let real;
    try { real = fs.realpathSync(full); } catch (_) {
      errors.push('cursor/skills/' + entry + ' is a broken symlink');
      continue;
    }
    const canonical = path.join(root, 'skills', entry);
    if (fs.existsSync(canonical) && real !== fs.realpathSync(canonical)) {
      errors.push('cursor/skills/' + entry + ' does not resolve to skills/' + entry);
    }
    expected.delete(entry);
  }
  for (const missing of [...expected].sort()) {
    errors.push('cursor-sync skill mirror is missing: cursor/skills/' + missing);
  }
  for (const kind of ['agents', 'rules', 'commands']) {
    const directory = path.join(outDir, kind);
    if (!fs.existsSync(directory)) {
      errors.push('cursor/' + kind + ' is missing');
      continue;
    }
    for (const name of fs.readdirSync(directory)) {
      const full = path.join(directory, name);
      if (!fs.statSync(full).isFile()) continue;
      if (kind === 'rules' && !name.endsWith('.mdc')) {
        errors.push('cursor/rules/' + name + ' must use the .mdc extension');
      }
      const content = fs.readFileSync(full, 'utf8');
      if (retainsClaudePluginRoot(content)) {
        errors.push('cursor/' + kind + '/' + name + ' retains Claude plugin-root interpolation');
      }
      if (retainsCodexSupportRoot(content)) {
        errors.push('cursor/' + kind + '/' + name + ' retains Codex support-root paths');
      }
      const parsed = parseFrontmatter(content);
      if (!parsed.present || !parsed.fields.name || !parsed.fields.description) {
        errors.push('cursor/' + kind + '/' + name + ' is missing Cursor frontmatter');
      }
      if (kind === 'rules' && parsed.fields.alwaysApply !== true && !['true', 'false'].includes(String(parsed.fields.alwaysApply).toLowerCase())) {
        errors.push('cursor/rules/' + name + ' must declare boolean alwaysApply');
      }
    }
  }
  for (const asset of dhpkSupportingAssets(inventory)) {
    const full = path.join(outDir, ...String(asset.destination).split('/'));
    if (!fs.existsSync(full)) {
      errors.push('cursor/' + asset.destination + ' supporting asset is missing');
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    if (retainsClaudePluginRoot(content)) {
      errors.push('cursor/' + asset.destination + ' retains Claude plugin-root interpolation');
    }
    if (retainsCodexSupportRoot(content)) {
      errors.push('cursor/' + asset.destination + ' retains Codex support-root paths');
    }
  }
  if (fs.existsSync(path.join(outDir, 'hooks.json')) || fs.existsSync(path.join(outDir, 'hooks'))) {
    errors.push('cursor/ must not ship native hooks.json in v1');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  GENERATOR_VERSION,
  selectCursorSyncSkills,
  materializeCursorSyncTree,
  validateCursorSyncTree,
};
