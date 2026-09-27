'use strict';

// Behavior coverage for scripts/hooks/postcompact-restore.sh (PostCompact hook).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'postcompact-restore.sh');

function makeScratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-pcr-')));
}

function writeHandoff(scratch, content) {
  const checkpoint = path.join(scratch, '.claude', 'artifacts', 'checkpoints');
  fs.mkdirSync(checkpoint, { recursive: true });
  fs.writeFileSync(path.join(checkpoint, 'handoff-latest.md'), content);
}

function runHook(scratch, profile = '') {
  return spawnSync('/bin/bash', [HOOK], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: scratch,
      DHPK_HOOK_PROFILE: profile,
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: '',
    },
  });
}

test('handoff-latest content is emitted as PostCompact additional context', () => {
  const scratch = makeScratch();
  const handoff = '# Work handoff\n\nBranch: feature/example\nNext: run focused checks.\n';
  try {
    writeHandoff(scratch, handoff);
    const res = runHook(scratch);
    assert.strictEqual(res.status, 0, res.stderr);
    const output = JSON.parse(res.stdout.trim());
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PostCompact');
    assert.ok(output.hookSpecificOutput.additionalContext.includes(handoff.trimEnd()));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('no handoff-latest file produces no output', () => {
  const scratch = makeScratch();
  try {
    const res = runHook(scratch);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
    const sessDir = path.join(scratch, '.claude', 'artifacts', 'sessions');
    assert.ok(!fs.existsSync(sessDir) || fs.readdirSync(sessDir).length === 0,
      'expected no session artifacts when there is no handoff');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('minimal profile suppresses handoff context', () => {
  const scratch = makeScratch();
  try {
    writeHandoff(scratch, '# Work handoff\nThis should remain suppressed.\n');
    const res = runHook(scratch, 'minimal');
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

run('postcompact-restore');
