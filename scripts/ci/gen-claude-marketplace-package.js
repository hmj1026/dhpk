#!/usr/bin/env node
'use strict';

// Materialize the Claude marketplace package from the canonical plugin tree.
// The repository root is an authoring checkout and contains project-level
// CLAUDE.md instructions; it is deliberately not part of this package.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createDistributionPlan } = require('../lib/distribution-projection-contract');
const { ProjectionArtifactStore } = require('../lib/projection-artifact-store');
const { loadMarketplaceHostPublication } = require('../lib/marketplace-host-publication');
const { compileMarketplaceSkillContent } = require('../lib/marketplace-skill-content');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'generated', 'claude-marketplace', 'package');
const PROVENANCE_SCHEMA = 'dhpk.claude-marketplace-catalog.v1';
const PACKAGE_PATHS = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/icon.png',
  'agent-traps',
  'agents',
  'commands',
  'docs',
  'hooks',
  'manifests',
  'modules',
  'rules',
  'scripts',
  'skills',
  'templates',
];

function usage() {
  console.error('usage: node scripts/ci/gen-claude-marketplace-package.js [--out <directory>] [--check]');
}

function parseArgs(argv) {
  const args = { out: DEFAULT_OUTPUT, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.check = true;
    else if (arg === '--out') args.out = argv[++index] || null;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  if (!args.out) return { error: '--out requires a directory' };
  return args;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isTransientEntry(name, entry) {
  return (entry.isDirectory() && name === '__pycache__')
    || (entry.isFile() && (name === '.DS_Store' || /\.py[co]$/.test(name)));
}

function validateTransientTree(source, root) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    if (!isInside(root, fs.realpathSync(source))) {
      throw new Error(`canonical Claude package symlink escapes the source root: ${source}`);
    }
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) validateTransientTree(path.join(source, entry), root);
  } else if (!stat.isFile()) {
    throw new Error(`canonical Claude package source is not a regular file: ${source}`);
  }
}

// Collect package files in memory as { destination, content, mode }.  Later
// writers win, which keeps the compiled skill tree authoritative over a plain
// copy of the same path.
function addFile(files, destination, content, executable) {
  files.set(destination, { destination, content, mode: executable ? 0o755 : 0o644 });
}

function collectPhysicalEntry(source, destination, root, files) {
  const relative = path.relative(root, source).split(path.sep).join('/');
  if (['docs/design', 'docs/evidence', 'docs/knowledge'].some((local) =>
    relative === local || relative.startsWith(`${local}/`))) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(source);
    if (!isInside(root, resolved)) throw new Error(`canonical Claude package symlink escapes the source root: ${source}`);
    collectPhysicalEntry(resolved, destination, root, files);
    return;
  }
  if (isTransientEntry(path.basename(source), stat)) {
    if (stat.isDirectory()) validateTransientTree(source, root);
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source)) {
      collectPhysicalEntry(path.join(source, entry), `${destination}/${entry}`, root, files);
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`canonical Claude package source is not a regular file: ${source}`);
  addFile(files, destination, fs.readFileSync(source), (stat.mode & 0o111) !== 0);
}

function relocateText(files, content) {
  const relocations = content.files
    .filter((file) => file.kind !== 'dependency' && file.sourcePath.endsWith('/SKILL.md'))
    .map((file) => ({ source: file.sourcePath.slice(0, -9), destination: file.path.slice(0, -9) }))
    .filter((entry) => entry.source !== entry.destination)
    .sort((left, right) => right.source.length - left.source.length);
  const roots = ['commands', 'docs', 'agents', 'rules', 'templates'];
  for (const [destination, file] of files) {
    if (!destination.endsWith('.md') || !roots.some((root) => destination.startsWith(`${root}/`))) continue;
    const original = file.content.toString('utf8');
    const rewritten = relocations.reduce((body, relocation) => {
      const escaped = relocation.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return body.replace(new RegExp(`${escaped}(?=/)`, 'g'), relocation.destination);
    }, original);
    if (rewritten !== original) files.set(destination, { ...file, content: Buffer.from(rewritten) });
  }
}

function provenanceDocument(publicationView, content) {
  return `${JSON.stringify({
    schema: PROVENANCE_SCHEMA,
    selectionDigest: publicationView.selectionDigest,
    publicEntryIds: publicationView.publicEntries.map((entry) => entry.id),
    hostOnlyIds: publicationView.hostOnly.map((entry) => entry.id),
    files: content.files.map((file) => ({
      skillId: file.skillId, ownerId: file.ownerId, sourcePath: file.sourcePath,
      destination: file.path, kind: file.kind,
      sha256: crypto.createHash('sha256').update(file.bytes).digest('hex'),
    })),
  }, null, 2)}\n`;
}

// Compile the package into planned outputs: every rewrite is applied before
// the output is handed to the store, and provenance.json is a planned output.
function planCanonicalTree(root) {
  const sourceRoot = fs.realpathSync(root);
  const inventoryPath = path.join(sourceRoot, 'manifests/distribution-inventory.json');
  const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) : null;
  const publicationView = inventory
    ? loadMarketplaceHostPublication({ root: sourceRoot, inventory, hostSurface: 'claude-core' }) : null;
  const retainedHostResourcePaths = new Set(['rules']);
  const collectRetainedDocs = (directory, relative = 'docs') => {
    if (['docs/design', 'docs/evidence', 'docs/knowledge'].includes(relative)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const childRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) collectRetainedDocs(child, childRelative);
      else if (entry.isFile()) retainedHostResourcePaths.add(childRelative);
    }
  };
  if (publicationView) collectRetainedDocs(path.join(sourceRoot, 'docs'));
  const content = publicationView
    ? compileMarketplaceSkillContent({ root: sourceRoot, inventory, publicationView, retainedHostResourcePaths }) : null;
  if (content && !content.ok) throw new Error(content.errors.join('; '));
  const files = new Map();
  for (const relative of PACKAGE_PATHS) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`canonical Claude package source is missing: ${relative}`);
    if (relative === 'skills' && content) {
      for (const file of content.files) addFile(files, file.path, Buffer.from(file.bytes), (file.mode & 0o111) !== 0);
    } else collectPhysicalEntry(source, relative, sourceRoot, files);
  }
  if (content) {
    relocateText(files, content);
    addFile(files, 'provenance.json', Buffer.from(provenanceDocument(publicationView, content)), false);
  }
  const outputs = [...files.values()];
  const planned = createDistributionPlan({
    surface: 'claude-marketplace',
    entries: outputs.map((output) => ({
      stableId: output.destination, source: output.destination, destination: output.destination,
      mode: output.mode, owner: 'claude-marketplace',
    })),
  });
  if (!planned.ok) throw new Error(planned.error.message);
  return { plan: planned.value, outputs };
}

// Ownership proof for replacing an existing package: the generated
// provenance.json schema.  A package built without an inventory has no
// receipt, so its plugin manifest is the only marker it carries.
function verifyPackageOwnership(existingRoot) {
  // A pre-created empty package directory holds nothing to lose.
  if (fs.readdirSync(existingRoot).length === 0) return { ok: true };
  const receipt = path.join(existingRoot, 'provenance.json');
  if (fs.existsSync(receipt)) {
    let recorded = null;
    try { recorded = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch { /* reported below */ }
    return recorded && recorded.schema === PROVENANCE_SCHEMA
      ? { ok: true }
      : { ok: false, code: 'FOREIGN_OWNER', message: 'existing provenance.json is not a Claude marketplace package receipt' };
  }
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(existingRoot, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { /* reported below */ }
  return manifest && manifest.name === 'dhpk'
    ? { ok: true }
    : { ok: false, code: 'NO_OWNER_RECEIPT', message: 'existing tree is not a generated Claude marketplace package' };
}

function publishPackage({ root, storeRoot, publishRoot }) {
  const { plan, outputs } = planCanonicalTree(root);
  const store = new ProjectionArtifactStore({
    root: storeRoot, sourceRoot: fs.realpathSync(root), publishRoot,
    ownership: { verify: verifyPackageOwnership },
  });
  const session = store.begin(plan);
  try {
    for (const output of outputs) {
      session.write({ stableId: output.destination, destination: output.destination, content: output.content, mode: output.mode });
    }
    return session.publish();
  } catch (error) {
    session.abort();
    throw error;
  }
}

function assertSafeOutput(root, output) {
  const sourceRoot = fs.realpathSync(root);
  let outputPath = path.resolve(output);
  const missing = [];
  while (!fs.existsSync(outputPath)) {
    const parent = path.dirname(outputPath);
    if (parent === outputPath) break;
    missing.unshift(path.basename(outputPath));
    outputPath = parent;
  }
  outputPath = path.join(fs.realpathSync(outputPath), ...missing);
  for (const relative of PACKAGE_PATHS) {
    const sourcePath = path.resolve(sourceRoot, relative);
    if (isInside(outputPath, sourcePath) || isInside(sourcePath, outputPath)) {
      throw new Error(`generated Claude marketplace output overlaps canonical source path: ${outputPath}`);
    }
  }
}

function fingerprint(directory) {
  const hash = crypto.createHash('sha256');
  const walk = (current, relative = '') => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const records = entries.flatMap((entry) => {
      if (isTransientEntry(entry.name, entry)) return [];
      const child = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        const content = walk(child, childRelative);
        // The store publishes files only, so a package root is recorded when it
        // holds content; a genuinely empty directory is still an extra.
        return content.retained ? [`D:${childRelative}\n`, ...content.records] : [];
      } else if (entry.isFile()) {
        return [`F:${childRelative}:${crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex')}\n`];
      } else {
        throw new Error(`Claude marketplace package contains an unsupported entry: ${childRelative}`);
      }
    });
    // Keep genuine empty directories; omit only branches emptied by filtering.
    return { records, retained: entries.length === 0 || records.length > 0 };
  };
  for (const record of walk(directory).records) hash.update(record);
  return hash.digest('hex');
}

function assertPhysicalPackage(output) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Claude marketplace package contains a symlink: ${path.relative(output, child)}`);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(output);
}

function temporaryPackage(parent) {
  return fs.mkdtempSync(path.join(parent, '.dhpk-claude-marketplace-'));
}

function materialize({ root = ROOT, out = DEFAULT_OUTPUT } = {}) {
  const output = path.resolve(out);
  assertSafeOutput(root, output);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  publishPackage({ root, storeRoot: parent, publishRoot: output });
  assertPhysicalPackage(output);
  return { output, fingerprint: fingerprint(output) };
}

function check({ root = ROOT, out = DEFAULT_OUTPUT } = {}) {
  const output = path.resolve(out);
  if (!fs.existsSync(output)) return { ok: false, error: `generated Claude marketplace package is missing: ${output}` };
  const parent = fs.realpathSync(path.dirname(output));
  const temporary = temporaryPackage(parent);
  try {
    const expectedRoot = path.join(temporary, 'package');
    publishPackage({ root, storeRoot: temporary, publishRoot: expectedRoot });
    assertPhysicalPackage(expectedRoot);
    assertPhysicalPackage(output);
    const expected = fingerprint(expectedRoot);
    const actual = fingerprint(output);
    return expected === actual
      ? { ok: true, output, fingerprint: actual }
      : { ok: false, output, expected, actual, error: 'generated Claude marketplace package is out of date' };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }
  if (args.error) { console.error(`FAIL [gen-claude-marketplace-package]: ${args.error}`); usage(); return 2; }
  try {
    if (args.check) {
      const result = check({ out: args.out });
      if (!result.ok) {
        console.error(`FAIL [gen-claude-marketplace-package]: ${result.error}`);
        return 1;
      }
      console.log(`PASS [gen-claude-marketplace-package]: ${result.output}`);
      return 0;
    }
    const result = materialize({ out: args.out });
    console.log(JSON.stringify({ output: result.output, fingerprint: result.fingerprint }, null, 2));
    return 0;
  } catch (error) {
    console.error(`FAIL [gen-claude-marketplace-package]: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_OUTPUT,
  PACKAGE_PATHS,
  check,
  // Host Adapter contract names: compile = plan the canonical tree, verify = check.
  compileClaudeMarketplacePackage: ({ root = ROOT } = {}) => planCanonicalTree(root),
  verifyClaudeMarketplacePackage: check,
  fingerprint,
  main,
  materialize,
};
