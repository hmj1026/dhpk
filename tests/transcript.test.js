'use strict';

// Coverage for scripts/hooks/_lib/transcript.sh: extract_transcript_path().

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'scripts', 'hooks', '_lib', 'transcript.sh');

function sh(cmd, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  delete env.CLAUDE_TRANSCRIPT_PATH;
  Object.assign(env, extraEnv || {});
  return spawnSync('bash', ['-c', `source "${LIB}"; ${cmd}`], { encoding: 'utf8', timeout: 10000, env });
}

test('extracts transcript_path from a JSON payload', () => {
  const payload = JSON.stringify({ transcript_path: '/tmp/session-transcript.jsonl' });
  const res = sh(`extract_transcript_path '${payload}'`);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), '/tmp/session-transcript.jsonl');
});

test('falls back to legacy "transcript" key when transcript_path is absent', () => {
  const payload = JSON.stringify({ transcript: '/tmp/legacy.jsonl' });
  const res = sh(`extract_transcript_path '${payload}'`);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), '/tmp/legacy.jsonl');
});

test('falls back to CLAUDE_TRANSCRIPT_PATH env when payload has neither key', () => {
  const payload = JSON.stringify({ other: 'field' });
  const res = sh(`extract_transcript_path '${payload}'`, { CLAUDE_TRANSCRIPT_PATH: '/tmp/env-fallback.jsonl' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), '/tmp/env-fallback.jsonl');
});

test('malformed JSON payload (edge case) returns empty string, not a crash', () => {
  const res = sh("extract_transcript_path 'not json{{{'; echo \"EXIT:$?\"");
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.endsWith('EXIT:0\n') || res.stdout.trim() === 'EXIT:0', res.stdout);
});

run('transcript');
