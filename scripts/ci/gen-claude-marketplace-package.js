#!/usr/bin/env node
'use strict';

// Materialize the Claude marketplace package from the canonical plugin tree.
// The repository root is an authoring checkout and contains project-level
// CLAUDE.md instructions; it is deliberately not part of this package.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isInside } = require('../lib/bounded-filesystem');
const { sha256Hex } = require('../lib/content-fingerprint');
const { createDistributionPlan } = require('../lib/distribution-projection-contract');
const { ProjectionArtifactStore } = require('../lib/projection-artifact-store');
const { loadMarketplaceHostPublication } = require('../lib/marketplace-host-publication');
const { compileMarketplaceSkillContent } = require('../lib/marketplace-skill-content');
const { selectRuntimeFiles, stackSkillDestination } = require('../lib/directory-plugin-runtime');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'generated', 'claude-marketplace', 'package');
const DEFAULT_STACKS_OUTPUT = path.join(ROOT, 'generated', 'claude-marketplace', 'stacks-package');
const PROVENANCE_SCHEMA = 'dhpk.claude-marketplace-catalog.v1';
const STACKS_PROVENANCE_SCHEMA = 'dhpk.claude-stacks-package.v1';
const PACKAGE_PATHS = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/icon.png',
  'agent-traps',
  'agents',
  'hooks',
  'manifests',
  'rules',
  'scripts',
  'skills',
  'templates',
];

// Files the Directory Plugin adds at its root: [destination, source in the checkout].
const DIRECTORY_ROOT_FILES = [
  ['README.md', 'distribution/directory-plugin/README.md'],
  ['LICENSE', 'LICENSE'],
];

// dhpk-stacks ships the stack modules plus its own manifest, hooks, and README.
// STACKS_SOURCE holds the files that exist only in this package.
const STACKS_SOURCE = 'distribution/stacks-plugin';
const STACKS_PACKAGE_PATHS = ['modules'];
const STACKS_ROOT_FILES = [
  ['.claude-plugin/plugin.json', `${STACKS_SOURCE}/plugin.json`],
  ['.claude-plugin/icon.png', '.claude-plugin/icon.png'],
  ['hooks/hooks.json', `${STACKS_SOURCE}/hooks/hooks.json`],
  ['scripts/hooks/stacks-pre-bash-dispatch.sh', `${STACKS_SOURCE}/scripts/hooks/stacks-pre-bash-dispatch.sh`],
  ['scripts/hooks/stacks-session-start.sh', `${STACKS_SOURCE}/scripts/hooks/stacks-session-start.sh`],
  ['README.md', `${STACKS_SOURCE}/README.md`],
  ['LICENSE', 'LICENSE'],
];
// Core hook libraries the module hooks source through ../../../scripts/hooks/_lib.
// Each package resolves its own copy; the stacks package never reads the core cache.
const STACKS_SHARED_HOOK_LIBS = [
  'activate-modules.py',
  'command-inspect.sh', 'command-inspect-api.sh', 'command-inspect-fn.sh',
  'command-inspect-scan.sh', 'command-inspect-unwrap.sh',
  'load-project-config.sh', 'modules.sh', 'payload.sh', 'plugin-root.sh',
  'portable-timeout.sh', 'runtime-config.sh', 'session-env.sh',
];

function usage() {
  console.error('usage: node scripts/ci/gen-claude-marketplace-package.js [--out <directory>] [--stacks-out <directory>] [--check]');
  console.error('  Without --out or --stacks-out, both the core and the dhpk-stacks package are processed at their default paths.');
}

function parseArgs(argv) {
  const args = { out: null, stacksOut: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') args.check = true;
    else if (arg === '--out' || arg === '--stacks-out') {
      const value = argv[++index];
      if (!value) return { error: `${arg} requires a directory` };
      args[arg === '--out' ? 'out' : 'stacksOut'] = value;
    } else if (arg.startsWith('--out=') && arg.length > 6) args.out = arg.slice('--out='.length);
    else if (arg.startsWith('--stacks-out=') && arg.length > 13) args.stacksOut = arg.slice('--stacks-out='.length);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  if (args.out === null && args.stacksOut === null) return { ...args, out: DEFAULT_OUTPUT, stacksOut: DEFAULT_STACKS_OUTPUT };
  return args;
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
  const roots = ['docs', 'agents', 'rules', 'templates'];
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
      sha256: sha256Hex(file.bytes),
    })),
  }, null, 2)}\n`;
}

function planOutputs(outputs) {
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

// Compile the package into planned outputs: every rewrite is applied before
// the output is handed to the store, and provenance.json is a planned output.
function compileSkillContent(sourceRoot) {
  const inventoryPath = path.join(sourceRoot, 'manifests/distribution-inventory.json');
  const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) : null;
  const publicationView = inventory
    ? loadMarketplaceHostPublication({ root: sourceRoot, inventory, hostSurface: 'claude-core' }) : null;
  // docs/ never ships in the Directory Plugin; only rules/ is a retained host resource.
  const retainedHostResourcePaths = new Set(['rules']);
  const content = publicationView
    ? compileMarketplaceSkillContent({ root: sourceRoot, inventory, publicationView, retainedHostResourcePaths }) : null;
  if (content && !content.ok) throw new Error(content.errors.join('; '));
  return { publicationView, content };
}

function planCanonicalTree(root) {
  const sourceRoot = fs.realpathSync(root);
  const { publicationView, content } = compileSkillContent(sourceRoot);
  const files = new Map();
  for (const relative of PACKAGE_PATHS) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`canonical Claude package source is missing: ${relative}`);
    if (relative === 'skills' && content) {
      for (const file of content.files) addFile(files, file.path, Buffer.from(file.bytes), (file.mode & 0o111) !== 0);
    } else collectPhysicalEntry(source, relative, sourceRoot, files);
  }
  if (content) relocateText(files, content);
  const runtime = selectRuntimeFiles(files);
  for (const [destination, source] of DIRECTORY_ROOT_FILES) {
    addFile(runtime, destination, fs.readFileSync(path.join(sourceRoot, source)), false);
  }
  if (content) {
    addFile(runtime, 'provenance.json', Buffer.from(provenanceDocument(publicationView, content)), false);
  }
  return planOutputs([...runtime.values()]);
}

function stacksProvenanceDocument(runtime) {
  return `${JSON.stringify({
    schema: STACKS_PROVENANCE_SCHEMA,
    files: [...runtime.keys()].sort().map((destination) => ({
      destination, sha256: sha256Hex(runtime.get(destination).content),
    })),
  }, null, 2)}\n`;
}

// The stack skills ($swift, $php, ...) are compiled with the core skills, then
// taken out of flow-drive's reference tree and placed as top-level skills so
// Claude discovers them in dhpk-stacks.
function addStackSkills(files, sourceRoot) {
  const { content } = compileSkillContent(sourceRoot);
  if (!content) throw new Error('dhpk-stacks needs the distribution inventory to compile its stack skills');
  for (const file of content.files) {
    const destination = stackSkillDestination(file.path);
    if (destination) addFile(files, destination, Buffer.from(file.bytes), (file.mode & 0o111) !== 0);
  }
}

// The dhpk-stacks package: stack modules, its own manifest and hooks, and the
// core hook libraries those modules source.  Plans like the core package.
function planStacksTree(root) {
  const sourceRoot = fs.realpathSync(root);
  const files = new Map();
  for (const relative of STACKS_PACKAGE_PATHS) {
    const source = path.join(sourceRoot, relative);
    if (!fs.existsSync(source)) throw new Error(`canonical dhpk-stacks package source is missing: ${relative}`);
    collectPhysicalEntry(source, relative, sourceRoot, files);
  }
  addStackSkills(files, sourceRoot);
  for (const [destination, source] of STACKS_ROOT_FILES) {
    const absolute = path.join(sourceRoot, source);
    if (!fs.existsSync(absolute)) throw new Error(`canonical dhpk-stacks package source is missing: ${source}`);
    addFile(files, destination, fs.readFileSync(absolute), (fs.statSync(absolute).mode & 0o111) !== 0);
  }
  for (const library of STACKS_SHARED_HOOK_LIBS) {
    const source = `scripts/hooks/_lib/${library}`;
    const absolute = path.join(sourceRoot, source);
    if (!fs.existsSync(absolute)) throw new Error(`canonical dhpk-stacks package source is missing: ${source}`);
    addFile(files, source, fs.readFileSync(absolute), (fs.statSync(absolute).mode & 0o111) !== 0);
  }
  const runtime = selectRuntimeFiles(files);
  addFile(runtime, 'provenance.json', Buffer.from(stacksProvenanceDocument(runtime)), false);
  return planOutputs([...runtime.values()]);
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

function verifyStacksOwnership(existingRoot) {
  if (fs.readdirSync(existingRoot).length === 0) return { ok: true };
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(path.join(existingRoot, 'provenance.json'), 'utf8')); } catch { /* reported below */ }
  return recorded && recorded.schema === STACKS_PROVENANCE_SCHEMA
    ? { ok: true }
    : { ok: false, code: 'FOREIGN_OWNER', message: 'existing tree is not a generated dhpk-stacks package' };
}

// The two Claude packages differ only in how they are planned, who owns an
// existing output directory, and which source paths an output must not overlap.
const PACKAGES = {
  core: { plan: planCanonicalTree, verifyOwner: verifyPackageOwnership, sourcePaths: PACKAGE_PATHS },
  stacks: { plan: planStacksTree, verifyOwner: verifyStacksOwnership, sourcePaths: [...STACKS_PACKAGE_PATHS, STACKS_SOURCE] },
};

function publishPackage({ root, storeRoot, publishRoot, kind = 'core' }) {
  const { plan, outputs } = PACKAGES[kind].plan(root);
  const store = new ProjectionArtifactStore({
    root: storeRoot, sourceRoot: fs.realpathSync(root), publishRoot,
    ownership: { verify: PACKAGES[kind].verifyOwner },
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

function assertSafeOutput(root, output, kind = 'core') {
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
  for (const relative of PACKAGES[kind].sourcePaths) {
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
        return [`F:${childRelative}:${sha256Hex(fs.readFileSync(child))}\n`];
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

function materialize({ root = ROOT, out = DEFAULT_OUTPUT, kind = 'core' } = {}) {
  const output = path.resolve(out);
  assertSafeOutput(root, output, kind);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  publishPackage({ root, storeRoot: parent, publishRoot: output, kind });
  assertPhysicalPackage(output);
  return { output, fingerprint: fingerprint(output) };
}

function check({ root = ROOT, out = DEFAULT_OUTPUT, kind = 'core' } = {}) {
  const output = path.resolve(out);
  if (!fs.existsSync(output)) return { ok: false, error: `generated Claude marketplace package is missing: ${output}` };
  const parent = fs.realpathSync(path.dirname(output));
  const temporary = temporaryPackage(parent);
  try {
    const expectedRoot = path.join(temporary, 'package');
    publishPackage({ root, storeRoot: temporary, publishRoot: expectedRoot, kind });
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

function targets(args) {
  return [
    ...(args.out ? [{ kind: 'core', out: args.out }] : []),
    ...(args.stacksOut ? [{ kind: 'stacks', out: args.stacksOut }] : []),
  ];
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { usage(); return 0; }
  if (args.error) { console.error(`FAIL [gen-claude-marketplace-package]: ${args.error}`); usage(); return 2; }
  try {
    let status = 0;
    for (const target of targets(args)) {
      if (args.check) {
        const result = check(target);
        if (!result.ok) {
          console.error(`FAIL [gen-claude-marketplace-package]: ${result.error}`);
          status = 1;
        } else console.log(`PASS [gen-claude-marketplace-package]: ${result.output}`);
      } else {
        const result = materialize(target);
        console.log(JSON.stringify({ output: result.output, fingerprint: result.fingerprint }, null, 2));
      }
    }
    return status;
  } catch (error) {
    console.error(`FAIL [gen-claude-marketplace-package]: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_OUTPUT,
  DEFAULT_STACKS_OUTPUT,
  PACKAGE_PATHS,
  STACKS_SHARED_HOOK_LIBS,
  check,
  // Host Adapter contract names: compile = plan the canonical tree, verify = check.
  compileClaudeMarketplacePackage: ({ root = ROOT } = {}) => planCanonicalTree(root),
  compileStacksPackage: ({ root = ROOT } = {}) => planStacksTree(root),
  verifyClaudeMarketplacePackage: check,
  fingerprint,
  main,
  materialize,
};
