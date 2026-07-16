'use strict';

// Shared, dependency-free asset inventory for CI and manifest validation.
// Schema-specific adapters (Claude plugin.json, Codex plugin.json, marketplace
// entries) remain outside this module; this module owns what exists on disk and
// the small set of SSOT files that describe the plugin surface.

const fs = require('node:fs');
const path = require('node:path');

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function walkFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(filePath, predicate));
    else if (entry.isFile() && predicate(filePath)) out.push(filePath);
  }
  return out.sort();
}

function listDirectories(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function readJson(root, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
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
  const codexSkillDirs = listDirectories(path.join(repoRoot, 'skills'))
    .filter((dir) => /^codex-/.test(path.basename(dir)));
  const mcpCodexSkills = codexSkillDirs.filter((dir) => {
    const skill = path.join(dir, 'SKILL.md');
    return fs.existsSync(skill) && fs.readFileSync(skill, 'utf8').includes('mcp__codex__');
  });
  const codexCommandFiles = fs.existsSync(path.join(repoRoot, 'commands'))
    ? fs.readdirSync(path.join(repoRoot, 'commands')).filter((name) => /^codex-.*\.md$/.test(name)).sort()
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
  collectInventory,
  listAgentFiles,
  listDirectories,
  readJson,
  relativePosix,
  walkFiles,
};
