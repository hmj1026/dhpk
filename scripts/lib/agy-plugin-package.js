'use strict';

// Native Antigravity (agy) package projection.  This module is deliberately
// independent from the portable Agent Plugin compiler: AGY has a different
// agent frontmatter and tool contract, so sharing a validator would blur
// ownership and make a valid Claude/Codex package look like AGY evidence.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { adaptFrontmatter } = require('../agy-adapt-agents');
const {
  createSurfaceReceipt,
  resolveGeneratedFromTree,
  validateSurfaceReceipt,
} = require('./platform-provenance');
const { createTraversalBudget, readFileBounded, readDirectoryEntries } = require('./bounded-filesystem');

const SURFACE = 'agy-plugin';
const GENERATOR_VERSION = '1.0.0';
const PACKAGE_SCHEMA = 'dhpk.agy-plugin.v1';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/i;
const SAFE_RELATIVE = /^[^\\]+(?:\/[^\\]+)*$/;
const PACKAGE_FILES = new Set(['plugin.json', 'provenance.json', 'fingerprints.json']);
const COMPONENT_ROOTS = new Set(['agents', 'rules', 'skills']);
const OPTIONAL_FILES = new Set(['mcp_config.json', 'hooks.json']);
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?(?!\$\{)[A-Za-z0-9._~+\/-]{16,}/i,
  /\b(?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
];
const AGY_SKILL_REFERENCE_REWRITES = Object.freeze([
  Object.freeze({
    source: '@skills/dhpk-harness-revise/references/harness-directory-contract.md',
    target: 'dhpk-harness-revise',
    targetSkillId: 'harness-revise',
  }),
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSafeRelative(relative, label = 'path') {
  if (typeof relative !== 'string' || relative.length === 0 || relative.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (relative.includes('\\') || path.posix.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) {
    throw new Error(`${label} must be POSIX relative: ${relative}`);
  }
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes its root: ${relative}`);
  }
  return relative;
}

function assertPhysicalDirectory(directory, label) {
  const resolved = path.resolve(directory);
  let current = resolved;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label} ancestor: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = lstatOrNull(resolved);
  if (stat && stat.isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${resolved}`);
  if (stat && !stat.isDirectory()) throw new Error(`${label} must be a directory: ${resolved}`);
  return resolved;
}

function ensureDirectory(directory, label) {
  const resolved = assertPhysicalDirectory(directory, label);
  if (!lstatOrNull(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function sortedEntries(directory, budget = createTraversalBudget()) {
  return readDirectoryEntries(directory, { budget, sort: true, localeSort: true });
}

function assertNoSymlink(filePath, label) {
  const stat = lstatOrNull(filePath);
  if (stat && stat.isSymbolicLink()) throw new Error(`symlink is not allowed for ${label}: ${filePath}`);
  return stat;
}

function assertContainedPhysical(root, candidate, label) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  if (!isInside(rootPath, candidatePath)) throw new Error(`${label} escapes its root: ${candidate}`);
  let current = candidatePath;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`symlink is not allowed for ${label}: ${current}`);
    const parent = path.dirname(current);
    if (parent === current || current === rootPath) break;
    current = parent;
  }
  if (lstatOrNull(candidatePath)) {
    const realRoot = fs.realpathSync(rootPath);
    const realCandidate = fs.realpathSync(candidatePath);
    if (!isInside(realRoot, realCandidate)) throw new Error(`${label} resolves outside its root: ${candidate}`);
  }
}

function copyFileContained(source, destination, sourceRoot, outputRoot) {
  assertContainedPhysical(sourceRoot, source, 'source file');
  assertContainedPhysical(outputRoot, destination, 'output path');
  const sourceStat = assertNoSymlink(source, 'source file');
  if (!sourceStat || !sourceStat.isFile()) throw new Error(`source file is missing: ${source}`);
  ensureDirectory(path.dirname(destination), 'package parent');
  fs.copyFileSync(source, destination);
}

function adaptAgySkillContent(content, selectedSkillIds) {
  return AGY_SKILL_REFERENCE_REWRITES.reduce(
    (adapted, rewrite) => {
      if (!adapted.includes(rewrite.source)) return adapted;
      if (!selectedSkillIds.has(rewrite.targetSkillId)) {
        throw new Error(`AGY skill reference target is not selected: ${rewrite.targetSkillId}`);
      }
      return adapted.replaceAll(rewrite.source, rewrite.target);
    },
    content,
  );
}

function copyDirectory(source, destination, sourceRoot, outputRoot) {
  assertContainedPhysical(sourceRoot, source, 'source directory');
  assertContainedPhysical(outputRoot, destination, 'output directory');
  const sourceStat = assertNoSymlink(source, 'source directory');
  if (!sourceStat || !sourceStat.isDirectory()) throw new Error(`source directory is missing: ${source}`);
  ensureDirectory(destination, 'package component');
  for (const entry of sortedEntries(source)) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const childSource = path.join(source, entry.name);
    const childDestination = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in source component: ${childSource}`);
    if (entry.isDirectory()) copyDirectory(childSource, childDestination, sourceRoot, outputRoot);
    else if (entry.isFile()) copyFileContained(childSource, childDestination, sourceRoot, outputRoot);
    else throw new Error(`unsupported source entry: ${childSource}`);
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileBounded(filePath).toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function inventorySkillMap(inventory) {
  return new Map([...(inventory && inventory.skills || []), ...(inventory && inventory.modules || [])].map((entry) => [entry.id, entry]));
}

function selectedConfiguration(inventory) {
  const configuration = inventory && inventory.agy_plugin;
  if (!configuration || typeof configuration !== 'object') throw new Error('inventory.agy_plugin is required');
  const skillIds = inventory.surface_membership && inventory.surface_membership[SURFACE];
  if (!Array.isArray(skillIds)) throw new Error(`inventory.surface_membership.${SURFACE} must be a string array`);
  if (!Array.isArray(configuration.agents) || !Array.isArray(configuration.rules)) {
    throw new Error('inventory.agy_plugin agents and rules must be arrays');
  }
  const skillMap = inventorySkillMap(inventory);
  const skills = skillIds.map((id) => {
    const entry = skillMap.get(id);
    if (!entry) throw new Error(`AGY selection references unknown skill ID: ${id}`);
    if (typeof entry.path !== 'string' || !entry.path.startsWith('skills/')) {
      throw new Error(`AGY skill '${id}' must use a canonical skills/ path`);
    }
    return { id, path: entry.path };
  });
  const agents = [...new Set(configuration.agents)].sort();
  const rules = [...new Set(configuration.rules)].sort();
  return { agents, rules, skills };
}

function outputFiles(packageRoot, options = {}) {
  const files = [];
  const budget = createTraversalBudget(options);
  const walk = (directory, depth) => {
    const realDirectory = budget.enterDirectory(directory, depth);
    try {
      for (const entry of sortedEntries(directory, budget)) {
        const child = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in AGY package: ${child}`);
        if (entry.isDirectory()) walk(child, depth + 1);
        else if (entry.isFile()) files.push(path.relative(packageRoot, child).split(path.sep).join('/'));
        else throw new Error(`unsupported AGY package entry: ${child}`);
      }
    } finally {
      budget.leaveDirectory(realDirectory);
    }
  };
  walk(packageRoot, 0);
  return files.sort();
}

function fingerprintFiles(packageRoot, files) {
  const budget = createTraversalBudget();
  return Object.fromEntries(files.filter((relative) => !['provenance.json', 'fingerprints.json'].includes(relative)).map((relative) => {
    const target = path.join(packageRoot, relative);
    return [relative, digest(budget.readFile(target, fs.statSync(target)))];
  }));
}

function containsSecret(content) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(String(content)));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${stableStringify(value)}\n`, { mode: 0o644 });
}

function assertOwnedOutputRoot(outDir) {
  const existing = lstatOrNull(outDir);
  if (!existing) return false;
  if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error(`AGY output root must be a physical directory: ${outDir}`);
  const provenancePath = path.join(outDir, 'provenance.json');
  const provenanceStat = lstatOrNull(provenancePath);
  if (!provenanceStat || provenanceStat.isSymbolicLink() || !provenanceStat.isFile()) {
    throw new Error('refusing to replace AGY output without an owner receipt');
  }
  const provenance = readJson(provenancePath, 'existing AGY provenance');
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('refusing to replace AGY output with invalid provenance');
  }
  if (readFileBounded(provenancePath).toString('utf8') !== `${stableStringify(provenance)}\n`) {
    throw new Error('refusing to replace changed AGY provenance');
  }
  const checked = validateSurfaceReceipt({ ...provenance, schema: 'dhpk.platform-provenance.v1' }, SURFACE);
  if (!checked.ok || provenance.schema !== PACKAGE_SCHEMA || provenance.owner !== 'plugins/dhpk-agy' || provenance.packageRoot !== 'plugins/dhpk-agy') {
    throw new Error(`refusing to replace foreign or invalid AGY output: ${checked.errors.join('; ')}`);
  }
  const files = outputFiles(outDir);
  const fingerprints = provenance.fingerprints;
  if (!fingerprints || typeof fingerprints !== 'object') throw new Error('refusing to replace AGY output without fingerprints');
  const dataFiles = files.filter((file) => !['provenance.json', 'fingerprints.json'].includes(file));
  if (stableStringify(Object.keys(fingerprints).sort()) !== stableStringify(dataFiles.sort())) {
    throw new Error('refusing to replace AGY output with incomplete or foreign fingerprints');
  }
  for (const relative of dataFiles) {
    const target = path.join(outDir, relative);
    if (!Object.prototype.hasOwnProperty.call(fingerprints, relative) || digest(readFileBounded(target)) !== fingerprints[relative]) {
      throw new Error(`refusing to replace changed AGY output: ${relative}`);
    }
  }
  const fingerprintsPath = path.join(outDir, 'fingerprints.json');
  const fingerprintPayload = readJson(fingerprintsPath, 'existing AGY fingerprints');
  if (!fingerprintPayload || typeof fingerprintPayload !== 'object' || fingerprintPayload.schema !== PACKAGE_SCHEMA
    || stableStringify(fingerprintPayload.files || {}) !== stableStringify(fingerprints)
    || readFileBounded(fingerprintsPath).toString('utf8') !== `${stableStringify(fingerprintPayload)}\n`) {
    throw new Error('refusing to replace AGY output with changed fingerprints');
  }
  return true;
}

function promoteOutputRoot(buildRoot, destination) {
  const parent = path.dirname(destination);
  const hadExisting = assertOwnedOutputRoot(destination);
  if (!hadExisting) {
    fs.renameSync(buildRoot, destination);
    return;
  }
  const backup = path.join(parent, `.agy-plugin-backup-${process.pid}-${Date.now()}`);
  fs.renameSync(destination, backup);
  try {
    fs.renameSync(buildRoot, destination);
  } catch (error) {
    fs.renameSync(backup, destination);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

function materializeAgyPluginPackage({
  root,
  inventory,
  outDir,
  version = '0.0.0',
  sourceVersion = version,
  sourceCommit,
  generatorVersion = GENERATOR_VERSION,
} = {}) {
  if (!root || !inventory || !outDir) throw new Error('root, inventory, and outDir are required');
  if (!SEMVER.test(version) || !SEMVER.test(sourceVersion)) throw new Error('AGY package version and sourceVersion must be SemVer');
  if (typeof sourceCommit !== 'string' || !COMMIT.test(sourceCommit)) throw new Error('AGY sourceCommit must be a 40-character commit SHA');
  const sourceRoot = assertPhysicalDirectory(root, 'canonical root');
  const selected = selectedConfiguration(inventory);
  const destination = path.resolve(outDir);
  const parent = ensureDirectory(path.dirname(destination), 'AGY output parent');
  if (!isInside(parent, destination)) throw new Error(`AGY output escapes its parent: ${destination}`);
  const buildRoot = fs.mkdtempSync(path.join(parent, '.agy-plugin-build-'));
  let promoted = false;
  try {
  const outputRoot = buildRoot;

  const manifest = {
    name: 'dhpk',
    version,
    description: 'dhpk native Antigravity CLI plugin',
    agents: ['./agents/'],
    skills: ['./skills/'],
    rules: ['./rules/'],
  };
  writeJson(path.join(outputRoot, 'plugin.json'), manifest);

  const agentsDestination = ensureDirectory(path.join(outputRoot, 'agents'), 'AGY agents directory');
  for (const relative of selected.agents) {
    assertSafeRelative(`agents/${relative}`, 'AGY agent selection');
    const source = path.join(sourceRoot, 'agents', relative);
    const target = path.join(agentsDestination, relative);
    if (path.extname(relative) !== '.md') throw new Error(`invalid AGY agent selection: ${relative}`);
    assertContainedPhysical(sourceRoot, source, 'source agent');
    const sourceStat = assertNoSymlink(source, 'source agent');
    if (!sourceStat || !sourceStat.isFile()) throw new Error(`source agent is missing: ${source}`);
    ensureDirectory(path.dirname(target), 'AGY agent parent');
    const sourceContent = readFileBounded(source).toString('utf8');
    const adapted = adaptFrontmatter(sourceContent, { filePath: source });
    fs.writeFileSync(target, adapted.text, { mode: 0o644 });
  }

  const rulesDestination = ensureDirectory(path.join(outputRoot, 'rules'), 'AGY rules directory');
  for (const relative of selected.rules) {
    assertSafeRelative(relative, 'AGY rule selection');
    const source = path.join(sourceRoot, relative);
    const target = path.join(outputRoot, relative);
    if (!relative.startsWith('rules/') || path.extname(relative) !== '.md') throw new Error(`invalid AGY rule selection: ${relative}`);
    copyFileContained(source, target, sourceRoot, outputRoot);
  }

  const skillsDestination = ensureDirectory(path.join(outputRoot, 'skills'), 'AGY skills directory');
  const selectedSkillIds = new Set(selected.skills.map((skill) => skill.id));
  for (const skill of selected.skills) {
    const skillPath = skill.path.replace(/^skills\//, '');
    assertSafeRelative(skillPath, `AGY skill '${skill.id}'`);
    const source = path.join(sourceRoot, skill.path, 'SKILL.md');
    const target = path.join(skillsDestination, skillPath, 'SKILL.md');
    assertContainedPhysical(sourceRoot, source, 'source skill');
    const sourceStat = assertNoSymlink(source, 'source skill');
    if (!sourceStat || !sourceStat.isFile()) throw new Error(`source skill is missing: ${source}`);
    ensureDirectory(path.dirname(target), 'AGY skill parent');
    const sourceContent = readFileBounded(source).toString('utf8');
    fs.writeFileSync(target, adaptAgySkillContent(sourceContent, selectedSkillIds), { mode: 0o644 });
    const referencesSource = path.join(sourceRoot, skill.path, 'references');
    if (lstatOrNull(referencesSource)) {
      const referencesTarget = path.join(skillsDestination, skillPath, 'references');
      copyDirectory(referencesSource, referencesTarget, sourceRoot, outputRoot);
    }
  }

  // AGY-specific optional files are opt-in under an explicit agy/ source
  // directory. Claude hooks are not copied implicitly because their command
  // paths and event schema are client-owned.
  for (const optional of ['mcp_config.json', 'hooks.json']) {
    const source = path.join(sourceRoot, 'agy', optional);
    if (lstatOrNull(source)) copyFileContained(source, path.join(outputRoot, optional), sourceRoot, outputRoot);
  }

  const files = outputFiles(outputRoot);
  const fingerprints = fingerprintFiles(outputRoot, files);
  const receipt = createSurfaceReceipt({
    surface: SURFACE,
    sourceVersion,
    sourceCommit,
    generatedFromTree: resolveGeneratedFromTree(root, sourceCommit),
    inventoryDigest: digest(stableStringify(inventory)),
    fingerprints,
    route: { sourceRoot: 'agents/, rules/, skills/', packageRoot: 'plugins/dhpk-agy/' },
    generatorVersion,
  });
  receipt.schema = PACKAGE_SCHEMA;
  receipt.provenanceSchema = 'dhpk.platform-provenance.v1';
  receipt.selectedIds = {
    agents: selected.agents,
    rules: selected.rules,
    skills: selected.skills.map((skill) => skill.id),
  };
  receipt.transform = { id: 'agy-agent-frontmatter-v1', version: '1' };
  receipt.packageRoot = 'plugins/dhpk-agy';
  writeJson(path.join(outputRoot, 'fingerprints.json'), { schema: PACKAGE_SCHEMA, files: fingerprints });
  writeJson(path.join(outputRoot, 'provenance.json'), receipt);
  const checked = validateAgyPluginPackage(outputRoot, { expectedVersion: version, inventory });
  if (!checked.ok) throw new Error(`generated AGY package failed validation: ${checked.errors.join('; ')}`);
  promoteOutputRoot(outputRoot, destination);
  promoted = true;
  return { packageRoot: destination, manifest, selected, files, fingerprints, receipt };
  } finally {
    if (!promoted && lstatOrNull(buildRoot)) fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}

function validateAgyPluginPackage(packageRoot, { expectedVersion = null, inventory = null } = {}) {
  const errors = [];
  const warnings = [];
  const root = path.resolve(packageRoot || '');
  const rootStat = lstatOrNull(root);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { ok: false, errors: ['AGY package root must be a physical directory'], warnings, agents: [], skills: [], rules: [] };
  }
  let manifest = null;
  try { manifest = readJson(path.join(root, 'plugin.json'), 'plugin.json'); } catch (error) { errors.push(error.message); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) errors.push('plugin.json must be an object');
  else {
    if (manifest.name !== 'dhpk') errors.push('plugin.json name must be dhpk');
    if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) errors.push('plugin.json version must be SemVer');
    if (expectedVersion && manifest.version !== expectedVersion) errors.push(`plugin.json version must be ${expectedVersion}`);
    for (const rootName of ['agents', 'rules', 'skills']) {
      if (!Array.isArray(manifest[rootName]) || stableStringify(manifest[rootName]) !== stableStringify([`./${rootName}/`])) {
        errors.push(`plugin.json ${rootName} must declare only ./${rootName}/`);
      }
    }
  }

  let selected = null;
  if (inventory) {
    try { selected = selectedConfiguration(inventory); } catch (error) { errors.push(error.message); }
  }
  const expectedAgentFiles = selected ? new Set(selected.agents.map((name) => `agents/${name}`)) : null;
  const expectedRuleFiles = selected ? new Set(selected.rules) : null;
  const expectedSkillFiles = selected ? new Set(selected.skills.map((skill) => `skills/${skill.path.replace(/^skills\//, '')}/SKILL.md`)) : null;
  const expectedSkillReferenceRoots = selected
    ? selected.skills.map((skill) => `skills/${skill.path.replace(/^skills\//, '')}/references/`)
    : [];
  const expectedComponentFiles = selected
    ? new Set([...expectedAgentFiles, ...expectedRuleFiles, ...expectedSkillFiles])
    : null;

  let files = [];
  try { files = outputFiles(root); } catch (error) { errors.push(error.message); }
  for (const relative of files) {
    assertSafeRelative(relative, 'AGY package file');
    const base = relative.split('/')[0];
    if (!PACKAGE_FILES.has(relative) && !COMPONENT_ROOTS.has(base) && !OPTIONAL_FILES.has(relative)) {
      errors.push(`undeclared AGY package component: ${relative}`);
    }
    const isExpectedSkillReference = expectedSkillReferenceRoots.some((prefix) => relative.startsWith(prefix));
    if (expectedComponentFiles && COMPONENT_ROOTS.has(base)
      && !expectedComponentFiles.has(relative) && !isExpectedSkillReference) {
      errors.push(`undeclared AGY package file: ${relative}`);
    }
    const absolute = path.join(root, relative);
    if (!isInside(root, absolute)) errors.push(`AGY package path escapes root: ${relative}`);
    const content = readFileBounded(absolute);
    if (containsSecret(content.toString('utf8'))) errors.push(`possible secret in AGY package file: ${relative}`);
  }

  const agentFiles = files.filter((relative) => relative.startsWith('agents/') && relative.endsWith('.md')).sort();
  const ruleFiles = files.filter((relative) => relative.startsWith('rules/') && relative.endsWith('.md')).sort();
  const skillFiles = files.filter((relative) => relative.startsWith('skills/') && relative.endsWith('/SKILL.md')).sort();
  if (agentFiles.length === 0) errors.push('AGY package must contain at least one adapted agent');
  for (const relative of agentFiles) {
    if (expectedAgentFiles && !expectedAgentFiles.has(relative)) errors.push(`undeclared AGY agent: ${relative}`);
    const adapted = adaptFrontmatter(readFileBounded(path.join(root, relative)).toString('utf8'), { filePath: relative });
    if (adapted.changed || adapted.droppedFields.length > 0) errors.push(`agent is not idempotently AGY-adapted: ${relative}`);
  }
  if (expectedRuleFiles) for (const relative of expectedRuleFiles) if (!files.includes(relative)) errors.push(`selected AGY rule is missing: ${relative}`);
  if (expectedSkillFiles) for (const relative of expectedSkillFiles) if (!files.includes(relative)) errors.push(`selected AGY skill is missing: ${relative}`);

  let fingerprints = null;
  try { fingerprints = readJson(path.join(root, 'fingerprints.json'), 'fingerprints.json'); } catch (error) { errors.push(error.message); }
  if (!fingerprints || fingerprints.schema !== PACKAGE_SCHEMA || !fingerprints.files || typeof fingerprints.files !== 'object') {
    errors.push(`fingerprints.json must use ${PACKAGE_SCHEMA}`);
  } else {
    const actualFiles = fingerprintFiles(root, files);
    if (stableStringify(actualFiles) !== stableStringify(fingerprints.files)) errors.push('AGY package fingerprints do not match output files');
    for (const [relative, value] of Object.entries(fingerprints.files)) {
      if (!SHA256.test(value)) errors.push(`AGY fingerprint is not SHA-256: ${relative}`);
    }
  }

  let provenance = null;
  try { provenance = readJson(path.join(root, 'provenance.json'), 'provenance.json'); } catch (error) { errors.push(error.message); }
  if (provenance) {
    const checked = validateSurfaceReceipt({ ...provenance, schema: 'dhpk.platform-provenance.v1' }, SURFACE);
    errors.push(...checked.errors);
    if (provenance.schema !== PACKAGE_SCHEMA) errors.push(`provenance schema must be ${PACKAGE_SCHEMA}`);
    if (provenance.packageRoot !== 'plugins/dhpk-agy') errors.push('provenance packageRoot is not owner-scoped');
    if (!fingerprints || stableStringify(provenance.fingerprints || {}) !== stableStringify(fingerprints.files || {})) {
      errors.push('provenance fingerprints do not match fingerprints.json');
    }
    if (selected && stableStringify(provenance.selectedIds || {}) !== stableStringify({
      agents: selected.agents,
      rules: selected.rules,
      skills: selected.skills.map((skill) => skill.id),
    })) errors.push('provenance selected IDs do not match inventory');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    provenance,
    agents: agentFiles,
    skills: skillFiles,
    rules: ruleFiles,
    files,
  };
}

module.exports = {
  SURFACE,
  GENERATOR_VERSION,
  PACKAGE_SCHEMA,
  stableStringify,
  digest,
  materializeAgyPluginPackage,
  validateAgyPluginPackage,
};
