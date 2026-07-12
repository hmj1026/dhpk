'use strict';

// Coverage for scripts/lib/pre-route.sh — deterministic query -> route-table
// matcher. Asserts all three documented output paths (MATCH / NO_MATCH /
// NO_QUERY) using a scratch DHPK_ROUTE_TABLE override so it never depends on
// the real route-table.json contents drifting.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lib', 'pre-route.sh');

function mkTable() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-route-'));
  const table = path.join(tmp, 'route-table.json');
  fs.writeFileSync(
    table,
    JSON.stringify({
      rules: [{ pattern: 'fix\\s+the\\s+bug', skill: 'dhpk:adaptive-dev-workflow', label: 'bugfix' }],
    })
  );
  return { tmp, table };
}

function runRoute(args, env) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

test('MATCH: query matching a rule prints MATCH<TAB>skill<TAB>label and exits 0', () => {
  const { tmp, table } = mkTable();
  try {
    const res = runRoute(['please fix the bug now'], { DHPK_ROUTE_TABLE: table });
    assert.strictEqual(res.status, 0, res.stderr);
    const parts = res.stdout.trim().split('\t');
    assert.deepStrictEqual(parts, ['MATCH', 'dhpk:adaptive-dev-workflow', 'bugfix']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('NO_MATCH: query matching no rule prints NO_MATCH and exits 0', () => {
  const { tmp, table } = mkTable();
  try {
    const res = runRoute(['make me a sandwich'], { DHPK_ROUTE_TABLE: table });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.strictEqual(res.stdout.trim(), 'NO_MATCH');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('NO_QUERY: no args and no stdin prints NO_QUERY and exits 0', () => {
  // Redirect stdin from /dev/null so the script's `[ ! -t 0 ]` stdin-read
  // branch sees EOF immediately rather than blocking on the test runner's tty.
  const res = spawnSync('bash', ['-c', `bash "${SCRIPT}" < /dev/null`], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'NO_QUERY');
});

test('missing route table degrades to NO_MATCH (fail-soft)', () => {
  const res = runRoute(['please fix the bug now'], { DHPK_ROUTE_TABLE: '/no/such/table.json' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout.trim(), 'NO_MATCH');
});

run('pre-route');
