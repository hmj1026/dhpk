'use strict';

// Smoke coverage for scripts/lib/install-prompts.sh — a source-only helper
// library (not a hook), so we assert (1) bash -n syntax, and (2) a
// provably-no-op invocation: dhpk_prompts_init against a missing catalog
// fails cleanly without side effects, and against a real minimal catalog
// succeeds and dhpk_catalog_query can read it back via jq.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'lib', 'install-prompts.sh');

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('dhpk_prompts_init fails cleanly on a missing catalog (no-op, no side effects)', () => {
  const res = spawnSync(
    'bash',
    ['-c', `set -u; source "${SCRIPT}"; dhpk_prompts_init "/no/such/catalog.json"; echo "rc=$?"`],
    { encoding: 'utf8', timeout: 10000 }
  );
  assert.ok(res.stdout.includes('rc=1'), `expected rc=1, got: ${res.stdout} / ${res.stderr}`);
  assert.ok(res.stderr.includes('FATAL: catalog file not found'), res.stderr);
});

test('dhpk_prompts_init + dhpk_catalog_query round-trip against a minimal real catalog', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-prompts-'));
  try {
    const catalog = path.join(tmp, 'catalog.json');
    fs.writeFileSync(catalog, JSON.stringify({ stacks: [{ id: 'php', name: 'PHP' }] }));
    const res = spawnSync(
      'bash',
      [
        '-c',
        `source "${SCRIPT}"; dhpk_prompts_init "${catalog}" || exit 9; dhpk_catalog_query '.stacks[].id'`,
      ],
      { encoding: 'utf8', timeout: 10000 }
    );
    assert.strictEqual(res.status, 0, `init/query failed: ${res.stderr}`);
    assert.strictEqual(res.stdout.trim(), 'php');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('install-prompts');
