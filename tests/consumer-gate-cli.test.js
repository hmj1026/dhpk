'use strict';

// CLI-level coverage for scripts/release/consumer-gate.js. Stubs the `claude`
// and `codex` binaries (same pattern as tests/release-runner.test.js) so
// this suite NEVER touches the real global Claude plugin cache or a real
// Codex install — consumer-gate.js is only ever run for real inside the
// tag-triggered release.yml job, on an ephemeral, clean CI runner.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'release', 'consumer-gate.js');

function mkBinStub(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
}

// PATH containing real node/bash but deliberately excluding wherever the
// real `claude` CLI lives, so "claude absent" is genuinely absent rather
// than relying on ordering against the host's real PATH.
const NODE_BASH_ONLY_PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);

// The codex-sync check verifies the installed manifest version against the
// target; use the real repo's own current version so these tests don't
// depend on a fixture package tree.
const REAL_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

function runCli(env) {
  return spawnSync('node', [CLI, '--version', REAL_VERSION, '--repo-root', ROOT], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('reports Codex sync PASS and Claude/native-marketplace as UNAVAILABLE when claude CLI is absent', () => {
  const res = runCli({ PATH: NODE_BASH_ONLY_PATH });
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'UNAVAILABLE', JSON.stringify(stage));
  assert.ok(stage.failureReasons.some((r) => /claude/i.test(r)));
  assert.ok(stage.artifacts.some((a) => /native.*experimental|experimental.*native/i.test(a)));
});

test('reports overall PASS when the supported Codex sync check succeeds and a stubbed claude CLI reports the install', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"${REAL_VERSION}"}]'; exit 0; fi
exit 0
`);
  const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'PASS', JSON.stringify(stage));
  assert.strictEqual(res.status, 0);
});

test('fails when the stubbed claude CLI reports a version mismatch after install', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-consumer-gate-bin-'));
  mkBinStub(bin, 'claude', `#!/bin/sh
if [ "$1 $2" = "plugin marketplace" ]; then exit 0; fi
if [ "$1 $2" = "plugin install" ]; then exit 0; fi
if [ "$1 $2" = "plugin list" ]; then echo '[{"id":"dhpk@dhpk","version":"0.0.1"}]'; exit 0; fi
exit 0
`);
  const res = runCli({ PATH: `${bin}:${NODE_BASH_ONLY_PATH}` });
  assert.notStrictEqual(res.status, 0);
  const stage = JSON.parse(res.stdout);
  assert.strictEqual(stage.verdict, 'FAIL');
  assert.ok(stage.failureReasons.some((r) => /0\.0\.1/.test(r)));
});

run('consumer-gate-cli');
