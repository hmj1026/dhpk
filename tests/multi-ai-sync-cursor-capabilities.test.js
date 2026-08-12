'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');

test('Cursor validation keeps portable and native capability rows independent', () => {
  const result = spawnSync('python3', [
    path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py'),
    '--root', ROOT,
    'validate', '--targets', 'cursor', '--format', 'json',
  ], { encoding: 'utf8' });
  assert.ok(result.stdout, result.stderr);
  const report = JSON.parse(result.stdout);
  const row = report.results.find((item) => item.platform === 'cursor');
  assert.ok(row, 'cursor result row is required');
  const ids = row.capabilities.map((item) => item.id);
  assert.deepStrictEqual(ids, [
    'cursor.portable.skills',
    'cursor.portable.mcp',
    'cursor.native.rules',
    'cursor.native.agents',
    'cursor.native.commands',
    'cursor.native.hooks',
    'cursor.native.variables',
  ]);
  assert.ok(row.capabilities.every((item) => typeof item.fallback === 'string'));
});

test('Cursor validation reports malformed configured packages as FAIL rather than presence PASS', () => {
  const repo = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-cursor-invalid-package-'));
  try {
    fs.mkdirSync(path.join(repo, 'plugins/dhpk-agent/skills/broken'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/plugin.json'), '{not-json');
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/skills/broken/SKILL.md'), 'not frontmatter');
    const result = spawnSync('python3', [
      path.join(ROOT, 'skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py'),
      '--root', repo, 'validate', '--targets', 'cursor', '--format', 'json',
    ], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'cursor');
    assert.strictEqual(row.final_status, 'FAIL');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.portable.skills').status, 'FAIL');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('Projected Cursor validator fails closed when authoritative scripts are not installed', () => {
  const repo = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dhpk-cursor-projected-validator-'));
  try {
    const projectedScripts = path.join(repo, 'plugins/dhpk/skills/dhpk-cross-agent-sync/scripts');
    fs.cpSync(path.join(ROOT, 'plugins/dhpk/skills/dhpk-cross-agent-sync/scripts'), projectedScripts, { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/skills/demo'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/commands'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude/agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude/settings.local.json'), '{}');
    fs.writeFileSync(path.join(repo, '.claude/skills/demo/SKILL.md'), '# demo');
    fs.writeFileSync(path.join(repo, '.claude/commands/demo.md'), '# demo');
    fs.writeFileSync(path.join(repo, '.claude/agents/demo.md'), '# demo');
    fs.mkdirSync(path.join(repo, 'plugins/dhpk-agent/skills/broken'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/plugin.json'), JSON.stringify({ name: 'dhpk-agent' }));
    fs.writeFileSync(path.join(repo, 'plugins/dhpk-agent/skills/broken/SKILL.md'), 'not frontmatter');
    const result = spawnSync('python3', [
      path.join(projectedScripts, 'multi_ai_sync.py'),
      '--root', repo, 'validate', '--targets', 'cursor', '--format', 'json',
    ], { encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr);
    const report = JSON.parse(result.stdout);
    const row = report.results.find((item) => item.platform === 'cursor');
    assert.strictEqual(row.final_status, 'UNAVAILABLE');
    assert.strictEqual(row.capabilities.find((item) => item.id === 'cursor.portable.skills').status, 'UNAVAILABLE');
    assert.strictEqual(report.gate, 'BLOCKED');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

run('multi-ai-sync-cursor-capabilities');
