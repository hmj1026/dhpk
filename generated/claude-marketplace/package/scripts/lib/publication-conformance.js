'use strict';

// Publication conformance rules for a built Published Package.  Pure: takes the
// package as a Map of relative path to Buffer so the same rules run on a
// compiled tree, an extracted ZIP, or a directory read.  Later tickets add rules.

const { findInternalPathReferences } = require('./public-plugin-paths');

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
  for (const { file, reference } of findInternalPathReferences(files)) {
    errors.push(`Public Plugin ${file} references dhpk-internal path ${reference} that a plugin-only install lacks`);
  }

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

const DIRECTORY_MANIFEST = '.claude-plugin/plugin.json';
const DIRECTORY_MIN_README_WORDS = 40;
const DIRECTORY_FORBIDDEN_PREFIXES = Object.freeze(['docs/', '.github/', 'scripts/ci/', 'scripts/release/']);
// Shared library that runtime scripts require, so it ships although it sits under scripts/ci/.
const DIRECTORY_RUNTIME_LIBRARY = 'scripts/ci/_lib/';
const DIRECTORY_URL_FIELDS = Object.freeze(['homepage', 'repository']);

const isHttpsUrl = (value) => typeof value === 'string' && /^https:\/\/\S+$/.test(value);
const wordCount = (buffer) => buffer.toString('utf8').split(/\s+/).filter(Boolean).length;

function checkDirectoryManifest(manifest, files, version, errors) {
  if (manifest.version !== version) {
    errors.push(`${DIRECTORY_MANIFEST} version ${manifest.version} must equal package.json version ${version}`);
  }
  for (const field of DIRECTORY_URL_FIELDS) {
    if (!isHttpsUrl(manifest[field])) errors.push(`${DIRECTORY_MANIFEST} must set ${field} to an https URL`);
  }
  if (typeof manifest.icon !== 'string' || manifest.icon === '') {
    errors.push(`${DIRECTORY_MANIFEST} must set icon`);
    return;
  }
  const iconPath = manifest.icon.replace(/^\.\//, '');
  if (!files.has(iconPath)) errors.push(`${DIRECTORY_MANIFEST} icon ${manifest.icon} is not in the package`);
}

// Directory Plugin: Claude package. Runtime files only, README and LICENSE
// present, manifest carries icon, repository, and URL fields.  File-count and
// file-size limits belong to a separate rule.
function checkDirectoryPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return ['Directory Plugin files must be a Map of path to Buffer'];
  const errors = [];

  for (const file of files.keys()) {
    if (file.startsWith(DIRECTORY_RUNTIME_LIBRARY)) continue;
    if (DIRECTORY_FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      errors.push(`Directory Plugin must not contain non-runtime file: ${file}`);
    }
  }

  if (!files.has('LICENSE')) errors.push('Directory Plugin is missing LICENSE');
  if (!files.has('README.md')) {
    errors.push('Directory Plugin is missing README.md');
  } else if (wordCount(files.get('README.md')) < DIRECTORY_MIN_README_WORDS) {
    errors.push(`Directory Plugin README.md must have at least ${DIRECTORY_MIN_README_WORDS} words`);
  }

  if (!files.has(DIRECTORY_MANIFEST)) {
    errors.push(`Directory Plugin is missing ${DIRECTORY_MANIFEST}`);
    return errors;
  }
  const manifest = readManifest(files, DIRECTORY_MANIFEST, errors);
  if (manifest && typeof manifest === 'object') checkDirectoryManifest(manifest, files, version, errors);
  return errors;
}

function defaultValidateRunner(directory) {
  const { spawnSync } = require('node:child_process');
  const child = spawnSync('claude', ['plugin', 'validate', '--strict', '--profile', 'directory', directory], { encoding: 'utf8' });
  if (child.error) return { error: child.error.message };
  return { status: child.status, output: `${child.stdout || ''}${child.stderr || ''}` };
}

// `claude plugin validate --strict --profile directory` on a built package
// directory.  `run` is injectable for tests; it returns { status, output }.
function runClaudeValidate(directory, run = defaultValidateRunner) {
  const result = run(directory);
  if (result.error) return [`claude plugin validate could not run: ${result.error}`];
  if (result.status !== 0) {
    return [`claude plugin validate --strict --profile directory failed (exit ${result.status}): ${result.output.trim().slice(-800)}`];
  }
  return [];
}

module.exports = { checkPublicPlugin, checkDirectoryPlugin, runClaudeValidate };
