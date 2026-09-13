'use strict';

// Project-local compatibility projection for the two documented `.agents/skills`
// loaders. Canonical skill packages remain under skills/; this adapter owns only
// generated consumer files and their receipt.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseFrontmatter,
  selectPortableSkills,
} = require('./agent-plugin-package');
const { resolveInventoryRevision } = require('./distribution-projection-contract');
const { createTraversalBudget, readDirectoryEntries } = require('./bounded-filesystem');

const SCHEMA = 'dhpk.agents-skills-projection.v1';
const GENERATOR_VERSION = '1.0.0';
const RECEIPT_NAME = '.dhpk-projection.json';
const TRANSACTION_SCHEMA = 'dhpk.agents-skills-transaction.v1';
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

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function treeFingerprint(files, root, budget) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(root, file.absolute).split(path.sep).join('/');
    const content = readPhysicalFile(file.absolute, budget, `canonical skill file: ${relative}`);
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyFiles(files, sourceRoot, targetRoot, budget) {
  const output = [];
  for (const file of files) {
    const relative = file.relative;
    const source = path.join(sourceRoot, relative);
    const target = path.join(targetRoot, relative);
    assertSafeRelative(relative, 'generated skill file');
    if (!isInside(targetRoot, target)) throw new Error(`generated skill file escapes output root: ${relative}`);
    const content = readPhysicalFile(source, budget, `canonical skill file: ${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: 0o644 });
    output.push({ path: relative, digest: digest(content) });
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
    return skill;
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

function readReceipt(outDir, selected = null) {
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
        const sourceFiles = collectFiles(skill.sourceDir, createTraversalBudget())
          .sort((left, right) => left.relative.localeCompare(right.relative))
          .map((file) => ({ path: file.relative, digest: digest(readPhysicalFile(file.absolute, createTraversalBudget(), `canonical skill file: ${file.relative}`)) }));
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

function expectedGeneratedPaths(skills) {
  const expected = new Set();
  for (const skill of skills) {
    const files = collectFiles(skill.sourceDir, createTraversalBudget());
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

function canonicalSourceFingerprints(skills) {
  const fingerprints = new Map();
  for (const skill of skills) {
    for (const file of collectFiles(skill.sourceDir, createTraversalBudget())) {
      fingerprints.set(`${skill.name}/${file.relative}`, digest(readPhysicalFile(file.absolute, createTraversalBudget(), `canonical skill file: ${file.relative}`)));
    }
  }
  return fingerprints;
}

function validateExistingManagedFiles(outDir, receipt, managedPaths = receipt.managedPaths, selected = [], allowCanonicalChanges = false) {
  const paths = [...managedPaths].sort();
  const sourceFingerprints = new Map();
  const currentSourceFingerprints = canonicalSourceFingerprints(selected);
  for (const entry of receipt.entries) {
    for (const sourceFile of entry.sourceFiles || []) sourceFingerprints.set(`${entry.name}/${sourceFile.path}`, sourceFile.digest);
  }
  for (const relative of paths) {
    const target = pathInOutput(outDir, relative);
    const stat = lstatOrNull(target);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`receipt-owned file is missing or unsafe: ${relative}`);
    const actual = digest(fs.readFileSync(target));
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

function outputFiles(outDir, budget = createTraversalBudget()) {
  return relativeFiles(outDir, budget).filter((relative) => relative !== RECEIPT_NAME);
}

function transactionPathFor(outDir) {
  return path.join(path.dirname(outDir), `.dhpk-agents-skills-${digest(path.resolve(outDir)).slice(0, 16)}.transaction.json`);
}

function writeAtomicJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${stableStringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    if (lstatOrNull(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function transactionPaths(outDir, transaction) {
  if (!transaction || transaction.schema !== TRANSACTION_SCHEMA) throw new Error('agents-skills transaction journal has an unsupported schema');
  const parent = path.dirname(outDir);
  if (transaction.outputName !== path.basename(outDir) || typeof transaction.backupName !== 'string' || typeof transaction.stageName !== 'string') {
    throw new Error('agents-skills transaction journal has an invalid output identity');
  }
  for (const name of [transaction.backupName, transaction.stageName]) {
    if (!/^[.a-z0-9-]+$/i.test(name) || name.includes('/') || name === '.' || name === '..') throw new Error('agents-skills transaction journal has an unsafe temporary path');
  }
  const backup = path.join(parent, transaction.backupName);
  const stage = path.join(parent, transaction.stageName);
  if (!isInside(parent, backup) || !isInside(parent, stage)) throw new Error('agents-skills transaction path escapes its parent');
  const parentStat = lstatOrNull(parent);
  if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error('agents-skills transaction parent is not a physical directory');
  assertPhysicalAncestors(backup, 'agents-skills transaction backup', parent);
  assertPhysicalAncestors(stage, 'agents-skills transaction stage', parent);
  const oldPaths = Array.isArray(transaction.oldPaths) ? transaction.oldPaths : null;
  const newPaths = Array.isArray(transaction.newPaths) ? transaction.newPaths : null;
  if (!oldPaths || !newPaths || !['prepared', 'publishing', 'published'].includes(transaction.phase)) {
    throw new Error('agents-skills transaction journal has invalid state');
  }
  for (const relative of [...oldPaths, ...newPaths]) assertSafeRelative(relative, 'transaction path');
  return { parent, backup, stage, oldPaths, newPaths };
}

function removeTransactionFile(root, relative) {
  const target = pathInOutput(root, relative);
  const stat = lstatOrNull(target);
  if (!stat) return;
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`transaction target is not a removable file: ${relative}`);
  fs.rmSync(target, { force: true });
}

function cleanupTransactionDirectory(directory, label) {
  const stat = lstatOrNull(directory);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} is not a physical directory`);
  fs.rmSync(directory, { recursive: true, force: true });
}

function recoverProjectionTransaction(outDir) {
  const journalPath = transactionPathFor(outDir);
  const journalStat = lstatOrNull(journalPath);
  if (!journalStat) return;
  if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw new Error(`agents-skills transaction journal is not a regular file: ${journalPath}`);
  let transaction;
  try { transaction = JSON.parse(fs.readFileSync(journalPath, 'utf8')); } catch (error) { throw new Error(`agents-skills transaction journal is invalid JSON: ${error.message}`); }
  const { backup, stage, oldPaths, newPaths } = transactionPaths(outDir, transaction);
  if (transaction.phase === 'published') {
    cleanupTransactionDirectory(backup, 'agents-skills transaction backup');
    cleanupTransactionDirectory(stage, 'agents-skills transaction stage');
    fs.rmSync(journalPath, { force: true });
    return;
  }
  const oldSet = new Set(oldPaths);
  for (const relative of newPaths) {
    const backupSource = path.join(backup, relative);
    const wasMoved = Boolean(lstatOrNull(backupSource));
    if (!oldSet.has(relative) || wasMoved) removeTransactionFile(outDir, relative);
  }
  for (const relative of oldPaths) {
    const source = path.join(backup, relative);
    if (!lstatOrNull(source)) continue;
    const target = pathInOutput(outDir, relative);
    const targetStat = lstatOrNull(target);
    if (targetStat) {
      if (!targetStat.isFile() && !targetStat.isSymbolicLink()) throw new Error(`transaction restore target is not a file: ${relative}`);
      fs.rmSync(target, { force: true });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    assertPhysicalAncestors(target, 'transaction restore target', outDir);
    fs.renameSync(source, target);
  }
  removeEmptyDirectories(outDir);
  cleanupTransactionDirectory(backup, 'agents-skills transaction backup');
  cleanupTransactionDirectory(stage, 'agents-skills transaction stage');
  fs.rmSync(journalPath, { force: true });
}

function removeEmptyDirectories(root) {
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(directory, entry.name));
    }
    if (directory !== root && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  };
  walk(root);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${stableStringify(value)}\n`, { mode: 0o644 });
}

function materializeAgentsSkillsProjection({ root, inventory, outDir = path.join(root, '.agents', 'skills'), allowCanonicalChanges = false } = {}) {
  if (!root || !inventory) throw new Error('root and inventory are required');
  const sourceRoot = path.resolve(root);
  const outputRoot = path.resolve(outDir);
  assertOutputRoot(sourceRoot, outputRoot);
  ensureDirectory(outputRoot, 'agents-skills output', sourceRoot);
  recoverProjectionTransaction(outputRoot);

  const selected = selectedSkills(sourceRoot, inventory);
  const stage = fs.mkdtempSync(path.join(path.dirname(outputRoot), '.dhpk-agents-skills-build-'));
  const stageManaged = [];
  const entries = [];
  try {
    for (const skill of selected) {
      const sourceBudget = createTraversalBudget();
      const sourceFiles = collectFiles(skill.sourceDir, sourceBudget).sort((left, right) => left.relative.localeCompare(right.relative));
      const sourceFingerprint = treeFingerprint(sourceFiles, skill.sourceDir, createTraversalBudget());
      const cursorRoot = path.join(stage, skill.name);
      const copied = copyFiles(sourceFiles, skill.sourceDir, cursorRoot, createTraversalBudget());
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
      const shimPath = path.join(stage, `${skill.name}.md`);
      const shim = Buffer.from(agyShim(skill.name, parsed.values.description), 'utf8');
      fs.writeFileSync(shimPath, shim, { mode: 0o644 });
      stageManaged.push(...copied.map((file) => ({ path: `${skill.name}/${file.path}`, digest: file.digest })));
      stageManaged.push({ path: `${skill.name}.md`, digest: digest(shim) });
      entries.push({
        id: skill.id,
        name: skill.name,
        source: path.relative(sourceRoot, skill.sourceDir).split(path.sep).join('/'),
        sourceFingerprint,
        sourceFiles: copied.map((file) => ({ path: file.path, digest: file.digest })),
        cursorPath: `${skill.name}/SKILL.md`,
        agyPath: `${skill.name}.md`,
      });
    }
    stageManaged.sort((left, right) => left.path.localeCompare(right.path));
    const currentPaths = stageManaged.map((file) => file.path);
    const currentPathSet = new Set(currentPaths);
    const currentNames = new Set(entries.map((entry) => entry.name));
    const previous = readReceipt(outputRoot, selected);
    if (previous) validateExistingManagedFiles(outputRoot, previous, previous.trustedManagedPaths, selected, allowCanonicalChanges);
    const carriedEntries = previous ? previous.entries.filter((entry) => !currentNames.has(entry.name)) : [];
    const carriedPaths = previous ? previous.managedPaths.filter((relative) => !currentPathSet.has(relative)) : [];
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
        ...Object.fromEntries(stageManaged.map((file) => [file.path, file.digest])),
        ...carriedFingerprints,
      },
    };
    writeJson(path.join(stage, RECEIPT_NAME), receipt);

    const oldPaths = previous ? [...previous.trustedManagedPaths, RECEIPT_NAME] : [];
    const oldPathSet = new Set(oldPaths);
    const newPaths = [...stageManaged.map((file) => file.path), RECEIPT_NAME];
    const oldTopLevel = new Set(oldPaths.map((relative) => relative.split('/')[0]));
    for (const relative of newPaths) {
      const target = pathInOutput(outputRoot, relative);
      if (lstatOrNull(target) && !oldPathSet.has(relative)) {
        throw new Error(`generated path collides with unmanaged content: ${relative}`);
      }
      const top = relative.split('/')[0];
      if (top !== RECEIPT_NAME && lstatOrNull(path.join(outputRoot, top)) && !oldTopLevel.has(top)) {
        throw new Error(`generated skill directory collides with unmanaged content: ${top}`);
      }
    }

    const backup = fs.mkdtempSync(path.join(path.dirname(outputRoot), '.dhpk-agents-skills-backup-'));
    const journalPath = transactionPathFor(outputRoot);
    const journal = {
      schema: TRANSACTION_SCHEMA,
      outputName: path.basename(outputRoot),
      backupName: path.basename(backup),
      stageName: path.basename(stage),
      phase: 'prepared',
      oldPaths,
      newPaths,
    };
    if (lstatOrNull(journalPath)) throw new Error(`agents-skills transaction journal already exists: ${journalPath}`);
    writeAtomicJson(journalPath, journal);
    let published = false;
    try {
      journal.phase = 'publishing';
      writeAtomicJson(journalPath, journal);
      for (const relative of oldPaths) {
        const source = pathInOutput(outputRoot, relative);
        if (!lstatOrNull(source)) continue;
        const target = path.join(backup, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertPhysicalAncestors(target, 'agents-skills transaction backup target', backup);
        fs.renameSync(source, target);
      }
      removeEmptyDirectories(outputRoot);
      for (const relative of newPaths) {
        const source = path.join(stage, relative);
        const target = pathInOutput(outputRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertPhysicalAncestors(target, 'agents-skills publish target', outputRoot);
        fs.copyFileSync(source, target);
      }
      journal.phase = 'published';
      writeAtomicJson(journalPath, journal);
      published = true;
      cleanupTransactionDirectory(backup, 'agents-skills transaction backup');
      cleanupTransactionDirectory(stage, 'agents-skills transaction stage');
      fs.rmSync(journalPath, { force: true });
    } catch (error) {
      if (!published) {
        try {
          recoverProjectionTransaction(outputRoot);
        } catch (recoveryError) {
          error.message = `${error.message}; transaction recovery failed: ${recoveryError.message}`;
        }
      }
      throw error;
    }
    return {
      outputRoot,
      selectedIds: receipt.selectedIds,
      managedPaths: receipt.managedPaths,
      receipt,
    };
  } finally {
    if (!lstatOrNull(transactionPathFor(outputRoot)) && lstatOrNull(stage)) {
      cleanupTransactionDirectory(stage, 'agents-skills transaction stage');
    }
  }
}

function validateAgentsSkillsProjection({ root, inventory, outDir = path.join(root, '.agents', 'skills') } = {}) {
  const errors = [];
  const outputRoot = path.resolve(outDir);
  try {
    assertOutputRoot(path.resolve(root), outputRoot);
    const stat = lstatOrNull(outputRoot);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('projection output root is missing or unsafe');
    const selected = selectedSkills(path.resolve(root), inventory);
    const receipt = readReceipt(outputRoot, selected);
    if (!receipt) throw new Error(`projection receipt is missing: ${RECEIPT_NAME}`);
    const selectedIds = selected.map((skill) => skill.id).sort();
    if (stableStringify(receipt.selectedIds) !== stableStringify(selectedIds)) errors.push('receipt selected IDs do not match inventory selection');
    const selectedNames = new Set(selected.map((skill) => skill.name));
    const expectedCurrentPaths = expectedGeneratedPaths(selected);
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
      const sourceFiles = collectFiles(skill.sourceDir, createTraversalBudget()).sort((left, right) => left.relative.localeCompare(right.relative));
      const sourceFingerprint = treeFingerprint(sourceFiles, skill.sourceDir, createTraversalBudget());
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
      if (stat && stat.isFile() && digest(fs.readFileSync(target)) !== receipt.generatedFingerprints[relative]) {
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
  SCHEMA,
  GENERATOR_VERSION,
  RECEIPT_NAME,
  materializeAgentsSkillsProjection,
  validateAgentsSkillsProjection,
};
