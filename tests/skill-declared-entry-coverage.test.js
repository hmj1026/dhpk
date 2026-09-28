'use strict';

// Complements path-based Markdown discovery with physical script references
// and verifies that executable command examples have public coverage roles.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const inventory = require('../manifests/distribution-inventory.json');
const coverage = require('../manifests/skill-directory-coverage.json').skills;
const ROOT = path.join(__dirname, '..');

function isRunnableInvocation(content, target, skillPath) {
  const escapedPath = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scriptPath = target.split(path.sep).join('/');
  const skillRoot = skillPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const commandPaths = [
    scriptPath,
    `./${scriptPath}`,
    `$SKILL_DIR/${scriptPath}`,
    `${skillRoot}/${scriptPath}`,
  ]
    .map(escapedPath).join('|');
  const command = new RegExp(
    `\\b(?:bash|sh|node|python3?|swift)\\s+["']?(?:${commandPaths})(?=\\s|["']|\\x60|$)`,
  );
  return command.test(content);
}

function misclassifiedRunnableScripts(content, scriptPaths, skillPath, record) {
  const publicPaths = new Set([
    ...(record.executable_entries || []),
    ...(record.api_entries || []),
  ].map((item) => item.path));
  return scriptPaths.filter((target) => (
    isRunnableInvocation(content, target, skillPath) && !publicPaths.has(target)
  ));
}

test('runnable script declarations require public coverage while prose examples stay non-public', () => {
  const content = [
    'Run `node scripts/public.js --help`.',
    'Run `node skills/flow-guide/scripts/public.js`',
    'The `helper.js` module is an internal implementation detail.',
    'The example output contains the filename `sample.js`.',
  ].join('\n');
  const scripts = [
    'scripts/public.js',
    'scripts/helper.js',
    'scripts/sample.js',
    'scripts/internal/public.js',
  ];
  const record = {
    executable_entries: [{ path: 'scripts/public.js' }],
    internal_helpers: [
      { path: 'scripts/helper.js' },
      { path: 'scripts/sample.js' },
      { path: 'scripts/internal/public.js' },
    ],
  };

  assert.deepStrictEqual(
    misclassifiedRunnableScripts(content, scripts, 'skills/flow-guide', record),
    [],
  );
  assert.deepStrictEqual(misclassifiedRunnableScripts(
    'Run `node skills/flow-guide/scripts/public.js`',
    scripts,
    'skills/flow-guide',
    { ...record, executable_entries: [] },
  ), ['scripts/public.js']);
});

test('every script basename declared by a canonical Skill has an explicit coverage role', () => {
  const missing = [];
  const misclassified = [];
  for (const skill of inventory.skills) {
    const root = path.join(ROOT, skill.path);
    const content = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
    const record = coverage[skill.id];
    assert.ok(record, `missing coverage row: ${skill.id}`);
    const classified = new Set([...(record.executable_entries || []), ...(record.api_entries || []),
      ...(record.internal_helpers || []), ...(record.inert_scripts || [])].map(item => item.path));
    const stack = ['scripts'];
    const scriptPaths = [];
    while (stack.length) {
      const relative = stack.pop();
      const absolute = path.join(root, relative);
      if (!fs.existsSync(absolute)) continue;
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (['__pycache__', '.cache', 'node_modules'].includes(entry.name)) continue;
        const target = `${relative}/${entry.name}`;
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile() && /\.(?:sh|js|py|swift)$/.test(entry.name)) {
          scriptPaths.push(target);
          if (content.includes(`\`${entry.name}\``) && !classified.has(target)) {
            missing.push(`${skill.id}: ${target}`);
          }
        }
      }
    }
    misclassified.push(...misclassifiedRunnableScripts(content, scriptPaths, skill.path, record)
      .map((target) => `${skill.id}: runnable script is not an executable/API entry: ${target}`));
  }
  assert.deepStrictEqual(missing, [], `public script basenames lack entry/helper classification:\n${missing.join('\n')}`);
  assert.deepStrictEqual(misclassified, [], `runnable script declarations need public coverage:\n${misclassified.join('\n')}`);
});

run('skill-declared-entry-coverage');
