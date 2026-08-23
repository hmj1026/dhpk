#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TOOL_NAME_MAP = new Map([
  ['Read', 'read_file'],
  ['Write', 'write_to_file'],
  ['Edit', 'replace_file_content'],
  ['Bash', 'run_command'],
  ['Grep', 'grep_search'],
  // AGY 1.1.x exposes directory enumeration as `list_dir`; its older
  // `glob` alias is not registered by the current runtime and makes an
  // otherwise valid agent fail before execution.
  ['Glob', 'list_dir'],
  ['glob', 'list_dir'],
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
    'Adapt agent frontmatter in an owner-controlled AGY package staging tree.',
    '',
    'Usage:',
    '  node scripts/agy-adapt-agents.js --staging-root <package-dir>',
    '',
    'The package dir must contain plugin.json, provenance.json, fingerprints.json, and agents/.',
    'The installed ~/.gemini/config/plugins/dhpk tree is never a valid adapter target.',
    'Rewrites tools/model metadata to the AGY contract and removes unsupported Claude fields.'
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const positional = [];
  let stagingRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--staging-root') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error('--staging-root requires a package directory');
      stagingRoot = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    throw new Error('Direct agents-directory arguments are disabled; use --staging-root <package-dir>');
  }
  if (!stagingRoot) {
    throw new Error('--staging-root <package-dir> is required');
  }

  return {
    help: false,
    stagingRoot: path.resolve(stagingRoot),
  };
}

function ensureDirectory(dirPath) {
  assertPhysicalAncestors(dirPath, 'staging package');
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Agents directory not found: ${dirPath}`);
  }

  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Expected a directory: ${dirPath}`);
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertPhysicalAncestors(directory, label) {
  let current = path.resolve(directory);
  while (true) {
    let stat = null;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink()) throw new Error(`symlinked ${label}: ${current}`);
      if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`${label} not found: ${filePath}`);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${filePath}`);
}

function readJsonObject(filePath, label) {
  assertRegularFile(filePath, label);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function packageFiles(packageRoot) {
  const files = [];
  const walk = (directory, relative = '') => {
    assertPhysicalAncestors(directory, 'staging package');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(directory, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`symlinked staging package entry: ${child}`);
      if (stat.isDirectory()) walk(child, childRelative);
      else if (stat.isFile()) files.push(childRelative);
      else throw new Error(`unsupported staging package entry: ${child}`);
    }
  };
  walk(packageRoot);
  return files.sort();
}

function verifyStagingReceipt(packageRoot) {
  const manifest = readJsonObject(path.join(packageRoot, 'plugin.json'), 'staging package plugin.json');
  if (manifest.name !== 'dhpk') throw new Error('staging package plugin.json must declare name dhpk');
  const provenance = readJsonObject(path.join(packageRoot, 'provenance.json'), 'staging package provenance.json');
  if (provenance.schema !== 'dhpk.agy-plugin.v1' || provenance.provenanceSchema !== 'dhpk.platform-provenance.v1') {
    throw new Error('staging package provenance has an unsupported schema');
  }
  if (provenance.owner !== 'plugins/dhpk-agy' || provenance.packageRoot !== 'plugins/dhpk-agy') {
    throw new Error('staging package provenance is not owned by plugins/dhpk-agy');
  }
  const fingerprints = readJsonObject(path.join(packageRoot, 'fingerprints.json'), 'staging package fingerprints.json');
  if (fingerprints.schema !== 'dhpk.agy-plugin.v1' || !fingerprints.files || typeof fingerprints.files !== 'object') {
    throw new Error('staging package fingerprints are invalid');
  }
  const expected = provenance.fingerprints;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new Error('staging package provenance fingerprints are missing');
  if (JSON.stringify(fingerprints.files) !== JSON.stringify(expected)) throw new Error('staging package fingerprint receipts disagree');
  const dataFiles = packageFiles(packageRoot).filter((relative) => !['provenance.json', 'fingerprints.json'].includes(relative));
  const expectedFiles = Object.keys(expected).sort();
  if (JSON.stringify(dataFiles) !== JSON.stringify(expectedFiles)) throw new Error('staging package fingerprints do not cover every package file');
  for (const relative of dataFiles) {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(packageRoot, relative))).digest('hex');
    if (digest !== expected[relative]) throw new Error(`staging package fingerprint mismatch: ${relative}`);
  }
}

function refreshStagingReceipt(packageRoot) {
  const fingerprints = {};
  for (const relative of packageFiles(packageRoot).filter((value) => !['provenance.json', 'fingerprints.json'].includes(value))) {
    fingerprints[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(packageRoot, relative))).digest('hex');
  }
  const provenancePath = path.join(packageRoot, 'provenance.json');
  const provenance = readJsonObject(provenancePath, 'staging package provenance.json');
  provenance.fingerprints = fingerprints;
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`);
  fs.writeFileSync(path.join(packageRoot, 'fingerprints.json'), `${JSON.stringify({ schema: 'dhpk.agy-plugin.v1', files: fingerprints })}\n`);
  verifyStagingReceipt(packageRoot);
}

function resolveStagingAgentsDir(stagingRoot) {
  const packageRoot = path.resolve(stagingRoot);
  const userPluginRoots = [
    path.join(os.homedir(), '.gemini', 'config', 'plugins'),
    process.env.HOME ? path.join(process.env.HOME, '.gemini', 'config', 'plugins') : null,
  ].filter(Boolean);
  if (userPluginRoots.some((root) => isInside(root, packageRoot))) {
    throw new Error(`installation target is not an adapter staging package: ${packageRoot}`);
  }
  if (/(?:^|[\\/])\.gemini[\\/]config[\\/]plugins(?:[\\/]|$)/.test(packageRoot)) {
    throw new Error(`installation target is not an adapter staging package: ${packageRoot}`);
  }
  if (!fs.existsSync(packageRoot)) {
    throw new Error(`staging package directory not found: ${packageRoot}`);
  }
  assertPhysicalAncestors(packageRoot, 'staging package');
  ensureDirectory(packageRoot);
  for (const file of ['plugin.json', 'provenance.json', 'fingerprints.json']) {
    assertRegularFile(path.join(packageRoot, file), `staging package ${file}`);
  }
  const agentsDir = path.join(packageRoot, 'agents');
  ensureDirectory(agentsDir);
  if (!isInside(packageRoot, agentsDir)) throw new Error(`agents directory escapes staging package: ${agentsDir}`);
  verifyStagingReceipt(packageRoot);
  return agentsDir;
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
  const agentsDir = path.resolve(dirPath);
  const packageRoot = path.dirname(agentsDir);
  const validatedAgentsDir = resolveStagingAgentsDir(packageRoot);
  if (validatedAgentsDir !== agentsDir) throw new Error(`agents directory must be the direct staging package child: ${agentsDir}`);

  let updated = 0;
  let unchanged = 0;

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const filePath = path.join(agentsDir, entry.name);
    const original = fs.readFileSync(filePath, 'utf8');
    const adapted = adaptFrontmatter(original, { filePath });

    if (adapted.changed) {
      fs.writeFileSync(filePath, adapted.text);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  if (updated > 0) refreshStagingReceipt(packageRoot);

  return { updated, unchanged };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = adaptAgents(resolveStagingAgentsDir(options.stagingRoot));
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
