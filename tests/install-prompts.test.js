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

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function directorySnapshot(root) {
  const entries = [];
  function visit(directory, relative = '') {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of children) {
      const entryPath = path.join(directory, entry.name);
      const entryRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        entries.push({ path: entryRelative, type: 'directory' });
        visit(entryPath, entryRelative);
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: entryRelative, type: 'symlink', target: fs.readlinkSync(entryPath) });
      } else {
        entries.push({ path: entryRelative, type: 'file', bytes: fs.readFileSync(entryPath).toString('base64') });
      }
    }
  }
  visit(root);
  return entries;
}

test('bash -n syntax check passes', () => {
  const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
});

test('dhpk_prompts_init fails cleanly on a missing catalog (no-op, no side effects)', () => {
  const isolationRoot = tmpDir('install-prompts-missing-catalog-');
  const cwd = path.join(isolationRoot, 'work');
  const home = path.join(isolationRoot, 'home');
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  const missingCatalog = path.join(cwd, 'missing-catalog.json');
  const before = { cwd: directorySnapshot(cwd), home: directorySnapshot(home) };
  try {
    const res = spawnSync(
      'bash',
      ['-c', `set -u; source "${SCRIPT}"; dhpk_prompts_init "${missingCatalog}"`],
      { cwd, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10000 }
    );
    assert.strictEqual(res.status, 1, `${res.stdout}\n${res.stderr}`);
    assert.ok(res.stderr.includes('FATAL: catalog file not found'), res.stderr);
    assert.deepStrictEqual(directorySnapshot(cwd), before.cwd, 'working directory changed on failure');
    assert.deepStrictEqual(directorySnapshot(home), before.home, 'home directory changed on failure');
  } finally {
    fs.rmSync(isolationRoot, { recursive: true, force: true });
  }
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
