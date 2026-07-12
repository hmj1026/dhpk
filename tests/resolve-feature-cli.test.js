'use strict';

// Coverage for scripts/resolve-feature-cli.js — thin CLI shim over
// scripts/lib/feature-resolver.js. Always exits 0 and prints JSON.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'resolve-feature-cli.js');

function runCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-feature-cli-'));
}

test('--feature <key> with a valid slug resolves explicitly at high confidence', () => {
  const tmp = mkTmp();
  try {
    const res = runCli(['--feature', 'my-feat'], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, 'my-feat');
    assert.strictEqual(out.source, 'explicit');
    assert.strictEqual(out.confidence, 'high');
    assert.strictEqual(out.docs_path, 'docs/features/my-feat');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--feature=<key> equals form is parsed the same as --feature <key>', () => {
  const tmp = mkTmp();
  try {
    const res = runCli(['--feature=other-feat'], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, 'other-feat');
    assert.strictEqual(out.source, 'explicit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('invalid slug (path traversal) is rejected and falls through to empty result', () => {
  const tmp = mkTmp();
  try {
    const res = runCli(['--feature', '../etc'], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, null);
    assert.strictEqual(out.source, null);
    assert.deepStrictEqual(out.canonical_docs, {
      tech_spec: null,
      architecture: null,
      feasibility: null,
      requirements: null,
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no --feature and no git/docs signal produces an empty (Gate: Need Human) result', () => {
  const tmp = mkTmp();
  try {
    const res = runCli([], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, null);
    assert.strictEqual(out.has_tech_spec, false);
    assert.strictEqual(out.has_requirements, false);
    assert.strictEqual(out.has_requests, false);
    assert.deepStrictEqual(out.doc_inventory, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

run('resolve-feature-cli');
