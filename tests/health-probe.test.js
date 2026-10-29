'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const SCRIPT = path.join(__dirname, '..', 'skills', 'feature-verify', 'scripts', 'health-probe.sh');

function fixture(codes) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-health-probe-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(tmp, 'codes'), `${codes.join('\n')}\n`);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nhead -n 1 "$CODES_FILE"\ntail -n +2 "$CODES_FILE" > "$CODES_FILE.next"\nmv "$CODES_FILE.next" "$CODES_FILE"\n', { mode: 0o755 });
  return { tmp, bin, codesFile: path.join(tmp, 'codes') };
}

test('retries until a 2xx/3xx response and reports the successful attempt', () => {
  const f = fixture(['000', '503', '204']);
  try {
    const res = spawnSync('bash', [SCRIPT, 'https://test.invalid/health'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, CODES_FILE: f.codesFile },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.ok(res.stdout.includes('reachable=true'));
    assert.ok(res.stdout.includes('attempt=3'));
    assert.ok(res.stdout.includes('http_code=204'));
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
});

test('fails closed after exactly three unsuccessful attempts', () => {
  const f = fixture(['000', '500', '404', '200']);
  try {
    const res = spawnSync('bash', [SCRIPT, 'https://test.invalid/health'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, CODES_FILE: f.codesFile },
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('reachable=false'));
    assert.ok(res.stdout.includes('attempts=3'));
    assert.strictEqual(fs.readFileSync(f.codesFile, 'utf8').trim(), '200');
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
});

run('health-probe');
