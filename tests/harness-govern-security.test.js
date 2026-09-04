'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCENARIOS = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'harness-scenarios.sh');
const TEST_HARNESS = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'test-harness.sh');
const SYNC = path.join(ROOT, 'skills', 'harness-govern', 'scripts', 'multi_ai_sync.py');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-harness-security-'));
}

test('harness diagnostics reject arbitrary roots and do not execute their hooks', () => {
  const root = temporaryRoot();
  try {
    const marker = path.join(root, 'executed');
    fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'hooks', 'pre-bash-guard.sh'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    const result = spawnSync('bash', [SCENARIOS, '--dir', root, '--execute-hooks'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /\.claude|\.codex|allowlisted|repository/i);
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('default harness scenario and test runs never execute project-local hooks', () => {
  const root = temporaryRoot();
  try {
    const marker = path.join(root, 'executed');
    fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'hooks', 'pre-bash-guard.sh'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    for (const script of [SCENARIOS, TEST_HARNESS]) {
      const result = spawnSync('bash', [script, '--dir', '.claude'], { cwd: root, encoding: 'utf8' });
      assert.notStrictEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /NOT_RUN|execute-hooks/i);
    }
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sync apply rejects traversal paths before writing, even in dry-run', () => {
  const root = temporaryRoot();
  try {
    const planPath = path.join(root, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify({
      mappings: [{
        status: 'adapted', target: 'codex', category: 'commands',
        feature_id: 'commands/escape', feature_name: 'escape',
        source_path: '../outside.md', target_path: '../escaped.md',
      }],
    }));
    const result = spawnSync('python3', ['-B', SYNC, '--root', root, 'apply', '--plan', planPath, '--dry-run', '--format', 'json'], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /unsafe|schema|relative|contain|path/i);
    assert.strictEqual(fs.existsSync(path.join(path.dirname(root), 'escaped.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('live sync apply requires the exact reviewed plan digest', () => {
  const root = temporaryRoot();
  try {
    const planPath = path.join(root, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify({ mappings: [] }));
    const result = spawnSync('python3', ['-B', SYNC, '--root', root, 'apply', '--plan', planPath, '--format', 'json'], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /approved-plan-sha256|digest|dry-run/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reviewed live sync rejects symlinked target ancestors before writing', () => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  try {
    fs.mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'commands', 'safe.md'), 'safe\n');
    fs.symlinkSync(outside, path.join(root, '.agent'));
    const planPath = path.join(root, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify({
      mappings: [{
        status: 'adapted', target: 'antigravity', category: 'commands',
        feature_id: 'commands/safe', feature_name: 'safe',
        source_path: '.claude/commands/safe.md', target_path: '.agent/workflows/safe.md',
      }],
    }));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
    const result = spawnSync('python3', [
      '-B', SYNC, '--root', root, 'apply', '--plan', planPath,
      '--approved-plan-sha256', digest, '--format', 'json',
    ], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /symlink|unsafe|failed/i);
    assert.strictEqual(fs.existsSync(path.join(outside, 'workflows', 'safe.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('reviewed whole-skill sync rejects nested destination symlinks', () => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  try {
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'safe', 'references'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'safe', 'SKILL.md'), 'safe\n');
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'safe', 'references', 'payload.md'), 'payload\n');
    fs.mkdirSync(path.join(root, '.codex', 'skills', 'safe'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, '.codex', 'skills', 'safe', 'references'));
    const planPath = path.join(root, 'plan.json');
    fs.writeFileSync(planPath, JSON.stringify({
      mappings: [{
        status: 'adapted', target: 'codex', category: 'skills',
        feature_id: 'skills/safe', feature_name: 'safe',
        source_path: '.claude/skills/safe/SKILL.md', target_path: '.codex/skills/safe/SKILL.md',
      }],
    }));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex');
    const result = spawnSync('python3', [
      '-B', SYNC, '--root', root, 'apply', '--plan', planPath,
      '--approved-plan-sha256', digest, '--format', 'json',
    ], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /symlink|unsafe|failed/i);
    assert.strictEqual(fs.existsSync(path.join(outside, 'payload.md')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('plan approval hashes and parses one regular non-symlink file', () => {
  const root = temporaryRoot();
  try {
    const realPlan = path.join(root, 'plan.json');
    const linkPlan = path.join(root, 'linked-plan.json');
    fs.writeFileSync(realPlan, JSON.stringify({ mappings: [] }));
    fs.symlinkSync(realPlan, linkPlan);
    const result = spawnSync('python3', [
      '-B', SYNC, '--root', root, 'apply', '--plan', linkPlan, '--dry-run', '--format', 'json',
    ], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /unsafe plan|symbolic|symlink|loop/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('harness-govern-security');
