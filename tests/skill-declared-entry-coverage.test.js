'use strict';

// Complements path-based Markdown discovery with physically present public
// script basenames, without interpreting unrelated example filenames as tools.
const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const inventory = require('../manifests/distribution-inventory.json');
const coverage = require('../manifests/skill-directory-coverage.json').skills;
const ROOT = path.join(__dirname, '..');

test('every script basename declared by a canonical Skill has an explicit coverage role', () => {
  const missing = [];
  for (const skill of inventory.skills) {
    const root = path.join(ROOT, skill.path);
    const content = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
    const record = coverage[skill.id];
    assert.ok(record, `missing coverage row: ${skill.id}`);
    const classified = new Set([...(record.executable_entries || []), ...(record.api_entries || []),
      ...(record.internal_helpers || []), ...(record.inert_scripts || [])].map(item => item.path));
    const stack = ['scripts'];
    while (stack.length) {
      const relative = stack.pop();
      const absolute = path.join(root, relative);
      if (!fs.existsSync(absolute)) continue;
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (['__pycache__', '.cache', 'node_modules'].includes(entry.name)) continue;
        const target = `${relative}/${entry.name}`;
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile() && /\.(?:sh|js|py|swift)$/.test(entry.name)
          && content.includes(`\`${entry.name}\``) && !classified.has(target)) {
          missing.push(`${skill.id}: ${target}`);
        }
      }
    }
  }
  assert.deepStrictEqual(missing, [], `public script basenames lack entry/helper classification:\n${missing.join('\n')}`);
});

run('skill-declared-entry-coverage');
