'use strict';

// Physical Codex native release-package generation and validation
// (make-codex-plugin-distribution-install-safe). Distinct from
// scripts/lib/distribution-inventory.js's Claude-surface generation: a native
// Codex package must contain exactly the non-deprecated skills whose
// distribution-inventory `surfaces` explicitly include `codex-native` — not
// every `promoted` skill — as real files (no symlinks), with a manifest
// `skills` field that resolves inside the package directory (no
// parent-relative escape). These are the two concrete failure shapes behind
// GitHub issue #88, plus the native/promoted membership mismatch that issue
// #88's follow-up change fixes.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RECEIPT_SCHEMA, SURFACE_OWNERS, resolveGeneratedFromTree } = require('./platform-provenance');
const {
  externalSkillPackagesFingerprint,
  resolveInventoryRevision,
  skillProjectionMetadata,
} = require('./distribution-projection-contract');
const {
  compileDistribution,
  materializeDistribution,
  verifyDistribution,
} = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('./bounded-filesystem');
const { bindSurfaceSelection } = require('./capability-bundle-selection');
const { runtimeSupportSkillIds } = require('./internal-runtime-skills');

// Bump when the generation algorithm (selection, layout, or manifest-merge
// logic) changes in a way that could produce a different package from the
// same inventory + canonical sources. Independent of the dhpk release
// version recorded as provenance.sourceVersion.
const GENERATOR_VERSION = '2.3.0';

function lstatOrNull(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function realpathOrNull(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

function assertPhysicalAncestors(directory, label) {
  let current = path.resolve(directory);
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) {
      throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertPhysicalDirectory(directory, label) {
  assertPhysicalAncestors(directory, label);
  const stat = lstatOrNull(directory);
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${directory}`);
  if (fs.realpathSync(directory) !== path.resolve(directory)) {
    throw new Error(`refusing ${label} whose realpath escapes its lexical root: ${directory}`);
  }
}

function physicalPackageRootError(directory) {
  try {
    assertPhysicalAncestors(directory, 'native package root');
    const stat = lstatOrNull(directory);
    if (!stat || !stat.isDirectory()) return `native package root must be a physical directory: ${directory}`;
    if (fs.realpathSync(directory) !== path.resolve(directory)) {
      return `native package root realpath escapes its lexical root: ${directory}`;
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

// Walks packageRoot and reports any symlink found (a native package must be
// 100% physical files — a symlink survives only as long as its target and the
// source checkout that contains it both remain present, which a clean
// marketplace cache install does not guarantee; see issue #88).
function findSymlinks(dir, options = {}) {
  const budget = createTraversalBudget(options);
  const walk = (directory, depth) => {
    const found = [];
    if (!fs.existsSync(directory)) return found;
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of readDirectoryEntries(directory, { budget })) {
        const fp = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) found.push(fp);
        else if (entry.isDirectory()) found.push(...walk(fp, depth + 1));
      }
      return found;
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  return walk(dir, 0);
}

function resolvesInsidePackage(manifestSkillsField, packageRoot) {
  if (path.isAbsolute(manifestSkillsField)) return false;
  const resolved = path.resolve(packageRoot, manifestSkillsField);
  const rel = path.relative(packageRoot, resolved);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..');
}

function validateNativeCandidate({ manifestSkillsField, packageRoot }) {
  const errors = [];

  if (path.isAbsolute(manifestSkillsField)) {
    errors.push(`manifest skills field is an absolute path escaping the package root: '${manifestSkillsField}'`);
  } else if (!resolvesInsidePackage(manifestSkillsField, packageRoot)) {
    errors.push(`manifest skills field is parent-relative and escapes the package directory: '${manifestSkillsField}' (native release candidates must resolve inside their own installed package — see issue #88)`);
  }

  const skillsRoot = path.resolve(packageRoot, manifestSkillsField);
  if (resolvesInsidePackage(manifestSkillsField, packageRoot)) {
    const skillsStat = lstatOrNull(skillsRoot);
    if (skillsStat && skillsStat.isSymbolicLink()) {
      errors.push(`symlink-dependent skills root in native candidate: '${path.relative(packageRoot, skillsRoot)}' is a symlink; a clean marketplace cache install does not preserve it (issue #88)`);
    } else {
      const realPackageRoot = realpathOrNull(packageRoot);
      const realSkillsRoot = realpathOrNull(skillsRoot);
      if (realPackageRoot && realSkillsRoot && !isInside(realPackageRoot, realSkillsRoot)) {
        errors.push(`native candidate skills realpath escapes the package root: '${realSkillsRoot}' is not inside '${realPackageRoot}'`);
      }
      for (const link of findSymlinks(skillsRoot)) {
        const rel = path.relative(packageRoot, link);
        errors.push(`symlink-dependent entry in native candidate: '${rel}' is a symlink; a clean marketplace cache install does not preserve it (issue #88)`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function readSkillFrontmatterName(skillFile, budget = null) {
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) return null;
  const text = (budget ? budget.readFile(skillFile, fs.statSync(skillFile)) : readFileBounded(skillFile)).toString('utf8');
  const block = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!block) return null;
  const nameLine = block[1].match(/^name\s*:\s*(.*?)\s*$/m);
  if (!nameLine) return null;
  const value = nameLine[1].trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1).trim();
  }
  return value;
}

// Validate the identity dimension independently from fingerprints and
// membership. A public native directory must carry the same public name in
// SKILL.md frontmatter; stable inventory ids remain provenance-only.
function validateNativeSkillIdentity({ packageRoot, inventory, manifestSkillsField = './skills/' }) {
  const errors = [];
  if (!resolvesInsidePackage(manifestSkillsField, packageRoot)) return { ok: true, errors };
  const skillsRoot = path.resolve(packageRoot, manifestSkillsField);
  for (const skill of selectNativeSkills(inventory)) {
    const publicName = skill.name || skill.id;
    const skillFile = path.join(skillsRoot, publicName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const actualName = readSkillFrontmatterName(skillFile);
    if (actualName !== publicName) {
      errors.push(`native skill '${publicName}' SKILL.md frontmatter name '${actualName || '(missing)'}' does not match public name '${publicName}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Native membership SHALL be the explicit `codex-native` inventory surface,
// never inferred from `lifecycle=promoted` (spec: "Native publication uses an
// explicit inventory surface"). Deprecated entries are excluded even if they
// still carry `codex-native` — the two-stage deprecation window keeps a
// deprecated skill's surfaces intact for compatibility, but it must not be
// (re)published into a fresh native package.
function selectNativeSkills(inventory, selectedStableIds = null) {
  const selected = Array.isArray(selectedStableIds) ? new Set(selectedStableIds) : null;
  return (inventory.skills || []).filter(
    (s) => (s.surfaces || []).includes('codex-native')
      && s.lifecycle !== 'deprecated'
      && s.invokable !== false
      && (!selected || selected.has(s.id) || selected.has(s.name))
  );
}

function materializeNativeSkills(inventory, selectedStableIds = null) {
  const selected = selectNativeSkills(inventory, selectedStableIds);
  const byId = new Map((inventory.skills || []).map((entry) => [entry && entry.id, entry]));
  const runtimeSupportStableIds = runtimeSupportSkillIds(inventory, 'codex-native');
  const entries = new Map(selected.map((entry) => [entry.id, entry]));
  for (const id of runtimeSupportStableIds) entries.set(id, byId.get(id));
  return {
    selected,
    runtimeSupportStableIds,
    materialized: [...entries.values()],
  };
}

// Checks a candidate's actual public-name directory set against the
// inventory-derived codex-native surface — the membership dimension, distinct
// from validateNativeCandidate's structural (symlink/path) checks. Stable IDs
// remain in diagnostics and provenance, but never identify a native directory.
// `candidateSkillIds` remains accepted as a compatibility alias for callers
// that have not yet renamed their local variable; its values are directory
// names, i.e. public names for v2 inventories.
function validateNativeMembership({ candidateSkillNames, candidateSkillIds, inventory, selectedStableIds = null }) {
  const selection = compileDistribution({ inventory, surface: 'codex-native' });
  if (!selection.ok) throw new Error(selection.error.message);
  const { materialized } = materializeNativeSkills(
    inventory,
    Array.isArray(selectedStableIds)
      ? selectedStableIds
      : (selection.value.selectionPolicy ? selection.value.selectedStableIds : null),
  );
  const expected = new Map(materialized.map((s) => [s.name || s.id, s.id]));
  const inventoryIdsByName = new Map((inventory.skills || []).map((s) => [s.name || s.id, s.id]));
  const candidateNames = candidateSkillNames || candidateSkillIds || [];
  const candidate = new Set(candidateNames);
  const errors = [];

  for (const name of candidateNames) {
    if (!expected.has(name)) {
      const stableId = inventoryIdsByName.get(name);
      const diagnostic = stableId ? ` (stable id '${stableId}')` : '';
      errors.push(`unexpected skill in native candidate: '${name}'${diagnostic} is not in the codex-native inventory surface (native publication must not include promoted-but-non-native content; candidate directories use public names)`);
    }
  }
  for (const [name, id] of expected) {
    if (!candidate.has(name)) {
      errors.push(`missing skill from native candidate: '${name}' (stable id '${id}') is codex-native in the inventory but absent from the package`);
    }
  }

  return { ok: errors.length === 0, errors };
}

const DEFAULT_MANIFEST_TEMPLATE = {
  description: 'dhpk codex-native physical Codex release candidate (generated; not a second source of truth — see docs/distribution-surfaces.md).',
};

function readNativeManifestTemplate(outDir, budget = null) {
  const manifestPath = path.join(outDir, '.codex-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) return DEFAULT_MANIFEST_TEMPLATE;
  const stat = lstatOrNull(manifestPath);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`native plugin manifest must be a physical file: ${manifestPath}`);
  }
  return JSON.parse((budget ? budget.readFile(manifestPath, stat) : readFileBounded(manifestPath)).toString('utf8'));
}

function nativeManifest({ outDir, name, version, budget = null }) {
  const template = readNativeManifestTemplate(outDir, budget);
  return { ...template, name, version, skills: './skills/' };
}

function readNativeReadme({ root, outDir, readme, budget = null }) {
  const destination = path.join(outDir, readme);
  if (fs.existsSync(destination)) {
    const stat = lstatOrNull(destination);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`native ${readme} must be a physical file: ${destination}`);
    }
    return budget ? budget.readFile(destination, stat) : readFileBounded(destination);
  }
  const source = path.join(root, 'plugins', 'dhpk', readme);
  return fs.existsSync(source) ? (budget ? budget.readFile(source, fs.statSync(source)) : readFileBounded(source)) : null;
}

function nativeSourceFiles(sourceDir, relative = '', options = {}) {
  const stat = lstatOrNull(sourceDir);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`native skill source must be a physical directory: ${sourceDir}`);
  }
  const budget = options.budget || createTraversalBudget();
  const depth = options.depth || 0;
  const realDirectory = budget.enterDirectory(sourceDir, depth);
  const files = [];
  try {
    for (const entry of readDirectoryEntries(sourceDir, { budget, sort: true, localeSort: true })) {
      const source = path.join(sourceDir, entry.name);
      const destination = path.posix.join(relative, entry.name);
      if (entry.name === '__pycache__' || destination.endsWith('.pyc')) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(`codex-native projection forbids source symlink: ${source}`);
      }
      if (entry.isDirectory()) files.push(...nativeSourceFiles(source, destination, { budget, depth: depth + 1 }));
      else if (entry.isFile()) {
        const sourceStat = fs.statSync(source);
        files.push({ source, destination, content: budget.readFile(source, sourceStat), mode: sourceStat.mode & 0o7777 });
      } else throw new Error(`unsupported native source filesystem entry: ${source}`);
    }
    return files;
  } finally {
    budget.leaveDirectory(realDirectory);
  }
}

function nativeSkillFingerprint(files) {
  const hash = crypto.createHash('sha256');
  // Keep the legacy fingerprintDir ordering byte-for-byte compatible. Node's
  // default Array#sort uses code-unit ordering (uppercase SKILL.md before
  // lowercase resource directories); localeCompare would reorder the same
  // source tree and create false package drift.
  for (const file of files.slice().sort((a, b) => (a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0))) {
    hash.update(file.destination.split(path.sep).join('/'));
    hash.update('\0');
    hash.update(file.content);
  }
  return hash.digest('hex');
}

// The pre-profile native package receipt used the inventory lifecycle and
// surface contract as its source identity. Profile policy metadata is bound
// separately through selectionFingerprint, so adding the policy must not
// invalidate the legacy compatibility package byte identity.
function legacyInventoryDigest(inventory) {
  const source = { ...(inventory || {}) };
  delete source.profile_policy;
  return crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

function nativeOutputRecord(stableId, source, destination, content, transform, mode = 0o644, metadata = {}) {
  return {
    stableId,
    source,
    destination,
    content,
    mode,
    transform: transform || { id: 'codex-native-generated', version: GENERATOR_VERSION },
    ...metadata,
  };
}

function compileNativePackage({
  inventory = {},
  root,
  outDir,
  name = 'dhpk-native',
  version = '0.0.0',
  sourceCommit = 'unknown',
  generatorVersion = GENERATOR_VERSION,
  traversalOptions = {},
  selectionMode = 'compiler',
  profileSelection = null,
} = {}) {
  if (!root || !outDir) throw new Error('compileNativePackage requires root and outDir');
  if (profileSelection) {
    const supportedStableIds = (inventory.skills || [])
      .filter((entry) => Array.isArray(entry.surfaces) && entry.surfaces.includes('codex-native'))
      .map((entry) => entry.id);
    const bound = bindSurfaceSelection({ selection: profileSelection, surface: 'codex-native', supportedStableIds });
    if (!bound.ok) throw new Error(bound.error.message);
    profileSelection = bound.value;
  }
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  assertPhysicalDirectory(resolvedRoot, 'canonical root');
  assertPhysicalDirectory(resolvedOut, 'output root');
  // Codex native packaging and Claude parity checks share the inventory-owned
  // family/alias view. Native currently publishes no claude-module aliases,
  // so the projection is an explicit empty selection rather than a second map.
  const { buildSkillRoutingProjection } = require('./skill-routing-projection');
  const { compareRoutingProjections } = require('./distribution-projection-parity');
  const routingProjection = buildSkillRoutingProjection({ inventory, surface: 'codex-native' });
  const traversalBudget = createTraversalBudget(traversalOptions);

  const selection = selectionMode === 'legacy' ? null : compileDistribution({ inventory, surface: 'codex-native', profileSelection });
  if (selection && !selection.ok) throw new Error(selection.error.message);
  const nativeSelection = materializeNativeSkills(
    inventory,
    selection && selection.value.selectionPolicy ? selection.value.selectedStableIds : null,
  );
  const files = [];
  const fingerprints = {};
  const selectedEntries = [];
  const inventoryRevision = resolveInventoryRevision(inventory);
  const ownershipFingerprint = Object.prototype.hasOwnProperty.call(inventory, 'external_skill_packages')
    ? externalSkillPackagesFingerprint(inventory.external_skill_packages)
    : undefined;
  for (const skill of nativeSelection.materialized) {
    const publicName = skill.name || skill.id;
    const sourcePath = skill.path;
    if (typeof sourcePath !== 'string' || !sourcePath || path.posix.normalize(sourcePath) !== sourcePath || path.posix.isAbsolute(sourcePath) || sourcePath.startsWith('../')) {
      throw new Error(`unsafe source path for '${publicName}': ${sourcePath}`);
    }
    const sourceDir = path.resolve(resolvedRoot, ...sourcePath.split('/'));
    if (!isInside(resolvedRoot, sourceDir)) throw new Error(`source path for '${publicName}' escapes canonical root: ${sourcePath}`);
    const sourceFile = path.join(sourceDir, 'SKILL.md');
    const sourceFrontmatterName = readSkillFrontmatterName(sourceFile, traversalBudget);
    if (sourceFrontmatterName !== publicName) {
      throw new Error(`native skill '${publicName}' source SKILL.md frontmatter name '${sourceFrontmatterName || '(missing)'}' does not match public name '${publicName}'`);
    }
    const skillFiles = nativeSourceFiles(sourceDir, '', { budget: traversalBudget });
    fingerprints[publicName] = nativeSkillFingerprint(skillFiles);
    const skillTransform = { id: 'codex-native-skill', version: generatorVersion };
    const skillMetadata = skillProjectionMetadata(skill, {
      transform: skillTransform,
      owner: SURFACE_OWNERS['codex-native'],
      inventoryRevision,
      ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    });
    for (const file of skillFiles) {
      files.push(nativeOutputRecord(
        `skill:${skill.id}:${file.destination}`,
        path.posix.join(sourcePath, file.destination),
        path.posix.join('skills', publicName, file.destination),
        file.content,
        skillTransform,
        file.mode,
        skillMetadata,
      ));
    }
    selectedEntries.push(skill);
  }

  const manifest = nativeManifest({ outDir: resolvedOut, name, version, budget: traversalBudget });
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  traversalBudget.accountBytes(Buffer.byteLength(manifestContent), '.codex-plugin/plugin.json');
  files.push(nativeOutputRecord('manifest:plugin', 'generated/.codex-plugin/plugin.json', '.codex-plugin/plugin.json', manifestContent, undefined, 0o644));

  const selectedSkillIds = nativeSelection.selected.map((entry) => entry.id).sort();
  const selectedSkillNames = nativeSelection.selected.map((entry) => entry.name || entry.id).sort();
  const materializedSkillIds = selectedEntries.map((entry) => entry.id).sort();
  const materializedSkillNames = selectedEntries.map((entry) => entry.name || entry.id).sort();
  const inventoryDigest = legacyInventoryDigest(inventory);
  const generatedFromTree = resolveGeneratedFromTree(resolvedRoot, sourceCommit);
  const provenance = {
    schema: RECEIPT_SCHEMA,
    surface: 'codex-native',
    selectionMode,
    owner: SURFACE_OWNERS['codex-native'],
    sourceVersion: version,
    sourceCommit,
    generatedFromCommit: sourceCommit,
    ...(generatedFromTree ? { generatedFromTree } : {}),
    inventoryDigest,
    inventoryRevision,
    generatorVersion,
    selectedSkillIds,
    selectedSkillNames,
    materializedSkillIds,
    materializedSkillNames,
    runtimeSupportStableIds: nativeSelection.runtimeSupportStableIds,
    fingerprints,
    routingProjection,
    ...(selectedEntries.some((entry) => entry.usage) ? {
      usageSchema: 'dhpk.skill-usage.v1',
      usage: Object.fromEntries(selectedEntries.filter((entry) => entry.usage).map((entry) => [entry.id, entry.usage])),
      usageFingerprints: Object.fromEntries(selectedEntries.filter((entry) => entry.usage).map((entry) => [
        entry.id,
        skillProjectionMetadata(entry, { inventoryRevision }).usageFingerprint,
      ])),
    } : {}),
    ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    ...(profileSelection ? {
      profileId: profileSelection.profileId || profileSelection.id,
      selectedStableIds: profileSelection.selectedStableIds,
      canonicalSelectedStableIds: profileSelection.selectedStableIds,
      emittedStableIds: selectedSkillIds,
      compatibilityMode: profileSelection.compatibilityMode || profileSelection.mode || null,
      selectionPolicyVersion: profileSelection.selectionPolicyVersion || null,
      selectionFingerprint: profileSelection.selectionFingerprint || null,
      surfaceSelectionFingerprint: profileSelection.surfaceSelectionFingerprint || null,
    } : {}),
  };
  const fingerprintsContent = `${JSON.stringify(fingerprints, null, 2)}\n`;
  const provenanceContent = `${JSON.stringify(provenance, null, 2)}\n`;
  traversalBudget.accountBytes(Buffer.byteLength(fingerprintsContent), 'fingerprints.json');
  traversalBudget.accountBytes(Buffer.byteLength(provenanceContent), 'provenance.json');
  files.push(nativeOutputRecord('manifest:fingerprints', 'generated/fingerprints.json', 'fingerprints.json', fingerprintsContent, undefined, 0o644));
  files.push(nativeOutputRecord('manifest:provenance', 'generated/provenance.json', 'provenance.json', provenanceContent, undefined, 0o644));
  for (const readme of ['README.md', 'README.zh-TW.md']) {
    const content = readNativeReadme({ root: resolvedRoot, outDir: resolvedOut, readme, budget: traversalBudget });
    if (content !== null) {
      const readmePath = fs.existsSync(path.join(resolvedOut, readme)) ? path.join(resolvedOut, readme) : path.join(resolvedRoot, 'plugins', 'dhpk', readme);
      const mode = lstatOrNull(readmePath) ? fs.statSync(readmePath).mode & 0o7777 : 0o644;
      files.push(nativeOutputRecord(`manifest:${readme}`, `generated/${readme}`, readme, content, undefined, mode));
    }
  }

  const entries = files.map((file) => ({
    stableId: file.stableId,
    source: file.source,
    destination: file.destination,
    owner: SURFACE_OWNERS['codex-native'],
    transform: file.transform,
    expectedFingerprint: crypto.createHash('sha256').update(file.content).digest('hex'),
    mode: file.mode,
    symlinkPolicy: 'forbid',
    ...(file.skillId ? {
      skillId: file.skillId,
      publicName: file.publicName,
      invocationClass: file.invocationClass,
      lifecycle: file.lifecycle,
      usageSchema: file.usageSchema,
      usage: file.usage,
      usageFingerprint: file.usageFingerprint,
      provenance: file.provenance,
    } : {}),
  }));
  const compiled = compileDistribution({
    surface: 'codex-native',
    compilerVersion: `codex-native-${generatorVersion}`,
    inventoryFingerprint: inventoryDigest,
    inventoryRevision,
    ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
    ownershipRoot: resolvedOut,
    entries,
    selectedStableIds: selection && selection.ok && selection.value.selectionPolicy
      ? selection.value.selectedStableIds
      : undefined,
    selectionPolicy: selection && selection.ok && selection.value.selectionPolicy
      ? selection.value.selectionPolicy
      : undefined,
    selectionEntries: selection && selection.ok && selection.value.selectionPolicy
      ? (selection.value.selectionEntries || selection.value.entries).map((entry) => {
        const skill = (inventory.skills || []).find((candidate) => candidate.id === entry.stableId || candidate.id === entry.skillId);
        return skill ? {
          ...entry,
          ...skillProjectionMetadata(skill, {
            transform: entry.transform,
            owner: SURFACE_OWNERS['codex-native'],
            inventoryRevision,
            ...(ownershipFingerprint !== undefined ? { externalSkillPackagesFingerprint: ownershipFingerprint } : {}),
          }),
        } : entry;
      })
      : undefined,
    profileSelection: profileSelection ? { ...profileSelection, emittedStableIds: selectedSkillIds } : null,
    emittedStableIds: profileSelection ? selectedSkillIds : undefined,
    selectionFingerprint: profileSelection && profileSelection.selectionFingerprint,
    surfaceSelectionFingerprint: profileSelection && profileSelection.surfaceSelectionFingerprint,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  const adapter = {
    identity: { id: 'codex-native', version: generatorVersion },
    render: () => ({
      adapter: { id: 'codex-native', version: generatorVersion },
      outputs: files.slice().sort((a, b) => a.destination.localeCompare(b.destination)),
      links: [],
      metadata: {
        manifest,
        manifestSkillsField: manifest.skills,
        skillIds: selectedSkillIds,
        skillNames: selectedSkillNames,
        materializedSkillIds,
        materializedSkillNames,
        fingerprints,
        provenance,
        routingProjection,
      },
    }),
    validate: (rendered, context) => {
      if (!context || !context.session || !context.session.stageRoot) return rendered;
      const expectedRouting = buildSkillRoutingProjection({ inventory, surface: 'codex-native' });
      const metadataParity = compareRoutingProjections({
        expected: expectedRouting,
        actual: rendered.metadata && rendered.metadata.routingProjection,
      });
      if (!metadataParity.ok) {
        throw new Error(`Codex routing projection metadata drift: ${metadataParity.diagnostics.join('; ')}`);
      }
      const provenanceOutput = (rendered.outputs || []).find((entry) => entry.stableId === 'manifest:provenance');
      let publishedProvenance;
      try {
        publishedProvenance = JSON.parse(Buffer.from(provenanceOutput && provenanceOutput.content || '').toString('utf8'));
      } catch (_) {
        throw new Error('Codex provenance output is not valid JSON');
      }
      const artifactParity = compareRoutingProjections({
        expected: expectedRouting,
        actual: publishedProvenance && publishedProvenance.routingProjection,
      });
      if (!artifactParity.ok) {
        throw new Error(`Codex routing projection artifact drift: ${artifactParity.diagnostics.join('; ')}`);
      }
      const structural = validateNativeCandidate({ manifestSkillsField: rendered.metadata.manifestSkillsField, packageRoot: context.session.stageRoot });
      const stagedSkillsRoot = path.join(context.session.stageRoot, 'skills');
      const stagedSkillsStat = lstatOrNull(stagedSkillsRoot);
      const membership = validateNativeMembership({
        candidateSkillNames: stagedSkillsStat && stagedSkillsStat.isDirectory() && !stagedSkillsStat.isSymbolicLink()
          ? readDirectoryEntries(stagedSkillsRoot, { sort: true }).map((entry) => entry.name)
          : [],
        inventory,
        selectedStableIds: profileSelection ? selectedSkillIds : null,
      });
      const identity = validateNativeSkillIdentity({
        manifestSkillsField: rendered.metadata.manifestSkillsField,
        packageRoot: context.session.stageRoot,
        inventory,
      });
      const errors = [...structural.errors, ...membership.errors, ...identity.errors];
      if (errors.length > 0) throw new Error(`generated Codex native package failed validation: ${errors.join('; ')}`);
      return rendered;
    },
  };
  return {
    plan: compiled.value,
    adapter,
    selectedSkillIds,
    selectedSkillNames,
    materializedSkillIds,
    materializedSkillNames,
    runtimeSupportStableIds: nativeSelection.runtimeSupportStableIds,
    fingerprints,
    provenance,
    routingProjection,
  };
}

// Materialize the physical, explicitly-allowlisted codex-native package from
// a distribution inventory. Copies real file content (dereferencing any
// canonical-source symlinks) for every selected skill. If a plugin.json
// already exists at the destination, its fields (author, homepage, license,
// keywords, interface, ...) are preserved — only `name`, `version`, and
// `skills` are generator-controlled — so regenerating the tracked marketplace
// package never silently strips its marketplace descriptor. Returns the
// candidate's manifest field, stable selected skill ids, public selected skill
// names, per-skill fingerprints keyed by public name, and deterministic
// provenance (no wall-clock fields, so two runs against the same inputs
// produce byte-identical output — see spec.md "Unchanged sources are
// generated twice").
function materializeNativePackage({
  inventory = {},
  root,
  outDir,
  name = 'dhpk-native',
  version = '0.0.0',
  sourceCommit = 'unknown',
  generatorVersion = GENERATOR_VERSION,
  compiledProjection,
  artifactStore,
  traversalOptions = {},
  profileSelection = null,
}) {
  if (!root || !outDir) throw new Error('materializeNativePackage requires root and outDir');
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  assertPhysicalDirectory(resolvedRoot, 'canonical root');
  assertPhysicalAncestors(path.dirname(resolvedOut), 'output root');
  const existingOutput = lstatOrNull(resolvedOut);
  if (existingOutput && existingOutput.isSymbolicLink()) throw new Error(`refusing symlinked output root: ${resolvedOut}`);
  if (existingOutput && !existingOutput.isDirectory()) throw new Error(`output root must be a directory: ${resolvedOut}`);

  const projection = compiledProjection || compileNativePackage({
    inventory,
    root: resolvedRoot,
    outDir: resolvedOut,
    name,
    version,
    sourceCommit,
    generatorVersion,
    traversalOptions,
    profileSelection,
  });
  const parent = path.dirname(resolvedOut);
  const store = artifactStore || new ProjectionArtifactStore({
    root: parent,
    sourceRoot: resolvedRoot,
    publishRoot: resolvedOut,
  });
  const artifact = materializeDistribution(projection.plan, projection.adapter, store);
  if (!artifact.ok) throw new Error(`generated Codex native package failed validation: ${artifact.error.message}`);
  const metadata = artifact.value.metadata || {};
  return {
    manifestSkillsField: metadata.manifestSkillsField || './skills/',
    skillIds: metadata.materializedSkillIds || projection.materializedSkillIds || metadata.skillIds || projection.selectedSkillIds,
    skillNames: metadata.materializedSkillNames || projection.materializedSkillNames || metadata.skillNames || projection.selectedSkillNames,
    fingerprints: metadata.fingerprints || projection.fingerprints,
    provenance: metadata.provenance || projection.provenance,
    routingProjection: metadata.routingProjection || projection.routingProjection,
    artifact: artifact.value,
  };
}

function readNativeProvenance(packageRoot) {
  const provenancePath = path.join(packageRoot, 'provenance.json');
  const stat = lstatOrNull(provenancePath);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) return null;
  try {
    return JSON.parse(readFileBounded(provenancePath).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function readNativeManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, '.codex-plugin', 'plugin.json');
  const stat = lstatOrNull(manifestPath);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) return null;
  try {
    return JSON.parse(readFileBounded(manifestPath).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function verifyNativePackage({
  packageRoot,
  inventory = {},
  stage = 'structural',
  observedAt,
  consumerAdapter,
  profileSelection = null,
} = {}) {
  if (!packageRoot) {
    return { ok: false, errors: ['package root is required'], evidence: { ok: false, error: { code: 'INVALID_INPUT' } } };
  }
  const resolvedPackageRoot = path.resolve(packageRoot);
  const packageRootError = physicalPackageRootError(resolvedPackageRoot);
  if (packageRootError) {
    return {
      ok: false,
      errors: [packageRootError],
      structural: { ok: false, errors: [packageRootError] },
      evidence: { ok: false, error: { code: 'UNSAFE_PACKAGE_ROOT', message: packageRootError } },
    };
  }
  const manifest = readNativeManifest(resolvedPackageRoot) || {};
  const manifestSkillsField = typeof manifest.skills === 'string' ? manifest.skills : './skills/';
  const structural = validateNativeCandidate({ manifestSkillsField, packageRoot: resolvedPackageRoot });
  const skillsRoot = path.resolve(resolvedPackageRoot, manifestSkillsField);
  const candidateSkillNames = resolvesInsidePackage(manifestSkillsField, resolvedPackageRoot)
    && lstatOrNull(skillsRoot)
    && lstatOrNull(skillsRoot).isDirectory()
    ? readDirectoryEntries(skillsRoot, { sort: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  const membership = validateNativeMembership({
    candidateSkillNames,
    inventory,
    selectedStableIds: profileSelection && profileSelection.selectedStableIds,
  });
  const identity = validateNativeSkillIdentity({ manifestSkillsField, packageRoot: resolvedPackageRoot, inventory });
  const errors = [...structural.errors, ...membership.errors, ...identity.errors];
  const provenance = readNativeProvenance(resolvedPackageRoot);
  let routingParity = { ok: true, diagnostics: [], mismatches: [] };
  if (provenance && !Object.prototype.hasOwnProperty.call(provenance, 'routingProjection')) {
    routingParity = {
      ok: false,
      diagnostics: ['native provenance is missing routingProjection'],
      mismatches: [{ stableId: '<projection>', surface: 'codex-native', type: 'invalid', field: 'routingProjection' }],
    };
    errors.push(...routingParity.diagnostics);
  } else if (provenance && Object.prototype.hasOwnProperty.call(provenance, 'routingProjection')) {
    const { buildSkillRoutingProjection } = require('./skill-routing-projection');
    const { compareRoutingProjections } = require('./distribution-projection-parity');
    routingParity = compareRoutingProjections({
      expected: buildSkillRoutingProjection({ inventory, surface: 'codex-native' }),
      actual: provenance.routingProjection,
    });
    if (!routingParity.ok) errors.push(...routingParity.diagnostics.map((diagnostic) => `routing projection drift: ${diagnostic}`));
  }
  let artifactFingerprint = 'codex-native-unobserved';
  try {
    artifactFingerprint = fingerprintDir(resolvedPackageRoot);
  } catch (error) {
    const diagnostic = `native package fingerprint failed: ${error.message}`;
    errors.push(diagnostic);
    structural.errors.push(diagnostic);
    structural.ok = false;
  }
  const planFingerprint = provenance && typeof provenance.inventoryDigest === 'string'
    ? provenance.inventoryDigest
    : 'codex-native-unbound';
  const defaultConsumerStage = stage === 'consumer-runtime' && !consumerAdapter;
  const adapter = consumerAdapter || {
    identity: {
      id: defaultConsumerStage ? 'codex-native-consumer' : 'codex-native-validator',
      version: GENERATOR_VERSION,
    },
    verify: () => ({
      verdict: defaultConsumerStage ? 'NOT_CONFIGURED' : (errors.length === 0 ? 'PASS' : 'FAIL'),
      claims: defaultConsumerStage
        ? ['Codex native consumer configuration']
        : ['native package structure', 'native skill identity', 'native inventory membership'],
      observations: defaultConsumerStage
        ? ['no Codex native consumer adapter configured']
        : (errors.length === 0 ? ['validated package output'] : errors),
      diagnostics: defaultConsumerStage ? ['Codex native consumer adapter is not configured'] : errors,
      observedAt,
    }),
  };
  const observer = consumerAdapter
    ? {
      ...adapter,
      verify: (requestedStage, artifact) => ({
        ...(adapter.verify(requestedStage, artifact) || {}),
        observedAt,
      }),
    }
    : adapter;
  const evidenceResult = verifyDistribution(stage, { planFingerprint, artifactFingerprint }, observer);
  const evidence = evidenceResult.ok ? evidenceResult.value : evidenceResult;
  return {
    ok: structural.ok && membership.ok && identity.ok && routingParity.ok && evidenceResult.ok,
    errors,
    manifest,
    candidateSkillNames,
    structural,
    membership,
    identity,
    routingParity,
    evidence,
  };
}

function fingerprintDir(dir, options = {}) {
  const digest = crypto.createHash('sha256');
  const budget = createTraversalBudget(options);
  const lexicalRoot = path.resolve(dir);
  const canonicalRoot = fs.realpathSync(dir);
  if (lexicalRoot !== canonicalRoot) {
    throw new Error(`cannot fingerprint symlinked root or ancestor: ${dir}`);
  }
  const rootStat = fs.lstatSync(canonicalRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`cannot fingerprint symlink root: ${dir}`);
  }
  const walk = (d, relBase, depth) => {
    const realDirectory = budget.enterDirectory(d, depth);
    try {
      for (const entry of readDirectoryEntries(d, { budget, sort: true })) {
        const name = entry.name;
        if (name === '__pycache__' || name.endsWith('.pyc')) continue;
        const fp = path.join(d, name);
        const rel = path.join(relBase, name);
        const stat = fs.lstatSync(fp);
        if (stat.isDirectory()) {
          walk(fp, rel, depth + 1);
        } else if (stat.isSymbolicLink()) {
          throw new Error(`cannot fingerprint symlink entry: ${fp}`);
        } else if (stat.isFile()) {
          digest.update(rel.split(path.sep).join('/'));
          digest.update('\0');
          digest.update(budget.readFile(fp, stat));
        } else {
          throw new Error(`cannot fingerprint special entry: ${fp}`);
        }
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(canonicalRoot, '', 0);
  return digest.digest('hex');
}

module.exports = {
  GENERATOR_VERSION,
  validateNativeCandidate,
  validateNativeSkillIdentity,
  validateNativeMembership,
  selectNativeSkills,
  compileNativePackage,
  materializeNativePackage,
  verifyNativePackage,
  compileCodexNativePackage: compileNativePackage,
  verifyCodexNativePackage: verifyNativePackage,
  fingerprintDir,
};
