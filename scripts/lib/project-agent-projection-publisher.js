'use strict';

// Relocatable project projection publisher. The compiler owns selection and
// this module owns only the filesystem adapter: it stages a complete candidate
// through ProjectionArtifactStore, then reconciles receipt-owned paths into an
// external consumer project without replacing foreign content.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFrontmatter } = require('./agent-plugin-package');
const {
  compileProjectAgentProjection,
  materializeDistribution,
} = require('./distribution-compiler');
const {
  createDistributionPlan,
  fingerprint,
} = require('./distribution-projection-contract');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');
const {
  createProjectAgentProviderAdapters,
  CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID,
  CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CLAUDE_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CURSOR_PROJECT_DISCOVERY_ADAPTER_ID,
  CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CURSOR_PROJECT_DISCOVERY_DESTINATION_ROOT,
  CODEX_PROJECT_DISCOVERY_ADAPTER_ID,
  CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION,
  CODEX_PROJECT_DISCOVERY_DESTINATION_ROOT,
  NATIVE_LINK_SHAPE,
  DIRECT_SHAPE,
  renderAgyDirectFile,
} = require('./project-agent-provider-adapters');

const PROJECT_RECEIPT_SCHEMA = 'dhpk.project-agent-projection-receipt.v1';
const PROJECT_ROLLBACK_SCHEMA = 'dhpk.project-agent-projection-rollback.v1';
const PROJECT_TRANSACTION_SCHEMA = 'dhpk.project-agent-projection-transaction.v1';
const GENERATOR_VERSION = '2.0.0';
const LEGACY_MANIFEST_NAME = '.dhpk-projection.json';
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

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.projectionCode = code;
  error.projectionDetails = details;
  return error;
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertSafeRelative(relative, label) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.includes('\0')
    || relative.includes('\\') || path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
    throw fail('UNSAFE_PATH', `${label} must be a normalized relative path`, { paths: [relative] });
  }
  const parts = relative.split('/');
  if (parts.includes('.') || parts.includes('..') || parts.includes('')) {
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
      const message = current === resolvedCandidate
        ? `${label} is a symlink at candidate path: ${current}; remove the conflicting symlink before retrying`
        : `${label} has a symlinked ancestor: ${current}; remove a conflicting skill symlink or replace the symlinked directory with a physical directory before retrying`;
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
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')
    || target.includes('\\') || path.posix.isAbsolute(target) || /^[A-Za-z]:/.test(target)) {
    throw fail('UNSAFE_PATH', `${label} must be a normalized relative symlink target`, { paths: [target] });
  }
  const parts = target.split('/');
  if (parts.some((part) => part === '' || part === '.') || path.posix.normalize(target) !== target) {
    throw fail('UNSAFE_PATH', `${label} must be a normalized relative symlink target`, { paths: [target] });
  }
  return target;
}

function bindingDestinationIn(roots, relative, label = 'projection binding path') {
  assertSafeRelative(relative, label);
  const candidate = path.resolve(roots.projectRoot, relative);
  if (!isInside(roots.projectRoot, candidate)) throw fail('PATH_ESCAPE', `${label} escapes the project root: ${relative}`, { paths: [relative] });
  // The final component may intentionally be a symlink. Only its ancestors
  // must remain physical so the binding cannot redirect a project path.
  assertPhysicalAncestors(path.dirname(candidate), label, roots.projectRoot);
  return candidate;
}

function bindingTargetIn(roots, binding, label = 'projection binding') {
  const destination = bindingDestinationIn(roots, binding.path, `${label} path`);
  const target = assertSafeLinkTarget(binding.target, `${label} target`);
  const resolvedTarget = path.resolve(path.dirname(destination), target);
  if (!isInside(roots.projectRoot, resolvedTarget) || !isInside(roots.managedRoot, resolvedTarget)) {
    throw fail('PATH_ESCAPE', `${label} target must resolve inside the managed project artifact: ${binding.target}`, {
      paths: [binding.path, binding.target],
    });
  }
  assertPhysicalAncestors(resolvedTarget, `${label} target`, roots.projectRoot);
  return { destination, target, resolvedTarget };
}

function normalizeBindingPaths(bindingPaths, roots, label = 'project projection binding paths') {
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
      bindingTargetIn(roots, value, `${label} '${hostId}'`);
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

function validateReceiptBindings(receipt, roots) {
  const legacyUnbound = receipt.legacyUnbound === true;
  if (receipt.legacyUnbound !== undefined && typeof receipt.legacyUnbound !== 'boolean') {
    throw fail('INVALID_RECEIPT', 'project projection receipt legacyUnbound flag is invalid');
  }
  const bindingPaths = normalizeBindingPaths(receipt.bindingPaths || {}, roots);
  const allowedBindingHosts = new Set(['claude', 'codex', 'cursor']);
  for (const hostId of Object.keys(bindingPaths)) {
    if (!allowedBindingHosts.has(hostId)) {
      throw fail('INVALID_RECEIPT', `project projection receipt has unsupported Host binding paths: ${hostId}`);
    }
  }
  if (legacyUnbound) {
    if (Object.keys(receipt.hostBindings || {}).length > 0) {
      throw fail('INVALID_RECEIPT', 'legacy-unbound project projection receipt cannot claim active Host bindings');
    }
    return bindingPaths;
  }
  let providers;
  try {
    providers = createProjectAgentProviderAdapters(receipt.hostBindings, {
      entries: receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name })),
      claudeSourceRoot: roots.config.managed_root,
    });
  } catch (error) {
    throw fail('INVALID_RECEIPT', error.message);
  }
  for (const hostId of Object.keys(bindingPaths)) {
    if (!providers.forHost[hostId]) throw fail('INVALID_RECEIPT', `project projection receipt has an unbound Host path set: ${hostId}`);
  }
  assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
    hostId: 'claude',
    adapterId: CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID,
    adapterVersion: CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION,
    label: 'Claude',
  });
  const cursorBinding = receipt.hostBindings && receipt.hostBindings.cursor;
  const cursorShape = cursorBinding && (
    cursorBinding.bindingShape === DIRECT_SHAPE || cursorBinding.bindingShape === NATIVE_LINK_SHAPE
  ) ? cursorBinding.bindingShape : null;
  const cursorDiscoveryRecorded = Boolean(
    cursorBinding && (
      cursorBinding.discovery
      || cursorShape
      || (bindingPaths.cursor && bindingPaths.cursor.length > 0)
    )
  );
  assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
    hostId: 'cursor',
    adapterId: CURSOR_PROJECT_DISCOVERY_ADAPTER_ID,
    adapterVersion: CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION,
    label: 'Cursor',
    bindingShape: cursorDiscoveryRecorded ? (cursorShape || NATIVE_LINK_SHAPE) : null,
    required: cursorDiscoveryRecorded,
  });
  const codexBinding = receipt.hostBindings && receipt.hostBindings.codex;
  const codexShape = codexBinding && (
    codexBinding.bindingShape === DIRECT_SHAPE || codexBinding.bindingShape === NATIVE_LINK_SHAPE
  ) ? codexBinding.bindingShape : null;
  const codexDiscoveryRecorded = Boolean(
    codexBinding && (
      codexBinding.discovery
      || codexShape
      || (bindingPaths.codex && bindingPaths.codex.length > 0)
    )
  );
  assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
    hostId: 'codex',
    adapterId: CODEX_PROJECT_DISCOVERY_ADAPTER_ID,
    adapterVersion: CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION,
    label: 'Codex',
    bindingShape: codexDiscoveryRecorded ? (codexShape || NATIVE_LINK_SHAPE) : null,
    required: codexDiscoveryRecorded,
  });
  return bindingPaths;
}

function assertDiscoveryBindingSet(receipt, providers, bindingPaths, {
  hostId,
  adapterId,
  adapterVersion,
  label,
  bindingShape = null,
  required = true,
}) {
  const discovery = providers.forHost[hostId] && providers.forHost[hostId].discovery;
  if (!required) {
    if (bindingPaths[hostId] && bindingPaths[hostId].length > 0) {
      throw fail('INVALID_RECEIPT', `project projection receipt has ${label} paths without a ${label} Host binding`);
    }
    return;
  }
  if (bindingShape === DIRECT_SHAPE) {
    if ((bindingPaths[hostId] || []).length > 0) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} direct bindings must not publish native-link paths`);
    }
    const descriptor = receipt.hostBindings[hostId] && receipt.hostBindings[hostId].discovery;
    if (!descriptor || descriptor.adapterId !== adapterId || descriptor.adapterVersion !== adapterVersion) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} discovery adapter identity is invalid`);
    }
    if (receipt.hostBindings[hostId].bindingShape !== DIRECT_SHAPE) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} bindingShape must be ${DIRECT_SHAPE}`);
    }
    const expectedNames = (discovery && discovery.entries ? discovery.entries : [])
      .map((entry) => entry.name)
      .slice()
      .sort();
    const bindings = Array.isArray(receipt.hostBindings[hostId].bindings) ? receipt.hostBindings[hostId].bindings : [];
    const actualNames = bindings.map((entry) => entry && entry.name).slice().sort();
    if (bindings.some((entry) => !entry || entry.shape !== DIRECT_SHAPE || entry.path || entry.target)
      || actualNames.join('\0') !== expectedNames.join('\0')) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} direct bindings do not match the selected artifact`);
    }
    return;
  }
  if (discovery) {
    const expected = discovery.entries.map((entry) => ({ path: entry.path, target: entry.target }));
    const actual = bindingPaths[hostId] || [];
    if (actual.length !== expected.length || actual.some((entry, index) => entry.path !== expected[index].path || entry.target !== expected[index].target)) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} discovery bindings do not match the selected artifact`);
    }
    const descriptor = receipt.hostBindings[hostId] && receipt.hostBindings[hostId].discovery;
    if (!descriptor || descriptor.adapterId !== adapterId || descriptor.adapterVersion !== adapterVersion) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} discovery adapter identity is invalid`);
    }
    if (bindingShape && receipt.hostBindings[hostId].bindingShape !== bindingShape) {
      throw fail('INVALID_RECEIPT', `project projection receipt ${label} bindingShape must be ${bindingShape}`);
    }
  } else if (bindingPaths[hostId] && bindingPaths[hostId].length > 0) {
    throw fail('INVALID_RECEIPT', `project projection receipt has ${label} paths without a ${label} Host binding`);
  }
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

function sourceManifest(sourceDirectory) {
  const files = validateLogicalFiles(collectFiles(sourceDirectory), `skill '${path.basename(sourceDirectory)}'`);
  const manifest = [];
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = readPhysicalFile(file.absolute, `canonical source file '${file.relative}'`);
    const fileDigest = digest(content);
    manifest.push({ path: file.relative, digest: fileDigest });
    hash.update(file.relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content.toString('utf8')))) {
      throw fail('SECRET_DETECTED', `possible secret in canonical source: ${file.relative}`, { paths: [file.relative] });
    }
  }
  return { files, sourceFiles: manifest, sourceFingerprint: hash.digest('hex') };
}

function inventoryEntries(inventory) {
  return [...(Array.isArray(inventory && inventory.skills) ? inventory.skills : []),
    ...(Array.isArray(inventory && inventory.modules) ? inventory.modules : [])]
    .filter((entry) => entry && typeof entry === 'object');
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
  const agentsStat = lstatOrNull(agentsRoot);
  if (agentsStat && (agentsStat.isSymbolicLink() || !agentsStat.isDirectory())) {
    throw fail('UNSAFE_PATH', `project agents root must be a physical directory: ${agentsRoot}`, { paths: [agentsRoot] });
  }
  assertPhysicalAncestors(agentsRoot, 'project agents root', resolvedProjectRoot);
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
    receiptPath: receipt,
    config,
  };
}

function planValue(input) {
  if (input && input.ok === true && input.value) return input.value;
  return input;
}

function stampDiscoveryHost(hostBindings, bindingPaths, providers, {
  hostId,
  adapterId,
  adapterVersion,
  bindingShape = null,
  bindingReason = null,
}) {
  const discovery = providers.forHost[hostId] && providers.forHost[hostId].discovery;
  if (!discovery) return;
  if (bindingShape === DIRECT_SHAPE) {
    bindingPaths[hostId] = [];
    const stamped = {
      ...hostBindings[hostId],
      discovery: {
        adapterId,
        adapterVersion,
        kind: 'direct',
        sourceRoot: discovery.sourceRoot,
        destinationRoot: discovery.destinationRoot,
        paths: [],
      },
      bindingShape: DIRECT_SHAPE,
      bindings: discovery.entries.map((entry) => ({
        stableId: entry.stableId,
        name: entry.name,
        shape: DIRECT_SHAPE,
      })),
    };
    if (bindingReason) stamped.bindingReason = bindingReason;
    hostBindings[hostId] = stamped;
    return;
  }
  bindingPaths[hostId] = discovery.entries.map(({ path: bindingPath, target }) => ({
    path: bindingPath,
    target,
  }));
  const stamped = {
    ...hostBindings[hostId],
    discovery: {
      adapterId,
      adapterVersion,
      kind: discovery.kind,
      sourceRoot: discovery.sourceRoot,
      destinationRoot: discovery.destinationRoot,
      paths: bindingPaths[hostId].map((entry) => entry.path),
    },
  };
  if (bindingShape) {
    stamped.bindingShape = bindingShape;
    stamped.bindings = discovery.entries.map((entry) => ({
      stableId: entry.stableId,
      name: entry.name,
      path: entry.path,
      target: entry.target,
      shape: bindingShape,
    }));
  }
  if (bindingReason) stamped.bindingReason = bindingReason;
  hostBindings[hostId] = stamped;
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
  const source = byId.get(planEntry.stableId);
  if (!source) throw fail('PROJECT_ENTRY_MISSING', `compiled project entry is absent from inventory: ${planEntry.stableId}`, { stableIds: [planEntry.stableId] });
  return source;
}

function applyHostSelections(hostBindings, hostSelections) {
  if (!hostSelections || typeof hostSelections !== 'object' || Array.isArray(hostSelections)) {
    return hostBindings;
  }
  const next = clone(hostBindings);
  for (const hostId of Object.keys(hostSelections)) {
    if (!next[hostId]) continue;
    const ids = Array.isArray(hostSelections[hostId])
      ? [...new Set(hostSelections[hostId])].sort()
      : [];
    next[hostId] = {
      ...next[hostId],
      selectedStableIds: ids,
      emittedStableIds: ids,
    };
  }
  return next;
}

function restorePreservedHostBindings(hostBindings, preserveHostBindings) {
  if (!preserveHostBindings || typeof preserveHostBindings !== 'object' || Array.isArray(preserveHostBindings)) {
    return hostBindings;
  }
  const next = clone(hostBindings);
  for (const hostId of Object.keys(preserveHostBindings)) {
    next[hostId] = clone(preserveHostBindings[hostId]);
  }
  return next;
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
  const byId = new Map(inventoryEntries(inventory).map((entry) => [entry.id, entry]));
  const adapterEntries = (plan.entries || []).map((planEntry) => {
    const sourceEntry = sourceEntryFor(planEntry, byId);
    const name = safeName(sourceEntry.name || sourceEntry.publicName || path.basename(sourceEntry.path), `inventory entry '${planEntry.stableId}' name`);
    return { stableId: planEntry.stableId, name };
  });
  const cursorShape = nativeLinkShapeFrom(cursorBinding);
  const codexShape = nativeLinkShapeFrom(codexBinding);
  let hostBindings = applyHostSelections(clone(plan.hostBindings || {}), hostSelections);
  hostBindings = restorePreservedHostBindings(hostBindings, preserveHostBindings);
  const providers = createProjectAgentProviderAdapters(hostBindings, {
    entries: adapterEntries,
    claudeSourceRoot: roots.config.managed_root,
    cursorBindingShape: cursorShape,
    codexBindingShape: codexShape,
  });
  const records = [];
  const receiptEntries = [];
  const sourceFingerprints = {};
  const usedDestinations = new Set();
  const usedPrefixes = new Set();

  const addRecord = ({ stableId, source, destination, content, transform, metadata = {}, sourceStableId = null, sourceFingerprint = null, mode = null }) => {
    assertSafeRelative(destination, 'generated destination');
    if (usedDestinations.has(destination)) throw fail('DUPLICATE_OUTPUT', `generated destination is duplicated: ${destination}`, { paths: [destination] });
    if (usedPrefixes.has(destination)) throw fail('DUPLICATE_OUTPUT', `generated destination has a file-prefix collision: ${destination}`, { paths: [destination] });
    const segments = destination.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join('/');
      if (usedDestinations.has(prefix)) {
        throw fail('DUPLICATE_OUTPUT', `generated destination has a file-prefix collision: ${prefix} and ${destination}`, { paths: [prefix, destination] });
      }
    }
    usedDestinations.add(destination);
    for (let index = 1; index < segments.length; index += 1) usedPrefixes.add(segments.slice(0, index).join('/'));
    const value = {
      stableId,
      source,
      destination,
      owner: plan.projectionOwner && plan.projectionOwner.owner || 'dhpk.project-agent-projection',
      transform: transform || { id: 'project-agent-generated', version: GENERATOR_VERSION },
      expectedFingerprint: digest(content),
      mode,
      symlinkPolicy: 'forbid',
      ...(sourceFingerprint ? { sourceFingerprint } : {}),
      ...metadata,
    };
    records.push({ value, content, sourceStableId });
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
    const manifest = sourceManifest(sourceDirectory);
    const skillFile = manifest.files.find((file) => file.relative === 'SKILL.md');
    if (!skillFile) throw fail('MISSING_SKILL', `canonical skill '${name}' is missing SKILL.md`, { stableIds: [planEntry.stableId] });
    const skillContent = readPhysicalFile(skillFile.absolute, `canonical skill '${name}/SKILL.md'`);
    const parsed = parseFrontmatter(skillContent.toString('utf8'));
    if (!parsed.present || parsed.values.name !== name || !parsed.values.description) {
      throw fail('INVALID_SKILL_FRONTMATTER', `canonical skill '${name}' has invalid frontmatter`, { stableIds: [planEntry.stableId] });
    }
    sourceFingerprints[planEntry.stableId] = manifest.sourceFingerprint;
    const metadata = planEntryMetadata(planEntry);
    if (metadata.provenance && typeof metadata.provenance === 'object' && !Array.isArray(metadata.provenance)) {
      metadata.provenance = {
        ...metadata.provenance,
        sourceFingerprint: manifest.sourceFingerprint,
      };
    }
    const generatedPaths = [];
    if (providers.directory.hosts.length > 0) {
      for (const file of manifest.files) {
        const content = readPhysicalFile(file.absolute, `canonical skill '${name}/${file.relative}'`);
        const destination = `${name}/${file.relative}`;
        addRecord({
          stableId: outputStableId(planEntry.stableId, 'directory', file.relative),
          source: `${sourceEntry.path}/${file.relative}`,
          destination,
          content,
          transform: providers.directory.transform,
          metadata,
          sourceStableId: planEntry.stableId,
          sourceFingerprint: manifest.sourceFingerprint,
          mode: lstatOrNull(file.absolute).mode & 0o7777,
        });
        generatedPaths.push(destination);
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
        body: skillContent,
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
      stableId: planEntry.stableId,
      name,
      source: sourceEntry.path,
      sourceFingerprint: manifest.sourceFingerprint,
      sourceFiles: manifest.sourceFiles,
      generatedPaths: generatedPaths.sort(),
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
    .map((record) => [record.value.destination, record.value.expectedFingerprint])
    .sort(([left], [right]) => left.localeCompare(right)));
  const manifestValue = {
    schema: 'dhpk.agents-skills-projection.v1',
    generatorVersion: GENERATOR_VERSION,
    selectionSurface: 'project-agent-projection',
    inventoryRevision: plan.inventoryRevision || null,
    selectedIds: (plan.selectedStableIds || []).slice().sort(),
    emittedIds: (plan.entries || []).map((entry) => entry.stableId).sort(),
    entries: receiptEntries.slice().sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: Object.keys(generatedFingerprints).sort(),
    generatedFingerprints,
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

  const bindingPaths = {};
  if (preserveBindingPaths && typeof preserveBindingPaths === 'object' && !Array.isArray(preserveBindingPaths)) {
    for (const hostId of Object.keys(preserveBindingPaths)) {
      bindingPaths[hostId] = clone(preserveBindingPaths[hostId]);
    }
  }
  const preservedHosts = new Set(Object.keys(preserveHostBindings || {}));
  if (!preservedHosts.has('claude')) {
    stampDiscoveryHost(hostBindings, bindingPaths, providers, {
      hostId: 'claude',
      adapterId: CLAUDE_PROJECT_DISCOVERY_ADAPTER_ID,
      adapterVersion: CLAUDE_PROJECT_DISCOVERY_ADAPTER_VERSION,
    });
  }
  if (!preservedHosts.has('cursor')) {
    stampDiscoveryHost(hostBindings, bindingPaths, providers, {
      hostId: 'cursor',
      adapterId: CURSOR_PROJECT_DISCOVERY_ADAPTER_ID,
      adapterVersion: CURSOR_PROJECT_DISCOVERY_ADAPTER_VERSION,
      bindingShape: cursorShape,
      bindingReason: cursorBinding && cursorBinding.reason ? cursorBinding.reason : null,
    });
  }
  if (!preservedHosts.has('codex')) {
    stampDiscoveryHost(hostBindings, bindingPaths, providers, {
      hostId: 'codex',
      adapterId: CODEX_PROJECT_DISCOVERY_ADAPTER_ID,
      adapterVersion: CODEX_PROJECT_DISCOVERY_ADAPTER_VERSION,
      bindingShape: codexShape,
      bindingReason: codexBinding && codexBinding.reason ? codexBinding.reason : null,
    });
  }

  return {
    plan: artifactPlanResult.value,
    records,
    receiptEntries,
    sourceFingerprints,
    generatedFingerprints: Object.fromEntries(records.map((record) => [record.value.destination, record.value.expectedFingerprint])),
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
  return { ...payload, receiptFingerprint: digest(stableStringify(payload)) };
}

function receiptFileDigest(receipt) {
  return digest(`${stableStringify(receipt)}\n`);
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

function validateReceipt(receipt, roots) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw fail('INVALID_RECEIPT', 'project projection receipt must be an object');
  if (receipt.schema !== PROJECT_RECEIPT_SCHEMA) throw fail('INVALID_RECEIPT', `project projection receipt must use ${PROJECT_RECEIPT_SCHEMA}`);
  if (receipt.generatorVersion !== GENERATOR_VERSION) throw fail('INVALID_RECEIPT', `project projection receipt must use generator ${GENERATOR_VERSION}`);
  if (receipt.scope !== 'project' || receipt.managedRoot !== roots.config.managed_root || receipt.receiptPath !== roots.config.receipt) {
    throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid ownership root');
  }
  if (!receipt.projectionOwner || receipt.projectionOwner.owner !== roots.config.owner) {
    throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid projection owner');
  }
  if (!DIGEST_PATTERN.test(receipt.receiptFingerprint || '')
    || digest(stableStringify(receiptPayload(receipt))) !== receipt.receiptFingerprint) {
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
  if (!Array.isArray(receipt.entries)) throw fail('INVALID_RECEIPT', 'project projection receipt is missing entries');
  if (!receipt.sourceFingerprints || typeof receipt.sourceFingerprints !== 'object' || Array.isArray(receipt.sourceFingerprints)) {
    throw fail('INVALID_RECEIPT', 'project projection receipt is missing source fingerprints');
  }
  const ids = new Set();
  const names = new Set();
  for (const entry of receipt.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.stableId !== 'string' || typeof entry.name !== 'string') throw fail('INVALID_RECEIPT', 'project projection receipt has an invalid entry');
    if (ids.has(entry.stableId) || names.has(entry.name)) throw fail('INVALID_RECEIPT', 'project projection receipt has duplicate entries');
    ids.add(entry.stableId);
    names.add(safeName(entry.name, 'receipt entry name'));
    if (typeof entry.source !== 'string' || !entry.source.startsWith('skills/')) throw fail('INVALID_RECEIPT', `receipt source is invalid for '${entry.name}'`);
    if (!DIGEST_PATTERN.test(entry.sourceFingerprint || '')) throw fail('INVALID_RECEIPT', `receipt source fingerprint is invalid for '${entry.name}'`);
    if (!legacyUnbound && receipt.sourceFingerprints[entry.stableId] !== entry.sourceFingerprint) {
      throw fail('INVALID_RECEIPT', `receipt source fingerprint map does not match '${entry.name}'`);
    }
    if (!Array.isArray(entry.sourceFiles)) throw fail('INVALID_RECEIPT', `receipt source manifest is missing for '${entry.name}'`);
    for (const sourceFile of entry.sourceFiles) {
      assertSafeRelative(sourceFile.path, 'receipt source path');
      if (!DIGEST_PATTERN.test(sourceFile.digest || '')) throw fail('INVALID_RECEIPT', `receipt source manifest is invalid for '${entry.name}'`);
    }
    if (!Array.isArray(entry.generatedPaths) || entry.generatedPaths.length === 0) throw fail('INVALID_RECEIPT', `receipt generated paths are missing for '${entry.name}'`);
    for (const generatedPath of entry.generatedPaths) {
      assertSafeRelative(generatedPath, 'receipt generated path');
      if (!receipt.managedPaths.includes(generatedPath)) throw fail('INVALID_RECEIPT', `receipt entry claims an unlisted path: ${generatedPath}`, { paths: [generatedPath] });
    }
  }
  for (const stableId of Object.keys(receipt.sourceFingerprints)) {
    if (!ids.has(stableId) || !DIGEST_PATTERN.test(receipt.sourceFingerprints[stableId] || '')) {
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
  validateReceiptBindings(receipt, roots);
  if (receipt.rollback !== null && receipt.rollback !== undefined) {
    if (!receipt.rollback || receipt.rollback.schema !== PROJECT_ROLLBACK_SCHEMA
      || receipt.rollback.root !== '.agents/.dhpk-projection-rollback'
      || receipt.rollback.receipt !== 'receipt.json' || receipt.rollback.files !== 'files'
      || !DIGEST_PATTERN.test(receipt.rollback.fingerprint || '')) {
      throw fail('INVALID_RECEIPT', 'project projection receipt rollback metadata is invalid');
    }
  }
  return receipt;
}

function readProjectProjectionReceipt(roots) {
  const stat = lstatOrNull(roots.receiptPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail('INVALID_RECEIPT', `project projection receipt is not a regular file: ${roots.receiptPath}`);
  return validateReceipt(readJsonFile(roots.receiptPath, 'project projection receipt'), roots);
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

function adoptLegacyManifest(roots) {
  const legacyPath = legacyManifestPath(roots);
  const manifest = readJsonFile(legacyPath, 'legacy project projection manifest');
  if (!Array.isArray(manifest.managedPaths) || !manifest.generatedFingerprints || typeof manifest.generatedFingerprints !== 'object') {
    throw fail('LEGACY_UNBOUND', 'legacy project projection manifest cannot establish ownership');
  }
  const legacyManifestDigest = digest(fs.readFileSync(legacyPath));
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
      || digest(fs.readFileSync(target)) !== generatedFingerprints[relative]) {
      throw fail('LEGACY_UNBOUND', `legacy managed path cannot prove ownership: ${relative}`, { paths: [relative] });
    }
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
    schema: PROJECT_RECEIPT_SCHEMA,
    generatorVersion: GENERATOR_VERSION,
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
  for (const relative of receipt.managedPaths.slice().sort()) {
    const target = pathIn(roots.managedRoot, relative, 'receipt-owned managed path');
    const stat = lstatOrNull(target);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw fail('MANAGED_CONTENT_MISSING', `receipt-owned managed file is missing or unsafe: ${relative}`, { paths: [relative] });
    const actual = digest(fs.readFileSync(target));
    if (actual !== receipt.generatedFingerprints[relative]) throw fail('MANAGED_CONTENT_CHANGED', `receipt-owned managed file was modified or fingerprint drifted: ${relative}`, { paths: [relative] });
  }
  for (const binding of flattenBindingPaths(normalizeBindingPaths(receipt.bindingPaths || {}, roots))) {
    const resolved = bindingTargetIn(roots, binding, `receipt-owned ${binding.hostId} binding`);
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
  const entriesById = new Map(inventoryEntries(inventory).map((entry) => [entry.id, entry]));
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
    const current = entriesById.get(entry.stableId);
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

function sourceDrift(previous, currentSourceFingerprints, allowCanonicalChanges, approvedRenames = new Set()) {
  if (allowCanonicalChanges) return;
  for (const entry of previous.entries || []) {
    if (approvedRenames.has(entry.stableId)) continue;
    if (currentSourceFingerprints[entry.stableId] && currentSourceFingerprints[entry.stableId] !== entry.sourceFingerprint) {
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

function transactionPath(roots) {
  return path.join(roots.agentsRoot, '.dhpk-installed.transaction.json');
}

function validateTransaction(roots, transaction) {
  if (!transaction || transaction.schema !== PROJECT_TRANSACTION_SCHEMA) throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsupported schema');
  if (typeof transaction.backupName !== 'string' || !/^\.dhpk-projection-backup-[a-z0-9-]+$/i.test(transaction.backupName)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsafe backupName');
  }
  if (typeof transaction.stageName !== 'string'
    || (transaction.stageName !== '.none' && !/^\.dhpk-projection-(?:artifact|rollback-candidate)-[a-z0-9-]+$/i.test(transaction.stageName))) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an unsafe stageName');
  }
  if (!['prepared', 'publishing', 'published'].includes(transaction.phase)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction has an invalid phase');
  if (!Array.isArray(transaction.oldPaths) || !Array.isArray(transaction.newPaths)) throw fail('UNSAFE_TRANSACTION', 'project projection transaction paths are invalid');
  for (const relative of [...transaction.oldPaths, ...transaction.newPaths]) assertSafeRelative(relative, 'transaction path');
  if (!transaction.newFingerprints || typeof transaction.newFingerprints !== 'object' || Array.isArray(transaction.newFingerprints)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction is missing candidate fingerprints');
  }
  for (const relative of transaction.newPaths) {
    if (!DIGEST_PATTERN.test(transaction.newFingerprints[relative] || '')) {
      throw fail('UNSAFE_TRANSACTION', `project projection transaction has no candidate fingerprint for '${relative}'`, { paths: [relative] });
    }
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
  if (transaction.receiptName !== path.basename(roots.receiptPath) || transaction.managedName !== path.basename(roots.managedRoot)) {
    throw fail('UNSAFE_TRANSACTION', 'project projection transaction identity does not match the target');
  }
  let oldBindingPaths;
  let newBindingPaths;
  try {
    oldBindingPaths = normalizeBindingPaths(transaction.oldBindingPaths || {}, roots, 'transaction old binding paths');
    newBindingPaths = normalizeBindingPaths(transaction.newBindingPaths || {}, roots, 'transaction new binding paths');
  } catch (error) {
    throw fail('UNSAFE_TRANSACTION', error.message, error.projectionDetails || {});
  }
  return {
    backup: path.join(roots.agentsRoot, transaction.backupName),
    stage: path.join(roots.agentsRoot, transaction.stageName),
    oldBindingPaths,
    newBindingPaths,
  };
}

function recoverProjectProjectionTransaction(roots) {
  const journalPath = transactionPath(roots);
  const journalStat = lstatOrNull(journalPath);
  if (!journalStat) return { recovered: false };
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw fail('UNSAFE_TRANSACTION', 'project projection transaction journal is not a regular file');
  const transaction = readJsonFile(journalPath, 'project projection transaction journal');
  const paths = validateTransaction(roots, transaction);
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
    if (expectedDigest && digest(fs.readFileSync(target)) !== expectedDigest) {
      throw fail('RECOVERY_CONFLICT', `interrupted publication target changed outside the transaction: ${relative}`, { paths: [relative] });
    }
    fs.rmSync(target, { force: true });
  };
  for (const relative of transaction.newPaths) {
    removeIfCandidate(pathIn(roots.managedRoot, relative, 'recovery target'), transaction.newFingerprints && transaction.newFingerprints[relative], relative);
  }
  for (const binding of flattenBindingPaths(paths.newBindingPaths)) removeBindingCandidate(roots, binding);
  if (transaction.newReceiptDigest) removeIfCandidate(roots.receiptPath, transaction.newReceiptDigest, path.relative(roots.projectRoot, roots.receiptPath));
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

function createRollbackStage(roots, previous) {
  if (!previous) return null;
  const stage = fs.mkdtempSync(path.join(roots.agentsRoot, '.dhpk-projection-rollback-stage-'));
  try {
    const filesRoot = path.join(stage, 'files');
    fs.mkdirSync(filesRoot, { recursive: true });
    for (const relative of previous.managedPaths) {
      const source = pathIn(roots.managedRoot, relative, 'rollback source');
      const target = path.join(filesRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    writeAtomicJson(path.join(stage, 'receipt.json'), previous, roots.projectRoot);
    const snapshotFingerprint = fingerprint({
      receipt: previous,
      files: previous.managedPaths.map((relative) => ({ relative, fingerprint: previous.generatedFingerprints[relative] })).sort((left, right) => left.relative.localeCompare(right.relative)),
    });
    return {
      stage,
      metadata: {
        schema: PROJECT_ROLLBACK_SCHEMA,
        root: '.agents/.dhpk-projection-rollback',
        receipt: 'receipt.json',
        files: 'files',
        fingerprint: snapshotFingerprint,
      },
    };
  } catch (error) {
    cleanupDirectory(stage, 'failed project projection rollback stage');
    throw error;
  }
}

function checkCollisions(roots, previous, candidateFiles) {
  const oldPaths = new Set(previous ? previous.managedPaths : []);
  const oldTop = new Set([...oldPaths].map((relative) => relative.split('/')[0]));
  for (const relative of candidateFiles) {
    const target = pathIn(roots.managedRoot, relative, 'candidate path');
    const stat = lstatOrNull(target);
    if (stat && !oldPaths.has(relative)) throw fail('GENERATED_PATH_COLLISION', `generated path collides with unmanaged content: ${relative}`, { paths: [relative] });
    const top = relative.split('/')[0];
    const topTarget = path.join(roots.managedRoot, top);
    const topStat = lstatOrNull(topTarget);
    if (topStat && !oldTop.has(top) && top !== relative) {
      throw fail('GENERATED_PATH_COLLISION', `generated path collides with an unmanaged entry: ${top}`, { paths: [top] });
    }
  }
}

function checkBindingCollisions(roots, previous, candidateBindingPaths) {
  const oldBindings = previous
    ? normalizeBindingPaths(previous.bindingPaths || {}, roots)
    : {};
  const oldByPath = new Map(flattenBindingPaths(oldBindings).map((entry) => [entry.path, entry]));
  const seen = new Set();
  for (const binding of flattenBindingPaths(normalizeBindingPaths(candidateBindingPaths || {}, roots))) {
    if (seen.has(binding.path)) throw fail('DUPLICATE_DISCOVERY', `generated Host binding path is duplicated: ${binding.path}`, { paths: [binding.path] });
    seen.add(binding.path);
    const target = bindingTargetIn(roots, binding, `candidate ${binding.hostId} binding`);
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

function removeBindingCandidate(roots, binding, code = 'RECOVERY_CONFLICT') {
  const resolved = bindingTargetIn(roots, binding, `transaction ${binding.hostId || 'Host'} binding`);
  const stat = lstatOrNull(resolved.destination);
  if (!stat) return;
  if (!stat.isSymbolicLink() || fs.readlinkSync(resolved.destination) !== binding.target) {
    throw fail(code, `transaction binding changed outside the transaction: ${binding.path}`, { paths: [binding.path] });
  }
  fs.rmSync(resolved.destination, { force: true });
}

function installBindingPaths(roots, bindingPaths) {
  for (const binding of flattenBindingPaths(normalizeBindingPaths(bindingPaths || {}, roots))) {
    const resolved = bindingTargetIn(roots, binding, `publish ${binding.hostId} binding`);
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

function publishManagedCandidate({ roots, previous, candidateRoot, candidateFiles, candidateFingerprints, nextReceipt, createRollback = true }) {
  checkCollisions(roots, previous, candidateFiles);
  const previousBindingPaths = previous ? normalizeBindingPaths(previous.bindingPaths || {}, roots) : {};
  const candidateBindingPaths = nextReceipt ? normalizeBindingPaths(nextReceipt.bindingPaths || {}, roots) : {};
  checkBindingCollisions(roots, previous, candidateBindingPaths);
  const backup = fs.mkdtempSync(path.join(roots.agentsRoot, '.dhpk-projection-backup-'));
  const rollback = createRollbackStage(roots, previous && createRollback ? previous : null);
  const rollbackRoot = path.join(roots.agentsRoot, '.dhpk-projection-rollback');
  const oldRollback = previous && lstatOrNull(rollbackRoot);
  const receipt = nextReceipt ? sealReceipt({
    ...receiptWithoutFingerprint(nextReceipt),
    rollback: rollback ? rollback.metadata : null,
  }) : null;
  const journal = {
    schema: PROJECT_TRANSACTION_SCHEMA,
    phase: 'prepared',
    managedName: path.basename(roots.managedRoot),
    receiptName: path.basename(roots.receiptPath),
    backupName: path.basename(backup),
    stageName: candidateRoot ? path.basename(path.dirname(candidateRoot)) : '.none',
    oldPaths: previous ? previous.managedPaths.slice().sort() : [],
    newPaths: candidateFiles.slice().sort(),
    oldBindingPaths: previousBindingPaths,
    newBindingPaths: candidateBindingPaths,
    newFingerprints: { ...candidateFingerprints },
    newReceiptDigest: receipt ? receiptFileDigest(receipt) : null,
    newRollback: Boolean(rollback),
    oldRollbackPresent: Boolean(oldRollback),
    oldRollbackMoved: false,
    newRollbackInstalled: false,
  };
  const journalPath = transactionPath(roots);
  if (lstatOrNull(journalPath)) {
    if (rollback) cleanupDirectory(rollback.stage, 'unused rollback stage');
    cleanupDirectory(backup, 'unused transaction backup');
    throw fail('TRANSACTION_EXISTS', 'project projection transaction journal already exists');
  }
  try {
    writeAtomicJson(journalPath, journal, roots.projectRoot);
  } catch (error) {
    if (rollback) cleanupDirectory(rollback.stage, 'failed project projection rollback stage');
    cleanupDirectory(backup, 'failed project projection transaction backup');
    throw error;
  }
  let published = false;
  try {
    journal.phase = 'publishing';
    writeAtomicJson(journalPath, journal, roots.projectRoot);
    if (previous) {
      for (const relative of previous.managedPaths.slice().sort()) {
        const source = pathIn(roots.managedRoot, relative, 'transaction backup source');
        const target = path.join(backup, 'managed', relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertPhysicalAncestors(target, 'transaction backup target', backup);
        fs.renameSync(source, target);
      }
      if (lstatOrNull(roots.receiptPath)) fs.renameSync(roots.receiptPath, path.join(backup, 'receipt.json'));
    }
    for (const binding of flattenBindingPaths(previousBindingPaths)) {
      const source = bindingDestinationIn(roots, binding.path, 'transaction binding backup source');
      if (!lstatOrNull(source)) continue;
      const target = path.join(backup, 'bindings', binding.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assertPhysicalAncestors(target, 'transaction binding backup target', backup);
      fs.renameSync(source, target);
    }
    if (oldRollback) {
      fs.renameSync(rollbackRoot, path.join(backup, 'rollback'));
      journal.oldRollbackMoved = true;
      writeAtomicJson(journalPath, journal, roots.projectRoot);
    }
    removeEmptyDirectories(roots.managedRoot);
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
      if (digest(fs.readFileSync(target)) !== candidateFingerprints[relative]) throw fail('PUBLISH_FINGERPRINT_DRIFT', `published file fingerprint drifted: ${relative}`, { paths: [relative] });
    }
    installBindingPaths(roots, candidateBindingPaths);
    if (rollback) {
      fs.renameSync(rollback.stage, rollbackRoot);
      journal.newRollbackInstalled = true;
      writeAtomicJson(journalPath, journal, roots.projectRoot);
    }
    if (receipt) writeAtomicJson(roots.receiptPath, receipt, roots.projectRoot);
    else if (lstatOrNull(roots.receiptPath)) fs.rmSync(roots.receiptPath, { force: true });
    journal.phase = 'published';
    writeAtomicJson(journalPath, journal, roots.projectRoot);
    published = true;
    cleanupDirectory(backup, 'project projection transaction backup');
    fs.rmSync(journalPath, { force: true });
    return {
      receipt,
      published: true,
      managedPaths: candidateFiles.slice().sort(),
      bindingPaths: candidateBindingPaths,
    };
  } catch (error) {
    if (!published) {
      try {
        recoverProjectProjectionTransaction(roots);
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
    dependencyClosure: clone(plan.dependencyClosure || null),
    hostBindings: clone(inputs.hostBindings || plan.hostBindings || {}),
    bindings: clone(inputs.hostBindings || plan.hostBindings || {}),
    bindingPaths: clone(inputs.bindingPaths || {}),
    entries: inputs.receiptEntries.slice().sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: Object.keys(inputs.generatedFingerprints).sort(),
    generatedFingerprints: clone(inputs.generatedFingerprints),
    sourceFingerprints: clone(inputs.sourceFingerprints),
    rollback: null,
  });
}

function materializeRelocatableAgentsSkillsProjection(options = {}) {
  const sourceRoot = options.sourceRoot || options.root;
  if (!sourceRoot || !options.inventory) throw fail('INVALID_INPUT', 'sourceRoot and inventory are required');
  const roots = resolveRoots({ sourceRoot, projectRoot: options.projectRoot, outDir: options.outDir, inventory: options.inventory });
  ensureDirectory(roots.projectRoot, 'project root', roots.projectRoot);
  ensureDirectory(roots.agentsRoot, 'project agents root', roots.projectRoot);
  ensureDirectory(roots.managedRoot, 'project managed root', roots.projectRoot);
  recoverProjectProjectionTransaction(roots);
  let previous = readProjectProjectionReceipt(roots);
  if (!previous && lstatOrNull(legacyManifestPath(roots))) {
    if (!(options.adopt || options.repair || options.allowLegacyAdoption)) {
      throw fail('LEGACY_UNBOUND', 'legacy project projection is present without the lifecycle receipt; explicit adopt or repair is required');
    }
    previous = adoptLegacyManifest(roots);
  }
  if (previous) validateManagedFiles(roots, previous, { requireBindings: false });
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
    if (previous) {
      const approvedRenames = approvedRenameIds(previous, options.inventory, plan);
      sourceDrift(previous, staged.inputs.sourceFingerprints, Boolean(options.allowCanonicalChanges || options.update), approvedRenames);
    }
    const receipt = receiptForArtifact({
      roots,
      plan,
      staged,
      declaredSelection: options.declaredSelection === true,
    });
    const published = publishManagedCandidate({
      roots,
      previous,
      candidateRoot: staged.candidateRoot,
      candidateFiles: staged.inputs.records.map((record) => record.value.destination),
      candidateFingerprints: staged.inputs.generatedFingerprints,
      nextReceipt: receipt,
    });
    return {
      outputRoot: roots.managedRoot,
      projectRoot: roots.projectRoot,
      receiptPath: roots.receiptPath,
      selectedIds: receipt.selectedIds,
      emittedIds: receipt.emittedIds,
      managedPaths: receipt.managedPaths,
      receipt: published.receipt,
      plan,
      artifact: staged.artifact,
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
        entries: receipt.entries.map((entry) => ({ stableId: entry.stableId, name: entry.name })),
        claudeSourceRoot: roots.config.managed_root,
      });
    } catch (error) {
      errors.push(error.message);
    }
    for (const entry of receipt.entries) {
      const requiredPaths = [];
      if (providers && providers.directory.hosts.length > 0) {
        requiredPaths.push(...(entry.sourceFiles || []).map((sourceFile) => `${entry.name}/${sourceFile.path}`));
      }
      if (providers && providers.directFile.hosts.length > 0) requiredPaths.push(`${entry.name}.md`);
      for (const required of [...new Set(requiredPaths)].sort()) {
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
      if (providers && providers.directory.hosts.length > 0 && providers.directFile.hosts.length > 0) {
        const directoryPath = pathIn(roots.managedRoot, `${entry.name}/SKILL.md`, 'directory skill path');
        const directPath = pathIn(roots.managedRoot, `${entry.name}.md`, 'AGY direct-file path');
        const directoryStat = lstatOrNull(directoryPath);
        const directStat = lstatOrNull(directPath);
        if (directoryStat && directStat && digest(fs.readFileSync(directoryPath)) !== digest(fs.readFileSync(directPath))) {
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
        selectedStableIds: receipt.declaredSelection === true ? receipt.selectedIds : options.selectedStableIds,
        declaredSelection: receipt.declaredSelection === true || options.declaredSelection,
      });
      if (plan.planFingerprint !== receipt.planFingerprint) errors.push('receipt plan fingerprint does not match the compiler-owned plan');
      const byId = new Map(inventoryEntries(options.inventory).map((entry) => [entry.id, entry]));
      for (const entry of receipt.entries) {
        const sourceEntry = byId.get(entry.stableId);
        if (!sourceEntry) continue;
        const sourceDirectory = path.resolve(roots.sourceRoot, sourceEntry.path);
        if (!lstatOrNull(sourceDirectory)) continue;
        const current = sourceManifest(sourceDirectory).sourceFingerprint;
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
    ensureDirectory(roots.projectRoot, 'project root', roots.projectRoot);
    ensureDirectory(roots.agentsRoot, 'project agents root', roots.projectRoot);
    ensureDirectory(roots.managedRoot, 'project managed root', roots.projectRoot);
    recoverProjectProjectionTransaction(roots);
    const receipt = readProjectProjectionReceipt(roots);
    if (!receipt) {
      if (lstatOrNull(legacyManifestPath(roots))) throw fail('LEGACY_UNBOUND', 'legacy project projection has no lifecycle receipt and cannot be removed automatically');
      return { ok: true, state: 'ABSENT', removedPaths: [], preservedPaths: [], projectRoot: roots.projectRoot };
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
    });
    return { ok: true, state: 'REMOVED', removedPaths: receipt.managedPaths, preservedPaths: [], projectRoot: roots.projectRoot, published };
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
  if (!receipt || !receipt.rollback || receipt.rollback.schema !== PROJECT_ROLLBACK_SCHEMA) throw fail('NO_ROLLBACK', 'project projection has no valid rollback snapshot');
  const rollbackRoot = path.resolve(roots.projectRoot, receipt.rollback.root);
  if (!isInside(roots.projectRoot, rollbackRoot) || rollbackRoot !== path.join(roots.agentsRoot, '.dhpk-projection-rollback')) throw fail('INVALID_ROLLBACK', 'rollback snapshot root is unsafe');
  const snapshotReceipt = readJsonFile(path.join(rollbackRoot, receipt.rollback.receipt), 'rollback receipt');
  validateReceipt(snapshotReceipt, roots);
  const filesRoot = path.join(rollbackRoot, receipt.rollback.files);
  for (const relative of snapshotReceipt.managedPaths) {
    const source = pathIn(filesRoot, relative, 'rollback snapshot file');
    const stat = lstatOrNull(source);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || digest(fs.readFileSync(source)) !== snapshotReceipt.generatedFingerprints[relative]) {
      throw fail('INVALID_ROLLBACK', `rollback snapshot is incomplete or drifted: ${relative}`, { paths: [relative] });
    }
  }
  const expected = fingerprint({
    receipt: snapshotReceipt,
    files: snapshotReceipt.managedPaths.map((relative) => ({ relative, fingerprint: snapshotReceipt.generatedFingerprints[relative] })).sort((left, right) => left.relative.localeCompare(right.relative)),
  });
  if (expected !== receipt.rollback.fingerprint) throw fail('INVALID_ROLLBACK', 'rollback snapshot fingerprint is invalid');
  return { receipt: snapshotReceipt, filesRoot };
}

function rollbackAgentsSkillsProjection(options = {}) {
  try {
    const roots = operationRoots(options);
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
    try {
      const published = publishManagedCandidate({
        roots,
        previous: current,
        candidateRoot,
        candidateFiles,
        candidateFingerprints,
        nextReceipt: snapshot.receipt,
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
  recoverAgentsSkillsProjection: (options = {}) => recoverProjectProjectionTransaction(operationRoots(options)),
  readProjectProjectionReceipt,
};
