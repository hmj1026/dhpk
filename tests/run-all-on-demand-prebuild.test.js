'use strict';

// Separate file by design (CODING_STANDARDS.md, Tests): the subject is the
// tests/run-all.js on-demand package prebuild, not shard verification, and the
// owner suite tests/verify-test-shards.test.js is already past 1600 lines, twice
// the 800-line ceiling. Each case needs its own fixture root with a stand-in
// bin/ launcher script, which the owner suite has no use for.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, run, assert } = require('./_lib/tinytest');
const { ensureOnDemandPackages } = require('./run-all');

const REPO = path.resolve(__dirname, '..');
// sha256 of the compact JSON of the default fixture inventory
// { schema: 'v1', skills: ['a'] }, checked independently with
// `printf %s '{"schema":"v1","skills":["a"]}' | sha256sum`.
const FIXTURE_INVENTORY = Object.freeze({ schema: 'v1', skills: Object.freeze(['a']) });
const FIXTURE_INVENTORY_DIGEST = '942da80c2c1d36438a7e9cd3a94fabe986e1c810934fa77d01b2807e8c8b4712';

const LAUNCHER_OK = [
  '#!/usr/bin/env bash',
  'root="$(cd "$(dirname "$0")/.." && pwd)"',
  'echo "$3" >> "$root/calls.log"',
  'case "$3" in agent-plugin) n=dhpk-agent;; cursor-plugin) n=dhpk-cursor;; agy-plugin) n=dhpk-agy;; esac',
  'mkdir -p "$root/dist/on-demand/$n"',
  '',
].join('\n');
const LAUNCHER_FAIL = '#!/usr/bin/env bash\necho boom >&2\nexit 1\n';

// A fixture root with the real on-demand library and a stand-in launcher that
// records each `distribution build <surface>` call and creates the package dir.
function fixtureRoot({ withLibrary = true, launcher = LAUNCHER_OK } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-prebuild-fixture-'));
  fs.mkdirSync(path.join(root, 'bin'));
  if (withLibrary) {
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'scripts', 'lib', 'on-demand-packages.js'),
      path.join(root, 'scripts', 'lib', 'on-demand-packages.js'),
    );
  }
  fs.writeFileSync(path.join(root, 'bin', 'dhpk'), launcher, { mode: 0o755 });
  return root;
}

function calls(root) {
  const log = path.join(root, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
}

test('ensureOnDemandPackages builds every missing on-demand surface', () => {
  const root = fixtureRoot();
  try {
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root).sort(), ['agent-plugin', 'agy-plugin', 'cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages leaves an already built surface alone', () => {
  const root = fixtureRoot();
  try {
    fs.mkdirSync(path.join(root, 'dist', 'on-demand', 'dhpk-agent'), { recursive: true });
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root).sort(), ['agy-plugin', 'cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages skips trees without the on-demand library', () => {
  const root = fixtureRoot({ withLibrary: false });
  try {
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages fails loudly when a build fails', () => {
  const root = fixtureRoot({ launcher: LAUNCHER_FAIL });
  try {
    assert.throws(() => ensureOnDemandPackages(root, process.env), /build failed before the test run: boom/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function provenanceFixtureRoot({ version = '1.2.3', gitInit = false } = {}) {
  const root = fixtureRoot();
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), `${JSON.stringify(FIXTURE_INVENTORY)}\n`);
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'dhpk', version })}\n`);
  let head = '1'.repeat(40);
  if (gitInit) {
    fs.writeFileSync(path.join(root, '.gitignore'), '/dist/on-demand/\n/calls.log\n');
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q']);
    git(['config', 'user.email', 'prebuild-test@example.invalid']);
    git(['config', 'user.name', 'Prebuild Test']);
    git(['add', '.']);
    git(['commit', '-qm', 'initial']);
    head = git(['rev-parse', 'HEAD']).trim();
  }
  const writeReceipt = (surface, overrides = {}) => {
    const dirName = { 'agent-plugin': 'dhpk-agent', 'cursor-plugin': 'dhpk-cursor', 'agy-plugin': 'dhpk-agy' }[surface];
    const dir = path.join(root, 'dist', 'on-demand', dirName);
    fs.mkdirSync(dir, { recursive: true });
    if (overrides === null) return;
    fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify({
      surface,
      sourceVersion: version,
      sourceCommit: head,
      generatedFromCommit: head,
      inventoryDigest: FIXTURE_INVENTORY_DIGEST,
      ...overrides,
    }));
  };
  return { root, head, writeReceipt };
}

test('ensureOnDemandPackages skips fresh surfaces and rebuilds stale inventory, version, or missing receipt', () => {
  const { root, writeReceipt } = provenanceFixtureRoot();
  try {
    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin', { inventoryDigest: '0'.repeat(64) });
    writeReceipt('agy-plugin', { sourceVersion: '1.2.2' });
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root).sort(), ['agy-plugin', 'cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages rebuilds a surface whose provenance.json is missing', () => {
  const { root, writeReceipt } = provenanceFixtureRoot();
  try {
    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin', null);
    writeReceipt('agy-plugin');
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root), ['cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages rebuilds a surface from a non-ancestor commit on a clean checkout', () => {
  const { root, writeReceipt } = provenanceFixtureRoot({ gitInit: true });
  try {
    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin', { generatedFromCommit: 'a'.repeat(40), sourceCommit: 'a'.repeat(40) });
    writeReceipt('agy-plugin');
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root), ['cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages rebuilds when HEAD advances past the built commit on a clean checkout', () => {
  const { root, writeReceipt } = provenanceFixtureRoot({ gitInit: true });
  try {
    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin');
    writeReceipt('agy-plugin');
    // Advance HEAD with a content-only commit (same version & inventoryDigest).
    fs.writeFileSync(path.join(root, 'note.txt'), 'content change\n');
    execFileSync('git', ['add', 'note.txt'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'content change'], { cwd: root });
    ensureOnDemandPackages(root, process.env);
    assert.deepStrictEqual(calls(root).sort(), ['agent-plugin', 'agy-plugin', 'cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages ignores inherited GIT_DIR and GIT_WORK_TREE overrides', () => {
  const { root, writeReceipt } = provenanceFixtureRoot({ gitInit: true });
  const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dhpk-prebuild-other-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: otherRepo });
    execFileSync('git', ['config', 'user.email', 'other@example.invalid'], { cwd: otherRepo });
    execFileSync('git', ['config', 'user.name', 'Other'], { cwd: otherRepo });
    fs.writeFileSync(path.join(otherRepo, 'seed.txt'), 'seed\n');
    execFileSync('git', ['add', '.'], { cwd: otherRepo });
    execFileSync('git', ['commit', '-qm', 'seed'], { cwd: otherRepo });
    fs.writeFileSync(path.join(otherRepo, 'dirty.txt'), 'dirty\n');

    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin', { inventoryDigest: '0'.repeat(64) });
    writeReceipt('agy-plugin');
    ensureOnDemandPackages(root, {
      ...process.env,
      GIT_DIR: path.join(otherRepo, '.git'),
      GIT_WORK_TREE: otherRepo,
    });
    assert.deepStrictEqual(calls(root), ['cursor-plugin']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  }
});

test('ensureOnDemandPackages skips and warns about missing and stale builds on a dirty checkout', () => {
  const { root, writeReceipt } = provenanceFixtureRoot({ gitInit: true });
  try {
    writeReceipt('agent-plugin');
    writeReceipt('cursor-plugin', { inventoryDigest: '0'.repeat(64) });
    // agy-plugin is intentionally missing.
    fs.writeFileSync(path.join(root, 'dirty.txt'), 'uncommitted\n');
    const warnings = [];
    ensureOnDemandPackages(root, process.env, { warn: (message) => warnings.push(message) });
    assert.deepStrictEqual(calls(root), []);
    assert.strictEqual(warnings.length, 2, warnings.join('\n'));
    assert.match(warnings.find((w) => w.includes('cursor-plugin')) || '', /package is stale and the checkout has uncommitted changes/);
    assert.match(warnings.find((w) => w.includes('agy-plugin')) || '', /package is missing and the checkout has uncommitted changes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run('run-all-on-demand-prebuild');
