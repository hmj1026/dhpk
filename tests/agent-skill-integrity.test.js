'use strict';

// Task 2 round-1 contract: local Claude agent frontmatter may name only the
// current canonical public skill packages. This catches stale pre-migration
// names even though normal route/path validation does not parse agent skills[].

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifests', 'distribution-inventory.json'), 'utf8'));
const EXTERNAL_SKILLS = new Set(['playwright-cli', 'openspec-new-change']);

function parseSkills(frontmatter) {
  const match = frontmatter.match(/^skills:\s*\[([^\]]*)\]\s*$/m);
  if (!match) return [];
  return match[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

test('every local agent skills[] entry resolves to a canonical current skill name', () => {
  const canonical = new Set(INVENTORY.skills.map((entry) => entry.name));
  const agentFiles = fs.readdirSync(path.join(ROOT, 'agents'))
    .filter((name) => name.endsWith('.md') && name !== 'INDEX.md');
  const stale = [];
  for (const file of agentFiles) {
    const source = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    for (const skill of parseSkills(source)) {
      if (EXTERNAL_SKILLS.has(skill)) continue;
      if (!canonical.has(skill)) stale.push(`${file}: ${skill}`);
    }
  }
  assert.deepStrictEqual(stale, [], `stale agent skill references: ${stale.join(', ')}`);
});

test('operational files do not retain bare moved-package paths', () => {
  const oldPaths = [];
  for (const entry of INVENTORY.skills) {
    for (const legacy of entry.legacy_names || []) {
      if (legacy === entry.name) continue;
      for (const profile of entry.profiles || []) {
        if (profile !== 'core') oldPaths.push(`modules/${profile}/skills/${legacy}`);
      }
      oldPaths.push(`skills/${legacy}`);
      oldPaths.push(`codex/skills/${legacy}`);
      oldPaths.push(`.claude/skills/${legacy}`);
      oldPaths.push(`.codex/skills/${legacy}`);
    }
  }
  const roots = [
    'agents', 'agent-traps', 'commands', 'rules', 'scripts', 'skills', 'modules',
  ];
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile()) files.push(candidate);
    }
  };
  for (const root of roots) walk(path.join(ROOT, root));
  for (const file of ['RELEASE.md', '.claude/settings.json']) {
    if (fs.existsSync(path.join(ROOT, file))) files.push(path.join(ROOT, file));
  }
  const stale = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const oldPath of oldPaths) {
      if (source.includes(oldPath)) stale.push(`${path.relative(ROOT, file)}: ${oldPath}`);
    }
  }
  assert.deepStrictEqual(stale, [], `stale operational moved-package paths: ${stale.join(', ')}`);
});

run('agent-skill-integrity');
