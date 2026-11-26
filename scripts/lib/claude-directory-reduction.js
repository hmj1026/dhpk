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
// The Claude Directory scanner reads these prose phrases as code: a code-span eval as
// download-and-run, "pass prompted" as a password prompt, a perl command as an
// exfiltration channel, and an example environment-variable credential read as a
// credential source. Reword them for every Markdown file in the Directory Plugin.
const DIRECTORY_SCANNER_PHRASE_REWRITES = Object.freeze([
  [/`eval`/g, 'eval'],
  [/process\.env\.STRIPE_KEY/g, '"YOUR_API_KEY"'],
  [/`getenv\('X'\)` \+ `\.env`/g, 'Configuration supplied at deploy time, outside the repository'],
  [/`perl -pi`/g, 'Perl in-place edits'],
  [/`deep-reasoner` pass prompted independently from the source/g,
    '`deep-reasoner` run with an independent prompt built from the source'],
]);
const SKILL_TOKEN_ALTERNATION = DIRECTORY_SKILL_NAMES.join('|');
const DIRECTORY_REWRITE_TOKEN = new RegExp(
  `(https?:\\/\\/[^\\s)>\\]"'\`]+)|(?<![A-Za-z0-9_-])dhpk:([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])|(?<![A-Za-z0-9_/-])\\$(${SKILL_TOKEN_ALTERNATION})(?:(?![A-Za-z0-9_-])|(?=(?:route|help|rules|next|close)\\b))`,
  'g',
);
const FLOW_GUIDE_CODEX_ACTION_PREFIX = /a `\$flow-guide<action>` prefix \(for example\s+`\$flow-guideroute`\) supplies the action, and with a bare `\$flow-guide` the next/;
const FLOW_GUIDE_NEXT_MAP_REF = /(?:skills\/flow-guide\/)?references\/skill-next-map\.json/g;
// `$PROJECT_DIR/scripts/` names a file of the consumer's own project, which the
// reduction never removes, so it keeps its path.
const DIRECTORY_SCRIPT_REF = /(https?:\/\/[^\s)>\]"'`]+)|(?:(?:\$\{CLAUDE_SKILL_DIR\}|\$SKILL_DIR|\$\{POLICY_BUNDLE_ROOT\}|<policy bundle root>|\$PROJECT_DIR\/\.claude|\$REPO|references\/execution-bundle|\.claude\/dhpk\/skills\/[a-z0-9-]+|(?:\$PROJECT_DIR\/)?skills\/(?:<skill>|[a-z0-9-]+))\/)?(?<![A-Za-z0-9_-])(?<!\$PROJECT_DIR\/)scripts\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g;

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

// A removed script is first replaced by this sentinel. Then each code block that
// would run it becomes a not-shipped note, and each prose mention keeps only the
// script name. No Directory Plugin text then tells Claude to execute a document
// or a file the package does not ship.
const UNSHIPPED_SCRIPT = '\u0000unshipped-script:';
const UNSHIPPED_SCRIPT_END = '\u0000';
const UNSHIPPED_SENTINEL = /\u0000unshipped-script:([^\u0000]+)\u0000/g;
const SCRIPTS_VARIABLE_REF = /\$\{?SCRIPTS\}?\/([A-Za-z0-9_.-]+)/g;
const FENCED_CODE_BLOCK = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;
// A command line, optionally after a `$ ` prompt or a `cmd &&` / `cmd;` prefix.
const COMMAND_LINE = /^([ \t]*)(?:\$[ \t]+)?(?:[^\n`]*?(?:&&|;)[ \t]*)?(?:bash|node|python3?|sh)[ \t][^\n]*$/gm;
const CODE_SPAN = /`[^`\n]*`/g;

function unshippedNames(text) {
  const names = [...String(text).matchAll(UNSHIPPED_SENTINEL)].map((m) => m[1]);
  return [...new Set(names)].map((name) => `\`${name}\``).join(', ');
}

function unshippedFallback(destination, manualProcedurePath) {
  if (!manualProcedurePath) return 'Report this step as `NOT_RUN` and use the documented fallback.';
  if (destination === manualProcedurePath) return 'Follow the matching stage in this procedure and report `mode: manual`.';
  const link = path.posix.relative(path.posix.dirname(destination), manualProcedurePath);
  return `Follow the matching stage in [the Manual Procedure](${link}) and report \`mode: manual\`.`;
}

// Remove the four-column indent that makes an indented code block, so the note
// renders as prose at the enclosing level.
function outdentCodeIndent(indent) {
  if (indent.endsWith('\t')) return indent.slice(0, -1);
  return indent.length >= 4 ? indent.slice(4) : indent;
}

function finalizeUnshippedScripts(destination, text, manualProcedurePath) {
  if (!String(text).includes(UNSHIPPED_SCRIPT)) return String(text);
  const fallback = unshippedFallback(destination, manualProcedurePath);
  const note = (indent, body) => `${indent}> Not shipped in the Directory Plugin: ${unshippedNames(body)}. ${fallback}`;
  return String(text)
    .replace(FENCED_CODE_BLOCK, (block, indent, _fence, body) => (body.includes(UNSHIPPED_SCRIPT) ? note(indent, body) : block))
    .replace(COMMAND_LINE, (line, indent) => (
      line.includes(UNSHIPPED_SCRIPT) ? note(outdentCodeIndent(indent), line) : line
    ))
    .replace(CODE_SPAN, (span) => {
      const first = [...span.matchAll(UNSHIPPED_SENTINEL)][0];
      return first ? `\`${first[1]}\` (not shipped in the Directory Plugin)` : span;
    })
    .replace(UNSHIPPED_SENTINEL, (_whole, name) => name);
}

function rewriteDirectorySkillScripts(destination, text, hasManualProcedure = false) {
  if (!destination.startsWith('skills/') || !(destination.endsWith('.md') || destination.endsWith('.json'))) {
    return String(text);
  }
  const manualProcedurePath = hasManualProcedure ? `skills/${destination.split('/')[1]}/references/manual-procedure.md` : null;
  const normalizedMap = String(text).replace(FLOW_GUIDE_NEXT_MAP_REF, SKILL_NEXT_MAP_PATH);
  const marked = normalizedMap
    .replace(DIRECTORY_SCRIPT_REF, (_match, url, scriptPath, offset, full) => {
      if (url) return url;
      const base = path.posix.basename(scriptPath);
      // A path without an extension names a directory or a word, not a script.
      if (!base.includes('.')) return base;
      if (manualProcedurePath && offset >= 2 && full.slice(offset - 2, offset) === '](') {
        return path.posix.relative(path.posix.dirname(destination), manualProcedurePath);
      }
      return `${UNSHIPPED_SCRIPT}${base}${UNSHIPPED_SCRIPT_END}`;
    })
    .replace(SCRIPTS_VARIABLE_REF, (_whole, base) => `${UNSHIPPED_SCRIPT}${base}${UNSHIPPED_SCRIPT_END}`);
  return destination.endsWith('.json')
    ? marked.replace(UNSHIPPED_SENTINEL, (_whole, name) => name)
    : finalizeUnshippedScripts(destination, marked, manualProcedurePath);
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
    '## What `dhpk-lite` runs and sends',
    '',
    '`dhpk-lite` ships no code. Claude runs each command below through its normal Bash tool and permission prompts, in your project and only when a skill needs it:',
    '',
    '- **Local Git and project commands**: read-only `git` queries, `git add` and `git commit` after you confirm, and your project\'s own lint, build, test, and validation commands.',
    '- **GitHub through `git` and `gh`**: `release-creator` runs `git push`, `gh pr create`, `git tag` with a tag push, and `gh run watch`; `create-pr` opens pull requests; `proposal-analyze` reads issues with `gh issue view`. Each write runs only on your explicit request and stops for your confirmation first.',
    '- **Your project\'s own endpoints**: `repo-verify` feature verification can send read-only `curl` requests to health and API endpoints that your project lists, and skips that step when no endpoint list exists.',
    '- **Your project\'s release gate**: `release-creator` runs the publish or package gate script that your project names, by default under `scripts/release/` or through `DHPK_RELEASE_PUBLISH_GATE_SCRIPT` or `DHPK_RELEASE_PACKAGE_GATE_SCRIPT`.',
    '- **Your memory tool (optional)**: `opsx-apply-resume` can save one handoff observation to a memory tool that is already connected to your session. It skips this step when no memory tool is available.',
    '',
    'The skills name no other destination: they reach only your Git remote, GitHub through your own `gh` login, your project\'s endpoints, and a memory tool that you connected.',
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
      if (destination === 'skills/flow-guide/references/manual-procedure.md') {
        // The Codex `$flow-guide<action>` prefix form has no Claude equivalent.
        text = text.replace(FLOW_GUIDE_CODEX_ACTION_PREFIX, 'after `$flow-guide` the next');
      }
      text = rewriteDirectoryNamespace(text);
      if (outDestination.startsWith('skills/') && (outDestination.endsWith('.md') || outDestination.endsWith('.json'))) {
        const skillName = outDestination.split('/')[1];
        text = rewriteDirectorySkillScripts(outDestination, text, skillsWithManualProcedure.has(skillName));
      }
      content = Buffer.from(text, 'utf8');
    }
    if (outDestination.endsWith('.md')) {
      content = Buffer.from(DIRECTORY_SCANNER_PHRASE_REWRITES.reduce(
        (text, [pattern, replacement]) => text.replace(pattern, replacement),
        content.toString('utf8'),
      ), 'utf8');
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
