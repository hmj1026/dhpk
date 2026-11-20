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
const DIRECTORY_MANUAL_ENTRY_BODIES = Object.freeze({
  'flow-guide': [
    '# Flow Guide',
    '',
    'Choose one action: help, route, rules, next, or close. Follow the matching stage in',
    '[the Manual Procedure](references/manual-procedure.md) and report `mode: manual`.',
    'Keep routing advisory and retain the action result fields and evidence status.',
    'For implementation, use `/dhpk-lite:flow-drive`.',
  ].join('\n'),
  'harness-setup': [
    '# Harness Setup',
    '',
    'Run this skill only on an explicit user request; otherwise stop and ask before any stage or side effect.',
    'Follow [the Manual Procedure](references/manual-procedure.md) for inspection, dry runs,',
    'and authorized setup. Require user confirmation before writing and use an explicitly',
    'selected local source artifact for asset installation. Report `mode: manual`.',
  ].join('\n'),
  precommit: [
    '# Precommit',
    '',
    'From the consumer repository root, follow [the Manual Procedure](references/manual-procedure.md).',
    'Choose full mode by default or fast mode when requested. For a dry run, report the plan without executing it.',
    'Report the stage results, changed files, and final verdict in `mode: manual`.',
  ].join('\n'),
});
const REFERENCE_ENTRY = 'REFERENCE.md';
const TOP_LEVEL_SKILL_MARKDOWN = /^skills\/[^/]+\/SKILL\.md$/;
const SKILL_MARKDOWN_MENTION = /(?<![\w/.-])((?:\.{1,2}\/|[\w.-]+\/)*)SKILL\.md/g;
const BARE_SKILL_MARKDOWN = /(?<![\w/.-])SKILL\.md/g;

// Public catalog skills shipped by the Directory Plugin (all 17 skills; the 6
// script-backed skills run via references/manual-procedure.md in mode: manual).
const DIRECTORY_SKILL_NAMES = Object.freeze([
  'change-verdict',
  'code-trace',
  'create-pr',
  'doc-maintain',
  'flow-drive',
  'flow-guide',
  'git-smart-commit',
  'git-worktree',
  'harness-setup',
  'library-author',
  'opsx-apply-resume',
  'precommit',
  'proposal-analyze',
  'release-creator',
  'repo-verify',
  'tdd-workflow',
  'ui-ux-verify',
]);

// Reviewed omission list: external CLI agents whose purpose requires an external
// CLI binary (`codex` or `agy`).
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
  '.claude-plugin/icon.png',
  'hooks.json',
  '.mcp.json',
  '.lsp.json',
  'monitors.json',
  'provenance.json',
  'agents/INDEX.md',
]);

const FORBIDDEN_PREFIXES = Object.freeze([
  'hooks/',
  'bin/',
  'scripts/',
  'manifests/',
]);

const SKILL_SCRIPTS_SEGMENT = /^skills\/(?:.+\/)?scripts\//;
const TEXT_REWRITE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);
const SKILL_TOKEN_ALTERNATION = DIRECTORY_SKILL_NAMES.join('|');
const DIRECTORY_REWRITE_TOKEN = new RegExp(
  `(https?:\\/\\/[^\\s)>\\]"'\`]+)|(?<![A-Za-z0-9_-])dhpk:([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_/-])\\$(${SKILL_TOKEN_ALTERNATION})(?:(?![A-Za-z0-9_-])|(?=(?:route|help|rules|next|close)\\b))`,
  'g',
);
const FLOW_GUIDE_NEXT_MAP_REF = /(?:skills\/flow-guide\/)?references\/skill-next-map\.json/g;
const DIRECTORY_SCRIPT_REF = /(https?:\/\/[^\s)>\]"'`]+)|(?:(?:\$\{CLAUDE_SKILL_DIR\}|\$SKILL_DIR|\$\{POLICY_BUNDLE_ROOT\}|<policy bundle root>|\$PROJECT_DIR\/\.claude|\$REPO|references\/execution-bundle|\.claude\/dhpk\/skills\/[a-z0-9-]+|(?:\$PROJECT_DIR\/)?skills\/(?:<skill>|[a-z0-9-]+))\/)?(?<![A-Za-z0-9_-])scripts\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g;

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

function isNestedSkillMarkdown(destination) {
  return destination.startsWith('skills/')
    && destination.endsWith('/SKILL.md')
    && !TOP_LEVEL_SKILL_MARKDOWN.test(destination);
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

function stripYamlFrontmatter(markdownText) {
  const clean = String(markdownText).replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)*/);
  return match ? clean.slice(match[0].length) : clean;
}

function rewriteNestedSkillMentions(filePath, text, entries, dirs) {
  const base = path.posix.dirname(filePath);
  const resolved = String(text).replace(SKILL_MARKDOWN_MENTION, (match, prefix) => {
    const relTarget = path.posix.normalize(path.posix.join(base, `${prefix}SKILL.md`));
    const rootTarget = prefix ? path.posix.normalize(`${prefix}SKILL.md`) : '';
    return (entries.has(relTarget) || (rootTarget && entries.has(rootTarget)))
      ? `${prefix}${REFERENCE_ENTRY}`
      : match;
  });
  return dirs.some((dir) => filePath.startsWith(`${dir}/`))
    ? resolved.replace(BARE_SKILL_MARKDOWN, REFERENCE_ENTRY)
    : resolved;
}

function rewriteDirectorySkillScripts(destination, text, hasManualProcedure = false) {
  if (!destination.startsWith('skills/') || !(destination.endsWith('.md') || destination.endsWith('.json'))) {
    return String(text);
  }
  const normalizedMap = String(text).replace(FLOW_GUIDE_NEXT_MAP_REF, SKILL_NEXT_MAP_PATH);
  const useManualRef = hasManualProcedure && !destination.endsWith('/references/manual-procedure.md');
  return normalizedMap.replace(DIRECTORY_SCRIPT_REF, (match, url, scriptPath, offset, full) => {
    if (url) return url;
    const base = path.posix.basename(scriptPath);
    if (useManualRef) {
      if (offset >= 2 && full.slice(offset - 2, offset) === '](') {
        return 'references/manual-procedure.md';
      }
      return `references/manual-procedure.md (${base})`;
    }
    return `packaged-${base}`;
  });
}

function rewriteDirectoryNamespace(text) {
  return String(text).replace(DIRECTORY_REWRITE_TOKEN, (whole, url, dhpkToken, skillToken) => {
    if (url) return url;
    if (dhpkToken) return `${DIRECTORY_PLUGIN_NAME}:${dhpkToken}`;
    return `/${DIRECTORY_PLUGIN_NAME}:${skillToken}`;
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
  if (manifest.bugs) out.bugs = manifest.bugs;
  if (Array.isArray(manifest.keywords)) out.keywords = manifest.keywords;
  if (Array.isArray(manifest.agents)) {
    out.agents = manifest.agents.filter((entry) => !omittedAgentPaths.has(entry));
  }
  return Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

function renderDirectoryReadme({ skillCount = DIRECTORY_SKILL_NAMES.length, agentCount = null } = {}) {
  const agentPhrase = agentCount === null ? 'specialist agents' : `${agentCount} specialist agents`;
  return Buffer.from([
    '# dhpk-lite (Instruction-only Directory Plugin)',
    '',
    '`dhpk-lite` is the instruction-only distribution of DHPK for Anthropic\'s Claude plugin directory.',
    `It provides all ${skillCount} workflow skills (invoked as \`/dhpk-lite:<skill-name>\`), ${agentPhrase} (\`dhpk-lite:<agent-name>\`),`,
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
    '## How `dhpk-lite` differs from the Full Plugin (`dhpk`)',
    '',
    '- **No hooks (`hooks/hooks.json`)**: no `PreToolUse` `.env`/`.git`/credential guards, no `SessionStart` notice, and no `SubagentStop` verification hook.',
    '- **No shipped scripts or `userConfig`**: omits `scripts/`, `skills/**/scripts/`, `manifests/`, `agents/INDEX.md`, and interactive `userConfig` settings.',
    '- **Manual Procedures (`mode: manual`)**: `flow-guide`, `opsx-apply-resume`, `git-smart-commit`, `harness-setup`, `precommit`, and `release-creator` use their packaged `references/manual-procedure.md` workflows with standard tools and consumer project commands, reporting `mode: manual`.',
    '- **Omitted external CLI agents**: `codex-worker`, `codex-reasoner`, and `agy-worker`.',
    '- **Reduced frontmatter**: skills keep only `name` and `description` (routing data is packaged in `skill-next-map.json`), and agents keep only `name`, `description`, `model`, `color`, and `tools`. Skills lose `disable-model-invocation`, `argument-hint`, and `allowed-tools` (user-only skills carry explicit-request guards).',
    '',
    '## Install the Full Plugin (`dhpk`) and `dhpk-stacks`',
    '',
    'If you want command hooks, local safety gates, scripted runners, or stack modules (`dhpk-stacks`),',
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
    if (isOmittedAgentPath(destination)) continue;
    if (!isAllowedDirectoryFile(destination, file.content)) continue;
    retained.set(destination, file);
  }

  const nestedEntries = new Set([...retained.keys()].filter(isNestedSkillMarkdown));
  const nestedDirs = [...nestedEntries].map((entryPath) => path.posix.dirname(entryPath));
  const skillsWithManualProcedure = new Set(
    [...retained.keys()]
      .map((destination) => /^skills\/([^/]+)\/references\/manual-procedure\.md$/.exec(destination))
      .filter(Boolean)
      .map((match) => match[1]),
  );

  // Extract skill-next routing data from kept top-level skills before stripping
  // their metadata frontmatter.
  const topLevelSkillSources = [];
  for (const [destination, file] of retained) {
    if (TOP_LEVEL_SKILL_MARKDOWN.test(destination)) {
      topLevelSkillSources.push({ path: destination, bytes: Buffer.from(file.content) });
    }
  }
  const skillNextMap = buildRuntimeDataFile(topLevelSkillSources, {
    path: SKILL_NEXT_MAP_PATH,
    requireRuntimeSkill: false,
  });

  const readmeCounts = {
    skillCount: [...retained.keys()].filter((destination) => TOP_LEVEL_SKILL_MARKDOWN.test(destination)).length,
    agentCount: [...retained.keys()].filter((destination) => /^agents\/[^/]+\.md$/.test(destination)).length,
  };
  const reduced = new Map();
  for (const [destination, file] of retained) {
    const outDestination = isNestedSkillMarkdown(destination)
      ? `${path.posix.dirname(destination)}/${REFERENCE_ENTRY}`
      : destination;
    let content = Buffer.from(file.content);
    if (destination === '.claude-plugin/plugin.json') {
      content = renderDirectoryManifest(content, { version });
    } else if (destination === 'README.md') {
      content = renderDirectoryReadme(readmeCounts);
    } else if (TOP_LEVEL_SKILL_MARKDOWN.test(destination)) {
      const skillName = destination.split('/')[1];
      const reducedFm = reduceSkillFrontmatter(content.toString('utf8'), destination);
      const entryFrontmatter = skillName === 'precommit' && skillsWithManualProcedure.has(skillName)
        ? reducedFm.replace(/^description: .+$/m, 'description: "Run the consumer repository pre-commit pipeline in fast or full mode using the Manual Procedure. Report stage results, changed files, and the final verdict."')
        : reducedFm;
      const manualBody = skillsWithManualProcedure.has(skillName) && DIRECTORY_MANUAL_ENTRY_BODIES[skillName];
      const entryText = manualBody
        ? entryFrontmatter.replace(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n[\s\S]*$/, `$1\n\n${manualBody}\n`)
        : entryFrontmatter;
      const text = rewriteDirectorySkillScripts(
        outDestination,
        rewriteDirectoryNamespace(rewriteNestedSkillMentions(destination, entryText, nestedEntries, nestedDirs)),
        skillsWithManualProcedure.has(skillName),
      );
      content = Buffer.from(text, 'utf8');
    } else if (isNestedSkillMarkdown(destination)) {
      const stripped = stripYamlFrontmatter(content.toString('utf8'));
      const skillName = destination.split('/')[1];
      const text = rewriteDirectorySkillScripts(
        outDestination,
        rewriteDirectoryNamespace(rewriteNestedSkillMentions(destination, stripped, nestedEntries, nestedDirs)),
        skillsWithManualProcedure.has(skillName),
      );
      content = Buffer.from(text, 'utf8');
    } else if (/^agents\/[^/]+\.md$/.test(destination)) {
      const reducedFm = reduceAgentFrontmatter(content.toString('utf8'), destination);
      const agentText = destination === 'agents/code-reviewer.md'
        ? reducedFm
          .replace('## Process', [
            'Use local repository evidence. Review credential handling through source, configuration declarations, and tests.',
            'Keep credential stores and live credential values outside the review. Use synthetic fixtures for verification.',
            'Keep the review local and report findings in the current session.',
            '',
            '## Process',
          ].join('\n'))
          .replace(/^1\. \*\*Detect stack\*\*[^\n]*\n(?:   - [^\n]*\n)+/m, [
            '1. **Detect stack** (once per invocation). Use Read and Glob to inspect project files:',
            '   Composer PHP requirements and PHP framework dependencies, Node engine requirements and JavaScript dependencies,',
            '   Swift project or package files, and declared project modules.',
            '',
          ].join('\n'))
          .replace('HTTP `200` / `404`', 'status codes `200` / `404`')
        : reducedFm;
      content = Buffer.from(rewriteDirectoryNamespace(agentText), 'utf8');
    } else if (TEXT_REWRITE_EXTENSIONS.has(path.posix.extname(outDestination).toLowerCase())) {
      let text = content.toString('utf8');
      if (destination === 'agent-traps/database-reviewer/fastapi.md') {
        text = text.replace('pass bind values', 'Use SQLAlchemy bound parameters');
      } else if (destination === 'agent-traps/database-reviewer/ios.md') {
        text = text
          .replace('pass `objectID` + re-fetch', 'Transfer the `objectID` and re-fetch in the destination context')
          .replace('passphrase from Keychain', 'Check source and tests for evidence that the application uses Keychain-backed encryption configuration');
      }
      if (outDestination.endsWith('.md')) {
        text = rewriteNestedSkillMentions(destination, text, nestedEntries, nestedDirs);
      }
      text = rewriteDirectoryNamespace(text);
      if (outDestination.startsWith('skills/') && (outDestination.endsWith('.md') || outDestination.endsWith('.json'))) {
        const skillName = outDestination.split('/')[1];
        text = rewriteDirectorySkillScripts(outDestination, text, skillsWithManualProcedure.has(skillName));
      }
      content = Buffer.from(text, 'utf8');
    }
    reduced.set(outDestination, { destination: outDestination, content, mode: 0o644 });
  }

  if (skillNextMap) {
    const routingData = JSON.parse(rewriteDirectoryNamespace(Buffer.from(skillNextMap.bytes).toString('utf8')));
    reduced.set(SKILL_NEXT_MAP_PATH, {
      destination: SKILL_NEXT_MAP_PATH,
      content: Buffer.from(`${JSON.stringify(routingData, null, 2)}\n`, 'utf8'),
      mode: 0o644,
    });
  }

  return reduced;
}

module.exports = {
  DIRECTORY_PLUGIN_NAME,
  DIRECTORY_DISPLAY_NAME,
  DIRECTORY_SKILL_NAMES,
  SKILL_NEXT_MAP_PATH,
  REFERENCE_ENTRY,
  OMITTED_AGENTS,
  ALLOWED_EXTENSIONS,
  SKILL_FRONTMATTER_KEYS,
  AGENT_FRONTMATTER_KEYS,
  FORBIDDEN_EXACT_PATHS,
  FORBIDDEN_PREFIXES,
  hasShebang,
  isForbiddenDirectoryPath,
  isAllowedExtension,
  isNestedSkillMarkdown,
  isOmittedAgentPath,
  isAllowedDirectoryFile,
  reduceSkillFrontmatter,
  reduceAgentFrontmatter,
  stripYamlFrontmatter,
  rewriteNestedSkillMentions,
  rewriteDirectorySkillScripts,
  rewriteDirectoryNamespace,
  renderDirectoryManifest,
  renderDirectoryReadme,
  reduceToDirectoryPlugin,
};
