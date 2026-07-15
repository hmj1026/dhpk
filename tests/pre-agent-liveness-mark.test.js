'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { mkRepo, sessionsDir: sessDir, runHook: runHookRaw } = require('./_lib/hookharness');

const HOOK = 'pre-agent-liveness-mark.sh';

function mkTempRepo() {
  return mkRepo({ prefix: 'dhpk-agent-live-' });
}

function markerLines(repo, name) {
  const file = path.join(sessDir(repo), name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function runHook(repo, payload) {
  return runHookRaw(HOOK, {
    payload,
    cwd: repo,
    projectDir: repo,
    deleteEnv: ['CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS'],
  });
}

test('known reviewer dispatch appends one timestamped liveness marker entry', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { subagent_type: 'code-reviewer' } });
    assert.strictEqual(res.status, 0, `hook failed: ${res.stderr}`);
    const lines = markerLines(repo, '.active-review');
    assert.strictEqual(lines.length, 1, `expected one active marker line, got ${JSON.stringify(lines)}`);
    assert.match(lines[0], /^\d+ code-reviewer /, `expected timestamped code-reviewer entry: ${lines[0]}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('non-reviewer dispatch is a no-op with no sessions directory write', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { subagent_type: 'fast-worker' } });
    assert.strictEqual(res.status, 0, `hook failed: ${res.stderr}`);
    assert.ok(!fs.existsSync(sessDir(repo)), 'non-reviewer dispatch must not create sessions directory');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('known reviewer dispatch targets the matching per-reviewer active marker', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { subagent_type: 'database-reviewer' } });
    assert.strictEqual(res.status, 0, `hook failed: ${res.stderr}`);
    assert.strictEqual(markerLines(repo, '.active-db-review').length, 1,
      'database-reviewer dispatch should write .active-db-review');
    assert.deepStrictEqual(markerLines(repo, '.active-review'), [],
      'database-reviewer dispatch must not write .active-review');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('plugin-namespaced dispatch identity matches via namespace-stripped comparison', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { subagent_type: 'dhpk:code-reviewer' } });
    assert.strictEqual(res.status, 0, `hook failed: ${res.stderr}`);
    const lines = markerLines(repo, '.active-review');
    assert.strictEqual(lines.length, 1, `expected one active marker line, got ${JSON.stringify(lines)}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

run('pre-agent-liveness-mark');
