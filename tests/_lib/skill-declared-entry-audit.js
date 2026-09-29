'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isRunnableInvocation(content, target, skillPath) {
  const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scriptPath = target.split(path.sep).join('/');
  const skillRoot = skillPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const commandPaths = [scriptPath, `./${scriptPath}`, `$SKILL_DIR/${scriptPath}`, `${skillRoot}/${scriptPath}`]
    .map(escaped).join('|');
  return new RegExp(`\\b(?:bash|sh|node|python3?|swift)\\s+["']?(?:${commandPaths})(?=\\s|["']|\\x60|$)`).test(content);
}

function scanSkillScripts(root, skill, content, record) {
  const classified = new Set([
    ...(record.executable_entries || []),
    ...(record.api_entries || []),
    ...(record.internal_helpers || []),
    ...(record.inert_scripts || []),
  ].map((entry) => entry.path));
  const stack = ['scripts'];
  const scriptPaths = [];
  while (stack.length) {
    const relative = stack.pop();
    const absolute = path.join(root, skill.path, relative);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (['__pycache__', '.cache', 'node_modules'].includes(entry.name)) continue;
      const target = `${relative}/${entry.name}`;
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && /\.(?:sh|js|py|swift)$/.test(entry.name)) scriptPaths.push(target);
    }
  }
  const missing = scriptPaths
    .filter((target) => content.includes(`\`${path.basename(target)}\``) && !classified.has(target))
    .map((target) => `${skill.id}: ${target}`);
  const publicEntries = new Set([...(record.executable_entries || []), ...(record.api_entries || [])]
    .map((entry) => entry.path));
  const misclassified = scriptPaths
    .filter((target) => isRunnableInvocation(content, target, skill.path) && !publicEntries.has(target))
    .map((target) => `${skill.id}: runnable script is not an executable/API entry: ${target}`);
  return { missing, misclassified };
}

function scanCanonicalSkillDeclarations(root, inventory, coverage) {
  const missing = [];
  const misclassified = [];
  for (const skill of inventory.skills) {
    const content = fs.readFileSync(path.join(root, skill.path, 'SKILL.md'), 'utf8');
    const record = coverage[skill.id];
    if (!record) {
      missing.push(`missing coverage row: ${skill.id}`);
      continue;
    }
    const result = scanSkillScripts(root, skill, content, record);
    missing.push(...result.missing);
    misclassified.push(...result.misclassified);
  }
  return { missing, misclassified };
}

module.exports = { scanCanonicalSkillDeclarations, scanSkillScripts };
