'use strict';

// Separate file by design (CODING_STANDARDS.md, Tests): the subject is the
// tests/run-all.js on-demand package prebuild, not shard verification, and the
// owner suite tests/verify-test-shards.test.js is already past 1600 lines, twice
// the 800-line ceiling. Each case needs its own fixture root with a stand-in
// bin/ launcher script, which the owner suite has no use for.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, run, assert } = require('./_lib/tinytest');
const { ensureOnDemandPackages } = require('./run-all');

const REPO = path.resolve(__dirname, '..');

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

run('run-all-on-demand-prebuild');
