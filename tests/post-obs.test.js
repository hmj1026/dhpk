'use strict';

// Coverage for scripts/opsx-apply-resume/post-obs.sh — POSTs a claude-mem
// observation. MUST NOT hit a real network: every case here points
// CLAUDE_MEM_WORKER_PORT at a port nothing is listening on, so the script's
// own health-check (`curl .../health`) fails fast and the graceful-failure
// path ("null", exit 0) is what gets exercised — never a real POST.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'opsx-apply-resume', 'post-obs.sh');
// Port in the "reserved, essentially never listening" range.
const DEAD_PORT = '1';

function mkPayload(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-obs-'));
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return { dir, file };
}

function runScript(args, env) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_MEM_WORKER_PORT: DEAD_PORT, ...env },
  });
}

test('worker unreachable → graceful failure: prints "null", exits 0, no throw', () => {
  const { dir, file } = mkPayload({ title: 't', content: 'c', concepts: ['x'] });
  try {
    const res = runScript([file]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing payload-file argument → error, exit 1 (no network attempt)', () => {
  const res = runScript([]);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stdout.includes('ERROR: payload file argument required'));
});

test('nonexistent payload file → error, exit 1', () => {
  const res = runScript(['/no/such/payload.json']);
  assert.strictEqual(res.status, 1);
  assert.ok(res.stdout.includes('ERROR: payload file not found'));
});

test('payload-construction path: title/content/concepts are read via jq even when worker is down', () => {
  // Even though the health check fails first, this asserts the payload file
  // itself is well-formed enough for the script's jq extraction to not error
  // before reaching the health check (i.e. no early crash on parsing).
  const { dir, file } = mkPayload({ title: 'hello', content: 'world', concepts: ['alpha', 'beta'] });
  try {
    const res = runScript([file]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'null');
    assert.strictEqual(res.stderr.trim(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

run('post-obs');
