'use strict';

// Pure transforms that reduce the Full Plugin (dist/claude-marketplace/package)
// into the instruction-only Directory Plugin (dhpk-lite at
// dist/claude-directory/package). See ADR-0041 and the claude-directory-plugin
// specification.

const path = require('node:path');
const { normalizePortableFrontmatter } = require('./agent-plugin-package');
const { buildRuntimeDataFile } = require('./public-plugin-tree');

const DIRECTORY_PLUGIN_NAME = 'dhpk-lite';
const DIRECTORY_DISPLAY_NAME = 'DHPK Dev Harness (Lite)';
const SKILL_NEXT_MAP_PATH = 'skill-next-map.json';

// Reviewed omission list: skills and agents whose primary purpose requires a
// shipped script or external CLI wrapper.
const OMITTED_SKILLS = Object.freeze([
  'flow-guide',
  'git-smart-commit',
  'harness-setup',
  'precommit',
  'release-creator',
  'opsx-apply-resume',
]);

const OMITTED_AGENTS = Object.freeze([
  'codex-worker',
  'codex-reasoner',
  'agy-worker',
]);

const ALLOWED_EXTENSIONS = Object.freeze([
  '.md', '.txt', '.json', '.yaml', '.yml',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
]);

const SKILL_FRONTMATTER_KEYS = Object.freeze(['name', 'description']);
const AGENT_FRONTMATTER_KEYS = Object.freeze(['name', 'description', 'model', 'color', 'tools']);

const FORBIDDEN_EXACT_PATHS = Object.freeze([
  'hooks.json',
  '.mcp.json',
  '.lsp.json',
  'monitors.json',
  'provenance.json',
]);

const FORBIDDEN_PREFIXES = Object.freeze([
  'hooks/',
  'bin/',
  'scripts/',
  'manifests/',
]);

const SKILL_SCRIPTS_SEGMENT = /^skills\/(?:.+\/)?scripts\//;
const TEXT_REWRITE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const URL_OR_DHPK_TOKEN = /(https?:\/\/[^\s)>\]"'`]+)|(?<![A-Za-z0-9_-])dhpk:([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g;

function hasShebang(contentBuffer) {
  const buf = Buffer.isBuffer(contentBuffer) ? contentBuffer : Buffer.from(String(contentBuffer || ''), 'utf8');
  let offset = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    offset = 3;
  }
  return buf.length >= offset + 2 && buf[offset] === 0x23 && buf[offset + 1] === 0x21;
}

function isForbiddenDirectoryPath(destination) {
  return FORBIDDEN_EXACT_PATHS.includes(destination)
    || FORBIDDEN_PREFIXES.some((prefix) => destination.startsWith(prefix))
    || SKILL_SCRIPTS_SEGMENT.test(destination);
}

function isAllowedExtension(destination) {
  if (destination === 'LICENSE') return true;
  const ext = path.posix.extname(destination).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function isOmittedSkillPath(destination) {
  const match = /^skills\/([^/]+)\//.exec(destination);
  return Boolean(match && OMITTED_SKILLS.includes(match[1]));
}

function isOmittedAgentPath(destination) {
  const match = /^agents\/([^/]+)\.md$/.exec(destination);
  return Boolean(match && OMITTED_AGENTS.includes(match[1]));
}

function isAllowedDirectoryFile(destination, contentBuffer) {
  if (isForbiddenDirectoryPath(destination)) return false;
  if (!isAllowedExtension(destination)) return false;
  if (hasShebang(contentBuffer)) return false;
  return true;
}

function unquoteScalar(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed[trimmed.length - 1] === "'") {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseAgentFrontmatter(block, filePath = 'agent.md') {
  const lines = block.split(/\r?\n/);
  const values = {};
  let index = 0;
  while (index < lines.length) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1];
    const valuePart = match[2].trim();
    const isKeptKey = AGENT_FRONTMATTER_KEYS.includes(key);
    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(valuePart)) {
      const folded = valuePart[0] === '>';
      const collected = [];
      index += 1;
      while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === '') {
          collected.push('');
          index += 1;
          continue;
        }
        if (/^\s/.test(line)) {
          collected.push(line.replace(/^\s+/, ''));
          index += 1;
          continue;
        }
        break;
      }
      values[key] = folded
        ? collected.join(' ').replace(/\s+/g, ' ').trim()
        : collected.join('\n').replace(/\n+$/, '');
      continue;
    }
    if (isKeptKey && valuePart.startsWith('[')) {
      throw new Error(`${filePath}: frontmatter key '${key}' must not use a YAML list`);
    }
    if (isKeptKey && valuePart === '') {
      let probe = index + 1;
      while (probe < lines.length) {
        const nextLine = lines[probe];
        if (nextLine.trim() === '') {
          probe += 1;
          continue;
        }
        if (/^\s*-\s*/.test(nextLine) && /^\s/.test(nextLine)) {
          throw new Error(`${filePath}: frontmatter key '${key}' must not use a YAML list`);
        }
        if (!/^\s/.test(nextLine)) break;
        probe += 1;
      }
    }
    values[key] = unquoteScalar(valuePart);
    index += 1;
  }
  return values;
}

function formatPlainAgentLine(key, value) {
  const text = String(value);
  if (key === 'description') return `${key}: ${JSON.stringify(text)}`;
  if (/[\r\n]/.test(text) || /^["']/.test(text) || /:\s/.test(text)) {
    return `${key}: ${JSON.stringify(text)}`;
  }
  return `${key}: ${text}`;
}

function reduceSkillFrontmatter(markdownText, filePath = 'SKILL.md') {
  const parsed = normalizePortableFrontmatter(markdownText, {
    allowlist: SKILL_FRONTMATTER_KEYS,
  });
  if (!parsed.ok) {
    throw new Error(`${filePath}: cannot reduce skill frontmatter: ${parsed.errors.join('; ')}`);
  }
  return parsed.output;
}

function reduceAgentFrontmatter(markdownText, filePath = 'agent.md') {
  const clean = String(markdownText).replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`${filePath}: missing YAML frontmatter`);
  }
  const parsed = parseAgentFrontmatter(match[1], filePath);
  const keptLines = [];
  for (const key of AGENT_FRONTMATTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key) && parsed[key] !== '') {
      keptLines.push(formatPlainAgentLine(key, parsed[key]));
    }
  }
  const body = clean.slice(match[0].length);
  return `---\n${keptLines.join('\n')}\n---\n${body}`;
}

function targetBaseSkillName(target) {
  return String(target == null ? '' : target)
    .trim()
    .replace(/^[$]|^\/?(?:dhpk(?:-lite)?:)?/, '')
    .split(':')[0];
}

function pruneOmittedSkillNextRoutes(mapBuffer) {
  const data = JSON.parse(Buffer.from(mapBuffer).toString('utf8'));
  if (!data || !data.skills || typeof data.skills !== 'object' || Array.isArray(data.skills)) {
    return Buffer.from(mapBuffer);
  }
  const omittedSet = new Set(OMITTED_SKILLS);
  const prunedSkills = {};
  for (const [skillName, entry] of Object.entries(data.skills)) {
    if (omittedSet.has(skillName)) continue;
    const nextEntry = { ...entry };
    if (entry && entry.next && typeof entry.next === 'object' && !Array.isArray(entry.next)) {
      const prunedNext = {};
      for (const [stateKey, target] of Object.entries(entry.next)) {
        if (!omittedSet.has(targetBaseSkillName(target))) {
          prunedNext[stateKey] = target;
        }
      }
      nextEntry.next = prunedNext;
    }
    prunedSkills[skillName] = nextEntry;
  }
  return Buffer.from(`${JSON.stringify({ ...data, skills: prunedSkills })}\n`, 'utf8');
}

function rewriteDirectoryNamespace(text) {
  return String(text).replace(URL_OR_DHPK_TOKEN, (whole, url, token) => {
    if (url) return url;
    return `${DIRECTORY_PLUGIN_NAME}:${token}`;
  });
}

function renderDirectoryManifest(fullManifestBuffer, { version } = {}) {
  const manifest = JSON.parse(Buffer.from(fullManifestBuffer).toString('utf8'));
  const omittedAgentPaths = new Set(OMITTED_AGENTS.map((name) => `./agents/${name}.md`));
  const out = {};

  if (manifest.$schema) out.$schema = manifest.$schema;
  out.name = DIRECTORY_PLUGIN_NAME;
  out.displayName = DIRECTORY_DISPLAY_NAME;
  out.version = version || manifest.version;
  out.description = 'Instruction-only DHPK harness for Claude Code (skills, agents, and rules without hooks, scripts, or userConfig). For hooks and local scripts, install the Full Plugin (dhpk) from the Repository Marketplace.';
  if (manifest.author) out.author = manifest.author;
  if (manifest.license) out.license = manifest.license;
  if (manifest.homepage) out.homepage = manifest.homepage;
  if (manifest.repository) out.repository = manifest.repository;
  if (manifest.icon) out.icon = manifest.icon;
  if (manifest.bugs) out.bugs = manifest.bugs;
  if (Array.isArray(manifest.keywords)) out.keywords = manifest.keywords;
  if (Array.isArray(manifest.agents)) {
    out.agents = manifest.agents.filter((entry) => !omittedAgentPaths.has(entry));
  }
  return Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

function renderDirectoryReadme() {
  return Buffer.from([
    '# dhpk-lite (Instruction-only Directory Plugin)',
    '',
    '`dhpk-lite` is the instruction-only distribution of DHPK for Anthropic\'s Claude plugin directory.',
    'It provides portable workflow skills (invoked as `/dhpk-lite:<skill-name>`), specialist agents (`dhpk-lite:<agent-name>`),',
    'trap sheets, and execution policy rules with zero local hooks, zero executable scripts, and zero `userConfig` prompts.',
    '',
    '## Install `dhpk-lite`',
    '',
    'Install `dhpk-lite` from the official Claude Plugin Directory (or another marketplace listing `dhpk-lite`):',
    '',
    '```text',
    '/plugin install dhpk-lite --marketplace anthropics/claude-plugins-official',
    '```',
    '',
    '## Keep only one enabled',
    '',
    'Do not enable both `dhpk` (Full Plugin) and `dhpk-lite` (Directory Plugin) at the same time.',
    'They expose the same underlying skills and agents under separate namespaces (`dhpk:` vs `dhpk-lite:`).',
    'Keep only one active in a workspace.',
    '',
    '## What `dhpk-lite` lacks compared to the Full Plugin (`dhpk`)',
    '',
    '- **No hooks (`hooks/hooks.json`)**: no `PreToolUse` `.env`/`.git`/credential guards, no `SessionStart` notice, and no `SubagentStop` verification hook.',
    '- **No shipped scripts or `userConfig`**: omits `scripts/`, `skills/**/scripts/`, `manifests/`, and interactive `userConfig` settings.',
    '- **Omitted script-dependent skills**: `flow-guide`, `git-smart-commit`, `harness-setup`, `precommit`, `release-creator`, and `opsx-apply-resume`.',
    '- **Omitted external CLI agents**: `codex-worker`, `codex-reasoner`, and `agy-worker`.',
    '- **Reduced frontmatter**: skills keep only `name` and `description` (routing data is packaged in `skill-next-map.json`), and agents keep only `name`, `description`, `model`, `color`, and `tools`. Skills lose `disable-model-invocation`, `argument-hint`, and `allowed-tools`.',
    '',
    '## Install the Full Plugin (`dhpk`) and `dhpk-stacks`',
    '',
    'If you want command hooks, local safety gates, `harness-setup`, `precommit`, `git-smart-commit`, or stack modules (`dhpk-stacks`),',
    'install the Full Plugin directly from the DHPK Repository Marketplace in Claude Code:',
    '',
    '```text',
    '/plugin marketplace add hmj1026/dhpk',
    '/plugin install dhpk@dhpk',
    '```',
    '',
    'For language and framework stack modules and stack skills, also install `dhpk-stacks` (requires the Full Plugin `dhpk`):',
    '',
    '```text',
    '/plugin install dhpk-stacks@dhpk',
    '```',
    '',
    '## Support and license',
    '',
    'Source and issues: https://github.com/hmj1026/dhpk. Licensed under MIT; see `LICENSE`.',
    '',
  ].join('\n'), 'utf8');
}

function reduceToDirectoryPlugin(files, { version } = {}) {
  const retained = new Map();
  for (const [destination, file] of files) {
    if (isOmittedSkillPath(destination) || isOmittedAgentPath(destination)) continue;
    if (!isAllowedDirectoryFile(destination, file.content)) continue;
    retained.set(destination, file);
  }

  // Extract skill-next routing data from kept top-level skills before stripping
  // their metadata frontmatter.
  const topLevelSkillSources = [];
  for (const [destination, file] of retained) {
    if (/^skills\/[^/]+\/SKILL\.md$/.test(destination)) {
      topLevelSkillSources.push({ path: destination, bytes: Buffer.from(file.content) });
    }
  }
  const skillNextMap = buildRuntimeDataFile(topLevelSkillSources, {
    path: SKILL_NEXT_MAP_PATH,
    requireRuntimeSkill: false,
  });

  const reduced = new Map();
  for (const [destination, file] of retained) {
    let content = Buffer.from(file.content);
    if (destination === '.claude-plugin/plugin.json') {
      content = renderDirectoryManifest(content, { version });
    } else if (destination === 'README.md') {
      content = renderDirectoryReadme();
    } else if (destination.startsWith('skills/') && destination.endsWith('/SKILL.md')) {
      const reducedFm = reduceSkillFrontmatter(content.toString('utf8'), destination);
      content = Buffer.from(rewriteDirectoryNamespace(reducedFm), 'utf8');
    } else if (/^agents\/[^/]+\.md$/.test(destination)) {
      const reducedFm = reduceAgentFrontmatter(content.toString('utf8'), destination);
      content = Buffer.from(rewriteDirectoryNamespace(reducedFm), 'utf8');
    } else if (TEXT_REWRITE_EXTENSIONS.has(path.posix.extname(destination).toLowerCase())) {
      content = Buffer.from(rewriteDirectoryNamespace(content.toString('utf8')), 'utf8');
    }
    reduced.set(destination, { destination, content, mode: 0o644 });
  }

  if (skillNextMap) {
    const pruned = pruneOmittedSkillNextRoutes(skillNextMap.bytes);
    reduced.set(SKILL_NEXT_MAP_PATH, {
      destination: SKILL_NEXT_MAP_PATH,
      content: Buffer.from(rewriteDirectoryNamespace(pruned.toString('utf8')), 'utf8'),
      mode: 0o644,
    });
  }

  return reduced;
}

module.exports = {
  DIRECTORY_PLUGIN_NAME,
  DIRECTORY_DISPLAY_NAME,
  SKILL_NEXT_MAP_PATH,
  OMITTED_SKILLS,
  OMITTED_AGENTS,
  ALLOWED_EXTENSIONS,
  SKILL_FRONTMATTER_KEYS,
  AGENT_FRONTMATTER_KEYS,
  FORBIDDEN_EXACT_PATHS,
  FORBIDDEN_PREFIXES,
  hasShebang,
  isForbiddenDirectoryPath,
  isAllowedExtension,
  isOmittedSkillPath,
  isOmittedAgentPath,
  isAllowedDirectoryFile,
  reduceSkillFrontmatter,
  reduceAgentFrontmatter,
  rewriteDirectoryNamespace,
  renderDirectoryManifest,
  renderDirectoryReadme,
  reduceToDirectoryPlugin,
};
