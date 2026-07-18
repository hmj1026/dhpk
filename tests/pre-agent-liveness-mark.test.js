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
    const pending = markerLines(repo, '.pending-review');
    assert.strictEqual(pending.length, 1);
    assert.match(pending[0], /^\d+ arm-on-dispatch:code-reviewer \[arm-on-dispatch\]$/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('known reviewer dispatch does not touch an already-armed sentinel', () => {
  const repo = mkTempRepo();
  try {
    fs.mkdirSync(sessDir(repo), { recursive: true });
    const sentinel = path.join(sessDir(repo), '.pending-doc-review');
    const original = '2026-07-18 12:00 docs/Guide.md\n';
    fs.writeFileSync(sentinel, original);
    const res = runHook(repo, { tool_input: { subagent_type: 'doc-reviewer' } });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), original);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('fast-worker variants append shared liveness entries', () => {
  const repo = mkTempRepo();
  try {
    for (const agent of ['fast-worker', 'dhpk:codex-fast-worker', 'agy-fast-worker']) {
      const res = runHook(repo, { tool_input: { subagent_type: agent } });
      assert.strictEqual(res.status, 0, `hook failed for ${agent}: ${res.stderr}`);
    }
    const lines = markerLines(repo, '.active-fast-worker');
    assert.strictEqual(lines.length, 3, JSON.stringify(lines));
    assert.match(lines[0], /^\d+ fast-worker /);
    assert.match(lines[1], /^\d+ dhpk:codex-fast-worker /);
    assert.match(lines[2], /^\d+ agy-fast-worker /);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('ordinary non-reviewer dispatch remains a no-op', () => {
  const repo = mkTempRepo();
  try {
    const res = runHook(repo, { tool_input: { subagent_type: 'planner' } });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(sessDir(repo)));
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
