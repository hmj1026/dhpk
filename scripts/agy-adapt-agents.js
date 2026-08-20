#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TOOL_NAME_MAP = new Map([
  ['Read', 'read_file'],
  ['Write', 'write_to_file'],
  ['Edit', 'replace_file_content'],
  ['Bash', 'run_command'],
  ['Grep', 'grep_search'],
  ['Glob', 'glob'],
  ['WebSearch', 'search_web'],
  ['WebFetch', 'read_url_content'],
  ['Agent', 'invoke_subagent'],
  // Claude's Skill pseudo-tool is a subagent-style dispatch in AGY. Keep the
  // compatibility alias explicit so the complete canonical roster remains
  // loadable while the transform stays fail-closed for unknown tools.
  ['Skill', 'invoke_subagent'],
]);

const MODEL_NAME_MAP = new Map([
  ['opus', 'pro'],
  ['sonnet', 'pro'],
  ['fable', 'flash'],
  ['haiku', 'flash_lite'],
]);

const VALID_AGY_MODELS = new Set(['inherit', 'flash_lite', 'flash', 'pro']);
const SUPPORTED_AGY_TOOLS = new Set([
  ...TOOL_NAME_MAP.values(),
  'list_dir',
  'view_file',
  'replace_file_content',
  'multi_replace_file_content',
  'mcp',
]);
const FRONTMATTER_ALLOWLIST = new Set(['name', 'description', 'tools', 'model']);

function usage() {
  return [
    'Adapt agent frontmatter for the native AGY plugin.',
    '',
    'Usage:',
    '  node scripts/agy-adapt-agents.js [agents-dir]',
    '',
    'Defaults to .gemini/config/plugins/dhpk/agents under the current working directory.',
    'Rewrites tools/model metadata to the AGY contract and removes unsupported Claude fields.'
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const positional = argv.filter(arg => !arg.startsWith('-'));
  if (positional.length > 1) {
    throw new Error('Expected at most one agents directory argument');
  }

  return {
    help: false,
    agentsDir: path.resolve(positional[0] || path.join(process.cwd(), '.gemini', 'config', 'plugins', 'dhpk', 'agents')),
  };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Agents directory not found: ${dirPath}`);
  }

  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Expected a directory: ${dirPath}`);
  }
}

function stripQuotes(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function splitCommaSeparated(value) {
  const parts = [];
  let current = '';
  let quote = '';

  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char;
      current += char;
      continue;
    }
    if (char === ',' && !quote) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseToolList(line) {
  const match = line.match(/^\s*tools\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  let rawItems = match[1].trim();
  if (rawItems.startsWith('[') && rawItems.endsWith(']')) {
    rawItems = rawItems.slice(1, -1).trim();
  }
  if (!rawItems) {
    return [];
  }

  return splitCommaSeparated(rawItems)
    .map(part => stripQuotes(part))
    .filter(Boolean);
}

function adaptToolName(toolName) {
  const mapped = TOOL_NAME_MAP.get(toolName);
  if (mapped) {
    return mapped;
  }

  if (toolName.startsWith('mcp__')) {
    return toolName
      .replace(/^mcp__/, 'mcp_')
      .replace(/__/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toLowerCase();
  }

  return toolName;
}

function formatToolLine(tools) {
  return `tools: [${tools.map(tool => JSON.stringify(tool)).join(', ')}]`;
}

function parseFrontmatterKey(line) {
  const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  return match ? { key: match[1], value: match[2] } : null;
}

function adaptModel(value, filePath) {
  const model = stripQuotes(value);
  if (!model) return 'inherit';
  const mapped = MODEL_NAME_MAP.get(model) || model;
  if (!VALID_AGY_MODELS.has(mapped)) {
    const location = filePath ? ` in ${filePath}` : '';
    throw new Error(`Unsupported AGY model '${model}'${location}`);
  }
  return mapped;
}

function adaptToolNames(tools, filePath) {
  const adaptedTools = [];
  const seen = new Set();

  for (const sourceTool of tools) {
    const tool = adaptToolName(sourceTool);
    const isMcpTool = tool.startsWith('mcp_');
    if (!SUPPORTED_AGY_TOOLS.has(tool) && !isMcpTool) {
      const location = filePath ? ` in ${filePath}` : '';
      throw new Error(`Unsupported AGY tool '${sourceTool}'${location}`);
    }
    if (seen.has(tool)) continue;
    seen.add(tool);
    adaptedTools.push(tool);
  }

  return adaptedTools;
}

function adaptFrontmatter(text, options = {}) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) {
    return { text, changed: false, droppedFields: [], warnings: [] };
  }

  let changed = false;
  const updatedLines = [];
  const droppedFields = [];
  const warnings = [];
  let sawTools = false;
  let sawModel = false;

  for (const line of match[1].split('\n')) {
    const parsed = parseFrontmatterKey(line);
    if (!parsed) {
      updatedLines.push(line);
      continue;
    }

    if (!FRONTMATTER_ALLOWLIST.has(parsed.key)) {
      droppedFields.push(parsed.key);
      warnings.push(`dropped unsupported AGY field: ${parsed.key}`);
      changed = true;
      continue;
    }

    if (parsed.key === 'tools') {
      const tools = parseToolList(line);
      const updatedLine = formatToolLine(adaptToolNames(tools, options.filePath));
      sawTools = true;
      if (updatedLine !== line) changed = true;
      updatedLines.push(updatedLine);
      continue;
    }

    if (parsed.key === 'model') {
      const updatedLine = `model: ${adaptModel(parsed.value, options.filePath)}`;
      sawModel = true;
      if (updatedLine !== line) changed = true;
      updatedLines.push(updatedLine);
      continue;
    }

    updatedLines.push(line);
  }

  if (!sawTools) {
    updatedLines.push(formatToolLine([]));
    changed = true;
  }
  if (!sawModel) {
    updatedLines.push('model: inherit');
    changed = true;
  }

  if (!changed) {
    return { text, changed: false, droppedFields: [], warnings: [] };
  }

  return {
    text: `---\n${updatedLines.join('\n')}\n---${match[2]}${text.slice(match[0].length)}`,
    changed: true,
    droppedFields: [...new Set(droppedFields)],
    warnings,
  };
}

function adaptAgents(dirPath) {
  ensureDirectory(dirPath);

  let updated = 0;
  let unchanged = 0;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const original = fs.readFileSync(filePath, 'utf8');
    const adapted = adaptFrontmatter(original, { filePath });

    if (adapted.changed) {
      fs.writeFileSync(filePath, adapted.text);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = adaptAgents(options.agentsDir);
  console.log(`Updated ${result.updated} agent file(s); ${result.unchanged} already compatible`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  adaptAgents,
  adaptFrontmatter,
  adaptModel,
  adaptToolName,
  adaptToolNames,
  parseToolList,
};
