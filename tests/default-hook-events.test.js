'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('default hook event manifest exactly matches hooks.json and documents opt-ins separately', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'default-events.json'), 'utf8'));
  assert.deepStrictEqual(defaults.events.slice().sort(), Object.keys(hooks.hooks).sort());
  assert.deepStrictEqual(defaults.events.slice().sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'SubagentStop']);
  assert.ok(defaults.optionalEvents.includes('UserPromptSubmit'));
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'hook-extension.md'), 'utf8');
  assert.match(docs, /default event manifest/i);
  assert.match(docs, /optional.*not.*registered|not.*registered.*optional/i);
});

run('default-hook-events');
