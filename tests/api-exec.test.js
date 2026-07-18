'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const SCRIPT = path.join(__dirname, '..', 'skills', 'feature-verify', 'scripts', 'api-exec.sh');

test('executes one request with evidence fields and a request ID', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-api-exec-'));
  try {
    const bin = path.join(tmp, 'bin');
    const log = path.join(tmp, 'curl.log');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$*" > "$CURL_LOG"\nprintf \'{"ok":true}\\n__DHPK_META__ 200 0.125\'\n', { mode: 0o755 });
    const res = spawnSync('bash', [SCRIPT, 'POST', 'https://test.invalid/query', '{"id":0}'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CURL_LOG: log },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const call = fs.readFileSync(log, 'utf8');
    assert.ok(call.includes('-X POST'));
    assert.ok(call.includes('X-Request-ID: feature-verify-'));
    assert.ok(call.includes('--data {"id":0}'));
    assert.ok(res.stdout.includes('http_code=200'));
    assert.ok(res.stdout.includes('latency_seconds=0.125'));
    assert.ok(res.stdout.includes('body={"ok":true}'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('rejects mutating methods before invoking curl', () => {
  const res = spawnSync('bash', [SCRIPT, 'DELETE', 'https://test.invalid/resource'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 2);
  assert.ok(res.stderr.includes('GET or allowlisted POST'));
});

test('propagates curl transport failures without emitting evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-api-exec-'));
  try {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\necho "curl: connection failed" >&2\nexit 7\n', { mode: 0o755 });
    const res = spawnSync('bash', [SCRIPT, 'GET', 'https://test.invalid/health'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.strictEqual(res.status, 7);
    assert.ok(res.stderr.includes('curl: connection failed'));
    assert.strictEqual(res.stdout, '');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

run('api-exec');
