'use strict';

// Single version source and generator-declared Host manifest outputs.
//
// `package.json` is the only place a maintainer edits the release version.
// Listing metadata (including extensions["com.openai"].interface) lives only in
// manifests/listing-metadata.json. Every Host manifest is either written by a
// generator that declares it here or rendered from those two sources.
// Release parity (scripts/lib/release-parity.js) derives its manifest list from
// these declarations and fails on any manifest file no generator declares.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VERSION_SOURCE = 'package.json';
const LISTING_METADATA = 'manifests/listing-metadata.json';

// How the version is read from (and, for 'version-sync', written to) a file.
const READERS = Object.freeze({
  version: (data) => data.version,
  sourceVersion: (data) => data.sourceVersion,
  metadataVersion: (data) => (data.metadata || {}).version,
});

// Generators and the manifest files each one writes. `read: null` marks a
// manifest that carries no version field but is still declared.
const GENERATORS = Object.freeze([
  {
    id: 'version-sync',
    command: 'node scripts/ci/gen-host-manifests.js',
    outputs: [
      { path: '.claude-plugin/plugin.json', read: 'version' },
      { path: 'distribution/stacks-plugin/plugin.json', read: 'version' },
    ],
  },
  {
    id: 'claude-marketplace-listing',
    command: 'hand-maintained marketplace descriptor (no version field)',
    outputs: [{ path: '.claude-plugin/marketplace.json', read: null }],
  },
  {
    id: 'codex-marketplace-listing',
    command: 'hand-maintained marketplace descriptor (no version field)',
    outputs: [{ path: '.agents/plugins/marketplace.json', read: null }],
  },
  {
    id: 'claude-marketplace-package',
    command: 'node scripts/ci/gen-claude-marketplace-package.js',
    outputs: [
      { path: 'generated/claude-marketplace/package/.claude-plugin/plugin.json', read: 'version' },
      { path: 'generated/claude-marketplace/package/provenance.json', read: null },
    ],
  },
  {
    id: 'claude-stacks-package',
    command: 'node scripts/ci/gen-claude-marketplace-package.js',
    outputs: [
      { path: 'generated/claude-marketplace/stacks-package/.claude-plugin/plugin.json', read: 'version' },
      { path: 'generated/claude-marketplace/stacks-package/provenance.json', read: null },
    ],
  },
  {
    id: 'codex-native-package',
    command: 'bin/dhpk distribution codex-native generate',
    outputs: [
      { path: 'plugins/dhpk/.codex-plugin/plugin.json', read: 'version' },
      { path: 'plugins/dhpk/plugin.json', read: 'version' },
      { path: 'plugins/dhpk/provenance.json', read: 'sourceVersion' },
    ],
  },
  {
    id: 'agent-plugin-package',
    command: 'bin/dhpk distribution agent-plugin generate',
    outputs: [
      { path: 'plugins/dhpk-agent/plugin.json', read: 'version' },
      { path: 'plugins/dhpk-agent/provenance.json', read: 'sourceVersion' },
    ],
  },
  {
    id: 'agy-plugin-package',
    command: 'bin/dhpk distribution agy-plugin generate',
    outputs: [
      { path: 'plugins/dhpk-agy/plugin.json', read: 'version' },
      { path: 'plugins/dhpk-agy/provenance.json', read: 'sourceVersion' },
    ],
  },
  {
    id: 'cursor-plugin-package',
    command: 'bin/dhpk distribution cursor-plugin generate',
    outputs: [
      { path: 'plugins/dhpk-cursor/.cursor-plugin/plugin.json', read: 'version' },
      { path: 'plugins/dhpk-cursor/.cursor-plugin/marketplace.json', read: 'metadataVersion' },
      { path: 'plugins/dhpk-cursor/provenance.json', read: 'sourceVersion' },
    ],
  },
]);

// Manifest file names a generator must declare when found anywhere in the tree.
const MANIFEST_BASENAMES = new Set(['plugin.json', 'marketplace.json', 'provenance.json']);
const SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', '.gitnexus', '.claude', 'tests', 'docs', 'openspec', 'changelog.d']);
// Retired outputs that may linger untracked in a working tree.
const SCAN_SKIP_PREFIXES = ['generated/claude-profiles/'];

function declaredOutputs() {
  return GENERATORS.flatMap((g) => g.outputs.map((o) => ({ ...o, generator: g.id })));
}

// Version-sync outputs are patched in place; every other output is written
// wholesale by its own generator.
function versionSyncOutputs() {
  return declaredOutputs().filter((o) => o.generator === 'version-sync');
}

// Declared manifests that carry a version, plus the version source itself.
function versionBearingPaths() {
  return [...declaredOutputs().filter((o) => o.read).map((o) => o.path), VERSION_SOURCE];
}

function readSourceVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, VERSION_SOURCE), 'utf8')).version;
}

function readDeclaredVersion(root, output) {
  const data = JSON.parse(fs.readFileSync(path.join(root, output.path), 'utf8'));
  return READERS[output.read](data);
}

function writeDeclaredVersion(root, output, version) {
  const abs = path.join(root, output.path);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (output.read === 'version') {
    data.version = version;
  } else {
    throw new Error(`${output.path}: version is not patched by version-sync`);
  }
  fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
}

function isSkipped(rel) {
  const parts = rel.split('/');
  return parts.slice(0, -1).some((dir) => SCAN_SKIP_DIRS.has(dir) || dir.startsWith('.dhpk-test-scratch'))
    || SCAN_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

// Git-tracked files when root is itself a Git checkout, so gitignored local
// artifacts never count; null when root is not a checkout root.
function listTrackedFiles(root) {
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(root)) return null;
  const res = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) return null;
  return res.stdout.split('\0').filter(Boolean);
}

// Fallback for a non-Git tree (fixtures): walk the filesystem.
function walkFiles(root) {
  const found = [];
  const visit = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') visit(path.join(dir, entry.name), childRel);
      }
      else if (entry.isFile()) found.push(childRel);
    }
  };
  visit(root, '');
  return found;
}

function listManifestFiles(root, lister = (r) => listTrackedFiles(r) || walkFiles(r)) {
  return lister(root)
    .filter((rel) => MANIFEST_BASENAMES.has(path.posix.basename(rel)) && !isSkipped(rel))
    .sort();
}

function undeclaredManifests(root) {
  const declared = new Set(declaredOutputs().map((o) => o.path));
  return listManifestFiles(root).filter((rel) => !declared.has(rel));
}

// The OpenAI submission manifest is rendered, never hand-written: listing
// metadata from its single source file, version from package.json.
function renderOpenaiSubmissionManifest(root, version = readSourceVersion(root)) {
  const listing = JSON.parse(fs.readFileSync(path.join(root, LISTING_METADATA), 'utf8'));
  const { $schema, name, ...rest } = listing;
  return { ...($schema === undefined ? {} : { $schema }), name, version, ...rest };
}

module.exports = {
  VERSION_SOURCE,
  LISTING_METADATA,
  GENERATORS,
  declaredOutputs,
  versionBearingPaths,
  versionSyncOutputs,
  readSourceVersion,
  readDeclaredVersion,
  writeDeclaredVersion,
  undeclaredManifests,
  listManifestFiles,
  renderOpenaiSubmissionManifest,
};
