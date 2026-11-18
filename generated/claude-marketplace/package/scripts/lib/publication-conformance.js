'use strict';

// Publication conformance rules for a built Published Package.  Pure: takes the
// package as a Map of relative path to Buffer so the same rules run on a
// compiled tree, an extracted ZIP, or a directory read.  Later tickets add rules.

const MANIFEST_PATHS = Object.freeze(['plugin.json', '.codex-plugin/plugin.json']);

function readManifest(files, manifestPath, errors) {
  if (!files.has(manifestPath)) return null;
  try {
    return JSON.parse(files.get(manifestPath).toString('utf8'));
  } catch {
    errors.push(`${manifestPath} is not valid JSON`);
    return null;
  }
}

function hookPaths(files) {
  return [...files.keys()].filter((file) => file.split('/').includes('hooks') || /(^|\/)hooks\.json$/.test(file));
}

const SHORT_DESCRIPTION_LIMIT = 30;
const TOP_LEVEL_SKILL = /^skills\/[^/]+\/SKILL\.md$/;

function listingOf(manifest) {
  const extensions = manifest && manifest.extensions;
  const openai = extensions && extensions['com.openai'];
  return (openai && openai.interface) || null;
}

function internalFileErrors(files) {
  const errors = [];
  for (const file of files.keys()) {
    if (file.split('/').pop() === 'distribution.yaml') errors.push(`Public Plugin must not contain internal distribution metadata: ${file}`);
    const nested = file.startsWith('skills/') && file.endsWith('/SKILL.md') && !TOP_LEVEL_SKILL.test(file);
    if (nested) errors.push(`Public Plugin nested reference must not be named SKILL.md: ${file}`);
  }
  return errors;
}

function frontmatterOf(buffer) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(buffer.toString('utf8'));
  return match ? match[1] : '';
}

function metadataErrors(files) {
  const errors = [];
  for (const [file, bytes] of files) {
    if (!/(^|\/)(SKILL|REFERENCE)\.md$/.test(file)) continue;
    const keys = frontmatterOf(bytes).split(/\r?\n/).map((line) => /^\s+(dhpk-[\w-]+)\s*:/.exec(line)).filter(Boolean);
    for (const [, key] of keys) errors.push(`Public Plugin ${file} must not carry ${key} metadata`);
  }
  return errors;
}

function iconErrors(listing, files) {
  const errors = [];
  for (const field of ['composerIcon', 'logo', 'composerIconDark', 'logoDark']) {
    if (!Object.prototype.hasOwnProperty.call(listing, field)) continue;
    const value = listing[field];
    if (typeof value !== 'string' || !value.startsWith('./assets/')) {
      errors.push(`Public Plugin listing ${field} must be under ./assets/ (got ${JSON.stringify(value)})`);
    } else if (!files.has(value.slice(2))) {
      errors.push(`Public Plugin listing ${field} ${value} is missing from the package`);
    }
  }
  return errors;
}

function shortDescriptionErrors(listing) {
  const value = listing.shortDescription;
  if (typeof value !== 'string' || value.trim() === '') return ['Public Plugin listing shortDescription must be a non-empty string'];
  const errors = [];
  if (Array.from(value).length > SHORT_DESCRIPTION_LIMIT) {
    errors.push(`Public Plugin listing shortDescription exceeds ${SHORT_DESCRIPTION_LIMIT} characters`);
  }
  if (/(\.\.\.|\u2026)\s*$/.test(value)) errors.push('Public Plugin listing shortDescription must not be truncated');
  return errors;
}

function countErrors(listing, files) {
  const text = listing.longDescription;
  if (typeof text !== 'string') return ['Public Plugin listing longDescription must be a string'];
  const paths = [...files.keys()];
  const actual = {
    workflows: paths.filter((file) => TOP_LEVEL_SKILL.test(file)).length,
    reference: paths.filter((file) => file.startsWith('skills/') && file.endsWith('/REFERENCE.md')).length,
  };
  const stated = {
    workflows: /(\d+)\s+(?:[\w-]+\s+){0,2}workflows/.exec(text),
    reference: /(\d+)\s+(?:[\w-]+\s+){0,2}reference resources/.exec(text),
  };
  const errors = [];
  for (const kind of ['workflows', 'reference']) {
    if (!stated[kind]) errors.push(`Public Plugin listing longDescription must state the number of ${kind}`);
    else if (Number(stated[kind][1]) !== actual[kind]) {
      errors.push(`Public Plugin listing longDescription says ${stated[kind][1]} ${kind} but the package has ${actual[kind]}`);
    }
  }
  return errors;
}

function listingErrors(manifest, files) {
  const listing = listingOf(manifest);
  if (!listing) return [];
  return [...iconErrors(listing, files), ...shortDescriptionErrors(listing), ...countErrors(listing, files)];
}

// Public Plugin: OpenAI skills-only package. No hooks; version equals package.json;
// clean review contents (no internal metadata, nested SKILL.md, icons under
// ./assets/, truthful listing text).
function checkPublicPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return ['Public Plugin files must be a Map of path to Buffer'];
  const errors = [];
  if (!files.has('plugin.json')) errors.push('Public Plugin is missing plugin.json');
  errors.push(...internalFileErrors(files), ...metadataErrors(files));

  for (const file of hookPaths(files)) errors.push(`Public Plugin must not contain hooks: ${file}`);

  for (const manifestPath of MANIFEST_PATHS) {
    const manifest = readManifest(files, manifestPath, errors);
    if (!manifest || typeof manifest !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(manifest, 'hooks')) {
      errors.push(`Public Plugin must not declare hooks in ${manifestPath}`);
    }
    if (manifestPath === 'plugin.json') errors.push(...listingErrors(manifest, files));
    if (manifest.version !== version) {
      errors.push(`${manifestPath} version ${manifest.version} must equal package.json version ${version}`);
    }
  }
  return errors;
}

module.exports = { checkPublicPlugin };
