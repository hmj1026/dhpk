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

// Former suite: resolve-feature
{
// Coverage for scripts/resolve-feature.sh — bash wrapper over
// resolve-feature-cli.js. Must exec node relative to its own location, so it
// works from any cwd, and forward args/exit status/stdout through unchanged.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test, assert } = require('./_lib/tinytest');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'resolve-feature.sh');

function runScript(args, cwd) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 10000 });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-feature-sh-'));
}



test('forwards --feature <key> and works from an unrelated cwd', () => {
  const tmp = mkTmp();
  try {
    const res = runScript(['--feature', 'wrapper-feat'], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, 'wrapper-feat');
    assert.strictEqual(out.source, 'explicit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runs with no args, exits 0, and emits valid JSON', () => {
  const tmp = mkTmp();
  try {
    const res = runScript([], tmp);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.key, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
}

// Former suite: feature-resolver
{
// Unit coverage for scripts/lib/feature-resolver.js — the pure resolver module
// itself (as opposed to resolve-feature-cli.test.js / resolve-feature.test.js,
// which cover the CLI/bash wrappers). Exercises isValidSlug, classifyDoc, and
// resolveFeature's doc-inventory / canonical-doc scan directly against a
// scratch docs/features/<key>/ tree (via opts.cwd), no git required.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, assert } = require('./_lib/tinytest');
const { resolveFeature, isValidSlug, classifyDoc } = require('../scripts/lib/feature-resolver');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'feature-resolver-')));
}

test('isValidSlug accepts lowercase-alnum-dash slugs and rejects traversal/dotfiles', () => {
  assert.ok(isValidSlug('my-feat_1.2'));
  assert.ok(!isValidSlug('../etc'));
  assert.ok(!isValidSlug('.hidden'));
  assert.ok(!isValidSlug('a/b'));
  assert.ok(!isValidSlug(''));
});

test('classifyDoc recognizes numbered tech-spec as high-confidence canonical', () => {
  const d = classifyDoc('2-tech-spec.md');
  assert.strictEqual(d.type, 'tech-spec');
  assert.strictEqual(d.role, 'tech_spec');
  assert.strictEqual(d.namespace, 'lifecycle');
  assert.strictEqual(d.confidence, 'high');
});

test('classifyDoc treats an unrecognized ad-hoc filename as low confidence, no role', () => {
  const d = classifyDoc('notes.md');
  assert.strictEqual(d.namespace, 'ad-hoc');
  assert.strictEqual(d.role, null);
  assert.strictEqual(d.confidence, 'low');
});

test('resolveFeature: explicit --feature key scans docs dir and reports canonical docs', () => {
  const tmp = mkTmp();
  try {
    const featDir = path.join(tmp, 'docs', 'features', 'my-feat');
    fs.mkdirSync(featDir, { recursive: true });
    fs.writeFileSync(path.join(featDir, '1-requirements.md'), '# req');
    fs.writeFileSync(path.join(featDir, '2-tech-spec.md'), '# spec');
    fs.mkdirSync(path.join(featDir, 'requests'), { recursive: true });
    fs.writeFileSync(path.join(featDir, 'requests', 'ticket-1.md'), '# ticket');

    const result = resolveFeature({ feature: 'my-feat', cwd: tmp });
    assert.strictEqual(result.key, 'my-feat');
    assert.strictEqual(result.source, 'explicit');
    assert.strictEqual(result.confidence, 'high');
    assert.strictEqual(result.has_tech_spec, true);
    assert.strictEqual(result.has_requirements, true);
    assert.strictEqual(result.has_requests, true);
    assert.strictEqual(result.canonical_docs.tech_spec.file, '2-tech-spec.md');
    assert.strictEqual(result.doc_inventory.length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveFeature: invalid explicit slug + no other signal falls through to empty Gate:Need-Human result', () => {
  const tmp = mkTmp();
  try {
    const result = resolveFeature({ feature: '../bad', cwd: tmp });
    assert.strictEqual(result.key, null);
    assert.strictEqual(result.source, null);
    assert.deepStrictEqual(result.doc_inventory, []);
    assert.strictEqual(result.has_tech_spec, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
}

run('resolve-feature-cli');
