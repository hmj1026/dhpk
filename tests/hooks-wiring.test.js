'use strict';

// Every shell script referenced from hooks/hooks.json must exist and be
// executable — a missing or non-executable hook script fails silently at
// runtime, which is exactly the class of breakage this test guards.

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8');

// Collect ${CLAUDE_PLUGIN_ROOT}-relative .sh references from the hook commands.
const refs = [...raw.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+?\.sh)/g)].map((m) => m[1]);

test('hooks.json is valid JSON with a hooks key', () => {
  const parsed = JSON.parse(raw);
  assert.ok(parsed.hooks, 'missing hooks key');
});

test('hooks.json references at least one script', () => {
  assert.ok(refs.length > 0, 'no ${CLAUDE_PLUGIN_ROOT}/...sh references found');
});

test('every referenced hook script exists', () => {
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `missing hook script: ${ref}`);
  }
});

test('every referenced hook script is executable', () => {
  for (const ref of refs) {
    const fp = path.join(ROOT, ref);
    if (!fs.existsSync(fp)) continue; // existence covered above
    const mode = fs.statSync(fp).mode;
    assert.ok(mode & 0o111, `not executable: ${ref}`);
  }
});

run('hooks-wiring');
