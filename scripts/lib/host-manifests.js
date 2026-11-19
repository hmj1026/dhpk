'use strict';

// Single version source and generator-declared Host manifest outputs.
//
// `package.json` is the only place a maintainer edits the release version.
// Listing metadata (description, keywords, display names, and
// extensions["com.openai"].interface) lives only in
// manifests/listing-metadata.json. Every Host manifest is either written by a
// generator that declares it here or rendered from those two sources.
// Release parity (scripts/lib/release-parity.js) derives its manifest list from
// these declarations and fails on any manifest file no generator declares.

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { walkFiles, listTrackedFiles } = require('./file-tree');

const VERSION_SOURCE = 'package.json';
const LISTING_METADATA = 'manifests/listing-metadata.json';

// How the version is read from (and, for 'version-sync', written to) a file.
const READERS = Object.freeze({
  version: (data) => data.version,
  sourceVersion: (data) => data.sourceVersion,
  metadataVersion: (data) => (data.metadata || {}).version,
});

// Listing projections: how a manifest takes its listing fields from
// manifests/listing-metadata.json. Each returns the manifest with those fields
// replaced and every other field (and key order) kept.
const SHARED_LISTING_FIELDS = ['author', 'homepage', 'license'];
const PACKAGE_LISTING_FIELDS = ['displayName', 'description', 'keywords'];

function definedFields(source, names) {
  return Object.fromEntries(names.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
}

function packageListing(listing, id) {
  const entry = (listing.packages || {})[id];
  if (!entry) throw new Error(`${LISTING_METADATA}: packages.${id} is missing`);
  return entry;
}

const LISTING_PROJECTIONS = Object.freeze({
  'claude-core': (data, listing) => ({
    ...data, ...definedFields(listing, SHARED_LISTING_FIELDS), ...definedFields(packageListing(listing, 'claude-core'), PACKAGE_LISTING_FIELDS),
  }),
  'claude-stacks': (data, listing) => ({
    ...data, ...definedFields(listing, SHARED_LISTING_FIELDS), ...definedFields(packageListing(listing, 'claude-stacks'), PACKAGE_LISTING_FIELDS),
  }),
  'claude-marketplace': (data, listing) => {
    const entry = packageListing(listing, 'claude-marketplace');
    return {
      ...data,
      description: entry.description,
      owner: listing.author,
      plugins: data.plugins.map((plugin) => (entry.plugins[plugin.name] === undefined
        ? plugin : { ...plugin, description: entry.plugins[plugin.name] })),
    };
  },
});

// Generators and the manifest files each one writes. `read: null` marks a
// manifest that carries no version field but is still declared. `listing`
// names the projection that fills its listing fields from the metadata file.
const GENERATORS = Object.freeze([
  {
    id: 'version-sync',
    command: 'node scripts/ci/gen-host-manifests.js',
    outputs: [
      { path: '.claude-plugin/plugin.json', read: 'version', listing: 'claude-core' },
      { path: 'distribution/stacks-plugin/plugin.json', read: 'version', listing: 'claude-stacks' },
    ],
  },
  {
    id: 'claude-marketplace-listing',
    command: 'node scripts/ci/gen-host-manifests.js',
    outputs: [{ path: '.claude-plugin/marketplace.json', read: null, listing: 'claude-marketplace' }],
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
      { path: 'dist/claude-marketplace/package/.claude-plugin/plugin.json', read: 'version' },
      { path: 'dist/claude-marketplace/package/provenance.json', read: null },
    ],
  },
  {
    id: 'claude-stacks-package',
    command: 'node scripts/ci/gen-claude-marketplace-package.js',
    outputs: [
      { path: 'dist/claude-marketplace/stacks-package/.claude-plugin/plugin.json', read: 'version' },
      { path: 'dist/claude-marketplace/stacks-package/provenance.json', read: null },
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
]);

// Manifest file names a generator must declare when found anywhere in the tree.
const MANIFEST_BASENAMES = new Set(['plugin.json', 'marketplace.json', 'provenance.json']);
const SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', '.gitnexus', '.claude', 'tests', 'docs', 'openspec', 'changelog.d']);
// Retired outputs that may linger untracked in a working tree.
// The on-demand host packages (Agent, Cursor, AGY) are built into dist/on-demand/
// and never committed, so they declare no version-bearing manifest.
const SCAN_SKIP_PREFIXES = ['dist/claude-profiles/', 'dist/on-demand/'];

function declaredOutputs() {
  return GENERATORS.flatMap((g) => g.outputs.map((o) => ({ ...o, generator: g.id })));
}

// Version-sync outputs are patched in place; every other output is written
// wholesale by its own generator.
function versionSyncOutputs() {
  return declaredOutputs().filter((o) => o.generator === 'version-sync');
}

// Outputs gen-host-manifests keeps in sync: the version-synced manifests and
// every manifest that takes listing fields from the metadata file.
function syncedOutputs() {
  return declaredOutputs().filter((o) => o.generator === 'version-sync' || o.listing);
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

function readListingMetadata(root) {
  return JSON.parse(fs.readFileSync(path.join(root, LISTING_METADATA), 'utf8'));
}

// The manifest as it must be on disk: version from package.json, listing
// fields from the metadata file, everything else as already written.
function renderSyncedManifest(root, output, version = readSourceVersion(root)) {
  const current = JSON.parse(fs.readFileSync(path.join(root, output.path), 'utf8'));
  if (output.read !== null && output.read !== 'version') throw new Error(`${output.path}: version is not patched by version-sync`);
  const versioned = output.read === 'version' ? { ...current, version } : current;
  return output.listing ? LISTING_PROJECTIONS[output.listing](versioned, readListingMetadata(root)) : versioned;
}

// Names of the top-level fields whose on-disk value differs from the rendered one.
function syncedManifestDrift(root, output, version = readSourceVersion(root)) {
  const current = JSON.parse(fs.readFileSync(path.join(root, output.path), 'utf8'));
  const rendered = renderSyncedManifest(root, output, version);
  return [...new Set([...Object.keys(current), ...Object.keys(rendered)])]
    .filter((field) => !isDeepStrictEqual(current[field], rendered[field]));
}

function writeSyncedManifest(root, output, version = readSourceVersion(root)) {
  const rendered = renderSyncedManifest(root, output, version);
  fs.writeFileSync(path.join(root, output.path), `${JSON.stringify(rendered, null, 2)}\n`);
}

function isSkipped(rel) {
  const parts = rel.split('/');
  return parts.slice(0, -1).some((dir) => SCAN_SKIP_DIRS.has(dir) || dir.startsWith('.dhpk-test-scratch'))
    || SCAN_SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

// Fallback for a non-Git tree (fixtures): walk the filesystem.
function walkTree(root) {
  return walkFiles(root, { skipDirectory: (name) => name === '.git' || name === 'node_modules' });
}

function listManifestFiles(root, lister = (r) => listTrackedFiles(r) || walkTree(r)) {
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
  const { $schema, name, packages, ...rest } = readListingMetadata(root);
  return { ...($schema === undefined ? {} : { $schema }), name, version, ...rest };
}

module.exports = {
  VERSION_SOURCE,
  LISTING_METADATA,
  GENERATORS,
  declaredOutputs,
  versionBearingPaths,
  versionSyncOutputs,
  syncedOutputs,
  readSourceVersion,
  readDeclaredVersion,
  renderSyncedManifest,
  syncedManifestDrift,
  writeSyncedManifest,
  undeclaredManifests,
  listManifestFiles,
  renderOpenaiSubmissionManifest,
};
