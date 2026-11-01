'use strict';

// Project-local compatibility projection for the two documented `.agents/skills`
// loaders. Canonical skill packages remain under skills/; this adapter owns only
// generated consumer files and their receipt. New external project writes go
// through project-agent-projection-publisher; the in-checkout branch below is a
// retained compatibility path for the historical generator contract.

const fs = require('node:fs');
const path = require('node:path');
const {
  parseFrontmatter,
  selectPortableSkills,
} = require('./agent-plugin-package');
const { resolveInventoryRevision } = require('./distribution-projection-contract');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');
const { sha256Hex, fileSetFingerprintTerminated } = require('./content-fingerprint');
const { resolveStandaloneSkillDependencies } = require('./standalone-skill-dependencies');
const { planRetiredAgentSkills } = require('./agents-skills-retirement');
const { compileDistribution, materializeDistribution } = require('./distribution-compiler');
const { ProjectionArtifactStore } = require('./projection-artifact-store');
const {
  materializeRelocatableAgentsSkillsProjection,
  validateRelocatableAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
  removeAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
  recoverAgentsSkillsProjection,
  readProjectProjectionReceipt,
  PROJECT_RECEIPT_SCHEMA,
  PROJECT_ROLLBACK_SCHEMA,
  PROJECT_TRANSACTION_SCHEMA,
} = require('./project-agent-projection-publisher');

const SCHEMA = 'dhpk.agents-skills-projection.v1';
const GENERATOR_VERSION = '1.0.0';
const RECEIPT_NAME = '.dhpk-projection.json';
const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SECRET_PATTERNS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?(?!\$\{)[A-Za-z0-9._~+\/-]{16,}/i,
];

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableClone(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
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

function assertPhysicalAncestors(candidate, label, boundary = null) {
  let current = path.resolve(candidate);
  const stop = boundary ? path.resolve(boundary) : null;
  while (true) {
    const stat = lstatOrNull(current);
    if (stat && stat.isSymbolicLink()) throw new Error(`${label} has a symlinked ancestor: ${current}`);
    if (stop && current === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function ensureDirectory(directory, label, boundary = null) {
  if (boundary) assertPhysicalAncestors(path.dirname(directory), label, boundary);
  const existing = lstatOrNull(directory);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`${label} must be a physical directory: ${directory}`);
  }
  if (!existing) fs.mkdirSync(directory, { recursive: true });
  if (boundary) assertPhysicalAncestors(directory, label, boundary);
  return path.resolve(directory);
}

function assertOutputRoot(root, outDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedOut = path.resolve(outDir);
  if (resolvedRoot === resolvedOut || !isInside(resolvedRoot, resolvedOut)) {
    throw new Error(`agents-skills output must be inside the repository root and separate from it: ${resolvedOut}`);
  }
  for (const source of ['skills', 'agents', 'rules', 'commands', 'hooks', 'modules', 'scripts', 'docs', 'manifests']) {
    if (isInside(path.join(resolvedRoot, source), resolvedOut)) {
      throw new Error(`agents-skills output overlaps canonical source tree: ${resolvedOut}`);
    }
  }
  assertPhysicalAncestors(resolvedOut, 'agents-skills output', resolvedRoot);
  const existing = lstatOrNull(resolvedOut);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`agents-skills output must be a physical directory: ${resolvedOut}`);
  }
}

function assertSafeRelative(relative, label) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new Error(`${label} escapes the projection root: ${relative}`);
  }
  return relative;
}

function safeName(value, label) {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw new Error(`${label} must be a kebab-case public name: ${value}`);
  return value;
}

function readPhysicalFile(filePath, budget, label) {
  const stat = lstatOrNull(filePath);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  return budget.readFile(filePath, stat, label);
}

function collectFiles(directory, budget, relative = '') {
  const realDirectory = budget.enterDirectory(directory, relative ? relative.split('/').length : 0);
  try {
    const files = [];
    for (const entry of readDirectoryEntries(directory, { budget, sort: true, localeSort: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const child = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in canonical skill package: ${child}`);
      if (entry.isDirectory()) files.push(...collectFiles(child, budget, childRelative));
      else if (entry.isFile()) files.push({ absolute: child, relative: childRelative });
      else throw new Error(`unsupported canonical skill entry: ${child}`);
    }
    return files;
  } finally {
    budget.leaveDirectory(realDirectory);
  }
}

function mergeLogicalFiles(sourceFiles, runtimeFiles, label) {
  const files = [...sourceFiles, ...runtimeFiles];
  const seen = new Set();
  for (const file of files) {
    assertSafeRelative(file.relative, `${label} file`);
    if (seen.has(file.relative)) throw new Error(`duplicate ${label} file: ${file.relative}`);
    seen.add(file.relative);
  }
  const sorted = files.slice().sort((left, right) => left.relative.localeCompare(right.relative));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].relative;
    const current = sorted[index].relative;
    if (current.startsWith(`${previous}/`)) {
      throw new Error(`file-prefix collision in ${label}: ${previous} and ${current}`);
    }
  }
  return sorted;
}

// A Skill publishes its complete physical directory plus inventory-declared
// standalone resources. The receipt treats both sets as one logical tree.
function logicalSkillFiles(root, skill, inventory = {}) {
  const sourceFiles = collectFiles(skill.sourceDir, createTraversalBudget());
  const dependencies = resolveStandaloneSkillDependencies(
    Array.isArray(inventory) ? {} : inventory,
    skill.name,
    root,
  ).map(({ relative, absolute }) => {
    assertPhysicalAncestors(absolute, `standalone dependency '${relative}'`, root);
    return { relative, absolute };
  });
  return mergeLogicalFiles(sourceFiles, dependencies, `skill '${skill.name}'`);
}

function treeFingerprint(files, budget) {
  return fileSetFingerprintTerminated(files.map((file) => ({
    path: file.relative,
    content: readPhysicalFile(file.absolute, budget, `canonical skill file: ${file.relative}`),
  })));
}

function readSkillFiles(files, budget) {
  const output = [];
  for (const file of files) {
    const relative = file.relative;
    assertSafeRelative(relative, 'generated skill file');
    const content = readPhysicalFile(file.absolute, budget, `canonical skill file: ${relative}`);
    const sourceStat = lstatOrNull(file.absolute);
    output.push({ path: relative, digest: sha256Hex(content), content, mode: sourceStat ? sourceStat.mode & 0o7777 : 0o644 });
  }
  return output;
}

function containsSecret(content) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(String(content)));
}

function parseSelectedSkill(root, entry) {
  const name = safeName(entry.name || entry.id, 'inventory skill name');
  if (typeof entry.path !== 'string' || !entry.path.startsWith('skills/')) {
    throw new Error(`inventory skill '${name}' must use a canonical skills/ path`);
  }
  const sourceDir = path.resolve(root, entry.path);
  if (!isInside(path.join(root, 'skills'), sourceDir) || path.basename(sourceDir) !== name) {
    throw new Error(`inventory skill '${name}' has an unsafe canonical path: ${entry.path}`);
  }
  assertPhysicalAncestors(sourceDir, `canonical skill '${name}'`, root);
  const sourceFile = path.join(sourceDir, 'SKILL.md');
  const sourceStat = lstatOrNull(sourceFile);
  if (!sourceStat || !sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`canonical skill '${name}' is missing a physical SKILL.md`);
  }
  return { id: entry.id, name, sourceDir, sourceFile };
}

function selectedSkills(root, inventory) {
  const selected = selectPortableSkills(inventory, 'agent-plugin');
  const seen = new Set();
  return selected.map((entry) => {
    const skill = parseSelectedSkill(root, entry);
    if (seen.has(skill.name)) throw new Error(`duplicate selected skill name: ${skill.name}`);
    seen.add(skill.name);
    return { ...skill, entry };
  });
}

function agyShim(name, description) {
  const value = JSON.stringify(String(description));
  return [
    '---',
    `name: ${name}`,
    `description: ${value}`,
    '---',
    '',
    '# Generated Antigravity compatibility entry',
    '',
    'This entry is generated from the canonical dhpk skill source. Read and',
    `follow the complete skill at \`skills/${name}/SKILL.md\` from the current workspace.`,
    '',
  ].join('\n');
}

function relativeFiles(directory, budget) {
  return collectFiles(directory, budget).map((file) => file.relative).sort();
}

function readReceipt(outDir, selected = null, sourceRoot = null, availableEntries = []) {
  const receiptPath = path.join(outDir, RECEIPT_NAME);
  const stat = lstatOrNull(receiptPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`projection receipt is not a regular file: ${receiptPath}`);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (error) { throw new Error(`projection receipt is invalid JSON: ${error.message}`); }
  if (!receipt || receipt.schema !== SCHEMA || receipt.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(`projection receipt must use ${SCHEMA} generator ${GENERATOR_VERSION}`);
  }
  if (!Array.isArray(receipt.managedPaths) || !receipt.generatedFingerprints || typeof receipt.generatedFingerprints !== 'object') {
    throw new Error('projection receipt is missing managed paths or generated fingerprints');
  }
  const managedPaths = validateReceiptShape(receipt);
  const trustedEntries = selected
    ? receipt.entries
      .filter((entry) => selected.some((skill) => skill.id === entry.id && skill.name === entry.name))
      .map((entry) => {
        if (Array.isArray(entry.sourceFiles)) return entry;
        const skill = selected.find((candidate) => candidate.id === entry.id && candidate.name === entry.name);
        const sourceFiles = (sourceRoot
          ? logicalSkillFiles(sourceRoot, skill, availableEntries)
          : collectFiles(skill.sourceDir, createTraversalBudget()))
          .sort((left, right) => left.relative.localeCompare(right.relative))
          .map((file) => ({ path: file.relative, digest: sha256Hex(readPhysicalFile(file.absolute, createTraversalBudget(), `canonical skill file: ${file.relative}`)) }));
        return { ...entry, sourceFiles };
      })
    : receipt.entries;
  const expected = selected ? receiptGeneratedPaths(receipt, trustedEntries) : null;
  return {
    ...receipt,
    managedPaths,
    trustedEntries,
    trustedManagedPaths: expected ? managedPaths.filter((relative) => expected.has(relative)) : managedPaths,
  };
}

function pathInOutput(outDir, relative) {
  assertSafeRelative(relative, 'receipt path');
  const candidate = path.resolve(outDir, relative);
  if (!isInside(outDir, candidate)) throw new Error(`receipt path escapes output root: ${relative}`);
  assertPhysicalAncestors(candidate, 'projection path', outDir);
  return candidate;
}

function expectedGeneratedPaths(skills, sourceRoot = null, availableEntries = []) {
  const expected = new Set();
  for (const skill of skills) {
    const files = sourceRoot
      ? logicalSkillFiles(sourceRoot, skill, availableEntries)
      : collectFiles(skill.sourceDir, createTraversalBudget());
    for (const file of files) {
      assertSafeRelative(file.relative, 'canonical skill file');
      expected.add(`${skill.name}/${file.relative}`);
    }
    expected.add(`${skill.name}.md`);
  }
  return expected;
}

function receiptGeneratedPaths(receipt, entries = receipt.entries) {
  const generated = new Set();
  for (const entry of entries) {
    generated.add(`${entry.name}.md`);
    for (const sourceFile of entry.sourceFiles || []) generated.add(`${entry.name}/${sourceFile.path}`);
  }
  return generated;
}

function validateReceiptShape(receipt) {
  if (!Array.isArray(receipt.selectedIds) || receipt.selectedIds.some((id) => typeof id !== 'string')) {
    throw new Error('projection receipt has invalid selected IDs');
  }
  if (new Set(receipt.selectedIds).size !== receipt.selectedIds.length) throw new Error('projection receipt has duplicate selected IDs');
  if (!Array.isArray(receipt.entries)) throw new Error('projection receipt is missing entries');
  const names = new Set();
  const ids = new Set();
  for (const entry of receipt.trustedEntries || receipt.entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      throw new Error('projection receipt has an invalid entry');
    }
    safeName(entry.name, 'projection receipt entry name');
    if (names.has(entry.name) || ids.has(entry.id)) throw new Error('projection receipt has duplicate entries');
    names.add(entry.name);
    ids.add(entry.id);
    if (entry.source !== `skills/${entry.name}` || entry.cursorPath !== `${entry.name}/SKILL.md` || entry.agyPath !== `${entry.name}.md`) {
      throw new Error(`projection receipt entry has an invalid canonical mapping: ${entry.name}`);
    }
    if (!DIGEST_PATTERN.test(entry.sourceFingerprint)) throw new Error(`projection receipt entry has an invalid source fingerprint: ${entry.name}`);
    if (!Array.isArray(entry.sourceFiles)) continue;
    const sourcePaths = new Set();
    for (const sourceFile of entry.sourceFiles) {
      if (!sourceFile || typeof sourceFile.path !== 'string' || !DIGEST_PATTERN.test(sourceFile.digest)) {
        throw new Error(`projection receipt entry has an invalid source manifest: ${entry.name}`);
      }
      assertSafeRelative(sourceFile.path, 'receipt source path');
      if (sourcePaths.has(sourceFile.path)) throw new Error(`projection receipt entry has duplicate source paths: ${entry.name}`);
      sourcePaths.add(sourceFile.path);
    }
  }
  const paths = [...receipt.managedPaths].sort();
  const seen = new Set();
  for (const relative of paths) {
    assertSafeRelative(relative, 'receipt path');
    if (relative === RECEIPT_NAME || seen.has(relative)) throw new Error(`projection receipt has an invalid managed path: ${relative}`);
    seen.add(relative);
    if (!DIGEST_PATTERN.test(receipt.generatedFingerprints[relative])) throw new Error(`projection receipt has an invalid generated fingerprint: ${relative}`);
  }
  for (const key of Object.keys(receipt.generatedFingerprints)) {
    if (!seen.has(key)) throw new Error(`projection receipt has an unlisted generated fingerprint: ${key}`);
  }
  return paths;
}

function canonicalSourceFingerprints(skills, sourceRoot = null, availableEntries = []) {
  const fingerprints = new Map();
  for (const skill of skills) {
    const files = sourceRoot
      ? logicalSkillFiles(sourceRoot, skill, availableEntries)
      : collectFiles(skill.sourceDir, createTraversalBudget());
    for (const file of files) {
      fingerprints.set(`${skill.name}/${file.relative}`, sha256Hex(readPhysicalFile(file.absolute, createTraversalBudget(), `canonical skill file: ${file.relative}`)));
    }
  }
  return fingerprints;
}

function validateExistingManagedFiles(outDir, receipt, managedPaths = receipt.managedPaths, selected = [], allowCanonicalChanges = false, sourceRoot = null, availableEntries = []) {
  const paths = [...managedPaths].sort();
  const sourceFingerprints = new Map();
  const currentSourceFingerprints = canonicalSourceFingerprints(selected, sourceRoot, availableEntries);
  for (const entry of receipt.entries) {
    for (const sourceFile of entry.sourceFiles || []) sourceFingerprints.set(`${entry.name}/${sourceFile.path}`, sourceFile.digest);
  }
  for (const relative of paths) {
    const target = pathInOutput(outDir, relative);
    const stat = lstatOrNull(target);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`receipt-owned file is missing or unsafe: ${relative}`);
    const actual = sha256Hex(fs.readFileSync(target));
    if (actual !== receipt.generatedFingerprints[relative]) {
      throw new Error(`receipt-owned managed file was modified or fingerprint drifted: ${relative}`);
    }
    const sourceFingerprint = sourceFingerprints.get(relative);
    if (sourceFingerprint && actual !== sourceFingerprint) {
      throw new Error(`receipt-owned canonical file does not match its source manifest: ${relative}`);
    }
    const currentSourceFingerprint = currentSourceFingerprints.get(relative);
    if (currentSourceFingerprint && actual !== currentSourceFingerprint && !allowCanonicalChanges) {
      throw new Error(`receipt-owned canonical file is stale or foreign: ${relative}`);
    }
  }
  for (const relative of paths) {
    if (!relative.includes('/')) continue;
    const top = relative.split('/')[0];
    if (!top || top === RECEIPT_NAME) continue;
    const directory = path.join(outDir, top);
    const stat = lstatOrNull(directory);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`receipt-owned skill directory is unsafe: ${top}`);
  }
}

function renamedReceiptPaths(outDir, receipt, selected, inventory) {
  const currentById = new Map(selected.map((skill) => [skill.id, skill]));
  const rows = Array.isArray(inventory && inventory.renamed_skill_names)
    ? inventory.renamed_skill_names
    : [];
  const rowById = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    if (rowById.has(row.id)) throw new Error(`renamed skill ledger has duplicate stable ID: ${row.id}`);
    rowById.set(row.id, row);
  }
  const migrations = [];
  for (const entry of receipt.entries) {
    const current = currentById.get(entry.id);
    if (!current || current.name === entry.name) continue;
    const row = rowById.get(entry.id);
    const currentPath = current.entry && current.entry.path;
    if (!row
      || row.oldName !== entry.name
      || row.oldPath !== entry.source
      || row.newName !== current.name
      || row.newPath !== currentPath) {
      throw new Error(`receipt-owned skill '${entry.name}' changed public name for stable ID '${entry.id}' without an approved rename ledger row`);
    }

    const sourceFiles = Array.isArray(entry.sourceFiles)
      ? entry.sourceFiles.map((sourceFile) => sourceFile.path)
      : receipt.managedPaths
        .filter((relative) => relative.startsWith(`${entry.name}/`))
        .map((relative) => relative.slice(entry.name.length + 1));
    const paths = new Set();
    for (const relativeSource of sourceFiles) {
      assertSafeRelative(relativeSource, `renamed receipt source path: ${entry.name}`);
      paths.add(`${entry.name}/${relativeSource}`);
    }
    paths.add(`${entry.name}.md`);
    for (const relative of paths) {
      if (!receipt.managedPaths.includes(relative) || !DIGEST_PATTERN.test(receipt.generatedFingerprints[relative] || '')) {
        throw new Error(`renamed receipt entry is not receipt-owned: ${relative}`);
      }
      const target = pathInOutput(outDir, relative);
      const stat = lstatOrNull(target);
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`receipt-owned renamed skill file is missing or unsafe: ${relative}`);
      }
      if (sha256Hex(fs.readFileSync(target)) !== receipt.generatedFingerprints[relative]) {
        throw new Error(`receipt-owned renamed skill file was modified or fingerprinted as foreign: ${relative}`);
      }
    }
    migrations.push({ entry, paths: [...paths] });
  }
  return migrations;
}

function outputFiles(outDir, budget = createTraversalBudget()) {
  return relativeFiles(outDir, budget).filter((relative) => relative !== RECEIPT_NAME);
}

function usesRelocatableProjection(options = {}) {
  if (options.projectRoot || options.sourceRoot || options.plan || options.relocatable === true) return true;
  if (options.root && options.outDir) return !isInside(options.root, options.outDir);
  return false;
}

// Ownership is the set of paths the previous receipt can prove it generated
// (trusted by the current selection, renamed, retired, or carried), plus the
// receipt itself. A path merely claimed by the receipt grants nothing.
function agentsSkillsOwnership(ownedPaths) {
  return {
    verify: (existingRoot) => {
      const receiptStat = lstatOrNull(path.join(existingRoot, RECEIPT_NAME));
      if (!receiptStat || receiptStat.isSymbolicLink() || !receiptStat.isFile()) {
        return { ok: false, code: 'NO_OWNER_RECEIPT', message: `existing tree has no ${RECEIPT_NAME} receipt` };
      }
      const walk = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            const nested = walk(path.join(directory, entry.name), relative);
            if (nested) return nested;
          } else if (!ownedPaths.has(relative)) {
            return relative;
          }
        }
        return null;
      };
      const unlisted = walk(existingRoot, '');
      return unlisted
        ? { ok: false, code: 'UNLISTED_FILE', message: `existing tree holds a file the receipt does not own: ${unlisted}` }
        : { ok: true };
    },
  };
}

function publishAgentsSkillsTree({ sourceRoot, outputRoot, inventory, outputs, ownedPaths }) {
  const entries = outputs.map((output) => ({
    stableId: `agents-skills:${output.path}`,
    source: output.source,
    destination: output.path,
    owner: 'plugins/dhpk-agent',
    transform: { id: 'agents-skills-render', version: GENERATOR_VERSION },
    expectedFingerprint: sha256Hex(output.content),
    symlinkPolicy: 'forbid',
  }));
  const compiled = compileDistribution({
    internalCharacterization: true,
    surface: 'agents-skills',
    compilerVersion: `agents-skills-${GENERATOR_VERSION}`,
    inventoryRevision: resolveInventoryRevision(inventory),
    ownershipRoot: '.agents/skills',
    entries,
  });
  if (!compiled.ok) throw new Error(compiled.error.message);
  const adapter = {
    identity: { id: 'agents-skills', version: GENERATOR_VERSION },
    render: () => ({
      adapter: { id: 'agents-skills', version: GENERATOR_VERSION },
      outputs: outputs.map((output) => ({
        stableId: `agents-skills:${output.path}`,
        destination: output.path,
        content: output.content,
        mode: output.mode,
      })),
      links: [],
    }),
  };
  const store = new ProjectionArtifactStore({
    root: path.dirname(outputRoot),
    sourceRoot,
    publishRoot: outputRoot,
    ownership: agentsSkillsOwnership(ownedPaths),
  });
  const artifact = materializeDistribution(compiled.value, adapter, store);
  if (!artifact.ok) {
    const code = artifact.error.code === 'OWNERSHIP_REFUSED' ? 'OWNERSHIP_REFUSED: ' : '';
    throw new Error(`${code}${artifact.error.message}`);
  }
}

function materializeAgentsSkillsProjection(options = {}) {
  if (usesRelocatableProjection(options)) return materializeRelocatableAgentsSkillsProjection(options);
  // In-checkout build-time tree: planned outputs published as one tree through
  // ProjectionArtifactStore, gated by a receipt-based ownership verifier.
  const { root, inventory, outDir = path.join(root, '.agents', 'skills'), allowCanonicalChanges = false } = options;
  if (!root || !inventory) throw new Error('root and inventory are required');
  const sourceRoot = path.resolve(root);
  const outputRoot = path.resolve(outDir);
  assertOutputRoot(sourceRoot, outputRoot);
  ensureDirectory(path.dirname(outputRoot), 'agents-skills output parent', sourceRoot);

  const selected = selectedSkills(sourceRoot, inventory);
  const outputs = [];
  const entries = [];
  for (const skill of selected) {
    const sourceFiles = logicalSkillFiles(sourceRoot, skill, inventory);
    const sourceFingerprint = treeFingerprint(sourceFiles, createTraversalBudget());
    const copied = readSkillFiles(sourceFiles, createTraversalBudget());
    if (!copied.some((file) => file.path === 'SKILL.md')) throw new Error(`generated Cursor skill is missing SKILL.md: ${skill.name}`);
    const sourceContent = readPhysicalFile(skill.sourceFile, createTraversalBudget(), `canonical skill ${skill.name}/SKILL.md`);
    const parsed = parseFrontmatter(sourceContent.toString('utf8'));
    if (!parsed.present || !parsed.values.name || !parsed.values.description) {
      throw new Error(`canonical skill ${skill.name}/SKILL.md is missing name or description frontmatter`);
    }
    if (parsed.values.name !== skill.name) {
      throw new Error(`canonical skill frontmatter name does not match inventory name: ${skill.name}`);
    }
    if (containsSecret(sourceContent.toString('utf8'))) throw new Error(`possible secret in canonical skill: ${skill.name}`);
    const source = path.relative(sourceRoot, skill.sourceDir).split(path.sep).join('/');
    const shim = Buffer.from(agyShim(skill.name, parsed.values.description), 'utf8');
    for (const file of copied) outputs.push({ path: `${skill.name}/${file.path}`, digest: file.digest, content: file.content, mode: file.mode, source });
    outputs.push({ path: `${skill.name}.md`, digest: sha256Hex(shim), content: shim, mode: 0o644, source });
    entries.push({
      id: skill.id,
      name: skill.name,
      source,
      sourceFingerprint,
      sourceFiles: copied.map((file) => ({ path: file.path, digest: file.digest })),
      cursorPath: `${skill.name}/SKILL.md`,
      agyPath: `${skill.name}.md`,
    });
  }
  outputs.sort((left, right) => left.path.localeCompare(right.path));
  const currentPaths = outputs.map((file) => file.path);
  const currentPathSet = new Set(currentPaths);
  const currentNames = new Set(entries.map((entry) => entry.name));
  const previous = readReceipt(outputRoot, selected, sourceRoot, inventory);
  if (previous) validateExistingManagedFiles(outputRoot, previous, previous.trustedManagedPaths, selected, allowCanonicalChanges, sourceRoot, inventory);
  const renamed = previous ? renamedReceiptPaths(outputRoot, previous, selected, inventory) : [];
  const renamedIds = new Set(renamed.map((migration) => migration.entry.id));
  const renamedPaths = new Set(renamed.flatMap((migration) => migration.paths));
  const retired = planRetiredAgentSkills({ inventory, previous, selected, outputRoot,
    safeName, assertSafeRelative, pathInOutput, lstatOrNull, digest: sha256Hex, treeFingerprint });
  const carriedEntries = previous
    ? previous.entries.filter((entry) => !currentNames.has(entry.name) && !renamedIds.has(entry.id) && !retired.ids.has(entry.id))
    : [];
  const carriedPaths = previous
    ? previous.managedPaths.filter((relative) => {
        if (currentPathSet.has(relative) || renamedPaths.has(relative) || retired.paths.has(relative)) return false;
        const top = relative.split('/')[0].replace(/\.md$/, '');
        return !currentNames.has(top);
      })
    : [];
  const carriedFingerprints = previous
    ? Object.fromEntries(carriedPaths.map((relative) => [relative, previous.generatedFingerprints[relative]]))
    : {};
  const receipt = {
    schema: SCHEMA,
    generatorVersion: GENERATOR_VERSION,
    selectionSurface: 'agent-plugin',
    inventoryRevision: resolveInventoryRevision(inventory),
    selectedIds: selected.map((skill) => skill.id).sort(),
    entries: [...entries, ...carriedEntries].sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: [...currentPaths, ...carriedPaths].sort(),
    generatedFingerprints: {
      ...Object.fromEntries(outputs.map((file) => [file.path, file.digest])),
      ...carriedFingerprints,
    },
  };
  const carriedOutputs = carriedPaths.map((relative) => {
    const target = pathInOutput(outputRoot, relative);
    const content = readPhysicalFile(target, createTraversalBudget(), `carried projection file: ${relative}`);
    return { path: relative, content, mode: lstatOrNull(target).mode & 0o7777, source: 'skills' };
  });
  const receiptContent = Buffer.from(`${stableStringify(receipt)}\n`, 'utf8');
  const ownedPaths = new Set(previous
    ? [...previous.trustedManagedPaths, ...renamedPaths, ...retired.paths, ...carriedPaths, RECEIPT_NAME]
    : []);
  publishAgentsSkillsTree({
    sourceRoot,
    outputRoot,
    inventory,
    ownedPaths,
    outputs: [...outputs, ...carriedOutputs, { path: RECEIPT_NAME, content: receiptContent, mode: 0o644, source: 'skills' }],
  });
  return {
    outputRoot,
    selectedIds: receipt.selectedIds,
    managedPaths: receipt.managedPaths,
    receipt,
  };
}

function validateAgentsSkillsProjection(options = {}) {
  if (usesRelocatableProjection(options)) return validateRelocatableAgentsSkillsProjection(options);
  const { root, inventory, outDir = path.join(root, '.agents', 'skills') } = options;
  const errors = [];
  const outputRoot = path.resolve(outDir);
  try {
    assertOutputRoot(path.resolve(root), outputRoot);
    const stat = lstatOrNull(outputRoot);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('projection output root is missing or unsafe');
    const selected = selectedSkills(path.resolve(root), inventory);
    const receipt = readReceipt(outputRoot, selected, path.resolve(root), inventory);
    if (!receipt) throw new Error(`projection receipt is missing: ${RECEIPT_NAME}`);
    const selectedIds = selected.map((skill) => skill.id).sort();
    if (stableStringify(receipt.selectedIds) !== stableStringify(selectedIds)) errors.push('receipt selected IDs do not match inventory selection');
    const selectedNames = new Set(selected.map((skill) => skill.name));
    const expectedCurrentPaths = expectedGeneratedPaths(selected, path.resolve(root), inventory);
    for (const relative of receipt.managedPaths) {
      const top = relative.split('/')[0];
      if (selectedNames.has(top.replace(/\.md$/, '')) && !expectedCurrentPaths.has(relative)) {
        errors.push(`receipt claims an unmanaged active projection path: ${relative}`);
      }
      if (!receipt.trustedManagedPaths.includes(relative) && lstatOrNull(pathInOutput(outputRoot, relative))) {
        errors.push(`receipt claims an unverified ownership path: ${relative}`);
      }
    }
    const expectedPaths = new Set(receipt.managedPaths);
    const actualPaths = new Set(outputFiles(outputRoot));
    for (const relative of expectedPaths) {
      if (!actualPaths.has(relative)) errors.push(`managed projection file is missing: ${relative}`);
    }
    for (const relative of actualPaths) {
      if (expectedPaths.has(relative)) continue;
      const top = relative.split('/')[0];
      if (expectedPaths.has(top) || [...expectedPaths].some((managed) => managed.startsWith(`${top}/`))) {
        errors.push(`unrecorded file inside managed projection: ${relative}`);
      }
    }
    for (const skill of selected) {
      const entry = receipt.entries.find((candidate) => candidate && candidate.id === skill.id);
      if (!entry) {
        errors.push(`receipt entry is missing: ${skill.id}`);
        continue;
      }
      const sourceFiles = logicalSkillFiles(path.resolve(root), skill, inventory);
      const sourceFingerprint = treeFingerprint(sourceFiles, createTraversalBudget());
      if (entry.sourceFingerprint !== sourceFingerprint) errors.push(`source fingerprint drifted: ${skill.name}`);
      const source = readPhysicalFile(skill.sourceFile, createTraversalBudget(), `canonical skill ${skill.name}/SKILL.md`).toString('utf8');
      const parsed = parseFrontmatter(source);
      if (!parsed.present || parsed.values.name !== skill.name || !parsed.values.description) errors.push(`canonical frontmatter is invalid: ${skill.name}`);
      const shim = path.join(outputRoot, `${skill.name}.md`);
      if (lstatOrNull(shim) && containsSecret(fs.readFileSync(shim, 'utf8'))) errors.push(`possible secret in generated shim: ${skill.name}`);
    }
    for (const relative of receipt.managedPaths) {
      const target = pathInOutput(outputRoot, relative);
      const stat = lstatOrNull(target);
      if (stat && stat.isSymbolicLink()) errors.push(`generated projection must not contain symlinks: ${relative}`);
      if (stat && stat.isFile() && sha256Hex(fs.readFileSync(target)) !== receipt.generatedFingerprints[relative]) {
        errors.push(`generated fingerprint drifted: ${relative}`);
      }
    }
    return { ok: errors.length === 0, errors, selectedIds, runtime: 'NOT_RUN', receipt };
  } catch (error) {
    errors.push(error.message);
    return { ok: false, errors, selectedIds: [], runtime: 'NOT_RUN' };
  }
}

module.exports = {
  containsSecret,
  SCHEMA,
  GENERATOR_VERSION,
  RECEIPT_NAME,
  PROJECT_RECEIPT_SCHEMA,
  PROJECT_ROLLBACK_SCHEMA,
  PROJECT_TRANSACTION_SCHEMA,
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
  materializeRelocatableAgentsSkillsProjection,
  validateRelocatableAgentsSkillsProjection,
  uninstallAgentsSkillsProjection,
  removeAgentsSkillsProjection,
  rollbackAgentsSkillsProjection,
  recoverAgentsSkillsProjection,
  readProjectProjectionReceipt,
};
