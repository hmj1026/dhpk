'use strict';

// Relocatable project projection publisher. The compiler owns selection and
// this module owns only the filesystem adapter: it stages a complete candidate
// through ProjectionArtifactStore, then reconciles receipt-owned paths into an
// external consumer project without replacing foreign content.

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { parseFrontmatter } = require('./agent-plugin-package');
const {
  TREE_FINGERPRINT_ALGORITHM,
  requireTreeMerkle,
  sha256Hex,
  treeFingerprint,
} = require('./content-fingerprint');
const {
  compileProjectAgentProjection,
  materializeDistribution,
} = require('./distribution-compiler');
const {
  createDistributionPlan,
  fingerprint,
} = require('./distribution-projection-contract');
const { ProjectionArtifactStore, safeRelative, safeLinkTarget, inside } = require('./projection-artifact-store');
const {
  serializePortableSkillMetadata,
  validatePortableSkillMetadata,
} = require('./portable-skill-metadata');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');
const { resolveStandaloneSkillDependencies } = require('./standalone-skill-dependencies');
const {
  createProjectAgentProviderAdapters,
  CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CODEX_PROJECT_DISCOVERY_DESTINATION_ROOT,
  renderAgyDirectFile,
} = require('./project-agent-provider-adapters');
const {
  DIRECT_SHAPE,
  NATIVE_LINK_SHAPE,
  applyHostSelections,
  restorePreservedHostBindings,
  stampDiscoveryHost,
  validateLegacyUnboundFlag,
  validateReceiptBindingState,
  validateReceiptBindings: validateHostReceiptBindings,
} = require('./project-agent-host-binding-policy');

const PROJECT_RECEIPT_SCHEMA = 'dhpk.project-agent-projection-receipt.v3';
const PREVIOUS_PROJECT_RECEIPT_SCHEMA = 'dhpk.project-agent-projection-receipt.v2';
const LEGACY_PROJECT_RECEIPT_SCHEMA = 'dhpk.project-agent-projection-receipt.v1';
const PROJECT_ROLLBACK_SCHEMA = 'dhpk.project-agent-projection-rollback.v2';
const LEGACY_PROJECT_ROLLBACK_SCHEMA = 'dhpk.project-agent-projection-rollback.v1';
const PROJECT_TRANSACTION_SCHEMA = 'dhpk.project-agent-projection-transaction.v2';
const LEGACY_PROJECT_TRANSACTION_SCHEMA = 'dhpk.project-agent-projection-transaction.v1';
const GENERATOR_VERSION = '2.1.0';
// Only the current generator's receipts are read (OpenSpec
// remove-legacy-tree-fingerprints, design D3/Q17).
const ACCEPTED_GENERATOR_VERSIONS = Object.freeze([GENERATOR_VERSION]);
const LEGACY_MANIFEST_NAME = '.dhpk-projection.json';
// Receipt-less project manifests written by these generators can be adopted.
const PROJECT_PROJECTION_MANIFEST_GENERATORS = Object.freeze(['2.0.0', GENERATOR_VERSION]);
const CLAUDE_ARTIFACT_ROOT = '.dhpk-claude-sibling';
const CLAUDE_MANAGED_ROOT_NAME = 'claude-skills';
const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?(?!\$\{)[A-Za-z0-9._~+\/-]{16,}/i,
];

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(clone(value));
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.projectionCode = code;
  error.projectionDetails = details;
  return error;
}

function portableSkillContent(content, label) {
  const result = serializePortableSkillMetadata(content);
  if (!result || result.ok !== true || typeof result.output !== 'string') {
    const details = result && Array.isArray(result.errors) ? result.errors.join('; ') : 'metadata transform failed';
    throw fail('INVALID_PORTABLE_METADATA', `${label}: ${details}`);
  }
  return result.output;
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

// Path-safety predicates are shared with the build-time artifact store; this
// module keeps its own error codes and messages around them.
function isInside(parent, candidate) {
  return inside(path.resolve(parent), path.resolve(candidate));
}

function assertSafeRelative(relative, label) {
  if (!safeRelative(relative)) {
    throw fail('UNSAFE_PATH', `${label} must be a normalized relative path`, { paths: [relative] });
  }
  return relative;
}

function assertPhysicalAncestors(candidate, label, boundary = null) {
  const resolvedCandidate = path.resolve(candidate);
  let current = resolvedCandidate;
  const stop = boundary ? path.resolve(boundary) : null;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) {
      const recovery = 'preserve the symlink and its target; do not remove a conflicting skill symlink as a standalone recovery step for receipt-owned content; restore physical files matching the current receipt fingerprints before retrying; see docs/platform-installation.md#recover-receipt-owned-shared-skills';
      const message = current === resolvedCandidate
        ? `${label} is a symlink at candidate path: ${current}; ${recovery}`
        : `${label} has a symlinked ancestor: ${current}; ${recovery}`;
      throw fail('UNSAFE_PATH', message, { paths: [current] });
    }
    if (stop && current === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function ensureDirectory(directory, label, boundary = null) {
  const resolved = path.resolve(directory);
  const existing = lstatOrNull(resolved);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw fail('UNSAFE_PATH', `${label} must be a physical directory: ${resolved}`, { paths: [resolved] });
  }
  if (!existing) fs.mkdirSync(resolved, { recursive: true });
  assertPhysicalAncestors(resolved, label, boundary);
  return resolved;
}

function pathIn(root, relative, label = 'projection path') {
  assertSafeRelative(relative, label);
  const candidate = path.resolve(root, relative);
  if (!isInside(root, candidate)) throw fail('PATH_ESCAPE', `${label} escapes its root: ${relative}`, { paths: [relative] });
  assertPhysicalAncestors(candidate, label, root);
  return candidate;
}

function assertSafeLinkTarget(target, label) {
  if (!safeLinkTarget(target)) {
    throw fail('UNSAFE_PATH', `${label} must be a normalized relative symlink target`, { paths: [target] });
  }
  return target;
}

// Any resolution failure falls through to assertPhysicalAncestors, which
// still refuses the symlink with the generic UNSAFE_PATH error.
function realpathOrNull(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

// A consumer may alias a whole Host skill directory (for example
// `.claude/skills -> ../.agents/skills`). Per-skill bindings written through
// that alias would land inside the managed artifact, so the alias stays
// refused; this only replaces the generic symlink error with remediation.
function assertNotManagedRootAlias(roots, directory, label) {
  const stat = lstatOrNull(directory);
  if (!stat || !stat.isSymbolicLink()) return;
  const aliasTarget = realpathOrNull(directory);
  const managedTargets = [roots.managedRoot, roots.claudeManagedRoot]
    .map((root) => realpathOrNull(root))
    .filter(Boolean);
  if (!aliasTarget || !managedTargets.includes(aliasTarget)) return;
  const relativeDirectory = path.relative(roots.projectRoot, directory).split(path.sep).join('/');
  const host = /^\.([a-z]+)\/skills$/.exec(relativeDirectory);
  const omit = host ? `omit --host ${host[1]}` : 'omit the Host that binds this directory';
  throw fail('MANAGED_ROOT_ALIAS', `${label} parent ${relativeDirectory} is a directory symlink to a managed skill root `
    + `${roots.config.managed_root}; the alias already exposes every projected skill, so ${omit}, or replace the symlink `
    + 'with a physical directory so dhpk can own per-skill bindings', { paths: [directory] });
}

function bindingDestinationIn(roots, relative, label = 'projection binding path') {
  assertSafeRelative(relative, label);
  const candidate = path.resolve(roots.projectRoot, relative);
  if (!isInside(roots.projectRoot, candidate)) throw fail('PATH_ESCAPE', `${label} escapes the project root: ${relative}`, { paths: [relative] });
  // The final component may intentionally be a symlink. Only its ancestors
  // must remain physical so the binding cannot redirect a project path.
  assertNotManagedRootAlias(roots, path.dirname(candidate), label);
  assertPhysicalAncestors(path.dirname(candidate), label, roots.projectRoot);
  return candidate;
}

function bindingTargetIn(roots, binding, label = 'projection binding', { allowClaudeRoot = false } = {}) {
  const destination = bindingDestinationIn(roots, binding.path, `${label} path`);
  const target = assertSafeLinkTarget(binding.target, `${label} target`);
  const resolvedTarget = path.resolve(path.dirname(destination), target);
  const allowedRoot = isInside(roots.managedRoot, resolvedTarget)
    || (allowClaudeRoot && binding.hostId === 'claude' && isInside(roots.claudeManagedRoot, resolvedTarget));
  if (!isInside(roots.projectRoot, resolvedTarget) || !allowedRoot) {
    throw fail('PATH_ESCAPE', `${label} target must resolve inside a receipt-owned project artifact: ${binding.target}`, {
      paths: [binding.path, binding.target],
    });
  }
  assertPhysicalAncestors(resolvedTarget, `${label} target`, roots.projectRoot);
  return { destination, target, resolvedTarget };
}

function normalizeBindingPaths(bindingPaths, roots, label = 'project projection binding paths', { allowClaudeRoot = false } = {}) {
  if (bindingPaths === undefined || bindingPaths === null) return {};
  if (!bindingPaths || typeof bindingPaths !== 'object' || Array.isArray(bindingPaths)) {
    throw fail('INVALID_RECEIPT', `${label} must be an object`);
  }
  const normalized = {};
  const seen = new Set();
  for (const hostId of Object.keys(bindingPaths).sort()) {
    const entries = bindingPaths[hostId];
    if (!Array.isArray(entries)) throw fail('INVALID_RECEIPT', `${label} for '${hostId}' must be an array`);
    normalized[hostId] = entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.path !== 'string' || typeof entry.target !== 'string') {
        throw fail('INVALID_RECEIPT', `${label} for '${hostId}' contains an invalid entry`);
      }
      const value = { path: entry.path, target: entry.target };
      bindingTargetIn(roots, { ...value, hostId }, `${label} '${hostId}'`, { allowClaudeRoot });
      if (seen.has(value.path)) throw fail('INVALID_RECEIPT', `${label} contains a duplicate path: ${value.path}`, { paths: [value.path] });
      seen.add(value.path);
      return value;
    }).sort((left, right) => left.path.localeCompare(right.path));
  }
  return normalized;
}

function flattenBindingPaths(bindingPaths) {
  return Object.keys(bindingPaths || {}).sort().flatMap((hostId) => (bindingPaths[hostId] || []).map((entry) => ({
    hostId,
    path: entry.path,
    target: entry.target,
  })));
}

function validateReceiptBindings(receipt, roots, { allowLegacyClaudeDiscovery = false } = {}) {
  try {
    validateLegacyUnboundFlag(receipt);
  } catch (error) {
    throw fail('INVALID_RECEIPT', error.message);
  }
  const bindingPaths = normalizeBindingPaths(receipt.bindingPaths || {}, roots, 'project projection binding paths', {
    allowClaudeRoot: receipt.schema === PROJECT_RECEIPT_SCHEMA,
  });
  let legacyUnbound;
  try {
    legacyUnbound = validateReceiptBindingState(receipt, bindingPaths);
  } catch (error) {
    throw fail('INVALID_RECEIPT', error.message);
  }
  if (legacyUnbound) return bindingPaths;

  try {
    // 舊版跨 Host 更新曾留下 v3 receipt 卻仍指向 portable root；只在生命週期
    // 讀取時驗證這個精確舊形狀，保留原始所有權與 fingerprint 供安全重綁。
    const legacyClaudeDiscovery = allowLegacyClaudeDiscovery
      && receipt.schema === PROJECT_RECEIPT_SCHEMA
      && receipt.hostBindings.claude
      && receipt.hostBindings.claude.discovery
      && receipt.hostBindings.claude.discovery.sourceRoot === roots.config.managed_root;
    const providers = createProjectAgentProviderAdapters(receipt.hostBindings, {
      entries: receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name, discoveryVisible: entry.discoveryVisible })),
      claudeSourceRoot: receipt.schema === PROJECT_RECEIPT_SCHEMA && !legacyClaudeDiscovery
        ? roots.claudeManagedRootRelative
        : roots.config.managed_root,
      portableSourceRoot: roots.config.managed_root,
    });
    validateHostReceiptBindings(receipt, providers, bindingPaths);
  } catch (error) {
    throw fail('INVALID_RECEIPT', error.message);
  }
  return bindingPaths;
}

function safeName(value, label) {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw fail('INVALID_PROJECT_ENTRY', `${label} must be a kebab-case public name: ${value}`);
  return value;
}

function readPhysicalFile(filePath, label, budget = createTraversalBudget()) {
  const stat = lstatOrNull(filePath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw fail('UNSAFE_SOURCE', `${label} must be a regular non-symlink file: ${filePath}`);
  return budget.readFile(filePath, stat, label);
}

function collectFiles(directory, relative = '', budget = createTraversalBudget()) {
  const depth = relative ? relative.split('/').length : 0;
  const realDirectory = budget.enterDirectory(directory, depth);
  try {
    const files = [];
    for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const child = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw fail('UNSAFE_SOURCE', `canonical source contains a symlink: ${child}`, { paths: [childRelative] });
      if (entry.isDirectory()) files.push(...collectFiles(child, childRelative, budget));
      else if (entry.isFile()) files.push({ absolute: child, relative: childRelative });
      else throw fail('UNSAFE_SOURCE', `canonical source contains an unsupported entry: ${child}`, { paths: [childRelative] });
    }
    return files;
  } finally {
    budget.leaveDirectory(realDirectory);
  }
}

function validateLogicalFiles(sourceFiles, label) {
  const files = [...sourceFiles];
  const seen = new Set();
  for (const file of files) {
    assertSafeRelative(file.relative, `${label} file`);
    if (seen.has(file.relative)) {
      throw fail('DUPLICATE_OUTPUT', `${label} has a duplicate logical file: ${file.relative}`, { paths: [file.relative] });
    }
    seen.add(file.relative);
  }
  const sorted = files.sort((left, right) => left.relative.localeCompare(right.relative));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].relative;
    const current = sorted[index].relative;
    if (current.startsWith(`${previous}/`)) {
      throw fail('DUPLICATE_OUTPUT', `${label} has a file-prefix collision: ${previous} and ${current}`, { paths: [previous, current] });
    }
  }
  return sorted;
}

function sourceManifest(sourceDirectory, dependencies = []) {
  const files = validateLogicalFiles([
    ...collectFiles(sourceDirectory),
    ...dependencies.map((dependency) => ({
      relative: dependency.relative,
      absolute: dependency.absolute,
      sourcePath: dependency.source,
    })),
  ], `skill '${path.basename(sourceDirectory)}'`);
  const manifest = [];
  const hashed = [];
  for (const file of files) {
    const content = readPhysicalFile(file.absolute, `canonical source file '${file.relative}'`);
    const fileDigest = sha256Hex(content);
    manifest.push({ path: file.relative, digest: fileDigest });
    hashed.push({ path: file.relative, content });
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content.toString('utf8')))) {
      throw fail('SECRET_DETECTED', `possible secret in canonical source: ${file.relative}`, { paths: [file.relative] });
    }
  }
  return {
    files,
    sourceFiles: manifest,
    sourceFingerprint: treeFingerprint(hashed.map((file) => ({ ...file, type: 'file' }))),
  };
}

function inventoryEntries(inventory) {
  return ['skill', 'module'].flatMap((entityKind) =>
    (Array.isArray(inventory && inventory[`${entityKind}s`]) ? inventory[`${entityKind}s`] : [])
      .filter((entry) => entry && typeof entry === 'object').map((entry) => ({ ...entry, entityKind, identityKey: `${entityKind}:${entry.id}` })));
}

function projectionConfig(inventory) {
  const config = inventory && (inventory.project_agent_projection || inventory.projectAgentProjection);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw fail('INVALID_PROJECT_PROJECTION', 'inventory must declare project_agent_projection');
  }
  return config;
}

function resolveRoots({ sourceRoot = null, projectRoot, outDir, inventory, allowMissingSource = false }) {
  const config = projectionConfig(inventory);
  assertSafeRelative(config.managed_root, 'project projection managed_root');
  assertSafeRelative(config.receipt, 'project projection receipt');
  const source = sourceRoot ? path.resolve(sourceRoot) : null;
  if (!projectRoot && !outDir) throw fail('INVALID_PROJECT_ROOT', 'projectRoot or outDir is required for a relocatable projection');
  const project = path.resolve(projectRoot || path.resolve(outDir, '..', '..'));
  const managed = path.resolve(project, config.managed_root);
  if (outDir && path.resolve(outDir) !== managed) {
    throw fail('INVALID_PROJECT_ROOT', `outDir must match the inventory managed root: ${managed}`, { paths: [outDir, managed] });
  }
  const receipt = path.resolve(project, config.receipt);
  if (isInside(managed, receipt)) {
    throw fail('INVALID_PROJECT_ROOT', 'project projection receipt must be outside the managed root', { paths: [config.receipt, config.managed_root] });
  }
  if (source && (isInside(source, project) || isInside(project, source))) {
    throw fail('PROJECT_ROOT_OVERLAP', 'relocatable projectRoot must not overlap the canonical source checkout');
  }
  const projectStat = lstatOrNull(project);
  if (projectStat && (projectStat.isSymbolicLink() || !projectStat.isDirectory())) {
    throw fail('UNSAFE_PATH', `project root must be a physical directory: ${project}`, { paths: [project] });
  }
  if (projectStat) assertPhysicalAncestors(project, 'project root', project);
  if (source) {
    const sourceStat = lstatOrNull(source);
    if (!sourceStat && !allowMissingSource) {
      throw fail('UNSAFE_SOURCE', `canonical source root is missing: ${source}`, { paths: [source] });
    }
    if (sourceStat && (sourceStat.isSymbolicLink() || !sourceStat.isDirectory())) {
      throw fail('UNSAFE_SOURCE', `canonical source root must be a physical directory: ${source}`, { paths: [source] });
    }
    if (sourceStat) assertPhysicalAncestors(source, 'canonical source root', source);
  }
  const resolvedProjectRoot = project;
  const agentsRoot = path.dirname(managed);
  const claudeManagedRoot = path.join(agentsRoot, CLAUDE_MANAGED_ROOT_NAME);
  const claudeManagedRootRelative = path.relative(project, claudeManagedRoot).split(path.sep).join('/');
  assertSafeRelative(claudeManagedRootRelative, 'project Claude managed root');
  if (claudeManagedRoot === managed || isInside(managed, claudeManagedRoot) || isInside(claudeManagedRoot, managed)) {
    throw fail('INVALID_PROJECT_ROOT', 'project Claude and portable managed roots must be disjoint siblings');
  }
  const agentsStat = lstatOrNull(agentsRoot);
  if (agentsStat && (agentsStat.isSymbolicLink() || !agentsStat.isDirectory())) {
    throw fail('UNSAFE_PATH', `project agents root must be a physical directory: ${agentsRoot}`, { paths: [agentsRoot] });
  }
  assertPhysicalAncestors(agentsRoot, 'project agents root', resolvedProjectRoot);
  const claudeRootStat = lstatOrNull(claudeManagedRoot);
  if (claudeRootStat && (claudeRootStat.isSymbolicLink() || !claudeRootStat.isDirectory())) {
    throw fail('UNSAFE_PATH', `project Claude managed root must be a physical directory: ${claudeManagedRoot}`, { paths: [claudeManagedRoot] });
  }
  assertPhysicalAncestors(claudeManagedRoot, 'project Claude managed root', resolvedProjectRoot);
  const receiptParent = path.dirname(receipt);
  const receiptParentStat = lstatOrNull(receiptParent);
  if (receiptParentStat && (receiptParentStat.isSymbolicLink() || !receiptParentStat.isDirectory())) {
    throw fail('UNSAFE_PATH', `project receipt parent must be a physical directory: ${receiptParent}`, { paths: [receiptParent] });
  }
  assertPhysicalAncestors(receiptParent, 'project receipt parent', resolvedProjectRoot);
  return {
    sourceRoot: source,
    projectRoot: resolvedProjectRoot,
    agentsRoot,
    managedRoot: managed,
    claudeManagedRoot,
    claudeManagedRootRelative,
    receiptPath: receipt,
    config,
    inventory,
  };
}

function planValue(input) {
  if (input && input.ok === true && input.value) return input.value;
  return input;
}

function compilePlan({
  inventory,
  plan,
  profileId = 'portable-core',
  requestedHosts,
  selectedStableIds,
  declaredSelection,
}) {
  const supplied = planValue(plan);
  if (supplied && typeof supplied === 'object' && typeof supplied.planFingerprint === 'string') return supplied;
  const compiled = compileProjectAgentProjection({
    inventory,
    profileId,
    requestedHosts,
    selectedStableIds,
    declaredSelection,
  });
  if (!compiled.ok) throw fail(compiled.error.code, compiled.error.message, compiled.error.details || {});
  return compiled.value;
}

function planEntryMetadata(entry) {
  const metadata = {};
  for (const field of ['skillId', 'publicName', 'invocationClass', 'lifecycle', 'usageSchema', 'usage', 'usageFingerprint', 'provenance']) {
    if (entry[field] !== undefined) metadata[field] = clone(entry[field]);
  }
  return metadata;
}

function outputStableId(stableId, kind, relative) {
  return `${stableId}:${kind}:${relative}`;
}

function sourceEntryFor(planEntry, byId) {
  const source = byId.get(`${planEntry.entityKind || 'skill'}:${planEntry.stableId}`);
  if (!source) throw fail('PROJECT_ENTRY_MISSING', `compiled project entry is absent from inventory: ${planEntry.stableId}`, { stableIds: [planEntry.stableId] });
  return source;
}

function nativeLinkShapeFrom(binding) {
  return binding && binding.bindingShape === DIRECT_SHAPE ? DIRECT_SHAPE : NATIVE_LINK_SHAPE;
}

function buildArtifactInputs({
  sourceRoot,
  inventory,
  plan,
  roots,
  cursorBinding = null,
  codexBinding = null,
  hostSelections = null,
  preserveHostBindings = null,
  preserveBindingPaths = null,
} = {}) {
  const byId = new Map(inventoryEntries(inventory).map((entry) => [entry.identityKey, entry]));
  const adapterEntries = (plan.entries || []).map((planEntry) => {
    const sourceEntry = sourceEntryFor(planEntry, byId);
    const name = safeName(sourceEntry.name || sourceEntry.publicName || path.basename(sourceEntry.path), `inventory entry '${planEntry.stableId}' name`);
    return { stableId: planEntry.stableId, name, discoveryVisible: sourceEntry.discoveryVisible };
  });
  const cursorShape = nativeLinkShapeFrom(cursorBinding);
  const codexShape = nativeLinkShapeFrom(codexBinding);
  let hostBindings = applyHostSelections(clone(plan.hostBindings || {}), hostSelections);
  hostBindings = restorePreservedHostBindings(hostBindings, preserveHostBindings);
  const providers = createProjectAgentProviderAdapters(hostBindings, {
    entries: adapterEntries,
    claudeSourceRoot: roots.claudeManagedRootRelative,
    portableSourceRoot: roots.config.managed_root,
    cursorBindingShape: cursorShape,
    codexBindingShape: codexShape,
  });
  const records = [];
  const receiptEntries = [];
  const sourceFingerprints = {};
  const usedDestinations = new Set();
  const usedPrefixes = new Set();
  const hasPortableDirectoryOutput = providers.directory.hosts.length > 0;
  const hasClaudeDirectoryOutput = providers.directory.hosts.includes('claude');

  const addRecord = ({ stableId, source, destination, content, transform, metadata = {}, sourceStableId = null, sourceFingerprint = null, mode = null, publicationRoot = 'managed' }) => {
    assertSafeRelative(destination, 'generated destination');
    if (!['managed', 'claude'].includes(publicationRoot)) throw fail('INVALID_OUTPUT_ROOT', `generated destination has an unsupported root: ${publicationRoot}`);
    const stagedDestination = publicationRoot === 'claude' ? `${CLAUDE_ARTIFACT_ROOT}/${destination}` : destination;
    const collisionKey = `${publicationRoot}:${destination}`;
    if (usedDestinations.has(collisionKey)) throw fail('DUPLICATE_OUTPUT', `generated destination is duplicated: ${destination}`, { paths: [destination] });
    if (usedPrefixes.has(collisionKey)) throw fail('DUPLICATE_OUTPUT', `generated destination has a file-prefix collision: ${destination}`, { paths: [destination] });
    const segments = destination.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = `${publicationRoot}:${segments.slice(0, index).join('/')}`;
      if (usedDestinations.has(prefix)) {
        throw fail('DUPLICATE_OUTPUT', `generated destination has a file-prefix collision: ${prefix} and ${destination}`, { paths: [prefix, destination] });
      }
    }
    usedDestinations.add(collisionKey);
    for (let index = 1; index < segments.length; index += 1) usedPrefixes.add(`${publicationRoot}:${segments.slice(0, index).join('/')}`);
    const value = {
      stableId,
      source,
      destination: stagedDestination,
      owner: plan.projectionOwner && plan.projectionOwner.owner || 'dhpk.project-agent-projection',
      transform: transform || { id: 'project-agent-generated', version: GENERATOR_VERSION },
      expectedFingerprint: sha256Hex(content),
      mode,
      symlinkPolicy: 'forbid',
      ...(sourceFingerprint ? { sourceFingerprint } : {}),
      ...metadata,
    };
    records.push({ value, content, sourceStableId, publicationRoot, relative: destination });
  };

  for (const planEntry of (plan.entries || []).slice().sort((left, right) => left.stableId.localeCompare(right.stableId))) {
    const sourceEntry = sourceEntryFor(planEntry, byId);
    const name = safeName(sourceEntry.name || sourceEntry.publicName || path.basename(sourceEntry.path), `inventory entry '${planEntry.stableId}' name`);
    if (typeof sourceEntry.path !== 'string' || !sourceEntry.path.startsWith('skills/')) {
      throw fail('UNSAFE_SOURCE', `project entry '${planEntry.stableId}' must use a canonical skills/ path`, { stableIds: [planEntry.stableId] });
    }
    const sourceDirectory = path.resolve(sourceRoot, sourceEntry.path);
    if (!isInside(path.join(sourceRoot, 'skills'), sourceDirectory) || path.basename(sourceDirectory) !== name) {
      throw fail('UNSAFE_SOURCE', `project entry '${planEntry.stableId}' has an unsafe canonical path`, { stableIds: [planEntry.stableId] });
    }
    assertPhysicalAncestors(sourceDirectory, `canonical skill '${name}'`, sourceRoot);
    // The complete physical Skill directory is the projection unit.
    const standaloneDependencies = resolveStandaloneSkillDependencies(inventory, name, sourceRoot);
    for (const dependency of standaloneDependencies) {
      assertPhysicalAncestors(dependency.absolute, `standalone dependency '${dependency.source}'`, sourceRoot);
    }
    const manifest = sourceManifest(sourceDirectory, standaloneDependencies);
    const skillFile = manifest.files.find((file) => file.relative === 'SKILL.md');
    if (!skillFile) throw fail('MISSING_SKILL', `canonical skill '${name}' is missing SKILL.md`, { stableIds: [planEntry.stableId] });
    const skillContent = readPhysicalFile(skillFile.absolute, `canonical skill '${name}/SKILL.md'`);
    const parsed = parseFrontmatter(skillContent.toString('utf8'));
    if (!parsed.present || parsed.values.name !== name || !parsed.values.description) {
      throw fail('INVALID_SKILL_FRONTMATTER', `canonical skill '${name}' has invalid frontmatter`, { stableIds: [planEntry.stableId] });
    }
    sourceFingerprints[`skill:${planEntry.stableId}`] = manifest.sourceFingerprint;
    const metadata = planEntryMetadata(planEntry);
    if (metadata.provenance && typeof metadata.provenance === 'object' && !Array.isArray(metadata.provenance)) {
      metadata.provenance = {
        ...metadata.provenance,
        sourceFingerprint: manifest.sourceFingerprint,
      };
    }
    const generatedPaths = [];
    const claudeGeneratedPaths = [];
    if (hasPortableDirectoryOutput || hasClaudeDirectoryOutput) {
      for (const file of manifest.files) {
        const sourceContent = readPhysicalFile(file.absolute, `canonical skill '${name}/${file.relative}'`);
        const destination = `${name}/${file.relative}`;
        if (hasPortableDirectoryOutput) {
          const portableContent = path.posix.basename(file.relative) === 'SKILL.md'
            ? Buffer.from(portableSkillContent(sourceContent.toString('utf8'), `${name}/${file.relative}`), 'utf8')
            : sourceContent;
          addRecord({
            stableId: outputStableId(planEntry.stableId, 'directory', file.relative),
            source: file.sourcePath || `${sourceEntry.path}/${file.relative}`,
            destination,
            content: portableContent,
            transform: providers.directory.transform,
            metadata,
            sourceStableId: planEntry.stableId,
            sourceFingerprint: manifest.sourceFingerprint,
            mode: lstatOrNull(file.absolute).mode & 0o7777,
          });
          generatedPaths.push(destination);
        }
        if (hasClaudeDirectoryOutput) {
          addRecord({
            stableId: outputStableId(planEntry.stableId, 'claude-directory', file.relative),
            source: file.sourcePath || `${sourceEntry.path}/${file.relative}`,
            destination,
            content: sourceContent,
            transform: providers.directory.transform,
            metadata,
            sourceStableId: planEntry.stableId,
            sourceFingerprint: manifest.sourceFingerprint,
            mode: lstatOrNull(file.absolute).mode & 0o7777,
            publicationRoot: 'claude',
          });
          claudeGeneratedPaths.push(destination);
        }
      }
    }
    if (providers.directFile.hosts.length > 0) {
      // AGY consumes a direct file. It is intentionally the complete
      // canonical body, not a pointer into the source checkout. The sibling
      // package option is deliberately absent here: only a later, passing
      // AGY consumer probe can authorize that optimization.
      const direct = renderAgyDirectFile({
        name,
        description: parsed.values.description,
        body: Buffer.from(portableSkillContent(skillContent.toString('utf8'), `${name}/SKILL.md`), 'utf8'),
      });
      const destination = `${name}.md`;
      addRecord({
        stableId: outputStableId(planEntry.stableId, 'agy', 'direct'),
        source: `${sourceEntry.path}/SKILL.md`,
        destination,
        content: direct.content,
        transform: providers.directFile.transform,
        metadata,
        sourceStableId: planEntry.stableId,
        sourceFingerprint: manifest.sourceFingerprint,
      });
      generatedPaths.push(destination);
    }
    receiptEntries.push({
      entityKind: 'skill',
      stableId: planEntry.stableId,
      name,
      ...(sourceEntry.discoveryVisible === false ? { discoveryVisible: false } : {}),
      source: sourceEntry.path,
      sourceFingerprint: manifest.sourceFingerprint,
      sourceFiles: manifest.sourceFiles,
      generatedPaths: generatedPaths.sort(),
      claudeGeneratedPaths: claudeGeneratedPaths.sort(),
      ...metadata,
    });
  }

  const dependencies = plan.dependencyClosure && Array.isArray(plan.dependencyClosure.files)
    ? plan.dependencyClosure.files
    : [];
  for (const dependency of dependencies.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    if (!dependency || typeof dependency.source !== 'string' || typeof dependency.destination !== 'string') {
      throw fail('INVALID_SUPPORTING_ASSET', `supporting asset '${dependency && dependency.id}' lacks source or destination`);
    }
    const source = path.resolve(sourceRoot, dependency.source);
    if (!isInside(sourceRoot, source)) throw fail('UNSAFE_SOURCE', `supporting asset escapes source root: ${dependency.source}`, { paths: [dependency.source] });
    assertPhysicalAncestors(source, `supporting asset '${dependency.id}'`, sourceRoot);
    const content = readPhysicalFile(source, `supporting asset '${dependency.id}'`);
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content.toString('utf8')))) {
      throw fail('SECRET_DETECTED', `possible secret in supporting asset: ${dependency.source}`, { paths: [dependency.source] });
    }
    addRecord({
      stableId: outputStableId(String(dependency.id), 'asset', dependency.destination),
      source: dependency.source,
      destination: dependency.destination,
      content,
      transform: { id: 'project-agent-supporting-asset', version: '1' },
      sourceStableId: String(dependency.id),
    });
  }

  const generatedFingerprints = Object.fromEntries(records
    .filter((record) => record.publicationRoot === 'managed')
    .map((record) => [record.relative, record.value.expectedFingerprint])
    .sort(([left], [right]) => left.localeCompare(right)));
  const claudeGeneratedFingerprints = Object.fromEntries(records
    .filter((record) => record.publicationRoot === 'claude')
    .map((record) => [record.relative, record.value.expectedFingerprint])
    .sort(([left], [right]) => left.localeCompare(right)));
  const manifestValue = {
    schema: 'dhpk.agents-skills-projection.v1',
    generatorVersion: GENERATOR_VERSION,
    fingerprint_algorithm: TREE_FINGERPRINT_ALGORITHM,
    selectionSurface: 'project-agent-projection',
    inventoryRevision: plan.inventoryRevision || null,
    selectedIds: (plan.selectedStableIds || []).slice().sort(),
    emittedIds: (plan.entries || []).map((entry) => entry.stableId).sort(),
    entries: receiptEntries.slice().sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: Object.keys(generatedFingerprints).sort(),
    generatedFingerprints,
    claudeManagedRoot: roots.claudeManagedRootRelative,
    claudeManagedPaths: Object.keys(claudeGeneratedFingerprints).sort(),
    claudeGeneratedFingerprints,
  };
  const manifestContent = Buffer.from(`${stableStringify(manifestValue)}\n`, 'utf8');
  addRecord({
    stableId: 'project-agent-projection-manifest',
    source: 'project-agent-projection-manifest',
    destination: LEGACY_MANIFEST_NAME,
    content: manifestContent,
    transform: { id: 'project-agent-manifest', version: '1' },
    sourceStableId: null,
  });

  const artifactEntries = records.map((record) => record.value);
  const artifactPlanResult = createDistributionPlan({
    surface: 'project-agent-projection-artifact',
    compilerVersion: `project-agent-projection-${GENERATOR_VERSION}`,
    inventoryFingerprint: plan.inventoryFingerprint || fingerprint(inventory),
    inventoryRevision: plan.inventoryRevision || null,
    inputFingerprint: fingerprint({
      parentPlanFingerprint: plan.planFingerprint,
      generated: artifactEntries.map((entry) => ({ stableId: entry.stableId, destination: entry.destination, expectedFingerprint: entry.expectedFingerprint })),
    }),
    ownershipRoot: roots.config.managed_root,
    selectionPolicy: { source: 'project_agent_projection', version: 'dhpk.project-agent-projection-artifact.v1' },
    selectionFingerprint: plan.selectionFingerprint || null,
    surfaceSelectionFingerprint: plan.surfaceSelectionFingerprint || null,
    externalSkillPackagesFingerprint: plan.externalSkillPackagesFingerprint,
    entries: artifactEntries,
    scope: plan.scope,
    projectionOwner: plan.projectionOwner,
    requestedHosts: plan.requestedHosts,
    profileFingerprint: plan.profileFingerprint,
    dependencyClosure: plan.dependencyClosure,
    capabilityDecisions: plan.capabilityDecisions,
    capabilityEvidenceFingerprint: plan.capabilityEvidenceFingerprint,
    hostBindings: plan.hostBindings,
    selected: plan.selected,
    skipped: plan.skipped,
    incompatible: plan.incompatible,
    writes: artifactEntries.map((entry) => ({ stableId: entry.stableId, destination: entry.destination })),
  });
  if (!artifactPlanResult.ok) throw fail(artifactPlanResult.error.code, artifactPlanResult.error.message, artifactPlanResult.error.details || {});

  let bindingPaths = {};
  if (preserveBindingPaths && typeof preserveBindingPaths === 'object' && !Array.isArray(preserveBindingPaths)) {
    for (const hostId of Object.keys(preserveBindingPaths)) {
      bindingPaths[hostId] = clone(preserveBindingPaths[hostId]);
    }
  }
  const preservedHosts = new Set(Object.keys(preserveHostBindings || {}));
  // 舊 receipt 的 Claude discovery 仍指向 portable root；保留選取集合，
  // 但依目前 schema 重建 discovery，避免升級後留下無法驗證的舊連結。
  ({ hostBindings, bindingPaths } = stampDiscoveryHost(hostBindings, bindingPaths, providers, {
    hostId: 'claude',
  }));
  if (!preservedHosts.has('cursor')) {
    ({ hostBindings, bindingPaths } = stampDiscoveryHost(hostBindings, bindingPaths, providers, {
      hostId: 'cursor',
      bindingShape: cursorShape,
      bindingReason: cursorBinding && cursorBinding.reason ? cursorBinding.reason : null,
    }));
  }
  if (!preservedHosts.has('codex')) {
    ({ hostBindings, bindingPaths } = stampDiscoveryHost(hostBindings, bindingPaths, providers, {
      hostId: 'codex',
      bindingShape: codexShape,
      bindingReason: codexBinding && codexBinding.reason ? codexBinding.reason : null,
    }));
  }

  return {
    plan: artifactPlanResult.value,
    records,
    receiptEntries,
    sourceFingerprints,
    generatedFingerprints: Object.fromEntries(records
      .filter((record) => record.publicationRoot === 'managed')
      .map((record) => [record.relative, record.value.expectedFingerprint])),
    claudeGeneratedFingerprints: Object.fromEntries(records
      .filter((record) => record.publicationRoot === 'claude')
      .map((record) => [record.relative, record.value.expectedFingerprint])),
    hostBindings,
    bindingPaths,
    selectedIds: (plan.selectedStableIds || []).slice().sort(),
    emittedIds: (plan.entries || []).map((entry) => entry.stableId).sort(),
    parentPlan: plan,
  };
}

function receiptPayload(receipt) {
  const payload = { ...receipt };
  delete payload.receiptFingerprint;
  return payload;
}

function sealReceipt(receipt) {
  const payload = receiptPayload(receipt);
  return { ...payload, receiptFingerprint: sha256Hex(stableStringify(payload)) };
}

function receiptFileDigest(receipt) {
  return sha256Hex(`${stableStringify(receipt)}\n`);
}

function readJsonFile(filePath, label) {
  const stat = lstatOrNull(filePath);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw fail('INVALID_RECEIPT', `${label} must be a regular file: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw fail('INVALID_RECEIPT', `${label} is invalid JSON: ${error.message}`);
  }
}

function validateReceipt(receipt, roots, bindingOptions = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw fail('INVALID_RECEIPT', 'project projection receipt must be an object');
  if (![PROJECT_RECEIPT_SCHEMA, PREVIOUS_PROJECT_RECEIPT_SCHEMA, LEGACY_PROJECT_RECEIPT_SCHEMA].includes(receipt.schema)) {
    throw fail('INVALID_RECEIPT', `project projection receipt must use ${PROJECT_RECEIPT_SCHEMA}, ${PREVIOUS_PROJECT_RECEIPT_SCHEMA}, or ${LEGACY_PROJECT_RECEIPT_SCHEMA}`);
  }
  const typedReceipt = receipt.schema === PROJECT_RECEIPT_SCHEMA || receipt.schema === PREVIOUS_PROJECT_RECEIPT_SCHEMA;
  // The marker gate runs before the version check so a 2.0.0 receipt (written
  // without the marker) gets the version-boundary diagnostic.
  // 舊版雜湊配方已移除；僅解除安裝可讀取完整驗證的舊收據，不能以其宣稱刪除內容。
  const releaseLegacy = bindingOptions.releaseLegacy === true
    && !Object.prototype.hasOwnProperty.call(receipt, 'fingerprint_algorithm')
    && receipt.generatorVersion === '2.0.0';
  if (!releaseLegacy) {
    try { requireTreeMerkle(receipt.fingerprint_algorithm, 'fingerprint_algorithm'); } catch (error) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${error.message}`);
    }
    if (!ACCEPTED_GENERATOR_VERSIONS.includes(receipt.generatorVersion)) throw fail('INVALID_RECEIPT', `project projection receipt must use generator ${GENERATOR_VERSION}`);
  }
  if (receipt.scope !== 'project' || receipt.managedRoot !== roots.config.managed_root || receipt.receiptPath !== roots.config.receipt) {
    throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid ownership root');
  }
  if (!receipt.projectionOwner || receipt.projectionOwner.owner !== roots.config.owner) {
    throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid projection owner');
  }
  if (releaseLegacy && (receipt.projectionOwner.scope !== roots.config.scope
    || receipt.projectionOwner.managedRoot !== roots.config.managed_root
    || receipt.projectionOwner.receipt !== roots.config.receipt)) {
    throw fail('INVALID_RECEIPT', 'legacy project projection receipt has an invalid projection ownership boundary');
  }
  if (!DIGEST_PATTERN.test(receipt.receiptFingerprint || '')
    || sha256Hex(stableStringify(receiptPayload(receipt))) !== receipt.receiptFingerprint) {
    throw fail('INVALID_RECEIPT', 'project projection receipt fingerprint is invalid');
  }
  const legacyUnbound = receipt.legacyUnbound === true;
  for (const field of ['planFingerprint', 'artifactFingerprint']) {
    if (legacyUnbound ? receipt[field] !== null : !DIGEST_PATTERN.test(receipt[field] || '')) {
      throw fail('INVALID_RECEIPT', `project projection receipt field '${field}' is invalid`);
    }
  }
  for (const field of ['profileFingerprint', 'selectionFingerprint', 'surfaceSelectionFingerprint', 'capabilityEvidenceFingerprint']) {
    if (legacyUnbound ? receipt[field] !== null : (receipt[field] !== null && receipt[field] !== undefined && !DIGEST_PATTERN.test(receipt[field]))) {
      throw fail('INVALID_RECEIPT', `project projection receipt field '${field}' is invalid`);
    }
  }
  for (const field of ['selectedIds', 'emittedIds', 'managedPaths']) {
    if (!Array.isArray(receipt[field]) || receipt[field].some((value) => typeof value !== 'string')) {
      throw fail('INVALID_RECEIPT', `project projection receipt field '${field}' must be a string array`);
    }
  }
  if (new Set(receipt.managedPaths).size !== receipt.managedPaths.length) throw fail('INVALID_RECEIPT', 'project projection receipt has duplicate managed paths');
  if (!receipt.generatedFingerprints || typeof receipt.generatedFingerprints !== 'object' || Array.isArray(receipt.generatedFingerprints)) {
    throw fail('INVALID_RECEIPT', 'project projection receipt is missing generated fingerprints');
  }
  const paths = receipt.managedPaths.slice().sort();
  for (const relative of paths) {
    assertSafeRelative(relative, 'receipt managed path');
    if (!DIGEST_PATTERN.test(receipt.generatedFingerprints[relative] || '')) {
      throw fail('INVALID_RECEIPT', `project projection receipt has an invalid fingerprint for '${relative}'`, { paths: [relative] });
    }
  }
  for (const key of Object.keys(receipt.generatedFingerprints)) {
    if (!receipt.managedPaths.includes(key)) throw fail('INVALID_RECEIPT', `project projection receipt has an unlisted fingerprint: ${key}`, { paths: [key] });
  }
  if (receipt.schema === PROJECT_RECEIPT_SCHEMA) {
    if (receipt.claudeManagedRoot !== roots.claudeManagedRootRelative) {
      throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid Claude ownership root');
    }
    for (const field of ['claudeManagedPaths']) {
      if (!Array.isArray(receipt[field]) || receipt[field].some((value) => typeof value !== 'string')) {
        throw fail('INVALID_RECEIPT', `project projection receipt field '${field}' must be a string array`);
      }
    }
    if (new Set(receipt.claudeManagedPaths).size !== receipt.claudeManagedPaths.length) {
      throw fail('INVALID_RECEIPT', 'project projection receipt has duplicate Claude managed paths');
    }
    if (!receipt.claudeGeneratedFingerprints || typeof receipt.claudeGeneratedFingerprints !== 'object' || Array.isArray(receipt.claudeGeneratedFingerprints)) {
      throw fail('INVALID_RECEIPT', 'project projection receipt is missing Claude generated fingerprints');
    }
    for (const relative of receipt.claudeManagedPaths.slice().sort()) {
      assertSafeRelative(relative, 'receipt Claude managed path');
      if (!DIGEST_PATTERN.test(receipt.claudeGeneratedFingerprints[relative] || '')) {
        throw fail('INVALID_RECEIPT', `project projection receipt has an invalid Claude fingerprint for '${relative}'`, { paths: [relative] });
      }
    }
    for (const key of Object.keys(receipt.claudeGeneratedFingerprints)) {
      if (!receipt.claudeManagedPaths.includes(key)) throw fail('INVALID_RECEIPT', `project projection receipt has an unlisted Claude fingerprint: ${key}`, { paths: [key] });
    }
  }
  if (!Array.isArray(receipt.entries)) throw fail('INVALID_RECEIPT', 'project projection receipt is missing entries');
  if (!receipt.sourceFingerprints || typeof receipt.sourceFingerprints !== 'object' || Array.isArray(receipt.sourceFingerprints)) {
    throw fail('INVALID_RECEIPT', 'project projection receipt is missing source fingerprints');
  }
  const ids = new Set();
  const names = new Set();
  for (const entry of receipt.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.stableId !== 'string' || typeof entry.name !== 'string') throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid entry');
    if (ids.has(entry.stableId) || names.has(entry.name)) throw fail('INVALID_RECEIPT', 'project projection receipt has duplicate entries');
    if (typedReceipt && entry.entityKind !== 'skill') throw fail('INVALID_RECEIPT', 'emitted receipt identity must be a skill');
    ids.add(entry.stableId);
    names.add(safeName(entry.name, 'receipt entry name'));
    if (typeof entry.source !== 'string' || !/^skills\/[^/]+(?:\/[^/]+)*$/.test(entry.source)) throw fail('INVALID_RECEIPT', `receipt source is invalid for '${entry.name}'`);
    assertSafeRelative(entry.source, 'receipt source');
    if (!DIGEST_PATTERN.test(entry.sourceFingerprint || '')) throw fail('INVALID_RECEIPT', `receipt source fingerprint is invalid for '${entry.name}'`);
    if (!legacyUnbound && receipt.sourceFingerprints[typedReceipt ? `skill:${entry.stableId}` : entry.stableId] !== entry.sourceFingerprint) {
      throw fail('INVALID_RECEIPT', `receipt source fingerprint map does not match '${entry.name}'`);
    }
    if (!Array.isArray(entry.sourceFiles)) throw fail('INVALID_RECEIPT', `receipt source manifest is missing for '${entry.name}'`);
    for (const sourceFile of entry.sourceFiles) {
      assertSafeRelative(sourceFile.path, 'receipt source path');
      if (!DIGEST_PATTERN.test(sourceFile.digest || '')) throw fail('INVALID_RECEIPT', `receipt source manifest is invalid for '${entry.name}'`);
    }
    if (!Array.isArray(entry.generatedPaths)
      || (receipt.schema !== PROJECT_RECEIPT_SCHEMA && entry.generatedPaths.length === 0)) {
      throw fail('INVALID_RECEIPT', `receipt generated paths are missing for '${entry.name}'`);
    }
    for (const generatedPath of entry.generatedPaths) {
      assertSafeRelative(generatedPath, 'receipt generated path');
      if (!receipt.managedPaths.includes(generatedPath)) throw fail('INVALID_RECEIPT', `receipt entry claims an unlisted path: ${generatedPath}`, { paths: [generatedPath] });
    }
    if (receipt.schema === PROJECT_RECEIPT_SCHEMA) {
      if (!Array.isArray(entry.claudeGeneratedPaths)
        || (entry.generatedPaths.length + entry.claudeGeneratedPaths.length === 0)) {
        throw fail('INVALID_RECEIPT', `receipt Claude generated paths are missing for '${entry.name}'`);
      }
      for (const generatedPath of entry.claudeGeneratedPaths) {
        assertSafeRelative(generatedPath, 'receipt Claude generated path');
        if (!receipt.claudeManagedPaths.includes(generatedPath)) {
          throw fail('INVALID_RECEIPT', `receipt entry claims an unlisted Claude path: ${generatedPath}`, { paths: [generatedPath] });
        }
      }
    }
  }
  for (const stableId of Object.keys(receipt.sourceFingerprints)) {
    if ((typedReceipt && !stableId.startsWith('skill:'))
      || !ids.has(typedReceipt ? stableId.slice(6) : stableId) || !DIGEST_PATTERN.test(receipt.sourceFingerprints[stableId] || '')) {
      throw fail('INVALID_RECEIPT', `project projection receipt has an invalid source fingerprint entry: ${stableId}`);
    }
  }
  if (!receipt.hostBindings || typeof receipt.hostBindings !== 'object' || Array.isArray(receipt.hostBindings)
    || !receipt.bindings || typeof receipt.bindings !== 'object' || Array.isArray(receipt.bindings)) {
    throw fail('INVALID_RECEIPT', 'project projection receipt is missing Host bindings');
  }
  if (stableStringify(receipt.hostBindings) !== stableStringify(receipt.bindings)) {
    throw fail('INVALID_RECEIPT', 'project projection receipt Host binding aliases disagree');
  }
  if (typedReceipt) {
    for (const [field, idsField] of [['selectedIdentities', 'selectedIds'], ['emittedIdentities', 'emittedIds']]) {
      const identities = receipt[field];
      if (!Array.isArray(identities) || identities.some((entry) => !entry || !['skill', 'module'].includes(entry.entityKind)
        || typeof entry.stableId !== 'string' || entry.stableId.length === 0)
        || new Set(identities.map((entry) => `${entry.entityKind}:${entry.stableId}`)).size !== identities.length
        || stableStringify(identities.map((entry) => entry.stableId).sort()) !== stableStringify(receipt[idsField].slice().sort())) {
        throw fail('INVALID_RECEIPT', `receipt ${field} must contain complete, unique typed identities`);
      }
    }
    if (stableStringify(receipt.emittedIdentities.map((entry) => `${entry.entityKind}:${entry.stableId}`).sort())
      !== stableStringify(receipt.entries.map((entry) => `skill:${entry.stableId}`).sort())) {
      throw fail('INVALID_RECEIPT', 'receipt emitted identities disagree with source entries');
    }
  } else {
    // Only validated emitted skills prove historical kind. A requested selection
    // cannot establish ownership for selected-only legacy identities. Retired
    // selected-only IDs need no kind because they will not enter the new plan.
    if (receipt.emittedIds.some((id) => !receipt.entries.some((entry) => entry.stableId === id))) {
      throw fail('INVALID_RECEIPT', 'legacy receipt emitted identity is missing source proof');
    }
    for (const id of receipt.selectedIds) {
      if (receipt.entries.some((entry) => entry.stableId === id)) continue;
      const matches = inventoryEntries(roots.inventory).filter((entry) => entry.id === id);
      if (matches.length > 1) {
        throw fail('AMBIGUOUS_LEGACY_IDENTITY', `legacy receipt identity '${id}' cannot be resolved uniquely; skill:${id} and module:${id} require historical evidence`);
      }
    }
  }
  validateReceiptBindings(receipt, roots, bindingOptions);
  if (receipt.rollback !== null && receipt.rollback !== undefined) {
    const expectedRollbackSchema = receipt.schema === PROJECT_RECEIPT_SCHEMA ? PROJECT_ROLLBACK_SCHEMA : LEGACY_PROJECT_ROLLBACK_SCHEMA;
    if (!receipt.rollback || receipt.rollback.schema !== expectedRollbackSchema
      || receipt.rollback.root !== '.agents/.dhpk-projection-rollback'
      || receipt.rollback.receipt !== 'receipt.json' || receipt.rollback.files !== 'files'
      || (receipt.rollback.layout !== undefined
        && (expectedRollbackSchema !== LEGACY_PROJECT_ROLLBACK_SCHEMA || receipt.rollback.layout !== 'grouped'))
      || !DIGEST_PATTERN.test(receipt.rollback.fingerprint || '')) {
      throw fail('INVALID_RECEIPT', 'project projection receipt rollback metadata is invalid');
    }
    if (receipt.rollback.adoptedBindingPaths !== undefined) {
      normalizeBindingPaths(receipt.rollback.adoptedBindingPaths, roots, 'project projection rollback adopted binding paths', { allowClaudeRoot: true });
    }
  }
  return receipt;
}

function readProjectionReceipt(roots, bindingOptions = {}) {
  const stat = lstatOrNull(roots.receiptPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail('INVALID_RECEIPT', `project projection receipt is not a regular file: ${roots.receiptPath}`);
  return validateReceipt(readJsonFile(roots.receiptPath, 'project projection receipt'), roots, bindingOptions);
}

function readProjectProjectionReceipt(roots) {
  return readProjectionReceipt(roots);
}

function readLifecycleProjectionReceipt(roots) {
  // 自癒只能隨發布或移除完成；一般驗證與 rollback 仍使用嚴格讀取入口。
  return readProjectionReceipt(roots, { allowLegacyClaudeDiscovery: true });
}

function legacyManifestPath(roots) {
  return path.join(roots.managedRoot, LEGACY_MANIFEST_NAME);
}

function inferLegacyBindingPaths(roots, entries) {
  const hosts = [
    { hostId: 'claude', destinationRoot: CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT },
    { hostId: 'cursor', destinationRoot: CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT },
  ];
  const bindingPaths = {};
  for (const { hostId, destinationRoot } of hosts) {
    const host = roots.config.hosts && roots.config.hosts[hostId];
    if (!host || host.shape !== 'project-skill-directory') continue;
    const found = [];
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !SAFE_NAME.test(entry.name)) continue;
      const relativePath = `${destinationRoot}/${entry.name}`;
      const expectedTarget = path.posix.relative(destinationRoot, `${roots.config.managed_root}/${entry.name}`);
      const target = bindingDestinationIn(roots, relativePath, `legacy ${hostId} binding path`);
      const stat = lstatOrNull(target);
      if (!stat || !stat.isSymbolicLink()) continue;
      if (fs.readlinkSync(target) === expectedTarget) found.push({ path: relativePath, target: expectedTarget });
    }
    if (found.length > 0) {
      bindingPaths[hostId] = found.sort((left, right) => left.path.localeCompare(right.path));
    }
  }
  return bindingPaths;
}

function isProjectProjectionManifest(manifest) {
  return Boolean(manifest)
    && manifest.schema === 'dhpk.agents-skills-projection.v1'
    && PROJECT_PROJECTION_MANIFEST_GENERATORS.includes(manifest.generatorVersion)
    && manifest.selectionSurface === 'project-agent-projection';
}

function verifyManifestFiles(root, paths, fingerprints, label) {
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length
    || !fingerprints || typeof fingerprints !== 'object' || Array.isArray(fingerprints)
    || Object.keys(fingerprints).length !== paths.length) {
    throw fail('LEGACY_UNBOUND', `${label} manifest shape is invalid`);
  }
  for (const relative of paths) {
    assertSafeRelative(relative, `${label} path`);
    if (relative === LEGACY_MANIFEST_NAME || !DIGEST_PATTERN.test(fingerprints[relative] || '')) {
      throw fail('LEGACY_UNBOUND', `${label} path is invalid: ${relative}`, { paths: [relative] });
    }
    const target = pathIn(root, relative, `${label} path`);
    const stat = lstatOrNull(target);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || sha256Hex(fs.readFileSync(target)) !== fingerprints[relative]) {
      throw fail('LEGACY_UNBOUND', `${label} path cannot prove ownership: ${relative}`, { paths: [relative] });
    }
  }
  return paths.slice().sort();
}

// 2.x 專案投影 manifest 沒有 receipt seal；只以現場指紋證明所有權，發布時改走觀察式採用。
function adoptProjectProjectionManifest(roots, legacyPath, manifest) {
  if (manifest.claudeManagedRoot !== undefined && manifest.claudeManagedRoot !== roots.claudeManagedRootRelative) {
    throw fail('LEGACY_UNBOUND', 'project projection manifest Claude root does not match this project');
  }
  const managedPaths = verifyManifestFiles(roots.managedRoot, manifest.managedPaths, manifest.generatedFingerprints, 'project projection manifest');
  const claudeManagedPaths = verifyManifestFiles(roots.claudeManagedRoot, manifest.claudeManagedPaths || [], manifest.claudeGeneratedFingerprints || {}, 'project projection manifest Claude');
  const observed = readPhysicalFile(legacyPath, 'project projection manifest');
  if (stableStringify(JSON.parse(observed)) !== stableStringify(manifest)) throw fail('MANAGED_CONTENT_CHANGED', 'project projection manifest changed during validation');
  return {
    legacyProjectionManifest: true,
    manifestDigest: sha256Hex(observed),
    managedPaths: [...managedPaths, LEGACY_MANIFEST_NAME].sort(),
    claudeManagedPaths,
    manifestFingerprints: { ...manifest.generatedFingerprints, [LEGACY_MANIFEST_NAME]: sha256Hex(observed) },
    manifestClaudeFingerprints: { ...(manifest.claudeGeneratedFingerprints || {}) },
    bindingPaths: {},
  };
}

// 觀察式採用會替換所有與候選重疊的檔案；2.x manifest 必須逐一證明這些檔案的所有權。
function assertManifestOwnsObserved(previous, observed) {
  const pairs = [
    [observed.generatedFingerprints, previous.manifestFingerprints, 'project projection manifest'],
    [observed.claudeGeneratedFingerprints, previous.manifestClaudeFingerprints, 'project projection manifest Claude'],
  ];
  for (const [observedFingerprints, owned, label] of pairs) {
    for (const [relative, digest] of Object.entries(observedFingerprints)) {
      if (owned[relative] !== digest) throw fail('LEGACY_UNBOUND', `${label} path cannot prove ownership: ${relative}`, { paths: [relative] });
    }
  }
}

function adoptLegacyManifest(roots) {
  const legacyPath = legacyManifestPath(roots);
  const manifest = readJsonFile(legacyPath, 'legacy project projection manifest');
  if (isProjectProjectionManifest(manifest)) return adoptProjectProjectionManifest(roots, legacyPath, manifest);
  if (!manifest || manifest.schema !== 'dhpk.agents-skills-projection.v1' || manifest.generatorVersion !== '1.1.0') throw fail('LEGACY_UNBOUND', 'legacy project projection manifest has an unsupported schema or generator');
  if (manifest && manifest.schema === 'dhpk.agents-skills-projection.v1'
    && manifest.generatorVersion === '1.1.0' && !Object.prototype.hasOwnProperty.call(manifest, 'fingerprint_algorithm')) {
    // 舊版 standalone 不具 receipt seal；限制每個路徑必須由其 entry 對應，且不以舊雜湊宣稱所有權。
    if ((manifest.selectionSurface !== undefined && manifest.selectionSurface !== 'agent-plugin')
      || !Array.isArray(manifest.selectedIds) || manifest.selectedIds.some((id) => typeof id !== 'string' || !id)
      || new Set(manifest.selectedIds).size !== manifest.selectedIds.length || !Array.isArray(manifest.entries)
      || !Array.isArray(manifest.managedPaths) || new Set(manifest.managedPaths).size !== manifest.managedPaths.length
      || !manifest.generatedFingerprints || typeof manifest.generatedFingerprints !== 'object' || Array.isArray(manifest.generatedFingerprints)) throw fail('LEGACY_UNBOUND', 'legacy manifest shape is invalid');
    const ids = new Set();
    const names = new Set();
    const allowed = new Set();
    for (const entry of manifest.entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || names.has(entry.name)
        || typeof entry.name !== 'string' || !SAFE_NAME.test(entry.name) || entry.source !== `skills/${entry.name}`
        || entry.cursorPath !== `${entry.name}/SKILL.md` || entry.agyPath !== `${entry.name}.md`
        || !DIGEST_PATTERN.test(entry.sourceFingerprint || '')) throw fail('LEGACY_UNBOUND', 'legacy manifest entry is invalid');
      ids.add(entry.id); names.add(entry.name);
      allowed.add(entry.agyPath); allowed.add(entry.cursorPath);
      if (entry.sourceFiles !== undefined) {
        if (!Array.isArray(entry.sourceFiles)) throw fail('LEGACY_UNBOUND', 'legacy manifest source files are invalid');
        const seen = new Set();
        for (const file of entry.sourceFiles) {
          if (!file || typeof file.path !== 'string' || seen.has(file.path) || !DIGEST_PATTERN.test(file.digest || '')) throw fail('LEGACY_UNBOUND', 'legacy manifest source file is invalid');
          assertSafeRelative(file.path, 'legacy manifest source path'); seen.add(file.path); allowed.add(`${entry.name}/${file.path}`);
        }
      }
    }
    if (Object.keys(manifest.generatedFingerprints).length !== manifest.managedPaths.length) throw fail('LEGACY_UNBOUND', 'legacy manifest fingerprints are invalid');
    for (const relative of manifest.managedPaths) {
      assertSafeRelative(relative, 'legacy manifest path');
      if (!allowed.has(relative) || !DIGEST_PATTERN.test(manifest.generatedFingerprints[relative] || '')) throw fail('LEGACY_UNBOUND', `legacy manifest path is invalid: ${relative}`);
    }
    const observed = readPhysicalFile(legacyPath, 'legacy manifest');
    if (stableStringify(JSON.parse(observed)) !== stableStringify(manifest)) throw fail('MANAGED_CONTENT_CHANGED', 'legacy manifest changed during validation');
    return { legacyUnmarkedManifest: true, manifestDigest: sha256Hex(observed), managedPaths: manifest.managedPaths };
  }
  if (!Array.isArray(manifest.managedPaths) || !manifest.generatedFingerprints || typeof manifest.generatedFingerprints !== 'object') {
    throw fail('LEGACY_UNBOUND', 'legacy project projection manifest cannot establish ownership');
  }
  const legacyManifestDigest = sha256Hex(fs.readFileSync(legacyPath));
  const managedPaths = [...new Set([...manifest.managedPaths, LEGACY_MANIFEST_NAME])].sort();
  const generatedFingerprints = {
    ...manifest.generatedFingerprints,
    [LEGACY_MANIFEST_NAME]: manifest.generatedFingerprints[LEGACY_MANIFEST_NAME] || legacyManifestDigest,
  };
  for (const relative of managedPaths) {
    assertSafeRelative(relative, 'legacy managed path');
    const target = pathIn(roots.managedRoot, relative, 'legacy managed path');
    const stat = lstatOrNull(target);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || !DIGEST_PATTERN.test(generatedFingerprints[relative] || '')
      || sha256Hex(fs.readFileSync(target)) !== generatedFingerprints[relative]) {
      throw fail('LEGACY_UNBOUND', `legacy managed path cannot prove ownership: ${relative}`, { paths: [relative] });
    }
  }
  try { requireTreeMerkle(manifest.fingerprint_algorithm, 'fingerprint_algorithm'); } catch (error) {
    throw fail('LEGACY_UNBOUND', `legacy project projection manifest ${error.message}`);
  }
  const entries = Array.isArray(manifest.entries)
    ? manifest.entries.map((entry) => ({
      stableId: entry.stableId || entry.id,
      name: entry.name,
      source: entry.source,
      sourceFingerprint: entry.sourceFingerprint,
      sourceFiles: entry.sourceFiles || [],
      generatedPaths: entry.generatedPaths || [entry.cursorPath, entry.agyPath].filter(Boolean),
    }))
    : [];
  const bindingPaths = inferLegacyBindingPaths(roots, entries);
  const adopted = sealReceipt({
    schema: LEGACY_PROJECT_RECEIPT_SCHEMA,
    generatorVersion: GENERATOR_VERSION,
    fingerprint_algorithm: TREE_FINGERPRINT_ALGORITHM,
    scope: 'project',
    managedRoot: roots.config.managed_root,
    receiptPath: roots.config.receipt,
    projectionOwner: {
      scope: roots.config.scope,
      owner: roots.config.owner,
      managedRoot: roots.config.managed_root,
      receipt: roots.config.receipt,
    },
    profileId: null,
    profile: null,
    profileFingerprint: null,
    selectionFingerprint: null,
    capabilityEvidenceFingerprint: null,
    planFingerprint: null,
    artifactFingerprint: null,
    selectedIds: Array.isArray(manifest.selectedIds) ? manifest.selectedIds.slice().sort() : [],
    emittedIds: Array.isArray(manifest.emittedIds) ? manifest.emittedIds.slice().sort() : [],
    dependencyClosure: null,
    hostBindings: {},
    bindings: {},
    entries,
    managedPaths,
    generatedFingerprints,
    sourceFingerprints: {},
    bindingPaths,
    rollback: null,
    legacyUnbound: true,
  });
  return adopted;
}

function validateManagedFiles(roots, receipt, { requireBindings = true } = {}) {
  const managedRoots = [{
    root: roots.managedRoot,
    paths: receipt.managedPaths,
    fingerprints: receipt.generatedFingerprints,
    label: 'managed',
  }];
  if (receipt.schema === PROJECT_RECEIPT_SCHEMA) {
    managedRoots.push({
      root: roots.claudeManagedRoot,
      paths: receipt.claudeManagedPaths,
      fingerprints: receipt.claudeGeneratedFingerprints,
      label: 'Claude managed',
    });
  }
  for (const managed of managedRoots) for (const relative of managed.paths.slice().sort()) {
    const target = pathIn(managed.root, relative, `receipt-owned ${managed.label} path`);
    const stat = lstatOrNull(target);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      throw fail('MANAGED_CONTENT_MISSING', `receipt-owned ${managed.label} file is missing or unsafe: ${relative}; expected SHA-256: ${managed.fingerprints[relative]}; restore a physical backup matching the current receipt fingerprints before retrying; --repair and --rollback do not restore missing current-receipt content; see docs/platform-installation.md#recover-receipt-owned-shared-skills`, { paths: [relative] });
    }
    const actual = sha256Hex(fs.readFileSync(target));
    if (actual !== managed.fingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned ${managed.label} file was modified or fingerprint drifted: ${relative}; expected SHA-256: ${managed.fingerprints[relative]}; preserve the modified content and obtain a physical backup matching the current receipt fingerprints; see docs/platform-installation.md#recover-receipt-owned-shared-skills`, { paths: [relative] });
    if (receipt.schema === PROJECT_RECEIPT_SCHEMA
      && managed.label === 'managed'
      && path.posix.basename(relative) === 'SKILL.md') {
      const metadata = validatePortableSkillMetadata(fs.readFileSync(target, 'utf8'));
      if (!metadata.ok) {
        throw fail('INVALID_PORTABLE_METADATA', `${relative} has invalid portable metadata: ${metadata.errors.join('; ')}`, { paths: [relative] });
      }
    }
  }
  for (const binding of flattenBindingPaths(normalizeBindingPaths(receipt.bindingPaths || {}, roots, 'project projection binding paths', {
    allowClaudeRoot: receipt.schema === PROJECT_RECEIPT_SCHEMA,
  }))) {
    const resolved = bindingTargetIn(roots, binding, `receipt-owned ${binding.hostId} binding`, {
      allowClaudeRoot: receipt.schema === PROJECT_RECEIPT_SCHEMA,
    });
    const stat = lstatOrNull(resolved.destination);
    if (!stat) {
      if (!requireBindings) continue;
      throw fail('MANAGED_CONTENT_MISSING', `receipt-owned Host binding is missing: ${binding.path}`, { paths: [binding.path] });
    }
    if (!stat.isSymbolicLink()) throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned Host binding was replaced: ${binding.path}`, { paths: [binding.path] });
    let actualTarget;
    try {
      actualTarget = fs.readlinkSync(resolved.destination);
    } catch (error) {
      throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned Host binding cannot be read: ${binding.path}`, { paths: [binding.path] });
    }
    if (actualTarget !== binding.target) {
      throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned Host binding target changed: ${binding.path}`, { paths: [binding.path] });
    }
  }
  return true;
}

function approvedRenameIds(previous, inventory, plan) {
  const entriesById = new Map(inventoryEntries(inventory).map((entry) => [entry.identityKey, entry]));
  const rowsById = new Map();
  for (const row of (Array.isArray(inventory && inventory.renamed_skill_names) ? inventory.renamed_skill_names : [])) {
    if (!row || typeof row.id !== 'string') continue;
    if (rowsById.has(row.id)) throw fail('SOURCE_DRIFT', `renamed skill ledger has duplicate stable ID: ${row.id}`);
    rowsById.set(row.id, row);
  }
  const selectedIds = new Set((plan.entries || []).map((entry) => entry.stableId));
  const approved = new Set();
  for (const entry of previous.entries || []) {
    if (!selectedIds.has(entry.stableId)) continue;
    const current = entriesById.get(`skill:${entry.stableId}`);
    if (!current || current.name === entry.name) continue;
    const row = rowsById.get(entry.stableId);
    if (!row
      || row.oldName !== entry.name
      || row.oldPath !== entry.source
      || row.newName !== current.name
      || row.newPath !== current.path) {
      throw fail('SOURCE_DRIFT', `canonical source changed for receipt-owned entry '${entry.name}' without an approved rename ledger row`, { stableIds: [entry.stableId] });
    }
    approved.add(entry.stableId);
  }
  return approved;
}

function sourceDrift(previous, inputs, allowCanonicalChanges, approvedRenames = new Set()) {
  if (allowCanonicalChanges) return;
  for (const entry of previous.entries || []) {
    if (approvedRenames.has(entry.stableId)) continue;
    const key = `skill:${entry.stableId}`;
    const current = inputs.sourceFingerprints[key];
    if (current && current !== entry.sourceFingerprint) {
      throw fail('SOURCE_DRIFT', `canonical source changed for receipt-owned entry '${entry.name}'; explicit update authority is required`, { stableIds: [entry.stableId] });
    }
  }
}

function writeAtomicJson(filePath, value, boundary = null) {
  const parent = path.dirname(filePath);
  ensureDirectory(parent, 'atomic JSON parent', boundary);
  const temporary = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, `${stableStringify(value)}\n`, { mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, filePath);
  } finally {
    if (lstatOrNull(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function cleanupDirectory(directory, label) {
  const stat = lstatOrNull(directory);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('UNSAFE_TRANSACTION', `${label} is not a physical directory: ${directory}`);
  fs.rmSync(directory, { recursive: true, force: true });
}

function removeEmptyDirectories(root) {
  const walk = (directory) => {
    const stat = lstatOrNull(directory);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(directory, entry.name));
    }
    if (directory !== root && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  };
  walk(root);
}

// An installer that coordinates its own journal holds the publication open
// under its transaction id; only that id (or explicit recovery) resolves it.
function normalizeHold(hold, code = 'INVALID_HOLD') {
  if (!hold || typeof hold !== 'object' || Array.isArray(hold)
    || typeof hold.transactionId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(hold.transactionId)
    || typeof hold.host !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(hold.host)
    || Object.keys(hold).some((key) => !['transactionId', 'host'].includes(key))) {
    throw fail(code, 'project projection hold must name a transactionId and host');
  }
  return { transactionId: hold.transactionId, host: hold.host };
}

function heldError(hold) {
  return fail('TRANSACTION_HELD', `project projection transaction ${hold.transactionId} is held by the ${hold.host} installer; rerun that installer to finish or undo it, or run dhpk-install --recover`, { transactionId: hold.transactionId, host: hold.host });
}

function transactionPath(roots) {
  return path.join(roots.agentsRoot, '.dhpk-installed.transaction.json');
}

function validateTransaction(roots, transaction) {
  if (!transaction || ![PROJECT_TRANSACTION_SCHEMA, LEGACY_PROJECT_TRANSACTION_SCHEMA].includes(transaction.schema)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsupported schema');
  }
  const supportsClaudeRoot = transaction.schema === PROJECT_TRANSACTION_SCHEMA;
  if (typeof transaction.backupName !== 'string' || !/^\.dhpk-projection-backup-[a-z0-9-]+$/i.test(transaction.backupName)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsafe backupName');
  }
  if (typeof transaction.stageName !== 'string'
    || (transaction.stageName !== '.none' && !/^\.dhpk-projection-(?:artifact|rollback-candidate)-[a-z0-9-]+$/i.test(transaction.stageName))) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsafe stageName');
  }
  // Journals written before the rollback stage was journaled omit the field.
  const rollbackStageName = transaction.rollbackStageName === undefined ? '.none' : transaction.rollbackStageName;
  if (typeof rollbackStageName !== 'string'
    || (rollbackStageName !== '.none' && !/^\.dhpk-projection-rollback-stage-[a-z0-9-]+$/i.test(rollbackStageName))) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsafe rollbackStageName');
  }
  if (!['prepared', 'publishing', 'published'].includes(transaction.phase)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an invalid phase');
  if (!Array.isArray(transaction.oldPaths) || !Array.isArray(transaction.newPaths)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction paths are invalid');
  const oldClaudePaths = supportsClaudeRoot ? transaction.oldClaudePaths : [];
  const newClaudePaths = supportsClaudeRoot ? transaction.newClaudePaths : [];
  if (!Array.isArray(oldClaudePaths) || !Array.isArray(newClaudePaths)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction Claude paths are invalid');
  for (const relative of [...transaction.oldPaths, ...transaction.newPaths, ...oldClaudePaths, ...newClaudePaths]) assertSafeRelative(relative, 'transaction path');
  if (!transaction.newFingerprints || typeof transaction.newFingerprints !== 'object' || Array.isArray(transaction.newFingerprints)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction is missing candidate fingerprints');
  }
  for (const relative of transaction.newPaths) {
    if (!DIGEST_PATTERN.test(transaction.newFingerprints[relative] || '')) {
      throw fail('UNSAFE_TRANSACTION', `project projection transaction has no candidate fingerprint for '${relative}'`, { paths: [relative] });
    }
  }
  const newClaudeFingerprints = supportsClaudeRoot ? transaction.newClaudeFingerprints : {};
  if (!newClaudeFingerprints || typeof newClaudeFingerprints !== 'object' || Array.isArray(newClaudeFingerprints)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction is missing Claude candidate fingerprints');
  }
  for (const relative of newClaudePaths) {
    if (!DIGEST_PATTERN.test(newClaudeFingerprints[relative] || '')) {
      throw fail('UNSAFE_TRANSACTION', `project projection transaction has no Claude candidate fingerprint for '${relative}'`, { paths: [relative] });
    }
  }
  for (const relative of Object.keys(newClaudeFingerprints)) {
    if (!newClaudePaths.includes(relative)) throw fail('UNSAFE_TRANSACTION', `project projection transaction has an unlisted Claude fingerprint: ${relative}`, { paths: [relative] });
  }
  if (transaction.newReceiptDigest !== null && !DIGEST_PATTERN.test(transaction.newReceiptDigest || '')) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an invalid receipt fingerprint');
  }
  if (typeof transaction.newRollback !== 'boolean'
    || typeof transaction.oldRollbackPresent !== 'boolean'
    || typeof transaction.oldRollbackMoved !== 'boolean'
    || typeof transaction.newRollbackInstalled !== 'boolean') {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction rollback state is invalid');
  }
  if (transaction.liveBackedUp !== undefined && typeof transaction.liveBackedUp !== 'boolean') {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction backup checkpoint is invalid');
  }
  if (transaction.hold !== undefined) normalizeHold(transaction.hold, 'UNSAFE_TRANSACTION');
  if (transaction.holdReady !== undefined && (transaction.hold === undefined || typeof transaction.holdReady !== 'boolean')) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction hold state is invalid');
  }
  if (transaction.receiptName !== path.basename(roots.receiptPath) || transaction.managedName !== path.basename(roots.managedRoot)
    || (supportsClaudeRoot && transaction.claudeManagedName !== path.basename(roots.claudeManagedRoot))) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction identity does not match the target');
  }
  let oldBindingPaths;
  let newBindingPaths;
  let restoredBindingPaths;
  try {
    oldBindingPaths = normalizeBindingPaths(transaction.oldBindingPaths || {}, roots, 'transaction old binding paths', { allowClaudeRoot: supportsClaudeRoot });
    newBindingPaths = normalizeBindingPaths(transaction.newBindingPaths || {}, roots, 'transaction new binding paths', { allowClaudeRoot: supportsClaudeRoot });
    restoredBindingPaths = normalizeBindingPaths(transaction.restoredBindingPaths || {}, roots, 'transaction restored binding paths', { allowClaudeRoot: true });
  } catch (error) {
    throw fail('UNSAFE_TRANSACTION', error.message, error.projectionDetails || {});
  }
  const newBindingSet = new Set(flattenBindingPaths(newBindingPaths).map((entry) => entry.path));
  if (flattenBindingPaths(restoredBindingPaths).some((entry) => newBindingSet.has(entry.path))
    || (transaction.adoption === true && flattenBindingPaths(restoredBindingPaths).length > 0)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction restored binding paths are invalid');
  }
  return {
    backup: path.join(roots.agentsRoot, transaction.backupName),
    stage: path.join(roots.agentsRoot, transaction.stageName),
    rollbackStage: path.join(roots.agentsRoot, rollbackStageName),
    oldBindingPaths,
    newBindingPaths,
    restoredBindingPaths,
    oldClaudePaths,
    newClaudePaths,
    newClaudeFingerprints,
    supportsClaudeRoot,
  };
}

function readTransactionJournal(roots) {
  const journalPath = transactionPath(roots);
  const journalStat = lstatOrNull(journalPath);
  if (!journalStat) return null;
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw fail('UNSAFE_TRANSACTION', 'project projection transaction journal is not a regular file');
  return readJsonFile(journalPath, 'project projection transaction journal');
}

function recoverProjectProjectionTransaction(roots, { resolveHeld = null } = {}) {
  const journalPath = transactionPath(roots);
  const transaction = readTransactionJournal(roots);
  if (!transaction) return { recovered: false };
  const paths = validateTransaction(roots, transaction);
  if (transaction.hold && transaction.phase !== 'published' && transaction.hold.transactionId !== resolveHeld) throw heldError(transaction.hold);
  // `prepared` precedes every live mutation: only the journaled transient
  // directories can exist, and the live projection is still the previous one.
  if (transaction.phase === 'prepared') {
    cleanupDirectory(paths.backup, 'project projection transaction backup');
    cleanupDirectory(paths.rollbackStage, 'project projection rollback stage');
    cleanupDirectory(paths.stage, 'project projection transaction stage');
    fs.rmSync(journalPath, { force: true });
    return { recovered: true, phase: 'prepared' };
  }
  cleanupDirectory(paths.rollbackStage, 'project projection rollback stage');
  if (transaction.adoption === true) return recoverAdoptionTransaction(roots, journalPath, transaction, paths);
  if (transaction.phase === 'published') {
    cleanupDirectory(paths.backup, 'project projection transaction backup');
    cleanupDirectory(paths.stage, 'project projection transaction stage');
    fs.rmSync(journalPath, { force: true });
    return { recovered: true, phase: 'published' };
  }

  const removeIfCandidate = (target, expectedDigest, relative) => {
    const stat = lstatOrNull(target);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isFile()) throw fail('RECOVERY_CONFLICT', `interrupted publication target is unsafe: ${relative}`, { paths: [relative] });
    if (expectedDigest && sha256Hex(fs.readFileSync(target)) !== expectedDigest) {
      throw fail('RECOVERY_CONFLICT', `interrupted publication target changed outside the transaction: ${relative}`, { paths: [relative] });
    }
    fs.rmSync(target, { force: true });
  };
  // Candidates are installed only after every live entry has been moved into
  // the backup. Before that checkpoint, a live entry is still the previous one
  // even when it matches a candidate, so recovery only restores the backup.
  // Journals written before the checkpoint existed keep the earlier behavior.
  if (transaction.liveBackedUp !== false) {
    for (const relative of transaction.newPaths) {
      removeIfCandidate(pathIn(roots.managedRoot, relative, 'recovery target'), transaction.newFingerprints && transaction.newFingerprints[relative], relative);
    }
    for (const relative of paths.newClaudePaths) {
      removeIfCandidate(pathIn(roots.claudeManagedRoot, relative, 'Claude recovery target'), paths.newClaudeFingerprints[relative], relative);
    }
    for (const binding of flattenBindingPaths(paths.newBindingPaths)) {
      removeBindingCandidate(roots, binding, 'RECOVERY_CONFLICT', { allowClaudeRoot: paths.supportsClaudeRoot });
    }
    for (const binding of flattenBindingPaths(paths.restoredBindingPaths)) {
      removeBindingCandidate(roots, binding, 'RECOVERY_CONFLICT', { allowClaudeRoot: true });
    }
    if (transaction.newReceiptDigest) removeIfCandidate(roots.receiptPath, transaction.newReceiptDigest, path.relative(roots.projectRoot, roots.receiptPath));
  }
  const rollbackRoot = path.join(roots.agentsRoot, '.dhpk-projection-rollback');
  const rollbackIsNew = transaction.newRollback
    && (transaction.newRollbackInstalled || transaction.oldRollbackMoved || !transaction.oldRollbackPresent);
  if (rollbackIsNew && lstatOrNull(rollbackRoot)) cleanupDirectory(rollbackRoot, 'new rollback snapshot');

  for (const relative of transaction.oldPaths) {
    const source = path.join(paths.backup, 'managed', relative);
    if (!lstatOrNull(source)) continue;
    const target = pathIn(roots.managedRoot, relative, 'recovery restore target');
    const targetStat = lstatOrNull(target);
    if (targetStat) {
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) throw fail('RECOVERY_CONFLICT', `recovery restore target is unsafe: ${relative}`, { paths: [relative] });
      fs.rmSync(target, { force: true });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertPhysicalAncestors(target, 'recovery restore target', roots.managedRoot);
    fs.renameSync(source, target);
  }
  for (const relative of paths.oldClaudePaths) {
    const source = path.join(paths.backup, 'claude-managed', relative);
    if (!lstatOrNull(source)) continue;
    const target = pathIn(roots.claudeManagedRoot, relative, 'recovery Claude restore target');
    const targetStat = lstatOrNull(target);
    if (targetStat) {
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) throw fail('RECOVERY_CONFLICT', `Claude recovery restore target is unsafe: ${relative}`, { paths: [relative] });
      fs.rmSync(target, { force: true });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertPhysicalAncestors(target, 'recovery Claude restore target', roots.claudeManagedRoot);
    fs.renameSync(source, target);
  }
  for (const binding of flattenBindingPaths(paths.oldBindingPaths)) {
    const source = path.join(paths.backup, 'bindings', binding.path);
    if (!lstatOrNull(source)) continue;
    const target = bindingDestinationIn(roots, binding.path, 'recovery binding restore target');
    const targetStat = lstatOrNull(target);
    if (targetStat) {
      if (!targetStat.isSymbolicLink() || fs.readlinkSync(target) !== binding.target) {
        throw fail('RECOVERY_CONFLICT', `recovery binding restore target is unsafe: ${binding.path}`, { paths: [binding.path] });
      }
      fs.rmSync(target, { force: true });
    }
    const sourceTarget = fs.readlinkSync(source);
    if (sourceTarget !== binding.target) throw fail('RECOVERY_CONFLICT', `recovery binding backup is invalid: ${binding.path}`, { paths: [binding.path] });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertPhysicalAncestors(path.dirname(target), 'recovery binding restore target', roots.projectRoot);
    fs.renameSync(source, target);
  }
  // Binding targets are checked before mutation; the backup itself is still a
  // symlink under the transaction directory and must exactly match the journal.
  const oldReceipt = path.join(paths.backup, 'receipt.json');
  if (lstatOrNull(oldReceipt)) {
    if (lstatOrNull(roots.receiptPath)) fs.rmSync(roots.receiptPath, { force: true });
    fs.renameSync(oldReceipt, roots.receiptPath);
  }
  const oldRollback = path.join(paths.backup, 'rollback');
  if (lstatOrNull(oldRollback)) {
    if (lstatOrNull(rollbackRoot)) cleanupDirectory(rollbackRoot, 'recovery rollback target');
    fs.renameSync(oldRollback, rollbackRoot);
  }
  removeEmptyDirectories(roots.managedRoot);
  removeEmptyDirectories(roots.claudeManagedRoot);
  cleanupDirectory(paths.backup, 'project projection transaction backup');
  cleanupDirectory(paths.stage, 'project projection transaction stage');
  fs.rmSync(journalPath, { force: true });
  return { recovered: true, phase: transaction.phase };
}

// 採用中斷時先完整比對所有現場與備份，避免未搬移的舊檔被誤認成候選檔刪除。
function recoverAdoptionTransaction(roots, journalPath, transaction, paths) {
  if (transaction.phase === 'published') {
    cleanupDirectory(paths.stage, 'project projection transaction stage');
    fs.rmSync(journalPath, { force: true });
    return { recovered: true, phase: 'published', backupPath: paths.backup };
  }
  const actions = [];
  const digest = (target, link) => {
    const stat = lstatOrNull(target);
    if (!stat) return null;
    if (link) return stat.isSymbolicLink() ? fs.readlinkSync(target) : false;
    return !stat.isSymbolicLink() && stat.isFile() ? sha256Hex(fs.readFileSync(target)) : false;
  };
  const plan = (live, backup, oldValue, newValue, link = false) => {
    assertPhysicalAncestors(path.dirname(live), 'adoption recovery destination', roots.projectRoot);
    assertPhysicalAncestors(path.dirname(backup), 'adoption recovery backup', roots.agentsRoot);
    const now = digest(live, link);
    const saved = digest(backup, link);
    if (saved !== null) {
      // 相同內容不證明由本次交易建立；無建立身分時保留現場並要求人工核對。
      if (saved !== oldValue || now !== null) throw fail('RECOVERY_CONFLICT', `adoption recovery conflict: ${live}`);
      actions.push({ live, backup, now, saved, link, restore: true });
    } else if (oldValue !== null) {
      if (now !== oldValue) throw fail('RECOVERY_CONFLICT', `adoption source changed: ${live}`);
    } else if (now !== null) {
      throw fail('RECOVERY_CONFLICT', `adoption candidate requires reconciliation: ${live}`);
    }
  };
  for (const [root, oldPaths, newPaths, oldMap, newMap, folder] of [
    [roots.managedRoot, transaction.oldPaths, transaction.newPaths, transaction.oldFingerprints, transaction.newFingerprints, 'managed'],
    [roots.claudeManagedRoot, paths.oldClaudePaths, paths.newClaudePaths, transaction.oldClaudeFingerprints, paths.newClaudeFingerprints, 'claude-managed'],
  ]) {
    if (!oldMap || Object.keys(oldMap).length !== oldPaths.length || oldPaths.some((p) => !DIGEST_PATTERN.test(oldMap[p] || '') || !newPaths.includes(p))) throw fail('UNSAFE_TRANSACTION', 'invalid adoption observations');
    for (const relative of newPaths) plan(pathIn(root, relative), path.join(paths.backup, folder, relative), oldMap[relative] || null, newMap[relative]);
  }
  const oldBindings = new Map(flattenBindingPaths(paths.oldBindingPaths).map((item) => [item.path, item.target]));
  const newBindings = flattenBindingPaths(paths.newBindingPaths);
  if ([...oldBindings.keys()].some((key) => !newBindings.some((item) => item.path === key))) throw fail('UNSAFE_TRANSACTION', 'invalid adoption binding observations');
  for (const binding of newBindings) plan(bindingDestinationIn(roots, binding.path), path.join(paths.backup, 'bindings', binding.path), oldBindings.get(binding.path) || null, binding.target, true);
  if (transaction.oldReceiptDigest !== null && !DIGEST_PATTERN.test(transaction.oldReceiptDigest || '')) throw fail('UNSAFE_TRANSACTION', 'invalid adoption receipt observation');
  plan(roots.receiptPath, path.join(paths.backup, 'receipt.json'), transaction.oldReceiptDigest, transaction.newReceiptDigest);
  for (const action of actions) {
    assertPhysicalAncestors(path.dirname(action.live), 'adoption recovery destination', roots.projectRoot);
    assertPhysicalAncestors(path.dirname(action.backup), 'adoption recovery backup', roots.agentsRoot);
    if (digest(action.live, action.link) !== action.now || digest(action.backup, action.link) !== action.saved) throw fail('RECOVERY_CONFLICT', `adoption changed during recovery: ${action.live}`);
    if (action.now !== null) fs.unlinkSync(action.live);
    if (action.restore) {
      fs.mkdirSync(path.dirname(action.live), { recursive: true });
      fs.renameSync(action.backup, action.live);
    }
  }
  cleanupDirectory(paths.backup, 'project projection transaction backup');
  cleanupDirectory(paths.stage, 'project projection transaction stage');
  fs.rmSync(journalPath, { force: true });
  return { recovered: true, phase: transaction.phase };
}

function receiptWithoutFingerprint(receipt) {
  const next = clone(receipt);
  delete next.receiptFingerprint;
  return next;
}

// The rollback metadata depends only on the previous receipt, so it is planned
// before the journal is written; the snapshot files are copied afterwards.
function planRollbackStage(stage, previous, receiptSchema, adoptedBindingPaths = {}) {
  if (!previous) return null;
  const schemaForReceipt = receiptSchema || previous.schema;
  const groupedLayout = schemaForReceipt === PROJECT_RECEIPT_SCHEMA;
  const hasClaudeFiles = (previous.claudeManagedPaths || []).length > 0;
  const groupedLegacyLayout = !groupedLayout && hasClaudeFiles;
  const claudeManagedPaths = previous.claudeManagedPaths || [];
  const claudeFingerprints = previous.claudeGeneratedFingerprints || {};
  const managedFiles = previous.managedPaths.map((relative) => ({
    ...(groupedLayout || groupedLegacyLayout ? { root: 'managed' } : {}),
    relative,
    fingerprint: previous.generatedFingerprints[relative],
  }));
  const claudeFiles = claudeManagedPaths.map((relative) => ({
    root: 'claude',
    relative,
    fingerprint: claudeFingerprints[relative],
  }));
  const snapshotFiles = groupedLayout || groupedLegacyLayout
    ? [...managedFiles, ...claudeFiles].sort((left, right) => `${left.root}/${left.relative}`.localeCompare(`${right.root}/${right.relative}`))
    : managedFiles.sort((left, right) => left.relative.localeCompare(right.relative));
  return {
    stage,
    previous,
    groupedManagedRoot: groupedLayout || groupedLegacyLayout,
    metadata: {
      schema: groupedLayout ? PROJECT_ROLLBACK_SCHEMA : LEGACY_PROJECT_ROLLBACK_SCHEMA,
      ...(groupedLegacyLayout ? { layout: 'grouped' } : {}),
      root: '.agents/.dhpk-projection-rollback',
      receipt: 'receipt.json',
      files: 'files',
      fingerprint: fingerprint({ receipt: previous, files: snapshotFiles }),
      ...(flattenBindingPaths(adoptedBindingPaths).length > 0 ? { adoptedBindingPaths: clone(adoptedBindingPaths) } : {}),
    },
  };
}

function writeRollbackStage(roots, rollback) {
  const { stage, previous } = rollback;
  fs.mkdirSync(stage);
  const filesRoot = path.join(stage, 'files');
  fs.mkdirSync(filesRoot, { recursive: true });
  const managedSnapshotRoot = rollback.groupedManagedRoot ? path.join(filesRoot, 'managed') : filesRoot;
  for (const relative of previous.managedPaths) {
    const source = pathIn(roots.managedRoot, relative, 'rollback source');
    const target = path.join(managedSnapshotRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const relative of previous.claudeManagedPaths || []) {
    const source = pathIn(roots.claudeManagedRoot, relative, 'rollback Claude source');
    const target = path.join(filesRoot, 'claude-managed', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  writeAtomicJson(path.join(stage, 'receipt.json'), previous, roots.projectRoot);
}

function transactionToken() {
  return `${process.pid.toString(36)}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

// Bindings that a rollback hands back to their pre-adoption, unmanaged state.
// They are journaled as new bindings so an interrupted rollback removes them,
// but no receipt records them. Their target may legitimately be absent.
function installRestoredBindings(roots, restoredBindingPaths) {
  for (const binding of flattenBindingPaths(restoredBindingPaths)) {
    const destination = bindingDestinationIn(roots, binding.path, 'rollback adopted binding');
    if (lstatOrNull(destination)) throw fail('PUBLISH_COLLISION', `rollback adopted binding appeared during publication: ${binding.path}`, { paths: [binding.path] });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    assertPhysicalAncestors(path.dirname(destination), 'rollback adopted binding parent', roots.projectRoot);
    fs.symlinkSync(binding.target, destination, 'dir');
  }
}

function checkCollisions(roots, previous, candidateFiles, rootId = 'managed') {
  const targetRoot = rootId === 'claude' ? roots.claudeManagedRoot : roots.managedRoot;
  const oldPaths = new Set(previous
    ? (rootId === 'claude' ? previous.claudeManagedPaths || [] : previous.managedPaths)
    : []);
  const oldTop = new Set([...oldPaths].map((relative) => relative.split('/')[0]));
  for (const relative of candidateFiles) {
    const target = pathIn(targetRoot, relative, `candidate ${rootId} path`);
    const stat = lstatOrNull(target);
    if (stat && !oldPaths.has(relative)) throw fail('GENERATED_PATH_COLLISION', `generated path collides with unmanaged content: ${relative}`, { paths: [relative] });
    const top = relative.split('/')[0];
    const topTarget = path.join(targetRoot, top);
    const topStat = lstatOrNull(topTarget);
    if (topStat && !oldTop.has(top) && top !== relative) {
      throw fail('GENERATED_PATH_COLLISION', `generated path collides with an unmanaged entry: ${top}`, { paths: [top] });
    }
  }
}

function checkBindingCollisions(roots, previous, candidateBindingPaths, adoptedBindingPaths = {}) {
  const oldBindings = previous
    ? normalizeBindingPaths(previous.bindingPaths || {}, roots, 'previous project projection binding paths', {
      allowClaudeRoot: previous.schema === PROJECT_RECEIPT_SCHEMA,
    })
    : {};
  const oldByPath = new Map(flattenBindingPaths(mergeBindingPaths(oldBindings, adoptedBindingPaths)).map((entry) => [entry.path, entry]));
  const seen = new Set();
  for (const binding of flattenBindingPaths(normalizeBindingPaths(candidateBindingPaths || {}, roots, 'candidate project projection binding paths', {
    allowClaudeRoot: true,
  }))) {
    if (seen.has(binding.path)) throw fail('DUPLICATE_DISCOVERY', `generated Host binding path is duplicated: ${binding.path}`, { paths: [binding.path] });
    seen.add(binding.path);
    const target = bindingTargetIn(roots, binding, `candidate ${binding.hostId} binding`, { allowClaudeRoot: true });
    const stat = lstatOrNull(target.destination);
    if (stat && !oldByPath.has(binding.path)) {
      throw fail('GENERATED_PATH_COLLISION', `generated Host binding collides with unmanaged content: ${binding.path}`, { paths: [binding.path] });
    }
    if (stat && oldByPath.has(binding.path)) {
      if (!stat.isSymbolicLink() || fs.readlinkSync(target.destination) !== oldByPath.get(binding.path).target) {
        throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned Host binding was modified: ${binding.path}`, { paths: [binding.path] });
      }
    }
  }
  return { oldBindings, oldByPath };
}

// 只有 PATH_ESCAPE / UNSAFE_PATH 代表連結指向管理根外；其他錯誤照常拋出。
function isAdoptableBindingLink(roots, binding) {
  try {
    bindingTargetIn(roots, binding, 'adoption binding', { allowClaudeRoot: true });
    return true;
  } catch (error) {
    if (['PATH_ESCAPE', 'UNSAFE_PATH'].includes(error.projectionCode)) return false;
    throw error;
  }
}

function mergeBindingPaths(base, extra) {
  const merged = Object.fromEntries(Object.entries(base || {}).map(([hostId, entries]) => [hostId, entries.slice()]));
  for (const binding of flattenBindingPaths(extra)) {
    merged[binding.hostId] = [...(merged[binding.hostId] || []), { path: binding.path, target: binding.target }]
      .sort((left, right) => left.path.localeCompare(right.path));
  }
  return merged;
}

// --adopt/--repair 只納管未記錄於收據、且現場目標落在 dhpk 管理根內的 binding symlink；
// 其他現存內容維持 GENERATED_PATH_COLLISION。
function observeUnmanagedBindings(roots, previousBindingPaths, candidateBindingPaths) {
  const owned = new Set(flattenBindingPaths(previousBindingPaths).map((entry) => entry.path));
  const adopted = {};
  for (const binding of flattenBindingPaths(candidateBindingPaths)) {
    if (owned.has(binding.path)) continue;
    const destination = bindingDestinationIn(roots, binding.path, 'adoption binding');
    const stat = lstatOrNull(destination);
    if (!stat || !stat.isSymbolicLink()) continue;
    const observed = { path: binding.path, target: fs.readlinkSync(destination) };
    if (!isAdoptableBindingLink(roots, { ...observed, hostId: binding.hostId })) continue;
    (adopted[binding.hostId] ||= []).push(observed);
  }
  return adopted;
}

// 採用只依本次現場觀察備份與候選輸出重疊的項目，舊雜湊不能證明刪除權限。
function observeAdoption(roots, candidateFiles, claudeCandidateFiles, candidateBindings) {
  const observeFiles = (root, files) => Object.fromEntries(files.flatMap((relative) => {
    const target = pathIn(root, relative, 'adoption candidate');
    const stat = lstatOrNull(target);
    if (!stat) return [];
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail('GENERATED_PATH_COLLISION', `adoption path is not a regular file: ${relative}`, { paths: [relative] });
    return [[relative, sha256Hex(fs.readFileSync(target))]];
  }));
  const generatedFingerprints = observeFiles(roots.managedRoot, candidateFiles);
  const claudeGeneratedFingerprints = observeFiles(roots.claudeManagedRoot, claudeCandidateFiles);
  const bindingPaths = {};
  for (const binding of flattenBindingPaths(candidateBindings)) {
    const destination = bindingDestinationIn(roots, binding.path, 'adoption binding');
    const stat = lstatOrNull(destination);
    if (!stat) continue;
    if (!stat.isSymbolicLink()) throw fail('GENERATED_PATH_COLLISION', `adoption binding is not a symlink: ${binding.path}`, { paths: [binding.path] });
    const observed = { path: binding.path, target: fs.readlinkSync(destination) };
    if (!isAdoptableBindingLink(roots, { ...observed, hostId: binding.hostId })) {
      throw fail('GENERATED_PATH_COLLISION', `adoption binding points outside the managed roots: ${binding.path}`, { paths: [binding.path] });
    }
    (bindingPaths[binding.hostId] ||= []).push(observed);
  }
  return { schema: PROJECT_RECEIPT_SCHEMA, managedPaths: Object.keys(generatedFingerprints), generatedFingerprints, claudeManagedPaths: Object.keys(claudeGeneratedFingerprints), claudeGeneratedFingerprints, bindingPaths };
}

function removeBindingCandidate(roots, binding, code = 'RECOVERY_CONFLICT', { allowClaudeRoot = false } = {}) {
  const resolved = bindingTargetIn(roots, binding, `transaction ${binding.hostId || 'Host'} binding`, { allowClaudeRoot });
  const stat = lstatOrNull(resolved.destination);
  if (!stat) return;
  if (!stat.isSymbolicLink() || fs.readlinkSync(resolved.destination) !== binding.target) {
    throw fail(code, `transaction binding changed outside the transaction: ${binding.path}`, { paths: [binding.path] });
  }
  fs.rmSync(resolved.destination, { force: true });
}

function installBindingPaths(roots, bindingPaths, { allowClaudeRoot = false } = {}) {
  for (const binding of flattenBindingPaths(normalizeBindingPaths(bindingPaths || {}, roots, 'publish project projection binding paths', { allowClaudeRoot }))) {
    const resolved = bindingTargetIn(roots, binding, `publish ${binding.hostId} binding`, { allowClaudeRoot });
    const targetStat = lstatOrNull(resolved.resolvedTarget);
    if (!targetStat || !targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw fail('PUBLISH_TARGET_MISSING', `Host binding target is missing or unsafe: ${binding.target}`, { paths: [binding.path, binding.target] });
    }
    if (lstatOrNull(resolved.destination)) throw fail('PUBLISH_COLLISION', `publish binding target appeared after collision check: ${binding.path}`, { paths: [binding.path] });
    fs.mkdirSync(path.dirname(resolved.destination), { recursive: true });
    assertPhysicalAncestors(path.dirname(resolved.destination), 'publish binding parent', roots.projectRoot);
    fs.symlinkSync(binding.target, resolved.destination, 'dir');
    if (fs.readlinkSync(resolved.destination) !== binding.target) {
      throw fail('PUBLISH_FINGERPRINT_DRIFT', `published Host binding target drifted: ${binding.path}`, { paths: [binding.path] });
    }
  }
}

function publishManagedCandidate({
  roots,
  previous,
  candidateRoot,
  candidateFiles,
  candidateFingerprints,
  claudeCandidateFiles = [],
  claudeCandidateFingerprints = {},
  nextReceipt,
  createRollback = true,
  adoption = false,
  oldReceiptDigest = null,
  adoptedBindingPaths = {},
  restoredBindingPaths = {},
  hold = null,
}) {
  const heldBy = hold ? normalizeHold(hold) : null;
  checkCollisions(roots, previous, candidateFiles);
  checkCollisions(roots, previous, claudeCandidateFiles, 'claude');
  const receiptBindingPaths = previous ? normalizeBindingPaths(previous.bindingPaths || {}, roots, 'previous project projection binding paths', {
    allowClaudeRoot: previous.schema === PROJECT_RECEIPT_SCHEMA,
  }) : {};
  // 納管的 binding 隨交易備份與復原，但不寫入 rollback 收據。
  const previousBindingPaths = mergeBindingPaths(receiptBindingPaths, adoptedBindingPaths);
  const candidateBindingPaths = nextReceipt ? normalizeBindingPaths(nextReceipt.bindingPaths || {}, roots, 'candidate project projection binding paths', {
    allowClaudeRoot: nextReceipt.schema === PROJECT_RECEIPT_SCHEMA,
  }) : {};
  checkBindingCollisions(roots, previous, candidateBindingPaths, adoptedBindingPaths);
  const candidateBindingSet = new Set(flattenBindingPaths(candidateBindingPaths).map((entry) => entry.path));
  const restoredBindings = Object.fromEntries(Object.entries(normalizeBindingPaths(restoredBindingPaths, roots, 'rollback adopted binding paths', { allowClaudeRoot: true }))
    .map(([hostId, entries]) => [hostId, entries.filter((entry) => !candidateBindingSet.has(entry.path))])
    .filter(([, entries]) => entries.length > 0));
  const journalPath = transactionPath(roots);
  if (lstatOrNull(journalPath)) throw fail('TRANSACTION_EXISTS', 'project projection transaction journal already exists');
  // Every transient directory is named in the journal before it is created,
  // so recovery can remove it after a crash at any point.
  const token = transactionToken();
  const backup = path.join(roots.agentsRoot, `.dhpk-projection-backup-${token}`);
  const rollback = planRollbackStage(
    path.join(roots.agentsRoot, `.dhpk-projection-rollback-stage-${token}`),
    previous && createRollback ? previous : null,
    nextReceipt && nextReceipt.schema,
    adoptedBindingPaths,
  );
  const rollbackRoot = path.join(roots.agentsRoot, '.dhpk-projection-rollback');
  const oldRollback = !adoption && previous && lstatOrNull(rollbackRoot);
  const receipt = nextReceipt ? sealReceipt({
    ...receiptWithoutFingerprint(nextReceipt),
    rollback: rollback ? rollback.metadata : null,
  }) : null;
  const journal = {
    schema: PROJECT_TRANSACTION_SCHEMA,
    phase: 'prepared',
    managedName: path.basename(roots.managedRoot),
    claudeManagedName: path.basename(roots.claudeManagedRoot),
    receiptName: path.basename(roots.receiptPath),
    backupName: path.basename(backup),
    rollbackStageName: rollback ? path.basename(rollback.stage) : '.none',
    stageName: candidateRoot ? path.basename(path.dirname(candidateRoot)) : '.none',
    oldPaths: previous ? previous.managedPaths.slice().sort() : [],
    newPaths: candidateFiles.slice().sort(),
    oldClaudePaths: previous ? (previous.claudeManagedPaths || []).slice().sort() : [],
    newClaudePaths: claudeCandidateFiles.slice().sort(),
    oldBindingPaths: previousBindingPaths,
    newBindingPaths: candidateBindingPaths,
    ...(flattenBindingPaths(restoredBindings).length > 0 ? { restoredBindingPaths: restoredBindings } : {}),
    newFingerprints: { ...candidateFingerprints },
    newClaudeFingerprints: { ...claudeCandidateFingerprints },
    newReceiptDigest: receipt ? receiptFileDigest(receipt) : null,
    newRollback: Boolean(rollback),
    oldRollbackPresent: Boolean(oldRollback),
    oldRollbackMoved: false,
    newRollbackInstalled: false,
    liveBackedUp: false,
    ...(heldBy ? { hold: heldBy, holdReady: false } : {}),
    ...(adoption ? { adoption: true, oldFingerprints: previous.generatedFingerprints, oldClaudeFingerprints: previous.claudeGeneratedFingerprints, oldReceiptDigest } : {}),
  };
  writeAtomicJson(journalPath, journal, roots.projectRoot);
  let published = false;
  try {
    fs.mkdirSync(backup);
    if (rollback) writeRollbackStage(roots, rollback);
    journal.phase = 'publishing';
    writeAtomicJson(journalPath, journal, roots.projectRoot);
    if (previous) {
      for (const relative of previous.managedPaths.slice().sort()) {
        const source = pathIn(roots.managedRoot, relative, 'transaction backup source');
        const target = path.join(backup, 'managed', relative);
        if (adoption && sha256Hex(readPhysicalFile(source, 'adoption source')) !== previous.generatedFingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `adoption source changed: ${relative}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertPhysicalAncestors(target, 'transaction backup target', backup);
        fs.renameSync(source, target);
        if (adoption && sha256Hex(readPhysicalFile(target, 'adoption backup')) !== previous.generatedFingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `adoption backup changed: ${relative}`);
      }
      for (const relative of (previous.claudeManagedPaths || []).slice().sort()) {
        const source = pathIn(roots.claudeManagedRoot, relative, 'transaction Claude backup source');
        const target = path.join(backup, 'claude-managed', relative);
        if (adoption && sha256Hex(readPhysicalFile(source, 'adoption Claude source')) !== previous.claudeGeneratedFingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `adoption Claude source changed: ${relative}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertPhysicalAncestors(target, 'transaction Claude backup target', backup);
        fs.renameSync(source, target);
        if (adoption && sha256Hex(readPhysicalFile(target, 'adoption Claude backup')) !== previous.claudeGeneratedFingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `adoption Claude backup changed: ${relative}`);
      }
      if (lstatOrNull(roots.receiptPath)) {
        if (adoption && sha256Hex(readPhysicalFile(roots.receiptPath, 'adoption receipt')) !== oldReceiptDigest) throw fail('RECEIPT_CHANGED', 'receipt changed during adoption');
        fs.renameSync(roots.receiptPath, path.join(backup, 'receipt.json'));
        if (adoption && sha256Hex(readPhysicalFile(path.join(backup, 'receipt.json'), 'adoption receipt backup')) !== oldReceiptDigest) throw fail('RECEIPT_CHANGED', 'receipt changed during adoption');
      } else if (adoption && oldReceiptDigest !== null) throw fail('RECEIPT_CHANGED', 'receipt disappeared during adoption');
    }
    for (const binding of flattenBindingPaths(previousBindingPaths)) {
      const source = bindingDestinationIn(roots, binding.path, 'transaction binding backup source');
      if (!lstatOrNull(source)) {
        if (adoption) throw fail('MANAGED_CONTENT_CHANGED', `adoption binding disappeared: ${binding.path}`);
        continue;
      }
      if (adoption && (!lstatOrNull(source).isSymbolicLink() || fs.readlinkSync(source) !== binding.target)) throw fail('MANAGED_CONTENT_CHANGED', `adoption binding changed: ${binding.path}`);
      const target = path.join(backup, 'bindings', binding.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertPhysicalAncestors(target, 'transaction binding backup target', backup);
      fs.renameSync(source, target);
      if (adoption && (!lstatOrNull(target).isSymbolicLink() || fs.readlinkSync(target) !== binding.target)) throw fail('MANAGED_CONTENT_CHANGED', `adoption binding backup changed: ${binding.path}`);
    }
    if (oldRollback) {
      fs.renameSync(rollbackRoot, path.join(backup, 'rollback'));
      journal.oldRollbackMoved = true;
    }
    journal.liveBackedUp = true;
    writeAtomicJson(journalPath, journal, roots.projectRoot);
    removeEmptyDirectories(roots.managedRoot);
    removeEmptyDirectories(roots.claudeManagedRoot);
    for (const relative of candidateFiles.slice().sort()) {
      const source = pathIn(candidateRoot, relative, 'candidate source');
      const target = pathIn(roots.managedRoot, relative, 'publish target');
      const existing = lstatOrNull(target);
      if (existing) throw fail('PUBLISH_COLLISION', `publish target appeared after collision check: ${relative}`, { paths: [relative] });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertPhysicalAncestors(target, 'publish target', roots.managedRoot);
      fs.copyFileSync(source, target);
      const sourceStat = lstatOrNull(source);
      if (sourceStat && sourceStat.isFile()) fs.chmodSync(target, sourceStat.mode & 0o7777);
      if (sha256Hex(fs.readFileSync(target)) !== candidateFingerprints[relative]) throw fail('PUBLISH_FINGERPRINT_DRIFT', `published file fingerprint drifted: ${relative}`, { paths: [relative] });
    }
    for (const relative of claudeCandidateFiles.slice().sort()) {
      const source = pathIn(candidateRoot, `${CLAUDE_ARTIFACT_ROOT}/${relative}`, 'Claude candidate source');
      const target = pathIn(roots.claudeManagedRoot, relative, 'Claude publish target');
      const existing = lstatOrNull(target);
      if (existing) throw fail('PUBLISH_COLLISION', `Claude publish target appeared after collision check: ${relative}`, { paths: [relative] });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertPhysicalAncestors(target, 'Claude publish target', roots.claudeManagedRoot);
      fs.copyFileSync(source, target);
      const sourceStat = lstatOrNull(source);
      if (sourceStat && sourceStat.isFile()) fs.chmodSync(target, sourceStat.mode & 0o7777);
      if (sha256Hex(fs.readFileSync(target)) !== claudeCandidateFingerprints[relative]) {
        throw fail('PUBLISH_FINGERPRINT_DRIFT', `published Claude file fingerprint drifted: ${relative}`, { paths: [relative] });
      }
    }
    installBindingPaths(roots, candidateBindingPaths, { allowClaudeRoot: Boolean(nextReceipt && nextReceipt.schema === PROJECT_RECEIPT_SCHEMA) });
    installRestoredBindings(roots, restoredBindings);
    if (rollback) {
      fs.renameSync(rollback.stage, rollbackRoot);
      journal.newRollbackInstalled = true;
      writeAtomicJson(journalPath, journal, roots.projectRoot);
    }
    if (receipt) writeAtomicJson(roots.receiptPath, receipt, roots.projectRoot);
    else if (lstatOrNull(roots.receiptPath)) fs.rmSync(roots.receiptPath, { force: true });
    if (heldBy) {
      // Every effect is in place; the holder decides between commit and abort.
      journal.holdReady = true;
      writeAtomicJson(journalPath, journal, roots.projectRoot);
      published = true;
      return {
        receipt,
        published: false,
        held: true,
        managedPaths: candidateFiles.slice().sort(),
        claudeManagedPaths: claudeCandidateFiles.slice().sort(),
        bindingPaths: candidateBindingPaths,
        ...(adoption ? { backupPath: backup } : {}),
      };
    }
    journal.phase = 'published';
    writeAtomicJson(journalPath, journal, roots.projectRoot);
    published = true;
    if (!adoption) cleanupDirectory(backup, 'project projection transaction backup');
    fs.rmSync(journalPath, { force: true });
    return {
      receipt,
      published: true,
      managedPaths: candidateFiles.slice().sort(),
      claudeManagedPaths: claudeCandidateFiles.slice().sort(),
      bindingPaths: candidateBindingPaths,
      ...(adoption ? { backupPath: backup } : {}),
    };
  } catch (error) {
    if (!published) {
      try {
        recoverProjectProjectionTransaction(roots, { resolveHeld: heldBy && heldBy.transactionId });
      } catch (recoveryError) {
        error.message = `${error.message}; transaction recovery failed: ${recoveryError.message}`;
      }
    }
    throw error;
  } finally {
    if (rollback && lstatOrNull(rollback.stage)) cleanupDirectory(rollback.stage, 'project projection rollback stage');
  }
}

function stageArtifact({
  roots,
  sourceRoot,
  inventory,
  plan,
  cursorBinding = null,
  codexBinding = null,
  hostSelections = null,
  preserveHostBindings = null,
  preserveBindingPaths = null,
}) {
  const artifactRoot = fs.mkdtempSync(path.join(roots.agentsRoot, '.dhpk-projection-artifact-'));
  try {
    const publishedRoot = path.join(artifactRoot, 'published');
    const inputs = buildArtifactInputs({
      sourceRoot,
      inventory,
      plan,
      roots,
      cursorBinding,
      codexBinding,
      hostSelections,
      preserveHostBindings,
      preserveBindingPaths,
    });
    const store = new ProjectionArtifactStore({ root: artifactRoot, sourceRoot, publishRoot: publishedRoot });
    const contentByPath = new Map(inputs.records.map((record) => [record.value.destination, record.content]));
    const adapter = {
      identity: { id: 'project-agent-projection', version: GENERATOR_VERSION },
      render: () => ({
        adapter: { id: 'project-agent-projection', version: GENERATOR_VERSION },
        outputs: inputs.records.map((record) => ({ ...record.value, content: contentByPath.get(record.value.destination) })),
        links: [],
        metadata: {
          parentPlanFingerprint: plan.planFingerprint,
          selectedIds: inputs.selectedIds,
          emittedIds: inputs.emittedIds,
          sourceFingerprints: inputs.sourceFingerprints,
        },
      }),
    };
    const materialized = materializeDistribution(inputs.plan, adapter, store);
    if (!materialized.ok) {
      throw fail(materialized.error.code, materialized.error.message, materialized.error.details || {});
    }
    return {
      artifactRoot,
      candidateRoot: publishedRoot,
      artifact: materialized.value,
      inputs,
    };
  } catch (error) {
    cleanupDirectory(artifactRoot, 'failed project projection artifact');
    throw error;
  }
}

function receiptForArtifact({ roots, plan, staged, declaredSelection = false }) {
  const inputs = staged.inputs;
  return sealReceipt({
    schema: PROJECT_RECEIPT_SCHEMA,
    generatorVersion: GENERATOR_VERSION,
    fingerprint_algorithm: TREE_FINGERPRINT_ALGORITHM,
    scope: 'project',
    managedRoot: roots.config.managed_root,
    receiptPath: roots.config.receipt,
    projectionOwner: clone(plan.projectionOwner),
    profileId: plan.profileId || (plan.profile && plan.profile.profileId) || 'portable-core',
    profile: clone(plan.profile || null),
    profileFingerprint: plan.profileFingerprint || null,
    selectionFingerprint: plan.selectionFingerprint || null,
    surfaceSelectionFingerprint: plan.surfaceSelectionFingerprint || null,
    capabilityEvidenceFingerprint: plan.capabilityEvidenceFingerprint || null,
    planFingerprint: plan.planFingerprint,
    artifactFingerprint: staged.artifact.artifactFingerprint,
    ...(declaredSelection ? { declaredSelection: true } : {}),
    selectedIds: inputs.selectedIds,
    emittedIds: inputs.emittedIds,
    selectedIdentities: clone(plan.selectedIdentities || []),
    emittedIdentities: clone(plan.emittedIdentities || []),
    dependencyClosure: clone(plan.dependencyClosure || null),
    hostBindings: clone(inputs.hostBindings || plan.hostBindings || {}),
    bindings: clone(inputs.hostBindings || plan.hostBindings || {}),
    bindingPaths: clone(inputs.bindingPaths || {}),
    entries: inputs.receiptEntries.slice().sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: Object.keys(inputs.generatedFingerprints).sort(),
    generatedFingerprints: clone(inputs.generatedFingerprints),
    claudeManagedRoot: roots.claudeManagedRootRelative,
    claudeManagedPaths: Object.keys(inputs.claudeGeneratedFingerprints).sort(),
    claudeGeneratedFingerprints: clone(inputs.claudeGeneratedFingerprints),
    sourceFingerprints: clone(inputs.sourceFingerprints),
    rollback: null,
  });
}

function materializeRelocatableAgentsSkillsProjection(options = {}) {
  const sourceRoot = options.sourceRoot || options.root;
  if (!sourceRoot || !options.inventory) throw fail('INVALID_INPUT', 'sourceRoot and inventory are required');
  const roots = resolveRoots({ sourceRoot, projectRoot: options.projectRoot, outDir: options.outDir, inventory: options.inventory });
  const lifecycleOptions = { allowLegacyClaudeDiscovery: true, releaseLegacy: options.adopt === true };
  readProjectionReceipt(roots, lifecycleOptions);
  ensureDirectory(roots.projectRoot, 'project root', roots.projectRoot);
  ensureDirectory(roots.agentsRoot, 'project agents root', roots.projectRoot);
  recoverProjectProjectionTransaction(roots);
  let previous = readProjectionReceipt(roots, lifecycleOptions);
  let legacyAdoption = Boolean(previous && previous.generatorVersion === '2.0.0' && !Object.prototype.hasOwnProperty.call(previous, 'fingerprint_algorithm'));
  let oldReceiptDigest = null;
  if (legacyAdoption) {
    const observed = readPhysicalFile(roots.receiptPath, 'adoption receipt');
    const checked = validateReceipt(JSON.parse(observed), roots, lifecycleOptions);
    if (checked.receiptFingerprint !== previous.receiptFingerprint) throw fail('RECEIPT_CHANGED', 'receipt changed before adoption');
    oldReceiptDigest = sha256Hex(observed);
  }
  if (!previous && lstatOrNull(legacyManifestPath(roots))) {
    if (!(options.adopt || options.repair || options.allowLegacyAdoption)) {
      throw fail('LEGACY_UNBOUND', 'legacy project projection is present without the lifecycle receipt; explicit adopt or repair is required');
    }
    previous = adoptLegacyManifest(roots);
    if (previous.legacyUnmarkedManifest || previous.legacyProjectionManifest) {
      if (options.adopt !== true) throw fail('LEGACY_UNBOUND', 'receipt-less legacy projection manifest requires explicit adopt');
      legacyAdoption = true;
    }
  }
  if (previous && !legacyAdoption) validateManagedFiles(roots, previous, { requireBindings: false });
  const plan = compilePlan({
    inventory: options.inventory,
    plan: options.plan,
    profileId: options.profileId || 'portable-core',
    requestedHosts: options.requestedHosts,
    selectedStableIds: options.selectedStableIds,
    declaredSelection: options.declaredSelection,
  });
  const staged = stageArtifact({
    roots,
    sourceRoot: roots.sourceRoot,
    inventory: options.inventory,
    plan,
    cursorBinding: options.cursorBinding || null,
    codexBinding: options.codexBinding || null,
    hostSelections: options.hostSelections || null,
    preserveHostBindings: options.preserveHostBindings || null,
    preserveBindingPaths: options.preserveBindingPaths || null,
  });
  try {
    if (previous && !legacyAdoption) {
      const approvedRenames = approvedRenameIds(previous, options.inventory, plan);
      sourceDrift(previous, staged.inputs, Boolean(options.allowCanonicalChanges || options.update), approvedRenames);
    }
    const receipt = receiptForArtifact({
      roots,
      plan,
      staged,
      declaredSelection: options.declaredSelection === true,
    });
    // 舊收據僅供身分驗證；實際可替換項目以本次候選交集重新觀察。
    const adoptedBindingPaths = (options.adopt || options.repair) && previous && !legacyAdoption
      ? observeUnmanagedBindings(roots, previous.bindingPaths || {}, receipt.bindingPaths || {})
      : {};
    const publishPrevious = legacyAdoption ? observeAdoption(roots, Object.keys(staged.inputs.generatedFingerprints), Object.keys(staged.inputs.claudeGeneratedFingerprints), receipt.bindingPaths || {}) : previous;
    if (previous && previous.legacyProjectionManifest) assertManifestOwnsObserved(previous, publishPrevious);
    if (previous && (previous.legacyUnmarkedManifest || previous.legacyProjectionManifest) && publishPrevious.generatedFingerprints[LEGACY_MANIFEST_NAME] !== previous.manifestDigest) throw fail('MANAGED_CONTENT_CHANGED', 'legacy manifest changed before adoption');
    const released = legacyAdoption ? [
      ...previous.managedPaths.filter((entry) => !receipt.managedPaths.includes(entry)).map((entry) => `${roots.config.managed_root}/${entry}`),
      ...(previous.claudeManagedPaths || []).filter((entry) => !receipt.claudeManagedPaths.includes(entry)).map((entry) => `${roots.claudeManagedRootRelative}/${entry}`),
      ...flattenBindingPaths(previous.bindingPaths || {}).filter((entry) => !flattenBindingPaths(receipt.bindingPaths || {}).some((candidate) => candidate.path === entry.path)).map((entry) => entry.path),
    ].map((name) => ({ name })) : [];
    const published = publishManagedCandidate({
      roots,
      previous: publishPrevious,
      candidateRoot: staged.candidateRoot,
      candidateFiles: Object.keys(staged.inputs.generatedFingerprints),
      candidateFingerprints: staged.inputs.generatedFingerprints,
      claudeCandidateFiles: Object.keys(staged.inputs.claudeGeneratedFingerprints),
      claudeCandidateFingerprints: staged.inputs.claudeGeneratedFingerprints,
      nextReceipt: receipt,
      createRollback: !legacyAdoption,
      adoption: legacyAdoption,
      oldReceiptDigest,
      adoptedBindingPaths,
      hold: options.hold || null,
    });
    return {
      held: Boolean(published.held),
      outputRoot: roots.managedRoot,
      projectRoot: roots.projectRoot,
      receiptPath: roots.receiptPath,
      selectedIds: receipt.selectedIds,
      emittedIds: receipt.emittedIds,
      managedPaths: receipt.managedPaths,
      receipt: published.receipt,
      plan,
      artifact: staged.artifact,
      ...(legacyAdoption ? { released } : {}),
      ...(legacyAdoption ? { backupPath: published.backupPath } : {}),
      state: previous ? 'UPDATED' : 'INSTALLED',
    };
  } finally {
    cleanupDirectory(staged.artifactRoot, 'project projection artifact stage');
  }
}

function validateRelocatableAgentsSkillsProjection(options = {}) {
  const errors = [];
  let roots;
  try {
    const inventory = options.inventory || {
      project_agent_projection: {
        scope: 'project',
        owner: 'dhpk.project-agent-projection',
        managed_root: '.agents/skills',
        receipt: '.agents/.dhpk-installed.json',
      },
    };
    roots = resolveRoots({
      sourceRoot: options.sourceRoot || options.root || null,
      projectRoot: options.projectRoot,
      outDir: options.outDir,
      inventory,
      allowMissingSource: true,
    });
    recoverProjectProjectionTransaction(roots);
    const managedStat = lstatOrNull(roots.managedRoot);
    if (!managedStat || managedStat.isSymbolicLink() || !managedStat.isDirectory()) throw fail('MISSING_PROJECTION', 'project projection managed root is missing or unsafe');
    const receipt = readProjectProjectionReceipt(roots);
    if (!receipt) {
      if (lstatOrNull(legacyManifestPath(roots))) {
        return {
          ok: false,
          state: 'LEGACY_UNBOUND',
          classification: 'LEGACY_UNBOUND',
          errors: ['legacy-unbound project projection has no lifecycle receipt; review and run an explicit adopt or repair action'],
          selectedIds: [],
          emittedIds: [],
          runtime: 'NOT_RUN',
          projectRoot: roots.projectRoot,
          outputRoot: roots.managedRoot,
        };
      }
      throw fail('MISSING_RECEIPT', `project projection receipt is missing: ${roots.receiptPath}`);
    }
    if (receipt.legacyUnbound) {
      return {
        ok: false,
        state: 'LEGACY_UNBOUND',
        classification: 'LEGACY_UNBOUND',
        errors: ['legacy-unbound project projection requires explicit adopt or repair before lifecycle ownership can change'],
        selectedIds: receipt.selectedIds,
        emittedIds: receipt.emittedIds,
        runtime: 'NOT_RUN',
        receipt,
        projectRoot: roots.projectRoot,
        outputRoot: roots.managedRoot,
      };
    }
    validateManagedFiles(roots, receipt);
    let providers = null;
    try {
      providers = createProjectAgentProviderAdapters(receipt.hostBindings, {
        entries: receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name, discoveryVisible: entry.discoveryVisible })),
        claudeSourceRoot: receipt.schema === PROJECT_RECEIPT_SCHEMA
          ? roots.claudeManagedRootRelative
          : roots.config.managed_root,
        portableSourceRoot: roots.config.managed_root,
      });
    } catch (error) {
      errors.push(error.message);
    }
    for (const entry of receipt.entries) {
      const portablePaths = [];
      const claudePaths = [];
      if (providers && providers.directory.hosts.length > 0) {
        portablePaths.push(...(entry.sourceFiles || []).map((sourceFile) => `${entry.name}/${sourceFile.path}`));
      }
      if (providers && providers.directory.hosts.includes('claude')) {
        claudePaths.push(...(entry.sourceFiles || []).map((sourceFile) => `${entry.name}/${sourceFile.path}`));
      }
      if (providers && providers.directFile.hosts.length > 0) portablePaths.push(`${entry.name}.md`);
      for (const required of [...new Set(portablePaths)].sort()) {
        if (!receipt.managedPaths.includes(required)) errors.push(`receipt entry is missing generated path: ${required}`);
        else {
          const target = pathIn(roots.managedRoot, required, 'generated projection path');
          const content = fs.readFileSync(target, 'utf8');
          if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) errors.push(`possible secret in generated projection: ${required}`);
          if (!required.includes('/') && content.includes(`skills/${entry.name}/SKILL.md`)) {
            errors.push(`AGY direct-file entry contains a source-checkout pointer: ${required}`);
          }
          if (!required.includes('/')) {
            const parsed = parseFrontmatter(content);
            if (!parsed.present || parsed.values.name !== entry.name || !parsed.values.description) {
              errors.push(`AGY direct-file entry has invalid portable frontmatter: ${required}`);
            }
          }
        }
      }
      for (const required of [...new Set(claudePaths)].sort()) {
        if (!receipt.claudeManagedPaths || !receipt.claudeManagedPaths.includes(required)) {
          errors.push(`receipt entry is missing Claude generated path: ${required}`);
          continue;
        }
        const target = pathIn(roots.claudeManagedRoot, required, 'Claude generated projection path');
        const content = fs.readFileSync(target, 'utf8');
        if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) errors.push(`possible secret in Claude projection: ${required}`);
      }
      if (providers && providers.directory.hosts.some((hostId) => hostId !== 'claude') && providers.directFile.hosts.length > 0) {
        const directoryPath = pathIn(roots.managedRoot, `${entry.name}/SKILL.md`, 'directory skill path');
        const directPath = pathIn(roots.managedRoot, `${entry.name}.md`, 'AGY direct-file path');
        const directoryStat = lstatOrNull(directoryPath);
        const directStat = lstatOrNull(directPath);
        if (directoryStat && directStat && sha256Hex(fs.readFileSync(directoryPath)) !== sha256Hex(fs.readFileSync(directPath))) {
          errors.push(`provider-shaped outputs do not share the same skill body: ${entry.name}`);
        }
      }
    }
    if (options.inventory && (options.sourceRoot || options.root)) {
      const requestedHosts = options.requestedHosts || Object.keys(receipt.hostBindings || {}).sort();
      const plan = compilePlan({
        inventory: options.inventory,
        plan: options.plan,
        profileId: options.profileId || receipt.profileId || 'portable-core',
        requestedHosts,
        selectedStableIds: receipt.declaredSelection === true ? (receipt.selectedIdentities
          ? receipt.selectedIdentities.map((entry) => `${entry.entityKind}:${entry.stableId}`)
          : receipt.selectedIds.map((id) => receipt.entries.some((entry) => entry.stableId === id) ? `skill:${id}` : id)) : options.selectedStableIds,
        declaredSelection: receipt.declaredSelection === true || options.declaredSelection,
      });
      if (plan.planFingerprint !== receipt.planFingerprint) errors.push('receipt plan fingerprint does not match the compiler-owned plan');
      const byId = new Map(inventoryEntries(options.inventory).map((entry) => [entry.identityKey, entry]));
      for (const entry of receipt.entries) {
        const sourceEntry = byId.get(`skill:${entry.stableId}`);
        if (!sourceEntry) continue;
        const sourceDirectory = path.resolve(roots.sourceRoot, sourceEntry.path);
        if (!lstatOrNull(sourceDirectory)) continue;
        const dependencies = resolveStandaloneSkillDependencies(options.inventory, entry.name, roots.sourceRoot);
        for (const dependency of dependencies) {
          assertPhysicalAncestors(dependency.absolute, `standalone dependency '${dependency.source}'`, roots.sourceRoot);
        }
        const currentManifest = sourceManifest(sourceDirectory, dependencies);
        const current = currentManifest.sourceFingerprint;
        if (current !== entry.sourceFingerprint) errors.push(`source fingerprint drifted: ${entry.name}`);
      }
    }
    return {
      ok: errors.length === 0,
      state: errors.length === 0 ? 'VALID' : 'INVALID',
      classification: errors.length === 0 ? 'VALID_RECEIPT_OWNED' : 'MODIFIED_MANAGED',
      errors,
      selectedIds: receipt.selectedIds,
      emittedIds: receipt.emittedIds,
      runtime: 'NOT_RUN',
      receipt,
      projectRoot: roots.projectRoot,
      outputRoot: roots.managedRoot,
    };
  } catch (error) {
    errors.push(error.message);
    return { ok: false, errors, selectedIds: [], emittedIds: [], runtime: 'NOT_RUN' };
  }
}

function operationRoots(options = {}) {
  const projectRoot = options.projectRoot;
  if (!projectRoot) throw fail('INVALID_PROJECT_ROOT', 'projectRoot is required for project projection lifecycle operations');
  const inventory = options.inventory || {
    project_agent_projection: {
      scope: 'project',
      owner: 'dhpk.project-agent-projection',
      managed_root: '.agents/skills',
      receipt: '.agents/.dhpk-installed.json',
    },
  };
  return resolveRoots({ sourceRoot: options.sourceRoot || null, projectRoot, outDir: options.outDir, inventory, allowMissingSource: true });
}

function uninstallAgentsSkillsProjection(options = {}) {
  try {
    const roots = operationRoots(options);
    // 先驗證原始收據，再隔離並比對原始位元組，避免以過期所有權刪除使用者內容。
    readProjectionReceipt(roots, { allowLegacyClaudeDiscovery: true, releaseLegacy: true });
    ensureDirectory(roots.projectRoot, 'project root', roots.projectRoot);
    ensureDirectory(roots.agentsRoot, 'project agents root', roots.projectRoot);
    recoverProjectProjectionTransaction(roots);
    const receipt = readProjectionReceipt(roots, { allowLegacyClaudeDiscovery: true, releaseLegacy: true });
    if (!receipt) {
      if (lstatOrNull(legacyManifestPath(roots))) throw fail('LEGACY_UNBOUND', 'legacy project projection has no lifecycle receipt and cannot be removed automatically');
      return { ok: true, state: 'ABSENT', held: false, removedPaths: [], preservedPaths: [], projectRoot: roots.projectRoot };
    }
    if (receipt.generatorVersion === '2.0.0' && !Object.prototype.hasOwnProperty.call(receipt, 'fingerprint_algorithm')) {
      const observed = fs.readFileSync(roots.receiptPath);
      const observedReceipt = validateReceipt(JSON.parse(observed), roots, { allowLegacyClaudeDiscovery: true, releaseLegacy: true });
      if (observedReceipt.receiptFingerprint !== receipt.receiptFingerprint) {
        throw fail('RECEIPT_CHANGED', 'project projection receipt changed before release');
      }
      const quarantine = path.join(roots.agentsRoot, `.dhpk-released-receipt-${crypto.randomBytes(12).toString('hex')}`);
      fs.renameSync(roots.receiptPath, quarantine);
      const quarantined = lstatOrNull(quarantine);
      if (!quarantined || quarantined.isSymbolicLink() || !quarantined.isFile() || !fs.readFileSync(quarantine).equals(observed)) {
        if (!lstatOrNull(roots.receiptPath)) fs.renameSync(quarantine, roots.receiptPath);
        throw fail('RECEIPT_CHANGED', 'project projection receipt changed during release');
      }
      fs.unlinkSync(quarantine);
      const preservedPaths = [...receipt.managedPaths.map((entry) => `${roots.config.managed_root}/${entry}`), ...(receipt.claudeManagedPaths || []).map((entry) => `${roots.claudeManagedRootRelative}/${entry}`), ...flattenBindingPaths(receipt.bindingPaths || {}).map((entry) => entry.path)];
      return { ok: true, state: 'REMOVED', removedPaths: [], preservedPaths, released: preservedPaths.map((entry) => ({ name: entry })), projectRoot: roots.projectRoot };
    }
    validateManagedFiles(roots, receipt);
    const published = publishManagedCandidate({
      roots,
      previous: receipt,
      candidateRoot: null,
      candidateFiles: [],
      candidateFingerprints: {},
      nextReceipt: null,
      createRollback: false,
      hold: options.hold || null,
    });
    return { ok: true, state: 'REMOVED', held: Boolean(published.held), removedPaths: receipt.managedPaths, preservedPaths: [], projectRoot: roots.projectRoot, published };
  } catch (error) {
    return {
      ok: false,
      state: error.projectionCode === 'MANAGED_CONTENT_CHANGED' ? 'MODIFIED_MANAGED' : 'BLOCKED',
      code: error.projectionCode || 'UNINSTALL_FAILED',
      error: { code: error.projectionCode || 'UNINSTALL_FAILED', message: error.message },
      preservedPaths: error.projectionDetails && error.projectionDetails.paths || [],
    };
  }
}

function snapshotReceipt(roots, receipt) {
  if (!receipt || !receipt.rollback
    || ![PROJECT_ROLLBACK_SCHEMA, LEGACY_PROJECT_ROLLBACK_SCHEMA].includes(receipt.rollback.schema)) {
    throw fail('NO_ROLLBACK', 'project projection has no valid rollback snapshot');
  }
  const rollbackRoot = path.resolve(roots.projectRoot, receipt.rollback.root);
  if (!isInside(roots.projectRoot, rollbackRoot) || rollbackRoot !== path.join(roots.agentsRoot, '.dhpk-projection-rollback')) throw fail('INVALID_ROLLBACK', 'rollback snapshot root is unsafe');
  const snapshotReceipt = readJsonFile(path.join(rollbackRoot, receipt.rollback.receipt), 'rollback receipt');
  validateReceipt(snapshotReceipt, roots);
  const filesRoot = path.join(rollbackRoot, receipt.rollback.files);
  const groupedLayout = receipt.rollback.schema === PROJECT_ROLLBACK_SCHEMA || receipt.rollback.layout === 'grouped';
  const managedSnapshotRoot = groupedLayout
    ? path.join(filesRoot, 'managed')
    : filesRoot;
  const claudeSnapshotRoot = path.join(filesRoot, 'claude-managed');
  for (const relative of snapshotReceipt.managedPaths) {
    const source = pathIn(managedSnapshotRoot, relative, 'rollback snapshot file');
    const stat = lstatOrNull(source);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || sha256Hex(fs.readFileSync(source)) !== snapshotReceipt.generatedFingerprints[relative]) {
      throw fail('INVALID_ROLLBACK', `rollback snapshot is incomplete or drifted: ${relative}`, { paths: [relative] });
    }
  }
  for (const relative of snapshotReceipt.claudeManagedPaths || []) {
    const source = pathIn(claudeSnapshotRoot, relative, 'Claude rollback snapshot file');
    const stat = lstatOrNull(source);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || sha256Hex(fs.readFileSync(source)) !== snapshotReceipt.claudeGeneratedFingerprints[relative]) {
      throw fail('INVALID_ROLLBACK', `Claude rollback snapshot is incomplete or drifted: ${relative}`, { paths: [relative] });
    }
  }
  const expected = fingerprint({
    receipt: snapshotReceipt,
    files: groupedLayout
      ? [
        ...snapshotReceipt.managedPaths.map((relative) => ({ root: 'managed', relative, fingerprint: snapshotReceipt.generatedFingerprints[relative] })),
        ...(snapshotReceipt.claudeManagedPaths || []).map((relative) => ({ root: 'claude', relative, fingerprint: snapshotReceipt.claudeGeneratedFingerprints[relative] })),
      ].sort((left, right) => `${left.root}/${left.relative}`.localeCompare(`${right.root}/${right.relative}`))
      : snapshotReceipt.managedPaths.map((relative) => ({ relative, fingerprint: snapshotReceipt.generatedFingerprints[relative] })).sort((left, right) => left.relative.localeCompare(right.relative)),
  });
  if (expected !== receipt.rollback.fingerprint) throw fail('INVALID_ROLLBACK', 'rollback snapshot fingerprint is invalid');
  return { receipt: snapshotReceipt, filesRoot: managedSnapshotRoot, claudeFilesRoot: claudeSnapshotRoot };
}

function rollbackAgentsSkillsProjection(options = {}) {
  try {
    const roots = operationRoots(options);
    readProjectProjectionReceipt(roots);
    ensureDirectory(roots.projectRoot, 'project root', roots.projectRoot);
    ensureDirectory(roots.agentsRoot, 'project agents root', roots.projectRoot);
    ensureDirectory(roots.managedRoot, 'project managed root', roots.projectRoot);
    recoverProjectProjectionTransaction(roots);
    const current = readProjectProjectionReceipt(roots);
    if (!current) return { ok: false, state: 'BLOCKED', code: 'MISSING_RECEIPT', error: { code: 'MISSING_RECEIPT', message: 'project projection receipt is missing' } };
    validateManagedFiles(roots, current);
    const snapshot = snapshotReceipt(roots, current);
    const candidateFiles = snapshot.receipt.managedPaths.slice().sort();
    const candidateFingerprints = snapshot.receipt.generatedFingerprints;
    const candidateStage = fs.mkdtempSync(path.join(roots.agentsRoot, '.dhpk-projection-rollback-candidate-'));
    const candidateRoot = path.join(candidateStage, 'published');
    fs.mkdirSync(candidateRoot, { recursive: true });
    for (const relative of candidateFiles) {
      const source = pathIn(snapshot.filesRoot, relative, 'rollback candidate source');
      const target = path.join(candidateRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    const claudeCandidateFiles = (snapshot.receipt.claudeManagedPaths || []).slice().sort();
    for (const relative of claudeCandidateFiles) {
      const source = pathIn(snapshot.claudeFilesRoot, relative, 'Claude rollback candidate source');
      const target = path.join(candidateRoot, CLAUDE_ARTIFACT_ROOT, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    try {
      const published = publishManagedCandidate({
        roots,
        previous: current,
        candidateRoot,
        candidateFiles,
        candidateFingerprints,
        claudeCandidateFiles,
        claudeCandidateFingerprints: snapshot.receipt.claudeGeneratedFingerprints || {},
        nextReceipt: snapshot.receipt,
        // rollback 回到納管前的狀態：被 --adopt/--repair 接管的連結在同一交易內恢復為未納管的原連結。
        restoredBindingPaths: current.rollback.adoptedBindingPaths || {},
      });
      return { ok: true, state: 'ROLLED_BACK', receipt: published.receipt, removedPaths: [], preservedPaths: [], projectRoot: roots.projectRoot };
    } finally {
      cleanupDirectory(candidateStage, 'project projection rollback candidate');
    }
  } catch (error) {
    return {
      ok: false,
      state: error.projectionCode === 'MANAGED_CONTENT_CHANGED' ? 'MODIFIED_MANAGED' : 'BLOCKED',
      code: error.projectionCode || 'ROLLBACK_FAILED',
      error: { code: error.projectionCode || 'ROLLBACK_FAILED', message: error.message },
      preservedPaths: error.projectionDetails && error.projectionDetails.paths || [],
    };
  }
}

function resolveHeldProjection(options, action) {
  try {
    const roots = operationRoots(options);
    const transactionId = normalizeHold({ transactionId: options.transactionId, host: 'resolver' }).transactionId;
    const transaction = readTransactionJournal(roots);
    if (!transaction) return { ok: true, state: 'ABSENT', transactionId, projectRoot: roots.projectRoot };
    const paths = validateTransaction(roots, transaction);
    if (!transaction.hold || transaction.hold.transactionId !== transactionId) {
      throw fail('TRANSACTION_MISMATCH', `project projection transaction journal is not held by ${transactionId}`);
    }
    if (action === 'abort') {
      const recovered = recoverProjectProjectionTransaction(roots, { resolveHeld: transactionId });
      return { ok: true, state: recovered.phase === 'published' ? 'COMMITTED' : 'ABORTED', transactionId, projectRoot: roots.projectRoot };
    }
    if (transaction.phase === 'published') {
      recoverProjectProjectionTransaction(roots, { resolveHeld: transactionId });
      return { ok: true, state: 'COMMITTED', transactionId, projectRoot: roots.projectRoot };
    }
    if (transaction.phase !== 'publishing' || transaction.holdReady !== true) {
      throw fail('TRANSACTION_INCOMPLETE', `project projection transaction ${transactionId} did not finish publishing and can only be aborted`);
    }
    const journalPath = transactionPath(roots);
    transaction.phase = 'published';
    writeAtomicJson(journalPath, transaction, roots.projectRoot);
    if (transaction.adoption !== true) cleanupDirectory(paths.backup, 'project projection transaction backup');
    cleanupDirectory(paths.rollbackStage, 'project projection rollback stage');
    cleanupDirectory(paths.stage, 'project projection transaction stage');
    fs.rmSync(journalPath, { force: true });
    return {
      ok: true,
      state: 'COMMITTED',
      transactionId,
      projectRoot: roots.projectRoot,
      ...(transaction.adoption === true ? { backupPath: paths.backup } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      state: 'BLOCKED',
      code: error.projectionCode || 'TRANSACTION_RESOLVE_FAILED',
      error: { code: error.projectionCode || 'TRANSACTION_RESOLVE_FAILED', message: error.message },
    };
  }
}

// Read-only view of a held publication for explicit recovery.
function heldProjection(options = {}) {
  const roots = operationRoots(options);
  const transaction = readTransactionJournal(roots);
  if (!transaction) return null;
  validateTransaction(roots, transaction);
  if (!transaction.hold) return null;
  return { ...transaction.hold, phase: transaction.phase, holdReady: transaction.holdReady === true };
}

function commitHeldProjection(options = {}) {
  return resolveHeldProjection(options, 'commit');
}

function abortHeldProjection(options = {}) {
  return resolveHeldProjection(options, 'abort');
}

module.exports = {
  PROJECT_RECEIPT_SCHEMA,
  PROJECT_ROLLBACK_SCHEMA,
  PROJECT_TRANSACTION_SCHEMA,
  GENERATOR_VERSION,
  materializeRelocatableAgentsSkillsProjection,
  validateRelocatableAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
  removeAgentsSkillsProjection: uninstallAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
  commitHeldProjection,
  abortHeldProjection,
  heldProjection,
  recoverAgentsSkillsProjection: (options = {}) => recoverProjectProjectionTransaction(operationRoots(options)),
  readProjectProjectionReceipt,
};
