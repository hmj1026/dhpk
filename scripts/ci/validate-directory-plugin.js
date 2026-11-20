#!/usr/bin/env node
'use strict';

// Repository gate for the instruction-only Directory Plugin (dhpk-lite at
// dist/claude-directory/package). Enforces Anthropic plugin directory rules on
// the committed tree and reports references to omitted skills or agents as
// warnings without failing.

const fs = require('node:fs');
const path = require('node:path');
const {
  DIRECTORY_PLUGIN_NAME,
  DIRECTORY_SKILL_NAMES,
  SKILL_NEXT_MAP_PATH,
  OMITTED_AGENTS,
  SKILL_FRONTMATTER_KEYS,
  AGENT_FRONTMATTER_KEYS,
  hasShebang,
  isForbiddenDirectoryPath,
  isAllowedExtension,
  isNestedSkillMarkdown,
  isOmittedAgentPath,
} = require('../lib/claude-directory-reduction');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'dist', 'claude-directory', 'package');
const MAX_FILES = 512;
const MAX_NON_IMAGE_BYTES = 256 * 1024;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|ico)$/i;
const TEXT_EXTENSION = /\.(?:md|txt|json|ya?ml)$/i;
const URL_OR_DHPK_TOKEN = /(https?:\/\/[^\s)>\]"'`]+)|(?<![A-Za-z0-9_-])dhpk:([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g;
const OMITTED_ALL = [...OMITTED_AGENTS];
const OMITTED_REF_PATTERN = new RegExp(`(?<![A-Za-z0-9_-])(${OMITTED_ALL.join('|')})(?![A-Za-z0-9_-])`, 'g');
const SKILL_TOKEN_PATTERN = new RegExp(`(?<![A-Za-z0-9_/-])\\$(${DIRECTORY_SKILL_NAMES.join('|')})(?![A-Za-z0-9_-])`, 'g');
const TOP_LEVEL_SKILL_MARKDOWN = /^skills\/[^/]+\/SKILL\.md$/;
const REFERENCE_FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function readPackageFiles(packageDir) {
  const files = new Map();
  const symlinkErrors = [];
  const walk = (dir, rel = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        symlinkErrors.push({ file: nextRel, rule: 'no-symlinks', message: 'Directory Plugin must not contain symlinks' });
      } else if (entry.isDirectory()) {
        walk(full, nextRel);
      } else if (entry.isFile()) {
        files.set(nextRel, fs.readFileSync(full));
      } else {
        symlinkErrors.push({ file: nextRel, rule: 'allowed-file-type', message: 'Directory Plugin contains non-regular filesystem entry' });
      }
    }
  };
  walk(packageDir);
  return { files, symlinkErrors };
}

function checkPlainFrontmatter(file, text, allowedKeys, requiredKeys, rule, errors, expectedName = null) {
  const clean = text.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push({ file, rule, message: 'missing plain YAML frontmatter block' });
    return;
  }
  const seen = new Set();
  let parsedName = null;
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    if (/^\s/.test(line)) {
      errors.push({ file, rule, message: 'frontmatter must contain only plain top-level key: value lines' });
      return;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (!pair) {
      errors.push({ file, rule, message: `non-plain frontmatter line '${line}'` });
      return;
    }
    const key = pair[1];
    const val = pair[2].trim();
    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(val)) {
      errors.push({ file, rule, message: `frontmatter key '${key}' must not use a block scalar` });
      return;
    }
    if (!allowedKeys.includes(key)) {
      errors.push({ file, rule, message: `disallowed frontmatter key '${key}' (allowed: ${allowedKeys.join(', ')})` });
    }
    if (seen.has(key)) {
      errors.push({ file, rule, message: `duplicate frontmatter key '${key}'` });
    }
    seen.add(key);
    if (key === 'name') {
      parsedName = val.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const required of requiredKeys) {
    if (!seen.has(required)) {
      errors.push({ file, rule, message: `missing required frontmatter key '${required}'` });
    }
  }
  if (expectedName && parsedName && parsedName !== expectedName) {
    errors.push({ file, rule, message: `frontmatter name '${parsedName}' does not match directory '${expectedName}'` });
  }
}

function validateManifest(files, expectedVersion, errors) {
  const manifestPath = '.claude-plugin/plugin.json';
  if (!files.has(manifestPath)) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: 'missing .claude-plugin/plugin.json' });
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(files.get(manifestPath).toString('utf8'));
  } catch (error) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: `invalid JSON: ${error.message}` });
    return;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: 'manifest must be a JSON object' });
    return;
  }
  if (manifest.name !== DIRECTORY_PLUGIN_NAME) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: `name must be '${DIRECTORY_PLUGIN_NAME}', found '${manifest.name}'` });
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: `version '${manifest.version}' does not match repository version '${expectedVersion}'` });
  }
  for (const forbiddenKey of ['userConfig', 'hooks', 'mcpServers', 'lspServers', 'monitors', 'icon']) {
    if (Object.prototype.hasOwnProperty.call(manifest, forbiddenKey)) {
      errors.push({ file: manifestPath, rule: 'manifest-contract', message: `manifest must not declare '${forbiddenKey}'` });
    }
  }
  for (const requiredField of ['bugs', 'homepage', 'repository']) {
    if (typeof manifest[requiredField] !== 'string' || manifest[requiredField].trim() === '') {
      errors.push({ file: manifestPath, rule: 'manifest-contract', message: `manifest must declare '${requiredField}'` });
    }
  }
  if (!Array.isArray(manifest.agents)) {
    errors.push({ file: manifestPath, rule: 'manifest-contract', message: 'manifest must declare agents array' });
    return;
  }
  const declaredAgents = new Set(manifest.agents.map((entry) => String(entry).replace(/^\.\//, '')));
  for (const declared of declaredAgents) {
    if (!files.has(declared)) {
      errors.push({ file: manifestPath, rule: 'manifest-contract', message: `declared agent '${declared}' is missing from package` });
    }
  }
  for (const file of files.keys()) {
    if (/^agents\/[^/]+\.md$/.test(file) && !declaredAgents.has(file)) {
      errors.push({ file: manifestPath, rule: 'manifest-contract', message: `agent '${file}' is present in package but omitted from manifest.agents` });
    }
  }
}

function validateReadme(files, errors) {
  if (!files.has('LICENSE')) {
    errors.push({ file: 'LICENSE', rule: 'readme-contract', message: 'missing LICENSE' });
  }
  if (!files.has('README.md')) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: 'missing README.md' });
    return;
  }
  const text = files.get('README.md').toString('utf8');
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 40) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: `README.md must have at least 40 words (found ${words.length})` });
  }
  if (!text.includes('/plugin marketplace add hmj1026/dhpk') || !text.includes('/plugin install dhpk@dhpk')) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: 'README.md must explain how to install the Full Plugin from the Repository Marketplace' });
  }
  if (!/do not enable|keep only one|not.*both/i.test(text) || !text.includes('dhpk-lite')) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: 'README.md must state that dhpk and dhpk-lite should not be enabled together' });
  }
  if (!text.includes('mode: manual')) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: 'README.md must explain Manual Procedures (mode: manual)' });
  }
  const missingMentions = OMITTED_AGENTS.filter((name) => !text.includes(name));
  if (missingMentions.length > 0) {
    errors.push({ file: 'README.md', rule: 'readme-contract', message: `README.md must list omitted agents: ${missingMentions.join(', ')}` });
  }
}

function validateSkillAllowlist(files, errors) {
  const allowed = new Set(DIRECTORY_SKILL_NAMES);
  for (const file of files.keys()) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file);
    if (!match || allowed.has(match[1])) continue;
    errors.push({ file, rule: 'skill-allowlist', message: `shipped skill '${match[1]}' is missing from DIRECTORY_SKILL_NAMES, so its $${match[1]} tokens are not rewritten` });
  }
}

function validateSkillNextMap(files, errors) {
  if (!files.has(SKILL_NEXT_MAP_PATH)) {
    errors.push({ file: SKILL_NEXT_MAP_PATH, rule: 'skill-next-map', message: `missing relocated routing data file '${SKILL_NEXT_MAP_PATH}'` });
    return;
  }
  try {
    const data = JSON.parse(files.get(SKILL_NEXT_MAP_PATH).toString('utf8'));
    if (!data || data.schema !== 'dhpk.skill-next-map.v1' || !data.skills || typeof data.skills !== 'object' || Array.isArray(data.skills)) {
      errors.push({ file: SKILL_NEXT_MAP_PATH, rule: 'skill-next-map', message: 'invalid skill-next-map schema' });
    }
  } catch (error) {
    errors.push({ file: SKILL_NEXT_MAP_PATH, rule: 'skill-next-map', message: `invalid JSON: ${error.message}` });
  }

  for (const [file, buffer] of files) {
    if (!TEXT_EXTENSION.test(file) || file === SKILL_NEXT_MAP_PATH) continue;
    const text = buffer.toString('utf8');
    if (text.includes('skills/flow-guide/references/skill-next-map.json')) {
      errors.push({ file, rule: 'skill-next-map', message: 'references omitted skills/flow-guide/references/skill-next-map.json instead of package skill-next-map.json' });
      continue;
    }
    for (const match of text.matchAll(/([^\s`("']*skill-next-map\.json)/g)) {
      const ref = match[1];
      if (/^https?:\/\//.test(ref)) continue;
      if (ref === SKILL_NEXT_MAP_PATH || ref === `./${SKILL_NEXT_MAP_PATH}`) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref));
      if (resolved.startsWith('..') || !files.has(resolved)) {
        errors.push({ file, rule: 'skill-next-map', message: `skill-next-map reference '${ref}' does not resolve inside the package` });
      }
    }
  }
}

// A scripts/ reference counts as removed when the Full Plugin ships it (relative
// to the skill directory or the package root) and the Directory Plugin does not.
// Without a Full Plugin tree to compare, every scripts/ reference is reported.
function isRemovedScriptPath(file, ref, files, fullDir) {
  const skillRoot = file.split('/').slice(0, 2).join('/');
  const candidates = [`${skillRoot}/${ref}`, ref];
  if (candidates.some((candidate) => files.has(candidate))) return false;
  if (!fullDir) return true;
  return candidates.some((candidate) => fs.existsSync(path.join(fullDir, candidate)));
}

function countByRule(warnings) {
  const counts = new Map();
  for (const w of warnings) counts.set(w.rule, (counts.get(w.rule) || 0) + 1);
  return [...counts].map(([rule, count]) => `${rule}: ${count}`).join(', ');
}

function validateDirectoryPlugin(packageDir = DEFAULT_DIR, { root = ROOT, version, fullPluginDir } = {}) {
  const resolvedFullDir = path.resolve(fullPluginDir || path.join(root, 'dist', 'claude-marketplace', 'package'));
  const fullPluginKnown = fs.existsSync(resolvedFullDir);
  const resolvedDir = path.resolve(packageDir);
  const expectedVersion = version !== undefined
    ? version
    : (() => {
      const pkgPath = path.join(root, 'package.json');
      return fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version : null;
    })();

  if (!fs.existsSync(resolvedDir)) {
    return {
      ok: false,
      errors: [{ file: path.relative(root, resolvedDir) || resolvedDir, rule: 'package-exists', message: `Directory Plugin directory does not exist: ${resolvedDir}` }],
      warnings: [],
      fileCount: 0,
    };
  }

  const { files, symlinkErrors } = readPackageFiles(resolvedDir);
  const errors = [...symlinkErrors];
  const warnings = [];

  if (files.size > MAX_FILES) {
    errors.push({ file: '.', rule: 'file-budget', message: `Directory Plugin has ${files.size} files (limit ${MAX_FILES})` });
  }

  for (const [file, buffer] of files) {
    if (isForbiddenDirectoryPath(file)) {
      errors.push({ file, rule: 'forbidden-path', message: `forbidden path '${file}' in Directory Plugin` });
    }
    if (isNestedSkillMarkdown(file)) {
      errors.push({ file, rule: 'no-nested-skill-md', message: 'nested Specialist Reference files under skills/*/references/** must be renamed to REFERENCE.md' });
    }
    if (isOmittedAgentPath(file)) {
      errors.push({ file, rule: 'omitted-agent', message: 'omitted external CLI agent must not ship in Directory Plugin' });
    }
    if (!isAllowedExtension(file)) {
      errors.push({ file, rule: 'allowed-file-type', message: `disallowed file extension for '${file}'` });
    }
    if (hasShebang(buffer)) {
      errors.push({ file, rule: 'no-shebang', message: 'file starts with #! shebang' });
    }
    if (!IMAGE_EXTENSION.test(file) && buffer.length > MAX_NON_IMAGE_BYTES) {
      errors.push({ file, rule: 'file-budget', message: `non-image file is ${buffer.length} bytes (limit ${MAX_NON_IMAGE_BYTES})` });
    }

    if (TOP_LEVEL_SKILL_MARKDOWN.test(file)) {
      const topSkillMatch = /^skills\/([^/]+)\/SKILL\.md$/.exec(file);
      checkPlainFrontmatter(
        file,
        buffer.toString('utf8'),
        SKILL_FRONTMATTER_KEYS,
        SKILL_FRONTMATTER_KEYS,
        'skill-frontmatter',
        errors,
        topSkillMatch ? topSkillMatch[1] : null,
      );
    } else if (/^skills\/.+\/REFERENCE\.md$/.test(file)) {
      if (REFERENCE_FRONTMATTER.test(buffer.toString('utf8'))) {
        errors.push({ file, rule: 'no-nested-skill-md', message: 'nested REFERENCE.md must not carry standalone skill frontmatter' });
      }
    } else if (/^agents\/[^/]+\.md$/.test(file)) {
      checkPlainFrontmatter(file, buffer.toString('utf8'), AGENT_FRONTMATTER_KEYS, ['name', 'description'], 'agent-frontmatter', errors);
    }

    if (TEXT_EXTENSION.test(file)) {
      const text = buffer.toString('utf8');
      const stripped = text.replace(URL_OR_DHPK_TOKEN, (whole, url) => (url ? '' : whole));
      for (const m of stripped.matchAll(/(?<![A-Za-z0-9_-])dhpk:([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g)) {
        errors.push({ file, rule: 'namespace-rewrite', message: `unrewritten namespace 'dhpk:${m[1]}'` });
      }
      for (const m of stripped.matchAll(SKILL_TOKEN_PATTERN)) {
        errors.push({ file, rule: 'namespace-rewrite', message: `unrewritten skill token '$${m[1]}'` });
      }
      if ((file.endsWith('.md') || file.endsWith('.json')) && file !== 'README.md') {
        const warned = new Set();
        for (const m of text.matchAll(OMITTED_REF_PATTERN)) {
          if (!warned.has(m[1])) {
            warned.add(m[1]);
            warnings.push({ file, rule: 'omitted-reference', target: m[1], message: `references omitted capability '${m[1]}'` });
          }
        }
      }
      if (file.startsWith('skills/') && (file.endsWith('.md') || file.endsWith('.json'))) {
        const reportedScripts = new Set();
        for (const m of stripped.matchAll(/(?<![A-Za-z0-9_-])(scripts\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g)) {
          if (!reportedScripts.has(m[1]) && isRemovedScriptPath(file, m[1], files, fullPluginKnown ? resolvedFullDir : null)) {
            reportedScripts.add(m[1]);
            errors.push({ file, rule: 'removed-script-reference', target: m[1], message: `references removed script path '${m[1]}'` });
          }
        }
      }
    }
  }

  validateManifest(files, expectedVersion, errors);
  validateReadme(files, errors);
  validateSkillAllowlist(files, errors);
  validateSkillNextMap(files, errors);

  return { ok: errors.length === 0, errors, warnings, fileCount: files.size };
}

function parseCliArgs(argv) {
  let dir = DEFAULT_DIR;
  let version;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') dir = argv[++index];
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else if (arg === '--version') version = argv[++index];
    else if (arg.startsWith('--version=')) version = arg.slice('--version='.length);
    else if (arg === '--help' || arg === '-h') return { help: true };
    else return { error: `unknown argument '${arg}'` };
  }
  return { dir, version };
}

function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    console.log('usage: node scripts/ci/validate-directory-plugin.js [--dir <path>] [--version <semver>]');
    return 0;
  }
  if (args.error) {
    console.error(`FAIL [validate-directory-plugin]: ${args.error}`);
    return 2;
  }
  const result = validateDirectoryPlugin(args.dir, { version: args.version });
  for (const w of result.warnings) {
    console.warn(`WARN [validate-directory-plugin] ${w.file} (${w.rule}): ${w.message}`);
  }
  for (const e of result.errors) {
    console.error(`FAIL [validate-directory-plugin] ${e.file} (${e.rule}): ${e.message}`);
  }
  if (!result.ok) {
    console.error(`FAIL [validate-directory-plugin]: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`PASS [validate-directory-plugin]: ${result.fileCount} files verified, 0 errors, ${result.warnings.length} warning(s)${result.warnings.length ? ` (${countByRule(result.warnings)})` : ''}`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  DEFAULT_DIR,
  validateDirectoryPlugin,
  main,
};
