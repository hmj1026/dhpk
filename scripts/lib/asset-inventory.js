'use strict';

// Shared, dependency-free asset inventory for CI and manifest validation.
// Schema-specific adapters (Claude plugin.json, Codex plugin.json, marketplace
// entries) remain outside this module; this module owns what exists on disk and
// the small set of SSOT files that describe the plugin surface.

const fs = require('node:fs');
const path = require('node:path');
const { readFileBounded, readDirectoryEntries } = require('./bounded-filesystem');

const CODEX_MCP_TOOL_NAMES = Object.freeze([
  'mcp__codex__codex',
  'mcp__codex__codex-reply',
]);
const CODEX_MCP_COMMAND_NAMES = Object.freeze([
  'codex-review.md',
  'codex-review-branch.md',
  'codex-review-doc.md',
  'codex-review-fast.md',
  'codex-security.md',
  'codex-test-gen.md',
  'codex-test-review.md',
  'review-spec.md',
]);

function frontmatterBlock(content) {
  const match = String(content || '').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1] : '';
}

function hasCodexMcpAllowedTool(content) {
  const block = frontmatterBlock(content);
  const lines = block.split(/\r?\n/);
  let inAllowedTools = false;
  for (const line of lines) {
    if (!inAllowedTools || !/^\s/.test(line)) {
      const match = line.match(/^allowed-tools:\s*(.*)$/);
      if (!match) {
        inAllowedTools = false;
        continue;
      }
      inAllowedTools = true;
      if (CODEX_MCP_TOOL_NAMES.some((tool) => match[1].includes(tool))) return true;
      continue;
    }
    if (CODEX_MCP_TOOL_NAMES.some((tool) => line.includes(tool))) return true;
  }
  return false;
}

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkFiles(dir, predicate = () => true, visited = new Set(), depth = 0, budget = {
  files: 0,
  maxFiles: 20000,
  entries: 0,
  maxEntries: 40000,
}) {
  if (!fs.existsSync(dir)) return [];
  if (depth > 64) throw new Error(`maximum inventory directory depth (64) exceeded: ${dir}`);
  if (!Number.isSafeInteger(budget.entries)) budget.entries = 0;
  if (!Number.isSafeInteger(budget.maxEntries)) budget.maxEntries = 40000;
  const realDir = fs.realpathSync(dir);
  if (visited.has(realDir)) return [];
  visited.add(realDir);
  const out = [];
  const entryBudget = {
    accountEntry: () => {
      budget.entries += 1;
      if (budget.entries > budget.maxEntries) throw new Error(`maximum inventory entry count (${budget.maxEntries}) exceeded: ${dir}`);
    },
  };
  for (const entry of readDirectoryEntries(dir, { budget: entryBudget })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc') || entry.name === 'node_modules' || entry.name === '.git') continue;
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(filePath, predicate, visited, depth + 1, budget));
    else if (entry.isFile() && predicate(filePath)) {
      budget.files += 1;
      if (budget.files > budget.maxFiles) {
        throw new Error(`maximum inventory file count (${budget.maxFiles}) exceeded: ${filePath}`);
      }
      out.push(filePath);
    }
  }
  return out.sort();
}

function listDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  return readDirectoryEntries(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function readJson(root, rel) {
  try {
    return JSON.parse(readFileBounded(path.join(root, rel)).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function listAgentFiles(root) {
  const rootAgents = walkFiles(path.join(root, 'agents'),
    (filePath) => filePath.endsWith('.md') && !filePath.endsWith('INDEX.md'));
  const moduleAgents = walkFiles(path.join(root, 'modules'), (filePath) => {
    const rel = relativePosix(root, filePath);
    return /^modules\/[^/]+\/agents\/[^/]+\.md$/.test(rel) && !filePath.endsWith('INDEX.md');
  });
  return [...rootAgents, ...moduleAgents].sort();
}

function collectInventory(root) {
  const repoRoot = path.resolve(root);
  const rootAgentFiles = walkFiles(path.join(repoRoot, 'agents'),
    (filePath) => filePath.endsWith('.md') && !filePath.endsWith('INDEX.md'));
  const moduleAgentFiles = walkFiles(path.join(repoRoot, 'modules'), (filePath) => {
    const rel = relativePosix(repoRoot, filePath);
    return /^modules\/[^/]+\/agents\/[^/]+\.md$/.test(rel) && !filePath.endsWith('INDEX.md');
  });
  const baseSkillFiles = walkFiles(path.join(repoRoot, 'skills'),
    (filePath) => filePath.endsWith('SKILL.md'));
  const moduleSkillFiles = walkFiles(path.join(repoRoot, 'modules'), (filePath) =>
    /^modules\/[^/]+\/skills\/.+\/SKILL\.md$/.test(relativePosix(repoRoot, filePath)));
  const commandFiles = walkFiles(path.join(repoRoot, 'commands'),
    (filePath) => filePath.endsWith('.md') && !filePath.endsWith('INDEX.md'));
  const moduleDirs = listDirectories(path.join(repoRoot, 'modules'));
  const mcpCodexSkills = baseSkillFiles.filter((skill) => {
    return fs.existsSync(skill) && hasCodexMcpAllowedTool(readFileBounded(skill).toString('utf8'));
  });
  const mcpCodexCommandFiles = commandFiles.filter((command) => {
    return fs.existsSync(command) && hasCodexMcpAllowedTool(readFileBounded(command).toString('utf8'));
  });
  const codexCommandFiles = fs.existsSync(path.join(repoRoot, 'commands'))
    ? readDirectoryEntries(path.join(repoRoot, 'commands')).map((entry) => entry.name).filter((name) => CODEX_MCP_COMMAND_NAMES.includes(name)).sort()
    : [];

  const sentinelRegistry = readJson(repoRoot, 'scripts/lib/sentinel-slots.json');
  const hooksManifest = readJson(repoRoot, 'hooks/hooks.json');
  const moduleCatalog = readJson(repoRoot, 'manifests/module-catalog.json');

  return {
    root: repoRoot,
    paths: {
      rootAgents: rootAgentFiles,
      moduleAgents: moduleAgentFiles,
      agents: [...rootAgentFiles, ...moduleAgentFiles].sort(),
      baseSkills: baseSkillFiles,
      moduleSkills: moduleSkillFiles,
      skills: [...baseSkillFiles, ...moduleSkillFiles].sort(),
      commands: commandFiles,
      mcpCodexCommands: mcpCodexCommandFiles.sort(),
    },
    sources: {
      claudePlugin: readJson(repoRoot, '.claude-plugin/plugin.json'),
      codexPlugin: readJson(repoRoot, '.codex-plugin/plugin.json'),
      moduleCatalog,
      sentinelRegistry,
      hooks: {
        events: hooksManifest && hooksManifest.hooks && typeof hooksManifest.hooks === 'object'
          ? Object.keys(hooksManifest.hooks).sort()
          : [],
      },
    },
    counts: {
      agentsTotal: rootAgentFiles.length + moduleAgentFiles.length,
      agentsRoot: rootAgentFiles.length,
      agentsModule: moduleAgentFiles.length,
      skillsTotal: baseSkillFiles.length + moduleSkillFiles.length,
      skillsBase: baseSkillFiles.length,
      skillsModule: moduleSkillFiles.length,
      commands: commandFiles.length,
      mcpCodexCommands: mcpCodexCommandFiles.length,
      modules: moduleDirs.length,
      slotCount: sentinelRegistry && sentinelRegistry.schema === 'dhpk.sentinel-slots.v1' && Array.isArray(sentinelRegistry.slots)
        ? sentinelRegistry.slots.length
        : 0,
      mcpCodexSkills: mcpCodexSkills.length,
      codexCommands: codexCommandFiles.length,
      hookEvents: hooksManifest && hooksManifest.hooks && typeof hooksManifest.hooks === 'object'
        ? Object.keys(hooksManifest.hooks).length
        : 0,
    },
  };
}

module.exports = {
  CODEX_MCP_COMMAND_NAMES,
  CODEX_MCP_TOOL_NAMES,
  collectInventory,
  hasCodexMcpAllowedTool,
  listAgentFiles,
  listDirectories,
  readJson,
  relativePosix,
  walkFiles,
};
