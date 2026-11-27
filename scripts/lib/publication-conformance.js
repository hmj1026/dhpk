'use strict';

// Publication conformance rules for a built Published Package.  Pure: takes the
// package as a Map of relative path to Buffer so the same rules run on a
// compiled tree, an extracted ZIP, or a directory read.  Later tickets add rules.

const { findInternalPathReferences } = require('./public-plugin-paths');
const { unquote } = require('./agent-frontmatter');

const MANIFEST_PATHS = Object.freeze(['plugin.json', '.codex-plugin/plugin.json']);
const CLAUDE_VALIDATE_TIMEOUT_MS = 120000;

// Parsed JSON of a package file, or null when it is absent or invalid (the
// invalid case adds an error, prefixed with `label` when one is given).
function readJsonFile(files, file, errors, label = '') {
  if (!files.has(file)) return null;
  try {
    return JSON.parse(files.get(file).toString('utf8'));
  } catch {
    errors.push(`${label ? `${label} ` : ''}${file} is not valid JSON`);
    return null;
  }
}

// Raw text of a Markdown frontmatter block, or null when the file has none.
function frontmatterBlock(buffer) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  return match ? match[1] : null;
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

function metadataErrors(files) {
  const errors = [];
  for (const [file, bytes] of files) {
    if (!/(^|\/)(SKILL|REFERENCE)\.md$/.test(file)) continue;
    const keys = (frontmatterBlock(bytes) || '').split(/\r?\n/).map((line) => /^\s+(dhpk-[\w-]+)\s*:/.exec(line)).filter(Boolean);
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
    const manifest = readJsonFile(files, manifestPath, errors);
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
// Claude holds a package over 512 files, or with a non-image file over 256 KiB, for manual review.
const DIRECTORY_MAX_FILES = 512;
const DIRECTORY_MAX_FILE_BYTES = 256 * 1024;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp)$/i;
const DIRECTORY_URL_FIELDS = Object.freeze(['homepage', 'repository']);

function sizeErrors(files) {
  const errors = [];
  if (files.size > DIRECTORY_MAX_FILES) {
    errors.push(`Directory Plugin has ${files.size} files; Claude holds packages over ${DIRECTORY_MAX_FILES} files for review`);
  }
  for (const [file, bytes] of files) {
    if (!IMAGE_FILE.test(file) && bytes.length > DIRECTORY_MAX_FILE_BYTES) {
      errors.push(`Directory Plugin non-image file ${file} is ${bytes.length} bytes; Claude holds files over 256 KiB for review`);
    }
  }
  return errors;
}

const isHttpsUrl = (value) => typeof value === 'string' && /^https:\/\/\S+$/.test(value);
const wordCount = (buffer) => buffer.toString('utf8').split(/\s+/).filter(Boolean).length;

function checkDirectoryManifest(manifest, files, version) {
  const errors = [];
  if (manifest.version !== version) {
    errors.push(`${DIRECTORY_MANIFEST} version ${manifest.version} must equal package.json version ${version}`);
  }
  for (const field of DIRECTORY_URL_FIELDS) {
    if (!isHttpsUrl(manifest[field])) errors.push(`${DIRECTORY_MANIFEST} must set ${field} to an https URL`);
  }
  if (!Object.hasOwn(manifest, 'icon')) return errors;
  if (typeof manifest.icon !== 'string' || manifest.icon === '') {
    return [...errors, `${DIRECTORY_MANIFEST} icon must be a package path`];
  }
  const iconPath = manifest.icon.replace(/^\.\//, '');
  if (!files.has(iconPath)) errors.push(`${DIRECTORY_MANIFEST} icon ${manifest.icon} is not in the package`);
  return errors;
}

// Directory Plugin: Claude package. Runtime files only, README and LICENSE
// present, manifest carries repository and URL fields, and the package
// stays within Claude's file-count and file-size review thresholds.
function checkDirectoryPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return ['Directory Plugin files must be a Map of path to Buffer'];
  const errors = sizeErrors(files);

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
  const manifest = readJsonFile(files, DIRECTORY_MANIFEST, errors);
  if (!manifest || typeof manifest !== 'object') return errors;
  return [...errors, ...checkDirectoryManifest(manifest, files, version)];
}

function defaultValidateRunner(directory) {
  const { runHostCliProbe } = require('./host-cli-probe');
  const child = runHostCliProbe('claude', ['plugin', 'validate', '--strict', '--profile', 'directory', '--json', directory], {
    timeoutMs: CLAUDE_VALIDATE_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.timedOut && child.exitCode === null) return { error: `timed out after ${child.durationMs} ms` };
  if (child.error) return { error: child.error.message };
  return { status: child.exitCode, output: `${child.stdout}${child.stderr}` };
}

function isMissingIconAdvisory(output) {
  const report = JSON.parse(output);
  const { manifest, contents, directory } = report ?? {};
  if (report?.success !== false || report.strict !== true
    || !Array.isArray(manifest?.errors) || manifest.errors.length !== 0
    || !Array.isArray(manifest.warnings) || manifest.warnings.length !== 0
    || !Array.isArray(contents) || contents.length !== 0
    || directory?.profile !== 'directory' || directory.incomplete !== false
    || !Array.isArray(directory.undecided) || directory.undecided.length !== 0
    || !Array.isArray(directory.findings) || directory.findings.length !== 1) return false;
  const [finding] = directory.findings;
  return finding?.code === 'ICON_MISSING' && finding.severity === 'warning'
    && finding.blocking === false && finding.hold === false
    && finding.file === DIRECTORY_MANIFEST && finding.field === 'icon';
}

// `claude plugin validate --strict --profile directory` on a built package
// directory.  `run` is injectable for tests; it returns { status, output }.
function runClaudeValidate(directory, run = defaultValidateRunner) {
  const result = run(directory);
  if (result.error) return [`claude plugin validate could not run: ${result.error}`];
  if (result.status !== 0) {
    if (result.status === 1) {
      try {
        if (isMissingIconAdvisory(result.output)) return [];
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return [`claude plugin validate --strict --profile directory failed (exit ${result.status}): ${result.output.trim().slice(-800)}`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Cursor and AGY package rules (research table: docs/cursor-agy-plugin-spec-compliance.md).
// Basic structural rules only.  Listing-only rules (C-15, A-04, A-05) are
// documented gaps, not checks; A-17 (install path) is UNVERIFIED and not checked;
// C-06 (Cursor shipping its own skills) is out of scope.  Rule ids are in the messages.
// ---------------------------------------------------------------------------

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const TEXT_FILE = /\.(?:md|mdc|markdown|txt|json)$/;
const FOREIGN_ROOT_TOKEN = '${' + 'CLAUDE_PLUGIN_ROOT}';

// Top-level `key: value` pairs of a Markdown frontmatter block, or null when absent.
function topLevelFrontmatter(buffer) {
  const block = frontmatterBlock(buffer);
  if (block === null) return null;
  const fields = {};
  for (const line of block.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = unquote(pair[2]);
  }
  return fields;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stem = (file) => file.split('/').pop().replace(/\.[^.]+$/, '');
const filesUnder = (files, directory) => [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).sort();

function extensionOf(file) {
  const base = file.split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot);
}

function unknownKeyErrors(label, file, fields, allowed) {
  return Object.keys(fields).filter((key) => !allowed.includes(key)).map((key) => `${label} ${file} has undocumented frontmatter key ${key}`);
}

// C-14 / A-18: the Claude plugin-root token is meaningless to another host.
function foreignTokenErrors(files, label) {
  const errors = [];
  for (const [file, bytes] of files) {
    if (TEXT_FILE.test(file) && bytes.toString('utf8').includes(FOREIGN_ROOT_TOKEN)) {
      errors.push(`${label} ${file} contains ${FOREIGN_ROOT_TOKEN}, a Claude token that this host does not expand`);
    }
  }
  return errors;
}

const CURSOR_LABEL = 'Cursor Plugin';
const CURSOR_MANIFEST = '.cursor-plugin/plugin.json';
const CURSOR_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const CURSOR_KEYS = Object.freeze(['name', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords', 'logo', 'rules', 'agents', 'skills', 'commands', 'hooks', 'mcpServers', 'variables']);
const CURSOR_PATH_KEYS = Object.freeze(['logo', 'rules', 'agents', 'skills', 'commands', 'hooks']);
const CURSOR_AGENT_KEYS = Object.freeze(['name', 'description', 'model', 'readonly', 'is_background']);
// The docs say "lowercase letters and hyphens"; the canonical agent e2e-runner has a digit, so digits are allowed.
const CURSOR_AGENT_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CURSOR_DOC_EXTENSIONS = Object.freeze({ rules: ['.mdc', '.md', '.markdown'], agents: ['.md', '.mdc', '.markdown'], commands: ['.md', '.mdc', '.markdown', '.txt'] });
const CURSOR_HOOK_EVENTS = Object.freeze([
  'sessionStart', 'sessionEnd', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'subagentStart', 'subagentStop',
  'beforeShellExecution', 'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'beforeReadFile', 'afterFileEdit',
  'beforeSubmitPrompt', 'preCompact', 'stop', 'afterAgentResponse', 'afterAgentThought', 'beforeTabFileRead', 'afterTabFileEdit', 'workspaceOpen',
]);

function cursorManifestErrors(manifest, version) {
  const errors = [];
  const label = `${CURSOR_LABEL} ${CURSOR_MANIFEST}`;
  if (typeof manifest.name !== 'string' || !CURSOR_NAME.test(manifest.name)) errors.push(`${label} name must be lowercase kebab-case (C-02)`);
  for (const key of Object.keys(manifest).filter((candidate) => !CURSOR_KEYS.includes(candidate))) errors.push(`${label} has undocumented key ${key} (C-03)`);
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) errors.push(`${label} version must be semver (C-03)`);
  if (manifest.version !== version) errors.push(`${label} version ${manifest.version} must equal package.json version ${version}`);
  if (Object.prototype.hasOwnProperty.call(manifest, 'variables')) {
    const variables = manifest.variables;
    if (!isPlainObject(variables) || variables.type !== 'object' || !isPlainObject(variables.properties)) {
      errors.push(`${label} variables must be { "type": "object", "properties": { ... } } (C-13)`);
    }
  }
  return errors;
}

function cursorPathErrors(manifest, files) {
  const errors = [];
  for (const key of CURSOR_PATH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) continue;
    const values = Array.isArray(manifest[key]) ? manifest[key] : [manifest[key]];
    for (const value of values) {
      if (typeof value !== 'string' || value === '') {
        errors.push(`${CURSOR_LABEL} manifest ${key} must be a relative path string (C-04)`);
        continue;
      }
      const relative = value.replace(/^\.\//, '').replace(/\/+$/, '');
      if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || relative.split('/').includes('..') || relative === '') {
        errors.push(`${CURSOR_LABEL} manifest ${key} path ${value} must be relative and stay inside the package (C-04)`);
      } else if (!files.has(relative) && filesUnder(files, relative).length === 0) {
        errors.push(`${CURSOR_LABEL} manifest ${key} path ${value} does not exist in the package (C-04)`);
      }
    }
  }
  return errors;
}

function cursorRuleErrors(files) {
  const errors = [];
  for (const file of filesUnder(files, 'rules')) {
    if (!CURSOR_DOC_EXTENSIONS.rules.includes(extensionOf(file))) continue;
    const fields = topLevelFrontmatter(files.get(file));
    if (!fields) errors.push(`${CURSOR_LABEL} ${file} needs frontmatter (C-07)`);
    else if (!['true', 'false'].includes(fields.alwaysApply)) errors.push(`${CURSOR_LABEL} ${file} alwaysApply must be a boolean (C-07)`);
  }
  return errors;
}

function cursorAgentErrors(files) {
  const errors = [];
  for (const file of filesUnder(files, 'agents')) {
    if (!CURSOR_DOC_EXTENSIONS.agents.includes(extensionOf(file))) {
      errors.push(`${CURSOR_LABEL} ${file} has an extension Cursor does not load as an agent (C-08)`);
      continue;
    }
    const fields = topLevelFrontmatter(files.get(file));
    if (!fields || !fields.name || !fields.description) {
      errors.push(`${CURSOR_LABEL} ${file} needs frontmatter name and description (C-08)`);
      continue;
    }
    if (!CURSOR_AGENT_NAME.test(fields.name)) errors.push(`${CURSOR_LABEL} ${file} name ${fields.name} must use lowercase letters and hyphens (C-08)`);
    if (fields.name !== stem(file)) errors.push(`${CURSOR_LABEL} ${file} name ${fields.name} must equal the file name (C-08)`);
    errors.push(...unknownKeyErrors(CURSOR_LABEL, file, fields, CURSOR_AGENT_KEYS).map((error) => `${error} (C-08)`));
  }
  return errors;
}

function cursorCommandErrors(files) {
  return filesUnder(files, 'commands')
    .filter((file) => !CURSOR_DOC_EXTENSIONS.commands.includes(extensionOf(file)))
    .map((file) => `${CURSOR_LABEL} ${file} has an extension Cursor does not load as a command (C-10)`);
}

function cursorHookErrors(manifest, files) {
  const hooksPath = typeof manifest.hooks === 'string' ? manifest.hooks.replace(/^\.\//, '') : 'hooks/hooks.json';
  const errors = [];
  const config = readJsonFile(files, hooksPath, errors, CURSOR_LABEL);
  if (!config) return errors;
  if (!Number.isInteger(config.version) || config.version < 1) errors.push(`${CURSOR_LABEL} ${hooksPath} version must be a positive integer (C-11)`);
  if (!isPlainObject(config.hooks)) return [...errors, `${CURSOR_LABEL} ${hooksPath} hooks must be an object (C-11)`];
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!CURSOR_HOOK_EVENTS.includes(event)) errors.push(`${CURSOR_LABEL} ${hooksPath} has undocumented hook event ${event} (C-11)`);
    for (const entry of Array.isArray(entries) ? entries : []) {
      const command = isPlainObject(entry) ? entry.command : null;
      if (typeof command !== 'string' || command === '') errors.push(`${CURSOR_LABEL} ${hooksPath} ${event} entry needs a command (C-11)`);
      else if (/^\s*(?:[A-Za-z]:|\/)/.test(command) && !command.includes('CURSOR_PLUGIN_ROOT')) {
        errors.push(`${CURSOR_LABEL} ${hooksPath} ${event} command must be relative or use CURSOR_PLUGIN_ROOT (C-12)`);
      }
    }
  }
  return errors;
}

function cursorMarketplaceErrors(manifest, files) {
  const errors = [];
  const marketplace = readJsonFile(files, '.cursor-plugin/marketplace.json', errors, CURSOR_LABEL);
  if (!marketplace) return errors;
  const names = (Array.isArray(marketplace.plugins) ? marketplace.plugins : []).map((entry) => entry && entry.name);
  if (new Set(names).size !== names.length) errors.push(`${CURSOR_LABEL} marketplace entry names must be unique (C-16)`);
  if (names.length > 0 && !names.includes(manifest.name)) errors.push(`${CURSOR_LABEL} marketplace entry name must equal manifest name ${manifest.name} (C-16)`);
  return errors;
}

// Cursor Plugin: manifest at .cursor-plugin/plugin.json, documented keys only,
// version equal to package.json, valid component files, no Claude tokens.
function checkCursorPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return [`${CURSOR_LABEL} files must be a Map of path to Buffer`];
  const errors = [];
  if (files.has('plugin.json')) errors.push(`${CURSOR_LABEL} must not carry a root plugin.json; that is the Agent Plugin manifest (C-01)`);
  if (!files.has(CURSOR_MANIFEST)) return [...errors, `${CURSOR_LABEL} is missing ${CURSOR_MANIFEST} (C-01)`];
  const manifest = readJsonFile(files, CURSOR_MANIFEST, errors, CURSOR_LABEL);
  if (!isPlainObject(manifest)) return errors;
  errors.push(...cursorManifestErrors(manifest, version), ...cursorPathErrors(manifest, files));
  errors.push(...cursorRuleErrors(files), ...cursorAgentErrors(files), ...cursorCommandErrors(files));
  errors.push(...cursorHookErrors(manifest, files), ...cursorMarketplaceErrors(manifest, files));
  if (!files.has('README.md')) errors.push(`${CURSOR_LABEL} is missing README.md (C-17)`);
  if (typeof manifest.license !== 'string' || manifest.license === '') errors.push(`${CURSOR_LABEL} manifest must set license (C-17)`);
  return [...errors, ...foreignTokenErrors(files, CURSOR_LABEL)];
}

const AGY_LABEL = 'AGY Plugin';
const AGY_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const AGY_KEYS = Object.freeze(['name', 'displayName', 'display_name', 'description', 'version', 'homepage', 'repository', 'license', 'keywords', 'disabled', 'logo', 'suggestedPrompts', 'suggested_prompts', 'skills', 'author', 'extensions']);
const AGY_AGENT_KEYS = Object.freeze(['name', 'description', 'mainAgent', 'subagent', 'model', 'tools', 'commandExecutionPolicy', 'skills', 'inheritMcp', 'inheritCustomizations']);
const AGY_MODELS = Object.freeze(['inherit', 'flash_lite', 'flash', 'pro']);
const AGY_RULE_TRIGGERS = Object.freeze(['always_on', 'model_decision', 'glob', 'manual']);
const AGY_ALWAYS_ON_RULES = Object.freeze(['rules/AGENTS.md', 'rules/GEMINI.md']);
const AGY_SKILL_NAME_LIMIT = 64;
const AGY_SKILL_DESCRIPTION_LIMIT = 1024;

function agyManifestErrors(manifest, version) {
  const errors = [];
  const label = `${AGY_LABEL} plugin.json`;
  if (typeof manifest.name !== 'string' || !AGY_NAME.test(manifest.name)) errors.push(`${label} name must be lowercase kebab-case (A-02)`);
  for (const key of Object.keys(manifest).filter((candidate) => !AGY_KEYS.includes(candidate))) errors.push(`${label} has undocumented key ${key} (A-03)`);
  if (Object.prototype.hasOwnProperty.call(manifest, 'skills')) {
    const skills = manifest.skills;
    if (!Array.isArray(skills) || !skills.every((entry) => typeof entry === 'string')) errors.push(`${label} skills must be a list of paths (A-03)`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'version') && typeof manifest.version !== 'string') errors.push(`${label} version must be a string (A-03)`);
  if (manifest.version !== version) errors.push(`${label} version ${manifest.version} must equal package.json version ${version}`);
  return errors;
}

function agySkillErrors(files) {
  const errors = [];
  for (const file of [...files.keys()].filter((candidate) => TOP_LEVEL_SKILL.test(candidate)).sort()) {
    const fields = topLevelFrontmatter(files.get(file)) || {};
    const directory = file.split('/')[1];
    if (fields.name !== directory) errors.push(`${AGY_LABEL} ${file} name ${fields.name} must match the parent directory ${directory} (A-07)`);
    if (!fields.name || fields.name.length > AGY_SKILL_NAME_LIMIT || !AGY_NAME.test(fields.name)) errors.push(`${AGY_LABEL} ${file} name must be kebab-case, 1-${AGY_SKILL_NAME_LIMIT} characters (A-07)`);
    const length = (fields.description || '').length;
    if (length < 1 || length > AGY_SKILL_DESCRIPTION_LIMIT) errors.push(`${AGY_LABEL} ${file} description must be 1-${AGY_SKILL_DESCRIPTION_LIMIT} characters, has ${length} (A-07)`);
  }
  return errors;
}

function agyAgentErrors(files) {
  const errors = [];
  for (const file of filesUnder(files, 'agents').filter((candidate) => candidate.endsWith('.md'))) {
    const fields = topLevelFrontmatter(files.get(file));
    if (!fields || !fields.name || !fields.description) {
      errors.push(`${AGY_LABEL} ${file} needs frontmatter name and description (A-10)`);
      continue;
    }
    if (fields.name !== stem(file)) errors.push(`${AGY_LABEL} ${file} name ${fields.name} must equal the file name (A-10)`);
    errors.push(...unknownKeyErrors(AGY_LABEL, file, fields, AGY_AGENT_KEYS).map((error) => `${error} (A-10)`));
    if (fields.model !== undefined && !AGY_MODELS.includes(fields.model)) errors.push(`${AGY_LABEL} ${file} model ${fields.model} must be one of ${AGY_MODELS.join(', ')} (A-11)`);
  }
  return errors;
}

function agyRuleErrors(files) {
  const errors = [];
  for (const file of filesUnder(files, 'rules').filter((candidate) => candidate.endsWith('.md') && !AGY_ALWAYS_ON_RULES.includes(candidate))) {
    const fields = topLevelFrontmatter(files.get(file));
    if (!fields || !AGY_RULE_TRIGGERS.includes(fields.trigger)) errors.push(`${AGY_LABEL} ${file} trigger must be one of ${AGY_RULE_TRIGGERS.join(', ')} (A-14)`);
    else if (fields.trigger === 'glob' && !fields.globs) errors.push(`${AGY_LABEL} ${file} trigger glob needs a globs string (A-14)`);
  }
  return errors;
}

// AGY Plugin: manifest at the package root, documented keys only, version equal
// to package.json, valid skills, agents and rules, no Claude tokens.
function checkAgyPlugin(files, { version } = {}) {
  if (!(files instanceof Map)) return [`${AGY_LABEL} files must be a Map of path to Buffer`];
  const errors = [];
  if (!files.has('plugin.json')) return [`${AGY_LABEL} is missing plugin.json (A-01)`];
  const manifest = readJsonFile(files, 'plugin.json', errors, AGY_LABEL);
  if (!isPlainObject(manifest)) return errors;
  errors.push(...agyManifestErrors(manifest, version), ...agySkillErrors(files), ...agyAgentErrors(files), ...agyRuleErrors(files));
  return [...errors, ...foreignTokenErrors(files, AGY_LABEL)];
}

module.exports = { checkPublicPlugin, checkDirectoryPlugin, checkCursorPlugin, checkAgyPlugin, runClaudeValidate };
