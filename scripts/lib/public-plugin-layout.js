'use strict';

// Public Plugin layout cleanup (#1497). Turns the bundled skill content into
// what the OpenAI review sees: no internal distribution metadata, nested
// reference entry files that no longer pose as skills, the listing icon under
// ./assets/, and listing counts taken from the catalog. The transform lives in
// the build only; canonical skill sources are never edited.

const path = require('node:path');

const REFERENCE_ENTRY = 'REFERENCE.md';
const ASSETS_DIR = 'assets';
const ICON_FIELDS = Object.freeze(['composerIcon', 'logo', 'composerIconDark', 'logoDark']);
const TOP_LEVEL_SKILL_MARKDOWN = /^skills\/[^/]+\/SKILL\.md$/;
// A bare SKILL.md mention (not part of a longer path such as skills/php/SKILL.md).
const BARE_SKILL_MARKDOWN = /(?<![\w/.-])SKILL\.md/g;

const isInternalMetadataFile = (file) => path.posix.basename(file) === 'distribution.yaml';
const isNestedSkillMarkdown = (file) => file.startsWith('skills/') && file.endsWith('/SKILL.md') && !TOP_LEVEL_SKILL_MARKDOWN.test(file);

function renamedReferenceDirs(files) {
  return files.filter((file) => isNestedSkillMarkdown(file.path)).map((file) => path.posix.dirname(file.path));
}

function insideAny(file, dirs) {
  return dirs.some((dir) => file.startsWith(`${dir}/`));
}

function renameReferenceEntry(file, dirs) {
  const renamed = isNestedSkillMarkdown(file.path)
    ? path.posix.join(path.posix.dirname(file.path), REFERENCE_ENTRY)
    : file.path;
  const isText = file.path.endsWith('.md') && insideAny(file.path, dirs);
  const bytes = isText
    ? Buffer.from(Buffer.from(file.bytes).toString('utf8').replace(BARE_SKILL_MARKDOWN, REFERENCE_ENTRY), 'utf8')
    : file.bytes;
  return { ...file, path: renamed, bytes };
}

function iconSourcePaths(listing) {
  return ICON_FIELDS
    .filter((field) => typeof listing[field] === 'string' && listing[field].startsWith('./skills/'))
    .map((field) => ({ field, source: listing[field].slice(2) }));
}

// Moves each listing icon from its owning skill to ./assets/ and returns the
// listing with rewritten paths. Errors on a basename collision.
function relocateListingIcons(files, listing) {
  const errors = [];
  const moves = iconSourcePaths(listing);
  const destinations = new Map();
  for (const { source } of moves) {
    const destination = `${ASSETS_DIR}/${path.posix.basename(source)}`;
    if (destinations.has(destination) && destinations.get(destination) !== source) {
      errors.push(`listing icons ${destinations.get(destination)} and ${source} collide at ${destination}`);
    }
    destinations.set(destination, source);
  }
  const sources = new Set(destinations.values());
  const assetFiles = [];
  for (const [destination, source] of destinations) {
    const found = files.find((file) => file.path === source);
    if (!found) errors.push(`listing icon ${source} is not in the Public Plugin content`);
    else assetFiles.push({ ...found, path: destination, kind: 'listing-asset', ownerId: null });
  }
  const rewritten = { ...listing };
  for (const { field, source } of moves) rewritten[field] = `./${ASSETS_DIR}/${path.posix.basename(source)}`;
  return { errors, assetFiles, files: files.filter((file) => !sources.has(file.path)), listing: rewritten };
}

function fillListingCounts(listing, counts) {
  const tokens = { workflowCount: counts.workflowCount, referenceCount: counts.referenceCount };
  const filled = typeof listing.longDescription === 'string'
    ? listing.longDescription.replace(/\{(\w+)\}/g, (match, key) => (key in tokens ? String(tokens[key]) : match))
    : listing.longDescription;
  const errors = typeof filled === 'string' && /\{\w+\}/.test(filled)
    ? ['OpenAI interface longDescription has an unresolved count token']
    : [];
  return { errors, listing: { ...listing, longDescription: filled } };
}

function withListing(manifest, listing) {
  const extensions = manifest.extensions || {};
  const openai = extensions['com.openai'] || {};
  return { ...manifest, extensions: { ...extensions, 'com.openai': { ...openai, interface: listing } } };
}

// content files already carry normalized SKILL.md bytes. Returns
// { ok, errors, files, assetFiles, manifest } with every path in its final place.
function layoutPublicPlugin({ files, manifest, counts }) {
  const listing = manifest && manifest.extensions && manifest.extensions['com.openai']
    && manifest.extensions['com.openai'].interface;
  if (!listing) return { ok: false, errors: ['Public Plugin manifest has no OpenAI listing interface'], files: [], assetFiles: [], manifest };

  const kept = files.filter((file) => !isInternalMetadataFile(file.path));
  const dirs = renamedReferenceDirs(kept);
  const renamed = kept.map((file) => renameReferenceEntry(file, dirs));
  const icons = relocateListingIcons(renamed, listing);
  const counted = fillListingCounts(icons.listing, counts);
  const errors = [...icons.errors, ...counted.errors];
  if (errors.length > 0) return { ok: false, errors, files: [], assetFiles: [], manifest };
  return { ok: true, errors: [], files: icons.files, assetFiles: icons.assetFiles, manifest: withListing(manifest, counted.listing) };
}

module.exports = {
  REFERENCE_ENTRY,
  ASSETS_DIR,
  isInternalMetadataFile,
  isNestedSkillMarkdown,
  layoutPublicPlugin,
};
