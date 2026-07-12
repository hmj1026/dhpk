'use strict';

// Coverage for scripts/validate/validate-harness.sh — plugin-source-mode
// asset validator. Two parts:
//   1. Behavioral: run it against the REAL repo (read-only checks; it never
//      writes) and assert the documented PASS/WARN/FAIL summary shape.
//   2. Fixture negative case: a scratch plugin-source tree with an agent
//      missing `name:` frontmatter must produce a [FAIL] and exit 1.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'validate', 'validate-harness.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('running against the real repo reports the section headers + a PASS/WARN/FAIL summary', () => {
  const res = spawnSync('bash', [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  // Documented exit codes: 0 = all green, 1 = errors, 2 = warnings (non-blocking).
  assert.ok([0, 1, 2].includes(res.status), `unexpected exit code ${res.status}:\n${res.stdout}`);
  assert.ok(res.stdout.includes('== 1. Agents frontmatter =='), 'missing section 1 header');
  assert.ok(res.stdout.includes('== 7. Route table SSOT =='), 'missing section 7 header');
  assert.ok(/^(PASS|PASS \(with warnings\)|FAIL): /m.test(res.stdout), `no summary line found:\n${res.stdout}`);
  // Plugin-source mode detection: this repo has agents/ + .claude-plugin/plugin.json at root.
  assert.ok(res.stdout.includes('plugin source 模式'), 'did not detect plugin-source mode for this repo');
});

test('fixture: agent missing name: frontmatter fails section 1 with exit 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-harness-fixture-'));
  try {
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture' }));
    fs.mkdirSync(path.join(tmp, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'agents', 'broken.md'), 'description: no name field here\n');
    fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'statusline.sh'), '#!/usr/bin/env bash\n');
    fs.chmodSync(path.join(tmp, 'statusline.sh'), 0o755);

    const res = spawnSync('bash', [SCRIPT], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(res.status, 1, `expected exit 1 (FAIL):\n${res.stdout}`);
    assert.ok(res.stdout.includes('broken.md 缺 name:'), `missing expected FAIL line:\n${res.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('validate-harness');
