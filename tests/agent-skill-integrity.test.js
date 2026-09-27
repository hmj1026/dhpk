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

function parseSkills(source) {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return [];

  const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (end === -1) throw new Error('unterminated YAML frontmatter');

  const frontmatter = lines.slice(1, end);
  const declarations = [];
  for (let index = 0; index < frontmatter.length; index += 1) {
    const match = frontmatter[index].match(/^skills\s*:(.*)$/);
    if (match) declarations.push({ index, value: match[1].trim() });
  }
  if (declarations.length === 0) return [];
  if (declarations.length > 1) throw new Error('unsupported skills syntax: duplicate skills declarations');

  const declaration = declarations[0];
  const unsupported = (detail) => {
    throw new Error(`unsupported skills syntax: ${detail}`);
  };
  const parseItem = (raw) => {
    const item = raw.trim();
    if (!item) unsupported('empty skill entry');

    if (item.startsWith('"') || item.startsWith("'")) {
      const quote = item[0];
      if (item.length < 2 || item[item.length - 1] !== quote) unsupported(`invalid quoted entry '${item}'`);
      const value = item.slice(1, -1);
      if (!value) unsupported('empty skill entry');
      return value;
    }

    if (/[\[\]{},'"#&*!|>]/.test(item)) unsupported(`invalid scalar entry '${item}'`);
    return item;
  };

  if (declaration.value.startsWith('[')) {
    const match = declaration.value.match(/^\[([^\]]*)\]\s*$/);
    if (!match) unsupported('expected an inline array or block list');
    const contents = match[1].trim();
    if (!contents) return [];
    const items = contents.split(',');
    if (items[items.length - 1].trim() === '') items.pop();
    if (items.some((item) => !item.trim())) unsupported('invalid inline array');
    return items.map(parseItem);
  }
  if (declaration.value) unsupported('expected an inline array or block list');

  const skills = [];
  for (const line of frontmatter.slice(declaration.index + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const item = line.match(/^\s+-\s*(.*?)\s*$/);
    if (!item) unsupported(`expected a block-list item, found '${line.trim()}'`);
    skills.push(parseItem(item[1]));
  }
  if (skills.length === 0) unsupported('expected an inline array or block list');
  return skills;
}

function staleSkillReferences(file, source, canonical) {
  return parseSkills(source)
    .filter((skill) => !EXTERNAL_SKILLS.has(skill) && !canonical.has(skill))
    .map((skill) => `${file}: ${skill}`);
}

test('multiline agent skills are read from frontmatter, not body examples', () => {
  const source = [
    '---',
    'name: example-agent',
    'skills:',
    '  - stale-skill',
    '---',
    '',
    'Example configuration:',
    'skills: [body-example]',
  ].join('\n');

  const canonical = new Set(INVENTORY.skills.map((entry) => entry.name));
  assert.deepStrictEqual(
    staleSkillReferences('example-agent.md', source, canonical),
    ['example-agent.md: stale-skill'],
  );
});

test('inline agent skills arrays remain supported', () => {
  const source = ['---', 'skills: ["first-skill", second-skill]', '---'].join('\n');
  assert.deepStrictEqual(parseSkills(source), ['first-skill', 'second-skill']);
});

test('unsupported agent skills syntax fails visibly', () => {
  const source = ['---', 'skills: single-skill', '---'].join('\n');
  assert.throws(() => parseSkills(source), /unsupported skills syntax/);
});

test('every local agent skills[] entry resolves to a canonical current skill name', () => {
  const canonical = new Set(INVENTORY.skills.map((entry) => entry.name));
  const agentFiles = fs.readdirSync(path.join(ROOT, 'agents'))
    .filter((name) => name.endsWith('.md') && name !== 'INDEX.md');
  const stale = [];
  for (const file of agentFiles) {
    const source = fs.readFileSync(path.join(ROOT, 'agents', file), 'utf8');
    stale.push(...staleSkillReferences(file, source, canonical));
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
