'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');
const LIB_DIR = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync_lib');
const SYSTEM_PYTHON3 = '/usr/bin/python3';
const CODEX_AGENTS_DIR = path.join(ROOT, '.codex', 'agents');

function haveSystemPython3() {
  return fs.existsSync(SYSTEM_PYTHON3);
}

test('multi_ai_sync self-test passes under the isolation harness interpreter (no tomllib/tomli)', () => {
  if (!haveSystemPython3()) return; // environment without the fixed macOS system interpreter
  const res = spawnSync(SYSTEM_PYTHON3, ['-B', SCRIPT, 'self-test', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const report = JSON.parse(res.stdout);
  assert.strictEqual(report.failed, 0, res.stdout);
  assert.strictEqual(report.passed, 4, res.stdout);
});

test('vendored tomli fallback parses real Codex agent TOML files identically to stdlib tomllib', () => {
  if (!fs.existsSync(CODEX_AGENTS_DIR)) return;
  const tomlFiles = fs
    .readdirSync(CODEX_AGENTS_DIR)
    .filter((name) => name.endsWith('.toml'))
    .slice(0, 5);
  assert.ok(tomlFiles.length > 0, 'expected at least one .codex/agents/*.toml fixture');

  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(LIB_DIR)})
import tomllib
from vendor.tomli import loads as vendor_loads
paths = json.loads(sys.argv[1])
mismatches = []
for p in paths:
    with open(p, 'rb') as fh:
        text = fh.read().decode('utf-8')
    stdlib_result = tomllib.loads(text)
    vendor_result = vendor_loads(text)
    if stdlib_result != vendor_result:
        mismatches.append(p)
print(json.dumps(mismatches))
`;
  const absolutePaths = tomlFiles.map((name) => path.join(CODEX_AGENTS_DIR, name));
  const res = spawnSync('python3', ['-c', script, JSON.stringify(absolutePaths)], {
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.strictEqual(res.status, 0, res.stderr || res.stdout);
  const mismatches = JSON.parse(res.stdout.trim());
  assert.deepStrictEqual(mismatches, [], `vendored tomli disagreed with tomllib on: ${mismatches.join(', ')}`);
});

run('harness-govern-toml-fallback');
