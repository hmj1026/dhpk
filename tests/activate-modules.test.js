'use strict';

// Coverage for scripts/hooks/_lib/activate-modules.py: parse_yaml + activate()
// protocol (WARN / MODULE / ACTIVE lines). Guarded on python3 availability.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'hooks', '_lib', 'activate-modules.py');

const pyCheck = spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (pyCheck.error || pyCheck.status !== 0) {
  console.log('skip: python3 not available');
  process.exit(0);
}

function mkModule(root, name, yaml) {
  const dir = path.join(root, 'modules', name);
  fs.mkdirSync(dir, { recursive: true });
  if (yaml !== undefined) {
    fs.writeFileSync(path.join(dir, 'module.yaml'), yaml);
  }
}

function runActivate(pluginRoot, csv) {
  return spawnSync('python3', [SCRIPT, pluginRoot, csv], { encoding: 'utf8', timeout: 10000 });
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-activate-'));
}

test('enabled module with display_name emits MODULE line and ACTIVE csv', () => {
  const root = tmpRoot();
  mkModule(root, 'php', 'display_name: "PHP"\nrequires: []\n');
  const res = runActivate(root, 'php');
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.ok(lines.includes('MODULE\tphp\tPHP'), `missing MODULE line: ${res.stdout}`);
  assert.ok(lines.includes('ACTIVE\tphp'), `missing ACTIVE line: ${res.stdout}`);
});

test('module missing on disk emits WARN and is excluded from ACTIVE', () => {
  const root = tmpRoot();
  const res = runActivate(root, 'nope');
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.ok(lines.some((l) => l.startsWith('WARN\t') && l.includes("module 'nope' not found")), res.stdout);
  assert.ok(lines.some((l) => l === 'ACTIVE' || l === 'ACTIVE\t'), `expected empty ACTIVE, got: ${res.stdout}`);
});

test('missing module.yaml falls back to module name as display', () => {
  const root = tmpRoot();
  mkModule(root, 'bare', undefined);
  const res = runActivate(root, 'bare');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes('MODULE\tbare\tbare'), res.stdout);
});

test('unmet requires emits a WARN referencing the missing dependency', () => {
  const root = tmpRoot();
  mkModule(root, 'laravel', 'display_name: Laravel\nrequires: [php]\n');
  const res = runActivate(root, 'laravel');
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes("requires 'php' but it is not enabled"), res.stdout);
});

test('duplicate module names in csv are deduped preserving order', () => {
  const root = tmpRoot();
  mkModule(root, 'php', 'display_name: PHP\n');
  const res = runActivate(root, 'php, php ,php');
  assert.strictEqual(res.status, 0, res.stderr);
  const moduleLines = res.stdout.trim().split('\n').filter((l) => l.startsWith('MODULE\t'));
  assert.strictEqual(moduleLines.length, 1, `expected 1 MODULE line, got: ${res.stdout}`);
  assert.ok(res.stdout.includes('ACTIVE\tphp'), res.stdout);
});

test('no argv given (edge case) exits 0 with empty output', () => {
  const res = spawnSync('python3', [SCRIPT], { encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(res.stdout, '');
});

run('activate-modules');
