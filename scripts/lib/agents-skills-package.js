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
const {
  createTraversalBudget,
  readDirectoryEntries,
  lstatOrNull,
  isInside,
} = require('./bounded-filesystem');
const {
  TREE_FINGERPRINT_ALGORITHM,
  requireTreeMerkle,
  sha256Hex,
  treeFingerprint: sharedTreeFingerprint,
} = require('./content-fingerprint');
const { resolveStandaloneSkillDependencies } = require('./standalone-skill-dependencies');
const { planRetiredAgentSkills } = require('./agents-skills-retirement');
const { compileDistribution, materializeDistribution } = require('./distribution-compiler');
const { ProjectionArtifactStore, safeRelative } = require('./projection-artifact-store');
const { containsSecret } = require('./secret-patterns');
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

const SURFACE = 'agents-skills';
const SCHEMA = 'dhpk.agents-skills-projection.v1';
const GENERATOR_VERSION = '1.1.0';
// Only the current generator's receipts are read (OpenSpec
// remove-legacy-tree-fingerprints, design D3/Q17).
const ACCEPTED_GENERATOR_VERSIONS = Object.freeze([GENERATOR_VERSION]);
// The one marker-less receipt still read: 0.69.x wrote it at this generator
// version when it carried legacy entries. Its carried entries are released.
const UNMARKED_RECEIPT_GENERATOR_VERSION = '1.1.0';
const RECEIPT_NAME = '.dhpk-projection.json';
const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

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

// Deliberately bounded (#1248): the walk stops at `boundary` so a checkout under
// a symlinked parent (for example /var on macOS) still works.
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
  // safeRelative also rejects backslashes and drive prefixes; receipt paths
  // come back from the consumer's output tree and are not trusted (#1248).
  if (normalized !== relative || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(relative) || !safeRelative(relative)) {
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
  const contents = files.map((file) => ({
    path: file.relative,
    type: 'file',
    content: readPhysicalFile(file.absolute, budget, `canonical skill file: ${file.relative}`),
  }));
  return sharedTreeFingerprint(contents);
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

// options.allowUnmarked: the updater accepts the one marker-less 1.1.0 receipt
// and reports `legacyUnmarked` so it can release the entries it carries.
function readReceipt(outDir, selected = null, sourceRoot = null, availableEntries = [], { allowUnmarked = false } = {}) {
  const receiptPath = path.join(outDir, RECEIPT_NAME);
  const stat = lstatOrNull(receiptPath);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`projection receipt is not a regular file: ${receiptPath}`);
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); } catch (error) { throw new Error(`projection receipt is invalid JSON: ${error.message}`); }
  if (!receipt || receipt.schema !== SCHEMA) {
    throw new Error(`projection receipt must use ${SCHEMA} generator ${GENERATOR_VERSION}`);
  }
  // Decide on generatorVersion and the missing marker before requireTreeMerkle:
  // the migration exception must not reach the fail-closed gate.
  const legacyUnmarked = allowUnmarked
    && !Object.hasOwn(receipt, 'fingerprint_algorithm')
    && receipt.generatorVersion === UNMARKED_RECEIPT_GENERATOR_VERSION;
  if (!legacyUnmarked) {
    try { requireTreeMerkle(receipt.fingerprint_algorithm, 'fingerprint_algorithm'); } catch (error) {
      throw new Error(`projection receipt ${error.message}`);
    }
  }
  if (!ACCEPTED_GENERATOR_VERSIONS.includes(receipt.generatorVersion)) {
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
    fingerprintAlgorithm: legacyUnmarked ? null : TREE_FINGERPRINT_ALGORITHM,
    legacyUnmarked,
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

// Validator-only enumeration. Only receipt/reserved top-level entries are
// walked; every other top-level entry (including a top-level symlink) belongs to
// the user and is skipped without being statted below its name, so a symlink or
// file count inside a foreign skill cannot fail or exhaust validation. Reserved
// entries keep the strict collectFiles rules (symlinks and special files throw).
function reservedOutputFiles(outDir, isReserved, budget = createTraversalBudget()) {
  const realRoot = budget.enterDirectory(outDir, 0);
  try {
    const files = [];
    for (const entry of readDirectoryEntries(outDir, { budget, sort: true, localeSort: true })) {
      if (entry.name === RECEIPT_NAME || !isReserved(entry.name)) continue;
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const child = path.join(outDir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed in canonical skill package: ${child}`);
      if (entry.isDirectory()) files.push(...collectFiles(child, budget, entry.name).map((file) => file.relative));
      else if (entry.isFile()) files.push(entry.name);
      else throw new Error(`unsupported canonical skill entry: ${child}`);
    }
    return files.sort();
  } finally {
    budget.leaveDirectory(realRoot);
  }
}

function retiredLedgerNames(inventory) {
  return (Array.isArray(inventory && inventory.retired_skills) ? inventory.retired_skills : [])
    .map((row) => row && row.name)
    .filter((name) => typeof name === 'string');
}

function usesRelocatableProjection(options = {}) {
  if (options.projectRoot || options.sourceRoot || options.plan || options.relocatable === true) return true;
  if (options.root && options.outDir) return !isInside(options.root, options.outDir);
  return false;
}

// A reserved name is `N` or `N.md` for every skill the sync generates, renames
// from, retires, or carries. The writer, the activation verifier, and the
// validator all judge a top-level entry through this one predicate.
//
// Exact-case match is the predicate itself. `foldCollision(topName)` is the
// case-equivalence rule, identical on every Host and filesystem: both sides are
// normalized with Unicode NFC and then locale-independent `toLowerCase()`, the
// `.md` suffix is stripped after folding, and the entry collides when the folded
// forms are equal but the names are not an exact match. It returns the reserved
// name, or null.
function foldReservedName(name) {
  return name.normalize('NFC').toLowerCase().replace(/\.md$/, '');
}

function reservedNamePredicate(names) {
  const bases = new Set(names);
  const folded = new Map();
  for (const base of [...bases].sort()) {
    const key = foldReservedName(base);
    if (!folded.has(key)) folded.set(key, base);
  }
  const isReserved = (topName) => bases.has(topName.replace(/\.md$/, ''));
  isReserved.foldCollision = (topName) => {
    if (isReserved(topName)) return null;
    return folded.get(foldReservedName(topName)) || null;
  };
  return isReserved;
}

function caseCollisionMessage(entryName, reservedName) {
  return `unmanaged entry "${entryName}" is case-equivalent to reserved name "${reservedName}"`;
}

function topLevelName(relative) {
  return relative.split('/')[0];
}

// Unmanaged = a top-level entry that is neither reserved nor the receipt. Its
// regular files are carried through the staged tree with identical bytes and
// modes and never enter the receipt. This walker deliberately does not reuse
// collectFiles: that one skips __pycache__ and *.pyc, which a third-party skill
// owns just as much as its SKILL.md. Empty directories cannot be staged and are
// dropped. One traversal budget covers the whole walk and every read.
//
// `options.refuseReserved` is the receipt-less initialization path: with no
// receipt a reserved-name entry may be a former dhpk projection, so it is
// refused instead of skipped.
function planUnmanagedSkillEntries(outputRoot, isReserved, budgetOptions = {}, { refuseReserved = false } = {}) {
  const files = new Map();
  const outputs = [];
  const names = new Set();
  if (!lstatOrNull(outputRoot)) return { outputs, files, names: [] };
  const budget = createTraversalBudget(budgetOptions);

  const collect = (absolute, relative, depth) => {
    const stat = lstatOrNull(absolute);
    if (!stat) throw new Error(`unmanaged entry disappeared while planning: ${relative}`);
    if (stat.isSymbolicLink()) throw new Error(`unmanaged entry holds a symlink, which cannot be preserved: ${relative}`);
    if (stat.isDirectory()) {
      const realDirectory = budget.enterDirectory(absolute, depth);
      try {
        for (const entry of readDirectoryEntries(absolute, { budget, sort: true })) {
          collect(path.join(absolute, entry.name), `${relative}/${entry.name}`, depth + 1);
        }
      } finally {
        budget.leaveDirectory(realDirectory);
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`unmanaged entry holds a non-regular file, which cannot be preserved: ${relative}`);
    assertSafeRelative(relative, 'unmanaged file');
    const content = budget.readFile(absolute, stat, `unmanaged file: ${relative}`);
    const mode = stat.mode & 0o7777;
    files.set(relative, { digest: sha256Hex(content), mode });
    outputs.push({ path: relative, content, mode, source: 'skills' });
    names.add(topLevelName(relative));
  };

  for (const entry of readDirectoryEntries(outputRoot, { budget, sort: true })) {
    if (entry.name === RECEIPT_NAME) continue;
    if (isReserved(entry.name)) {
      if (refuseReserved) throw new Error(`OWNERSHIP_REFUSED: unmanaged entry "${entry.name}" uses a reserved name and no ${RECEIPT_NAME} receipt proves it is not a former dhpk projection`);
      continue;
    }
    const reservedName = isReserved.foldCollision ? isReserved.foldCollision(entry.name) : null;
    if (reservedName) throw new Error(`OWNERSHIP_REFUSED: ${caseCollisionMessage(entry.name, reservedName)}`);
    assertSafeRelative(entry.name, 'unmanaged entry name');
    collect(path.join(outputRoot, entry.name), entry.name, 1);
  }
  return { outputs, files, names: [...names].sort() };
}

// Ownership is the set of paths the previous receipt can prove it generated
// (trusted by the current selection, renamed, retired, or carried), plus the
// receipt itself. A path merely claimed by the receipt grants nothing.
//
// `unmanaged` ({ isReserved, files }) lets non-reserved top-level entries
// through, but only as the exact file set (digest and mode) that planning
// staged: anything added, removed, or modified since planning is refused, so
// the whole-root swap can never lose or resurrect a file. Without `unmanaged`,
// every file the receipt does not own is refused.
//
// `unmanaged.receiptless` is the explicit --preserve-unmanaged authorization for
// a tree that has no receipt at all: the walk then runs with an empty owned set,
// so only planned unmanaged entries pass. It never applies once a receipt
// exists, so a receipt that appears after planning is refused.
//
// `preserved` (Map of relative path -> { digest, mode }) is the planned snapshot
// of carried and legacy-released files that the staged tree rewrites from
// captured bytes. Each must still be a regular file with the planned digest and
// mode; modified, re-moded, removed, or symlink-replaced content is refused.
function agentsSkillsOwnership(ownedPaths, unmanaged = null, preserved = null) {
  return {
    verify: (existingRoot) => {
      // A pre-created empty tree holds nothing to lose.
      if (fs.readdirSync(existingRoot).length === 0) return { ok: true };
      const receiptStat = lstatOrNull(path.join(existingRoot, RECEIPT_NAME));
      const receiptless = Boolean(unmanaged && unmanaged.receiptless) && !receiptStat;
      if (!receiptless && (!receiptStat || receiptStat.isSymbolicLink() || !receiptStat.isFile())) {
        return {
          ok: false,
          code: 'NO_OWNER_RECEIPT',
          message: `existing tree has no ${RECEIPT_NAME} receipt; rerun with --preserve-unmanaged to create the projection beside non-reserved third-party entries (they stay unowned)`,
        };
      }
      const observed = new Map();
      const observedPreserved = new Map();
      const budget = createTraversalBudget();
      const refuse = (code, message) => ({ ok: false, code, message });
      const walk = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          const absolute = path.join(directory, entry.name);
          const top = topLevelName(relative);
          if (unmanaged && top !== RECEIPT_NAME && !unmanaged.isReserved(top)) {
            const reservedName = unmanaged.isReserved.foldCollision ? unmanaged.isReserved.foldCollision(top) : null;
            if (reservedName) return refuse('RESERVED_NAME_CASE_COLLISION', caseCollisionMessage(top, reservedName));
            const stat = lstatOrNull(absolute);
            if (!stat || stat.isSymbolicLink()) {
              return refuse('UNMANAGED_SYMLINK', `unmanaged entry holds a symlink: ${relative}`);
            }
            if (stat.isDirectory()) {
              const nested = walk(absolute, relative);
              if (nested) return nested;
            } else if (stat.isFile()) {
              observed.set(relative, { digest: sha256Hex(budget.readFile(absolute, stat, `unmanaged file: ${relative}`)), mode: stat.mode & 0o7777 });
            } else {
              return refuse('UNMANAGED_NON_REGULAR', `unmanaged entry holds a non-regular file: ${relative}`);
            }
          } else if (entry.isDirectory()) {
            const nested = walk(absolute, relative);
            if (nested) return nested;
          } else if (!ownedPaths.has(relative)) {
            return refuse('UNLISTED_FILE', `existing tree holds a file the receipt does not own: ${relative}`);
          } else if (preserved && preserved.has(relative)) {
            const stat = lstatOrNull(absolute);
            if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
              return refuse('PRESERVED_UNSAFE', `preserved file is missing or unsafe: ${relative}`);
            }
            observedPreserved.set(relative, { digest: sha256Hex(budget.readFile(absolute, stat, `preserved file: ${relative}`)), mode: stat.mode & 0o7777 });
          }
        }
        return null;
      };
      try {
        const refusal = walk(existingRoot, '');
        if (refusal) return refusal;
        if (preserved) {
          for (const [relative, planned] of preserved) {
            const actual = observedPreserved.get(relative);
            if (!actual || actual.digest !== planned.digest || actual.mode !== planned.mode) {
              return refuse('PRESERVED_CHANGED', `preserved file changed after planning: ${relative}`);
            }
          }
        }
        if (unmanaged) {
          const changed = (relative) => refuse('UNMANAGED_CHANGED', `unmanaged file changed after planning: ${relative}`);
          for (const [relative, planned] of unmanaged.files) {
            const actual = observed.get(relative);
            if (!actual || actual.digest !== planned.digest || actual.mode !== planned.mode) return changed(relative);
          }
          for (const relative of observed.keys()) {
            if (!unmanaged.files.has(relative)) return changed(relative);
          }
        }
      } catch (error) {
        return refuse('UNMANAGED_UNREADABLE', `unmanaged files could not be verified: ${error.message}`);
      }
      return { ok: true };
    },
  };
}

// The projection owns its own plan entries; it is not the Agent Plugin package.
function agentsSkillsPlanEntries(outputs) {
  return outputs.map((output) => ({
    stableId: `${SURFACE}:${output.path}`,
    source: output.source,
    destination: output.path,
    owner: SURFACE,
    transform: { id: 'agents-skills-render', version: GENERATOR_VERSION },
    expectedFingerprint: sha256Hex(output.content),
    symlinkPolicy: 'forbid',
  }));
}

function publishAgentsSkillsTree({ sourceRoot, outputRoot, inventory, outputs, ownedPaths, unmanaged, preserved = null }) {
  const entries = agentsSkillsPlanEntries(outputs);
  const compiled = compileDistribution({
    internalCharacterization: true,
    surface: SURFACE,
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
    ownership: agentsSkillsOwnership(ownedPaths, unmanaged, preserved),
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
  const { root, inventory, outDir = path.join(root, '.agents', 'skills'), allowCanonicalChanges = false, preserveUnmanaged = false } = options;
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
  const previous = readReceipt(outputRoot, selected, sourceRoot, inventory, { allowUnmarked: true });
  if (previous) validateExistingManagedFiles(outputRoot, previous, previous.trustedManagedPaths, selected, allowCanonicalChanges, sourceRoot, inventory);
  const renamed = previous ? renamedReceiptPaths(outputRoot, previous, selected, inventory) : [];
  const renamedIds = new Set(renamed.map((migration) => migration.entry.id));
  const renamedPaths = new Set(renamed.flatMap((migration) => migration.paths));
  // A marker-less receipt holds legacy source fingerprints that cannot prove a
  // retirement, so its retired entries fall through to carried and are released.
  const retired = previous && previous.legacyUnmarked
    ? { ids: new Set(), paths: new Set() }
    : planRetiredAgentSkills({ inventory, previous, selected, outputRoot,
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
  // One planned snapshot of the preserved bytes and modes. A modern carried file
  // must still match its receipt fingerprint: a mismatch is refused, never
  // released or re-fingerprinted. A qualifying marker-less 1.1.0 receipt has no
  // recomputable recipe, so its entries are released without that comparison.
  const releasing = Boolean(previous) && previous.legacyUnmarked;
  const carriedOutputs = carriedPaths.map((relative) => {
    const target = pathInOutput(outputRoot, relative);
    const content = readPhysicalFile(target, createTraversalBudget(), `carried projection file: ${relative}`);
    const mode = lstatOrNull(target).mode & 0o7777;
    if (!releasing && sha256Hex(content) !== previous.generatedFingerprints[relative]) {
      throw new Error(`OWNERSHIP_REFUSED: carried file does not match its receipt fingerprint: ${relative}`);
    }
    return { path: relative, content, mode, source: 'skills' };
  });
  const carriedFingerprints = Object.fromEntries(carriedOutputs.map((file) => [file.path, sha256Hex(file.content)]));
  const preserved = new Map(carriedOutputs.map((file) => [file.path, { digest: sha256Hex(file.content), mode: file.mode }]));
  // A marker-less receipt carries entries whose legacy values cannot be
  // recomputed: release them (drop them from the receipt, keep their files).
  const keptEntries = releasing ? [] : carriedEntries;
  const keptPaths = releasing ? [] : carriedPaths;
  const keptFingerprints = releasing ? {} : carriedFingerprints;
  const released = releasing
    ? carriedEntries.map((entry) => ({ id: entry.id, name: entry.name, source: entry.source }))
    : [];
  const receipt = {
    schema: SCHEMA,
    generatorVersion: GENERATOR_VERSION,
    fingerprint_algorithm: TREE_FINGERPRINT_ALGORITHM,
    selectionSurface: 'agent-plugin',
    inventoryRevision: resolveInventoryRevision(inventory),
    selectedIds: selected.map((skill) => skill.id).sort(),
    entries: [...entries, ...keptEntries].sort((left, right) => left.name.localeCompare(right.name)),
    managedPaths: [...currentPaths, ...keptPaths].sort(),
    generatedFingerprints: {
      ...Object.fromEntries(outputs.map((file) => [file.path, file.digest])),
      ...keptFingerprints,
    },
  };
  const receiptContent = Buffer.from(`${stableStringify(receipt)}\n`, 'utf8');
  const ownedPaths = new Set(previous
    ? [...previous.trustedManagedPaths, ...renamedPaths, ...retired.paths, ...carriedPaths, RECEIPT_NAME]
    : []);
  // Classified only now: renames, retirements, and carried entries have all
  // been resolved, so the reserved set is complete. Without a receipt the
  // verifier refuses a non-empty tree (NO_OWNER_RECEIPT), so nothing is walked.
  const isReserved = reservedNamePredicate([
    ...currentNames,
    ...renamed.map((migration) => migration.entry.name),
    ...carriedEntries.map((entry) => entry.name),
    ...[...currentPathSet, ...renamedPaths, ...retired.paths, ...carriedPaths].map((relative) => topLevelName(relative).replace(/\.md$/, '')),
    ...retiredLedgerNames(inventory),
  ]);
  // Receipt-less initialization is an explicit opt-in; the default keeps the
  // verifier's NO_OWNER_RECEIPT refusal.
  const receiptless = !previous && preserveUnmanaged === true;
  const unmanaged = previous
    ? planUnmanagedSkillEntries(outputRoot, isReserved)
    : receiptless
      ? planUnmanagedSkillEntries(outputRoot, isReserved, {}, { refuseReserved: true })
      : { outputs: [], files: new Map(), names: [] };
  publishAgentsSkillsTree({
    sourceRoot,
    outputRoot,
    inventory,
    ownedPaths,
    unmanaged: { isReserved, files: unmanaged.files, receiptless },
    preserved,
    outputs: [...outputs, ...carriedOutputs, ...unmanaged.outputs, { path: RECEIPT_NAME, content: receiptContent, mode: 0o644, source: 'skills' }],
  });
  return {
    outputRoot,
    selectedIds: receipt.selectedIds,
    managedPaths: receipt.managedPaths,
    released,
    preservedUnmanaged: unmanaged.names,
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
    // Same predicate as the writer: an unmanaged entry at a reserved name is an
    // error, any other unmanaged entry is tolerated and never walked.
    const isReserved = reservedNamePredicate([
      ...selectedNames,
      ...receipt.entries.map((entry) => entry.name),
      ...receipt.managedPaths.map((relative) => topLevelName(relative).replace(/\.md$/, '')),
      ...retiredLedgerNames(inventory),
    ]);
    for (const entry of readDirectoryEntries(outputRoot, { budget: createTraversalBudget(), sort: true })) {
      const reservedName = entry.name === RECEIPT_NAME ? null : isReserved.foldCollision(entry.name);
      if (reservedName) errors.push(caseCollisionMessage(entry.name, reservedName));
    }
    const actualPaths = new Set(reservedOutputFiles(outputRoot, isReserved));
    for (const relative of expectedPaths) {
      if (!actualPaths.has(relative)) errors.push(`managed projection file is missing: ${relative}`);
    }
    for (const relative of actualPaths) {
      if (expectedPaths.has(relative)) continue;
      errors.push(relative.includes('/')
        ? `unrecorded file inside managed projection: ${relative}`
        : `unmanaged entry at a reserved name: ${relative}`);
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
  agentsSkillsPlanEntries,
  agentsSkillsOwnership,
  planUnmanagedSkillEntries,
  reservedNamePredicate,
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
