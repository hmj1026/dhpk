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
const { compileDistribution, materializeDistribution } = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const { sha256Hex } = require('./content-fingerprint');
const {
  externalSkillPackagesFingerprint,
  resolveInventoryRevision,
  skillProjectionMetadata,
} = require('./distribution-projection-contract');

const GENERATOR_VERSION = '1.0.0';
const SURFACE = 'cursor-sync';
const OWNED_SUBDIRECTORIES = Object.freeze(['skills', 'agents', 'rules', 'commands', 'dhpk']);
const NATIVE_SUBDIRECTORIES = Object.freeze(['agents', 'rules', 'commands', 'dhpk']);
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

function skillGroup({ inventory, root, outDir }) {
  const skillsDir = path.join(outDir, 'skills');
  const links = [];
  for (const skill of selectCursorSyncSkills(inventory)) {
    const publicName = skill.name || skill.id;
    const sourceDir = path.resolve(root, skill.path);
    if (!fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
      throw new Error('cursor-sync skill is missing SKILL.md: ' + skill.path);
    }
    confinedChild(skillsDir, publicName);
    links.push({
      id: skill.id,
      name: publicName,
      destination: publicName,
      source: skill.path,
      target: relativePosix(skillsDir, sourceDir),
    });
  }
  return { name: 'skills', files: [], links, report: { links } };
}

function documentGroup({ root, kind }) {
  const sourceDir = path.join(root, kind);
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
    files.push({ destination: destName, source: kind + '/' + basename, content: adapted.content });
    transformations.push({ source: basename, destination: kind + '/' + destName, transform: adapted.transform });
  }
  return {
    name: kind,
    files,
    links: [],
    report: { files: files.map((file) => kind + '/' + file.destination), transformations },
  };
}

function supportingAssetGroup({ inventory, root }) {
  const files = [];
  for (const asset of dhpkSupportingAssets(inventory)) {
    const source = path.resolve(root, ...String(asset.source).split('/'));
    if (!fs.existsSync(source)) {
      throw new Error('cursor-sync supporting asset source is missing: ' + asset.source);
    }
    if (String(asset.destination) === 'dhpk' || !String(asset.destination).startsWith('dhpk/')) {
      throw new Error('cursor-sync supporting asset destination escapes dhpk/: ' + asset.destination);
    }
    const buffer = fs.readFileSync(source);
    let output = buffer;
    if (!buffer.includes(0)) {
      const text = buffer.toString('utf8');
      const rewritten = rewriteCursorSupportingAssetBody(text);
      if (rewritten !== text) output = Buffer.from(rewritten);
    }
    files.push({ destination: String(asset.destination).slice('dhpk/'.length), source: String(asset.source), content: output });
  }
  return { name: 'dhpk', files, links: [], report: { files: files.map((file) => 'dhpk/' + file.destination) } };
}

// A subdirectory is owned only when the inventory declares it as a cursor-sync
// output destination: `cursor/skills/` for the skill mirrors, and either its own
// `cursor/<sub>/` or the `cursor/` overlay for the native components.
function declaredSubdirectories(inventory) {
  const matrix = inventory && inventory.platform_matrix;
  const entries = matrix && Array.isArray(matrix.entries) ? matrix.entries : [];
  const declared = new Set();
  for (const entry of entries) {
    if (!entry || entry.surface !== SURFACE || typeof entry.destination !== 'string') continue;
    const destination = entry.destination.replace(/\/+$/, '');
    if (destination === 'cursor') NATIVE_SUBDIRECTORIES.forEach((name) => declared.add(name));
    else if (destination.startsWith('cursor/') && OWNED_SUBDIRECTORIES.includes(destination.slice('cursor/'.length))) {
      declared.add(destination.slice('cursor/'.length));
    }
  }
  return declared;
}

function cursorSyncOwnership(inventory, name) {
  return {
    verify: () => (declaredSubdirectories(inventory).has(name)
      ? { ok: true }
      : { ok: false, code: 'UNDECLARED_DESTINATION', message: 'cursor/' + name + ' is not a declared cursor-sync output destination' }),
  };
}

// Same gate the store applies at activation, run for every subdirectory before
// the first one is replaced, so a refusal cannot leave a partial update behind.
function preflightOwnership({ inventory, outDir, names }) {
  for (const name of names) {
    const existing = path.join(outDir, name);
    let stat;
    try { stat = fs.lstatSync(existing); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('OWNERSHIP_REFUSED: cursor/' + name + ' is not a physical directory');
    }
    if (fs.readdirSync(existing).length === 0) continue;
    const verdict = cursorSyncOwnership(inventory, name).verify(existing);
    if (!verdict.ok) throw new Error('OWNERSHIP_REFUSED: ' + verdict.message);
  }
}

function validateDocumentFile(kind, name, full, errors) {
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

function validateGroupStage(group, stageRoot) {
  const errors = [];
  if (group.name === 'skills') {
    for (const entry of fs.readdirSync(stageRoot)) {
      const full = path.join(stageRoot, entry);
      if (!fs.lstatSync(full).isSymbolicLink()) errors.push('cursor/skills/' + entry + ' must be a relative symlink');
      else if (path.isAbsolute(fs.readlinkSync(full))) errors.push('cursor/skills/' + entry + ' target is absolute');
    }
  } else if (group.name === 'dhpk') {
    for (const file of group.files) {
      const content = fs.readFileSync(path.join(stageRoot, ...file.destination.split('/')), 'utf8');
      if (retainsClaudePluginRoot(content)) errors.push('cursor/dhpk/' + file.destination + ' retains Claude plugin-root interpolation');
      if (retainsCodexSupportRoot(content)) errors.push('cursor/dhpk/' + file.destination + ' retains Codex support-root paths');
    }
  } else {
    for (const name of fs.readdirSync(stageRoot)) {
      validateDocumentFile(group.name, name, path.join(stageRoot, name), errors);
    }
  }
  if (errors.length > 0) throw new Error('generated cursor/' + group.name + ' failed validation: ' + errors.join('; '));
}

function compileGroup(group, { inventory, outDir, inventoryRevision, ownershipFingerprint }) {
  const entries = [
    ...group.files.map((file) => ({
      stableId: SURFACE + ':' + group.name + '/' + file.destination,
      source: file.source,
      destination: file.destination,
      owner: 'plugins/dhpk-agent',
      transform: { id: 'cursor-sync-render', version: GENERATOR_VERSION },
      expectedFingerprint: sha256Hex(file.content),
      symlinkPolicy: 'forbid',
    })),
    ...group.links.map((link) => ({
      stableId: SURFACE + ':' + group.name + '/' + link.destination,
      source: link.source,
      destination: link.destination,
      owner: 'plugins/dhpk-agent',
      transform: { id: 'declared-source-relative-symlink', version: GENERATOR_VERSION },
      symlinkPolicy: 'declared-source-relative',
      symlinkTarget: link.target,
    })),
  ];
  const compiled = compileDistribution({
    internalCharacterization: true,
    surface: SURFACE,
    compilerVersion: 'cursor-sync-' + GENERATOR_VERSION,
    inventoryRevision,
    ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    ownershipRoot: 'cursor/' + group.name,
    entries,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  const adapter = {
    identity: { id: SURFACE, version: GENERATOR_VERSION },
    render: () => ({
      adapter: { id: SURFACE, version: GENERATOR_VERSION },
      outputs: group.files.map((file) => ({
        stableId: SURFACE + ':' + group.name + '/' + file.destination,
        destination: file.destination,
        content: file.content,
      })),
      links: group.links.map((link) => ({
        stableId: SURFACE + ':' + group.name + '/' + link.destination,
        destination: link.destination,
        target: link.target,
      })),
    }),
    validate: (rendered, context) => {
      if (context && context.session && context.session.stageRoot) validateGroupStage(group, context.session.stageRoot);
      return rendered;
    },
  };
  return {
    name: group.name,
    publishRoot: path.join(outDir, group.name),
    plan: compiled.value,
    adapter,
    ownership: cursorSyncOwnership(inventory, group.name),
    report: group.report,
  };
}

function compileCursorSyncProjection({ inventory, root, outDir }) {
  if (!inventory || typeof inventory !== 'object') throw new Error('cursor-sync inventory is required');
  if (!root || !outDir) throw new Error('cursor-sync root and outDir are required');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  assertProjectionDestination(resolvedRoot, resolvedOut);
  const inventoryRevision = resolveInventoryRevision(inventory);
  const ownershipFingerprint = Object.prototype.hasOwnProperty.call(inventory, 'external_skill_packages')
    ? externalSkillPackagesFingerprint(inventory.external_skill_packages)
    : undefined;
  const context = { inventory, outDir: resolvedOut, inventoryRevision, ownershipFingerprint };
  const groups = [
    skillGroup({ inventory, root: resolvedRoot, outDir: resolvedOut }),
    documentGroup({ root: resolvedRoot, kind: 'agents' }),
    documentGroup({ root: resolvedRoot, kind: 'rules' }),
    documentGroup({ root: resolvedRoot, kind: 'commands' }),
    supportingAssetGroup({ inventory, root: resolvedRoot }),
  ].map((group) => compileGroup(group, context));
  return { groups, root: resolvedRoot, outDir: resolvedOut, inventoryRevision, ownershipFingerprint };
}

function materializeCursorSyncTree({ inventory, root, outDir }) {
  const compiled = compileCursorSyncProjection({ inventory, root, outDir });
  const { groups, outDir: resolvedOut, root: resolvedRoot } = compiled;
  preflightOwnership({ inventory, outDir: resolvedOut, names: groups.map((group) => group.name) });
  fs.mkdirSync(resolvedOut, { recursive: true });
  // One store session per owned subdirectory; cursor/AGENTS.md and
  // cursor/guidance.md are siblings of the publish roots and never touched.
  for (const group of groups) {
    const store = new ProjectionArtifactStore({
      root: resolvedOut,
      sourceRoot: resolvedRoot,
      publishRoot: group.publishRoot,
      ownership: group.ownership,
    });
    const artifact = materializeDistribution(group.plan, group.adapter, store);
    if (!artifact.ok) throw new Error('cursor-sync ' + group.name + ' projection failed: ' + artifact.error.message);
  }
  const byName = Object.fromEntries(groups.map((group) => [group.name, group.report]));
  const selectedSkills = selectCursorSyncSkills(inventory);
  const { inventoryRevision, ownershipFingerprint } = compiled;
  const usageEntries = selectedSkills.filter((skill) => skill && skill.usage).map((skill) => {
    const metadata = skillProjectionMetadata(skill, {
      owner: 'plugins/dhpk-agent',
      inventoryRevision,
      ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    });
    return {
      id: skill.id,
      name: skill.name || skill.id,
      usage: metadata.usage,
      usageFingerprint: metadata.usageFingerprint,
      provenance: metadata.provenance,
    };
  });
  return {
    generatorVersion: GENERATOR_VERSION,
    skills: byName.skills.links.map((link) => ({ id: link.id, name: link.name, target: link.target })),
    agents: byName.agents.files,
    rules: byName.rules.files,
    commands: byName.commands.files,
    supporting: byName.dhpk.files,
    inventoryRevision,
    ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    usageSchema: 'dhpk.skill-usage.v1',
    usage: Object.fromEntries(usageEntries.map((entry) => [entry.id, entry.usage])),
    usageFingerprints: Object.fromEntries(usageEntries.map((entry) => [entry.id, entry.usageFingerprint])),
    provenance: Object.fromEntries(usageEntries.map((entry) => [entry.id, entry.provenance])),
    transformations: [
      ...byName.agents.transformations,
      ...byName.rules.transformations,
      ...byName.commands.transformations,
    ],
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
      validateDocumentFile(kind, name, full, errors);
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
  compileCursorSyncProjection,
  materializeCursorSyncTree,
  validateCursorSyncTree,
  // Host Adapter contract name for validateCursorSyncTree.
  verifyCursorSyncTree: validateCursorSyncTree,
};
